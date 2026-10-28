import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { addDays, istToday, weekday } from '../shared/leaveEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const ADMIN = tokenFor('u_admin', [], true);
const HR = tokenFor('u_hr', ['leave.manage']);
const MGR = tokenFor('u_mgr');
const EMP = tokenFor('u_emp');
fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_admin', 'Ada Admin'], ['u_hr', 'Hema HR'], ['u_mgr', 'Manu Manager'], ['u_emp', 'Esha Employee']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z' });
}
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeLeave({ method, action, headers: h, body, query, ip: '1.2.3.4' });
const ok = async (h: any, method: string, action: string, body?: any, query?: any) => {
  const r = await call(h, method, action, body, query);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const today = istToday();
const workday = (from: number) => { let d = addDays(today, from); while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1); return d; };

await ok(HR, 'POST', 'apply-starter', { yearStartMonth: 1 });
await ok(HR, 'POST', 'save-profiles', { profiles: [
  { uid: 'u_emp', managerUid: 'u_mgr', gender: 'F', joinDate: '2020-01-01' }, { uid: 'u_mgr', joinDate: '2020-01-01' },
] });
await ok(HR, 'POST', 'run-accrual');

// --- two requests for the same day sent at the same moment: exactly one is created
const d1 = workday(12);
const [a, b] = await Promise.all([
  call(EMP, 'POST', 'apply', { typeId: 'cl', from: d1, to: d1, reason: 'one' }),
  call(EMP, 'POST', 'apply', { typeId: 'cl', from: d1, to: d1, reason: 'two' }),
]);
assert.deepEqual([a.status, b.status].sort(), [200, 409], 'one wins, the other is refused');
assert.equal((await ok(EMP, 'GET', 'my-requests')).items.length, 1);

// --- the same submission key never makes a second request
const d2 = workday(20);
const first = await ok(EMP, 'POST', 'apply', { typeId: 'cl', from: d2, to: d2, idempotencyKey: 'abc123' });
const again = await ok(EMP, 'POST', 'apply', { typeId: 'cl', from: d2, to: d2, idempotencyKey: 'abc123' });
assert.equal(first.id, again.id);
assert.equal((await ok(EMP, 'GET', 'my-requests')).items.length, 2);
assert.equal(first.policyVersion, 1, 'request records the policy version it was made under');

// --- manager asks a question: request is on hold, keeps its balance, and the employee replies
const reqId = a.status === 200 ? a.json.id : b.json.id;
assert.equal((await call(MGR, 'POST', 'decide', { id: reqId, decision: 'INFO' })).status, 400, 'a question needs text');
await ok(MGR, 'POST', 'decide', { id: reqId, decision: 'INFO', comment: 'Which day exactly?' });
let mine = (await ok(EMP, 'GET', 'my-requests')).items.find((r: any) => r.id === reqId);
assert.equal(mine.status, 'INFO_REQUESTED');
assert.equal((await ok(MGR, 'GET', 'inbox')).leaves.some((l: any) => l.id === reqId), false, 'on hold: not in the approver queue');
assert.equal((await ok(EMP, 'GET', 'me')).balances.find((x: any) => x.code === 'CL').pending, 2, 'still reserves the balance');
assert.equal((await call(MGR, 'POST', 'respond', { id: reqId, message: 'x' })).status, 404, 'only the employee can reply');
assert.equal((await call(EMP, 'POST', 'respond', { id: reqId, message: '' })).status, 400);
await ok(EMP, 'POST', 'respond', { id: reqId, message: 'The 12th day from today.' });
assert.equal((await ok(MGR, 'GET', 'inbox')).leaves.some((l: any) => l.id === reqId), true, 'back in the queue');
await ok(MGR, 'POST', 'decide', { id: reqId, decision: 'APPROVE' });
assert.equal((await call(EMP, 'POST', 'respond', { id: reqId, message: 'late' })).status, 409);

// --- withdrawing a pending request releases the reservation
await ok(EMP, 'POST', 'cancel', { id: first.id });
mine = (await ok(EMP, 'GET', 'my-requests')).items.find((r: any) => r.id === first.id);
assert.equal(mine.status, 'WITHDRAWN');
assert.equal((await ok(EMP, 'GET', 'me')).balances.find((x: any) => x.code === 'CL').pending, 0);

