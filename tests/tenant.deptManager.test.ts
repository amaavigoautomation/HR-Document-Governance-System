import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';

delete process.env.SMTP_USER; delete process.env.SMTP_PASS;

const fdb = new FakeFirestore();
const users = new Map<string, { uid: string; email: string; claims: any }>();
const tokenFor = (uid: string) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: users.get(uid)!.email, cid: 'c1', cs: 'ACTIVE', perms: [], adm: true })).toString('base64')}` });
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => ({ uid, email: users.get(uid)!.email, disabled: false, customClaims: users.get(uid)!.claims, metadata: { lastSignInTime: '2026-11-01' } }),
    getUserByEmail: async () => { throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); },
    updateUser: async () => undefined,
    setCustomUserClaims: async (uid: string, c: any) => { users.get(uid)!.claims = c; },
    revokeRefreshTokens: async () => undefined,
  },
});
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';

fdb.seed('companies', 'c1', { id: 'c1', name: 'Acme', status: 'ACTIVE', modules: [], adminEmail: 'boss@acme.com', employeeIdPrefix: 'AC', nextEmployeeNumber: 9 });
fdb.seed('roles', 'c1_admin', { id: 'c1_admin', companyId: 'c1', name: 'admin', permissions: [], portal: 'CREATOR', isAdmin: true });
fdb.seed('roles', 'c1_employee', { id: 'c1_employee', companyId: 'c1', name: 'employee', permissions: ['doc.acknowledge'], portal: 'EMPLOYEE', isAdmin: false });
fdb.seed('departments', 'd1', { id: 'd1', companyId: 'c1', name: 'Engineering', headUserId: '' });
fdb.seed('departments', 'd2', { id: 'd2', companyId: 'c1', name: 'Sales', headUserId: '' });
const emp = (uid: string, dept: string, roleIds = ['c1_employee']) => {
  users.set(uid, { uid, email: `${uid}@acme.com`, claims: {} });
  fdb.seed('employees', uid, { id: uid, authUid: uid, companyId: 'c1', companyName: 'Acme', empId: `AC-${uid}`, loginId: `${uid}@acme.com`, name: uid, email: `${uid}@acme.com`, roleIds, perms: [], active: true, departmentId: dept, departmentName: dept === 'd1' ? 'Engineering' : dept === 'd2' ? 'Sales' : '' });
};
emp('boss', '', ['c1_admin']);
for (const u of ['h1', 'h2', 'm1', 'm2', 'm4', 'm5']) emp(u, 'd1');
emp('s1', 'd2'); emp('hr', '');

const BOSS = () => tokenFor('boss');
const call = async (action: string, body: any = {}) => { const r = await routeTenant({ method: 'POST', action, headers: BOSS(), body, origin: 'https://app.example' }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json; };
const mgr = (uid: string) => (fdb.all('leaveProfiles').find((p) => p.uid === uid)?.managerUid as string | undefined) || '';
const flag = (uid: string) => fdb.all('leaveProfiles').find((p) => p.uid === uid)?.managerManual;
const head = async (dept: string, headUserId: string) => call('save-department', { departmentId: dept, name: dept === 'd1' ? 'Engineering' : 'Sales', headUserId });

// legacy: m4 had a manager picked by hand before this rule existed (no flag); m2 is picked by hand on purpose
fdb.seed('leaveProfiles', 'c1__m4', { uid: 'm4', companyId: 'c1', managerUid: 'hr' });

// 1. a head is named: the department's people report to them, the head's own line is untouched, hand-picked lines are kept
await head('d1', 'h1');
for (const u of ['m1', 'm2', 'm5', 'h2']) assert.equal(mgr(u), 'h1', `${u} reports to the head`);
assert.equal(flag('m1'), false, 'automatic lines are marked automatic');
assert.equal(mgr('h1'), '', 'the head does not report to themselves');
assert.equal(mgr('m4'), 'hr', 'a manager that was picked before this rule is kept');
assert.equal(mgr('s1'), '', 'other departments are untouched');

// 2. a hand-picked manager (the admin chooses one) sticks through head changes
fdb.seed('leaveProfiles', 'c1__m2', { uid: 'm2', companyId: 'c1', managerUid: 'hr', managerManual: true });

// 3. the head changes to someone who currently reports to the old head: no loop, everyone follows
await head('d1', 'h2');
for (const u of ['m1', 'm5', 'h1']) assert.equal(mgr(u), 'h2', `${u} follows the new head`);
assert.equal(mgr('h2'), '', 'the new head is no longer under the old head, so there is no loop');
assert.equal(mgr('m2'), 'hr', 'hand-picked manager stays');
assert.equal(mgr('m4'), 'hr');

// 4. moving to another department switches to that department's head
await head('d2', 'boss');
assert.equal(mgr('s1'), 'boss', 'setting the head applies to the whole department');
const r = await call('update-user', { userId: 'm1', departmentId: 'd2' });
assert.equal(mgr('m1'), 'boss', 'moved person now reports to the new head');
await call('update-user', { userId: 'm1', departmentId: 'd1' });
assert.equal(mgr('m1'), 'h2', 'and back again');
assert.ok(r.success);

// 5. dropping the head leaves automatic lines empty, not wrong
await head('d1', '');
assert.equal(mgr('m1'), ''); assert.equal(mgr('m5'), ''); assert.equal(mgr('h1'), '');
assert.equal(mgr('m2'), 'hr', 'hand-picked stays');

// 6. the bulk action fills everyone in and is repeatable
await head('d1', 'h1');
fdb.all('leaveProfiles').forEach((p) => { if (p.uid === 'm5') fdb.seed('leaveProfiles', `c1__m5`, { uid: 'm5', companyId: 'c1', managerUid: '', managerManual: false }); });
const first = await call('sync-managers');
assert.equal(mgr('m5'), 'h1');
const again = await call('sync-managers');
assert.equal(again.updated, 0, 'nothing left to change');
assert.ok(first.updated >= 0);

// 7. an inactive head is not a manager
await call('update-user', { userId: 'h1', active: false });
assert.equal(mgr('m1'), '', 'members of a department whose head is switched off have no automatic manager');
await call('update-user', { userId: 'h1', active: true });
assert.equal(mgr('m1'), 'h1', 'and get them back when the head returns');

console.log('tenant.deptManager OK');
