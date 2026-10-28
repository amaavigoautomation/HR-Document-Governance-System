import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLifecycle } from '../api/_lib/lifecycleApi.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';
import { addDays, istToday } from '../shared/leaveEngine.ts';
import { buildOrgTree, earliestLastDay, flattenOrg, noticeServed, noticeShortfall, renderTemplate, tenureText, wouldCycle } from '../shared/lifecycleEngine.ts';

// ---------------------------------------------------------------- engine
assert.equal(noticeServed('2026-01-01', '2026-01-30'), 30);
assert.equal(earliestLastDay('2026-01-01', 30), '2026-01-30');
assert.equal(noticeShortfall(60, 45), 15);
assert.equal(noticeShortfall(30, 45), 0);
assert.equal(tenureText('2022-03-01', '2025-05-31'), '3 years 3 months');
const r = renderTemplate('Hi {{ employee_name }}, joined {{join_date}} {{ctc}}', { employee_name: 'Asha', join_date: '1 May 2024' });
assert.equal(r.text, 'Hi Asha, joined 1 May 2024 {{ctc}}');
assert.deepEqual(r.missing, ['ctc']);
const org = [
  { uid: 'a', name: 'A' }, { uid: 'b', name: 'B', managerUid: 'a' }, { uid: 'c', name: 'C', managerUid: 'b' },
  { uid: 'x', name: 'X', managerUid: 'y' }, { uid: 'y', name: 'Y', managerUid: 'x' }, { uid: 'z', name: 'Z', managerUid: 'gone' },
];
const tree = buildOrgTree(org);
assert.equal(flattenOrg(tree).length, org.length, 'nobody disappears, even in a loop or with an unknown manager');
assert.equal(tree.find((n) => n.person.uid === 'a')!.total, 2);
assert.equal(wouldCycle(org.slice(0, 3), 'a', 'c'), true);
assert.equal(wouldCycle(org.slice(0, 3), 'c', 'a'), false);
assert.equal(wouldCycle(org, 'a', 'a'), true);

// ---------------------------------------------------------------- api
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false, cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const HR = tokenFor('u_hr', ['lifecycle.manage']);
const EMP = tokenFor('u_emp');
const MGR = tokenFor('u_mgr');
const NEW = tokenFor('u_new');
const OTHER = tokenFor('u_other');
const FOREIGN = tokenFor('u_hr', ['lifecycle.manage'], false, 'c2');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
for (const [uid, name, title] of [['u_hr', 'Hema HR', 'HR'], ['u_emp', 'Esha Employee', 'Analyst'], ['u_mgr', 'Mira Manager', 'Lead'], ['u_new', 'Nia New', 'Associate'], ['u_other', 'Omar Other', 'Dev']]) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: uid.toUpperCase(), title });
}
fdb.seed('leaveProfiles', `${CID}__u_emp`, { uid: 'u_emp', companyId: CID, managerUid: 'u_mgr', joinDate: '2022-03-01' });
fdb.seed('leaveProfiles', `${CID}__u_new`, { uid: 'u_new', companyId: CID, managerUid: 'u_mgr', joinDate: addDays(istToday(), 5) });
fdb.seed('leaveProfiles', `${CID}__u_other`, { uid: 'u_other', companyId: CID, joinDate: '2023-01-01' });
fdb.seed('payrollSettings', CID, { company: { legalName: 'Acme Private Limited', address: '1 MG Road, Pune' }, components: [] });
fdb.seed('payrollStructures', `${CID}__u_new`, { companyId: CID, uid: 'u_new', amounts: {} });

const call = (headers: any, method: string, action: string, body: any = {}, query: any = {}) => routeLifecycle({ method, action, headers, body, query });
const ok = async (headers: any, method: string, action: string, body?: any, query?: any) => {
  const x = await call(headers, method, action, body, query);
  assert.equal(x.status, 200, `${action}: ${JSON.stringify(x.json)}`);
  return x.json;
};
const bad = async (headers: any, method: string, action: string, body: any, status: number) => {
  const x = await call(headers, method, action, body);
  assert.equal(x.status, status, `${action} should be ${status}: ${JSON.stringify(x.json)}`);
  return x.json;
};

