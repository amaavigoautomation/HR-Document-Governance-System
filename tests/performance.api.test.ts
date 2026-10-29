import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePerf } from '../api/_lib/perfApi.ts';
import { addDays, istToday } from '../shared/leaveEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });

const CID = 'c1';
const tok = (uid: string, perms: string[] = []) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['perf.manage', 'perf.view']);
const AP = tok('u_ap', ['perf.approve', 'perf.view']);
const MGR = tok('u_mgr');
const EMP = tok('u_emp');
const E2 = tok('u_e2');
const E3 = tok('u_e3');
const OTHER = tok('u_other');

fdb.seed('companies', CID, { name: 'Acme Ltd' });
const people: [string, string, string, string][] = [
  ['u_hr', 'Hema HR', 'HR', 'HR Manager'], ['u_ap', 'Anil Approver', 'Management', 'Director'], ['u_mgr', 'Manu Manager', 'Marketing', 'Marketing Lead'],
  ['u_emp', 'Esha Employee', 'Marketing', 'Performance Marketing Executive'], ['u_e2', 'Eli Two', 'Marketing', 'Executive'], ['u_e3', 'Ena Three', 'Marketing', 'Executive'], ['u_other', 'Omar Other', 'Finance', 'Accountant'],
];
for (const [uid, name, dept, title] of people) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: dept, title });
  fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, joinDate: '2020-01-01', managerUid: ['u_emp', 'u_e2', 'u_e3'].includes(uid) ? 'u_mgr' : uid === 'u_mgr' ? 'u_ap' : '' });
}

