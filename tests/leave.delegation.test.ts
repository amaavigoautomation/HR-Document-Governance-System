import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { addDays, istToday, weekday } from '../shared/leaveEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });

const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = []) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm: false })).toString('base64')}` });
const HR = tokenFor('u_hr', ['leave.manage', 'leave.report']);
const MGR = tokenFor('u_mgr');
const EMP = tokenFor('u_emp');
const DEL = tokenFor('u_del');
const OTHER = tokenFor('u_other');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_hr', 'Hema HR'], ['u_mgr', 'Manu Manager'], ['u_emp', 'Esha Employee'], ['u_del', 'Dee Delegate'], ['u_other', 'Omar Other']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops' });
}
const call = (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLeave({ method, action, headers, body, query, ip: '1.2.3.4' });
const ok = async (headers: any, method: string, action: string, body?: any, query?: any) => {
  const r = await call(headers, method, action, body, query);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`);
  return r.json;
};

const today = istToday();
await ok(HR, 'POST', 'apply-starter', { yearStartMonth: 1 });
await ok(HR, 'POST', 'save-profiles', { profiles: [
  { uid: 'u_emp', managerUid: 'u_mgr', joinDate: '2020-01-01' },
  { uid: 'u_del', managerUid: 'u_mgr', joinDate: '2020-01-01' },
  { uid: 'u_other', joinDate: '2020-01-01' },
  { uid: 'u_mgr', joinDate: '2020-01-01' },
] });
await ok(HR, 'POST', 'run-accrual');

const workday = (from: number) => {
  let d = addDays(today, from);
  while (weekday(d) === 0 || weekday(d) === 6 || ['2026-10-02', '2027-01-26', '2026-08-15'].includes(d)) d = addDays(d, 1);
  return d;
};

// --- who can set a delegate
assert.equal((await call(EMP, 'POST', 'set-delegation', { delegateUid: 'u_del', from: today, to: today })).status, 403, 'only managers');
assert.equal((await call(MGR, 'POST', 'set-delegation', { delegateUid: 'u_mgr', from: today, to: today })).status, 400, 'not yourself');
assert.equal((await call(MGR, 'POST', 'set-delegation', { delegateUid: 'u_del', from: addDays(today, -1), to: today })).status, 400, 'not in the past');
assert.equal((await call(MGR, 'POST', 'set-delegation', { delegateUid: 'u_del', from: addDays(today, 3), to: today })).status, 400, 'end before start');
assert.equal((await call(MGR, 'POST', 'set-delegation', { delegateUid: 'u_del', from: today, to: addDays(today, 200) })).status, 400, 'too long');
assert.equal((await call(MGR, 'POST', 'set-delegation', { delegateUid: 'nobody', from: today, to: today })).status, 404, 'unknown person');
assert.equal((await call(MGR, 'POST', 'set-delegation', { managerUid: 'u_emp', delegateUid: 'u_del', from: today, to: today })).status, 403, 'a manager cannot set it for someone else');

// --- a request waits for the manager; strangers and delegates-to-be cannot touch it
await ok(EMP, 'POST', 'apply', { typeId: 'cl', from: workday(9), to: workday(9), reason: 'family' });
const reqId = (await ok(MGR, 'GET', 'inbox')).leaves[0].id;
assert.equal((await ok(DEL, 'GET', 'inbox')).leaves.length, 0, 'a colleague sees nothing');
assert.equal((await call(DEL, 'POST', 'decide', { id: reqId, decision: 'APPROVE' })).status, 403);
assert.equal((await ok(DEL, 'GET', 'me')).isDelegate, false);

// --- delegation for a later week does not give access today
await ok(MGR, 'POST', 'set-delegation', { delegateUid: 'u_del', from: addDays(today, 5), to: addDays(today, 8) });
assert.equal((await call(DEL, 'POST', 'decide', { id: reqId, decision: 'APPROVE' })).status, 403, 'not active yet');
assert.equal((await ok(DEL, 'GET', 'me')).isDelegate, false);
const later = await ok(DEL, 'GET', 'delegation');
assert.equal(later.covering.length, 1, 'the delegate can see the upcoming cover');

// --- active delegation: delegate sees and decides
await ok(MGR, 'POST', 'set-delegation', { delegateUid: 'u_del', from: today, to: addDays(today, 3) });
const info = await ok(MGR, 'GET', 'delegation');
assert.equal(info.mine.delegateName, 'Dee Delegate');
assert.equal(info.canSet, true);
assert.equal((await ok(EMP, 'GET', 'delegation')).canSet, false);
const dme = await ok(DEL, 'GET', 'me');
assert.equal(dme.isDelegate, true);
assert.equal(dme.approvals, 1, 'the cover shows in the approvals count');
const dinbox = await ok(DEL, 'GET', 'inbox');
assert.equal(dinbox.leaves.length, 1);
assert.equal(dinbox.leaves[0].coveringFor, 'Manu Manager');
assert.equal((await ok(MGR, 'GET', 'inbox')).leaves.length, 1, 'the manager can still act');

