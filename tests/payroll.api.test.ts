import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';
import { addDays, istToday } from '../shared/leaveEngine.ts';
import { daysInMonth, r2 } from '../shared/payrollEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({
  db: fdb,
  auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) },
});

const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tokenFor('u_hr', ['leave.manage', 'leave.report']);
const PM = tokenFor('u_pm', ['payroll.manage']);
const PV = tokenFor('u_pv', ['payroll.view']);
const EMP = tokenFor('u_emp');
const OTHER = tokenFor('u_other');
const LOW = tokenFor('u_low');

// the previous month has ended, so a run can be approved without forcing
const lastOfPrev = addDays(istToday().slice(0, 8) + '01', -1);
const MONTH = lastOfPrev.slice(0, 7);
const MD = daysInMonth(MONTH);
const nextMonthStart = addDays(lastOfPrev, 1);

fdb.seed('companies', CID, { name: 'Acme Ltd' });
const people: [string, string][] = [
  ['u_hr', 'Hema HR'], ['u_pm', 'Pia Payroll'], ['u_pv', 'Vik Viewer'], ['u_emp', 'Esha Employee'], ['u_other', 'Omar Other'],
  ['u_low', 'Lal Low'], ['u_new', 'Nia New'], ['u_none', 'Nora NoStructure'],
];
for (const [uid, name] of people) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid.toUpperCase() });
}

