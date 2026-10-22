/**
 * Fetching URLs that a company (or an applicant) gave us, without letting them aim the server at private
 * networks (SSRF). Used for resume links that arrive through the application webhook.
 *
 * A URL is accepted only when it is https (or http when explicitly allowed), has no credentials, and its host
 * resolves to public addresses only. Redirects are followed by hand so every hop is checked again.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function v4Private(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for loopback, private, link-local and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true; // not an IP at all: refuse
  const l = ip.toLowerCase();
  if (l === '::' || l === '::1') return true;
  const mapped = l.match(/^(?:0:0:0:0:0:ffff:|::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Private(mapped[1]);
  const mappedHex = l.match(/^(?:0:0:0:0:0:ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return v4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb') || l.startsWith('ff') || l.startsWith('2001:db8');
}

export async function assertPublicUrl(u: URL, opts: { allowHttp?: boolean } = {}): Promise<void> {
  if (u.protocol !== 'https:' && !(opts.allowHttp && u.protocol === 'http:')) throw new Error('Only https links are allowed.');
  if (u.username || u.password) throw new Error('Links with credentials are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('That address is not public.');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('That address is not public.');
    return;
  }
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('That address is not public.');
}

export async function fetchPublic(
  url: string,
  init: RequestInit & { maxRedirects?: number; allowHttp?: boolean } = {}
): Promise<Response> {
  const { maxRedirects = 3, allowHttp, ...rest } = init;
  let current = new URL(url);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current, { allowHttp });
    const res = await fetch(current, { ...rest, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current);
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}
