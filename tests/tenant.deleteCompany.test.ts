import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeTenant } from '../api/_lib/tenantAdmin.ts';

const fdb = new FakeFirestore();
const claims = new Map<string, any>();
const deletedUsers: string[] = [];
const tokenOf = (uid: string, pa = false) => Buffer.from(JSON.stringify({ uid, email: `${uid}@x.com`, pa })).toString('base64');
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUser: async (uid: string) => ({ uid, disabled: false, customClaims: claims.get(uid) || {} }),
    getUsers: async (ids: { uid: string }[]) => ({ users: ids.map(({ uid }) => ({ uid, customClaims: claims.get(uid) || {} })) }),
    setCustomUserClaims: async (uid: string, c: any) => { claims.set(uid, c); },
    updateUser: async () => {},
    deleteUsers: async (uids: string[]) => { deletedUsers.push(...uids); return { failureCount: 0, successCount: uids.length, errors: [] }; },
  },
});

const PA = { authorization: `Bearer ${tokenOf('platform', true)}` };
const NOT_PA = { authorization: `Bearer ${tokenOf('someone')}` };
const del = (headers: any, body: any) => routeTenant({ method: 'POST', action: 'delete-company', headers, body });

process.env.FIREBASE_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{"fake":true}';

const seedCompany = (id: string, name: string) => {
  fdb.seed('companies', id, { id, name, status: 'ACTIVE', modules: ['talent-acquisition'], adminEmail: `${id}@x.com`, employeeIdPrefix: 'AB', nextEmployeeNumber: 1 });
  fdb.seed('roles', `${id}_admin`, { id: `${id}_admin`, companyId: id, name: 'Admin', permissions: [], portal: 'CREATOR', isAdmin: true });
  for (const u of [`${id}_u1`, `${id}_u2`]) fdb.seed('employees', u, { id: u, authUid: u, companyId: id, roleIds: [`${id}_admin`], active: true, email: `${u}@x.com` });
  for (let i = 0; i < 450; i++) fdb.seed('leaveRequests', `${id}_r${i}`, { companyId: id });
  fdb.seed('payrollRuns', `${id}_run`, { companyId: id });
  fdb.seed('leaveSettings', id, { companyId: id, year: 'calendar' });
  fdb.seed('perfSettings', id, { companyId: id });
  fdb.seed('hiringItems', `${id}_h`, { companyId: id, kind: 'offer' });
};
seedCompany('cmp_a', 'Acme Ltd');
seedCompany('cmp_b', 'Beta Ltd');
// a second platform admin who also has an employee record in company A: their record goes, their login stays
fdb.seed('employees', 'pa2_emp', { id: 'pa2_emp', authUid: 'pa2', companyId: 'cmp_a', roleIds: [], active: true });
claims.set('pa2', { pa: true });
// the acting admin's own company cannot be deleted by them
fdb.seed('companies', 'cmp_self', { id: 'cmp_self', name: 'Self Co', status: 'ACTIVE', modules: [] });
fdb.seed('employees', 'platform_emp', { id: 'platform_emp', authUid: 'platform', companyId: 'cmp_self', roleIds: [], active: true });
assert.equal((await routeTenant({ method: 'POST', action: 'delete-company', headers: { authorization: `Bearer ${tokenOf('platform', true)}` }, body: { companyId: 'cmp_self', confirmName: 'Self Co' } })).status, 400);

// only platform admins; name must match
assert.equal((await del(NOT_PA, { companyId: 'cmp_a', confirmName: 'Acme Ltd' })).status, 403);
assert.equal((await del(PA, { companyId: 'cmp_a', confirmName: 'acme' })).status, 400);
assert.equal((await del(PA, { companyId: 'nope', confirmName: 'x' })).status, 404);

// home company is protected
process.env.HOME_COMPANY_ID = 'cmp_b';
assert.equal((await del(PA, { companyId: 'cmp_b', confirmName: 'Beta Ltd' })).status, 400);
process.env.HOME_COMPANY_ID = '';

// wipe company A (loops like the screen does); an already-expired budget forces the resumable, multi-call path
process.env.TENANT_PURGE_BUDGET_MS = '-1';
let r: any, rounds = 0;
do { r = await del(PA, { companyId: 'cmp_a', confirmName: 'Acme Ltd' }); assert.equal(r.status, 200, JSON.stringify(r.json)); rounds++; } while (!r.json.done && rounds < 20);
assert.equal(r.json.done, true);
assert.ok(rounds > 1, 'expected the delete to need more than one call');

for (const c of ['companies', 'roles', 'employees', 'leaveRequests', 'payrollRuns', 'leaveSettings', 'perfSettings', 'hiringItems']) {
  const left = fdb.all(c).filter((x) => x.companyId === 'cmp_a' || x.id === 'cmp_a');
  // the platform admin's own employee record is removed with the company, but its login is kept
  assert.equal(left.length, 0, `${c} still has ${left.length} records of the deleted company`);
}
assert.ok(!deletedUsers.includes('pa2'), 'platform admin login must never be deleted');
assert.deepEqual(deletedUsers.filter((u) => u.startsWith('cmp_a')).sort(), ['cmp_a_u1', 'cmp_a_u2']);
assert.equal(fdb.all('platformAudit').length, 1);
assert.equal(fdb.all('platformAudit')[0].companyName, 'Acme Ltd');

// company B is untouched
assert.equal(fdb.all('leaveRequests').filter((x) => x.companyId === 'cmp_b').length, 450);
assert.equal(fdb.all('employees').filter((x) => x.companyId === 'cmp_b').length, 2);
assert.equal(fdb.all('companies').filter((x) => x.id === 'cmp_b').length, 1);
assert.equal(fdb.all('leaveSettings').filter((x) => x.id === 'cmp_b').length, 1);
console.log(`delete company: ok (${rounds} round(s))`);
