import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLifecycle } from '../api/_lib/lifecycleApi.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';
import { durationText } from '../shared/employeeQualification.ts';
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

// ---- employee identity
{
  const list = async (h: any, uid?: string) => (await call(h, 'GET', 'identity', {}, uid ? { uid } : {})).json;
  const first = await list(EMP);
  assert.equal(first.items.length, 5);
  assert.ok(first.items.every((i: any) => i.number === '' && i.status === ''));
  assert.equal((await call(EMP, 'POST', 'identity-save', { type: 'PAN', number: 'bad' })).status, 400);
  assert.equal((await call(EMP, 'POST', 'identity-save', { type: 'AADHAAR', number: '1234 5678 9012' })).status, 400, 'aadhaar cannot start with 0 or 1');
  assert.equal((await call(EMP, 'POST', 'identity-save', { type: 'PAN', number: 'pawps4272m' })).json.status, 'PENDING');
  let pan = (await list(EMP)).items.find((i: any) => i.type === 'PAN');
  assert.equal(pan.pendingNumber, 'PAWPS4272M');
  assert.equal(pan.number, '', 'nothing approved yet');
  assert.equal((await call(OTHER, 'GET', 'identity', {}, { uid: 'u_emp' })).status, 403);
  assert.equal((await call(EMP, 'POST', 'identity-decide', { uid: 'u_emp', type: 'PAN', approve: true })).status, 403);
  assert.equal((await call(HR, 'POST', 'identity-decide', { uid: 'u_emp', type: 'PAN', approve: false })).status, 400, 'a reason is needed');
  await ok(HR, 'POST', 'identity-decide', { uid: 'u_emp', type: 'PAN', approve: true });
  pan = (await list(HR, 'u_emp')).items.find((i: any) => i.type === 'PAN');
  assert.equal(pan.number, 'PAWPS4272M'); assert.equal(pan.status, 'APPROVED'); assert.equal(pan.pendingNumber, '');
  // a later change keeps the approved number until HR decides; a rejection restores it
  await ok(EMP, 'POST', 'identity-save', { type: 'PAN', number: 'ABCDE1234F' });
  pan = (await list(EMP)).items.find((i: any) => i.type === 'PAN');
  assert.equal(pan.number, 'PAWPS4272M'); assert.equal(pan.pendingNumber, 'ABCDE1234F');
  await ok(HR, 'POST', 'identity-decide', { uid: 'u_emp', type: 'PAN', approve: false, note: 'Does not match the card' });
  pan = (await list(EMP)).items.find((i: any) => i.type === 'PAN');
  assert.equal(pan.number, 'PAWPS4272M'); assert.equal(pan.pendingNumber, ''); assert.equal(pan.note, 'Does not match the card');
  assert.equal((await call(HR, 'POST', 'identity-decide', { uid: 'u_emp', type: 'PAN', approve: true })).status, 409, 'nothing is waiting any more');
  // HR's own entry is final
  assert.equal((await call(HR, 'POST', 'identity-save', { uid: 'u_emp', type: 'PASSPORT', number: 'A1234567' })).json.status, 'APPROVED');
  assert.equal((await call(EMP, 'POST', 'identity-save', { uid: 'u_mgr', type: 'PASSPORT', number: 'A1234567' })).status, 403);
  assert.equal((await call(FOREIGN, 'GET', 'identity', {}, { uid: 'u_emp' })).status, 404, 'another company cannot read it');
}