// --- emergency leave: no notice needed, flagged as provisional
const clType = (await ok(HR, 'GET', 'settings')).settings.types.find((t: any) => t.code === 'CL');
if (clType.minNoticeDays > 0) {
  const n = workday(0) === today ? today : workday(0);
  assert.equal((await call(EMP, 'POST', 'apply', { typeId: 'cl', from: n, to: n })).status, 400, 'normal leave needs notice');
  const em = await ok(EMP, 'POST', 'apply', { typeId: 'cl', from: n, to: n, emergency: true, reason: 'hospital' });
  assert.equal(em.emergency, true);
  assert.equal(em.status, 'PENDING');
}

// ================================================================ policy versions
let st = await ok(HR, 'GET', 'policy-state');
assert.equal(st.version, 1);
assert.equal(st.versions.length, 1);
assert.equal((await call(EMP, 'GET', 'policy-state')).status, 403, 'employees cannot see policy history');

// a real change through the direct save bumps the version and records what changed; a no-op does not
const live = (await ok(HR, 'GET', 'settings')).settings;
const same = await ok(HR, 'POST', 'save-settings', { settings: live });
assert.equal(same.version, 1, 'no change, no new version');
const tweaked = JSON.parse(JSON.stringify(live));
tweaked.policies[0].entries[0].quota += 3;
const saved = await ok(HR, 'POST', 'save-settings', { settings: tweaked });
assert.equal(saved.version, 2);
assert.ok(saved.changes.some((t: string) => /entitlement/.test(t)), 'change list explains the entitlement change');
st = await ok(HR, 'GET', 'policy-state');
assert.equal(st.version, 2);
assert.equal(st.versions.length, 2);

// an old approved request keeps the version it was made under
const oldReq = (await ok(EMP, 'GET', 'my-requests')).items[0];
assert.equal(oldReq.policyVersion, 1);

// with approval switched on, direct saves are refused and the draft flow is used
assert.equal((await call(HR, 'POST', 'policy-require', { value: true })).status, 403, 'only an admin switches approval on');
await ok(ADMIN, 'POST', 'policy-require', { value: true });
assert.equal((await call(HR, 'POST', 'save-settings', { settings: tweaked })).status, 409);
const edit = JSON.parse(JSON.stringify(tweaked));
edit.policies[0].entries[0].quota += 2;
assert.equal((await call(HR, 'POST', 'policy-draft-save', { settings: tweaked })).status, 400, 'identical to live: nothing to approve');
const ds = await ok(HR, 'POST', 'policy-draft-save', { settings: edit, governanceRef: '', effectiveFrom: today });
assert.ok(ds.impact.people >= 1, 'impact counts the people on the changed policy');
assert.equal((await call(HR, 'POST', 'policy-submit')).status, 400, 'needs the governance document reference');
await ok(HR, 'POST', 'policy-draft-save', { settings: edit, governanceRef: 'AMA-HR-LEAVE-001 v2', effectiveFrom: today });
await ok(HR, 'POST', 'policy-submit');
assert.equal((await call(HR, 'POST', 'policy-decide', { decision: 'APPROVE' })).status, 403, 'HR cannot approve');
await ok(ADMIN, 'POST', 'policy-decide', { decision: 'REJECT', comment: 'Use the signed copy' });
assert.equal((await ok(HR, 'GET', 'policy-state')).draft.status, 'DRAFT');
assert.equal((await ok(HR, 'GET', 'policy-state')).draft.returnedNote, 'Use the signed copy');
await ok(HR, 'POST', 'policy-submit');
const pub = await ok(ADMIN, 'POST', 'policy-decide', { decision: 'APPROVE' });
assert.equal(pub.status, 'PUBLISHED');
st = await ok(HR, 'GET', 'policy-state');
assert.equal(st.version, 3);
assert.equal(st.draft, null);
assert.equal(st.governanceRef, 'AMA-HR-LEAVE-001 v2');
assert.ok((await ok(HR, 'GET', 'policy-version', undefined, { v: '3' })).version.settings.policies.length > 0);

// a future-dated change waits for its date
const future = JSON.parse(JSON.stringify(edit));
future.policies[0].entries[0].quota += 1;
await ok(HR, 'POST', 'policy-draft-save', { settings: future, governanceRef: 'AMA-HR-LEAVE-001 v3', effectiveFrom: addDays(today, 30) });
await ok(HR, 'POST', 'policy-submit');
assert.equal((await ok(ADMIN, 'POST', 'policy-decide', { decision: 'APPROVE' })).status, 'SCHEDULED');
assert.equal((await ok(HR, 'GET', 'policy-state')).version, 3, 'not live yet');

// every policy event is in the company audit trail
assert.ok(fdb.all('leaveAudit').some((a) => a.action === 'POLICY_PUBLISHED'));
console.log('leave workflow tests passed');
