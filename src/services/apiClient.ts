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

export async function apiJson<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
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
