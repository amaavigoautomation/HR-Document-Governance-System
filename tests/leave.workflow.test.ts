import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { addDays, istToday, weekday } from '../shared/leaveEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = []) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tokenFor('u_hr', ['leave.manage']);
const MGR = tokenFor('u_mgr');
const EMP = tokenFor('u_emp');
fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_hr', 'Hema HR'], ['u_mgr', 'Manu Manager'], ['u_emp', 'Esha Employee']]) {
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
console.log('leave workflow tests passed');
