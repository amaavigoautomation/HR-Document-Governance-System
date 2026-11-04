import assert from 'node:assert/strict';
process.env.APP_BASE_URL = 'https://hr.example.com';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeFlow, advanceRun, __setMailer, __setNow } from '../api/_lib/flowApi.ts';
import { routeSkillTest, __setTestMailer, __setTestNow, __setTestWriter } from '../api/_lib/skillTestApi.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { createApplication, normalizeApplicationInput } from '../api/_lib/recruitmentData.ts';
import { listItems } from '../api/_lib/pipelineApi.ts';
import { makeStep, validateFlow, testSettings, isManualStep, type FlowStep } from '../shared/flowEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const flowMail: any[] = []; const testMail: { to: string; subject: string; body: string }[] = [];
let testMailFails = false;
__setMailer(async (p) => { flowMail.push(p); return { ok: true }; });
__setTestMailer(async (p) => { if (testMailFails) return { ok: false, error: 'server down' }; testMail.push(p); return { ok: true }; });
let clock = Date.now();
__setNow(() => new Date(clock)); __setTestNow(() => new Date(clock));
const CID = 'c1';
const tok = (uid: string, perms: string[] = []) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['app.manage']); const RANDOM = tok('u_x');
const flow = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeFlow({ method, action, headers: h, body, query }) as Promise<any>;
const st = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeSkillTest({ method, action, headers: h, body, query }) as Promise<any>;
const okc = (r: any, m = '') => assert.equal(r.status, 200, `${m} ${JSON.stringify(r.json)}`);

for (const [id, name] of [['u_hr', 'Priya HR'], ['u_x', 'Random']]) fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, title: 'Staff' });
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
fdb.seed('requisitions', 'rq1', { companyId: CID, positionTitle: 'Designer', status: 'JOB_OPEN', jd: { text: 'We need a designer who knows Figma, typography and colour theory.', updatedAt: new Date().toISOString() } });

const newApp = async (name: string, designation = 'Designer', email = `${name.toLowerCase()}@mail.com`) => {
  const { value } = normalizeApplicationInput({ name, email, designation, experience: '3 years' });
  return (await createApplication(CID, value! as any, 'MANUAL')).id;
};
const runOf = async (appId: string) => (await listItems(CID, 'flowRun')).find((r) => r.applicationId === appId) as any;
const attemptOf = async (appId: string) => (await listItems(CID, 'assessment')).find((a) => a.applicationId === appId && a.mode === 'AI_TEST') as any;
const aiQs = (n: number) => Array.from({ length: n }, (_, i) => ({ q: `Question ${i + 1}?`, options: [`right ${i}`, `b ${i}`, `c ${i}`, `d ${i}`], answer: 0, topic: 't' }));
const answerAll = (it: any, rightCount: number) => Object.fromEntries(it.questions.map((q: any, i: number) => [q.id, i < rightCount ? q.answer : (q.answer + 1) % 4]));

