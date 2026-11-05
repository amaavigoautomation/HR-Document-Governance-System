/**
 * Google Calendar / Google Meet, one connection per company.
 *
 * A Company Admin presses "Connect Google Calendar" and signs in with the Google account that should own the interviews
 * (for example hr@theircompany.com). We keep that account's refresh token, encrypted, in the server-only collection
 * `integrationSecrets` (document `google_<companyId>`); the browser never sees it. Scheduling a video interview then creates a
 * Calendar event with a Google Meet link on that account. If a company has not connected (or Google fails), the interview form
 * keeps working: HR pastes a link, exactly as before.
 *
 * Actions (reached through hiringRouter.ts as /api/recruitment/<action>):
 *   google-status       who is connected, and whether this deployment is set up for Google at all
 *   google-connect      Company Admin: returns the Google sign-in address
 *   google-callback     Google sends the browser back here (no sign-in header; the signed `state` is the credential)
 *   google-disconnect   Company Admin: forgets the token (and revokes it at Google)
 *
 * Deployment variables (set once by the platform owner):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   OAuth client of a Google Cloud project with the Calendar API enabled
 *   GOOGLE_TOKEN_KEY                          any long random text; encrypts stored tokens and signs the sign-in `state`
 *   APP_BASE_URL                              public address of this app; the redirect address is <APP_BASE_URL>/api/recruitment/google-callback
 *                                             (or set GOOGLE_REDIRECT_URI to use another address, which must match Google exactly)
 */
import crypto from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';

type Result = { status: number; json: any };
const db = () => adminDb();
const env = (k: string) => (process.env[k] || '').trim();
const nowMs = () => Date.now();
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'];
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SECRETS = 'integrationSecrets';
const secretId = (cid: string) => `google_${cid}`;

/** True when this deployment has the Google OAuth client and the encryption key. Companies cannot connect until it is true. */
export const googlePlatformReady = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET') && env('GOOGLE_TOKEN_KEY').length >= 16);

// ------------------------------------------------------------------ test hook for the network

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;
let netFetch: FetchLike = (url, init) => fetch(url, init) as any;
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tests replace the network and the waiting. */
export const __setGoogleNet = (f: FetchLike | null, s?: (ms: number) => Promise<void>) => { netFetch = f || ((url, init) => fetch(url, init) as any); sleep = s || ((ms) => new Promise<void>((r) => setTimeout(r, ms))); };
const tokenCache = new Map<string, { token: string; until: number }>();
export const __clearGoogleCache = () => tokenCache.clear();

async function timed(url: string, init: any, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await netFetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}

// ------------------------------------------------------------------ encryption and signed state

const aesKey = () => crypto.createHash('sha256').update(`enc:${env('GOOGLE_TOKEN_KEY')}`).digest();
const macKey = () => crypto.createHash('sha256').update(`mac:${env('GOOGLE_TOKEN_KEY')}`).digest();
const b64u = (b: Buffer) => b.toString('base64url');

export function encryptText(plain: string): { iv: string; tag: string; data: string } {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', aesKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { iv: b64u(iv), tag: b64u(c.getAuthTag()), data: b64u(data) };
}
export function decryptText(box: { iv: string; tag: string; data: string }): string {
  const d = crypto.createDecipheriv('aes-256-gcm', aesKey(), Buffer.from(box.iv, 'base64url'));
  d.setAuthTag(Buffer.from(box.tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64url')), d.final()]).toString('utf8');
}

export function signState(p: { cid: string; uid: string }, ttlMs = 10 * 60_000): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...p, exp: nowMs() + ttlMs, n: crypto.randomBytes(6).toString('hex') })));
  const sig = b64u(crypto.createHmac('sha256', macKey()).update(body).digest());
  return `${body}.${sig}`;
}
export function verifyState(state: string): { cid: string; uid: string } | null {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', macKey()).update(body).digest();
  let got: Buffer;
  try { got = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p || typeof p.cid !== 'string' || typeof p.uid !== 'string' || typeof p.exp !== 'number' || p.exp < nowMs()) return null;
    return { cid: p.cid, uid: p.uid };
  } catch { return null; }
}

// ------------------------------------------------------------------ stored connection

interface GoogleSecret {
  companyId: string; kind: 'google'; email: string; status: 'CONNECTED' | 'NEEDS_RECONNECT';
  refreshToken: { iv: string; tag: string; data: string }; connectedBy: string; connectedAt: string; note?: string;
}
async function readSecret(cid: string): Promise<GoogleSecret | null> {
  const s = await db().collection(SECRETS).doc(secretId(cid)).get();
  const d = s.exists ? (s.data() as GoogleSecret) : null;
  return d && d.companyId === cid ? d : null;
}

