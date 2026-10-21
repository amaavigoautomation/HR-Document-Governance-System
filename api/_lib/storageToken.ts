/**
 * Signed file links. File URLs are opened by <iframe>/<a>/<video>, which cannot send an Authorization
 * header, so each uploaded file gets an unforgeable HMAC token in its URL (a capability link).
 * Only someone who was handed the link by the upload response can open the file.
 *
 * Secret: STORAGE_URL_SECRET. If it is not set we derive one from the service-account key so links
 * survive restarts; as a last resort a random per-process secret is used (links then expire on restart).
 * LEGACY_OPEN_STORAGE=true temporarily accepts unsigned links, to read files uploaded before this change.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

let cached: string | null = null;

function secret(): string {
  if (cached) return cached;
  const explicit = (process.env.STORAGE_URL_SECRET || '').trim();
  if (explicit) return (cached = explicit);
  const sa = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (sa) return (cached = createHash('sha256').update(`storage:${sa}`).digest('hex'));
  console.warn('[storage] STORAGE_URL_SECRET is not set; file links will stop working when the server restarts.');
  return (cached = randomBytes(32).toString('hex'));
}

export function signStorageToken(fileId: string): string {
  return createHmac('sha256', secret()).update(fileId).digest('hex').slice(0, 40);
}

export function verifyStorageToken(fileId: string, token: unknown): boolean {
  if ((process.env.LEGACY_OPEN_STORAGE || '').trim() === 'true') return true;
  if (typeof token !== 'string' || token.length !== 40) return false;
  const expected = Buffer.from(signStorageToken(fileId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
