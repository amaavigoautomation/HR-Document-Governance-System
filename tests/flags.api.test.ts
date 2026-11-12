import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { payrollChecks, runFlagScan } from '../api/_lib/flagsApi.ts';
import { addDays, istToday, weekday } from '../shared/leaveEngine.ts';
import { DEFAULT_ROLE_TEMPLATES } from '../shared/permissions.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, p: string[] = [], cid: string | null = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: cid ? 'ACTIVE' : undefined, perms: p, adm: false })).toString('base64')}` });
const EMP = tok('u_emp', DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === 'employee')!.permissions);
const LEAVE_HR = tok('u_hr', ['leave.manage']);
const REPORT = tok('u_rep', ['leave.report']);
const PAY_VIEW = tok('u_pv', ['payroll.view']);
const PAY_MGR = tok('u_pm', ['payroll.manage']);
const FOREIGN = tok('u_hr', ['leave.manage', 'payroll.manage'], 'c2');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_emp', 'Esha'], ['u_hr', 'Hema'], ['u_rep', 'Rita'], ['u_pv', 'Pia'], ['u_pm', 'Pam'], ['u1', 'Rohan'], ['u2', 'Priya'], ['u3', 'Karan'], ['u4', 'Anita']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops' });
}
const call = (headers: any, method: string, action: string, body: any = {}) => routeLeave({ method, action, headers, body, query: {}, ip: '1.2.3.4' } as any);
const items = async (headers: any) => (await call(headers, 'GET', 'exceptions')).json;

// ---------------------------------------------------------------- payroll lines for two months
const line = (month: string, uid: string, name: string, net: number, account: string, lop = 0) => ({
  companyId: CID, month, uid,
  employee: { name, empId: uid, department: 'Ops', title: '', email: '', joinDate: '2020-01-01', state: '', pan: '', uan: '', esicNo: '', bankName: '', bankAccountMasked: '', ifsc: '' },
  bank: { account },
  inputs: { monthDays: 30, payDays: 30, paidDays: 30 - lop, lopDays: lop, lop: {}, paidLeaveDays: 0, holidays: 0, weeklyOffs: 4, encashDays: 0, preJoinDays: 0 },
  line: { gross: 60000, totalDeductions: 8000, net, adjustments: [], paidDays: 30, payDays: 30 },
  createdAt: '2026-11-01T00:00:00Z',
});
const seedMonth = (month: string, nets: Record<string, number>, lop = 0) => {
  const acct: Record<string, string> = { u1: '111122223333', u2: '999900001111', u3: '999900001111' };
  for (const [uid, net] of Object.entries(nets)) fdb.seed('payrollRunLines', `${CID}__${month}__${uid}`, line(month, uid, uid === 'u1' ? 'Rohan' : uid === 'u2' ? 'Priya' : 'Karan', net, acct[uid], uid === 'u1' ? lop : 0));
};
seedMonth('2026-10', { u1: 52000, u2: 52000, u3: 52000 });
seedMonth('2026-11', { u1: 41000, u2: 52000, u3: 52000 });

const n = await payrollChecks(CID, '2026-11');
assert.ok(n >= 2, 'a net pay drop and a shared bank account are flagged');
const count = () => fdb.all('leaveExceptions').length;
const before = count();
await payrollChecks(CID, '2026-11');
assert.equal(count(), before, 'running the checks again does not duplicate flags');
const stored = JSON.stringify(fdb.all('leaveExceptions'));
assert.ok(!stored.includes('999900001111') && !stored.includes('111122223333'), 'bank account numbers are never stored on a flag');

