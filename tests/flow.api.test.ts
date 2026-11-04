import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeFlow, advanceRun, sweepFlows, __setMailer, __setNow } from '../api/_lib/flowApi.ts';
import { createApplication, getApplication, normalizeApplicationInput } from '../api/_lib/recruitmentData.ts';
import { putItem, listItems } from '../api/_lib/pipelineApi.ts';
import { makeStep, type FlowStep } from '../shared/flowEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const sent: { to: string; subject: string; body: string }[] = [];
let mailFails = false;
__setMailer(async (p) => { if (mailFails) return { ok: false, error: 'mail server down' }; sent.push({ to: p.to, subject: p.subject, body: p.body }); return { ok: true }; });
let clock = Date.now();   // real time, because applications stamp their own creation time
__setNow(() => new Date(clock));

const nowIso = () => new Date(clock).toISOString();
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['app.manage']); const BOSS = tok('u_boss'); const RANDOM = tok('u_x'); const OTHER = tok('o1', ['app.manage'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeFlow({ method, action, headers: h, body, query }) as Promise<any>;
const get = (h: any, a: string, q: any = {}) => call(h, 'GET', a, {}, q);
const post = (h: any, a: string, b: any = {}) => call(h, 'POST', a, b);
const okc = (r: any, m = '') => assert.equal(r.status, 200, `${m} ${JSON.stringify(r.json)}`);

const emp = (id: string, name: string, cid = CID) => fdb.seed('employees', id, { companyId: cid, authUid: id, name, email: `${id}@acme.com`, active: true, title: 'Staff' });
emp('u_hr', 'Priya HR'); emp('u_boss', 'Bo Boss'); emp('u_x', 'Random'); emp('o1', 'Other HR', 'c2');
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
fdb.seed('companies', 'c2', { status: 'ACTIVE', name: 'Other Co' });

const newApp = async (name: string, email = `${name.toLowerCase()}@mail.com`, ctc: number | null = 10) => {
  const { value } = normalizeApplicationInput({ name, email, designation: 'Designer', experience: '3 years' });
  const r = await createApplication(CID, { ...value!, ...(ctc !== null ? { expectedCtcLpa: ctc } : {}) } as any, 'MANUAL');
  return r.id;
};
const runOf = async (appId: string) => (await listItems(CID, 'flowRun')).find((r) => r.applicationId === appId) as any;
const myTasks = async (h: any) => (await get(h, 'flow-my-tasks')).json.open as any[];

async function main() {
  // ---- access
  assert.equal((await call({}, 'GET', 'flow-state')).status, 401);
  assert.equal((await post(RANDOM, 'flow-save', { name: 'x', steps: [] })).status, 403, 'only hiring managers build flows');
  assert.equal((await get(RANDOM, 'flow-runs')).status, 403);
  assert.equal((await post(HR, 'flow-state')).status, 405);
  assert.equal(await routeFlow({ method: 'GET', action: 'nope', headers: HR, query: {} }), null);

  // ---- an applicant who arrives before any flow exists is untouched
  const early = await newApp('Early');
  assert.equal(await runOf(early), undefined, 'no flow, no run');

  // ---- build: an unfinished draft saves, but cannot be published
  okc(await post(HR, 'flow-start-standard'));
  let st = (await get(HR, 'flow-state')).json;
  assert.equal(st.active, null); assert.equal(st.draft.steps.length, 5);
  const bad = await post(HR, 'flow-save', { name: '', steps: [{ type: 'screen', title: 'Screen', settings: {} }] });
  okc(bad); assert.ok(bad.json.problems.length >= 2);
  const pub = await post(HR, 'flow-activate');
  assert.equal(pub.status, 400); assert.ok(pub.json.problems.length > 0, 'cannot publish with problems');

  // ---- a custom flow: score, choose a path, phone screen, boss approves, interview, email, wait 2 days, offer, onboard, reject
  const steps: FlowStep[] = [];
  const add = (t: any, over: any = {}) => { steps.push(makeStep(t, steps, over)); return steps[steps.length - 1]; };
  const hr = { ownerUid: 'u_hr', ownerName: 'Priya HR' };
  add('ai_score');
  const cond = add('condition', { settings: { field: 'expectedCtcLpa', op: '<=', value: 20 } });
  add('screen', hr);
  add('approval', { ownerUid: 'u_boss', settings: { question: 'Approve this candidate?' } });
  add('interview', { ...hr, settings: { round: 'Round 1', minAverage: 3 } });
  add('email', { settings: { subject: 'Next steps for {{position}}', body: 'Hi {{name}}, we liked you. - {{hrName}}' } });
  add('wait', { settings: { days: 2 } });
  add('offer', hr); add('onboard', hr);
  const rej = add('reject', { settings: { sendEmail: true, subject: 'Your application', body: 'Sorry {{name}}.' } });
  cond.ifYes = 'next'; cond.ifNo = rej.id;
  const saved = await post(HR, 'flow-save', { name: 'Acme hiring', steps });
  okc(saved); assert.deepEqual(saved.json.problems, [], JSON.stringify(saved.json.problems));
  await new Promise((r) => setTimeout(r, 15)); clock = Date.now();   // the pre-existing applicant really did arrive earlier (applications stamp real time)
  const act = await post(HR, 'flow-activate', { note: 'First version' }); okc(act);
  assert.equal(act.json.version, 1);
  st = (await get(HR, 'flow-state')).json;
  assert.equal(st.active.version, 1); assert.equal(st.draft, null); assert.equal(st.versions.length, 1);
  assert.equal((await get(RANDOM, 'flow-state')).json.draft, null, 'staff cannot see drafts');

  // ---- applicants from before the flow was published are not pulled in by surprise, but HR can add them
  assert.equal(await runOf(early), undefined);
  clock += 60_000; await new Promise((r) => setTimeout(r, 15));

  // ---- applicant 1: the whole happy path
  const a1 = await newApp('Asha');
  let r1 = await runOf(a1);
  assert.ok(r1, 'the hook starts a run for a new applicant');
  assert.equal(r1.flowVersion, 1);
  assert.equal(r1.stepId, steps[2].id, 'score and the salary check ran by themselves; now waiting at phone screening');
  assert.equal(r1.status, 'WAITING');
  let t = await myTasks(HR);
  assert.equal(t.length, 1); assert.equal(t[0].candidateName, 'Asha'); assert.equal(t[0].link, 'candidates'); assert.equal(t[0].decide, false);
  assert.ok(sent.some((m) => m.to === 'u_hr@acme.com' && /Hiring task/.test(m.subject)), 'the owner is emailed about the task');

  await advanceRun(CID, r1.id); await advanceRun(CID, r1.id);
  assert.equal((await myTasks(HR)).length, 1, 'running again does not duplicate the task');

  // HR does the real work in the existing screen; the applicant moves on by itself
  await putItem({ id: 'scr1', companyId: CID, kind: 'screening', applicationId: a1, outcome: 'PASS' });
  okc(await post(HR, 'flow-check-now'));
  r1 = await runOf(a1);
  assert.equal(r1.stepId, steps[3].id, 'screening passed: now waiting for the boss');
  assert.equal((await myTasks(HR)).length, 0, 'the finished task is closed');
  t = await myTasks(BOSS); assert.equal(t.length, 1); assert.equal(t[0].decide, true);

  // approval: only the owner (or hiring HR) can answer; a "no" needs a reason
  assert.equal((await post(RANDOM, 'flow-task-decide', { taskId: t[0].id, decision: 'yes' })).status, 403);
  assert.equal((await post(BOSS, 'flow-task-decide', { taskId: t[0].id, decision: 'no' })).status, 400, 'a no needs a reason');
  okc(await post(BOSS, 'flow-task-decide', { taskId: t[0].id, decision: 'yes' }));
  assert.equal((await runOf(a1)).stepId, steps[4].id);
  assert.equal((await post(BOSS, 'flow-task-decide', { taskId: t[0].id, decision: 'yes' })).status, 409, 'cannot answer twice');

  // interview completes with a good average -> email goes out once -> then waits 2 days
  const card = (n: number) => ({ interviewerId: 'p', interviewerName: 'Panel', ratings: { a: n, b: n }, recommendation: 'YES', strengths: 'ok', concerns: '', submittedAt: '' });
  await putItem({ id: 'int1', companyId: CID, kind: 'interview', applicationId: a1, status: 'COMPLETED', createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T11:00:00Z', scorecards: [card(4)] });
  const before = sent.length;
  await Promise.all([advanceRun(CID, r1.id), advanceRun(CID, r1.id), advanceRun(CID, r1.id)]);
  r1 = await runOf(a1);
  assert.equal(r1.stepId, steps[6].id, 'now in the waiting step');
  assert.equal(sent.filter((m) => /Next steps for Designer/.test(m.subject)).length, 1, 'three engines at once still send the email exactly once');
  assert.ok(sent.find((m) => /Next steps/.test(m.subject))!.body.includes('Hi Asha') && sent.find((m) => /Next steps/.test(m.subject))!.body.includes('Priya HR'));
  assert.equal(r1.status, 'WAITING');
  await advanceRun(CID, r1.id);
  assert.equal((await runOf(a1)).stepId, steps[6].id, 'still waiting');
  clock += 2 * 86400000 + 1000;
  await advanceRun(CID, r1.id);
  r1 = await runOf(a1);
  assert.equal(r1.stepId, steps[7].id, 'two days later: on to the offer');
  assert.equal(sent.filter((m) => /Next steps/.test(m.subject)).length, 1, 'no second email');

  // offer, acceptance, joining
  await putItem({ id: 'off1', companyId: CID, kind: 'offer', applicationId: a1, status: 'SENT', createdAt: nowIso() });
  await advanceRun(CID, r1.id);
  assert.equal((await runOf(a1)).stepId, steps[7].id, 'offer sent but not yet accepted');
  await putItem({ id: 'off1', companyId: CID, kind: 'offer', applicationId: a1, status: 'ACCEPTED', createdAt: nowIso(), onboardingId: 'ob1' });
  okc(await post(HR, 'flow-check-now'));
  r1 = await runOf(a1);
  assert.equal(r1.status, 'HIRED');
  assert.ok(r1.history.length > 8, 'every move is recorded');
  assert.equal((await myTasks(HR)).length, 0);

  // ---- applicant 2: fails the salary check -> rejected with the rejection email
  fdb.seed('applications', 'dummy', { companyId: 'zz' });
  const a2 = await newApp('Bilal', 'bilal@mail.com', 40);
  await advanceRun(CID, `flowrun_${a2}`);
  const r2 = await runOf(a2);
  assert.equal(r2.status, 'REJECTED', 'the condition sent Bilal to the reject step');
  assert.equal((await getApplication(CID, a2))!.status, 'Rejected');
  assert.ok(sent.some((m) => m.to === 'bilal@mail.com' && m.body.includes('Sorry Bilal')));

  // ---- unknown facts: by default the flow stops and tells HR; the builder can choose Yes or No instead
  const aU = await newApp('Uma', 'uma@mail.com', null);
  let rU = await runOf(aU);
  assert.equal(rU.status, 'STUCK'); assert.match(rU.stuckReason, /does not have the information/);
  assert.equal((await get(HR, 'flow-runs')).json.items[0].candidateName, 'Uma');
  await fdb.collection('applications').doc(aU).update({ expectedCtcLpa: 12 });
  okc(await post(HR, 'flow-run-action', { runId: rU.id, action: 'retry' }));
  assert.equal((await runOf(aU)).stepId, steps[2].id, 'once HR fills it in, Retry carries on');
  okc(await post(HR, 'flow-run-action', { runId: rU.id, action: 'stop', note: 'test applicant' }));

  // ---- applicant 3: fails phone screening -> rejected (default failure path), no matter who is watching
  const a3 = await newApp('Chen');
  await putItem({ id: 'scr3', companyId: CID, kind: 'screening', applicationId: a3, outcome: 'FAIL' });
  await advanceRun(CID, `flowrun_${a3}`);
  assert.equal((await runOf(a3)).status, 'REJECTED');
  assert.equal((await myTasks(HR)).filter((x) => x.candidateName === 'Chen').length, 0, 'no leftover tasks');

  // ---- applicant 4: HR rejects by hand in the Candidates screen while the flow waits -> the flow stops
  const a4 = await newApp('Dev');
  await fdb.collection('applications').doc(a4).update({ status: 'Rejected' });
  await advanceRun(CID, `flowrun_${a4}`);
  assert.equal((await runOf(a4)).status, 'REJECTED');
  assert.equal((await myTasks(HR)).filter((x) => x.candidateName === 'Dev').length, 0);

  // ---- stuck: the email service is down. It is visible, explained, and fixable.
  const a5 = await newApp('Esha');
  await putItem({ id: 'scr5', companyId: CID, kind: 'screening', applicationId: a5, outcome: 'PASS' });
  await advanceRun(CID, `flowrun_${a5}`);
  const t5 = (await myTasks(BOSS)).find((x) => x.candidateName === 'Esha')!;
  okc(await post(BOSS, 'flow-task-decide', { taskId: t5.id, decision: 'yes' }));
  await putItem({ id: 'int5', companyId: CID, kind: 'interview', applicationId: a5, status: 'COMPLETED', createdAt: '2026-01-01T10:00:00Z', updatedAt: '2026-01-01T11:00:00Z', scorecards: [card(5)] });
  mailFails = true;
  await advanceRun(CID, `flowrun_${a5}`);
  let r5 = await runOf(a5);
  assert.equal(r5.status, 'STUCK'); assert.match(r5.stuckReason, /Email not sent: mail server down/);
  const runs = (await get(HR, 'flow-runs')).json.items;
  assert.equal(runs[0].status, 'STUCK', 'stuck applicants are listed first');
  assert.equal((await get(HR, 'flow-state')).json.counts.STUCK, 1);
  assert.equal((await post(HR, 'flow-run-action', { runId: r5.id, action: 'skip' })).status, 400, 'skipping needs a reason');
  mailFails = false;
  okc(await post(HR, 'flow-run-action', { runId: r5.id, action: 'retry' }));
  r5 = await runOf(a5);
  assert.equal(r5.stepId, steps[6].id, 'retry sent the email and moved on');
  assert.equal(sent.filter((m) => m.to === 'esha@mail.com' && /Next steps/.test(m.subject)).length, 1);

  // ---- HR can take someone out of the flow, with a reason on record
  assert.equal((await post(HR, 'flow-run-action', { runId: r5.id, action: 'stop' })).status, 400);
  okc(await post(HR, 'flow-run-action', { runId: r5.id, action: 'stop', note: 'Candidate withdrew' }));
  assert.equal((await runOf(a5)).status, 'STOPPED');
  assert.ok((await runOf(a5)).history.some((h: any) => /Candidate withdrew/.test(h.text) && h.by === 'Priya HR'));

  // ---- versioning: editing makes a draft; in-flight applicants stay on the version they started with
  clock = Date.now();   // the pretend clock had jumped ahead for the waiting test
  const a6 = await newApp('Farah');
  assert.equal((await runOf(a6)).flowVersion, 1);
  const ed = await post(HR, 'flow-edit'); okc(ed);
  assert.equal(ed.json.draft.basedOn, 1);
  const steps2: FlowStep[] = ed.json.draft.steps.filter((s: FlowStep) => s.type !== 'approval').map((s: FlowStep) => (s.type === 'condition' ? { ...s } : s));
  okc(await post(HR, 'flow-save', { name: 'Acme hiring', steps: steps2 }));
  const act2 = await post(HR, 'flow-activate', { note: 'Removed the boss approval' }); okc(act2);
  assert.equal(act2.json.version, 2);
  st = (await get(HR, 'flow-state')).json;
  assert.equal(st.active.version, 2); assert.equal(st.versions.filter((v: any) => v.status === 'ARCHIVED').length, 1);
  assert.equal((await runOf(a6)).flowVersion, 1, 'Farah stays on version 1');
  clock += 1000;
  const a7 = await newApp('Gita');
  assert.equal((await runOf(a7)).flowVersion, 2, 'new applicants use version 2');
  await putItem({ id: 'scr6', companyId: CID, kind: 'screening', applicationId: a6, outcome: 'PASS' });
  await advanceRun(CID, `flowrun_${a6}`);
  assert.equal((await myTasks(BOSS)).filter((x) => x.candidateName === 'Farah').length, 1, 'version 1 still asks the boss');

  // ---- a person who left cannot own a step in a flow being published
  await fdb.collection('employees').doc('u_boss').update({ active: false });
  const ed2 = await post(HR, 'flow-edit');
  const withBoss = ed2.json.draft.steps.map((s: FlowStep) => (s.type === 'screen' ? { ...s, ownerUid: 'u_boss' } : s));
  okc(await post(HR, 'flow-save', { name: 'Acme hiring', steps: withBoss }));
  const act3 = await post(HR, 'flow-activate');
  assert.equal(act3.status, 400); assert.ok(act3.json.problems.some((p: any) => /no longer an active employee/.test(p.message)));
  okc(await post(HR, 'flow-discard'));
  assert.equal((await get(HR, 'flow-state')).json.draft, null);

  // ---- enrolling older applicants, and the daily job
  const enr = await post(HR, 'flow-enroll', { applicationIds: [early, 'missing'] }); okc(enr);
  assert.equal(enr.json.added, 1); assert.equal(enr.json.skipped, 1);
  assert.equal((await post(HR, 'flow-enroll', { applicationIds: [early] })).json.already, 1, 'enrolling twice does nothing');
  const sw = await sweepFlows();
  assert.equal(sw.companies, 1); assert.equal(sw.lateReminders >= 0, true);
  clock += 10 * 86400000;
  const late = await sweepFlows();
  assert.ok(late.lateReminders > 0, 'late tasks are nudged');
  const again = await sweepFlows();
  assert.equal(again.lateReminders, 0, 'but only once a day');

  // ---- one flow per designation
  clock = Date.now();
  const desApp = async (name: string, designation: string) => {
    const { value } = normalizeApplicationInput({ name, email: `${name.toLowerCase()}@mail.com`, designation });
    return (await createApplication(CID, { ...value!, expectedCtcLpa: 10 } as any, 'MANUAL')).id;
  };
  let sn = (await get(HR, 'flow-state')).json;
  assert.equal(sn.families.length, 1); assert.equal(sn.families[0].isDefault, true);
  assert.ok(sn.designationOptions.includes('Designer'), 'HR picks from designations that already exist');
  assert.equal((await post(RANDOM, 'flow-new', { designations: ['Designer'], from: 'standard' })).status, 403);
  assert.equal((await post(HR, 'flow-new', { designations: [], from: 'standard' })).status, 400, 'a designation flow needs a designation');
  const sales = await post(HR, 'flow-new', { designations: ['Sales Executive'], from: 'copy', copyFrom: 'default' }); okc(sales);
  const SF = sales.json.familyId;
  assert.equal(sales.json.draft.steps.length > 0, true, 'copied from the Default flow');
  assert.equal((await post(HR, 'flow-new', { designations: ['sales  executive'], from: 'standard' })).status, 409, 'a designation can only be in one flow (ignoring capitals and spaces)');
  assert.equal((await post(HR, 'flow-new', { name: 'Sales Executive', designations: ['Intern'], from: 'standard' })).status, 409, 'two flows cannot share a name');
  // not published yet: Sales applicants still follow Default
  const s0 = await desApp('Sam', 'Sales Executive');
  assert.equal((await runOf(s0)).familyId, 'default', 'an unpublished designation flow never leaves anyone without a flow');
  okc(await post(HR, 'flow-activate', { familyId: SF, note: 'Sales v1' }));
  sn = (await get(HR, 'flow-state')).json;
  const sv = sn.families.find((f: any) => f.familyId === SF);
  assert.equal(sv.active.version, 1, 'each flow has its own version numbers'); assert.equal(sn.families[0].active.version, 2);
  assert.deepEqual(sv.designations, ['Sales Executive']); assert.equal(sn.versions.length, 2, 'top-level versions are the Default flow only');
  clock += 1000;
  const s1 = await desApp('Sia', 'Sales Executive'); const s2 = await desApp('Dan', 'Designer');
  const rs1 = await runOf(s1);
  assert.equal(rs1.familyId, SF); assert.equal(rs1.flowName, 'Sales Executive'); assert.equal((await runOf(s2)).familyId, 'default');
  assert.equal((await runOf(s2)).flowVersion, 2);
  const listed = (await get(HR, 'flow-runs')).json.items;
  assert.equal(listed.find((r: any) => r.applicationId === s1).flowName, 'Sales Executive');
  // editing the sales flow does not touch the Default flow
  const ed3 = await post(HR, 'flow-edit', { familyId: SF }); okc(ed3);
  assert.equal(ed3.json.draft.familyId, SF);
  assert.equal((await get(HR, 'flow-state')).json.families[0].draft, null);
  okc(await post(HR, 'flow-save', { familyId: SF, name: 'Sales Executive', steps: ed3.json.draft.steps.slice(0, -1).concat([]) }));
  assert.equal((await post(HR, 'flow-activate', { familyId: SF })).status, 400, 'the same checks apply to every flow');
  okc(await post(HR, 'flow-discard', { familyId: SF }));
  // add a designation, with the same one-flow rule
  assert.equal((await post(HR, 'flow-set-designations', { familyId: SF, designations: ['Sales Executive', 'Designer'] })).status, 200, 'Designer has no flow of its own yet, so it can be added');
  const s3 = await desApp('Gus', 'designer');
  assert.equal((await runOf(s3)).familyId, SF, 'matching ignores capitals');
  const other = await post(HR, 'flow-new', { designations: ['Intern'], from: 'standard' }); okc(other);
  assert.equal((await post(HR, 'flow-set-designations', { familyId: other.json.familyId, designations: ['Intern', 'Designer'] })).status, 409);
  assert.equal((await post(HR, 'flow-set-designations', { familyId: 'default', designations: ['x'] })).status, 404);
  // retire: new applicants go back to Default, people already inside carry on
  assert.equal((await post(HR, 'flow-retire', { familyId: 'default' })).status, 404, 'the Default flow cannot be retired');
  okc(await post(HR, 'flow-retire', { familyId: SF }));
  assert.equal((await get(HR, 'flow-state')).json.families.some((f: any) => f.familyId === SF), false);
  const s4 = await desApp('Tia', 'Sales Executive');
  assert.equal((await runOf(s4)).familyId, 'default');
  await advanceRun(CID, rs1.id);
  assert.equal((await runOf(s1)).flowVersion, 1, 'applicants already in the retired flow keep their version');
  assert.equal((await runOf(s1)).status !== 'STOPPED', true);
  // the daily job and "add earlier applicants" respect designations too
  const sw2 = await sweepFlows(); assert.ok(sw2.advanced >= 1);

  // ---- applicants that reach the database without going through createApplication (the website feed) are still picked up
  const feedApp = (id: string, name: string, extra: any) => fdb.seed('applications', id, { id, companyId: CID, name, email: `${name.toLowerCase()}@feed.com`, emailLower: `${name.toLowerCase()}@feed.com`, designation: 'Designer', designationKey: 'designer', status: 'New Applicant', source: 'WEBHOOK', updatedAt: nowIso(), ...extra });
  feedApp('web_new', 'Webnew', { createdAt: '2020-01-01T00:00:00Z', receivedAt: nowIso() });   // website says applied long ago, but it reached us just now
  feedApp('web_old', 'Webold', { createdAt: '2020-01-01T00:00:00Z' });                          // genuinely old, from before the flow
  const cn = await post(HR, 'flow-check-now'); okc(cn);
  assert.equal(cn.json.enrolled, 1, 'Check everyone now adds new applicants');
  assert.ok(await runOf('web_new'), 'the website applicant is in the flow'); assert.equal(await runOf('web_old'), undefined, 'old applicants are still not pulled in by surprise');
  const again2 = await post(HR, 'flow-check-now');
  assert.equal(again2.json.enrolled, 0, 'nothing is added twice');

  // ---- one company never sees another's flow, runs or tasks
  assert.equal((await get(OTHER, 'flow-state')).json.active, null);
  assert.equal((await get(OTHER, 'flow-state')).json.families.length, 1, 'another company sees only its own (empty) Default flow');
  assert.equal((await get(OTHER, 'flow-runs')).json.items.length, 0);
  assert.equal((await get(OTHER, 'flow-my-tasks')).json.open.length, 0);
  assert.equal((await post(OTHER, 'flow-run-action', { runId: `flowrun_${a6}`, action: 'retry' })).status, 404);

  console.log('flow.api: all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
