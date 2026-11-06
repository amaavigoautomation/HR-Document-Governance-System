/**
 * Performance Management end to end, following one year of the scenario (Priya = "u_a", her manager = "u_boss", HR = "u_hr"),
 * with every check from the specification's section 14 (UAT) marked "UAT n".
 * Run: npx tsx tests/pm.test.ts
 */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePm } from '../api/_lib/pmApi.ts';
import { addDays, istToday, quarterOf, scoreReview, weightsProblem, kpiProblem, previousQuarter, quarterByKey } from '../shared/pmEngine.ts';

// ---------------------------------------------------------------- pure rules
{
  assert.equal(weightsProblem({ results: 60, behaviour: 25, sop: 15 }), null);
  assert.match(weightsProblem({ results: 60, behaviour: 25, sop: 10 })!, /add up to 95/);
  assert.match(kpiProblem([{ id: 'a', kra: 'x', kpi: 'y', measure: '', weight: 50 }])!, /add up to 50/);
  const s = scoreReview({ kpis: [{ id: 'k1', weight: 60, rating: 4 }, { id: 'k2', weight: 40, rating: 'NO' }], comps: [{ id: 'c', rating: 3 }], sops: [{ id: 's', critical: false, result: 'C' }, { id: 't', critical: false, result: 'N' }] }, { results: 60, behaviour: 25, sop: 15 });
  assert.equal(s.results, 4, 'UAT 6: "Not observed" is left out, not counted as 0');
  assert.equal(s.sop, 3);
  assert.equal(s.overall, 3.6);
  const noSop = scoreReview({ kpis: [{ id: 'k1', weight: 100, rating: 4 }], comps: [{ id: 'c', rating: 4 }], sops: [] }, { results: 60, behaviour: 25, sop: 15 });
  assert.equal(noSop.overall, 4, 'an empty SOP part is left out and the weights rescaled');
  const crit = scoreReview({ kpis: [{ id: 'k1', weight: 100, rating: 5 }], comps: [{ id: 'c', rating: 5 }], sops: [{ id: 's', critical: true, result: 'N' }, { id: 't', critical: false, result: 'C' }, { id: 'u', critical: false, result: 'C' }] }, { results: 60, behaviour: 25, sop: 15 });
  assert.ok(crit.criticalBreach, 'a critical SOP breach is never averaged away');
  assert.ok(scoreReview({ kpis: [{ id: 'k1', weight: 100, rating: 'NO' }], comps: [{ id: 'c', rating: 3 }], sops: [] }, { results: 60, behaviour: 25, sop: 15 }).blocking.length > 0, 'nothing rated on results: cannot be scored');
  assert.equal(quarterByKey('2026-Q4')!.to, '2026-12-31');
  assert.equal(previousQuarter('2026-01-05').key, '2025-Q4');
}

// ---------------------------------------------------------------- the app
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['pm.manage']); const AP = tok('u_ap', ['pm.approve']); const BOSS = tok('u_boss'); const BOSS_AP = tok('u_boss', ['pm.approve']);
const A = tok('u_a'); const B = tok('u_b'); const D = tok('u_d'); const OTHER = tok('x1', ['pm.manage', 'pm.approve'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routePm({ method, action, headers: h, body, query });
const get = (h: any, action: string, query: any = {}) => call(h, 'GET', action, {}, query);
const post = (h: any, action: string, body: any = {}) => call(h, 'POST', action, body);
const okc = (r: any, msg = '') => { assert.equal(r.status, 200, `${msg} ${JSON.stringify(r.json)}`); return r.json; };
const no = (r: any, status: number, msg = '') => assert.equal(r.status, status, `${msg} ${JSON.stringify(r.json)}`);

const emp = (id: string, name: string, dept: string, title: string, perms: string[] = []) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: dept, title, perms, createdAt: '2025-01-01T00:00:00Z' });
emp('u_hr', 'Neha HR', 'HR', 'HR Manager', ['pm.manage']); emp('u_ap', 'Ajay Founder', 'Management', 'Founder', ['pm.approve']); emp('u_boss', 'Rahul', 'Design', 'Design Lead');
emp('u_a', 'Priya', 'Design', 'Designer'); emp('u_b', 'Bilal', 'Design', 'Designer'); emp('u_d', 'Dev', 'Sales', 'Sales Executive');
fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Other', email: 'x1@o.com', active: true, departmentName: 'Design', title: 'Designer' });
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
const mgr = (uid: string, m: string) => fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: m });
mgr('u_a', 'u_boss'); mgr('u_b', 'u_boss'); mgr('u_d', 'u_boss'); mgr('u_boss', 'u_ap'); mgr('u_hr', 'u_ap');
const doc = (id: string, title: string, dept: string, v: string) => fdb.seed('documents', id, { companyId: CID, documentId: id, title, departmentName: dept, currentPublishedVersionId: v, currentPublishedVersionNumber: v.replace('v', '') + '.0' });
doc('SOP-BRIEF', 'Design brief intake', 'Design', 'v1'); doc('SOP-SEC', 'Information security', 'Design', 'v1'); doc('SOP-CRM', 'CRM updates', 'Sales', 'v1');