// ---- onboarding
await bad(EMP, 'POST', 'onboarding-start', { uid: 'u_new' }, 403);
const started = await ok(HR, 'POST', 'onboarding-start', { uid: 'u_new' });
assert.ok(started.created >= 6);
assert.equal((await ok(HR, 'POST', 'onboarding-start', { uid: 'u_new' })).created, 0, 'starting twice adds nothing');
const mine = await ok(NEW, 'GET', 'onboarding-my');
const titles = mine.tasks.map((t: any) => t.title).join('|');
assert.match(titles, /bank details/);
assert.ok(mine.tasks.every((t: any) => t.uid === 'u_new'), 'a joiner sees only their own tasks');
const bankTask = mine.tasks.find((t: any) => t.kind === 'BANK');
await bad(NEW, 'POST', 'task-update', { id: bankTask.id, status: 'DONE' }, 409);
await bad(NEW, 'POST', 'submit-bank', { holder: 'Nia', account: '12ab', ifsc: 'HDFC0001234', bankName: 'HDFC' }, 400);
await bad(NEW, 'POST', 'submit-bank', { holder: 'Nia', account: '123456789012', ifsc: 'BAD', bankName: 'HDFC' }, 400);
const sb = await ok(NEW, 'POST', 'submit-bank', { holder: 'Nia New', account: '123456789012', ifsc: 'hdfc0001234', bankName: 'HDFC Bank' });
assert.equal(sb.copiedToSalary, true);
assert.equal((await fdb.collection('payrollStructures').doc(`${CID}__u_new`).get()).get('ifsc'), 'HDFC0001234');
const after = await ok(NEW, 'GET', 'onboarding-my');
assert.equal(after.tasks.find((t: any) => t.kind === 'BANK').status, 'DONE');
const docsTask = after.tasks.find((t: any) => t.kind === 'DOCUMENT');
await ok(NEW, 'POST', 'task-update', { id: docsTask.id, status: 'DONE' });
const laptop = (await ok(HR, 'GET', 'onboarding')).rows[0].tasks.find((t: any) => t.kind === 'ASSET');
await bad(NEW, 'POST', 'task-update', { id: laptop.id, status: 'DONE' }, 403);
await bad(OTHER, 'POST', 'task-update', { id: docsTask.id, status: 'OPEN' }, 403);
const welcome = (await ok(MGR, 'GET', 'onboarding-my')).tasks.find((t: any) => /Welcome/.test(t.title));
assert.ok(welcome, 'the manager gets the welcome task');
await ok(MGR, 'POST', 'task-update', { id: welcome.id, status: 'DONE' });
await bad(MGR, 'POST', 'task-update', { id: welcome.id, status: 'SKIPPED' }, 403);
const list = await ok(HR, 'GET', 'onboarding');
assert.equal(list.rows[0].open, list.rows[0].total - 3);
assert.ok(list.withoutChecklist.some((p: any) => p.uid === 'u_emp'));
await bad(FOREIGN, 'POST', 'task-update', { id: docsTask.id, status: 'OPEN' }, 404);
await ok(HR, 'POST', 'task-add', { uid: 'u_new', title: 'Collect ID card photo', assignee: 'HR', dueDate: addDays(istToday(), 2) });
await bad(HR, 'POST', 'task-add', { uid: 'u_new', title: '' }, 400);