// ---- employee personal information
{
  const get = async (h: any, uid?: string) => (await call(h, 'GET', 'personal', {}, uid ? { uid } : {})).json;
  const empty = await get(EMP);
  assert.equal(empty.values.permanentAddress, ''); assert.equal(empty.values.airPassage, false);
  assert.equal((await call(EMP, 'POST', 'personal-save', { values: { personalNo: 'abc' } })).status, 400);
  assert.equal((await call(EMP, 'POST', 'personal-save', { values: { personalEmail: 'nope' } })).status, 400);
  assert.equal((await call(EMP, 'POST', 'personal-save', { values: { anniversaryDate: '2999-01-01' } })).status, 400);
  await ok(EMP, 'POST', 'personal-save', { values: { permanentAddress: '1 MG Road, Pune', personalNo: '+91 98765 43210', madeUp: 'ignored', emg1Mobile1: '9999999999', airPassage: true, anniversaryDate: '2015-02-14' } });
  const mine2 = await get(EMP);
  assert.equal(mine2.values.permanentAddress, '1 MG Road, Pune'); assert.equal(mine2.values.emg1Mobile1, '9999999999');
  assert.equal(mine2.values.airPassage, true); assert.equal(mine2.values.anniversaryDate, '2015-02-14');
  assert.equal(mine2.values.madeUp, undefined, 'only known fields are kept');
  await ok(EMP, 'POST', 'personal-save', { values: { postalAddress: 'PO Box 4' } });
  assert.equal((await get(EMP)).values.permanentAddress, '1 MG Road, Pune', 'saving one tab leaves the others alone');
  assert.equal((await call(OTHER, 'GET', 'personal', {}, { uid: 'u_emp' })).status, 403);
  assert.equal((await call(OTHER, 'POST', 'personal-save', { uid: 'u_emp', values: { contactCity: 'X' } })).status, 403);
  assert.equal((await get(HR, 'u_emp')).values.contactCity, '');
  await ok(HR, 'POST', 'personal-save', { uid: 'u_emp', values: { contactCity: 'Pune' } });
  assert.equal((await get(EMP)).values.contactCity, 'Pune');
  assert.equal((await call(FOREIGN, 'GET', 'personal', {}, { uid: 'u_emp' })).status, 404, 'another company cannot read it');
  // saving the anniversary must not undo the person's Home choices or the birth date HR entered
  await ok(HR, 'POST', 'profile-save', { uid: 'u_emp', fields: { dob: '2000-03-14' } });
  await ok(EMP, 'POST', 'personal-save', { values: { anniversaryDate: '2016-02-14' } });
  assert.equal((await call(HR, 'GET', 'profile', {}, { uid: 'u_emp' })).json.profile.dob, '2000-03-14');
}

// ---- employee family
{
  const list = async (h: any, uid?: string) => (await call(h, 'GET', 'family', {}, uid ? { uid } : {})).json.members;
  assert.equal((await list(EMP)).length, 0);
  assert.equal((await call(EMP, 'POST', 'family-save', { member: { name: '', relation: 'Spouse' } })).status, 400);
  assert.equal((await call(EMP, 'POST', 'family-save', { member: { name: 'Asha', relation: 'Cousin' } })).status, 400);
  assert.equal((await call(EMP, 'POST', 'family-save', { member: { name: 'Asha', relation: 'Spouse', dob: '2999-01-01' } })).status, 400);
  assert.equal((await call(EMP, 'POST', 'family-save', { member: { name: 'Asha', relation: 'Spouse', contactNo: 'call me' } })).status, 400);
  const added = (await call(EMP, 'POST', 'family-save', { member: { title: 'Mrs', name: 'Asha', relation: 'Spouse', gender: 'Female', maritalStatus: 'Married', marriageDate: '2015-02-14', healthInsurance: true, insuranceNumber: 'POL-1', isDependent: true, dob: '1990-05-05' } })).json;
  const kid = (await call(EMP, 'POST', 'family-save', { member: { name: 'Ravi', relation: 'Son', maritalStatus: 'Single', marriageDate: '2020-01-01', healthInsurance: false, insuranceNumber: 'LEFT-OVER' } })).json;
  let rows = await list(EMP);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Asha'); assert.equal(rows[1].marriageDate, '', 'no marriage date for someone single'); assert.equal(rows[1].insuranceNumber, '', 'no insurance number when not insured');
  assert.equal((await call(OTHER, 'GET', 'family', {}, { uid: 'u_emp' })).status, 403);
  assert.equal((await call(OTHER, 'POST', 'family-save', { uid: 'u_emp', member: { name: 'X', relation: 'Son' } })).status, 403);
  assert.equal((await call(OTHER, 'POST', 'family-delete', { id: added.id })).status, 404, 'cannot reach another person\'s record by id');
  await ok(EMP, 'POST', 'family-save', { id: added.id, member: { name: 'Asha S', relation: 'Spouse' } });
  assert.equal((await list(HR, 'u_emp')).find((x: any) => x.id === added.id).name, 'Asha S');
  await ok(HR, 'POST', 'family-save', { uid: 'u_emp', member: { name: 'Meera', relation: 'Mother' } });
  assert.equal((await list(EMP)).length, 3);
  await ok(EMP, 'POST', 'family-delete', { id: kid.id });
  assert.equal((await list(EMP)).length, 2);
  assert.equal((await call(EMP, 'POST', 'family-save', { id: kid.id, member: { name: 'Ravi', relation: 'Son' } })).status, 404, 'a removed member cannot be edited');
  assert.equal((await call(FOREIGN, 'GET', 'family', {}, { uid: 'u_emp' })).status, 404, 'another company cannot read it');
  for (let i = 0; i < 30; i++) { const r = await call(EMP, 'POST', 'family-save', { member: { name: `P${i}`, relation: 'Other' } }); if (r.status === 400) { assert.match(r.json.error, /up to 25/); break; } }
}