const T = istToday(); const Q = quarterOf(T);
fdb.seed('leaveRequests', 'l1', { companyId: CID, uid: 'u_d', status: 'APPROVED', from: Q.from, to: addDays(Q.from, 34) });

async function main() {
  // ---- access
  no(await call({}, 'GET', 'home'), 401);
  no(await get(A, 'setup'), 403, 'an employee cannot open setup');
  no(await post(HR, 'home'), 405);
  no(await get(HR, 'nope'), 404);

  // ---- before setup: nothing starts, nothing is invented
  let h = okc(await get(HR, 'home'));
  assert.ok(h.todo.some((t: any) => t.go === 'setup'), 'HR is told to finish setup');
  no(await post(HR, 'cycle-open', { key: Q.key }), 400, 'reviews cannot open before setup is finished');

  // ---- setup wizard (UAT 7: weights validated)
  no(await post(HR, 'setup-save', { step: 'weights', weights: { results: 60, behaviour: 25, sop: 10 } }), 400, 'UAT 7');
  okc(await post(HR, 'setup-save', { step: 'weights', weights: { results: 60, behaviour: 25, sop: 15 } }));
  const setup = okc(await get(HR, 'setup'));
  okc(await post(HR, 'setup-save', { step: 'behaviours', competencies: setup.settings.competencies, managerExtras: true }));
  okc(await post(HR, 'setup-save', { step: 'sops', sops: [
    { documentId: 'SOP-BRIEF', departments: ['Design'], designations: ['Designer'] },
    { documentId: 'SOP-SEC', departments: ['Design'], designations: [], critical: true },
    { documentId: 'SOP-CRM', departments: ['Sales'], designations: [] },
  ] }));
  okc(await post(HR, 'setup-save', { step: 'timing', timing: { selfDays: 7, managerDays: 7, hrDays: 5, publishDelayDays: 2, remindEvery: 3, escalateAfter: 7 } }));
  const k = (id: string, kpi: string, weight: number) => ({ id, kra: kpi, kpi, measure: 'task records', weight });
  no(await post(HR, 'tpl-save', { designation: 'Designer', kpis: [k('k1', 'Deliverables on time', 50), k('k2', 'Work accepted without rework', 30)] }), 400, 'UAT 7: KPI weights must total 100');
  okc(await post(HR, 'tpl-save', { designation: 'Designer', kpis: [k('k1', 'Deliverables on time', 60), k('k2', 'Work accepted without rework', 40)] }));
  const fin = okc(await post(HR, 'setup-save', { step: 'finish' }));
  assert.ok(fin.settings.setupDone);

  // ---- plans start by themselves (UAT 1, UAT 2)
  let plans = okc(await get(HR, 'plans')).items;
  const planOf = (uid: string) => plans.find((p: any) => p.uid === uid);
  assert.equal(planOf('u_a').status, 'SET_TARGETS');
  assert.deepEqual(planOf('u_a').kpis.map((x: any) => x.kpi), ['Deliverables on time', 'Work accepted without rework'], 'UAT 1: the right KRA/KPI');
  assert.equal(planOf('u_a').competencies.length, 12, 'UAT 1: the behaviours');
  assert.deepEqual(planOf('u_a').sops.map((x: any) => x.documentId).sort(), ['SOP-BRIEF', 'SOP-SEC'], 'UAT 1: the department SOPs');
  assert.equal(planOf('u_d').status, 'ON_HOLD', 'no Sales template: on hold, not a silent default');
  assert.deepEqual(planOf('u_d').sops.map((x: any) => x.documentId), ['SOP-CRM'], 'UAT 2: a different department gets different SOPs');
  assert.equal(planOf('u_boss').status, 'ON_HOLD');
  assert.deepEqual(planOf('u_boss').sops.map((x: any) => x.documentId), ['SOP-SEC'], 'UAT 2: a different role in the same department gets different SOPs');
  const ex = okc(await get(HR, 'exceptions')).items;
  assert.ok(ex.some((x: any) => x.code === 'NO_TEMPLATE' && x.subjectUid === 'u_d'), 'the missing template is logged with who it affects');

  // ---- saving the missing template starts Dev's plan at once (event, not tomorrow)
  okc(await post(HR, 'tpl-save', { designation: 'Sales Executive', kpis: [k('s1', 'New business closed', 100)] }));
  plans = okc(await get(HR, 'plans')).items;
  assert.equal(planOf('u_d').status, 'SET_TARGETS');

  // ---- running everything twice changes nothing (UAT 10)
  const before = fdb.stores.get('pmPlans')!.size;
  okc(await post(HR, 'run-daily')); okc(await post(HR, 'run-daily'));
  assert.equal(fdb.stores.get('pmPlans')!.size, before, 'UAT 10: no duplicate plans');

  // ---- targets: manager sets, HR approves, employee acknowledges
  const pa = planOf('u_a');
  no(await post(A, 'plan-targets', { id: pa.id, kpis: [], send: true }), 403, 'nobody sets their own targets');
  no(await post(BOSS, 'plan-targets', { id: pa.id, kpis: [{ id: 'k1', target: '20 per month' }], send: true }), 400, 'every KPI needs a target before sending');
  okc(await post(BOSS, 'plan-targets', { id: pa.id, kpis: [{ id: 'k1', target: '20 per month' }, { id: 'k2', target: '90% accepted first time' }], send: true }));
  no(await post(BOSS, 'plan-approve', { id: pa.id }), 403, 'a manager cannot approve targets');
  okc(await post(HR, 'plan-approve', { id: pa.id }));
  no(await post(A, 'sop-ack', { planId: pa.id, documentId: 'SOP-SEC' }), 400, 'read and acknowledge are separate: open it first');
  okc(await post(A, 'sop-open', { planId: pa.id, documentId: 'SOP-SEC' }));
  okc(await post(A, 'sop-ack', { planId: pa.id, documentId: 'SOP-SEC' }));
  okc(await post(A, 'sop-open', { planId: pa.id, documentId: 'SOP-BRIEF' })); okc(await post(A, 'sop-ack', { planId: pa.id, documentId: 'SOP-BRIEF' }));
  okc(await post(A, 'plan-ack', { id: pa.id }));
  h = okc(await get(A, 'home'));
  assert.ok(!h.todo.some((t: any) => /acknowledge/i.test(t.text)), 'nothing left to acknowledge');

  // ---- work evidence
  no(await post(A, 'ev-add', { kpiId: 'k1', date: addDays(T, 1), title: 'Future work' }), 400, 'no future dates');
  const ev = okc(await post(A, 'ev-add', { kpiId: 'k1', date: T, title: 'Diwali campaign creatives delivered' })).item;
  assert.equal(ev.status, 'PENDING');
  no(await post(A, 'ev-add', { kpiId: 'k1', date: T, title: 'Diwali campaign creatives delivered' }), 400, 'the same work is not recorded twice');
  no(await post(A, 'ev-verify', { id: ev.id, ok: true }), 403, 'nobody verifies their own work');
  okc(await post(BOSS, 'ev-verify', { id: ev.id, ok: true }));
  const imp = okc(await post(HR, 'ev-import', { csv: `email,date,kpi,title,link\nu_a@acme.com,${T},Deliverables on time,Landing page delivered,\nnobody@acme.com,${T},x,y,\nu_a@acme.com,${T},Not a KPI,z,` }));
  assert.equal(imp.added, 1); assert.equal(imp.problems.length, 2, 'rows that match nobody are reported, never guessed');

  // ---- monthly check-in
  okc(await post(HR, 'run-daily'));
  const ci = okc(await get(A, 'checkins')).items[0];
  assert.ok(ci, 'the daily job created this month\'s check-in');
  okc(await post(A, 'checkin-save', { id: ci.id, wentWell: 'Delivered campaign', blockers: '', nextFocus: 'Rework rate' }));
  no(await post(BOSS, 'checkin-save', { id: ci.id, done: true }), 400, 'a check-in needs the manager\'s comment');
  okc(await post(BOSS, 'checkin-save', { id: ci.id, managerComment: 'Good month, focus on first-time acceptance.', done: true }));

  // ---- the quarter opens (once)
  const opened = okc(await post(HR, 'cycle-open', { key: Q.key }));
  no(await post(HR, 'cycle-open', { key: Q.key }), 400, 'UAT 10: opening twice never duplicates reviews');
  const rid = `${CID}_${Q.key}_u_a`;
  let rv = okc(await get(A, 'review', { id: rid })).review;
  assert.equal(rv.status, 'SELF');
  const rb = okc(await get(HR, 'review', { id: `${CID}_${Q.key}_u_b` })).review;
  assert.equal(rb.status, 'ON_HOLD', 'no approved targets: the review waits instead of being scored on nothing');
  assert.equal(okc(await get(HR, 'review', { id: `${CID}_${Q.key}_u_d` })).review.status, 'DEFERRED', 'long approved leave pauses the review');
  assert.ok(opened.created >= 1);

  // ---- Bilal's review starts by itself once his targets are approved
  const pb = planOf('u_b');
  okc(await post(BOSS, 'plan-targets', { id: pb.id, kpis: [{ id: 'k1', target: '15' }, { id: 'k2', target: '85%' }], send: true }));
  okc(await post(HR, 'plan-approve', { id: pb.id }));
  okc(await post(HR, 'run-daily'));
  assert.equal(okc(await get(HR, 'review', { id: `${CID}_${Q.key}_u_b` })).review.status, 'SELF');

  // ---- self-review
  no(await post(A, 'review-self', { id: rid, kpis: { k1: 4 }, submit: true }), 400, 'every line needs a rating or "Not observed"');
  const comps = Object.fromEntries(rv.snap.comps.map((x: any) => [x.id, 3]));
  okc(await post(A, 'review-self', { id: rid, kpis: { k1: 4, k2: 'NO' }, comps, achievements: 'Delivered the Diwali campaign on time.', training: 'Advanced motion design', submit: true }));
  no(await post(A, 'review-manager', { id: rid }), 403, 'nobody does the manager part of their own review');

  // ---- manager part
  const mBody = { id: rid, kpis: { k1: 4, k2: 'NO' }, comps, sops: { 'SOP-BRIEF': 'C', 'SOP-SEC': 'N' }, strengths: 'On-time delivery', improve: 'First-time acceptance', training: 'Advanced motion design', comment: 'A solid quarter overall.' };
  no(await post(BOSS, 'review-manager', { ...mBody, submit: true }), 400, 'cannot go to HR before the discussion date is entered');
  const sub = okc(await post(BOSS, 'review-manager', { ...mBody, discussedOn: T, submit: true }));
  assert.equal(sub.score.results, 4, 'UAT 6: missing evidence ("Not observed") does not produce a negative score');
  assert.ok(sub.score.criticalBreach, 'the critical SOP is flagged');
  rv = okc(await get(A, 'review', { id: rid })).review;
  assert.deepEqual(rv.manager, {}, 'UAT 9: the employee does not see the manager part before it is shared');
  assert.equal(rv.score, null);
  no(await get(B, 'review', { id: rid }), 404, 'UAT 9: a colleague cannot see it');
  no(await get(OTHER, 'review', { id: rid }), 404, 'another company cannot see it');

  // ---- approval (UAT 5)
  no(await post(BOSS_AP, 'review-approve', { id: rid }), 403, 'UAT 5: the manager cannot approve the review they wrote');
  no(await post(HR, 'review-approve', { id: rid }), 400, 'a critical SOP flag needs a note');
  const ap = okc(await post(HR, 'review-approve', { id: rid, note: 'Checked the security incident record; coaching agreed.' }));
  assert.equal(ap.review.status, 'APPROVED');
  okc(await post(HR, 'review-publish', { id: rid }));
  rv = okc(await get(A, 'review', { id: rid })).review;
  assert.equal(rv.status, 'PUBLISHED'); assert.ok(rv.score.overall > 0, 'now the employee sees the score');

  // ---- growth plan proposed automatically, confirmed by the manager
  const g = okc(await get(BOSS, 'growth', { uid: 'u_a' })).items[0];
  assert.equal(g.status, 'PROPOSED');
  no(await post(A, 'growth-save', { id: g.id, confirm: true }), 403, 'the manager confirms, not the employee');
  okc(await post(BOSS, 'growth-save', { id: g.id, type: g.type, objective: g.objective || 'Improve first-time acceptance', actions: [{ text: 'Motion design course' }], reviewDate: addDays(T, 60), expected: 'At least 90% accepted first time', support: 'Weekly feedback', confirm: true }));
  const hrbp = [...(fdb.stores.get('hrbpItems')?.values() || [])].filter((x: any) => x.kind === 'trainingNeed');
  assert.ok(hrbp.length >= 1, 'training needs go to HRBP');

  // ---- disagreement (UAT 8)
  no(await post(A, 'review-respond', { id: rid, agree: false }), 400, 'a disagreement needs words');
  okc(await post(A, 'review-respond', { id: rid, agree: false, comment: 'The security SOP item was a system outage, not my mistake.' }));
  rv = okc(await get(HR, 'review', { id: rid })).review;
  assert.equal(rv.status, 'DISPUTED'); assert.match(rv.response.comment, /system outage/, 'UAT 8: kept exactly as written');
  okc(await post(HR, 'review-resolve', { id: rid, note: 'Confirmed outage with IT. Opening an amendment.' }));

  // ---- amendment, never a silent overwrite (UAT 12)
  no(await post(BOSS, 'review-manager', { ...mBody, discussedOn: T, submit: true }), 403, 'UAT 12: a final review cannot be edited directly');
  no(await post(HR, 'review-amend', { id: rid, reason: 'short' }), 400);
  okc(await post(HR, 'review-amend', { id: rid, reason: 'SOP item was an IT outage, confirmed by IT.' }));
  rv = okc(await get(HR, 'review', { id: rid })).review;
  assert.equal(rv.status, 'MANAGER'); assert.equal(rv.amendments.length, 1); assert.equal(rv.amendments[0].before.score.criticalBreach, true, 'UAT 12: the old version is kept');
  okc(await post(BOSS, 'review-manager', { ...mBody, sops: { 'SOP-BRIEF': 'C', 'SOP-SEC': 'NA' }, discussedOn: T, submit: true }));
  okc(await post(AP, 'review-approve', { id: rid }));
  okc(await post(AP, 'review-publish', { id: rid }));
  okc(await post(A, 'review-respond', { id: rid, agree: true }));
  const hist = okc(await get(HR, 'review', { id: rid })).history.map((x: any) => x.action);
  assert.ok(hist.includes('AMENDMENT_STARTED') && hist.filter((x: string) => x === 'APPROVED').length === 2, 'UAT 12: every step is on the audit trail');

  // ---- AI off never blocks a manual review (UAT 11)
  const rbid = `${CID}_${Q.key}_u_b`;
  okc(await post(B, 'review-self', { id: rbid, kpis: { k1: 3, k2: 3 }, comps: Object.fromEntries(rb.snap === null ? okc(await get(B, 'review', { id: rbid })).review.snap.comps.map((x: any) => [x.id, 3]) : []), achievements: 'Delivered all briefs.', submit: true }));
  const dr = okc(await post(BOSS, 'ai-draft', { id: rbid }));
  assert.equal(dr.ai, false); assert.ok(typeof dr.draft.strengths === 'string', 'UAT 11: with AI off the manager still gets a plain draft and can continue');

  // ---- SOP new version: only that SOP needs a fresh acknowledgement (UAT 3)
  doc('SOP-BRIEF', 'Design brief intake', 'Design', 'v2');
  okc(await post(HR, 'run-daily'));
  const myPlan = okc(await get(A, 'my')).plan;
  assert.equal(myPlan.sops.find((x: any) => x.documentId === 'SOP-BRIEF').ackAt, '', 'UAT 3: the changed SOP needs acknowledging again');
  assert.ok(myPlan.sops.find((x: any) => x.documentId === 'SOP-SEC').ackAt, 'UAT 3: the unchanged SOP keeps its acknowledgement');

  // ---- department change keeps history (UAT 4)
  fdb.seed('employees', 'u_a', { ...JSON.parse(JSON.stringify((await fdb.collection('employees').doc('u_a').get()).data())), departmentName: 'Marketing', title: 'Designer' });
  okc(await post(HR, 'run-daily'));
  const all = [...fdb.stores.get('pmPlans')!.values()].filter((p: any) => p.uid === 'u_a');
  assert.equal(all.length, 2); assert.ok(all.some((p: any) => p.status === 'CLOSED' && p.department === 'Design'), 'UAT 4: the old plan is kept');
  assert.ok([...fdb.stores.get('pmEvidence')!.values()].some((e: any) => e.uid === 'u_a' && e.planId === pa.id), 'UAT 4: old evidence is kept');
  assert.equal(okc(await get(A, 'review', { id: rid })).review.status, 'ACKNOWLEDGED', 'UAT 4: past reviews are untouched');

  // ---- reports: groups only for leadership
  no(await get(A, 'report'), 403);
  const rep = okc(await get(AP, 'report', { cycle: Q.key }));
  assert.ok(rep.total >= 3 && rep.departments.every((d: any) => d.average === null || d.people >= 3), 'department averages only for groups of 3+');

  console.log('pm: all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
