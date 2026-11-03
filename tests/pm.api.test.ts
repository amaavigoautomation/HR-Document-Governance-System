import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePm } from '../api/_lib/pmApi.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['pm.manage']);
const AP = tok('u_ap', ['pm.approve']);
const BOSS = tok('u_boss');
const A = tok('u_a'); const B = tok('u_b'); const D = tok('u_d');
const OTHER = tok('x1', ['pm.manage', 'pm.approve'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routePm({ method, action, headers: h, body, query });
const get = (h: any, action: string, query: any = {}) => call(h, 'GET', action, {}, query);
const post = (h: any, action: string, body: any = {}) => call(h, 'POST', action, body);
const okc = (r: any, msg = '') => assert.equal(r.status, 200, `${msg} ${JSON.stringify(r.json)}`);

const emp = (id: string, name: string, dept: string, title: string) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: dept, title, createdAt: '2025-01-01T00:00:00Z' });
emp('u_hr', 'Hema HR', 'HR', 'HR Manager'); emp('u_ap', 'Ajay Approver', 'Management', 'Founder'); emp('u_boss', 'Bo Boss', 'Design', 'Design Lead');
emp('u_a', 'Asha', 'Design', 'Designer'); emp('u_b', 'Bilal', 'Design', 'Designer'); emp('u_d', 'Dev', 'Sales', 'Sales Executive');
fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Other', email: 'x1@o.com', active: true, departmentName: 'Design', title: 'Designer' });
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
const mgr = (uid: string, m: string) => fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: m });
mgr('u_a', 'u_boss'); mgr('u_b', 'u_boss'); mgr('u_d', 'u_boss'); mgr('u_boss', 'u_ap'); mgr('u_hr', 'u_ap');

