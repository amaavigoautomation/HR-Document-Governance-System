import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeDashboard } from '../api/_lib/dashboardApi.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';
import { addDays, istToday, weekday } from '../shared/leaveEngine.ts';
import { DEFAULT_ROLE_TEMPLATES } from '../shared/permissions.ts';
import { buildWidgets, groupWidgets, type DashboardInput, type WidgetId } from '../shared/dashboard.ts';

const perms = (slug: string) => DEFAULT_ROLE_TEMPLATES.find((t) => t.slug === slug)!.permissions;

// ================================================================ pure rules: nobody gets a widget their permissions do not allow
const FULL: Omit<DashboardInput, 'perms'> = {
  today: '2026-10-26',
  leave: {
    found: true, configured: true, canManage: false, canReport: false, isManager: false, isDelegate: false, approvals: 2,
    balances: [
      { code: 'CL', name: 'Casual', balance: 3, pending: 0, used: 1, eligible: true },
      { code: 'LOP', name: 'Loss of pay', balance: 0, pending: 0, used: 0, eligible: true, isLop: true },
      { code: 'MAT', name: 'Maternity', balance: 26, pending: 0, used: 0, eligible: false },
    ],
    attendanceToday: { checkIn: '09:30', checkOut: null },
  },
  payroll: { configured: true, canManage: false, canView: false, isManager: false, latestPayslip: { month: '2026-09', gross: 100, deductions: 10, net: 90, status: 'PAID' }, latestRun: { month: '2026-09', status: 'DRAFT' } },
  lifecycle: { canManage: false, isManager: false, hasExit: false, openTasks: 0, companyOpenTasks: 5 },
  docs: {
    pendingAcks: [{ documentId: 'D1', title: 'Leave policy', versionNumber: '1.0' }], pendingAckCount: 1,
    reviewQueue: [{ documentId: 'D2', title: 'Code of conduct', versionNumber: '1.1' }], reviewQueueCount: 1,
    myRevisions: [{ documentId: 'D3', title: 'IT policy', versionNumber: '2.0' }],
    reReviewDue: [{ documentId: 'D4', title: 'POSH', versionNumber: '1.0', overdue: true }],
    compliance: { total: 10, acknowledged: 7, pending: 3 },
  },
  hiring: { waiting: [{ status: 'PENDING_HR', label: 'x', count: 2 }], open: 3 },
  activeEmployees: 40,
};

/** What a widget needs. Permission lists mean "any of these". Relationship rules are checked separately below. */
const NEEDS: Partial<Record<WidgetId, string[]>> = {
  'review-queue': ['doc.review', 'doc.publish'],
  'my-revisions': ['doc.create'],
  'rereview-due': ['doc.create', 'doc.review', 'doc.publish'],
  acknowledgements: ['doc.acknowledge'],
  compliance: ['compliance.view'],
  hiring: ['req.view_all', 'req.assign', 'req.hr_decide', 'req.founder_decide', 'req.manage_jd', 'req.create'],
  'people-tasks': ['lifecycle.manage'],
  'payroll-run': ['payroll.view', 'payroll.manage'],
  admin: ['users.manage', 'departments.manage', 'roles.manage'],
};

for (const t of DEFAULT_ROLE_TEMPLATES) {
  // Give each template every module's data, plus the relationships its permissions imply, then check nothing extra appears.
  const input: DashboardInput = {
    ...FULL, perms: t.permissions,
    leave: { ...FULL.leave!, canManage: t.permissions.includes('leave.manage') },
    payroll: { ...FULL.payroll!, canManage: t.permissions.includes('payroll.manage'), canView: t.permissions.some((p) => p.startsWith('payroll.')) },
    lifecycle: { ...FULL.lifecycle!, canManage: t.permissions.includes('lifecycle.manage') },
  };
  for (const w of buildWidgets(input)) {
    const need = NEEDS[w.id];
    if (need) assert.ok(need.some((p) => t.permissions.includes(p)), `${t.slug} got ${w.id} without ${need.join('/')}`);
  }
}

