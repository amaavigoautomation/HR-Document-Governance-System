import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { addDays, cycleOf, istToday, weekday } from '../shared/leaveEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({
  db: fdb,
  auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) },
});

const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tokenFor('u_hr', ['leave.manage', 'leave.report']);
const MGR = tokenFor('u_mgr');
const EMP = tokenFor('u_emp');
const OTHER = tokenFor('u_other');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_hr', 'Hema HR'], ['u_mgr', 'Manu Manager'], ['u_emp', 'Esha Employee'], ['u_other', 'Omar Other']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops' });
}

const call = async (headers: any, method: string, action: string, body: any = {}, query: any = {}) => {
  const r = await routeLeave({ method, action, headers, body, query, ip: '1.2.3.4' });
  return r;
};
const ok = async (headers: any, method: string, action: string, body?: any, query?: any) => {
  const r = await call(headers, method, action, body, query);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`);
  return r.json;
};

const today = istToday();

// --- before setup
let me = await ok(EMP, 'GET', 'me');
assert.equal(me.configured, false);
assert.equal((await call(EMP, 'GET', 'settings')).status, 403, 'employees cannot read admin settings');

// --- HR sets up from the template (calendar year start to check non-default) and assigns people
await ok(HR, 'POST', 'apply-starter', { yearStartMonth: 4 });
await ok(HR, 'POST', 'save-profiles', { profiles: [
  { uid: 'u_emp', managerUid: 'u_mgr', gender: 'F', joinDate: '2020-01-01' },
  { uid: 'u_other', managerUid: 'u_mgr', joinDate: '2020-01-01' },
  { uid: 'u_mgr', joinDate: '2020-01-01' },
] });
assert.equal((await call(HR, 'POST', 'save-profiles', { profiles: [{ uid: 'u_emp', managerUid: 'u_emp' }] })).status, 400, 'own manager rejected');

// --- accrual is idempotent
const a1 = await ok(HR, 'POST', 'run-accrual');
assert.ok(a1.credits > 0);
const a2 = await ok(HR, 'POST', 'run-accrual');
assert.equal(a2.credits, 0, 'a second run credits nothing');

me = await ok(EMP, 'GET', 'me');
assert.equal(me.configured, true);
const cl = me.balances.find((b: any) => b.code === 'CL');
assert.ok(cl.balance > 0, 'casual leave credited');
const mat = me.balances.find((b: any) => b.code === 'MAT');
assert.equal(mat.eligible, true, 'female employee can see maternity');
assert.equal((await ok(MGR, 'GET', 'me')).balances.find((b: any) => b.code === 'MAT').eligible, false);

// --- apply for one working day at least a week ahead
let day = addDays(today, 9);
while (weekday(day) === 0 || weekday(day) === 6 || ['2026-10-02', '2027-01-26', '2026-08-15'].includes(day)) day = addDays(day, 1);
const clStart = cl.balance;
const applied = await ok(EMP, 'POST', 'apply', { typeId: 'cl', from: day, to: day, reason: 'family' });
assert.equal(applied.status, 'PENDING');
assert.equal(applied.days, 1);
assert.deepEqual(applied.steps, ['MANAGER']);
assert.equal((await call(EMP, 'POST', 'apply', { typeId: 'cl', from: day, to: day })).status, 409, 'overlap rejected');
const bad = await ok(EMP, 'POST', 'calc', { typeId: 'cl', from: addDays(day, 2), to: addDays(day, 40) });
assert.equal(bad.valid, false, 'over the 5-day limit');
assert.equal((await call(EMP, 'POST', 'apply', { typeId: 'mat', from: day, to: addDays(day, 1) })).status, 400, 'maternity needs docs');
assert.equal((await call(MGR, 'POST', 'apply', { typeId: 'mat', from: day, to: day })).status, 400, 'maternity not for men');

// pending requests reserve balance but do not change it yet
me = await ok(EMP, 'GET', 'me');
assert.equal(me.balances.find((b: any) => b.code === 'CL').pending, 1);
assert.equal(me.balances.find((b: any) => b.code === 'CL').balance, clStart);

// --- who sees the request
assert.equal((await ok(MGR, 'GET', 'inbox')).leaves.length, 1);
assert.equal((await ok(HR, 'GET', 'inbox')).leaves.length, 1);
assert.equal((await ok(EMP, 'GET', 'inbox')).leaves.length, 0, 'not your own');
assert.equal((await ok(OTHER, 'GET', 'inbox')).leaves.length, 0, 'peers do not see it');
const reqId = (await ok(MGR, 'GET', 'inbox')).leaves[0].id;
assert.equal((await call(EMP, 'POST', 'decide', { id: reqId, decision: 'APPROVE' })).status, 403, 'cannot approve own');
assert.equal((await call(OTHER, 'POST', 'decide', { id: reqId, decision: 'APPROVE' })).status, 403, 'a peer cannot approve');

// --- team calendar privacy: a peer sees that someone is away but not why
const cal = await ok(OTHER, 'GET', 'team-calendar', undefined, { from: day, to: day });
assert.equal(cal.items.length, 1);
assert.equal(cal.items[0].type, null);
assert.equal(cal.items[0].reason, null);
assert.equal((await ok(MGR, 'GET', 'team-calendar', undefined, { from: day, to: day })).items[0].type, 'Casual leave');

// --- manager approves: balance drops and the ledger records it
await ok(MGR, 'POST', 'decide', { id: reqId, decision: 'APPROVE', comment: 'ok' });
assert.equal((await call(MGR, 'POST', 'decide', { id: reqId, decision: 'APPROVE' })).status, 409, 'cannot decide twice');
me = await ok(EMP, 'GET', 'me');
assert.equal(me.balances.find((b: any) => b.code === 'CL').balance, clStart - 1);
assert.equal(me.balances.find((b: any) => b.code === 'CL').pending, 0);

// --- cancelling approved leave needs approval, then restores the balance
const c1 = await ok(EMP, 'POST', 'cancel', { id: reqId });
assert.equal(c1.status, 'CANCEL_REQUESTED');
assert.equal((await ok(MGR, 'GET', 'inbox')).leaves[0].stage, 'CANCEL');
await ok(MGR, 'POST', 'decide', { id: reqId, decision: 'APPROVE' });
me = await ok(EMP, 'GET', 'me');
assert.equal(me.balances.find((b: any) => b.code === 'CL').balance, clStart);
assert.equal((await ok(EMP, 'GET', 'my-requests')).items[0].status, 'CANCELLED');

// --- a rejected request costs nothing
const r2 = await ok(EMP, 'POST', 'apply', { typeId: 'cl', from: day, to: day });
await ok(MGR, 'POST', 'decide', { id: r2.id, decision: 'REJECT', comment: 'busy' });
assert.equal((await ok(EMP, 'GET', 'me')).balances.find((b: any) => b.code === 'CL').balance, clStart);

// --- two-step approval: earned leave goes to the manager, then HR
const el = await ok(EMP, 'POST', 'apply', { typeId: 'el', from: addDays(day, 14), to: addDays(day, 14) });
assert.deepEqual(el.steps, ['MANAGER', 'HR']);
await ok(MGR, 'POST', 'decide', { id: el.id, decision: 'APPROVE' });
assert.equal((await ok(MGR, 'GET', 'inbox')).leaves.length, 0, 'manager is done');
assert.equal((await ok(HR, 'GET', 'inbox')).leaves[0].stage, 'HR');
await ok(HR, 'POST', 'decide', { id: el.id, decision: 'APPROVE' });
assert.equal((await ok(EMP, 'GET', 'my-requests')).items.find((r: any) => r.id === el.id).status, 'APPROVED');

// --- HR can record leave on someone's behalf and cancel it
const hrMade = await ok(HR, 'POST', 'hr-create', { uid: 'u_other', typeId: 'sl', from: addDays(today, -3), to: addDays(today, -3), reason: 'sick' });
assert.ok(hrMade.id);
await ok(HR, 'POST', 'hr-cancel', { id: hrMade.id });

// --- adjustments and opening balances
await ok(HR, 'POST', 'adjust', { uid: 'u_emp', typeId: 'cl', delta: 2, note: 'bonus' });
assert.equal((await call(HR, 'POST', 'adjust', { uid: 'u_emp', typeId: 'cl', delta: 2, note: '' })).status, 400, 'note required');
assert.equal((await ok(EMP, 'GET', 'me')).balances.find((b: any) => b.code === 'CL').balance, clStart + 2);
const imp = await ok(HR, 'POST', 'import-balances', { rows: [{ email: 'u_other@acme.com', type: 'CO', balance: '3' }, { email: 'nobody@x.com', type: 'CO', balance: '1' }] });
assert.equal(imp.saved, 1);
assert.equal(imp.errors.length, 1);

// --- attendance
const ci = await ok(EMP, 'POST', 'check-in');
assert.ok(ci.time);
assert.equal((await call(EMP, 'POST', 'check-in')).status, 409, 'cannot check in twice');
assert.equal((await call(EMP, 'POST', 'check-out')).status, 409, 'too soon to check out');
const yesterday = addDays(today, -1);
const reg = await ok(EMP, 'POST', 'regularize', { date: yesterday, checkIn: '09:30', checkOut: '18:30', reason: 'forgot to swipe' });
assert.equal((await ok(MGR, 'GET', 'inbox')).regularizations.length, 1);
await ok(MGR, 'POST', 'decide-regularization', { id: reg.id, decision: 'APPROVE' });
const month = await ok(EMP, 'GET', 'attendance', undefined, { month: yesterday.slice(0, 7) });
const yd = month.days.find((d: any) => d.date === yesterday);
assert.ok(['PRESENT', 'WEEKLY_OFF', 'HOLIDAY'].includes(yd.status), `regularized day shows ${yd.status}`);
assert.equal(yd.checkIn, '09:30');
assert.equal((await call(OTHER, 'GET', 'attendance', undefined, { uid: 'u_emp' })).status, 403, 'peers cannot read your attendance');
assert.equal((await call(MGR, 'GET', 'attendance', undefined, { uid: 'u_emp' })).status, 200, 'manager can');
await ok(HR, 'POST', 'mark-attendance', { uid: 'u_other', date: yesterday, checkIn: '10:00', checkOut: '19:00' });

// --- reports are for HR only
assert.equal((await call(EMP, 'GET', 'report-attendance')).status, 403);
const rep = await ok(HR, 'GET', 'report-attendance', undefined, { month: yesterday.slice(0, 7) });
assert.equal(rep.rows.length, 4);
const brep = await ok(HR, 'GET', 'report-balances');
assert.ok(brep.types.length >= 3);

// --- year end: carry-forward cap and lapse, once only
const elType = 'el';
const prev = String(Number(cycleOf(today, 4).key) - 1);
fdb.seed('leaveLedger', 'TEST_PREV', { companyId: CID, uid: 'u_other', typeId: elType, cycle: prev, delta: 40, kind: 'OPENING', date: `${prev}-06-01`, createdAt: '2026-01-01T00:00:00Z' });
const roll = await ok(HR, 'POST', 'run-accrual');
assert.equal(roll.rollovers, 1);
const led = fdb.all('leaveLedger').filter((e) => e.uid === 'u_other' && e.typeId === elType);
assert.equal(led.filter((e) => e.cycle === prev).reduce((n, e) => n + e.delta, 0), 0, 'previous year closes at zero');
assert.equal(led.find((e) => e.kind === 'CARRY_IN')?.delta, 30, 'carry capped at 30');
assert.equal(led.find((e) => e.kind === 'LAPSE')?.delta, -10, 'the rest lapses');
assert.equal((await ok(HR, 'POST', 'run-accrual')).rollovers, 0, 'year end runs once');

// --- nothing leaks between companies
fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Eve', email: 'x1@other.com', active: true, createdAt: '2020-01-01T00:00:00Z' });
const other = { authorization: `Bearer ${Buffer.from(JSON.stringify({ uid: 'x1', email: 'x1@other.com', cid: 'c2', cs: 'ACTIVE', perms: ['leave.manage'] })).toString('base64')}` };
assert.equal((await ok(other, 'GET', 'me')).configured, false, 'another company sees no setup');
assert.equal((await call(other, 'GET', 'people')).json.items.length, 1);
assert.equal((await call(other, 'POST', 'decide', { id: reqId, decision: 'APPROVE' })).status, 404, 'cannot touch another company\'s request');

// --- cron (secret protected)
process.env.CRON_SECRET = 's3cret';
assert.equal((await call({}, 'GET', 'cron', {}, { key: 'wrong' })).status, 401);
assert.equal((await call({}, 'GET', 'cron', {}, { key: 's3cret' })).status, 200);

console.log('leave API flow tests passed');