export async function googleStatus(cid: string): Promise<{ platformReady: boolean; connected: boolean; needsReconnect: boolean; email: string; connectedAt: string }> {
  const platformReady = googlePlatformReady();
  const s = platformReady ? await readSecret(cid) : null;
  return { platformReady, connected: !!s && s.status === 'CONNECTED', needsReconnect: !!s && s.status === 'NEEDS_RECONNECT', email: s?.email || '', connectedAt: s?.connectedAt || '' };
}

const redirectUri = (origin?: string) => env('GOOGLE_REDIRECT_URI') || `${(env('APP_BASE_URL') || origin || '').replace(/\/+$/, '')}/api/recruitment/google-callback`;
const homeUrl = (origin?: string) => `${(env('APP_BASE_URL') || origin || '').replace(/\/+$/, '')}/`;

async function accessToken(cid: string): Promise<{ token?: string; error?: string; notConnected?: boolean }> {
  const hit = tokenCache.get(cid);
  if (hit && hit.until > nowMs() + 60_000) return { token: hit.token };
  if (!googlePlatformReady()) return { error: 'Google is not set up on this deployment.', notConnected: true };
  const s = await readSecret(cid);
  if (!s) return { error: 'Google Calendar is not connected.', notConnected: true };
  if (s.status !== 'CONNECTED') return { error: 'Google Calendar needs to be connected again.' };
  let refresh = '';
  try { refresh = decryptText(s.refreshToken); } catch { return { error: 'The stored Google connection could not be read. Connect again.' }; }
  try {
    const r = await timed('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
    });
    const j: any = await r.json().catch(() => ({}));
    if (j.access_token) { tokenCache.set(cid, { token: j.access_token, until: nowMs() + Math.max(120, Number(j.expires_in) || 3000) * 1000 }); return { token: j.access_token }; }
    if (j.error === 'invalid_grant') {
      // The company revoked access, or the token expired: stop using it and ask for a new connection.
      await db().collection(SECRETS).doc(secretId(cid)).set({ ...s, status: 'NEEDS_RECONNECT', note: 'Google no longer accepts this connection.' });
      tokenCache.delete(cid);
      return { error: 'Google no longer accepts the connection. A Company Admin needs to connect Google Calendar again.' };
    }
    return { error: `Google did not give access (${j.error || r.status}).` };
  } catch (e: any) { return { error: `Could not reach Google (${e?.message || 'network'}).` }; }
}

// ------------------------------------------------------------------ calendar events

export interface MeetingInput { title: string; description?: string; startIso: string; endIso: string; attendees: string[]; requestId: string }
export interface MeetingResult { ok: boolean; link?: string; eventId?: string; error?: string; notConnected?: boolean }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

const eventBody = (m: MeetingInput) => ({
  summary: m.title.slice(0, 250), description: (m.description || '').slice(0, 4000),
  start: { dateTime: m.startIso, timeZone: 'UTC' }, end: { dateTime: m.endIso, timeZone: 'UTC' },
  attendees: [...new Set(m.attendees.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))].map((email) => ({ email })),
  guestsCanInviteOthers: false, guestsCanModify: false,
});

async function readLink(token: string, eventId: string, first: any): Promise<string> {
  let ev = first;
  for (let i = 0; i < 4; i++) {
    const link = ev?.hangoutLink || ev?.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri;
    if (typeof link === 'string' && link) return link;
    await sleep(700);
    try { const r = await timed(`${CAL}/${encodeURIComponent(eventId)}?conferenceDataVersion=1`, { headers: { Authorization: `Bearer ${token}` } }); ev = await r.json(); } catch { /* try again */ }
  }
  return '';
}