// Someone with no permissions and no relationships only ever gets personal widgets.
const nobody = buildWidgets({ ...FULL, perms: [], leave: { ...FULL.leave!, approvals: 9 }, payroll: { ...FULL.payroll!, canView: false } });
assert.deepEqual(nobody.map((w) => w.id).sort(), ['attendance', 'latest-payslip', 'leave-balance'], 'no permissions: personal widgets only');

// Balances shown are the ones this person can actually use (no unpaid leave, no leave they are not eligible for).
const bal = nobody.find((w) => w.id === 'leave-balance')!.data.balances.map((b: any) => b.code);
assert.deepEqual(bal, ['CL']);

// A manager (relationship, not permission) gets approvals; so does a delegate; a plain employee does not.
const asManager = (extra: Partial<NonNullable<DashboardInput['leave']>>) => buildWidgets({ ...FULL, perms: [], leave: { ...FULL.leave!, ...extra } }).map((w) => w.id);
assert.ok(asManager({ isManager: true }).includes('approvals'));
assert.ok(asManager({ isDelegate: true }).includes('approvals'));
assert.ok(!asManager({}).includes('approvals'));
assert.equal(buildWidgets({ ...FULL, perms: [], leave: { ...FULL.leave!, isManager: true, approvals: 0 } }).find((w) => w.id === 'approvals')!.urgent, false, 'nothing waiting: not urgent');

// Data-dependent widgets stay out of the way when there is nothing to do.
const quiet = buildWidgets({
  ...FULL, perms: perms('hr'),
  docs: { ...FULL.docs!, pendingAckCount: 0, pendingAcks: [], reviewQueueCount: 0, reviewQueue: [], myRevisions: [], reReviewDue: [] },
  hiring: { waiting: [{ status: 'PENDING_HR', label: 'x', count: 0 }], open: 0 },
}).map((w) => w.id);
for (const id of ['acknowledgements', 'review-queue', 'my-revisions', 'rereview-due', 'hiring'] as WidgetId[]) assert.ok(!quiet.includes(id), `${id} hidden when empty`);

// Setup not done: no leave widgets, no payslip widget.
const unset = buildWidgets({ ...FULL, perms: [], leave: { ...FULL.leave!, configured: false }, payroll: { ...FULL.payroll!, configured: false } });
assert.deepEqual(unset.map((w) => w.id), []);
// Tasks and exit come from the person's own record, no permission needed.
assert.ok(buildWidgets({ ...FULL, perms: [], lifecycle: { ...FULL.lifecycle!, openTasks: 2 } }).some((w) => w.id === 'my-tasks'));
assert.equal(buildWidgets({ ...FULL, perms: [], lifecycle: { ...FULL.lifecycle!, hasExit: true } }).find((w) => w.id === 'my-tasks')!.title, 'Your exit');

// Order and grouping: attention first, then my work, then team.
const hrWidgets = buildWidgets({ ...FULL, perms: perms('hr'), leave: { ...FULL.leave!, canManage: true }, lifecycle: { ...FULL.lifecycle!, canManage: true } });
assert.deepEqual(groupWidgets(hrWidgets).map((g) => g.group), ['attention', 'me', 'team']);
assert.equal(hrWidgets[0].group, 'attention');