const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routePerf({ method, action, headers: h, body, query });
const ok = async (h: any, method: string, action: string, body?: any, query?: any) => {
  const r = await call(h, method, action, body, query);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.json)}`);
  return r.json;
};
const today = istToday();

// --- access
assert.equal((await call(EMP, 'GET', 'settings')).status, 403, 'employees cannot read setup');
assert.equal((await call(EMP, 'POST', 'apply-starter')).status, 403);
assert.equal((await call({}, 'GET', 'me')).status, 401, 'no token, no access');
let me = await ok(EMP, 'GET', 'me');
assert.equal(me.configured, false);

// --- setup
const st = await ok(HR, 'POST', 'apply-starter');
assert.ok(st.added.competencies >= 16 && st.added.families >= 4 && st.added.frameworks === 1 && st.added.templates === 1);
const st2 = await ok(HR, 'POST', 'apply-starter');
assert.deepEqual(st2.added, { competencies: 0, families: 0, frameworks: 0, templates: 0 }, 'starter is idempotent');
const settings = await ok(HR, 'GET', 'settings');
assert.ok(settings.webhookKey.length >= 16);
const fw = (await ok(HR, 'GET', 'frameworks')).items[0];
assert.equal((await call(HR, 'POST', 'framework-save', { id: fw.id, name: 'Bad', weights: { kra: 50, behaviour: 25, sop: 15 }, effectiveFrom: today })).status, 400, 'weights must total 100');
await ok(HR, 'POST', 'framework-save', { id: fw.id, name: 'IC framework', weights: { kra: 60, behaviour: 25, sop: 15 }, effectiveFrom: addDays(today, -30), employeeCategory: 'INDIVIDUAL' });
assert.equal((await call(EMP, 'POST', 'framework-approve', { id: fw.id })).status, 403);
await ok(AP, 'POST', 'framework-approve', { id: fw.id });
assert.equal((await call(HR, 'POST', 'framework-save', { id: fw.id, name: 'x', weights: { kra: 60, behaviour: 25, sop: 15 }, effectiveFrom: today })).status, 400, 'approved framework is frozen');
const tpl = (await ok(HR, 'GET', 'templates')).items[0];
await ok(HR, 'POST', 'template-approve', { id: tpl.id });

// --- plans: never guessed
const gen = await ok(HR, 'POST', 'plan-generate', {});
assert.ok(gen.created >= 5);
const gen2 = await ok(HR, 'POST', 'plan-generate', {});
assert.equal(gen2.created, gen.pending, 'only still-pending plans are rebuilt on a rerun, nothing is duplicated');
const all = (await ok(HR, 'GET', 'plans', {}, { scope: 'all' })).items;
const planOf = (uid: string) => all.find((p: any) => p.uid === uid);
assert.equal(planOf('u_emp').status, 'DRAFT');
assert.ok(planOf('u_emp').kras.length > 0);
assert.ok(planOf('u_emp').kras.every((k: any) => k.kpis.every((p: any) => p.target === '')), 'targets are never invented');
assert.equal(planOf('u_other').status, 'CONFIGURATION_PENDING', 'no template for Finance');
assert.match(planOf('u_other').pendingReason, /KRA/);
assert.equal(planOf('u_hr').status, 'CONFIGURATION_PENDING');
const ex = (await ok(HR, 'GET', 'exceptions')).items;
assert.ok(ex.some((e: any) => e.category === 'NO_KRA'));
assert.ok(ex.some((e: any) => e.category === 'NO_MANAGER'));

// manager customises, HR approves, employee acknowledges
const mine = (await ok(EMP, 'GET', 'plans')).items;
assert.equal(mine.length, 1, 'employee sees only their own plan');
assert.equal((await call(EMP, 'POST', 'plan-save', { id: planOf('u_emp').id, kras: planOf('u_emp').kras })).status, 403, 'employee cannot set own targets');
assert.equal((await call(MGR, 'POST', 'plan-submit', { id: planOf('u_emp').id })).status, 400, 'blank targets block submission');
const filled = planOf('u_emp').kras.map((k: any) => ({ ...k, kpis: k.kpis.map((p: any) => ({ ...p, target: `At least 90% ${p.code} on time` })) }));
const bad = filled.map((k: any, i: number) => (i === 0 ? { ...k, kpis: k.kpis.map((p: any) => ({ ...p, weightage: 5 })) } : k));
await ok(MGR, 'POST', 'plan-save', { id: planOf('u_emp').id, kras: bad });
assert.equal((await call(MGR, 'POST', 'plan-submit', { id: planOf('u_emp').id })).status, 400, 'KPI weights must total 100');
await ok(MGR, 'POST', 'plan-save', { id: planOf('u_emp').id, kras: filled });
await ok(MGR, 'POST', 'plan-submit', { id: planOf('u_emp').id });
assert.equal((await call(MGR, 'POST', 'plan-decide', { id: planOf('u_emp').id, decision: 'APPROVE' })).status, 403, 'manager cannot approve');
await ok(HR, 'POST', 'plan-decide', { id: planOf('u_emp').id, decision: 'APPROVE' });
assert.equal((await call(MGR, 'POST', 'plan-ack', { id: planOf('u_emp').id })).status, 404, 'only the employee acknowledges');
await ok(EMP, 'POST', 'plan-ack', { id: planOf('u_emp').id });
const active = (await ok(EMP, 'GET', 'plans')).items[0];
assert.equal(active.status, 'ACTIVE');
const kpi = active.kras[0].kpis[0];

// --- evidence
const ev = (await ok(EMP, 'POST', 'evidence-add', { kpiId: kpi.id, description: 'Launched Q2 campaign', reference: 'https://tasks.example/123', value: 12 })).item;
assert.equal(ev.status, 'PENDING');
assert.equal((await call(OTHER, 'GET', 'evidence-list', {}, { uid: 'u_emp' })).status, 403);
assert.equal((await call(EMP, 'POST', 'evidence-verify', { id: ev.id })).status, 403, 'employee cannot verify own evidence');
await ok(MGR, 'POST', 'evidence-verify', { id: ev.id });
const hookBody = { key: settings.webhookKey, externalId: 'T-1', employeeEmail: 'u_emp@acme.com', kpiCode: kpi.code, description: 'Task closed', value: 3 };
assert.equal((await call({}, 'POST', 'evidence-hook', { ...hookBody, key: 'wrong-wrong-wrong-wrong' })).status, 401);
assert.equal((await call({}, 'POST', 'evidence-hook', hookBody)).json.mapped, true);
assert.equal((await call({}, 'POST', 'evidence-hook', hookBody)).json.duplicate, true, 'same delivery twice is ignored');
const un = await call({}, 'POST', 'evidence-hook', { ...hookBody, externalId: 'T-2', kpiCode: 'NOPE' });
assert.equal(un.json.mapped, false);
assert.equal((await ok(MGR, 'GET', 'evidence-list', {}, { uid: 'u_emp' })).items.length, 2);

// --- SOPs
const sop = (await ok(HR, 'POST', 'sop-save', {
  title: 'Campaign QA SOP', departmentName: 'Marketing', criticality: 'NORMAL', mandatory: true, versionNumber: '1.0',
  checkpoints: [{ text: 'Tracking checked before launch', critical: false }, { text: 'Budget approved before spend', critical: true }],
})).item;
const asg = (await ok(EMP, 'GET', 'sop-assignments')).items;
assert.equal(asg.length, 1);
assert.equal(asg[0].ackStatus, 'PENDING');
await ok(EMP, 'POST', 'sop-ack', { id: asg[0].id });
assert.equal((await ok(EMP, 'GET', 'sop-assignments')).items[0].ackStatus, 'ACKNOWLEDGED');
assert.equal((await call(EMP, 'POST', 'sop-save', { title: 'x' })).status, 403);
const sync1 = await ok(HR, 'POST', 'sop-sync');
assert.equal(sync1.sync.created, 0, 'syncing again creates nothing');
assert.equal((await ok(MGR, 'GET', 'sop-assignments', {}, { uid: 'u_emp' })).items.length, 1);
assert.equal((await call(OTHER, 'GET', 'sop-assignments', {}, { uid: 'u_emp' })).status, 403);

// --- cycle and review
const cyc = (await ok(HR, 'POST', 'cycle-save', {
  name: 'Q-test', reviewType: 'QUARTERLY', periodStart: addDays(today, -60), periodEnd: today, selfDeadline: addDays(today, 5), managerDeadline: addDays(today, 10), hrDeadline: addDays(today, 15),
  scope: { departmentName: 'Marketing' },
})).item;
assert.equal((await call(HR, 'POST', 'cycle-save', { name: 'bad', periodStart: today, periodEnd: addDays(today, -1) })).status, 400);
const open = await ok(HR, 'POST', 'cycle-open', { id: cyc.id });
assert.ok(open.created >= 3);
const open2 = await ok(HR, 'POST', 'cycle-open', { id: cyc.id });
assert.equal(open2.created, 0, 'opening again creates no second review');
const rows = (await ok(HR, 'GET', 'reviews', {}, { scope: 'all' })).items;
assert.equal(rows.length, 4);
assert.equal(rows.find((r: any) => r.uid === 'u_e2').status, 'CONFIGURATION_PENDING', 'no plan, no review form');
const rid = rows.find((r: any) => r.uid === 'u_emp').id;
assert.equal(rows.find((r: any) => r.uid === 'u_emp').status, 'SELF_PENDING');

let rv = await ok(EMP, 'GET', 'review', {}, { id: rid });
assert.equal(rv.item.scores, undefined, 'employee does not see scores before publication');
assert.equal((await call(OTHER, 'GET', 'review', {}, { id: rid })).status, 403);
assert.equal((await call(MGR, 'POST', 'review-self-save', { id: rid })).status, 403, 'manager cannot fill in the self-assessment');
const selfKpis = rv.item.kras.flatMap((k: any) => k.kpis).map((p: any) => ({ kpiId: p.id, selfNote: 'Delivered', selfScore: 4 }));
const selfComps = rv.item.competencies.map((c: any) => ({ competencyId: c.competencyId, selfRating: 4, selfExamples: 'Example' }));
assert.equal((await call(EMP, 'POST', 'review-self-submit', { id: rid, kpis: selfKpis })).status, 400, 'incomplete self-assessment blocked');
await ok(EMP, 'POST', 'review-self-submit', { id: rid, kpis: selfKpis, competencies: selfComps, achievements: 'Shipped campaigns' });
assert.equal((await call(EMP, 'POST', 'review-self-save', { id: rid })).status, 400, 'locked after submission');

// manager
rv = await ok(MGR, 'GET', 'review', {}, { id: rid });
const kp = rv.item.kras.flatMap((k: any) => k.kpis);
const mgrKpis = kp.map((p: any, i: number) => (i === 0 ? { kpiId: p.id, insufficientEvidence: true, managerNote: 'No data yet' } : { kpiId: p.id, managerScore: 4, managerNote: 'Good' }));
const mgrComps = rv.item.competencies.map((c: any) => ({ competencyId: c.competencyId, managerRating: 3 }));
const sopChecks = rv.item.sopChecks.map((c: any) => ({ sopId: c.sopId, checkpointId: c.checkpointId, result: 'COMPLIANT' }));
assert.equal((await call(EMP, 'POST', 'review-mgr-save', { id: rid })).status, 403);
await ok(MGR, 'POST', 'review-mgr-save', { id: rid, kpis: mgrKpis, competencies: mgrComps, sopChecks });
assert.equal((await call(MGR, 'POST', 'review-mgr-submit', { id: rid, managerComments: '' })).status, 400, 'comments required');
const sub = await ok(MGR, 'POST', 'review-mgr-submit', { id: rid, managerComments: 'Solid quarter', strengths: 'Reliable' });
assert.equal(sub.item.status, 'DISCUSSION_PENDING');
assert.equal(sub.item.scores.kra, 4, 'insufficient-evidence KPI is left out, not scored 0');
assert.equal(sub.item.scores.behaviour, 3);
assert.equal(sub.item.scores.sop, 5);
assert.equal(sub.item.scores.overall, 3.9, '(4x60 + 3x25 + 5x15) / 100');
assert.equal(sub.item.scores.partial, false);
assert.equal((await call(MGR, 'POST', 'review-discussion', { id: rid })).status, 400, 'discussion needs a note');
await ok(MGR, 'POST', 'review-discussion', { id: rid, note: 'Walked through the ratings' });

// HR then approver, with segregation of duties
assert.equal((await call(AP, 'POST', 'review-approve', { id: rid })).status, 400, 'cannot approve before HR step');
const fwd = await call(HR, 'POST', 'review-hr-forward', { id: rid, adjustments: [{ target: `kpi:${kp[1].id}`, to: 5, reason: '' }] });
assert.equal(fwd.status, 400, 'calibration needs a reason');
assert.equal((await call(OTHER, 'POST', 'review-hr-forward', { id: rid })).status, 403);
await ok(HR, 'POST', 'review-hr-forward', { id: rid, hrNote: 'Consistent with evidence' });
assert.equal((await call(MGR, 'POST', 'review-approve', { id: rid })).status, 403, 'evaluating manager cannot approve');
assert.equal((await call(HR, 'POST', 'review-approve', { id: rid })).status, 403, 'HR without approval right cannot approve');
assert.equal((await call(EMP, 'GET', 'review', {}, { id: rid })).json.item.scores, undefined, 'still hidden until published');
await ok(AP, 'POST', 'review-approve', { id: rid, finalComments: 'Approved' });
rv = await ok(EMP, 'GET', 'review', {}, { id: rid });
assert.equal(rv.item.status, 'PUBLISHED');
assert.equal(rv.item.scores.overall, 3.9, 'visible after publication');
assert.equal((await call(AP, 'POST', 'review-respond', { id: rid })).status, 403, 'only the employee responds');
assert.equal((await call(EMP, 'POST', 'review-respond', { id: rid, decision: 'DISAGREE' })).status, 400, 'disagreement needs a reason');

// amendment of a finalised review is allowed only with a reason, and leaves a trail
assert.equal((await call(AP, 'POST', 'review-amend', { id: rid, adjustments: [{ target: `kpi:${kp[1].id}`, to: 5, reason: '' }] })).status, 400);
const am = await ok(AP, 'POST', 'review-amend', { id: rid, adjustments: [{ target: `kpi:${kp[1].id}`, to: 5, reason: 'Missed evidence added later' }] });
assert.equal(am.item.adjustments.length, 1);
assert.ok(am.item.scores.kra > 4);
assert.ok((await ok(HR, 'GET', 'exceptions')).items.some((e: any) => e.category === 'REVIEW_AMENDED'));
await ok(EMP, 'POST', 'review-respond', { id: rid, decision: 'DISAGREE', comment: 'I do not agree with the SOP rating' });
rv = await ok(HR, 'GET', 'review', {}, { id: rid });
assert.equal(rv.item.status, 'DISPUTED');
assert.equal((await call(MGR, 'POST', 'review-dispute-resolve', { id: rid, resolution: 'x' })).status, 403, 'manager cannot resolve');
await ok(AP, 'POST', 'review-dispute-resolve', { id: rid, resolution: 'Evidence re-read; rating stands', outcome: 'UPHELD' });
assert.equal((await ok(HR, 'GET', 'review', {}, { id: rid })).item.status, 'CLOSED');

// --- dashboards: small groups are never broken out
const dash = await ok(HR, 'GET', 'dashboard', {}, { scope: 'leadership', cycleId: cyc.id });
assert.equal(dash.distribution, null, 'fewer than three finished reviews: no distribution');
assert.ok(dash.departments.every((d: any) => d.hidden));
assert.equal((await call(EMP, 'GET', 'dashboard', {}, { scope: 'hr' })).status, 403);

// --- check-ins, development, notifications, audit
const ci = await ok(MGR, 'POST', 'checkin-save', { uid: 'u_emp', progress: 'On track', feedback: 'Keep going', done: true });
assert.equal(ci.item.status, 'DONE');
assert.equal((await call(OTHER, 'POST', 'checkin-save', { uid: 'u_emp', progress: 'x' })).status, 403);
assert.equal((await call(MGR, 'POST', 'devplan-save', { reviewId: rid, outcome: 'IMPROVEMENT', performanceGap: 'g' })).status, 400, 'improvement plan needs the full set');
const dp = await ok(MGR, 'POST', 'devplan-save', { reviewId: rid, outcome: 'DEVELOPMENT', actions: [{ text: 'Analytics course', dueDate: addDays(today, 30) }] });
assert.equal((await ok(EMP, 'GET', 'devplans')).items.length, 1);
assert.equal(dp.item.status, 'ACTIVE');
assert.ok((await ok(EMP, 'GET', 'notifications')).items.length > 0);
assert.equal((await call(EMP, 'GET', 'audit-log')).status, 403);
assert.ok((await ok(HR, 'GET', 'audit-log')).items.length > 5);
assert.equal((await call({}, 'GET', 'cron')).status, 503, 'cron key must be configured');
process.env.CRON_SECRET = 'secret-secret';
assert.equal((await call({}, 'GET', 'cron', {}, { key: 'nope' })).status, 401);
const cron = await ok({}, 'GET', 'cron', {}, { key: 'secret-secret' });
assert.equal(cron.companies[0].error, undefined);
const cron2 = await ok({}, 'GET', 'cron', {}, { key: 'secret-secret' });
assert.equal(cron2.companies[0].checkins, 0, 'a second run creates no duplicate check-ins');

// --- cannot review yourself: a manager who is also the employee
assert.equal((await call(MGR, 'POST', 'review-self-save', { id: rid })).status, 403);

console.log('performance api tests passed');