// the delegate cannot approve their own request
await ok(DEL, 'POST', 'apply', { typeId: 'cl', from: workday(14), to: workday(14), reason: 'own' });
const own = (await ok(MGR, 'GET', 'inbox')).leaves.find((l: any) => l.uid === 'u_del');
assert.ok(own, 'delegate request waits for the manager');
assert.equal((await call(DEL, 'POST', 'decide', { id: own.id, decision: 'APPROVE' })).status, 403, 'no self approval');
assert.equal((await ok(DEL, 'GET', 'inbox')).leaves.some((l: any) => l.uid === 'u_del'), false);

await ok(DEL, 'POST', 'decide', { id: reqId, decision: 'APPROVE', comment: 'ok' });
const done = fdb.all('leaveRequests').find((r) => r.id === reqId);
assert.equal(done.status, 'APPROVED');
assert.equal(done.steps[0].byName, 'Dee Delegate (covering for Manu Manager)', 'the trail says who covered');
assert.ok(done.events.some((e: any) => e.message.startsWith('Approved') && e.by === 'Dee Delegate (covering for Manu Manager)'));

// attendance corrections too
fdb.seed('leaveRegularizations', 'reg1', { id: 'reg1', companyId: CID, uid: 'u_emp', email: 'u_emp@acme.com', managerUid: 'u_mgr', status: 'PENDING', date: addDays(today, -1), checkIn: '09:30', checkOut: '18:30', reason: 'forgot', createdAt: new Date().toISOString() });
assert.equal((await ok(DEL, 'GET', 'inbox')).regularizations.length, 1);
assert.equal((await ok(OTHER, 'GET', 'inbox')).regularizations.length, 0);
assert.equal((await call(OTHER, 'POST', 'decide-regularization', { id: 'reg1', decision: 'APPROVE' })).status, 403);
await ok(DEL, 'POST', 'decide-regularization', { id: 'reg1', decision: 'APPROVE' });
assert.equal(fdb.all('leaveRegularizations').find((r) => r.id === 'reg1').decidedBy, 'Dee Delegate (covering for Manu Manager)');

// --- stopping the cover removes access
await ok(MGR, 'POST', 'clear-delegation');
assert.equal((await ok(MGR, 'GET', 'delegation')).mine, null);
assert.equal((await ok(DEL, 'GET', 'me')).isDelegate, false);
assert.equal((await ok(DEL, 'GET', 'inbox')).leaves.length, 0);

// --- HR can set it for a manager and sees all
await ok(HR, 'POST', 'set-delegation', { managerUid: 'u_mgr', delegateUid: 'u_other', from: today, to: today });
const hrView = await ok(HR, 'GET', 'delegation');
assert.equal(hrView.all.length, 1);
assert.equal((await call(EMP, 'POST', 'clear-delegation', { managerUid: 'u_mgr' })).status, 403, 'staff cannot clear a manager\'s cover');
await ok(HR, 'POST', 'clear-delegation', { managerUid: 'u_mgr' });
assert.equal((await ok(HR, 'GET', 'delegation')).all.length, 0);

// --- manager on leave with no delegate: the request is flagged and sent to HR
fdb.seed('leaveRequests', 'away1', { id: 'away1', companyId: CID, uid: 'u_mgr', name: 'Manu Manager', email: 'u_mgr@acme.com', managerUid: '', typeId: 'cl', typeName: 'Casual', typeCode: 'CL', requiresBalance: true, from: today, to: today, halfFrom: false, halfTo: false, days: 1, detail: [{ date: today, value: 1 }], byCycle: {}, reason: '', docUrl: '', status: 'APPROVED', steps: [], stepIndex: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [] });
await ok(HR, 'POST', 'save-profiles', { profiles: [{ uid: 'u_other', managerUid: 'u_mgr', joinDate: '2020-01-01' }] });
await ok(OTHER, 'POST', 'apply', { typeId: 'cl', from: workday(21), to: workday(21), reason: 'trip' });
const pend = (await ok(HR, 'GET', 'inbox')).leaves.find((l: any) => l.uid === 'u_other');
assert.equal(pend.managerAway, true, 'HR sees the manager is away');
const stored = fdb.all('leaveRequests').find((r) => r.id === pend.id);
assert.ok(stored.events.some((e: any) => /on leave and has no delegate/.test(e.message)), 'the history says why it went to HR');

console.log('delegation tests passed');
