import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';
import { addDays, istToday } from '../shared/leaveEngine.ts';
import { r2 } from '../shared/payrollEngine.ts';

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
const MGR = tokenFor('u_mgr');
const STRANGER = tokenFor('u_stranger');

const CUR = istToday().slice(0, 7);
const M2 = addDays(`${CUR}-01`, -1).slice(0, 7);
const M1 = addDays(`${M2}-01`, -1).slice(0, 7);

fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_hr', 'Hema HR'], ['u_pm', 'Pia Payroll'], ['u_pv', 'Vik Viewer'], ['u_emp', 'Esha Employee'], ['u_other', 'Omar Other'],
  ['u_low', 'Lal Low'], ['u_mgr', 'Mira Manager'], ['u_stranger', 'Sam Stranger']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid.toUpperCase() });
}

const call = (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routePayroll({ method, action, headers, body, query });
const ok = async (headers: any, method: string, action: string, body?: any, query?: any) => {
  const r = await call(headers, method, action, body, query);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const lcall = (headers: any, method: string, action: string, body: any = {}) => routeLeave({ method, action, headers, body, query: {}, ip: '1.2.3.4' });
const lineOf = (lines: any[], uid: string) => lines.find((l) => l.uid === uid);

// ---------------------------------------------------------------- setup
await lcall(HR, 'POST', 'apply-starter', { yearStartMonth: 4 });
await lcall(HR, 'POST', 'save-profiles', { profiles: [
  { uid: 'u_emp', joinDate: '2020-01-01', gender: 'F', managerUid: 'u_mgr' }, { uid: 'u_other', joinDate: '2020-01-01', managerUid: 'u_mgr' },
  { uid: 'u_low', joinDate: '2020-01-01' }, { uid: 'u_mgr', joinDate: '2019-01-01' },
] });
await ok(PM, 'POST', 'apply-starter');
const split = await ok(PM, 'POST', 'split-ctc', { annualCtc: 600000 });
await ok(PM, 'POST', 'save-structure', { uid: 'u_emp', amounts: split.amounts, annualCtc: 600000, state: 'Maharashtra', pan: 'ABCDE1234F' });
await ok(PM, 'POST', 'import-structures', { rows: [
  { email: 'u_other@acme.com', BASIC: '30000', HRA: '12000', SPL: '8000', state: 'Maharashtra', TDS: '1000' },
  { email: 'u_low@acme.com', BASIC: '9000', HRA: '3000', SPL: '3000', state: 'Maharashtra' },
] });
const runMonth = async (month: string) => {
  const c = await ok(PM, 'POST', 'calculate', { month });
  await ok(PM, 'POST', 'approve', { month, expectedNet: c.run.totals.net });
  await ok(PM, 'POST', 'lock', { month });
  return c;
};

// ================================================================ reimbursements
await runMonth(M1);

// a bill is needed above the limit, and it must be a sane file
assert.equal((await call(EMP, 'POST', 'submit-claim', { category: 'Travel', amount: 1200, expenseDate: `${M1}-10`, description: 'Client visit' })).status, 400, 'bill needed above 500');
assert.equal((await call(EMP, 'POST', 'submit-claim', { category: 'Nonsense', amount: 100, expenseDate: `${M1}-10`, description: 'x' })).status, 400, 'unknown category');
assert.equal((await call(EMP, 'POST', 'submit-claim', { category: 'Travel', amount: 100, expenseDate: addDays(istToday(), 3), description: 'x' })).status, 400, 'no future dates');
assert.equal((await call(EMP, 'POST', 'submit-claim', { category: 'Travel', amount: 1200, expenseDate: `${M1}-10`, description: 'x', bill: { name: 'a.exe', type: 'application/x-msdownload', data: 'AAAA' } })).status, 400);
assert.equal((await call(EMP, 'POST', 'submit-claim', { category: 'Travel', amount: 1200, expenseDate: `${M1}-10`, description: 'x', bill: { name: 'big.pdf', type: 'application/pdf', data: 'A'.repeat(800_000) } })).status, 400, 'too large');
const bill = { name: 'cab.jpg', type: 'image/jpeg', data: Buffer.from('fake image').toString('base64') };
const c1 = await ok(EMP, 'POST', 'submit-claim', { category: 'Travel', amount: 1200, expenseDate: `${M1}-10`, description: 'Client visit cab', bill });
const c2 = await ok(OTHER, 'POST', 'submit-claim', { category: 'Food', amount: 500, expenseDate: `${M1}-12`, description: 'Team lunch' });
assert.equal((await ok(EMP, 'GET', 'my-claims')).items.length, 1, 'only my own claims');

// who can see and decide
assert.equal((await call(STRANGER, 'GET', 'claims')).status, 403, 'not a manager, no payroll access');
const mgrList = await ok(MGR, 'GET', 'claims');
assert.equal(mgrList.scope, 'REPORTS');
assert.equal(mgrList.items.length, 2);
assert.equal((await ok(PV, 'GET', 'claims')).scope, 'ALL');
assert.equal((await ok(MGR, 'GET', 'me')).isManager, true);
assert.equal((await ok(STRANGER, 'GET', 'me')).isManager, false);
assert.equal((await call(EMP, 'POST', 'decide-claim', { id: c1.id, decision: 'APPROVE' })).status, 403, 'cannot approve your own claim');
assert.equal((await call(STRANGER, 'POST', 'decide-claim', { id: c1.id, decision: 'APPROVE' })).status, 403, 'not their manager');
assert.equal((await call(PV, 'POST', 'decide-claim', { id: c1.id, decision: 'APPROVE' })).status, 403, 'view access is not enough');
assert.equal((await call(MGR, 'POST', 'decide-claim', { id: c1.id, decision: 'REJECT' })).status, 400, 'a rejection needs a reason');
assert.equal((await call(MGR, 'POST', 'decide-claim', { id: c1.id, decision: 'APPROVE', approvedAmount: 1000 })).status, 400, 'part approval needs a reason');
assert.equal((await call(MGR, 'POST', 'decide-claim', { id: c1.id, decision: 'APPROVE', approvedAmount: 5000, note: 'more' })).status, 400, 'cannot approve more than claimed');
await ok(MGR, 'POST', 'decide-claim', { id: c1.id, decision: 'APPROVE', approvedAmount: 1000, note: 'cab fare capped' });
await ok(PM, 'POST', 'decide-claim', { id: c2.id, decision: 'APPROVE' });
assert.equal((await call(MGR, 'POST', 'decide-claim', { id: c1.id, decision: 'REJECT', note: 'again' })).status, 409, 'already decided');
assert.equal((await call(EMP, 'POST', 'withdraw-claim', { id: c1.id })).status, 409, 'an approved claim cannot be withdrawn');

// bills are private
assert.equal((await ok(EMP, 'GET', 'claim-bill', undefined, { id: c1.id })).data, bill.data);
assert.equal((await ok(MGR, 'GET', 'claim-bill', undefined, { id: c1.id })).name, 'cab.jpg');
assert.equal((await call(OTHER, 'GET', 'claim-bill', {}, { id: c1.id })).status, 403, 'a colleague cannot open it');
assert.equal((await call(STRANGER, 'GET', 'claim-bill', {}, { id: c1.id })).status, 403);

// withdraw a waiting claim, reject another
const c3 = await ok(EMP, 'POST', 'submit-claim', { category: 'Other', amount: 50, expenseDate: `${M1}-20`, description: 'Stationery' });
await ok(EMP, 'POST', 'withdraw-claim', { id: c3.id });
assert.equal((await ok(EMP, 'GET', 'my-claims')).items.length, 1);
const c4 = await ok(LOW, 'POST', 'submit-claim', { category: 'Other', amount: 80, expenseDate: `${M1}-21`, description: 'Pens' });
await ok(PM, 'POST', 'decide-claim', { id: c4.id, decision: 'REJECT', note: 'not allowed' });
assert.equal((await ok(LOW, 'GET', 'my-claims')).items[0].status, 'REJECTED');

// approved claims flow into the next run as reimbursements, are not taxed, and are PAID when the run locks
const r2calc = await ok(PM, 'POST', 'calculate', { month: M2 });
const e2 = lineOf(r2calc.lines, 'u_emp').line;
assert.equal(e2.reimbursementTotal, 1000);
assert.equal(e2.reimbursements[0].amount, 1000);
assert.equal(e2.gross, 50000, 'reimbursements are not gross');
assert.equal(e2.net, r2(50000 - e2.totalDeductions + 1000));
assert.equal(lineOf(r2calc.lines, 'u_other').line.reimbursementTotal, 500);
assert.equal(r2calc.run.totals.reimbursements, 1500);
assert.equal(lineOf(r2calc.lines, 'u_low').line.reimbursementTotal, 0, 'rejected claims are not paid');
await ok(PM, 'POST', 'approve', { month: M2, expectedNet: r2calc.run.totals.net });
assert.equal((await ok(EMP, 'GET', 'my-claims')).items[0].status, 'APPROVED', 'still approved until the run is locked');
await ok(PM, 'POST', 'lock', { month: M2 });
const paidClaim = (await ok(EMP, 'GET', 'my-claims')).items[0];
assert.equal(paidClaim.status, 'PAID');
assert.equal(paidClaim.paidMonth, M2);
const slip = await ok(EMP, 'GET', 'payslip', undefined, { month: M2 });
assert.equal(slip.line.reimbursementTotal, 1000);
const reg = await ok(PM, 'GET', 'export', undefined, { month: M2, kind: 'register' });
assert.ok(reg.header.includes('Reimbursements'));

// ================================================================ salary revisions and arrears
assert.equal((await call(PV, 'POST', 'save-revision', { uid: 'u_emp', effectiveFrom: `${M1}-01`, annualCtc: 720000 })).status, 403);
assert.equal((await call(PM, 'POST', 'save-revision', { uid: 'u_emp', effectiveFrom: `${M1}-15`, annualCtc: 720000 })).status, 400, 'must start on the first of a month');
assert.equal((await call(PM, 'POST', 'save-revision', { uid: 'u_mgr', effectiveFrom: `${M1}-01`, annualCtc: 720000 })).status, 409, 'no salary yet');
assert.equal((await call(PM, 'POST', 'save-revision', { uid: 'u_emp', effectiveFrom: `${M1}-01` })).status, 400, 'needs amounts or a CTC');
const rev = await ok(PM, 'POST', 'save-revision', { uid: 'u_emp', effectiveFrom: `${M1}-01`, annualCtc: 720000, note: 'Annual raise' });
const future = await ok(PM, 'POST', 'save-revision', { uid: 'u_other', effectiveFrom: `${addDays(`${CUR}-01`, 40).slice(0, 7)}-01`, annualCtc: 800000 });
const revs = await ok(PV, 'GET', 'revisions');
assert.equal(revs.items.length, 2);
const mine = revs.items.find((r: any) => r.id === rev.id);
assert.equal(mine.currentGross, 50000);
assert.equal(mine.newGross, 60000);
assert.equal((await call(EMP, 'GET', 'revisions')).status, 403);

// nothing changes until the revision is applied, and the run warns about it
const before = await ok(PM, 'POST', 'calculate', { month: CUR });
assert.equal(lineOf(before.lines, 'u_emp').line.gross, 50000 * lineOf(before.lines, 'u_emp').line.paidDays / lineOf(before.lines, 'u_emp').line.payDays);
assert.ok(before.run.warnings.some((w: string) => w.includes('salary revision')));

// a preview shows the arrears without changing anything
const dry = await ok(PM, 'POST', 'apply-revisions', { month: CUR, dryRun: true });
assert.equal(dry.applied, false);
assert.equal(dry.items.length, 1, 'the future revision is not due yet');
assert.equal(dry.items[0].arrearsTotal, 20000, 'two paid months, 10,000 more each');
assert.deepEqual(dry.items[0].months.map((m: any) => m.month), [M1, M2]);
assert.equal((await ok(PV, 'GET', 'structure', undefined, { uid: 'u_emp' })).structure.amounts.basic, 25000);

const applied = await ok(PM, 'POST', 'apply-revisions', { month: CUR });
assert.equal(applied.applied, true);
const st2 = (await ok(PV, 'GET', 'structure', undefined, { uid: 'u_emp' })).structure;
assert.equal(st2.amounts.basic, 30000);
assert.equal(st2.history[0].amounts.basic, 25000, 'the old salary is kept in history');
const adjs = (await ok(PV, 'GET', 'adjustments', undefined, { month: CUR })).items;
const arrAdj = adjs.find((a: any) => a.label.startsWith('Arrears'));
assert.equal(arrAdj.amount, 20000);
assert.equal(arrAdj.kind, 'EARNING');
assert.equal(arrAdj.name, 'Esha Employee');
const after = (await ok(PV, 'GET', 'revisions')).items.find((r: any) => r.id === rev.id);
assert.equal(after.status, 'APPLIED');
assert.equal(after.arrearsTotal, 20000);
assert.equal((await ok(PM, 'POST', 'apply-revisions', { month: CUR })).items.length, 0, 'applying twice does nothing');
assert.equal((await call(PM, 'POST', 'cancel-revision', { id: rev.id })).status, 409, 'an applied revision cannot be cancelled');
await ok(PM, 'POST', 'cancel-revision', { id: future.id });
assert.equal((await ok(PV, 'GET', 'revisions')).items.find((r: any) => r.id === future.id).status, 'CANCELLED');
// a locked month cannot take arrears
assert.equal((await call(PM, 'POST', 'apply-revisions', { month: M2 })).status, 409);

// the next run uses the new salary and carries the arrears
const withRev = await ok(PM, 'POST', 'calculate', { month: CUR });
const el = lineOf(withRev.lines, 'u_emp').line;
assert.ok(!withRev.run.warnings.some((w: string) => w.includes('salary revision')));
assert.equal(el.adjustments.find((a: any) => a.label.startsWith('Arrears')).amount, 20000);
assert.equal(el.earnings.find((e: any) => e.id === 'basic').full, 30000);

// ================================================================ income tax (TDS)
// manual mode: the component on the salary is the TDS
assert.equal(lineOf(withRev.lines, 'u_other').line.tds, 1000);

assert.equal((await call(EMP, 'GET', 'tax-declaration', {}, { uid: 'u_other' })).status, 403, 'cannot read a colleague declaration');
const none = await ok(EMP, 'GET', 'tax-declaration');
assert.equal(none.status, 'NONE');
assert.equal(none.declaration.regime, 'NEW');
await ok(EMP, 'POST', 'save-tax-declaration', { declaration: { regime: 'OLD', sec80C: 100000, prevIncome: 300000 } });
assert.equal((await ok(EMP, 'GET', 'tax-declaration')).declaration.sec80C, 100000);
assert.equal((await call(EMP, 'POST', 'save-tax-declaration', { uid: 'u_other', declaration: { regime: 'OLD' } })).status, 403, 'cannot declare for a colleague');
assert.equal((await ok(PV, 'GET', 'tax-declarations')).rows.find((r: any) => r.uid === 'u_emp').status, 'SUBMITTED');
await ok(PM, 'POST', 'verify-declaration', { uid: 'u_emp' });
assert.equal((await call(EMP, 'POST', 'save-tax-declaration', { declaration: { regime: 'NEW' } })).status, 409, 'verified declarations are locked for the employee');
await ok(PM, 'POST', 'save-tax-declaration', { uid: 'u_emp', declaration: { regime: 'OLD', sec80C: 100000, prevIncome: 300000 } });

const prev = await ok(EMP, 'GET', 'tax-preview');
assert.equal(prev.available, true);
assert.equal(prev.NEW.annualTax, 0, 'under 12 lakh, the new regime is nil');
assert.ok(prev.OLD.annualTax > 0);
assert.equal(prev.cheaper, 'NEW');
assert.equal((await call(EMP, 'GET', 'tax-preview', {}, { uid: 'u_other' })).status, 403);

// switch to automatic TDS
const cfg = (await ok(PM, 'GET', 'settings')).settings;
await ok(PM, 'POST', 'save-settings', { settings: { ...cfg, tax: { ...cfg.tax, mode: 'AUTO' } } });
const autoRun = await ok(PM, 'POST', 'calculate', { month: CUR });
const ea = lineOf(autoRun.lines, 'u_emp');
assert.ok(ea.line.tds > 0, 'the old regime declaration produces tax');
assert.equal(ea.line.deductions.filter((d: any) => d.code === 'TDS').length, 1);
assert.equal(ea.line.deductions.find((d: any) => d.code === 'TDS').amount, ea.line.tds);
assert.equal(ea.tax.regime, 'OLD');
assert.equal(lineOf(autoRun.lines, 'u_other').line.tds, 0, 'the fixed TDS on the salary is replaced; nobody here owes tax under the default regime');
assert.ok(autoRun.run.warnings.some((w: string) => w.includes('tax declaration')));
assert.equal(autoRun.run.totals.tds, ea.line.tds);

// the annual statement and register work from what was paid
const stmt = await ok(EMP, 'GET', 'tax-statement');
assert.equal(stmt.employee.pan, 'ABCDE1234F');
assert.equal(stmt.regime, 'OLD');
assert.ok(Array.isArray(stmt.months));
assert.equal((await call(EMP, 'GET', 'tax-statement', {}, { uid: 'u_other' })).status, 403);
assert.ok((await ok(PV, 'GET', 'tds-register')).header.includes('Tax deducted'));
assert.equal((await call(EMP, 'GET', 'tds-register')).status, 403);
assert.equal((await ok(PM, 'GET', 'export', undefined, { month: M2, kind: 'tds' })).header[4], 'Income tax (TDS)');

// ================================================================ full and final settlement
const LWD = `${CUR}-15`;
await ok(PM, 'POST', 'save-loan', { uid: 'u_other', label: 'Laptop loan', principal: 3000, installment: 1000 });
assert.equal((await call(PV, 'POST', 'save-settlement', { uid: 'u_other', lastWorkingDay: LWD })).status, 403);
assert.equal((await call(PM, 'POST', 'save-settlement', { uid: 'u_other' })).status, 400, 'needs a last working day');
assert.equal((await call(PM, 'POST', 'save-settlement', { uid: 'u_mgr', lastWorkingDay: LWD })).status, 409, 'no salary on file');
assert.equal((await call(PM, 'POST', 'save-settlement', { uid: 'u_other', lastWorkingDay: '2010-01-01' })).status, 400, 'before joining');

const saved = await ok(PM, 'POST', 'save-settlement', {
  uid: 'u_other', reason: 'RESIGNATION', lastWorkingDay: LWD, noticeRequiredDays: 30, noticeServedDays: 10, recoverNotice: true, encashDays: 2,
  extras: [{ kind: 'EARNING', label: 'Pending bonus', amount: 1000 }],
});
const sc = saved.settlement.calc;
assert.equal(saved.settlement.status, 'DRAFT');
assert.equal(sc.inputs.paidDays, 15, 'paid up to the last working day only');
assert.equal(sc.inputs.salaryAlreadyPaid, false);
assert.equal(sc.line.encashment.days, 2);
assert.equal(sc.line.loans.reduce((n: number, l: any) => n + l.amount, 0), 3000, 'the whole loan balance is recovered');
assert.equal(sc.gratuity.eligible, true);
assert.equal(sc.gratuity.amount, r2((30000 * 15 / 26) * sc.gratuity.service.years));
assert.equal(sc.notice.shortfallDays, 20);
assert.equal(sc.notice.recovery, r2(20 * r2(50000 / 30)));
assert.equal(sc.totals.net, r2(sc.line.gross + sc.gratuity.amount - sc.line.totalDeductions - sc.notice.recovery));
assert.ok(sc.totals.payable > 0);

// the person leaves the regular payroll from the month of the last working day
const afterSettle = await ok(PM, 'POST', 'calculate', { month: CUR });
assert.ok(afterSettle.run.skipped.some((s: any) => s.name === 'Omar Other' && s.reason === 'Full and final settlement'));
assert.equal(lineOf(afterSettle.lines, 'u_other'), undefined);

// visibility: nobody but payroll sees a settlement before it is paid
assert.equal((await ok(OTHER, 'GET', 'settlement')).settlement, null, 'not visible to the employee before it is paid');
assert.equal((await call(EMP, 'GET', 'settlement', {}, { uid: 'u_other' })).status, 403);
assert.equal((await ok(PV, 'GET', 'settlement', undefined, { uid: 'u_other' })).settlement.status, 'DRAFT');
assert.equal((await ok(PV, 'GET', 'settlements')).items.length, 1);

// approve needs the reviewed amount, then freezes
assert.equal((await call(PM, 'POST', 'approve-settlement', { uid: 'u_other', expectedNet: sc.totals.net + 500 })).status, 409);
assert.equal((await call(PM, 'POST', 'pay-settlement', { uid: 'u_other' })).status, 409, 'approve before paying');
await ok(PM, 'POST', 'approve-settlement', { uid: 'u_other', expectedNet: sc.totals.net });
assert.equal((await call(PM, 'POST', 'save-settlement', { uid: 'u_other', lastWorkingDay: LWD })).status, 409, 'approved settlements do not change');
await ok(PM, 'POST', 'reopen-settlement', { uid: 'u_other' });
await ok(PM, 'POST', 'approve-settlement', { uid: 'u_other', expectedNet: sc.totals.net });
const paid = await ok(PM, 'POST', 'pay-settlement', { uid: 'u_other', paidOn: LWD, ref: 'NEFT-9' });
assert.equal(paid.settlement.status, 'PAID');
const loan = (await ok(PV, 'GET', 'loans')).items.find((l: any) => l.uid === 'u_other');
assert.equal(loan.balance, 0);
assert.equal(loan.active, false);
assert.equal((await call(PM, 'POST', 'delete-settlement', { uid: 'u_other' })).status, 409, 'paid settlements stay');
const seen = await ok(OTHER, 'GET', 'settlement');
assert.equal(seen.settlement.status, 'PAID', 'visible to the employee once paid');
assert.equal(seen.settlement.calc.totals.net, sc.totals.net);
assert.ok(!JSON.stringify(seen).includes('bankAccount"'), 'no full account number in the statement');

// a person whose last month was already locked, and who owes more than they are owed
await ok(PM, 'POST', 'save-loan', { uid: 'u_low', label: 'Big advance', principal: 100000, installment: 100000 });
const owing = await ok(PM, 'POST', 'save-settlement', { uid: 'u_low', reason: 'TERMINATION', lastWorkingDay: `${M2}-20`, recoverNotice: false });
assert.equal(owing.settlement.calc.inputs.salaryAlreadyPaid, true);
assert.ok(owing.settlement.calc.warnings.some((w: string) => w.includes('already locked')));
assert.ok(owing.settlement.calc.totals.recoverable > 0);
assert.equal(owing.settlement.calc.totals.payable, 0);
assert.equal(owing.settlement.calc.gratuity.eligible, true);
await ok(PM, 'POST', 'delete-settlement', { uid: 'u_low' });
assert.equal((await ok(PV, 'GET', 'settlements')).items.length, 1, 'a draft can be thrown away');
// deleting the settlement puts them back in the regular run
assert.ok(lineOf((await ok(PM, 'POST', 'calculate', { month: CUR })).lines, 'u_low'));

// salary paid after the last working day is taken back
const late = await ok(PM, 'POST', 'save-settlement', { uid: 'u_low', reason: 'RESIGNATION', lastWorkingDay: `${M1}-20` });
assert.ok(late.settlement.calc.overpaid.amount > 0, 'M2 was paid after leaving');
assert.deepEqual(late.settlement.calc.overpaid.months.map((m: any) => m.month), [M2]);

// an approved run containing the person blocks a settlement until it is reopened
await ok(PM, 'POST', 'delete-settlement', { uid: 'u_low' });
await ok(PM, 'POST', 'close-loan', { id: (await ok(PV, 'GET', 'loans')).items.find((l: any) => l.uid === 'u_low').id });
const c = await ok(PM, 'POST', 'calculate', { month: CUR });
await ok(PM, 'POST', 'approve', { month: CUR, expectedNet: c.run.totals.net, force: true });
assert.equal((await call(PM, 'POST', 'save-settlement', { uid: 'u_low', reason: 'RESIGNATION', lastWorkingDay: `${CUR}-10` })).status, 409);

console.log('payroll extras api tests passed');