async function main() {
  // ---- the step itself
  const t0 = makeStep('test', [], { ownerUid: 'u_hr', ownerName: 'Priya HR' });
  assert.equal(testSettings(t0).mode, 'ai', 'new test steps are given by the app');
  assert.equal(isManualStep(t0), false, 'an app-given test that follows the flow on a low score needs no person');
  assert.equal(isManualStep({ type: 'test', settings: { mode: 'ai', onBelow: 'ask' } }), true);
  assert.equal(testSettings({ settings: {} } as any).mode, 'manual', 'steps saved before this feature stay manual');
  assert.equal(validateFlow({ name: 'x', steps: [makeStep('test', []), makeStep('reject', [])] }).filter((p) => /choose the person/.test(p.message)).length, 0, 'no owner needed');
  assert.ok(validateFlow({ name: 'x', steps: [makeStep('test', [], { settings: { mode: 'ai', onBelow: 'ask' } }), makeStep('reject', [])] }).some((p) => /choose the person/.test(p.message)), 'owner needed when a person decides');
  assert.ok(validateFlow({ name: 'x', steps: [makeStep('test', [], { settings: { mode: 'ai', questions: 99 } }), makeStep('reject', [])] }).some((p) => /How many questions/.test(p.message)), 'numbers are range-checked');

  // ---- access
  assert.equal((await st(RANDOM, 'GET', 'stest-list')).status, 403);
  assert.equal((await st(HR, 'POST', 'stest-list')).status, 405);
  assert.equal(await st(HR, 'GET', 'nope'), null);

  // ---- making the test
  let asked: any = null;
  __setTestWriter(async (_c, designation, jd, count) => { asked = { designation, jd, count }; return { questions: [...aiQs(count - 1), { q: 'bad', options: ['a', 'a', 'b', 'c'], answer: 0 }, { q: 'bad2', options: ['a', 'b', 'c'], answer: 1 }] }; });
  const none = await st(HR, 'GET', 'stest-get', {}, { designation: 'Designer' });
  assert.equal(none.json.test, null); assert.equal(none.json.hasJd, true, 'the JD comes from the requisition');
  assert.equal((await st(HR, 'POST', 'stest-generate', { designation: 'Welder', count: 6 })).status, 400, 'no job description, no test');
  const gen = await st(HR, 'POST', 'stest-generate', { designation: 'designer ', count: 6 }); okc(gen);
  assert.match(asked.jd, /Figma/); assert.equal(gen.json.test.questions.length, 6, 'unusable questions are dropped, extras trimmed');
  assert.ok(gen.json.test.questions.every((q: any) => q.options[q.answer].startsWith('right')), 'the answer key follows the shuffle');
  assert.equal((await st(HR, 'GET', 'stest-list')).json.tests.length, 1);
  assert.equal((await st(HR, 'POST', 'stest-save', { designation: 'Designer', questions: [{ q: 'x', options: ['a', 'b', 'c', 'd'], answer: 9 }] })).status, 400);
  assert.equal((await st(HR, 'POST', 'stest-save', { designation: 'Designer', questions: aiQs(3) })).status, 400, 'at least 5 questions');
  okc(await st(HR, 'POST', 'stest-save', { designation: 'Designer', questions: aiQs(6) }));
  assert.match((await st(HR, 'GET', 'stest-get', {}, { designation: 'Designer' })).json.test.source, /edited by HR/);

  // ---- a flow with the test (pass mark 60%, below = follow the flow)
  const steps: FlowStep[] = [];
  steps.push(makeStep('test', steps, { settings: { mode: 'ai', questions: 5, minutes: 20, passPercent: 60, expiryDays: 3, onBelow: 'reject' } }));
  steps.push(makeStep('offer', steps, { ownerUid: 'u_hr', ownerName: 'Priya HR' }));
  steps.push(makeStep('onboard', steps, { ownerUid: 'u_hr', ownerName: 'Priya HR' }));
  okc(await flow(HR, 'POST', 'flow-start-standard'));
  okc(await flow(HR, 'POST', 'flow-save', { name: 'Test flow', steps })); okc(await flow(HR, 'POST', 'flow-activate'));
  await new Promise((r) => setTimeout(r, 15));
  // applicant 1 passes
  const a1 = await newApp('Asha');
  let r1 = await runOf(a1);
  assert.ok(r1, 'the flow started'); assert.equal(r1.status, 'WAITING');
  let it = await attemptOf(a1);
  assert.ok(it, 'a test was created for the candidate'); assert.equal(it.questions.length, 5); assert.equal(it.passScore, 60);
  assert.equal(testMail.length, 1); assert.equal(testMail[0].to, 'asha@mail.com'); assert.match(testMail[0].body, new RegExp(`https://hr.example.com/\\?test=${it.token}`));
  await advanceRun(CID, r1.id); await advanceRun(CID, r1.id);
  assert.equal(testMail.length, 1, 'the invite is sent once');
  assert.equal((await listItems(CID, 'assessment')).filter((x) => x.applicationId === a1).length, 1, 'one attempt only');
  assert.equal((await flow(HR, 'GET', 'flow-my-tasks')).json.open.filter((t: any) => t.candidateName === 'Asha').length, 0, 'nobody gets a task: the app does the work');

  // HR screens never show the link or the answer key
  const list = await routeHiring({ method: 'GET', action: 'assess-list', headers: HR, query: { applicationId: a1 } });
  const shown = JSON.stringify(list.json);
  assert.ok(!shown.includes(it.token) && !shown.includes('"questions"') && !shown.includes('"answers"'), 'no token or answer key for HR');
  assert.equal(list.json.items[0].questionCount, 5);
  assert.equal((await routeHiring({ method: 'POST', action: 'assess-result', headers: HR, body: { id: it.id, score: 90 }, query: {} })).status, 400, 'HR cannot overwrite an automatic mark');

  // the candidate's page
  const pg = (t: string) => st({}, 'GET', 'stest-public-get', {}, { token: t });
  assert.equal((await pg('nonsense')).status, 404); assert.equal((await pg('a'.repeat(48))).status, 404);
  let pub = (await pg(it.token)).json;
  assert.equal(pub.state, 'READY'); assert.equal(pub.questions, undefined, 'no questions before Start');
  assert.equal((await st({}, 'POST', 'stest-public-submit', { token: it.token, answers: {} })).status, 400, 'must press Start first');
  const start = (await st({}, 'POST', 'stest-public-start', { token: it.token })).json;
  assert.equal(start.state, 'IN_PROGRESS'); assert.equal(start.questions.length, 5);
  assert.ok(!JSON.stringify(start).includes('"answer"'), 'the answer key never reaches the candidate');
  clock += 5 * 60_000;
  const again = (await st({}, 'POST', 'stest-public-start', { token: it.token })).json;
  assert.ok(again.secondsLeft <= 20 * 60 - 5 * 60 + 1, 'pressing Start again does not restart the clock');
  const sub = await st({}, 'POST', 'stest-public-submit', { token: it.token, answers: answerAll(it, 4) }); okc(sub);
  assert.equal(sub.json.score, undefined, 'the candidate is not shown the score');
  assert.equal((await st({}, 'POST', 'stest-public-submit', { token: it.token, answers: answerAll(it, 5) })).status, 409, 'only one attempt');
  assert.equal((await st({}, 'POST', 'stest-public-start', { token: it.token })).status, 409);
  it = await attemptOf(a1);
  assert.equal(it.score, 80); assert.equal(it.result, 'PASS'); assert.equal(it.correctCount, 4); assert.equal(it.status, 'SCORED'); assert.equal(it.late, false);
  r1 = await runOf(a1);
  assert.equal(r1.stepId, steps[1].id, 'passed: the flow moved on by itself'); assert.ok(r1.history.some((h: any) => /Test passed with 80%/.test(h.text)));
  assert.equal((await pg(it.token)).json.state, 'DONE');

  // applicant 2 fails: the flow's "does not work out" path (reject) runs by itself
  const a2 = await newApp('Bala');
  let it2 = await attemptOf(a2);
  await st({}, 'POST', 'stest-public-start', { token: it2.token });
  okc(await st({}, 'POST', 'stest-public-submit', { token: it2.token, answers: answerAll(it2, 2) }));
  const r2 = await runOf(a2);
  assert.equal(r2.status, 'REJECTED'); assert.ok(r2.history.some((h: any) => /below the pass mark of 60%/.test(h.text)));

  // time runs out: a test that is started and never handed in is marked, not left hanging
  const a3 = await newApp('Chitra');
  let it3 = await attemptOf(a3);
  await st({}, 'POST', 'stest-public-start', { token: it3.token });
  clock += 20 * 60_000 + 10 * 60_000;
  await advanceRun(CID, (await runOf(a3)).id);
  assert.equal((await runOf(a3)).status, 'REJECTED', 'nothing handed in = 0%'); assert.equal((await attemptOf(a3)).score, 0);

  // a link nobody opens expires; HR presses Retry for a fresh one
  clock = Date.now();
  const a4 = await newApp('Dev');
  const it4 = await attemptOf(a4);
  clock += 4 * 86400000;
  assert.equal((await pg(it4.token)).json.state, 'EXPIRED');
  assert.equal((await st({}, 'POST', 'stest-public-start', { token: it4.token })).status, 409);
  const r4 = await runOf(a4); await advanceRun(CID, r4.id);
  assert.equal((await runOf(a4)).status, 'STUCK'); assert.match((await runOf(a4)).stuckReason, /did not start the test/);
  okc(await flow(HR, 'POST', 'flow-run-action', { runId: r4.id, action: 'retry' }));
  const it4b = (await listItems(CID, 'assessment')).filter((x) => x.applicationId === a4 && x.mode === 'AI_TEST' && x.status === 'ASSIGNED');
  assert.equal(it4b.length, 1, 'a new link was made'); assert.notEqual(it4b[0].token, it4.token);
  assert.equal((await pg(it4.token)).json.state, 'REPLACED'); assert.equal((await runOf(a4)).status, 'WAITING');
  assert.equal(testMail.filter((m) => m.to === 'dev@mail.com').length, 2, 'the new link was emailed');

  // no test for the job title: the applicant waits, with a plain reason, until HR makes one
  clock = Date.now();
  const a5 = await newApp('Esha', 'Welder');
  assert.equal((await runOf(a5)).status, 'STUCK'); assert.match((await runOf(a5)).stuckReason, /No test has been made for "Welder"/);

  // the email bounces: the run says so, and Retry sends it again
  testMailFails = true;
  const a6 = await newApp('Farah');
  assert.equal((await runOf(a6)).status, 'STUCK'); assert.match((await runOf(a6)).stuckReason, /could not be sent/);
  testMailFails = false;
  okc(await flow(HR, 'POST', 'flow-run-action', { runId: (await runOf(a6)).id, action: 'retry' }));
  assert.equal((await runOf(a6)).status, 'WAITING'); assert.equal(testMail.filter((m) => m.to === 'farah@mail.com').length, 1);

  // ---- "ask a person" when the score is low
  const steps2: FlowStep[] = [];
  steps2.push(makeStep('test', steps2, { ownerUid: 'u_hr', ownerName: 'Priya HR', settings: { mode: 'ai', questions: 5, minutes: 20, passPercent: 80, expiryDays: 3, onBelow: 'ask' } }));
  steps2.push(makeStep('offer', steps2, { ownerUid: 'u_hr', ownerName: 'Priya HR' }));
  steps2.push(makeStep('onboard', steps2, { ownerUid: 'u_hr', ownerName: 'Priya HR' }));
  const fam = await flow(HR, 'POST', 'flow-new', { name: 'Ask flow', designations: ['Writer'] }); okc(fam);
  fdb.seed('requisitions', 'rq2', { companyId: CID, positionTitle: 'Writer', status: 'JOB_OPEN', jd: { text: 'Writes clear copy.', updatedAt: new Date().toISOString() } });
  okc(await st(HR, 'POST', 'stest-generate', { designation: 'Writer', count: 5 }));
  okc(await flow(HR, 'POST', 'flow-save', { familyId: fam.json.familyId, name: 'Ask flow', steps: steps2 })); okc(await flow(HR, 'POST', 'flow-activate', { familyId: fam.json.familyId }));
  await new Promise((r) => setTimeout(r, 15));
  const a7 = await newApp('Gita', 'Writer');
  const it7 = await attemptOf(a7);
  assert.equal((await flow(HR, 'GET', 'flow-my-tasks')).json.open.filter((t: any) => t.candidateName === 'Gita').length, 0, 'no task until a score exists');
  await st({}, 'POST', 'stest-public-start', { token: it7.token });
  okc(await st({}, 'POST', 'stest-public-submit', { token: it7.token, answers: answerAll(it7, 3) }));
  assert.equal((await runOf(a7)).status, 'WAITING', 'a low score waits for a person');
  const tasks = ((await flow(HR, 'GET', 'flow-my-tasks')).json.open as any[]).filter((t) => t.candidateName === 'Gita');
  assert.equal(tasks.length, 1); assert.equal(tasks[0].decide, true); assert.match(tasks[0].question, /scored 60%/);
  okc(await flow(HR, 'POST', 'flow-task-decide', { taskId: tasks[0].id, decision: 'yes' }));
  const r7 = await runOf(a7);
  assert.equal(r7.stepId, steps2[1].id); assert.ok(r7.history.some((h: any) => /let the candidate through/.test(h.text)));

  console.log('skilltest: all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
