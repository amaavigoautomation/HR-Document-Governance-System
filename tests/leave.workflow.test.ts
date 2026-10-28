import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeLeave } from '../api/_lib/leaveApi.ts';
import { addDays, cycleOf, istToday, previousCycle, weekday } from '../shared/leaveEngine.ts';
import { routePayroll } from '../api/_lib/payrollApi.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tokenFor = (uid: string, perms: string[] = [], adm = false) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms, adm })).toString('base64')}` });
const ADMIN = tokenFor('u_admin', [], true);
const PAY = tokenFor('u_hr', ['leave.manage', 'payroll.manage']);
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
process.env.CRON_SECRET = 's3cret';
const today = istToday();
const workday = (from: number) => { let d = addDays(today, from); while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1); return d; };

// The leave year starts this month, so every date used below falls in the same year whenever the test runs.
await ok(HR, 'POST', 'apply-starter', { yearStartMonth: Number(today.slice(5, 7)) });
await ok(HR, 'POST', 'save-profiles', { profiles: [
  { uid: 'u_emp', managerUid: 'u_mgr', gender: 'F', joinDate: '2020-01-01' }, { uid: 'u_mgr', joinDate: '2020-01-01' },
] });
await ok(HR, 'POST', 'run-accrual');
for (const uid of ['u_emp', 'u_mgr']) await ok(HR, 'POST', 'adjust', { uid, typeId: 'cl', delta: 25, note: 'test balance' });

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

// ================================================================ probation and notice-period rules
{
  const st = (await ok(HR, 'GET', 'settings')).settings;
  const next = JSON.parse(JSON.stringify(st));
  next.probationDays = 90;
  next.types.find((t: any) => t.code === 'CL').blockInProbation = true;
  next.types.find((t: any) => t.code === 'CL').blockInNotice = true;
  await ok(HR, 'POST', 'save-settings', { settings: next });
  fdb.seed('employees', 'u_new', { companyId: CID, authUid: 'u_new', name: 'Nia New', email: 'u_new@acme.com', active: true, createdAt: '2020-01-01T00:00:00Z' });
  await ok(HR, 'POST', 'save-profiles', { profiles: [{ uid: 'u_new', managerUid: 'u_mgr', joinDate: addDays(today, -10) }] });
  const NEW = tokenFor('u_new');
  const dn = workday(25);
  const pr = await call(NEW, 'POST', 'apply', { typeId: 'cl', from: dn, to: dn });
  assert.equal(pr.status, 400);
  assert.match(pr.json.error, /probation/);
  assert.equal((await call(EMP, 'POST', 'apply', { typeId: 'cl', from: workday(28), to: workday(28) })).status, 200, 'a long-serving employee is not affected');
  fdb.seed('lifecycleExits', `${CID}__u_emp`, { companyId: CID, uid: 'u_emp', status: 'APPROVED' });
  const nr = await call(EMP, 'POST', 'apply', { typeId: 'cl', from: workday(30), to: workday(30) });
  assert.equal(nr.status, 400);
  assert.match(nr.json.error, /notice period/);
  fdb.seed('lifecycleExits', `${CID}__u_emp`, { companyId: CID, uid: 'u_emp', status: 'WITHDRAWN' });
  assert.equal((await call(EMP, 'POST', 'apply', { typeId: 'cl', from: workday(30), to: workday(30) })).status, 200, 'a withdrawn resignation lifts the restriction');
}