async function main() {
  // ---- access
  assert.equal((await call({}, 'GET', 'home')).status, 401);
  assert.equal((await get(A, 'setup-status')).status, 403);
  assert.equal((await post(A, 'quickstart')).status, 403);
  assert.equal((await post(HR, 'home')).status, 405);
  assert.equal((await get(HR, 'nope')).status, 404);

  // ---- 1. nothing is configured yet: no silent defaults, no approvers invented
  okc(await post(HR, 'sync'));
  const early = (await get(HR, 'plan-list', { scope: 'all' })).json.items;
  assert.ok(early.length > 0 && early.every((p: any) => p.status === 'CONFIGURATION_PENDING'), 'without an approved framework every plan waits (CONFIGURATION_PENDING)');

  // ---- scoring rules: weights validated, approval only by an approver
  okc(await post(HR, 'quickstart'));
  const bad = await post(HR, 'fw-save', { name: 'Bad', employeeCategory: 'INDIVIDUAL_CONTRIBUTOR', kraWeight: 60, behaviourWeight: 25, sopWeight: 10 });
  assert.equal(bad.status, 400, 'UAT 7: overall weights must total 100');
  const fws = (await get(HR, 'fw-list')).json.items;
  assert.equal(fws.length, 1);
  assert.equal((await post(HR, 'fw-approve', { id: fws[0].id })).status, 403, 'HR without approval rights cannot approve');
  okc(await post(AP, 'fw-approve', { id: fws[0].id }));
  assert.equal((await get(A, 'fw-list')).json.items.length, 1);

  // ---- 2. KRA/KPI template per role; weights must total 100
  const roles = (await get(HR, 'role-list')).json.items;
  const designer = roles.find((r: any) => r.name === 'Designer'); const sales = roles.find((r: any) => r.name === 'Sales Executive');
  assert.ok(designer && sales);
  const row = (k: string, w: number) => ({ kraName: k, kpiName: `${k} KPI`, measurement: 'count', weightage: w, frequency: 'MONTHLY', evidenceSource: 'TASK_SYSTEM' });
  assert.equal((await post(HR, 'tpl-save', { roleId: designer.id, items: [row('Delivery', 50), row('Quality', 30)] })).status, 400, 'UAT 7: KPI weights must total 100');
  const t1 = await post(HR, 'tpl-save', { roleId: designer.id, items: [row('Delivery', 60), row('Quality', 40)] }); okc(t1);
  okc(await post(AP, 'tpl-approve', { id: t1.json.item.id }));
  const t2 = await post(HR, 'tpl-save', { roleId: sales.id, items: [row('Revenue', 100)] }); okc(t2);
  okc(await post(AP, 'tpl-approve', { id: t2.json.item.id }));

  // ---- SOPs: different roles, different assignments
  const sop1 = await post(HR, 'sop-save', { title: 'Design handoff', department: 'Design', roleIds: [designer.id], criticality: 'CRITICAL', acknowledgementRequired: true, checkpoints: [{ control: 'Files named correctly', critical: false }, { control: 'Client approval stored', critical: true }] });
  okc(sop1, 'sop-save');
  okc(await post(HR, 'sync'));

  // ---- 3. new employee gets the right KRA/KPI, competencies and SOPs
  const plans = (await get(HR, 'plan-list', { scope: 'all' })).json.items;
  const pa = plans.find((p: any) => p.uid === 'u_a'); const pd = plans.find((p: any) => p.uid === 'u_d');
  assert.equal(pa.status, 'GENERATED'); assert.equal(pa.kpiCount, 2); assert.equal(pd.kpiCount, 1, 'different roles get different KRA/KPI');
  const sa = (await get(A, 'sopassign-list')).json.items; const sd = (await get(D, 'sopassign-list')).json.items;
  assert.equal(sa.length, 1, 'designer is assigned the design SOP'); assert.equal(sd.length, 0, 'UAT 2: a sales executive is not');
  const full = (await get(A, 'plan-get', { id: pa.id })).json.item;
  assert.ok(full.competencies.length >= 5, 'core competencies come with the plan');

  // ---- SOP: read and acknowledge are separate
  assert.equal((await post(A, 'sop-ack', { id: sa[0].id })).status, 409, 'cannot acknowledge before reading');
  okc(await post(A, 'sop-read', { id: sa[0].id })); okc(await post(A, 'sop-ack', { id: sa[0].id }));

  // ---- plan workflow: manager sets targets, HR validates, approver approves, employee acknowledges
  const targets = full.kpis.map((k: any, i: number) => ({ targetId: k.id, target: i ? '95%' : '20 per month' }));
  assert.equal((await post(A, 'plan-save', { id: pa.id, targets })).status, 403, 'an employee does not set their own targets');
  okc(await post(BOSS, 'plan-save', { id: pa.id, targets }));
  okc(await post(BOSS, 'plan-act', { id: pa.id, action: 'submit' }));
  assert.equal((await post(AP, 'plan-act', { id: pa.id, action: 'approve' })).status, 409, 'HR validation comes first');
  okc(await post(HR, 'plan-act', { id: pa.id, action: 'validate' }));
  okc(await post(AP, 'plan-act', { id: pa.id, action: 'approve' }));
  assert.equal((await post(BOSS, 'plan-act', { id: pa.id, action: 'acknowledge' })).status, 403, 'only the employee acknowledges');
  okc(await post(A, 'plan-act', { id: pa.id, action: 'acknowledge' }));
  assert.equal((await get(A, 'plan-get', { id: pa.id })).json.item.status, 'ACTIVE');

  // Bilal gets the same flow quickly so two reviews can run
  const pb = plans.find((p: any) => p.uid === 'u_b'); const fb = (await get(B, 'plan-get', { id: pb.id })).json.item;
  okc(await post(BOSS, 'plan-save', { id: pb.id, targets: fb.kpis.map((k: any) => ({ targetId: k.id, target: 'x' })) }));
  okc(await post(BOSS, 'plan-act', { id: pb.id, action: 'submit' })); okc(await post(HR, 'plan-act', { id: pb.id, action: 'validate' }));
  okc(await post(AP, 'plan-act', { id: pb.id, action: 'approve' })); okc(await post(B, 'plan-act', { id: pb.id, action: 'acknowledge' }));

  // ---- 4. a material SOP change asks again; a minor one does not
  fdb.seed('documents', 'doc1', { companyId: CID, documentId: 'D1', title: 'Design handoff', category: 'SOP', departmentName: 'Design', currentPublishedVersionId: 'v1', currentPublishedVersionNumber: '1' });

  // ---- 5. department transfer keeps history
  fdb.seed('employees', 'u_d', { companyId: CID, authUid: 'u_d', name: 'Dev', email: 'u_d@acme.com', active: true, departmentName: 'Design', title: 'Designer', createdAt: '2025-01-01T00:00:00Z' });
  okc(await post(HR, 'sync'));
  const hist = (await get(HR, 'plan-list', { scope: 'all', history: '1' })).json.items.filter((p: any) => p.uid === 'u_d');
  assert.ok(hist.some((p: any) => p.status === 'SUPERSEDED' && p.roleName === 'Sales Executive'), 'UAT 4: the old plan is kept');
  assert.ok(hist.some((p: any) => p.status !== 'SUPERSEDED' && p.roleName === 'Designer'), 'and the new one applies');
  fdb.seed('employees', 'u_d', { companyId: CID, authUid: 'u_d', name: 'Dev', email: 'u_d@acme.com', active: true, departmentName: 'Sales', title: 'Sales Executive', createdAt: '2025-01-01T00:00:00Z' });
  okc(await post(HR, 'sync'));

  // ---- review cycle
  assert.equal((await post(HR, 'cycle-save', { name: 'Q4', periodStart: '2026-10-01', periodEnd: '2026-09-01' })).status, 400);
  const cy = await post(HR, 'cycle-save', { name: 'Q4 2026', reviewType: 'QUARTERLY', periodStart: '2026-07-01', periodEnd: '2026-09-30', selfReviewDeadline: '2026-10-10', managerDeadline: '2026-10-20', hrDeadline: '2026-10-30', scope: 'ALL' });
  okc(cy);
  const open1 = await post(HR, 'cycle-open', { id: cy.json.item.id }); okc(open1);
  const open2 = await post(HR, 'cycle-open', { id: cy.json.item.id }); okc(open2);
  assert.equal(open2.json.created, 0, 'UAT 10: opening twice never creates duplicate reviews');
  assert.equal(open2.json.existing, open1.json.created);
  const all = (await get(HR, 'review-list', { scope: 'all' })).json.items;
  assert.equal(all.filter((r: any) => r.uid === 'u_a').length, 1);
  assert.equal(all.find((r: any) => r.uid === 'u_boss').status, 'CONFIGURATION_PENDING', 'no KRA/KPI yet: the review waits instead of getting a default score');
  assert.ok((await get(HR, 'exception-list')).json.items.some((e: any) => e.type === 'NO_KRA_KPI'), 'a missing KRA/KPI is logged');

  // ---- review for Asha, step by step
  const ra = all.find((r: any) => r.uid === 'u_a'); const rb = all.find((r: any) => r.uid === 'u_b');
  assert.equal(ra.status, 'OPEN');
  assert.equal((await post(BOSS, 'review-manager', { id: ra.id, submit: true })).status, 409, 'the manager cannot go before the self-assessment');
  const g = (await get(A, 'review-get', { id: ra.id })).json;
  assert.equal((await post(A, 'review-self', { id: ra.id, submit: true, achievements: '' })).status, 400, 'self-assessment needs achievements and ratings');
  okc(await post(A, 'review-self', { id: ra.id, submit: true, achievements: 'Shipped the brand refresh', comps: g.comps.map((c: any) => ({ competencyId: c.competencyId, selfRating: 4, selfEvidence: 'example' })), trainingNeeds: 'Motion design' }));
  assert.equal((await post(A, 'review-self', { id: ra.id, submit: true, achievements: 'again' })).status, 409, 'cannot resubmit');

  // manager: rates one KPI, no evidence for the other (must not become zero)
  const kp = g.item.kpis;
  const mgrBody = { id: ra.id, submit: true, managerEvaluation: 'Solid quarter with good delivery.', kpis: [{ targetId: kp[0].targetId, rating: 4, managerNote: 'good' }, { targetId: kp[1].targetId, insufficientEvidence: true }],
    comps: g.comps.map((c: any, i: number) => ({ competencyId: c.competencyId, managerRating: i === 0 ? 'NOT_OBSERVED' : 4, observedExamples: 'seen in sprint review' })), sopNotAssessedReason: 'Process was not in scope this quarter' };
  assert.equal((await post(A, 'review-manager', mgrBody)).status, 403, 'employees cannot evaluate themselves');
  okc(await post(BOSS, 'review-manager', mgrBody), 'manager evaluation');
  const mid = (await get(BOSS, 'review-get', { id: ra.id })).json;
  assert.equal(mid.kra.score, 4, 'UAT 6: the KPI with no evidence is left out, not scored zero');
  assert.equal(mid.overall.partial, true);
  assert.equal(mid.item.kpis[1].rating, null);
  // employee cannot see the manager's ratings until it is published
  const asEmp = (await get(A, 'review-get', { id: ra.id })).json;
  assert.equal(asEmp.item.kpis[0].rating, null, 'UAT 9: ratings are hidden from the employee until published');
  assert.equal(asEmp.overall, null);
  assert.equal(asEmp.item.manager.evaluation, '');
  assert.equal((await get(B, 'review-get', { id: ra.id })).status, 404, 'a colleague cannot open it');
  assert.equal((await get(OTHER, 'review-get', { id: ra.id })).status, 404, 'another company cannot open it');

  okc(await post(BOSS, 'review-discuss', { id: ra.id, heldOn: '2026-10-05', notes: 'Talked it through' }));
  assert.equal((await post(HR, 'review-hr', { id: ra.id, decision: 'PASS' })).status, 409, 'HR must accept the evidence gap on purpose');
  okc(await post(HR, 'review-hr', { id: ra.id, decision: 'PASS', acceptPartial: true }));

  // ---- 6. nobody approves their own review
  fdb.seed('employees', 'u_a', { companyId: CID, authUid: 'u_a', name: 'Asha', email: 'u_a@acme.com', active: true, departmentName: 'Design', title: 'Designer', createdAt: '2025-01-01T00:00:00Z' });
  const SELF_APPROVER = tok('u_a', ['pm.approve']);
  assert.equal((await post(SELF_APPROVER, 'review-approve', { id: ra.id, finalRating: 5, finalComments: 'I am great' })).status, 403, 'UAT 5: cannot approve your own review');
  assert.equal((await post(BOSS, 'review-approve', { id: ra.id, finalRating: 4, finalComments: 'ok ok' })).status, 403, 'managers without approval rights cannot approve');
  assert.equal((await post(AP, 'review-approve', { id: ra.id, finalRating: 9, finalComments: 'nope' })).status, 400);
  okc(await post(AP, 'review-approve', { id: ra.id, finalRating: 4, finalComments: 'Strong quarter.' }), 'approve');
  assert.equal((await post(BOSS, 'review-manager', { id: ra.id, managerEvaluation: 'changed it' })).status, 409, 'UAT 12: a final review cannot be silently changed');
  assert.equal((await get(A, 'review-get', { id: ra.id })).json.item.kpis[0].rating, null, 'still hidden until shared');
  okc(await post(HR, 'review-publish', { id: ra.id }));
  assert.equal((await get(A, 'review-get', { id: ra.id })).json.item.final.finalRating, 4);

  // ---- 7. disagreement is preserved and routed
  assert.equal((await post(A, 'review-respond', { id: ra.id, response: 'DISAGREE', comment: 'no' })).status, 400, 'say why');
  const words = 'The Q3 launch rating ignores the evidence I attached on 12 September.';
  okc(await post(A, 'review-respond', { id: ra.id, response: 'DISAGREE', comment: words }));
  const dis = (await get(A, 'review-get', { id: ra.id })).json.item;
  assert.equal(dis.status, 'DISPUTED'); assert.equal(dis.response.comment, words, 'exact words kept');
  assert.ok((await get(HR, 'exception-list')).json.items.some((e: any) => e.type === 'REVIEW_DISPUTED' && e.status === 'OPEN'));

  // ---- 8. amendment: authorized, reasoned, audited
  assert.equal((await post(HR, 'review-amend', { id: ra.id, finalRating: 5, reason: 'because I said so' })).status, 403, 'only an approver amends');
  assert.equal((await post(AP, 'review-amend', { id: ra.id, finalRating: 5, reason: 'short' })).status, 400);
  okc(await post(AP, 'review-amend', { id: ra.id, finalRating: 5, reason: 'Evidence from 12 September confirmed on review' }));
  const am = (await get(HR, 'review-get', { id: ra.id })).json.item;
  assert.equal(am.final.finalRating, 5); assert.equal(am.amendments.length, 1); assert.equal(am.amendments[0].before.finalRating, 4, 'old value kept');
  okc(await post(HR, 'review-resolve', { id: ra.id, outcome: 'AMENDED', note: 'Rating raised after checking the evidence' }));
  const audits = (await get(HR, 'audit-list', { entityId: ra.id })).json.items.map((a: any) => a.action);
  assert.ok(audits.includes('AMENDED') && audits.includes('APPROVED') && audits.includes('DISPUTED'), 'UAT 12: auditable');
  assert.equal((await get(A, 'audit-list')).status, 403, 'audit trail is for HR');

  // ---- 9. AI failure never blocks the manual review
  const ai = await post(BOSS, 'ai-insight', { reviewId: rb.id, capability: 'EVIDENCE_GAPS' });
  okc(ai); assert.equal(ai.json.source, 'RULES'); assert.ok(ai.json.points.length > 0, 'UAT 11: a plain answer is shown without AI');
  assert.equal((await post(A, 'ai-insight', { reviewId: rb.id, capability: 'EVIDENCE_GAPS' })).status, 403);

  // ---- evidence: duplicates are not counted twice
  const ev = { employeeUid: 'u_b', title: 'Landing page', taskId: 'T-1', completedOn: '2026-09-10', source: 'TASK_SYSTEM' };
  okc(await post(BOSS, 'ev-add', ev)); const dup = await post(BOSS, 'ev-add', ev); okc(dup); assert.equal(dup.json.outcome, 'DUPLICATE');
  assert.equal((await post(A, 'ev-add', { ...ev, employeeUid: 'u_b' })).status, 403, 'you can only add evidence for yourself or your reports');

  // ---- dashboards hide small groups
  const dash = await get(HR, 'dashboard'); okc(dash);
  assert.ok(dash.json.byDepartment.every((x: any) => x.hidden || x.people >= 3));
  assert.equal((await get(A, 'dashboard')).status, 403);

  // ---- 10. a webhook with a wrong key is refused; a right one stores evidence
  assert.equal((await call({}, 'POST', 'ev-hook', { event: 'completed' }, { c: CID, key: 'wrong' })).status, 401);
  const key = (await post(HR, 'hook-key')).json.webhookKey;
  const hook = await call({}, 'POST', 'ev-hook', { event: 'completed', task_id: 'T-9', title: 'Poster', employee_email: 'u_b@acme.com', completed_on: '2026-09-12' }, { c: CID, key });
  okc(hook, 'webhook');

  // ---- misconduct only records a pointer
  okc(await post(HR, 'misconduct-refer', { uid: 'u_b' }));
  const ref = (await get(HR, 'exception-list')).json.items.find((e: any) => e.type === 'MISCONDUCT_REFERRAL');
  assert.ok(ref && !JSON.stringify(ref).includes('Bilal'), 'no personal detail is stored in the referral');

  // ---- check-ins and development plans
  okc(await post(HR, 'sync'));
  const rv2 = (await get(BOSS, 'review-list', { scope: 'team' })).json.items; assert.ok(rv2.length >= 2);
  assert.equal((await post(A, 'dev-save', { uid: 'u_b', title: 'x', actions: [{ text: 'y' }] })).status, 403);
  assert.equal((await post(BOSS, 'dev-save', { uid: 'u_b', type: 'IMPROVEMENT', title: 'Plan', actions: [{ text: 'Do it' }] })).status, 400, 'an improvement plan must come from an approved review');
  const dp = await post(BOSS, 'dev-save', { uid: 'u_a', type: 'DEVELOPMENT', title: 'Motion design', actions: [{ text: 'Course', dueDate: '2026-12-01' }] }); okc(dp);
  assert.equal(dp.json.item.status, 'ACTIVE');
  assert.equal((await get(A, 'dev-list')).json.items.length, 1);

  // ---- SOP versions: only a material change asks people again
  const sop2 = await post(HR, 'sop-save', { title: 'Design handoff v-linked', department: 'Design', documentId: 'D1', roleIds: [designer.id], acknowledgementRequired: true, checkpoints: [{ control: 'Stored' }] }); okc(sop2, 'linked sop');
  okc(await post(HR, 'sync'));
  const ackA = (await get(A, 'sopassign-list')).json.items.find((x: any) => x.sopId === sop2.json.item.id);
  okc(await post(A, 'sop-read', { id: ackA.id })); okc(await post(A, 'sop-ack', { id: ackA.id }));
  fdb.seed('documents', 'doc1', { companyId: CID, documentId: 'D1', title: 'Design handoff', category: 'SOP', departmentName: 'Design', currentPublishedVersionId: 'v2', currentPublishedVersionNumber: '2' });
  okc(await post(HR, 'sop-sync'));
  assert.ok((await get(HR, 'exception-list')).json.items.some((e: any) => e.type === 'SOP_VERSION_CHANGED' && e.status === 'OPEN'), 'a new version is logged for a decision');
  assert.equal((await post(HR, 'sop-revision', { id: sop2.json.item.id, material: true })).status, 400, 'a material change needs an explanation');
  okc(await post(HR, 'sop-revision', { id: sop2.json.item.id, material: false }));
  const keep = (await get(A, 'sopassign-list')).json.items.find((x: any) => x.sopId === sop2.json.item.id);
  assert.ok(keep.acknowledgedAt, 'UAT 3: a minor change does not ask for another acknowledgement');
  fdb.seed('documents', 'doc1', { companyId: CID, documentId: 'D1', title: 'Design handoff', category: 'SOP', departmentName: 'Design', currentPublishedVersionId: 'v3', currentPublishedVersionNumber: '3' });
  okc(await post(HR, 'sop-sync'));
  okc(await post(HR, 'sop-revision', { id: sop2.json.item.id, material: true, note: 'New approval step' }));
  const again = (await get(A, 'sopassign-list')).json.items.find((x: any) => x.sopId === sop2.json.item.id);
  assert.ok(!again.acknowledgedAt && again.versionNumber === '3', 'a material change asks again');

  console.log('pm.api: all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
