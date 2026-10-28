import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHome } from '../api/_lib/homeApi.ts';
import { DEFAULT_ROLE_TEMPLATES } from '../shared/permissions.ts';
import { celebrationsFor, sanitizeQuickLinks, loginChannel, nextOccurrence } from '../shared/home.ts';

const perms = (slug: string) => DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === slug)!.permissions;

// ---- pure rules
assert.equal(nextOccurrence('02-29', '2027-01-10'), '2027-02-28', 'Feb 29 falls on Feb 28 in a common year');
const people = [
  { uid: 'a', name: 'A', department: 'Ops', title: '', dob: '1990-03-05', joinDate: '2020-03-05', marriageDate: '2015-03-05', showMarriage: false },
  { uid: 'b', name: 'B', department: 'Ops', title: '', dob: '1990-03-05', showCelebrations: false },
  { uid: 'c', name: 'C', department: 'Ops', title: '', marriageDate: '2015-03-05', showMarriage: true },
] as any[];
const c = celebrationsFor(people, '2026-03-05', 'today');
assert.deepEqual(c.map((x) => `${x.uid}:${x.kind}`).sort(), ['a:BIRTHDAY', 'a:WORK', 'c:MARRIAGE']);
assert.equal(c.find((x) => x.kind === 'WORK')!.years, 6);
assert.equal(JSON.stringify(c).includes('1990'), false, 'birth year never leaves the module');

const links = sanitizeQuickLinks([{ label: 'x', kind: 'URL', url: 'javascript:alert(1)' }, { label: 'ok', kind: 'URL', url: 'https://a.com' }, { label: '', kind: 'URL', url: 'https://b.com' }]);
assert.deepEqual(links.map((l) => l.label), ['ok']);
assert.equal(loginChannel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'mobile');
assert.equal(loginChannel('Mozilla/5.0 (Windows NT 10.0)'), 'web');

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, p: string[], cid = 'c1', adm = false) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms: p, adm })).toString('base64')}` });
const EMP = tok('u_emp', perms('employee'));
const HR = tok('u_hr', perms('hr'));
const FOREIGN_HR = tok('u_hr', perms('hr'), 'c2');
fdb.seed('companies', 'c1', { name: 'Acme' });
for (const uid of ['u_emp', 'u_hr']) fdb.seed('employees', uid, { companyId: 'c1', authUid: uid, name: uid, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z' });
const call = (headers: any, action: string, method = 'GET', body?: any, query: any = {}) => routeHome({ method, action, query, body, headers });

// employees cannot post announcements, HR can
assert.equal((await call(EMP, 'save-announcement', 'POST', { kind: 'ANNOUNCEMENT', title: 't', body: 'b' })).status, 403);
const saved = await call(HR, 'save-announcement', 'POST', { kind: 'ANNOUNCEMENT', title: 'Holiday', body: 'Office closed Friday' });
assert.equal(saved.status, 200);
const seen = await call(EMP, 'announcements', 'GET', undefined, { kind: 'ANNOUNCEMENT' });
assert.equal((seen.json as any).items.length, 1);
// another company can neither see nor edit it
assert.equal(((await call(FOREIGN_HR, 'announcements', 'GET', undefined, { kind: 'ANNOUNCEMENT' })).json as any).items.length, 0);
assert.equal((await call(FOREIGN_HR, 'save-announcement', 'POST', { id: (saved.json as any).id, kind: 'ANNOUNCEMENT', title: 'x', body: 'y' })).status, 404);

// mood: one answer a day, counts only for managers
assert.equal((await call(EMP, 'mood', 'POST', { mood: 'OK' })).status, 200);
assert.equal(((await call(EMP, 'mood')).json as any).today, 'OK');
assert.equal((await call(EMP, 'mood-summary')).status, 403);
assert.equal((await call(HR, 'mood-summary')).status, 200);

// login summary is for people who manage users only
await call(EMP, 'login-event', 'POST');
assert.equal((await call(EMP, 'login-summary')).status, 403);

// own dates: year never reaches colleagues
assert.equal((await call(EMP, 'my-dates', 'POST', { dob: '1991-07-09', showCelebrations: true })).status, 200);
const wishes = await call(HR, 'wishes', 'GET', undefined, { range: 'month' });
assert.equal(JSON.stringify(wishes.json).includes('1991'), false);

console.log('home tests passed');