// ================================================================ payroll: leave changed after its month was locked
{
  const prevMonth = (() => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const thisMonth = today.slice(0, 7);
  fdb.seed('payrollRuns', `${CID}__${prevMonth}`, { companyId: CID, month: prevMonth, status: 'LOCKED', overrides: {}, events: [] });
  // a loss-of-pay day in the locked month, recorded by HR afterwards
  let pastDay = `${prevMonth}-10`;
  while (weekday(pastDay) === 0) pastDay = addDays(pastDay, 1);
  const made = await ok(HR, 'POST', 'hr-create', { uid: 'u_emp', typeId: 'lop', from: pastDay, to: pastDay, reason: 'late entry' });
  const corr = fdb.all('leavePayrollInputs').filter((c) => c.requestId === made.id);
  assert.equal(corr.length, 1, 'one correction for the locked month');
  assert.equal(corr[0].lopDelta, 1);
  assert.equal(corr[0].applyMonth, thisMonth, 'carried by the next open month');
  assert.ok((await ok(HR, 'GET', 'exceptions')).items.some((e: any) => e.category === 'PAYROLL_LOCKED_CHANGE'), 'HR is told');
  await ok(HR, 'POST', 'hr-create', { uid: 'u_emp', typeId: 'lop', from: pastDay, to: pastDay, reason: 'again' }).catch(() => undefined);
  assert.equal(fdb.all('leavePayrollInputs').filter((c) => c.requestId === made.id).length, 1, 'never posted twice');
  // the next month's payroll inputs carry it
  const pay = await routePayroll({ method: 'GET', action: 'inputs', query: { month: thisMonth }, body: {}, headers: PAY });
  assert.equal(pay.status, 200, JSON.stringify(pay.json));
  const row = pay.json.rows.find((r: any) => r.uid === 'u_emp');
  assert.equal(row.lop.corrections, 1);
  assert.ok(row.lopDays >= 1);
  assert.equal(pay.json.runStatus, 'NOT_RUN');
  // cancelling that leave gives the day back in the same open month
  await ok(HR, 'POST', 'hr-cancel', { id: made.id, note: 'entered by mistake' });
  const back = fdb.all('leavePayrollInputs').filter((c) => c.requestId === made.id);
  assert.deepEqual(back.map((c) => c.lopDelta).sort(), [-1, 1]);
  const pay2 = await routePayroll({ method: 'GET', action: 'inputs', query: { month: thisMonth }, body: {}, headers: PAY });
  assert.equal(pay2.json.rows.find((r: any) => r.uid === 'u_emp').lop.corrections, 0, 'net effect is zero');
}

// ================================================================ year-end review, carry-forward and encashment
{
  const st = (await ok(HR, 'GET', 'settings')).settings;
  const next = JSON.parse(JSON.stringify(st));
  next.yearEndSignoff = true;
  const e = next.policies[0].entries.find((x: any) => x.typeId === 'cl');
  e.carryForward = true; e.carryCap = 4; e.encashCap = 3;
  await ok(HR, 'POST', 'save-settings', { settings: next });
  const cur = cycleOf(today, next.yearStartMonth);
  const prev = previousCycle(cur, next.yearStartMonth);
  const stamp = new Date().toISOString();
  fdb.seed('leaveLedger', 'seed_open_prev', { companyId: CID, uid: 'u_emp', typeId: 'cl', cycle: prev.key, delta: 10, kind: 'OPENING', date: prev.start, createdAt: stamp });
  const before = fdb.all('leaveLedger').length;
  await ok(HR, 'POST', 'run-accrual');
  assert.equal(fdb.all('leaveLedger').filter((x) => x.kind === 'CARRY_IN').length, 0, 'nothing is carried before sign-off');
  assert.equal(fdb.all('leaveLedger').filter((x) => x.kind === 'LAPSE').length, 0);
  const prevw = await ok(HR, 'GET', 'year-end');
  const row = prevw.rows.find((r: any) => r.uid === 'u_emp' && r.typeId === 'cl');
  assert.equal(row.closing, 10);
  assert.deepEqual([row.carry, row.encash, row.lapse], [4, 3, 3]);
  assert.equal(prevw.closed, null);
  assert.ok((await ok(HR, 'POST', 'run-accrual')) && true);
  const cronRun = await ok({}, 'GET', 'cron', {}, { key: 's3cret' });
  assert.ok((await ok(HR, 'GET', 'exceptions')).items.some((x: any) => x.category === 'YEAR_END_PENDING'), 'HR is reminded to sign off');
  assert.equal((await call(EMP, 'POST', 'year-end-close', {})).status, 403);
  const closed = await ok(HR, 'POST', 'year-end-close', { note: 'checked with finance' });
  assert.equal(closed.summary.encash >= 3, true);
  const after = fdb.all('leaveLedger');
  assert.equal(after.filter((x) => x.uid === 'u_emp' && x.typeId === 'cl' && x.kind === 'CARRY_IN' && x.delta === 4).length, 1, '4 days carried');
  assert.equal(after.filter((x) => x.uid === 'u_emp' && x.kind === 'ENCASH' && x.delta === -3).length, 1, '3 days paid out');
  assert.equal(after.filter((x) => x.uid === 'u_emp' && x.kind === 'LAPSE' && x.delta === -3).length, 1, '3 days lapse');
  assert.equal((await call(HR, 'POST', 'year-end-close', {})).status, 409, 'closing twice is refused');
  await ok(HR, 'POST', 'run-accrual');
  assert.equal(fdb.all('leaveLedger').filter((x) => x.uid === 'u_emp' && x.kind === 'CARRY_IN' && x.delta === 4).length, 1, 'a rerun never carries twice');
  const prevCycleBalance = fdb.all('leaveLedger').filter((x) => x.uid === 'u_emp' && x.typeId === 'cl' && x.cycle === prev.key).reduce((n, x) => n + x.delta, 0);
  assert.equal(prevCycleBalance, 0, 'the closed year ends at zero');
  assert.equal((await call(HR, 'POST', 'adjust', { uid: 'u_emp', typeId: 'cl', delta: 1, note: 'late fix', date: prev.end })).status, 409, 'a closed year cannot be changed');
  assert.ok(before > 0);
}

// ================================================================ private documents
const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');
const d3 = workday(40);
assert.equal((await call(EMP, 'POST', 'apply', { typeId: 'cl', from: d3, to: d3, docData: 'data:text/html;base64,PGI+', docName: 'x' })).status, 400, 'only PDF or JPEG');
const withDoc = await ok(EMP, 'POST', 'apply', { typeId: 'cl', from: d3, to: d3, docData: pdf, docName: 'note.pdf' });
const listed = (await ok(EMP, 'GET', 'my-requests')).items.find((r: any) => r.id === withDoc.id);
assert.equal(listed.hasPrivateDoc, true);
assert.equal(JSON.stringify(listed).includes('base64'), false, 'the file itself is never in a list');
assert.equal((await ok(EMP, 'GET', 'doc-get', undefined, { id: withDoc.id })).dataUrl, pdf, 'the employee can open it');
assert.equal((await ok(HR, 'GET', 'doc-get', undefined, { id: withDoc.id })).name, 'note.pdf', 'HR can open it');
assert.equal((await call(MGR, 'GET', 'doc-get', undefined, { id: withDoc.id })).status, 403, 'the manager cannot open it');
assert.equal((await ok(MGR, 'GET', 'inbox')).leaves.find((l: any) => l.id === withDoc.id).hasPrivateDoc, true, 'but sees one is attached');
assert.ok(fdb.all('leaveAudit').some((a) => a.action === 'DOCUMENT_ACCESS_DENIED'), 'refused access is logged');
assert.ok(fdb.all('leaveAudit').some((a) => a.action === 'DOCUMENT_OPENED'), 'HR access is logged');

// ================================================================ policy versions
let st = await ok(HR, 'GET', 'policy-state');
const v0 = st.version; // earlier sections changed settings, so count from here
assert.ok(v0 >= 1);
assert.equal(st.versions.length, v0, 'every version is archived');
assert.equal((await call(EMP, 'GET', 'policy-state')).status, 403, 'employees cannot see policy history');

// a real change through the direct save bumps the version and records what changed; a no-op does not
const live = (await ok(HR, 'GET', 'settings')).settings;
const same = await ok(HR, 'POST', 'save-settings', { settings: live });
assert.equal(same.version, v0, 'no change, no new version');
const tweaked = JSON.parse(JSON.stringify(live));
tweaked.policies[0].entries[0].quota += 3;
const saved = await ok(HR, 'POST', 'save-settings', { settings: tweaked });
assert.equal(saved.version, v0 + 1);
assert.ok(saved.changes.some((t: string) => /entitlement/.test(t)), 'change list explains the entitlement change');
st = await ok(HR, 'GET', 'policy-state');
assert.equal(st.version, v0 + 1);
assert.equal(st.versions.length, v0 + 1);

// an old approved request keeps the version it was made under
const oldReq = (await ok(EMP, 'GET', 'my-requests')).items[0];
assert.ok(oldReq.policyVersion < v0 + 1, 'made under an earlier version');

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
assert.equal(st.version, v0 + 2);
assert.equal(st.draft, null);
assert.equal(st.governanceRef, 'AMA-HR-LEAVE-001 v2');
assert.ok((await ok(HR, 'GET', 'policy-version', undefined, { v: String(v0 + 2) })).version.settings.policies.length > 0);

// a future-dated change waits for its date
const future = JSON.parse(JSON.stringify(edit));
future.policies[0].entries[0].quota += 1;
await ok(HR, 'POST', 'policy-draft-save', { settings: future, governanceRef: 'AMA-HR-LEAVE-001 v3', effectiveFrom: addDays(today, 30) });
await ok(HR, 'POST', 'policy-submit');
assert.equal((await ok(ADMIN, 'POST', 'policy-decide', { decision: 'APPROVE' })).status, 'SCHEDULED');
assert.equal((await ok(HR, 'GET', 'policy-state')).version, v0 + 2, 'not live yet');

// every policy event is in the company audit trail
assert.ok(fdb.all('leaveAudit').some((a) => a.action === 'POLICY_PUBLISHED'));

// ================================================================ exceptions, audit trail, notifications, dashboard
const inboxMgr = (await ok(MGR, 'GET', 'notifications')).items;
assert.ok(inboxMgr.some((n: any) => /requested/.test(n.title)), 'the manager gets an in-app message for a new request');
const empNotes = await ok(EMP, 'GET', 'notifications');
assert.ok(empNotes.unread > 0, 'the employee was told about the question and the decision');
await ok(EMP, 'POST', 'notifications-read', { all: true });
assert.equal((await ok(EMP, 'GET', 'notifications')).unread, 0);

let exc = await ok(HR, 'GET', 'exceptions');
const dM = workday(15);
await ok(MGR, 'POST', 'apply', { typeId: 'cl', from: dM, to: dM });
exc = await ok(HR, 'GET', 'exceptions');
assert.ok(exc.items.some((e: any) => e.category === 'NO_MANAGER'), 'a request from someone with no manager is flagged for HR');
assert.equal((await call(EMP, 'GET', 'exceptions')).status, 403);
assert.equal((await call(EMP, 'GET', 'audit-log')).status, 403);

// an overdue request: reminder, escalation, an exception for HR, and no repeats on a second run
const stale = workday(60);
const sr = await ok(EMP, 'POST', 'apply', { typeId: 'cl', from: stale, to: stale, reason: 'old' });
await fdb.collection('leaveRequests').doc(sr.id).update({ createdAt: new Date(Date.now() - 9 * 86400000).toISOString() });
process.env.CRON_SECRET = 's3cret';
const run1 = await ok({}, 'GET', 'cron', {}, { key: 's3cret' });
assert.ok(run1.companies[0].escalated >= 1, 'overdue request escalated');
exc = await ok(HR, 'GET', 'exceptions');
const overdue = exc.items.find((e: any) => e.category === 'OVERDUE_APPROVAL' && e.requestId === sr.id);
assert.ok(overdue, 'the overdue request is in the exception register');
const run2 = await ok({}, 'GET', 'cron', {}, { key: 's3cret' });
assert.equal(run2.companies[0].escalated, 0, 'a second run does not escalate again');
assert.equal(exc.items.filter((e: any) => e.category === 'OVERDUE_APPROVAL' && e.requestId === sr.id).length, 1, 'one open item per problem');
assert.equal((await call(HR, 'POST', 'exception-resolve', { id: overdue.id })).status, 400, 'resolution needed');
await ok(HR, 'POST', 'exception-resolve', { id: overdue.id, resolution: 'Spoke to the manager' });
assert.equal((await ok(HR, 'GET', 'exceptions')).items.find((e: any) => e.id === overdue.id).status, 'RESOLVED');

// HR adjustments leave an audit entry with who, what and why
await ok(HR, 'POST', 'adjust', { uid: 'u_emp', typeId: 'cl', delta: 1, note: 'goodwill' });
const trail = (await ok(HR, 'GET', 'audit-log')).items;
assert.ok(trail.some((a: any) => a.action === 'BALANCE_ADJUSTED' && a.newValue.note === 'goodwill' && a.actor === 'Hema HR'));
assert.ok(trail.some((a: any) => a.action === 'PROFILE_CHANGED'), 'manager/policy assignments are audited');

// dashboard: HR sees names, the management view only counts
const dash = await ok(HR, 'GET', 'leave-summary');
assert.ok(dash.headcount >= 3 && typeof dash.pendingApprovals === 'number');
const mgmt = await ok(HR, 'GET', 'leave-summary', undefined, { view: 'management' });
assert.equal(mgmt.onLeave, undefined, 'management view carries no names');
assert.equal((await call(EMP, 'GET', 'leave-summary')).status, 403);

// --- helpers that explain and prepare; they never decide
delete process.env.OPENAI_API_KEY;
const ans = await ok(EMP, 'POST', 'assist-ask', { question: 'How much notice does casual leave need?' });
assert.equal(ans.answered, true);
assert.match(ans.policyReference, /Leave policy v\d+/);
assert.equal(ans.aiWording, false, 'no key, no model: plain wording');
assert.equal(ans.requiresHumanDecision, true);
assert.equal((await ok(EMP, 'POST', 'assist-ask', { question: 'what is the CEO salary' })).answered, false);
assert.equal((await call(EMP, 'POST', 'assist-ask', { question: '' })).status, 400);
const dr = await ok(EMP, 'POST', 'assist-draft', { text: 'casual leave tomorrow' });
assert.equal(dr.draft.typeId, 'cl');
assert.equal(dr.draft.from, addDays(today, 1));
const before = (await ok(EMP, 'GET', 'my-requests')).items.length;
assert.equal((await ok(EMP, 'GET', 'my-requests')).items.length, before, 'a draft creates nothing');
const cover = await ok(MGR, 'GET', 'assist-cover', undefined, { from: today, to: addDays(today, 40) });
assert.ok(cover.teamSize >= 1);
assert.ok(Array.isArray(cover.gaps));
const { polishWording } = await import('../api/_lib/leaveAi.ts');
assert.deepEqual(await polishWording('3 days'), { text: '3 days', ai: false });
// with a key, a rewrite that changes a number is thrown away; one that keeps the figures is used
process.env.OPENAI_API_KEY = 'k';
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'You get 5 days.' } }] }) })) as any;
assert.equal((await polishWording('Casual leave: 3 days.')).ai, false, 'changed figure rejected');
globalThis.fetch = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'You can take 3 days.' } }] }) })) as any;
assert.equal((await polishWording('Casual leave: 3 days.')).ai, true);
globalThis.fetch = (async () => { throw new Error('down'); }) as any;
assert.equal((await polishWording('Casual leave: 3 days.')).text, 'Casual leave: 3 days.');
globalThis.fetch = realFetch;
delete process.env.OPENAI_API_KEY;

console.log('leave workflow tests passed');