// ================================================================ API against a fake Firestore
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, p: string[] = [], adm = false, cid: string | null = CID, extra: Record<string, any> = {}) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: cid ? 'ACTIVE' : undefined, perms: p, adm, ...extra })).toString('base64')}` });

const EMP = tokenFor('u_emp', perms('employee'));
const OTHER = tokenFor('u_other', perms('employee'));
const MGR = tokenFor('u_mgr', perms('employee'));
const HR = tokenFor('u_hr', perms('hr'));
const APPR = tokenFor('u_appr', perms('approver'));
const PAY = tokenFor('u_pay', ['payroll.view']);
const PM = tokenFor('u_pm', ['payroll.manage']);
const ADM = tokenFor('u_adm', perms('company-admin'), true);
const FOREIGN = tokenFor('u_hr', perms('hr'), false, 'c2');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name] of [['u_emp', 'Esha Employee'], ['u_other', 'Omar Other'], ['u_mgr', 'Manu Manager'], ['u_hr', 'Hema HR'], ['u_appr', 'Anil Approver'], ['u_pay', 'Pia Payroll'], ['u_pm', 'Pam Payroll Manager'], ['u_adm', 'Ada Admin']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops' });
}
fdb.seed('employees', 'u_gone', { companyId: CID, authUid: 'u_gone', name: 'Gone', email: 'gone@acme.com', active: false, createdAt: '2020-01-01T00:00:00Z' });

const dash = (headers: any, action = 'me', method = 'GET') => routeDashboard({ method, action, headers });
const widgetsOf = async (headers: any) => {
  const r = await dash(headers);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.widgets as { id: WidgetId; urgent?: boolean; group: string; data: any; target?: any }[];
};
const ids = (ws: { id: string }[]) => ws.map((w) => w.id);
const lcall = (headers: any, method: string, action: string, body: any = {}) => routeLeave({ method, action, headers, body, query: {}, ip: '1.2.3.4' });
const pcall = (headers: any, method: string, action: string, body: any = {}) => routePayroll({ method, action, headers, body, query: {} });

// ---- access
assert.equal((await dash({})).status, 401, 'signed-out people get nothing');
assert.equal((await dash(tokenFor('x', [], false, null))).status, 403, 'not linked to a company');
assert.equal((await dash(EMP, 'nope')).status, 404);
assert.equal((await dash(EMP, 'me', 'POST')).status, 404, 'read only');
assert.deepEqual((await widgetsOf(tokenFor('pa', [], false, null, { pa: true }))), [], 'platform admin has no company home page');

// ---- before anything is set up: the dashboard is empty for a plain employee, not an error
assert.deepEqual(ids(await widgetsOf(EMP)), []);

// ---- leave set up, a manager, and a pending request
await lcall(HR, 'POST', 'apply-starter', { yearStartMonth: 4 });
await lcall(HR, 'POST', 'save-profiles', { profiles: [
  { uid: 'u_emp', managerUid: 'u_mgr', gender: 'F', joinDate: '2020-01-01' }, { uid: 'u_other', managerUid: 'u_mgr', joinDate: '2020-01-01' },
  { uid: 'u_mgr', joinDate: '2020-01-01' }, { uid: 'u_hr', joinDate: '2020-01-01' },
] });
await lcall(HR, 'POST', 'run-accrual');
const today = istToday();
let day = addDays(today, 9);
while (weekday(day) === 0 || weekday(day) === 6 || ['2026-10-02', '2027-01-26', '2026-08-15'].includes(day)) day = addDays(day, 1);
const applied = await lcall(EMP, 'POST', 'apply', { typeId: 'cl', from: day, to: day, reason: 'family' });
assert.equal(applied.status, 200, JSON.stringify(applied.json));

// ---- documents, acknowledgements, hiring, payroll, tasks
const ver = (id: string, over: Record<string, any>) => fdb.seed('versions', id, {
  id, companyId: CID, documentId: `DOC-${id}`, documentTitle: `Title ${id}`, versionNumber: '1.0', createdAt: '2026-10-01T00:00:00Z', createdById: 'u_hr', status: 'PUBLISHED',
  rawContent: 'x'.repeat(50), fileUrl: 'data:application/pdf;base64,AAAA', ...over,
});
ver('v_pub', { status: 'PUBLISHED', documentTitle: 'Leave Policy', reviewDueDate: addDays(today, 10) });
ver('v_far', { status: 'PUBLISHED', reviewDueDate: addDays(today, 200) });
ver('v_review', { status: 'IN_REVIEW', documentTitle: 'Code of Conduct', createdById: 'u_hr' });
ver('v_rev', { status: 'REVISION_REQUIRED', documentTitle: 'IT Policy', createdById: 'u_hr' });
ver('v_rev_other', { status: 'REVISION_REQUIRED', documentTitle: 'Someone elses', createdById: 'u_other' });
const ack = (id: string, over: Record<string, any>) => fdb.seed('acknowledgments', id, { id, companyId: CID, documentTitle: 'Leave Policy', documentId: 'DOC-v_pub', versionNumber: '1.0', documentVersionId: 'v_pub', status: 'PENDING', ...over });
ack('a1', { employeeId: 'u_emp' });
ack('a_stale', { employeeId: 'u_emp', documentVersionId: 'v_old', documentTitle: 'Old version' });
ack('a_done', { employeeId: 'u_emp', status: 'ACKNOWLEDGED', documentVersionId: 'v_far' });
ack('a_other', { employeeId: 'u_other', documentTitle: 'Omars private pending' });
const req = (id: string, over: Record<string, any>) => fdb.seed('requisitions', id, { id, companyId: CID, status: 'PENDING_HR', ownerHr: { id: 'u_hr' }, requestedBy: { id: 'u_mgr' }, raisedBy: { id: 'u_mgr' }, events: [], ...over });
req('q1', { status: 'PENDING_HR' });
req('q2', { status: 'PENDING_HR', ownerHr: { id: 'someone_else' } });
req('q3', { status: 'PENDING_FOUNDER' });
req('q4', { status: 'JOB_OPEN' });
fdb.seed('lifecycleTasks', 't1', { companyId: CID, status: 'OPEN', assigneeUid: 'u_hr', uid: 'u_new', title: 'Laptop' });
fdb.seed('lifecycleTasks', 't2', { companyId: CID, status: 'DONE', assigneeUid: 'u_hr', uid: 'u_new', title: 'Done already' });

assert.equal((await pcall(PM, 'POST', 'apply-starter')).status, 200);
fdb.seed('payrollRuns', 'r_aug', { companyId: CID, month: '2026-08', status: 'LOCKED' });
fdb.seed('payrollRuns', 'r_sep', { companyId: CID, month: '2026-09', status: 'DRAFT' });
fdb.seed('payrollRunLines', 'l1', { companyId: CID, uid: 'u_emp', month: '2026-08', line: { gross: 50000, totalDeductions: 5000, net: 45000 } });
fdb.seed('payrollRunLines', 'l2', { companyId: CID, uid: 'u_emp', month: '2026-09', line: { gross: 99999, totalDeductions: 1, net: 99998 } });
fdb.seed('payrollRunLines', 'l3', { companyId: CID, uid: 'u_other', month: '2026-08', line: { gross: 777, totalDeductions: 7, net: 770 } });

// ---- a plain employee: their own things only
const emp = await widgetsOf(EMP);
assert.deepEqual(ids(emp), ['acknowledgements', 'attendance', 'leave-balance', 'latest-payslip']);
const acks = emp.find((w) => w.id === 'acknowledgements')!;
assert.equal(acks.data.count, 1, 'only their own, current pending acknowledgement (not stale, not done, not Omar\'s)');
assert.equal(acks.data.items[0].title, 'Leave Policy');
assert.ok(!JSON.stringify(emp).includes('Omars private pending'), 'never another person\'s acknowledgement');
const slip = emp.find((w) => w.id === 'latest-payslip')!;
assert.equal(slip.data.net, 45000, 'their payslip, only from a locked run (the draft month stays hidden)');
assert.equal(slip.data.month, '2026-08');
assert.equal(emp.find((w) => w.id === 'leave-balance')!.data.balances.find((b: any) => b.code === 'CL').balance > 0, true);
assert.ok(emp.every((w) => w.group !== 'team'), 'employees get no team or company widgets');

const other = await widgetsOf(OTHER);
assert.equal(JSON.stringify(other).includes('45000'), false, 'Omar never sees Esha\'s pay');
assert.equal(other.find((w) => w.id === 'latest-payslip')!.data.net, 770);
assert.ok(!ids(other).includes('acknowledgements') || other.find((w) => w.id === 'acknowledgements')!.data.items[0].title === 'Omars private pending');

// ---- the manager sees the request waiting, as a relationship, with no extra permission
const mgr = await widgetsOf(MGR);
const approvals = mgr.find((w) => w.id === 'approvals')!;
assert.equal(approvals.data.leave, 1);
assert.equal(approvals.urgent, true);
assert.equal(approvals.group, 'attention');
assert.equal(mgr[0].id, 'approvals', 'what needs a decision comes first');
assert.ok(!ids(await widgetsOf(EMP)).includes('approvals'));

// ---- the approver: review queue, compliance, re-review; not hiring-edit/people/payroll
const appr = await widgetsOf(APPR);
assert.equal(appr.find((w) => w.id === 'review-queue')!.data.count, 1);
assert.equal(appr.find((w) => w.id === 'review-queue')!.data.items[0].title, 'Code of Conduct');
assert.equal(appr.find((w) => w.id === 'rereview-due')!.data.count, 1, 'only the policy due within 30 days');
const compliance = appr.find((w) => w.id === 'compliance')!.data;
assert.deepEqual([compliance.total, compliance.acknowledged, compliance.pending, compliance.rate], [4, 1, 3, 25]);
assert.ok(!ids(appr).includes('my-revisions'), 'approvers do not author, so no revisions inbox');
for (const id of ['people-tasks', 'payroll-run', 'admin'] as WidgetId[]) assert.ok(!ids(appr).includes(id), `approver has no ${id}`);

// ---- HR: own revisions only, hiring that is waiting on them, company tasks, leave approvals queue
const hr = await widgetsOf(HR);
assert.equal(hr.find((w) => w.id === 'my-revisions')!.data.count, 1, 'their own revision request, not Omar\'s');
assert.equal(hr.find((w) => w.id === 'my-revisions')!.data.items[0].title, 'IT Policy');
const hiring = hr.find((w) => w.id === 'hiring')!;
assert.equal(hiring.data.waiting.find((x: any) => x.status === 'PENDING_HR').count, 1, 'only requisitions assigned to them');
assert.ok(!hiring.data.waiting.some((x: any) => x.status === 'PENDING_FOUNDER'), 'founder decisions are not HR\'s');
assert.equal(hr.find((w) => w.id === 'people-tasks')!.data.open, 1, 'one open task company-wide, the finished one is not counted');
assert.ok(ids(hr).includes('approvals'), 'HR can manage leave, so they get the approvals queue');
assert.ok(!ids(hr).includes('review-queue'), 'HR cannot review documents');
assert.ok(!ids(hr).includes('admin'), 'the HR role has no administration permissions');
assert.ok(!ids(hr).includes('payroll-run'), 'HR has no payroll permission');

// ---- payroll viewers and managers
const pay = await widgetsOf(PAY);
assert.equal(pay.find((w) => w.id === 'payroll-run')!.data.run.month, '2026-09');
assert.equal(pay.find((w) => w.id === 'payroll-run')!.urgent, true, 'a draft run is waiting');
assert.ok(ids(await widgetsOf(PM)).includes('payroll-run'));
assert.ok(!ids(await widgetsOf(EMP)).includes('payroll-run'));

// ---- company admin
const adm = await widgetsOf(ADM);
assert.equal(adm.find((w) => w.id === 'admin')!.data.activeEmployees, 8, 'active people only');
assert.ok(!ids(emp).includes('admin'));

// ---- another company sees nothing of Acme
const foreign = await dash(FOREIGN);
assert.equal(foreign.status, 200);
assert.ok(!JSON.stringify(foreign.json).match(/Leave Policy|Code of Conduct|IT Policy|45000|Esha|Acme/), 'no cross-company data');

// ---- a failing module must not take the dashboard down
const realGet = fdb.collection.bind(fdb);
fdb.collection = ((name: string) => {
  if (name === 'payrollRunLines') throw new Error('boom');
  return realGet(name);
}) as any;
const degraded = await widgetsOf(EMP);
assert.ok(ids(degraded).includes('acknowledgements') && ids(degraded).includes('leave-balance'), 'other widgets still load');
assert.ok(!ids(degraded).includes('latest-payslip'));
fdb.collection = realGet as any;

console.log('dashboard tests passed');