/** Makes a Calendar event with a Google Meet link on the company's connected account. Never throws; the caller falls back to a pasted link. */
export async function createGoogleMeeting(cid: string, m: MeetingInput): Promise<MeetingResult> {
  const at = await accessToken(cid);
  if (!at.token) return { ok: false, error: at.error, notConnected: at.notConnected };
  try {
    const r = await timed(`${CAL}?conferenceDataVersion=1&sendUpdates=none`, {
      method: 'POST', headers: { Authorization: `Bearer ${at.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...eventBody(m), conferenceData: { createRequest: { requestId: m.requestId.slice(0, 60), conferenceSolutionKey: { type: 'hangoutsMeet' } } } }),
    });
    const ev: any = await r.json().catch(() => ({}));
    if (!r.ok || !ev.id) return { ok: false, error: `Google could not create the event (${ev?.error?.message || r.status}).` };
    const link = await readLink(at.token, ev.id, ev);
    if (!link) { await cancelGoogleMeeting(cid, ev.id); return { ok: false, error: 'Google made the event but no Meet link came back.' }; }
    return { ok: true, link, eventId: ev.id };
  } catch (e: any) { return { ok: false, error: `Could not reach Google (${e?.message || 'network'}).` }; }
}

/** Moves an existing event. The Meet link stays the same. */
export async function updateGoogleMeeting(cid: string, eventId: string, m: MeetingInput): Promise<MeetingResult> {
  const at = await accessToken(cid);
  if (!at.token) return { ok: false, error: at.error };
  try {
    const r = await timed(`${CAL}/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=none`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${at.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(eventBody(m)),
    });
    const ev: any = await r.json().catch(() => ({}));
    if (!r.ok || !ev.id) return { ok: false, error: `Google could not move the event (${ev?.error?.message || r.status}).` };
    return { ok: true, eventId: ev.id, link: await readLink(at.token, ev.id, ev) };
  } catch (e: any) { return { ok: false, error: `Could not reach Google (${e?.message || 'network'}).` }; }
}

/** Deletes the event. A missing event counts as done. */
export async function cancelGoogleMeeting(cid: string, eventId: string): Promise<boolean> {
  const at = await accessToken(cid);
  if (!at.token) return false;
  try {
    const r = await timed(`${CAL}/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: 'DELETE', headers: { Authorization: `Bearer ${at.token}` } });
    return r.ok || r.status === 404 || r.status === 410;
  } catch { return false; }
}

// ------------------------------------------------------------------ routes

export interface GoogleRequest { method: string; action: string; query: Record<string, any>; body?: any; headers: Record<string, any>; origin?: string }
const isAdmin = (c: AuthContext) => c.isCompanyAdmin;

function jwtEmail(idToken: unknown): string {
  try {
    const part = String(idToken || '').split('.')[1];
    const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return typeof p.email === 'string' ? p.email.toLowerCase() : '';
  } catch { return ''; }
}

async function callback(r: GoogleRequest): Promise<Result> {
  const back = (q: string) => ({ status: 302, json: { __redirect: `${homeUrl(r.origin)}?${q}` } });
  const state = verifyState(String(r.query.state || ''));
  if (!state) return back('google=error&reason=expired');
  if (r.query.error) return back(`google=error&reason=${encodeURIComponent(String(r.query.error).slice(0, 60))}`);
  const code = String(r.query.code || '');
  if (!code) return back('google=error&reason=nocode');
  if (!googlePlatformReady()) return back('google=error&reason=notready');
  try {
    const co = await db().collection('companies').doc(state.cid).get();
    if (!co.exists || co.get('status') !== 'ACTIVE') return back('google=error&reason=company');
    const tr = await timed('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri(r.origin), grant_type: 'authorization_code' }).toString(),
    });
    const tj: any = await tr.json().catch(() => ({}));
    if (!tj.refresh_token) return back(`google=error&reason=${encodeURIComponent(tj.error || 'norefresh')}`);
    if (!String(tj.scope || '').split(' ').includes(CAL_SCOPE)) return back('google=error&reason=scope');
    const rec: GoogleSecret = {
      companyId: state.cid, kind: 'google', email: jwtEmail(tj.id_token), status: 'CONNECTED', refreshToken: encryptText(tj.refresh_token),
      connectedBy: state.uid, connectedAt: new Date(nowMs()).toISOString(),
    };
    await db().collection(SECRETS).doc(secretId(state.cid)).set(rec);
    tokenCache.delete(state.cid);
    return back('google=connected');
  } catch (e: any) {
    console.warn('[Google] callback failed:', e?.message || e);
    return back('google=error&reason=failed');
  }
}

export async function routeGoogle(r: GoogleRequest): Promise<Result | null> {
  if (!['google-status', 'google-connect', 'google-callback', 'google-disconnect'].includes(r.action)) return null;
  try {
    if (r.action === 'google-callback') return r.method === 'GET' ? await callback(r) : fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    const cid = ctx.companyId!;
    if (r.action === 'google-status') {
      if (r.method !== 'GET') return fail(405, 'Method not allowed. Use GET.');
      return ok({ ...(await googleStatus(cid)), canManage: isAdmin(ctx) });
    }
    if (r.method !== 'POST') return fail(405, 'Method not allowed. Use POST.');
    if (!isAdmin(ctx)) return fail(403, 'Only a Company Admin can connect or disconnect Google Calendar.');
    if (r.action === 'google-connect') {
      if (!googlePlatformReady()) return fail(409, 'Google is not set up on this deployment yet. The platform owner needs to add the Google settings first.');
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri(r.origin), response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: signState({ cid, uid: ctx.uid }),
      }).toString();
      return ok({ url });
    }
    // google-disconnect
    const s = await readSecret(cid);
    if (s) {
      try { await timed('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: decryptText(s.refreshToken) }).toString() }, 6000); } catch { /* forgetting it here is what matters */ }
      await db().collection(SECRETS).doc(secretId(cid)).delete();
    }
    tokenCache.delete(cid);
    return ok({ connected: false });
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Google] route error:', err);
    return fail(500, err?.message || 'Google request failed.');
  }
}