// ---- exit: resignation -> manager -> HR -> clearance -> complete
await bad(EMP, 'POST', 'exit-resign', { requestedLastDay: addDays(istToday(), -1) }, 400);
const resigned = await ok(EMP, 'POST', 'exit-resign', { requestedLastDay: addDays(istToday(), 29), comments: 'Moving cities' });
assert.equal(resigned.exit.status, 'SUBMITTED');
await bad(EMP, 'POST', 'exit-resign', {}, 409);
await bad(EMP, 'POST', 'exit-decide', { uid: 'u_emp', decision: 'APPROVE' }, 403);
await bad(OTHER, 'POST', 'exit-decide', { uid: 'u_emp', decision: 'APPROVE' }, 403);
assert.equal((await ok(OTHER, 'GET', 'exits')).exits.length, 0, 'strangers see no exits');
assert.equal((await ok(MGR, 'GET', 'exits')).exits.length, 1, 'a manager sees their team');
await ok(MGR, 'POST', 'exit-decide', { uid: 'u_emp', decision: 'APPROVE', note: 'ok' });
assert.equal((await ok(EMP, 'GET', 'exit-my')).exit.status, 'MANAGER_APPROVED');
await bad(MGR, 'POST', 'exit-decide', { uid: 'u_emp', decision: 'APPROVE' }, 403);
const approved = await ok(HR, 'POST', 'exit-decide', { uid: 'u_emp', decision: 'APPROVE', lastWorkingDay: addDays(istToday(), 14), noticeRequiredDays: 30 });
assert.equal(approved.exit.status, 'APPROVED');
assert.equal(approved.exit.noticeServedDays, 15);
assert.equal(approved.exit.noticeShortfallDays, 15);
assert.equal(approved.exit.clearance.length, 5);
assert.equal(approved.exit.clearance[0].ownerUid, 'u_mgr', 'the manager clears the handover item');
await bad(EMP, 'POST', 'exit-clear', { uid: 'u_emp', deptId: 'it', status: 'CLEARED' }, 403);
await bad(MGR, 'POST', 'exit-clear', { uid: 'u_emp', deptId: 'it', status: 'CLEARED' }, 403);
await ok(MGR, 'POST', 'exit-clear', { uid: 'u_emp', deptId: 'manager', status: 'CLEARED' });
await bad(HR, 'POST', 'exit-clear', { uid: 'u_emp', deptId: 'it', status: 'DUES', dues: 0, note: 'laptop' }, 400);
await ok(HR, 'POST', 'exit-clear', { uid: 'u_emp', deptId: 'it', status: 'DUES', dues: 4500, note: 'Charger not returned' });
await bad(MGR, 'POST', 'exit-clear', { uid: 'u_emp', deptId: 'admin', status: 'WAIVED' }, 403);
await bad(HR, 'POST', 'exit-complete', { uid: 'u_emp' }, 409);
for (const d of ['admin', 'finance', 'hr']) await ok(HR, 'POST', 'exit-clear', { uid: 'u_emp', deptId: d, status: 'CLEARED' });
const early = await bad(HR, 'POST', 'exit-complete', { uid: 'u_emp' }, 409);
assert.match(early.error, /last working day/i);
const full = (await ok(HR, 'GET', 'exit', undefined, { uid: 'u_emp' })).exit;
assert.equal(full.totals.dues, 4500);
// the payroll settlement picks up dates and dues
const PM = tokenFor('u_pm', ['payroll.manage']);
fdb.seed('employees', 'u_pm', { companyId: CID, authUid: 'u_pm', name: 'Pia', email: 'u_pm@acme.com', active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Fin', empId: 'PM' });
const sres = await routePayroll({ method: 'GET', action: 'settlement', headers: PM, body: {}, query: { uid: 'u_emp' } });
assert.equal(sres.status, 200, JSON.stringify(sres.json));
assert.equal(sres.json.exitHint.noticeRequiredDays, 30);
assert.equal(sres.json.exitHint.extras[0].amount, 4500);
const done = await ok(HR, 'POST', 'exit-complete', { uid: 'u_emp', early: true });
assert.equal(done.exit.status, 'COMPLETED');
await bad(EMP, 'POST', 'exit-resign', {}, 409);

// reject + withdraw + HR-started + cancel
await ok(OTHER, 'POST', 'exit-resign', {});
assert.equal((await ok(HR, 'GET', 'exits')).exits.find((e: any) => e.uid === 'u_other').status, 'MANAGER_APPROVED', 'no manager: straight to HR');
await ok(OTHER, 'POST', 'exit-withdraw', {});
await ok(HR, 'POST', 'exit-start', { uid: 'u_other', reason: 'TERMINATION', lastWorkingDay: addDays(istToday(), 3) });
await bad(HR, 'POST', 'exit-start', { uid: 'u_other', lastWorkingDay: addDays(istToday(), 3) }, 409);
await bad(HR, 'POST', 'exit-start', { uid: 'u_hr', lastWorkingDay: addDays(istToday(), 3) }, 403);
await ok(HR, 'POST', 'exit-cancel', { uid: 'u_other' });

// ---- letters
const prev = await ok(HR, 'POST', 'letter-preview', { templateId: 'experience', uid: 'u_emp' });
assert.match(prev.text, /Esha Employee/);
assert.match(prev.text, /Acme Private Limited/);
assert.match(prev.text, /a service of \d+ years/);
assert.ok(prev.missing.includes('signatory_name'));
await bad(HR, 'POST', 'letter-issue', { templateId: 'experience', uid: 'u_emp' }, 409);
const issued = await ok(HR, 'POST', 'letter-issue', { templateId: 'experience', uid: 'u_emp', values: { signatory_name: 'Hema HR', signatory_title: 'Head HR' } });
assert.match(issued.letter.number, /^EXP\/\d{4}\/0001$/);
assert.ok(!/\{\{/.test(issued.letter.text));
const second = await ok(HR, 'POST', 'letter-issue', { templateId: 'experience', uid: 'u_mgr', values: { signatory_name: 'H', signatory_title: 'HR', last_working_day: '1 May 2026', join_date: '1 May 2020', tenure: '6 years' } });
assert.match(second.letter.number, /0002$/);
const offer = await ok(HR, 'POST', 'letter-preview', { templateId: 'offer', recipient: 'Zoya Candidate', values: { ctc: '12,00,000' } });
assert.match(offer.text, /Zoya Candidate/);
assert.match(offer.text, /12,00,000/);
assert.equal((await ok(EMP, 'GET', 'my-letters')).letters.length, 1);
assert.equal((await ok(OTHER, 'GET', 'my-letters')).letters.length, 0);
assert.equal((await ok(HR, 'GET', 'letters')).letters.length, 2);
assert.equal((await call(EMP, 'GET', 'letters')).status, 403);
await bad(EMP, 'POST', 'letter-issue', { templateId: 'offer', recipient: 'X' }, 403);
assert.equal((await call(OTHER, 'GET', 'letter', {}, { id: issued.id })).status, 404, 'someone else cannot open a letter');
assert.equal((await call(EMP, 'GET', 'letter', {}, { id: issued.id })).status, 200);
assert.equal((await call(OTHER, 'GET', 'exit', {}, { uid: 'u_mgr' })).status, 403);

// ---- settings
const st = await ok(HR, 'GET', 'settings');
assert.ok(st.settings.taskTemplates.length >= 6);
const edited = { ...st.settings, noticeDays: 60, taskTemplates: st.settings.taskTemplates.map((t: any) => (t.kind === 'BANK' ? { ...t, title: 'Share bank details' } : t)) };
await ok(HR, 'POST', 'save-settings', { settings: edited });
assert.equal((await ok(HR, 'GET', 'settings')).settings.noticeDays, 60);
await bad(HR, 'POST', 'save-settings', { settings: { ...edited, taskTemplates: [] } }, 400);
await bad(HR, 'POST', 'save-settings', { settings: { ...edited, taskTemplates: [{ title: 'Bank', kind: 'BANK', assignee: 'HR' }] } }, 400);
await bad(EMP, 'POST', 'save-settings', { settings: edited }, 403);

// ---- directory and org chart
const dir = await ok(EMP, 'GET', 'directory');
assert.equal(dir.people.length, 6);
assert.equal(dir.people.find((p: any) => p.uid === 'u_mgr').directReports, 2, 'u_emp and u_new report to u_mgr');
assert.equal(dir.canEdit, false);
assert.ok(!('salary' in dir.people[0]));
await bad(EMP, 'POST', 'set-manager', { uid: 'u_other', managerUid: 'u_mgr' }, 403);
await ok(HR, 'POST', 'set-manager', { uid: 'u_other', managerUid: 'u_mgr' });
await bad(HR, 'POST', 'set-manager', { uid: 'u_mgr', managerUid: 'u_other' }, 409);
await bad(HR, 'POST', 'set-manager', { uid: 'u_mgr', managerUid: 'u_mgr' }, 409);
const LEAVE = tokenFor('u_hr', ['leave.manage']);
await ok(LEAVE, 'POST', 'set-manager', { uid: 'u_other', managerUid: '' });
assert.equal((await ok(EMP, 'GET', 'directory')).people.find((p: any) => p.uid === 'u_other').managerUid, '');
assert.equal((await ok(FOREIGN, 'GET', 'directory')).people.length, 0, 'another company sees none of these people');

// ---- employee profile
const myProfile = (await call(EMP, 'GET', 'profile')).json.profile;
assert.equal(myProfile.uid, 'u_emp');
assert.equal(myProfile.reportingManager.uid, 'u_mgr');
assert.equal(myProfile.joinDate, '2022-03-01');
assert.equal(myProfile.firstName, 'Esha');
assert.equal((await call(EMP, 'GET', 'profile', {}, { uid: 'u_mgr' })).status, 403, 'others cannot open someone else\'s profile');
assert.equal((await call(EMP, 'POST', 'profile-save', { uid: 'u_emp', fields: { mobile: '1' } })).status, 403);
await ok(HR, 'POST', 'profile-save', { uid: 'u_emp', fields: { machineCode: '504', mobile: '+91 87799 89858', gender: 'Female', dob: '2000-03-14', confirmationDate: '2022-09-01' } });
const hrView = (await call(HR, 'GET', 'profile', {}, { uid: 'u_emp' })).json;
assert.equal(hrView.profile.machineCode, '504');
assert.equal(hrView.profile.dob, '2000-03-14');
assert.equal(hrView.canEdit, true);
assert.equal((await call(HR, 'POST', 'profile-save', { uid: 'u_emp', fields: { dob: '2999-01-01' } })).status, 400);
assert.equal((await call(HR, 'POST', 'profile-save', { uid: 'u_emp', fields: { gender: 'x' } })).status, 400);
assert.equal((await call(FOREIGN, 'GET', 'profile', {}, { uid: 'u_emp' })).status, 404, 'another company cannot read it');

console.log('lifecycle tests passed');