// ---------------------------------------------------------------- who sees what
const payrollSeen = (r: any) => r.items.filter((e: any) => e.category === 'FLAG_PAYROLL').length;
assert.equal(payrollSeen(await items(PAY_MGR)), before, 'payroll manager sees every payroll flag');
const pv = await items(PAY_VIEW);
assert.equal(payrollSeen(pv), before);
assert.ok(pv.items.every((e: any) => e.canAct === false), 'payroll view is read only');
assert.equal(payrollSeen(await items(LEAVE_HR)), 0, 'leave HR does not see pay figures');
assert.equal(payrollSeen(await items(REPORT)), 0);
assert.equal((await call(EMP, 'GET', 'exceptions')).status, 403, 'an employee cannot open the list');
assert.equal((await call(FOREIGN, 'GET', 'exceptions')).json.items.length, 0, 'another company sees nothing');

const first = (await items(PAY_MGR)).items.find((e: any) => e.flag?.code === 'NET_CHANGE');
assert.equal((await call(PAY_VIEW, 'POST', 'exception-resolve', { id: first.id })).status, 403, 'read-only payroll cannot review');
assert.equal((await call(LEAVE_HR, 'POST', 'exception-resolve', { id: first.id })).status, 404, 'leave HR cannot even see it to review');
assert.equal((await call(PAY_MGR, 'POST', 'exception-resolve', { id: first.id })).json.success, true);

// ---------------------------------------------------------------- reviewed stays quiet; gets worse reopens; fixed closes
await payrollChecks(CID, '2026-11');
const state = async (id: string) => (await items(PAY_MGR)).items.find((e: any) => e.id === id).status;
assert.equal(await state(first.id), 'RESOLVED', 'a reviewed flag stays reviewed when nothing changed');
seedMonth('2026-11', { u1: 30000, u2: 52000, u3: 52000 });
await payrollChecks(CID, '2026-11');
assert.equal(await state(first.id), 'OPEN', 'a worse figure reopens it');
seedMonth('2026-11', { u1: 51000, u2: 52000, u3: 52000 });
await payrollChecks(CID, '2026-11');
const closed = (await items(PAY_MGR)).items.find((e: any) => e.id === first.id);
assert.equal(closed.status, 'RESOLVED');
assert.equal(closed.resolvedBy, 'System', 'fixing the input closes the flag');

// ---------------------------------------------------------------- late marks from attendance
const today = istToday();
let d = addDays(today, -1);
let made = 0;
while (made < 6) {
  if (weekday(d) !== 0) {
    fdb.seed('leaveAttendance', `${CID}__u4__${d}`, { companyId: CID, uid: 'u4', date: d, month: d.slice(0, 7), checkIn: `${d}T04:50:00.000Z`, checkOut: `${d}T13:30:00.000Z`, source: 'WEB' });
    made++;
  }
  d = addDays(d, -1);
}
const scan = await runFlagScan(CID);
assert.ok(scan.late >= 1, 'repeated late marks are flagged');
const late = (await items(REPORT)).items.find((e: any) => e.category === 'FLAG_LATE' && e.uid === 'u4');
assert.ok(late, 'leave reports can see late flags');
assert.ok(late.flag.evidence.length > 0, 'the late dates are shown as evidence');
assert.equal((await call(REPORT, 'POST', 'exception-resolve', { id: late.id })).status, 403, 'report-only cannot review');
const lateCount = fdb.all('leaveExceptions').filter((e: any) => e.category === 'FLAG_LATE').length;
await runFlagScan(CID);
assert.equal(fdb.all('leaveExceptions').filter((e: any) => e.category === 'FLAG_LATE').length, lateCount, 'the daily scan does not duplicate');

// ---------------------------------------------------------------- settings
assert.equal((await call(EMP, 'GET', 'flag-settings')).status, 403);
assert.equal((await call(REPORT, 'POST', 'flag-save-settings', { settings: { latePer30: 9 } })).status, 403, 'report-only cannot change thresholds');
const saved = await call(LEAVE_HR, 'POST', 'flag-save-settings', { settings: { latePer30: 9, payChangePct: 500 } });
assert.equal(saved.json.settings.latePer30, 9);
assert.equal(saved.json.settings.payChangePct, 100, 'thresholds are clamped');
console.log('flags api ok');
