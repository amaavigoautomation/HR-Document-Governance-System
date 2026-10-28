import { auth } from './firebase';

/** Authorization header carrying the signed-in user's Firebase ID token (refreshed automatically when stale). */
export async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return extra;
  const token = await user.getIdToken();
  return { ...extra, Authorization: `Bearer ${token}` };
}

/** fetch() that sends the verified identity. Use for every /api call except the public ones. */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = await authHeaders((init.headers as Record<string, string>) || {});
  return fetch(input, { ...init, headers });
}

// Repeat reads of the Leave / Payroll / People screens are answered from memory for a short while, and identical reads made at the same moment share one request.
// Any change (a POST) clears everything, so people never see old data after their own action.
const READ_TTL_MS = 30_000;
const reads = new Map<string, { at: number; value?: unknown; pending?: Promise<unknown> }>();
const copy = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
export const clearApiCache = () => reads.clear();

async function request<T>(path: string, body: unknown, method: string): Promise<T> {
  const res = await apiFetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

// Only the Leave / Payroll / People screens (all under /api/leave/) use the read cache. Other endpoints, such as notifications, stay live.
// Identity photos are never kept in the read cache. The Home dashboard and the Home cards are excluded: it summarises things that change elsewhere (acknowledging a policy, a decision made on another screen), so it is read fresh each time.
const cacheable = (path: string) => path.startsWith('/api/leave/') && !path.startsWith('/api/leave/dashboard-') && !path.startsWith('/api/leave/home-') && !path.startsWith('/api/leave/lifecycle-identity-file') && !path.startsWith('/api/leave/lifecycle-qualification-doc') && !path.startsWith('/api/leave/lifecycle-separation-file') && !path.startsWith('/api/leave/doc-get');

export async function apiJson<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  if (!cacheable(path)) return request<T>(path, body, method);
  if (method !== 'GET') {
    reads.clear();
    try {
      return await request<T>(path, body, method);
    } finally {
      reads.clear(); // again after the server has saved, in case a read started while it was saving
    }
  }
  const key = `${auth.currentUser?.uid || ''}|${path}`;
  const hit = reads.get(key);
  if (hit && hit.pending) return copy((await hit.pending) as T);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return copy(hit.value as T);
  const pending = request<T>(path, body, method);
  reads.set(key, { at: Date.now(), pending });
  try {
    const value = await pending;
    if (reads.get(key)?.pending === pending) reads.set(key, { at: Date.now(), value });
    return copy(value);
  } catch (e) {
    if (reads.get(key)?.pending === pending) reads.delete(key);
    throw e;
  }
}