// ---- identity photos
{
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
  const files = async (h: any, uid?: string) => (await call(h, 'GET', 'identity', {}, uid ? { uid } : {})).json.items.find((i: any) => i.type === 'AADHAAR').files;
  assert.equal((await call(EMP, 'POST', 'identity-file-add', { type: 'AADHAAR', dataUrl: 'data:image/png;base64,AAAA' })).status, 400, 'jpeg only');
  assert.equal((await call(EMP, 'POST', 'identity-file-add', { type: 'AADHAAR', dataUrl: 'data:image/jpeg;base64,' + Buffer.from('not an image at all').toString('base64') })).status, 400, 'real bytes are checked');
  assert.equal((await call(EMP, 'POST', 'identity-file-add', { type: 'AADHAAR', dataUrl: jpeg + 'A'.repeat(950000) })).status, 400, 'too large');
  assert.equal((await call(EMP, 'POST', 'identity-file-add', { type: 'NOPE', dataUrl: jpeg })).status, 400);
  const a = (await call(EMP, 'POST', 'identity-file-add', { type: 'AADHAAR', dataUrl: jpeg })).json;
  await ok(EMP, 'POST', 'identity-file-add', { type: 'AADHAAR', dataUrl: jpeg });
  assert.equal((await call(EMP, 'POST', 'identity-file-add', { type: 'AADHAAR', dataUrl: jpeg })).status, 400, 'two photos per document');
  assert.equal((await files(EMP)).length, 2);
  assert.ok(!JSON.stringify((await call(EMP, 'GET', 'identity')).json).includes('base64'), 'listing never carries the pictures');
  assert.equal((await call(EMP, 'GET', 'identity-file', {}, { id: a.id })).json.dataUrl, jpeg);
  assert.equal((await call(HR, 'GET', 'identity-file', {}, { id: a.id, uid: 'u_emp' })).json.dataUrl, jpeg, 'HR can open it');
  assert.equal((await call(OTHER, 'GET', 'identity-file', {}, { id: a.id, uid: 'u_emp' })).status, 403);
  assert.equal((await call(OTHER, 'GET', 'identity-file', {}, { id: a.id })).status, 404, 'cannot reach it by id either');
  assert.equal((await call(FOREIGN, 'GET', 'identity-file', {}, { id: a.id, uid: 'u_emp' })).status, 404, 'another company cannot read it');
  assert.equal((await call(OTHER, 'POST', 'identity-file-delete', { id: a.id })).status, 404);
  await ok(EMP, 'POST', 'identity-file-delete', { id: a.id });
  assert.equal((await files(EMP)).length, 1);
  assert.equal((await call(EMP, 'GET', 'identity-file', {}, { id: a.id })).status, 404, 'gone for good');
}

