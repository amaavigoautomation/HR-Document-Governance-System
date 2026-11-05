import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { __setInterviewMailer } from '../api/_lib/interviewApi.ts';
import { __setGoogleNet, __clearGoogleCache, encryptText, decryptText, signState, verifyState } from '../api/_lib/googleCalendar.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, o: { perms?: string[]; adm?: boolean; cid?: string } = {}) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: o.cid || CID, cs: 'ACTIVE', perms: o.perms || [], adm: o.adm === true })).toString('base64')}` });
const ADMIN = tok('u_admin', { adm: true, perms: ['app.manage'] });
const HR = tok('u_hr', { perms: ['app.manage'] });
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHiring({ method, action, headers: h, body, query, origin: 'https://app.test' });
const future = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
for (const [id, n] of [['u_admin', 'Ada Admin'], ['u_hr', 'Hana HR'], ['u_i1', 'Ivy One'], ['u_i2', 'Ian Two']]) fdb.seed('employees', id, { companyId: CID, authUid: id, name: n, email: `${id}@acme.com`, active: true });

// ---- a pretend Google
const calls: { method: string; url: string; body: any }[] = [];
let revoked = false;
const jwt = (p: any) => `x.${Buffer.from(JSON.stringify(p)).toString('base64url')}.y`;
__setGoogleNet(async (url: string, init: any = {}) => {
  const method = init.method || 'GET';
  const body = typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body;
  calls.push({ method, url, body });
  const reply = (status: number, j: any) => ({ ok: status < 300, status, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    const p = new URLSearchParams(String(init.body));
    if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'good'
      ? reply(200, { access_token: 'at1', refresh_token: 'rt-SECRET-123', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/calendar.events', id_token: jwt({ email: 'HR@Acme.com' }) })
      : reply(400, { error: 'invalid_grant' });
    return revoked ? reply(400, { error: 'invalid_grant' }) : reply(200, { access_token: 'at2', expires_in: 3600 });
  }
  if (url.startsWith('https://oauth2.googleapis.com/revoke')) return reply(200, {});
  if (url.includes('/calendar/v3/calendars/primary/events')) {
    if (method === 'POST') return reply(200, { id: 'ev1', hangoutLink: 'https://meet.google.com/abc-defg-hij' });
    if (method === 'PATCH') return reply(200, { id: 'ev1', hangoutLink: 'https://meet.google.com/abc-defg-hij' });
    if (method === 'DELETE') return reply(204, {});
  }
  return reply(404, {});
});

const sent: { to: string; subject: string; body: string; ics?: any }[] = [];
__setInterviewMailer((async (p: any) => { sent.push({ to: p.to, subject: p.subject, body: p.body, ics: p.ics }); return { success: true }; }) as any);

async function main() {
  // ---- pure helpers
  process.env.GOOGLE_TOKEN_KEY = 'a-long-random-test-key-for-google-tokens';
  const box = encryptText('refresh-me');
  assert.equal(decryptText(box), 'refresh-me');
  assert.ok(!JSON.stringify(box).includes('refresh-me'));
  assert.throws(() => decryptText({ ...box, tag: encryptText('zzz').tag }), 'a wrong tag must not decrypt');
  const st = signState({ cid: 'c1', uid: 'u1' });
  assert.deepEqual(verifyState(st), { cid: 'c1', uid: 'u1' });
  assert.equal(verifyState(st.slice(0, -2) + 'xx'), null, 'tampered');
  assert.equal(verifyState(signState({ cid: 'c1', uid: 'u1' }, -1000)), null, 'expired');
  assert.equal(verifyState('garbage'), null);

  // ---- not set up on this deployment: everything still works by hand
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  let r = await call(HR, 'GET', 'google-status');
  assert.equal(r.status, 200); assert.equal(r.json.platformReady, false); assert.equal(r.json.connected, false); assert.equal(r.json.canManage, false);
  assert.equal((await call(ADMIN, 'POST', 'google-connect')).status, 409, 'platform not set up');
  assert.equal((await call({}, 'GET', 'google-status')).status, 401);

  // ---- set up: only a Company Admin can connect
  process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com'; process.env.GOOGLE_CLIENT_SECRET = 'csecret'; process.env.APP_BASE_URL = 'https://app.test';
  assert.equal((await call(HR, 'POST', 'google-connect')).status, 403, 'HR without admin cannot connect');
  assert.equal((await call(ADMIN, 'GET', 'google-connect')).status, 405);
  const con = await call(ADMIN, 'POST', 'google-connect');
  assert.equal(con.status, 200, JSON.stringify(con.json));
  const u = new URL(con.json.url);
  assert.equal(u.host, 'accounts.google.com');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://app.test/api/recruitment/google-callback');
  assert.ok(u.searchParams.get('scope')!.includes('calendar.events'));
  assert.equal(u.searchParams.get('access_type'), 'offline');
  const state = u.searchParams.get('state')!;

  // ---- the callback: bad state is refused, good state stores an encrypted token
  const bad = await call({}, 'GET', 'google-callback', {}, { code: 'good', state: 'nope' });
  assert.equal(bad.status, 302); assert.ok(bad.json.__redirect.includes('google=error'));
  assert.equal(fdb.all('integrationSecrets').length, 0);
  const denied = await call({}, 'GET', 'google-callback', {}, { error: 'access_denied', state });
  assert.ok(denied.json.__redirect.includes('google=error'));
  const good = await call({}, 'GET', 'google-callback', {}, { code: 'good', state });
  assert.equal(good.status, 302); assert.ok(good.json.__redirect.includes('google=connected'), good.json.__redirect);
  const rows = fdb.all('integrationSecrets');
  assert.equal(rows.length, 1); assert.equal(rows[0].companyId, CID);
  assert.ok(!JSON.stringify(rows[0]).includes('rt-SECRET-123'), 'the token is never stored in clear text');
  assert.equal(rows[0].email, 'hr@acme.com');
  r = await call(HR, 'GET', 'google-status');
  assert.equal(r.json.connected, true); assert.equal(r.json.email, 'hr@acme.com');
  assert.ok(!JSON.stringify(r.json).includes('rt-SECRET'), 'the status never carries the token');
  const integ = (await call(HR, 'GET', 'integrations')).json.integrations.find((i: any) => i.key === 'google_meet');
  assert.equal(integ.on, true);

  // ---- an interview: the Meet link is made, guests are invited, the email goes out
  fdb.seed('applications', 'a1', { id: 'a1', companyId: CID, name: 'Cara Candidate', email: 'cara@mail.com', emailLower: 'cara@mail.com', designation: 'Designer', designationKey: 'designer', status: 'Shortlisted', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const start = future(48);
  calls.length = 0;
  const sch = await call(HR, 'POST', 'int-schedule', { applicationId: 'a1', startIso: start, durationMinutes: 45, mode: 'Video', round: 'Technical round', panel: ['u_i1', 'u_i2'], guests: ['Founder@Acme.com', 'founder@acme.com', 'cto@acme.com'] });
  assert.equal(sch.status, 200, JSON.stringify(sch.json));
  const iv = sch.json.interview;
  assert.equal(iv.location, 'https://meet.google.com/abc-defg-hij');
  assert.equal(iv.meetProvider, 'google'); assert.equal(iv.googleEventId, 'ev1');
  assert.deepEqual(iv.guests, ['founder@acme.com', 'cto@acme.com'], 'guests are lower-cased and de-duplicated');
  const create = calls.find((c) => c.method === 'POST' && c.url.includes('/events'))!;
  assert.ok(create.url.includes('conferenceDataVersion=1') && create.url.includes('sendUpdates=none'), "Google's own invite email is off");
  assert.equal(create.body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
  assert.deepEqual(create.body.attendees.map((a: any) => a.email).sort(), ['cara@mail.com', 'cto@acme.com', 'founder@acme.com', 'u_i1@acme.com', 'u_i2@acme.com']);
  assert.equal(sch.json.meet.provider, 'google');
  assert.deepEqual(sent.map((m) => m.to).sort(), ['cara@mail.com', 'cto@acme.com', 'founder@acme.com', 'u_i1@acme.com', 'u_i2@acme.com'], 'candidate, panel and guests each get the email');
  assert.ok(sent.every((m) => m.body.includes('Join link: https://meet.google.com/abc-defg-hij')));
  assert.ok(sent.every((m) => !!m.ics && m.ics.content.includes('meet.google.com')), 'the .ics carries the link too');

  // ---- guests are not interviewers: they get no scorecard rights
  const fb = await call(tok('founder'), 'POST', 'int-feedback-submit', { interviewId: iv.id, scorecard: {} });
  assert.equal(fb.status, 403);
  assert.equal((await call(HR, 'POST', 'int-schedule', { applicationId: 'a1', startIso: future(60), panel: ['u_i1'], guests: ['not-an-email'] })).status, 400);

  // ---- reschedule moves the same event and keeps the link
  calls.length = 0; sent.length = 0;
  const moved = await call(HR, 'POST', 'int-reschedule', { id: iv.id, applicationId: 'a1', startIso: future(72), durationMinutes: 45, mode: 'Video', location: iv.location, round: 'Technical round', panel: ['u_i1', 'u_i2'] });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.url.includes('/events/ev1')), 'the existing event is moved, not duplicated');
  assert.ok(!calls.some((c) => c.method === 'POST' && c.url.includes('/events')));
  assert.equal(moved.json.interview.location, 'https://meet.google.com/abc-defg-hij');
  assert.equal(moved.json.interview.guests.length, 2, 'guests are kept when rescheduling');

  // ---- cancelling deletes the Google event
  calls.length = 0;
  const cx = await call(HR, 'POST', 'int-cancel', { id: iv.id, reason: 'Candidate withdrew' });
  assert.equal(cx.status, 200);
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('/events/ev1')));
  assert.equal(fdb.all('hiringItems').find((i) => i.id === iv.id)!.googleEventId, '');

  // ---- a link HR types is always kept as typed, and no Google event is made
  calls.length = 0;
  const own = await call(HR, 'POST', 'int-schedule', { applicationId: 'a1', startIso: future(96), mode: 'Video', location: 'https://zoom.us/j/1', panel: ['u_i1'] });
  assert.equal(own.json.interview.location, 'https://zoom.us/j/1'); assert.equal(own.json.interview.meetProvider, 'manual');
  assert.ok(!calls.some((c) => c.url.includes('/events')));

  // ---- Google refuses the saved connection: scheduling still works by hand, and the connection is marked for reconnecting
  revoked = true; __clearGoogleCache();
  sent.length = 0;
  const before = fdb.all('hiringItems').filter((i) => i.kind === 'interview').length;
  const fallback = await call(HR, 'POST', 'int-schedule', { applicationId: 'a1', startIso: future(120), mode: 'Video', panel: ['u_i2'] });
  assert.equal(fallback.status, 502, 'connected but failing: nothing is scheduled');
  assert.ok(fallback.json.error.includes('Google') && fallback.json.error.includes('paste a meeting link'), fallback.json.error);
  assert.equal(sent.length, 0, 'no invite goes out without its link');
  assert.equal(fdb.all('hiringItems').filter((i) => i.kind === 'interview').length, before);
  const byHand = await call(HR, 'POST', 'int-schedule', { applicationId: 'a1', startIso: future(120), mode: 'Video', location: 'https://zoom.us/j/9', panel: ['u_i2'] });
  assert.equal(byHand.status, 200, 'pasting a link always works, even when Google is down');
  r = await call(HR, 'GET', 'google-status');
  assert.equal(r.json.connected, false); assert.equal(r.json.needsReconnect, true);
  revoked = false;

  // ---- another company never sees or uses this connection
  fdb.seed('companies', 'c2', { status: 'ACTIVE', name: 'Other' });
  assert.equal((await call(tok('o1', { cid: 'c2', adm: true }), 'GET', 'google-status')).json.connected, false);

  // ---- disconnecting forgets the token
  assert.equal((await call(HR, 'POST', 'google-disconnect')).status, 403);
  assert.equal((await call(ADMIN, 'POST', 'google-disconnect')).status, 200);
  assert.equal(fdb.all('integrationSecrets').length, 0);
  assert.equal((await call(HR, 'GET', 'google-status')).json.connected, false);

  // ---- never connected: a video interview with no link is simply saved without one
  const none = await call(HR, 'POST', 'int-schedule', { applicationId: 'a1', startIso: future(150), mode: 'Video', panel: ['u_i1'] });
  assert.equal(none.status, 200); assert.equal(none.json.interview.location, ''); assert.equal(none.json.meet.note, '', 'no error when Google was never connected');

  console.log('google: all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