const call = (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routePayroll({ method, action, headers, body, query });
const ok = async (headers: any, method: string, action: string, body?: any, query?: any) => {
  const r = await call(headers, method, action, body, query);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const lcall = (headers: any, method: string, action: string, body: any = {}) => routeLeave({ method, action, headers, body, query: {}, ip: '1.2.3.4' });

// ---------------------------------------------------------------- access
assert.equal((await call(EMP, 'GET', 'settings')).status, 403, 'employees cannot read payroll setup');
assert.equal((await call(EMP, 'GET', 'structures')).status, 403);
assert.equal((await call(PV, 'POST', 'apply-starter')).status, 403, 'view permission cannot change anything');
assert.equal((await call({}, 'GET', 'me')).status, 401);
let me = await ok(EMP, 'GET', 'me');
assert.equal(me.canManage, false);
assert.equal(me.canView, false);
assert.equal((await ok(PM, 'GET', 'me')).canManage, true);
assert.equal((await ok(PV, 'GET', 'me')).canView, true);
assert.equal((await ok(tokenFor('x', [], true), 'GET', 'me')).canManage, true, 'company admin can manage');

// ---------------------------------------------------------------- leave setup (join dates, one unpaid leave)
await lcall(HR, 'POST', 'apply-starter', { yearStartMonth: 4 });
const joinNew = `${MONTH}-11`;
await lcall(HR, 'POST', 'save-profiles', { profiles: [
  { uid: 'u_emp', joinDate: '2020-01-01', gender: 'F' }, { uid: 'u_other', joinDate: '2020-01-01' }, { uid: 'u_low', joinDate: '2020-01-01' },
  { uid: 'u_new', joinDate: joinNew }, { uid: 'u_none', joinDate: '2020-01-01' },
] });
fdb.seed('leaveRequests', 'r1', {
  id: 'r1', companyId: CID, uid: 'u_other', typeId: 'lop', status: 'APPROVED', from: `${MONTH}-10`, to: `${MONTH}-11`,
  detail: [{ date: `${MONTH}-10`, value: 1 }, { date: `${MONTH}-11`, value: 0.5 }], createdAt: '2020-01-01T00:00:00Z',
});

// ---------------------------------------------------------------- payroll setup
assert.equal((await call(PM, 'POST', 'save-structure', { uid: 'u_emp', amounts: { basic: 1 } })).status, 409, 'components first');
await ok(PM, 'POST', 'apply-starter');
assert.equal((await call(PM, 'POST', 'apply-starter')).status, 409, 'starter only once');
const st = await ok(PV, 'GET', 'settings');
assert.equal(st.settings.company.legalName, 'Acme Ltd');
assert.ok(st.settings.components.some((c: any) => c.isBasic));

const split = await ok(PM, 'POST', 'split-ctc', { annualCtc: 600000 });
assert.equal(split.amounts.basic, 25000);

// salaries: one by hand, the rest by CSV rows
await ok(PM, 'POST', 'save-structure', { uid: 'u_emp', amounts: split.amounts, annualCtc: 600000, state: 'Maharashtra', bankAccount: '1234567890', ifsc: 'HDFC0001', bankName: 'HDFC' });
const imp = await ok(PM, 'POST', 'import-structures', { rows: [
  { email: 'u_other@acme.com', BASIC: '30000', HRA: '12000', SPL: '8000', state: 'Maharashtra', TDS: '1000' },
  { email: 'u_low@acme.com', BASIC: '9000', HRA: '3000', SPL: '3000', state: 'Maharashtra', uan: '1000', esic_no: 'E1' },
  { email: 'u_new@acme.com', annual_ctc: '600000', state: 'Gujarat' },
  { email: 'nobody@acme.com', BASIC: '1' },
  { email: 'u_emp@acme.com', BASIC: 'abc' },
] });
assert.equal(imp.saved, 3);
assert.equal(imp.errors.length, 2);
assert.ok(imp.errors[0].error.includes('No employee'));
const stOf = await ok(PV, 'GET', 'structure', {}, { uid: 'u_new' });
assert.equal(stOf.structure.amounts.basic, 25000, 'annual_ctc was split with the template');
const list = await ok(PV, 'GET', 'structures');
assert.equal(list.rows.find((r: any) => r.uid === 'u_none').hasStructure, false);
assert.equal(list.rows.find((r: any) => r.uid === 'u_other').monthlyGross, 50000);
assert.ok(!JSON.stringify(list).includes('1234567890'), 'bank numbers are not in the list');
const hist = await ok(PM, 'POST', 'save-structure', { uid: 'u_emp', amounts: split.amounts, annualCtc: 600000 });
assert.ok(hist.success);
assert.equal((await ok(PV, 'GET', 'structure', {}, { uid: 'u_emp' })).structure.history.length, 1, 'edits are kept in history');

// ---------------------------------------------------------------- phase 1: inputs
const inp = await ok(PV, 'GET', 'inputs', undefined, { month: MONTH });
const row = (uid: string) => inp.rows.find((r: any) => r.uid === uid);
assert.equal(row('u_other').lop.unpaidLeave, 1.5);
assert.equal(row('u_other').paidDays, r2(MD - 1.5));
assert.equal(row('u_emp').paidDays, MD, 'LEAVE_ONLY mode ignores missing attendance');
assert.equal(row('u_new').preJoinDays, 10);
assert.equal(row('u_new').paidDays, MD - 10);
assert.equal(row('u_none').hasStructure, false);

// leave encashment recorded in the leave module for this month
await lcall(HR, 'POST', 'adjust', { uid: 'u_emp', typeId: 'el', delta: 1, kind: 'ENCASH', note: 'year end', date: `${MONTH}-15` });
assert.equal((await ok(PV, 'GET', 'inputs', undefined, { month: MONTH })).rows.find((r: any) => r.uid === 'u_emp').encashDays, 1);

// ---------------------------------------------------------------- adjustments and loans
assert.equal((await call(PV, 'POST', 'save-adjustment', { uid: 'u_emp', month: MONTH, label: 'Bonus', amount: 5000 })).status, 403);
await ok(PM, 'POST', 'save-adjustment', { uid: 'u_emp', month: MONTH, kind: 'EARNING', label: 'Bonus', amount: 5000 });
const dAdj = await ok(PM, 'POST', 'save-adjustment', { uid: 'u_other', month: MONTH, kind: 'DEDUCTION', label: 'Wrong entry', amount: 100 });
await ok(PM, 'POST', 'delete-adjustment', { id: dAdj.id });
assert.equal((await ok(PV, 'GET', 'adjustments', undefined, { month: MONTH })).items.length, 1);
assert.equal((await call(PM, 'POST', 'save-loan', { uid: 'u_other', principal: 1000, installment: 5000 })).status, 400);
await ok(PM, 'POST', 'save-loan', { uid: 'u_other', label: 'Laptop loan', principal: 3000, installment: 2000 });

// ---------------------------------------------------------------- phases 2-3: run lifecycle
assert.equal((await call(PM, 'POST', 'approve', { month: MONTH, expectedNet: 1 })).status, 409, 'nothing calculated yet');
const calc = await ok(PM, 'POST', 'calculate', { month: MONTH });
assert.equal(calc.run.status, 'DRAFT');
assert.equal(calc.lines.length, 4, 'four people have a structure');
assert.ok(calc.run.skipped.some((s: any) => s.name === 'Nora NoStructure'));
const lineOf = (lines: any[], uid: string) => lines.find((l) => l.uid === uid);

const esha = lineOf(calc.lines, 'u_emp').line;
assert.equal(esha.encashment.days, 1);
assert.equal(esha.encashment.amount, 833.33);
assert.equal(esha.gross, 50000 + 833.33 + 5000);
assert.equal(esha.statutory.pfEmployee, 1800);
assert.equal(esha.statutory.pt, 200, 'female above 25,000 in Maharashtra');
assert.equal(esha.net, r2(esha.gross - esha.totalDeductions));
assert.ok(!JSON.stringify(calc.lines).includes('1234567890'), 'run lines do not expose full account numbers');
assert.equal(lineOf(calc.lines, 'u_emp').employee.bankAccountMasked, 'XXXXXX7890');

const omar = lineOf(calc.lines, 'u_other').line;
assert.equal(omar.deductions.find((d: any) => d.code === 'TDS').amount, 1000);
assert.equal(omar.loans[0].amount, 2000);
assert.equal(omar.paidDays, r2(MD - 1.5));
assert.ok(omar.gross < 50000);

const nia = lineOf(calc.lines, 'u_new').line;
assert.equal(nia.paidDays, MD - 10);
assert.equal(lineOf(calc.lines, 'u_low').line.statutory.esicEmployee, 113);

const total = calc.run.totals.net;
assert.equal(total, r2(calc.lines.reduce((n: number, l: any) => n + l.line.net, 0)));

// a manual change needs a note and is kept across recalculation
assert.equal((await call(PM, 'POST', 'set-override', { month: MONTH, uid: 'u_low', lopDelta: 2 })).status, 400);
const ov = await ok(PM, 'POST', 'set-override', { month: MONTH, uid: 'u_low', lopDelta: 2, note: 'unrecorded absence' });
assert.equal(lineOf(ov.lines, 'u_low').line.paidDays, MD - 2);
const again = await ok(PM, 'POST', 'calculate', { month: MONTH });
assert.equal(lineOf(again.lines, 'u_low').line.paidDays, MD - 2, 'override survives recalculation');

// approval needs the total that was reviewed
const net = again.run.totals.net;
assert.equal((await call(PM, 'POST', 'approve', { month: MONTH, expectedNet: net + 100 })).status, 409, 'changed figures are refused');
assert.equal((await call(PV, 'POST', 'approve', { month: MONTH, expectedNet: net })).status, 403);

// employees cannot see a payslip before the run is locked
assert.equal((await call(EMP, 'GET', 'payslip', {}, { month: MONTH })).status, 404);
assert.equal((await ok(EMP, 'GET', 'my-payslips')).items.length, 0);

const approved = await ok(PM, 'POST', 'approve', { month: MONTH, expectedNet: net });
assert.equal(approved.run.status, 'APPROVED');
assert.ok(approved.run.events.some((e: any) => e.action === 'APPROVED'));
assert.equal((await call(PM, 'POST', 'calculate', { month: MONTH })).status, 409, 'approved runs do not recalculate');
assert.equal((await call(PM, 'POST', 'save-adjustment', { uid: 'u_emp', month: MONTH, label: 'Late', amount: 1 })).status, 409, 'no changes once approved');
assert.equal((await call(PM, 'POST', 'delete-run', { month: MONTH })).status, 409);

// reopen, then approve again
await ok(PM, 'POST', 'reopen', { month: MONTH });
assert.equal((await ok(PV, 'GET', 'run', undefined, { month: MONTH })).run.status, 'DRAFT');
await ok(PM, 'POST', 'approve', { month: MONTH, expectedNet: net });

assert.equal((await call(PM, 'POST', 'mark-paid', { month: MONTH })).status, 409, 'lock first');
const loanBefore = (await ok(PV, 'GET', 'loans')).items[0];
assert.equal(loanBefore.balance, 3000);
const locked = await ok(PM, 'POST', 'lock', { month: MONTH });
assert.equal(locked.run.status, 'LOCKED');
const loanAfter = (await ok(PV, 'GET', 'loans')).items[0];
assert.equal(loanAfter.balance, 1000, 'the instalment came off the loan once');
assert.deepEqual(loanAfter.appliedMonths, [MONTH]);
assert.equal((await call(PM, 'POST', 'reopen', { month: MONTH })).status, 409, 'locked runs stay locked');
assert.equal((await call(PM, 'POST', 'save-adjustment', { uid: 'u_emp', month: MONTH, label: 'x', amount: 1 })).status, 409);

// payslips: own after lock, never someone else's
const mine = await ok(EMP, 'GET', 'my-payslips');
assert.equal(mine.items.length, 1);
assert.equal(mine.items[0].net, esha.net);
const slip = await ok(EMP, 'GET', 'payslip', undefined, { month: MONTH });
assert.equal(slip.line.net, esha.net);
assert.equal(slip.company.legalName, 'Acme Ltd');
assert.equal((await call(EMP, 'GET', 'payslip', {}, { month: MONTH, uid: 'u_other' })).status, 403, 'cannot read a colleague payslip');
assert.equal((await call(OTHER, 'GET', 'payslip', {}, { month: MONTH, uid: 'u_emp' })).status, 403);
assert.equal((await call(tokenFor('u_none'), 'GET', 'payslip', {}, { month: MONTH })).status, 404, 'no line for a person outside the run');
assert.equal((await ok(PV, 'GET', 'payslip', undefined, { month: MONTH, uid: 'u_other' })).line.loans.length, 1, 'payroll viewer can open any payslip');
assert.equal((await ok(LOW, 'GET', 'my-payslips')).items.length, 1);

// exports
const bank = await ok(PM, 'GET', 'export', undefined, { month: MONTH, kind: 'bank' });
assert.ok(bank.rows.some((r: any[]) => r[3] === '1234567890'), 'bank file carries the full account number');
assert.equal((await ok(PM, 'GET', 'export', undefined, { month: MONTH, kind: 'pf' })).rows.length >= 3, true);
assert.equal((await ok(PM, 'GET', 'export', undefined, { month: MONTH, kind: 'register' })).rows.length, 4);
assert.equal((await call(PM, 'GET', 'export', {}, { month: MONTH, kind: 'nope' })).status, 400);

const paid = await ok(PM, 'POST', 'mark-paid', { month: MONTH, paidOn: nextMonthStart, ref: 'NEFT-1' });
assert.equal(paid.run.status, 'PAID');
assert.equal((await ok(EMP, 'GET', 'payslip', undefined, { month: MONTH })).paidOn, nextMonthStart);

// ---------------------------------------------------------------- next month: loan recovery continues, current month needs force
const NEXT = nextMonthStart.slice(0, 7);
const c2 = await ok(PM, 'POST', 'calculate', { month: NEXT });
assert.equal(lineOf(c2.lines, 'u_other').line.loans[0].amount, 1000, 'last instalment is the remaining balance');
assert.ok(c2.run.warnings.some((w: string) => w.includes('has not ended')));
assert.equal((await call(PM, 'POST', 'approve', { month: NEXT, expectedNet: c2.run.totals.net })).status, 409, 'month not over');
await ok(PM, 'POST', 'approve', { month: NEXT, expectedNet: c2.run.totals.net, force: true });
await ok(PM, 'POST', 'lock', { month: NEXT });
assert.equal((await ok(PV, 'GET', 'loans')).items[0].active, false, 'a repaid loan closes itself');
assert.equal((await ok(PV, 'GET', 'runs')).items.length, 2);

// a draft can be deleted
const M3 = addDays(nextMonthStart.slice(0, 8) + '01', 40).slice(0, 7);
await ok(PM, 'POST', 'calculate', { month: M3 });
await ok(PM, 'POST', 'delete-run', { month: M3 });
assert.equal((await ok(PV, 'GET', 'run', undefined, { month: M3 })).run, null);

// a deduction larger than pay blocks approval
fdb.seed('payrollAdjustments', 'big', { companyId: CID, uid: 'u_low', month: M3, kind: 'DEDUCTION', label: 'Recovery', amount: 999999, by: 'x', createdAt: 'x' });
const bad = await ok(PM, 'POST', 'calculate', { month: M3 });
assert.equal(lineOf(bad.lines, 'u_low').line.blocking, true);
assert.equal((await call(PM, 'POST', 'approve', { month: M3, expectedNet: bad.run.totals.net, force: true })).status, 409);

// settings validation
const badSettings = await call(PM, 'POST', 'save-settings', { settings: { components: [{ id: 'a', code: 'A', name: 'A', kind: 'EARNING' }], ctcTemplate: [{ componentId: 'a', mode: 'BALANCE' }, { componentId: 'a', mode: 'BALANCE' }] } });
assert.equal(badSettings.status, 400);
assert.equal((await call(PM, 'GET', 'nope')).status, 404);

console.log('payroll api tests passed');