// ---- employee qualifications
{
  const list = async (h: any, uid?: string) => (await call(h, 'GET', 'qualifications', {}, uid ? { uid } : {})).json.items;
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
  const bad1 = (item: any) => call(EMP, 'POST', 'qualification-save', { item });
  const good = { qualification: 'Master\'s degree', universityName: 'Mumbai University', instituteName: 'TIMS', fromDate: '2022-07-01', toDate: '2024-06-30', dateOfPassing: '2024-07-15', percentage: '78.5', status: 'Completed', isHighest: true };
  assert.deepEqual(await list(EMP), []);
  assert.equal((await bad1({ ...good, qualification: '' })).status, 400);
  assert.equal((await bad1({ ...good, qualification: 'Wizard' })).status, 400);
  assert.equal((await bad1({ ...good, universityName: '' })).status, 400);
  assert.equal((await bad1({ ...good, percentage: '101' })).status, 400);
  assert.equal((await bad1({ ...good, toDate: '2020-01-01' })).status, 400, 'end before start');
  assert.equal((await bad1({ ...good, dateOfPassing: '2999-01-01' })).status, 400);
  assert.equal((await bad1({ ...good, dateOfPassing: '' })).status, 400, 'completed needs a passing date');
  const master = (await bad1(good)).json;
  const bach = (await bad1({ ...good, qualification: 'Bachelor\'s degree', dateOfPassing: '2022-06-20', isHighest: false })).json;
  const pursuing = (await bad1({ qualification: 'Doctorate', universityName: 'IIT', status: 'Pursuing', dateOfPassing: '2030-01-01', isHighest: false })).json;
  let rows = await list(EMP);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, pursuing.id, 'still-running course sorts first'); assert.equal(rows[0].dateOfPassing, '', 'no passing date while pursuing');
  assert.equal(rows[1].id, master.id);
  await ok(EMP, 'POST', 'qualification-save', { id: bach.id, item: { ...good, qualification: 'Bachelor\'s degree', dateOfPassing: '2022-06-20', isHighest: true } });
  rows = await list(EMP);
  assert.deepEqual(rows.filter((r: any) => r.isHighest).map((r: any) => r.id), [bach.id], 'only one is the highest');
  assert.equal((await call(OTHER, 'GET', 'qualifications', {}, { uid: 'u_emp' })).status, 403);
  assert.equal((await call(OTHER, 'POST', 'qualification-delete', { id: bach.id })).status, 404, 'not reachable by id');
  assert.equal((await call(FOREIGN, 'GET', 'qualifications', {}, { uid: 'u_emp' })).status, 404);
  // certificate photo
  assert.equal((await call(EMP, 'POST', 'qualification-doc-set', { id: bach.id, dataUrl: 'data:image/png;base64,AAAA' })).status, 400);
  await ok(EMP, 'POST', 'qualification-doc-set', { id: bach.id, dataUrl: jpeg });
  assert.equal((await list(EMP)).find((r: any) => r.id === bach.id).hasDocument, true);
  assert.ok(!JSON.stringify(await list(EMP)).includes('base64'), 'listing never carries the pictures');
  assert.equal((await call(HR, 'GET', 'qualification-doc', {}, { id: bach.id, uid: 'u_emp' })).json.dataUrl, jpeg);
  assert.equal((await call(OTHER, 'GET', 'qualification-doc', {}, { id: bach.id, uid: 'u_emp' })).status, 403);
  await ok(EMP, 'POST', 'qualification-doc-delete', { id: bach.id });
  assert.equal((await list(EMP)).find((r: any) => r.id === bach.id).hasDocument, false);
  assert.equal((await call(EMP, 'GET', 'qualification-doc', {}, { id: bach.id })).status, 404);
  await ok(EMP, 'POST', 'qualification-save', { item: good });
  await ok(EMP, 'POST', 'qualification-delete', { id: master.id });
  assert.equal((await list(EMP)).length, 3);
  assert.equal(durationText('2022-07-01', '2024-06-30'), '1 year 11 months');
  assert.equal(durationText('2020-01-01', '2020-01-10'), 'Less than a month');
  assert.equal(durationText('2024-01-01', '2023-01-01'), '');
}

