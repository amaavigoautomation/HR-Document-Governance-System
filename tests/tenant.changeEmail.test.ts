import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';

delete process.env.SMTP_USER; delete process.env.SMTP_PASS; // no real email in tests

const fdb = new FakeFirestore();
type AuthRec = { uid: string; email: string; claims: any; signedIn: boolean; revoked: number };
const users = new Map<string, AuthRec>();
const addAuth = (uid: string, email: string, signedIn = true, claims: any = {}) => users.set(uid, { uid, email, claims, signedIn, revoked: 0 });
const notFound = () => Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
const tokenFor = (uid: string, perms: string[], adm = false) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: users.get(uid)!.email, cid: 'c1', cs: 'ACTIVE', perms, adm })).toString('base64')}` });
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => { const u = users.get(uid); if (!u) throw notFound(); return { uid, email: u.email, disabled: false, customClaims: u.claims, metadata: { lastSignInTime: u.signedIn ? '2026-11-01' : undefined } }; },
    getUserByEmail: async (email: string) => { const u = [...users.values()].find((x) => x.email === email); if (!u) throw notFound(); return { uid: u.uid }; },
    updateUser: async (uid: string, p: any) => { const u = users.get(uid)!; if (p.email) u.email = p.email; },
    setCustomUserClaims: async (uid: string, c: any) => { users.get(uid)!.claims = c; },
    revokeRefreshTokens: async (uid: string) => { users.get(uid)!.revoked++; },
    generatePasswordResetLink: async (email: string) => `https://reset.example/${email}`,
  },
});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';

fdb.seed('companies', 'c1', { id: 'c1', name: 'Acme', status: 'ACTIVE', modules: ['talent-acquisition', 'document-version-control'], adminEmail: 'boss@acme.com', employeeIdPrefix: 'AC', nextEmployeeNumber: 9 });
const role = (id: string, perms: string[], isAdmin = false) => fdb.seed('roles', `c1_${id}`, { id: `c1_${id}`, companyId: 'c1', name: id, permissions: perms, portal: 'CREATOR', isAdmin });
role('admin', [], true); role('hr', ['users.manage', 'leave.manage']); role('founder', ['users.manage', 'leave.manage', 'req.founder_decide', 'perf.approve']); role('employee', ['doc.acknowledge']);
const emp = (uid: string, email: string, roleIds: string[], perms: string[], extra: any = {}) => {
  addAuth(uid, email, true);
  fdb.seed('employees', uid, { id: uid, authUid: uid, companyId: 'c1', companyName: 'Acme', empId: `AC-${uid}`, loginId: email, name: uid, email, roleIds, perms, active: true, ...extra });
};
emp('boss', 'boss@acme.com', ['c1_admin'], []);
emp('hr', 'hr@acme.com', ['c1_hr'], ['users.manage', 'leave.manage']);
emp('founder', 'founder@acme.com', ['c1_founder'], ['users.manage', 'leave.manage', 'req.founder_decide', 'perf.approve']);
emp('ann', 'ann@acme.com', ['c1_employee'], ['doc.acknowledge']);
emp('pa', 'pa@acme.com', ['c1_employee'], ['doc.acknowledge']); users.get('pa')!.claims = { pa: true };
emp('legacy', 'legacy@acme.com', ['c1_employee'], ['doc.acknowledge'], { loginId: 'AC-legacy-login' });
emp('new', 'new@acme.com', ['c1_employee'], ['doc.acknowledge']); users.get('new')!.signedIn = false;
fdb.seed('acknowledgments', 'ack1', { companyId: 'c1', employeeId: 'AC-ann', employeeEmail: 'ann@acme.com', status: 'PENDING' });
fdb.seed('acknowledgments', 'ack2', { companyId: 'c1', employeeId: 'AC-boss', employeeEmail: 'boss@acme.com', status: 'PENDING' });

const BOSS = () => tokenFor('boss', [], true), HR = () => tokenFor('hr', ['users.manage', 'leave.manage']);
const upd = (h: any, body: any) => routeTenant({ method: 'POST', action: 'update-user', headers: h, body, origin: 'https://app.example' });
const ok = async (h: any, body: any) => { const r = await upd(h, body); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };

// admin changes a normal employee's email: login, record, acknowledgements and history all follow
let r = await ok(BOSS(), { userId: 'ann', email: '  Ann.New@Acme.com ' });
assert.equal(r.emailChanged, true);
assert.equal(users.get('ann')!.email, 'ann.new@acme.com');
const ann = fdb.all('employees').find((e) => e.id === 'ann')!;
assert.equal(ann.email, 'ann.new@acme.com'); assert.equal(ann.loginId, 'ann.new@acme.com');
assert.equal(ann.empId, 'AC-ann', 'employee id never changes');
assert.deepEqual(ann.emailHistory.map((h: any) => h.email), ['ann@acme.com']);
assert.equal(fdb.all('acknowledgments').find((a) => a.id === 'ack1')!.employeeEmail, 'ann.new@acme.com');
assert.equal(fdb.all('acknowledgments').find((a) => a.id === 'ack2')!.employeeEmail, 'boss@acme.com', 'other people untouched');
assert.equal(users.get('ann')!.revoked, 1, 'the person must sign in again with the new email');
assert.equal(r.invite, undefined, 'someone who has signed in gets a notice, not a new invite');

// a legacy login id that was not the email is left alone
await ok(BOSS(), { userId: 'legacy', email: 'legacy2@acme.com' });
assert.equal(fdb.all('employees').find((e) => e.id === 'legacy')!.loginId, 'AC-legacy-login');

// someone who never signed in gets a fresh invite at the new address
r = await ok(BOSS(), { userId: 'new', email: 'new2@acme.com' });
assert.ok(r.invite, 'pending invite is re-sent');
assert.ok(r.invite.emailed || r.invite.inviteLink === 'https://reset.example/new2@acme.com', 'invite is emailed, or its link is handed back when email is not configured');

// unchanged or same email (different case) is a no-op, not an error
r = await ok(BOSS(), { userId: 'ann', email: 'ANN.NEW@acme.com', title: 'Analyst' });
assert.equal(r.emailChanged, false);
assert.equal(fdb.all('employees').find((e) => e.id === 'ann')!.emailHistory.length, 1);
assert.equal(users.get('ann')!.revoked, 1);

// bad input and duplicates change nothing
assert.equal((await upd(BOSS(), { userId: 'ann', email: 'not-an-email' })).status, 400);
assert.equal((await upd(BOSS(), { userId: 'ann', email: '' })).status, 400);
const dup = await upd(BOSS(), { userId: 'ann', email: 'hr@acme.com' });
assert.equal(dup.status, 409);
assert.equal(users.get('ann')!.email, 'ann.new@acme.com');
assert.equal(fdb.all('employees').find((e) => e.id === 'ann')!.email, 'ann.new@acme.com');

// HR with users.manage may change an ordinary employee, but not an admin, nor someone with more access, nor a platform admin
assert.equal((await upd(HR(), { userId: 'boss', email: 'x@acme.com' })).status, 403);
assert.equal((await upd(HR(), { userId: 'founder', email: 'x@acme.com' })).status, 403);
assert.equal((await upd(HR(), { userId: 'pa', email: 'x@acme.com' })).status, 403);
assert.equal(users.get('boss')!.email, 'boss@acme.com'); assert.equal(users.get('founder')!.email, 'founder@acme.com'); assert.equal(users.get('pa')!.email, 'pa@acme.com');
await ok(HR(), { userId: 'ann', email: 'ann.hr@acme.com' });
assert.equal(users.get('ann')!.email, 'ann.hr@acme.com');
// other edits by HR on someone senior still work when the email is not touched
await ok(HR(), { userId: 'founder', title: 'Founder' });

// the admin changing their own email: stays signed in, and the company's admin email follows
r = await ok(BOSS(), { userId: 'boss', email: 'owner@acme.com' });
assert.equal(users.get('boss')!.revoked, 0, 'you are not signed out of your own session');
assert.equal(fdb.all('companies').find((c) => c.id === 'c1')!.adminEmail, 'owner@acme.com');
assert.equal(fdb.all('acknowledgments').find((a) => a.id === 'ack2')!.employeeEmail, 'owner@acme.com');

// a person of another company cannot be touched
fdb.seed('employees', 'other', { id: 'other', authUid: 'other', companyId: 'c2', email: 'o@x.com', roleIds: [], perms: [] }); addAuth('other', 'o@x.com');
assert.equal((await upd(BOSS(), { userId: 'other', email: 'z@x.com' })).status, 404);
assert.equal(users.get('other')!.email, 'o@x.com');
console.log('change email: ok');