// ---- separation screen
{
  fdb.seed('employees', 'u_sep', { companyId: CID, authUid: 'u_sep', name: 'Sia Separating', email: 'u_sep@acme.com', active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: 'Ops', empId: 'U_SEP', title: 'Dev' });
  fdb.seed('leaveProfiles', `${CID}__u_sep`, { uid: 'u_sep', companyId: CID, joinDate: '2023-01-01' });
  const SEP = tokenFor('u_sep');
  const sep = async (h: any, uid?: string) => call(h, 'GET', 'separation', {}, uid ? { uid } : {});
  const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');
  const first = (await sep(SEP)).json;
  assert.equal(first.isSelf, true); assert.equal(first.exit, null); assert.equal(first.file, null);
  assert.equal(first.employee.joinDate, '2023-01-01'); assert.equal(first.noticeDays, 60, 'notice days come from the settings saved above');
  assert.equal((await call(SEP, 'POST', 'separation-file-set', { dataUrl: pdf, fileName: 'letter.pdf' })).status, 409, 'declare first');
  assert.equal((await sep(SEP, 'u_emp')).status, 403);
  assert.equal((await sep(HR, 'u_sep')).json.canDeclareForOthers, true);
  const r = (await call(SEP, 'POST', 'exit-resign', { requestedLastDay: addDays(istToday(), 70), comments: 'Moving on' })).json;
  assert.match(r.exit.docNo, /^SEP-\d{6}-[A-Z0-9]{4}$/);
  const after = (await sep(SEP)).json;
  assert.equal(after.exit.docNo, r.exit.docNo);
  assert.equal((await call(SEP, 'POST', 'separation-file-set', { dataUrl: 'data:application/pdf;base64,' + Buffer.from('not a pdf').toString('base64'), fileName: 'x.pdf' })).status, 400, 'real bytes are checked');
  assert.equal((await call(SEP, 'POST', 'separation-file-set', { dataUrl: 'data:text/html;base64,AAAA', fileName: 'x.html' })).status, 400);
  assert.equal((await call(SEP, 'POST', 'separation-file-set', { dataUrl: pdf + 'A'.repeat(950000), fileName: 'big.pdf' })).status, 400);
  await ok(SEP, 'POST', 'separation-file-set', { dataUrl: pdf, fileName: 'letter.pdf' });
  assert.equal((await sep(SEP)).json.file.name, 'letter.pdf');
  assert.ok(!JSON.stringify((await sep(SEP)).json).includes('base64'), 'the screen data never carries the document');
  assert.equal((await call(SEP, 'GET', 'separation-file')).json.dataUrl, pdf);
  assert.equal((await call(HR, 'GET', 'separation-file', {}, { uid: 'u_sep' })).json.dataUrl, pdf, 'HR can open it');
  assert.equal((await call(EMP, 'GET', 'separation-file', {}, { uid: 'u_sep' })).status, 403);
  assert.equal((await call(FOREIGN, 'GET', 'separation-file', {}, { uid: 'u_sep' })).status, 404, 'another company cannot read it');
  assert.equal((await call(EMP, 'POST', 'separation-file-delete', { uid: 'u_sep' })).status, 403);
  await ok(SEP, 'POST', 'separation-file-delete', {});
  assert.equal((await sep(SEP)).json.file, null);
  // HR declares for someone else
  const started = (await call(HR, 'POST', 'exit-start', { uid: 'u_new', reason: 'TERMINATION', lastWorkingDay: addDays(istToday(), 14) })).json;
  assert.match(started.exit.docNo, /^SEP-/);
  assert.equal((await sep(HR, 'u_new')).json.exit.status, 'APPROVED');
  await ok(HR, 'POST', 'separation-file-set', { uid: 'u_new', dataUrl: pdf, fileName: 'notice.pdf' });
  assert.equal((await call(EMP, 'POST', 'separation-file-set', { uid: 'u_new', dataUrl: pdf, fileName: 'x.pdf' })).status, 403);
}

console.log('lifecycle tests passed');
