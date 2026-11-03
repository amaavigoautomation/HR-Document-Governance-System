/**
 * HR-PM-003 (behavioural assessment) and HR-PM-006 (review and approval): workflows PM-003 and PM-007.
 *
 * The ten steps of the specification, in order:
 *   OPEN -> SELF_ASSESSED -> MANAGER_EVALUATED -> DISCUSSED -> HR_REVIEWED -> APPROVED -> PUBLISHED -> ACKNOWLEDGED (or DISPUTED, recorded and routed)
 * Rules that are enforced here and not just shown on screen:
 *  - nobody approves their own review; a review with no approved KRA/KPI cannot be finalised (it waits in CONFIGURATION_PENDING)
 *  - a missing rating is "not rated", never zero; a part with no evidence is left out and HR must accept the gap
 *  - once approved, a review is final: only an authorized, reasoned, audited amendment can change it
 *  - opening a cycle twice never creates a second review for the same person
 */
import {
  REVIEW_TYPES, behaviourPillar, completenessProblems, consistencyFlags, isDate, isFinal, isRating, kraPillar, overallScore, overlapDays, ratingBand, round, sopScore, addDays, canMove,
  type CompetencyResult, type KpiResult, type ReviewStatus, type SopResult,
} from '../../shared/pmEngine.js';
import {
  anyPerson, audit, clearException, db, fail, getK, isMyReport, lc, listK, managerOf, nameOf, newId, nowIso, num, ok, putK, raise, str, strList, tell, today,
  type C, type Item, type Route, type Result,
} from './pmCore.js';
import { evidenceFor, workContext } from './pmEvidence.js';
import { closeSuperseded } from './pmPlans.js';

const FINAL_MSG = 'This review is final. An authorized person can amend it, and every change is recorded.';
const reviewId = (cycleId: string, uid: string) => `rv_${cycleId}_${uid}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);
const textBlock = (v: unknown, max = 2000) => str(v, max);

// ------------------------------------------------------------------ opening a cycle (workflow PM-007)

function eligible(c: C, cy: Item) {
  return c.people.filter((p) => {
    if (!p.active || p.createdDate > cy.periodEnd) return false;
    if (cy.scope === 'DEPARTMENT') return (cy.departments || []).some((d: string) => lc(d) === lc(p.department));
    if (cy.scope === 'SELECTED') return (cy.employeeUids || []).includes(p.uid);
    return true;
  });
}

/** Why this person's review cannot start yet. The review is created anyway and waits, so nothing is silently skipped. */
async function blockersFor(c: C, uid: string, plans: Item[]) {
  const mine = plans.filter((p) => p.uid === uid && p.status !== 'SUPERSEDED').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const active = mine.find((p) => p.status === 'ACTIVE') || null;
  const blockers: string[] = [];
  if (!active) {
    const cur = mine[0];
    if (!cur) blockers.push('This person has no performance plan, so there is no KRA/KPI. The final review is blocked.');
    else if (cur.status === 'CONFIGURATION_PENDING') blockers.push('The plan is waiting for setup: ' + (cur.configIssues || []).map((i: any) => i.text).join(' '));
    else blockers.push(`The KRA/KPI is not active yet (it is at "${String(cur.status).toLowerCase().replace(/_/g, ' ')}"). It must be approved and acknowledged first.`);
  }
  if (!managerOf(c, uid)) blockers.push('This person has no reporting manager. Set one under Leave & Attendance > Manage > People.');
  return { active, blockers };
}

async function buildReview(c: C, cy: Item, p: any, plans: Item[], comps: Item[]): Promise<Item> {
  const { active, blockers } = await blockersFor(c, p.uid, plans);
  const mgr = managerOf(c, p.uid);
  const id = reviewId(cy.id, p.uid);
  const base: Item = {
    id, companyId: c.cid, kind: 'review', cycleId: cy.id, cycleName: cy.name, reviewType: cy.reviewType, periodStart: cy.periodStart, periodEnd: cy.periodEnd,
    selfReviewDeadline: cy.selfReviewDeadline, managerDeadline: cy.managerDeadline, hrDeadline: cy.hrDeadline, uid: p.uid, employeeName: p.name, department: p.department, title: p.title,
    planId: active?.id || '', managerUid: mgr, managerName: nameOf(c, mgr), status: blockers.length ? 'CONFIGURATION_PENDING' : 'OPEN', blockers, weights: active?.weights || null,
    snapshot: active ? { frameworkId: active.frameworkId, frameworkName: active.frameworkName, frameworkVersion: active.frameworkVersion, templateVersion: active.templateVersion, competencies: (active.competencies || []).map((x: any) => ({ id: x.competencyId, name: x.name, version: x.version })) } : null,
    self: { achievements: '', improvements: '', trainingNeeds: '', comments: '', submittedAt: '', waived: '' },
    kpis: [], manager: { evaluation: '', achievements: '', improvements: '', trainingNeeds: '', submittedAt: '', sopNotAssessedReason: '' },
    discussion: { heldOn: '', notes: '' }, hr: { checkedBy: '', checkedAt: '', note: '', acceptedPartial: false, criticalAck: false }, final: null, response: null, amendments: [], leaveFlag: 0,
  };
  if (active) {
    const targets = (await listK(c.cid, 'kpiTarget')).filter((k) => k.planId === active.id);
    base.kpis = targets.map((t): KpiResult => ({ targetId: t.id, kpiName: t.kpiName, kraName: t.kraName, weightage: Number(t.weightage) || 0, target: t.target, rating: null, insufficientEvidence: false, employeeNote: '', managerNote: '', evidenceIds: [], finalRating: null, calibrationReason: '' }));
    // PM-003: the assessment template. One row per competency in the plan, frozen at this version.
    for (const x of active.competencies || []) {
      const caId = `ca_${id}_${x.competencyId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);
      if (!(await getK(c.cid, caId, 'compAssess'))) await putK({ id: caId, companyId: c.cid, kind: 'compAssess', reviewId: id, uid: p.uid, competencyId: x.competencyId, name: x.name, weight: Number(x.weight) || 1, expectedBehaviour: x.expectedBehaviour, expectedLevel: x.expectedLevel,
        selfRating: null, selfEvidence: '', managerRating: null, observedExamples: '', evidenceRefs: '', managerComment: '', finalRating: null, calibrationReason: '', reviewerUid: '' });
    }
  }
  return base;
}

async function cycleOpen(c: C, b: any): Promise<Result> {
  const cy = await getK(c.cid, str(b.id, 80), 'cycle');
  if (!cy) return fail(404, 'That cycle was not found.');
  if (cy.lockStatus === 'LOCKED') return fail(409, 'This cycle is locked.');
  const [plans, comps] = await Promise.all([listK(c.cid, 'plan'), listK(c.cid, 'competency')]);
  const people = eligible(c, cy);
  if (people.length === 0) return fail(400, 'No active employee matches this cycle. Check who it is for.');
  let created = 0; let existing = 0; let waiting = 0; let onLeave = 0;
  for (const p of people) {
    const id = reviewId(cy.id, p.uid);
    if (await getK(c.cid, id, 'review')) { existing++; continue; }   // idempotency: never a second review for the same person and cycle
    const rv = await buildReview(c, cy, p, plans, comps);
    const w = await workContext(c, p.uid, cy.periodStart, cy.periodEnd);
    rv.leaveFlag = w.leaveDays;
    await putK(rv);
    created++;
    if (rv.status === 'CONFIGURATION_PENDING') {
      waiting++;
      await raise(c, 'CONFIGURATION_PENDING', { refId: `review_${id}`, subjectUid: p.uid, refLabel: `${p.name} - ${cy.name}`, ownerUid: rv.managerUid, detail: rv.blockers.join(' ') });
      if (rv.blockers.some((x: string) => /no performance plan|no KRA|not active yet/i.test(x))) await raise(c, 'NO_KRA_KPI', { refId: `review_${id}`, subjectUid: p.uid, refLabel: `${p.name} - ${cy.name}`, ownerUid: rv.managerUid, detail: `${p.name} has no approved KRA/KPI. Their final review is blocked.`, notifyUids: rv.managerUid ? [rv.managerUid] : [] });
    } else {
      await tell(c, [p.uid], `Your ${cy.name} is open`, `Please open Performance > My performance and complete your self-assessment${cy.selfReviewDeadline ? ` by ${cy.selfReviewDeadline}` : ''}.`);
    }
    if (w.leaveDays >= 30) { onLeave++; await raise(c, 'EXTENDED_LEAVE', { refId: `review_${id}`, subjectUid: p.uid, refLabel: `${p.name} - ${cy.name}`, detail: `${p.name} was on approved leave for ${w.leaveDays} days of this period. HR can defer or adjust the review.` }); }
    await audit(c, 'review', id, 'OPENED', null, { status: rv.status }, p.uid);
  }
  if (!cy.openedAt) await putK({ ...cy, openedAt: nowIso(), openedBy: c.who });
  await audit(c, 'cycle', cy.id, 'OPENED', null, { created, existing });
  return ok({ created, existing, waiting, onLeave, message: `${created} review${created === 1 ? '' : 's'} created${existing ? `, ${existing} already existed (not duplicated)` : ''}${waiting ? `, ${waiting} waiting for setup` : ''}.` });
}

async function cycleLock(c: C, b: any): Promise<Result> {
  const cy = await getK(c.cid, str(b.id, 80), 'cycle');
  if (!cy) return fail(404, 'That cycle was not found.');
  const open = (await listK(c.cid, 'review')).filter((r) => r.cycleId === cy.id && !['PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED', 'DEFERRED'].includes(r.status));
  if (b.lock !== false && open.length && b.force !== true) return fail(409, `${open.length} review${open.length > 1 ? 's are' : ' is'} not finished. Locking stops further changes. Press "Lock anyway" to confirm.`, { needsConfirm: true });
  const next = { ...cy, lockStatus: b.lock === false ? 'OPEN' : 'LOCKED' };
  await putK(next); await audit(c, 'cycle', cy.id, b.lock === false ? 'UNLOCKED' : 'LOCKED', { lock: cy.lockStatus }, { lock: next.lockStatus });
  return ok({ item: next });
}

/** Reviews that were waiting for a KRA/KPI or a manager start as soon as it exists (run by "Check for changes" and daily). */
export async function refreshBlockedReviews(c: C): Promise<{ started: number }> {
  const [reviews, plans, comps, cycles] = await Promise.all([listK(c.cid, 'review'), listK(c.cid, 'plan'), listK(c.cid, 'competency'), listK(c.cid, 'cycle')]);
  let started = 0;
  for (const rv of reviews.filter((r) => r.status === 'CONFIGURATION_PENDING')) {
    const cy = cycles.find((x) => x.id === rv.cycleId);
    const p = anyPerson(c, rv.uid);
    if (!cy || !p || !p.active) continue;
    const next = await buildReview(c, cy, p, plans, comps);
    if (next.status === 'CONFIGURATION_PENDING') { if (JSON.stringify(next.blockers) !== JSON.stringify(rv.blockers)) await putK({ ...rv, blockers: next.blockers }); continue; }
    next.leaveFlag = rv.leaveFlag || 0; next.createdAt = rv.createdAt;
    await putK(next);
    await clearException(c, 'CONFIGURATION_PENDING', `review_${rv.id}`, 'The review could start.');
    await clearException(c, 'NO_KRA_KPI', `review_${rv.id}`, 'The KRA/KPI is now approved.');
    await tell(c, [p.uid], `Your ${cy.name} is open`, 'Please open Performance > My performance and complete your self-assessment.');
    await audit(c, 'review', rv.id, 'STARTED', { status: 'CONFIGURATION_PENDING' }, { status: 'OPEN' }, p.uid);
    started++;
  }
  return { started };
}

// ------------------------------------------------------------------ reading a review

const canSee = (c: C, rv: Item) => rv.uid === c.ctx.uid || isMyReport(c, rv.uid) || rv.managerUid === c.ctx.uid || c.isHr || c.isApprover;
const employeeSeesManagerSide = (rv: Item) => ['PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED'].includes(rv.status);

async function loadParts(c: C, rv: Item) {
  const [compRows, checks, assigns, evidence, ctx] = await Promise.all([
    listK(c.cid, 'compAssess'), listK(c.cid, 'sopCheck'), listK(c.cid, 'sopAssign'),
    evidenceFor(c, rv.uid, rv.periodStart, rv.periodEnd), workContext(c, rv.uid, rv.periodStart, rv.periodEnd),
  ]);
  const comps: CompetencyResult[] = compRows.filter((x) => x.reviewId === rv.id).map((x) => ({
    assessmentId: x.id, competencyId: x.competencyId, name: x.name, weight: Number(x.weight) || 1, expectedBehaviour: x.expectedBehaviour, selfRating: x.selfRating ?? null, selfEvidence: x.selfEvidence || '',
    managerRating: x.managerRating ?? null, observedExamples: x.observedExamples || '', evidenceRefs: x.evidenceRefs || '', managerComment: x.managerComment || '', finalRating: x.finalRating ?? null, calibrationReason: x.calibrationReason || '',
  }));
  const mySopChecks = checks.filter((x) => x.uid === rv.uid && x.cycleId === rv.cycleId);
  const sopRows = mySopChecks.flatMap((x) => (x.rows || []).map((r: any) => ({ result: r.result as SopResult, critical: !!r.critical, weight: r.weight })));
  const myAssign = assigns.filter((x) => x.uid === rv.uid && !['SUPERSEDED', 'ENDED'].includes(x.status));
  return { comps, sopChecks: mySopChecks, sopRows, assignments: myAssign, evidence, context: ctx };
}

/** Everything the screen needs, with the scores worked out the way the specification describes. */
async function compute(c: C, rv: Item) {
  const parts = await loadParts(c, rv);
  const useFinal = !!rv.final;
  const kpis: KpiResult[] = rv.kpis || [];
  const kra = kraPillar(kpis, useFinal); const beh = behaviourPillar(parts.comps, useFinal); const sop = sopScore(parts.sopRows);
  const weights = rv.weights || { kra: 60, behaviour: 25, sop: 15 };
  const overall = overallScore({ kra: kra.score, behaviour: beh.score, sop: sop.score }, weights);
  const flags = consistencyFlags(kpis, parts.comps, sop);
  const input = { selfDone: !!rv.self?.submittedAt || !!rv.self?.waived, kpis, comps: parts.comps, sopRows: parts.sopRows.length, sopRequired: parts.assignments.length, sopConfirmedNone: !!str(rv.manager?.sopNotAssessedReason, 300), managerEvaluation: rv.manager?.evaluation || '', discussionHeld: !!rv.discussion?.heldOn, hasKra: kpis.length > 0 && !!rv.planId };
  return { ...parts, kra, beh, sop, overall, flags, weights, problems: { manager: completenessProblems(input, 'MANAGER'), discussion: completenessProblems(input, 'DISCUSSION'), hr: completenessProblems(input, 'HR') }, band: ratingBand(overall.score) };
}

function redactForEmployee(rv: Item, view: any) {
  if (employeeSeesManagerSide(rv)) return { rv, view };
  const r = { ...rv, kpis: (rv.kpis || []).map((k: KpiResult) => ({ ...k, rating: null, managerNote: '', finalRating: null, calibrationReason: '', insufficientEvidence: false })), manager: { ...rv.manager, evaluation: '', achievements: '', improvements: '', trainingNeeds: '', sopNotAssessedReason: '' }, discussion: { heldOn: '', notes: '' }, hr: { checkedBy: '', checkedAt: '', note: '', acceptedPartial: false, criticalAck: false }, final: null, amendments: [] };
  const v = { ...view, comps: view.comps.map((x: CompetencyResult) => ({ ...x, managerRating: null, observedExamples: '', evidenceRefs: '', managerComment: '', finalRating: null, calibrationReason: '' })), sopChecks: [], kra: null, beh: null, sop: null, overall: null, flags: [], problems: { manager: [], discussion: [], hr: [] }, band: null, context: view.context };
  return { rv: r, view: v };
}

async function reviewGet(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const rv = await getK(c.cid, str(q.id, 160), 'review');
  if (!rv || !canSee(c, rv)) return fail(404, 'That review was not found.');
  const view = await compute(c, rv);
  const asEmployee = rv.uid === c.ctx.uid && !c.isHr && !c.isApprover;
  const [kpiTargets, approvals] = await Promise.all([listK(c.cid, 'kpiTarget'), listK(c.cid, 'approval')]);
  const out = asEmployee ? redactForEmployee(rv, view) : { rv, view };
  const role = rv.uid === c.ctx.uid ? 'EMPLOYEE' : rv.managerUid === c.ctx.uid || isMyReport(c, rv.uid) ? 'MANAGER' : c.isApprover ? 'APPROVER' : 'HR';
  return ok({
    item: out.rv, ...out.view, role, canHr: c.isHr && rv.uid !== c.ctx.uid, canApprove: c.isApprover && rv.uid !== c.ctx.uid,
    approvals: asEmployee && !employeeSeesManagerSide(rv) ? [] : approvals.filter((a) => a.reviewId === rv.id),
    targets: kpiTargets.filter((k) => k.planId === rv.planId).map((k) => ({ id: k.id, kpiName: k.kpiName, target: k.target })),
  });
}

async function reviewList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const scope = str(q.scope, 10) || 'mine';
  let items = await listK(c.cid, 'review');
  if (scope === 'mine') items = items.filter((r) => r.uid === c.ctx.uid);
  else if (scope === 'team') items = items.filter((r) => isMyReport(c, r.uid) || r.managerUid === c.ctx.uid);
  else if (scope === 'approve') { if (!c.isApprover) return fail(403, 'You do not have approval rights.'); items = items.filter((r) => r.status === 'HR_REVIEWED' && r.uid !== c.ctx.uid); }
  else if (!c.isHr && !c.isApprover) return fail(403, 'You do not have permission to see every review.');
  if (q.cycleId) items = items.filter((r) => r.cycleId === str(q.cycleId, 80));
  if (q.status) items = items.filter((r) => r.status === str(q.status, 30));
  const t = today();
  const deadline = (r: Item) => (['OPEN'].includes(r.status) ? r.selfReviewDeadline : ['SELF_ASSESSED', 'MANAGER_EVALUATED', 'DISCUSSED'].includes(r.status) ? r.managerDeadline : r.status === 'HR_REVIEWED' || r.status === 'DISCUSSED' ? r.hrDeadline : '');
  return ok({ items: items.sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName))).map((r) => {
    const seeScore = r.uid !== c.ctx.uid || employeeSeesManagerSide(r) || c.isHr || c.isApprover;
    return { id: r.id, uid: r.uid, employeeName: r.employeeName, department: r.department, title: r.title, cycleId: r.cycleId, cycleName: r.cycleName, reviewType: r.reviewType, status: r.status, managerName: r.managerName, managerUid: r.managerUid,
      due: deadline(r) || '', overdue: !!deadline(r) && (deadline(r) as string) < t, blockers: r.blockers || [], overall: seeScore ? r.final?.overall ?? null : null, finalRating: seeScore ? r.final?.finalRating ?? null : null, leaveFlag: r.leaveFlag || 0, response: r.response?.type || '' };
  }) });
}

// ------------------------------------------------------------------ the steps

async function mine(c: C, id: string): Promise<{ rv?: Item; err?: Result }> {
  const rv = await getK(c.cid, str(id, 160), 'review');
  return rv ? { rv } : { err: fail(404, 'That review was not found.') };
}
const cycleOpenCheck = async (c: C, rv: Item): Promise<Result | null> => {
  const cy = await getK(c.cid, rv.cycleId, 'cycle');
  return cy && cy.lockStatus === 'LOCKED' ? fail(409, 'This review cycle is locked. Nothing can be changed.') : null;
};

async function setStatus(c: C, rv: Item, to: ReviewStatus, patch: Record<string, any>, action: string, note = ''): Promise<Item> {
  if (!canMove(rv.status, to)) throw Object.assign(new Error(`This review cannot move from ${rv.status} to ${to}.`), { status: 409 });
  const next = { ...rv, ...patch, status: to, history: [...(rv.history || []), { at: nowIso(), by: c.who, action, note }] };
  await putK(next);
  await audit(c, 'review', rv.id, action, { status: rv.status }, { status: to, note }, rv.uid);
  return next;
}

async function setComps(c: C, rv: Item, rows: any[], fields: (x: any, row: any) => Record<string, any>): Promise<void> {
  const all = (await listK(c.cid, 'compAssess')).filter((x) => x.reviewId === rv.id);
  for (const r of rows) {
    const row = all.find((x) => x.competencyId === str(r?.competencyId, 80));
    if (row) await putK({ ...row, ...fields(r, row) });
  }
}

async function reviewSelf(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (rv!.uid !== c.ctx.uid) return fail(403, 'Only the employee writes their own self-assessment.');
  if (isFinal(rv!.status)) return fail(409, FINAL_MSG);
  if (rv!.status !== 'OPEN') return fail(409, rv!.status === 'CONFIGURATION_PENDING' ? 'Your review has not started yet: ' + (rv!.blockers || []).join(' ') : 'You have already submitted your self-assessment.');
  const lock = await cycleOpenCheck(c, rv!); if (lock) return lock;
  const kpis: KpiResult[] = (rv!.kpis || []).map((k: KpiResult) => { const u = (Array.isArray(b.kpis) ? b.kpis : []).find((x: any) => str(x?.targetId, 80) === k.targetId); return u ? { ...k, employeeNote: str(u.employeeNote, 800), evidenceIds: strList(u.evidenceIds, 30, 120) } : k; });
  const self = { ...rv!.self, achievements: textBlock(b.achievements), improvements: textBlock(b.improvements), trainingNeeds: textBlock(b.trainingNeeds, 1000), comments: textBlock(b.comments) };
  await setComps(c, rv!, Array.isArray(b.comps) ? b.comps : [], (x) => ({ selfRating: isRating(Number(x.selfRating)) ? Number(x.selfRating) : null, selfEvidence: str(x.selfEvidence, 600) }));
  if (b.submit === true) {
    const rows = (await listK(c.cid, 'compAssess')).filter((x) => x.reviewId === rv!.id);
    const problems: string[] = [];
    if (!self.achievements.trim()) problems.push('Write your achievements for this period.');
    const unrated = rows.filter((x) => !isRating(x.selfRating));
    if (unrated.length) problems.push(`Rate yourself on every competency (${unrated.length} left): ${unrated.slice(0, 3).map((x) => x.name).join(', ')}${unrated.length > 3 ? '...' : ''}.`);
    if (problems.length) { await putK({ ...rv!, kpis, self }); return fail(400, problems.join(' '), { problems, saved: true }); }
    const next = await setStatus(c, { ...rv!, kpis, self: { ...self, submittedAt: nowIso() } }, 'SELF_ASSESSED', { kpis, self: { ...self, submittedAt: nowIso() } }, 'SELF_SUBMITTED');
    if (next.managerUid) await tell(c, [next.managerUid], `${rv!.employeeName} has submitted a self-assessment`, `Open Performance > My team to evaluate the ${rv!.cycleName} review${rv!.managerDeadline ? ` by ${rv!.managerDeadline}` : ''}.`);
    return ok({ item: next, message: 'Submitted. Your manager will now review it.' });
  }
  await putK({ ...rv!, kpis, self });
  return ok({ saved: true, message: 'Draft saved.' });
}

async function reviewSelfWaive(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (!isMyReport(c, rv!.uid) && !c.isHr) return fail(403, 'Only the reporting manager or HR can do this.');
  if (rv!.status !== 'OPEN') return fail(409, 'The self-assessment is not what this review is waiting for.');
  const reason = str(b.reason, 300);
  if (!reason) return fail(400, 'Say why the self-assessment is being skipped (for example "on leave until the deadline").');
  const next = await setStatus(c, rv!, 'SELF_ASSESSED', { self: { ...rv!.self, waived: reason, waivedBy: c.who } }, 'SELF_WAIVED', reason);
  return ok({ item: next });
}

async function reviewManager(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (isFinal(rv!.status)) return fail(409, FINAL_MSG);
  const current = managerOf(c, rv!.uid);
  if (rv!.uid === c.ctx.uid) return fail(403, 'You cannot evaluate your own review.');
  if (current !== c.ctx.uid) return fail(403, 'Only the reporting manager can evaluate this review.');
  if (!['SELF_ASSESSED', 'MANAGER_EVALUATED'].includes(rv!.status)) return fail(409, rv!.status === 'OPEN' ? 'The employee has not submitted their self-assessment yet. If it cannot be done, use "Skip self-assessment" with a reason.' : 'This review is not waiting for the manager.');
  const lock = await cycleOpenCheck(c, rv!); if (lock) return lock;
  const patchManager = rv!.managerUid !== current ? { managerUid: current, managerName: nameOf(c, current) } : {};
  const kpis: KpiResult[] = (rv!.kpis || []).map((k: KpiResult) => {
    const u = (Array.isArray(b.kpis) ? b.kpis : []).find((x: any) => str(x?.targetId, 80) === k.targetId);
    if (!u) return k;
    const insufficient = u.insufficientEvidence === true;
    const rating = num(u.rating);
    return { ...k, insufficientEvidence: insufficient, rating: insufficient || rating === null || !isRating(rating) ? null : rating, managerNote: str(u.managerNote, 800), evidenceIds: u.evidenceIds ? strList(u.evidenceIds, 30, 120) : k.evidenceIds };
  });
  const bad = (Array.isArray(b.comps) ? b.comps : []).find((x: any) => x?.managerRating !== undefined && x.managerRating !== null && x.managerRating !== 'NOT_OBSERVED' && !isRating(Number(x.managerRating)));
  if (bad) return fail(400, 'Ratings are from 1 to 5, or "Not observed".');
  await setComps(c, rv!, Array.isArray(b.comps) ? b.comps : [], (x) => ({ managerRating: x.managerRating === 'NOT_OBSERVED' ? 'NOT_OBSERVED' : x.managerRating === null || x.managerRating === undefined || x.managerRating === '' ? null : Number(x.managerRating), observedExamples: str(x.observedExamples, 800), evidenceRefs: str(x.evidenceRefs, 400), managerComment: str(x.managerComment, 800), reviewerUid: c.ctx.uid }));
  const manager = { ...rv!.manager, evaluation: textBlock(b.managerEvaluation), achievements: textBlock(b.achievements), improvements: textBlock(b.improvements), trainingNeeds: textBlock(b.trainingNeeds, 1000), sopNotAssessedReason: str(b.sopNotAssessedReason, 300) };
  const base = { ...rv!, ...patchManager, kpis, manager };
  if (b.submit === true) {
    const v = await compute(c, base);
    if (v.problems.manager.length) { await putK(base); return fail(400, v.problems.manager.join(' '), { problems: v.problems.manager, saved: true }); }
    const next = await setStatus(c, base, 'MANAGER_EVALUATED', { ...patchManager, kpis, manager: { ...manager, submittedAt: nowIso() } }, 'MANAGER_EVALUATED');
    return ok({ item: next, message: 'Saved. Next: hold the feedback discussion with the employee and record it.' });
  }
  await putK(base);
  return ok({ saved: true, message: 'Draft saved.' });
}

async function reviewDiscuss(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (isFinal(rv!.status)) return fail(409, FINAL_MSG);
  if (rv!.uid === c.ctx.uid || managerOf(c, rv!.uid) !== c.ctx.uid) return fail(403, 'Only the reporting manager records the feedback discussion.');
  if (rv!.status !== 'MANAGER_EVALUATED') return fail(409, 'Finish the evaluation first.');
  const heldOn = str(b.heldOn, 10) || today();
  if (!isDate(heldOn) || heldOn > today()) return fail(400, 'Enter the date the discussion took place (not in the future).');
  const notes = str(b.notes, 1500);
  if (notes.length < 5) return fail(400, 'Write a few words about what was discussed.');
  const next = await setStatus(c, rv!, 'DISCUSSED', { discussion: { heldOn, notes, recordedBy: c.who } }, 'DISCUSSED');
  return ok({ item: next, message: 'Recorded. HR will now check the review.' });
}

async function reviewHr(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (isFinal(rv!.status)) return fail(409, FINAL_MSG);
  if (rv!.uid === c.ctx.uid) return fail(403, 'You cannot check your own review. Another HR person must do it.');
  if (!c.isHr) return fail(403, 'Only HR can check a review.');
  if (rv!.status !== 'DISCUSSED') return fail(409, 'This review is not waiting for HR.');
  const note = str(b.note, 800);
  if (str(b.decision, 10).toUpperCase() === 'RETURN') {
    if (!note) return fail(400, 'Say what the manager needs to fix.');
    const next = await setStatus(c, rv!, 'SELF_ASSESSED', { manager: { ...rv!.manager, submittedAt: '' }, discussion: { heldOn: '', notes: '' }, hr: { ...rv!.hr, note, returnedBy: c.who } }, 'HR_RETURNED', note);
    if (next.managerUid) await tell(c, [next.managerUid], `Review for ${rv!.employeeName} sent back`, `HR asks: ${note}`);
    return ok({ item: next, message: 'Sent back to the manager.' });
  }
  const v = await compute(c, rv!);
  if (v.problems.hr.length) return fail(400, v.problems.hr.join(' '), { problems: v.problems.hr });
  if (v.overall.partial && b.acceptPartial !== true) return fail(409, `Nothing could be scored for ${v.overall.missing.map((m) => ({ kra: 'KRA/KPI', behaviour: 'Behaviour', sop: 'SOP' }[m])).join(' and ')} (not enough evidence). The other parts will be re-weighted. Tick "I accept the evidence gap" to continue.`, { needsAcceptPartial: true });
  if (v.sop.criticalFailures > 0 && b.criticalAck !== true) return fail(409, `${v.sop.criticalFailures} critical SOP control${v.sop.criticalFailures > 1 ? 's were' : ' was'} not followed. Critical failures are reviewed on their own and are not averaged into the score. Tick "I have reviewed the critical failures" to continue.`, { needsCriticalAck: true });
  const next = await setStatus(c, rv!, 'HR_REVIEWED', { hr: { checkedBy: c.who, checkedAt: nowIso(), note, acceptedPartial: v.overall.partial, criticalAck: v.sop.criticalFailures > 0, flags: v.flags.map((f) => f.code) } }, 'HR_REVIEWED', note);
  return ok({ item: next, message: 'Checked. An authorized approver can now approve it.' });
}

function finalise(rv: Item, comps: CompetencyResult[], sop: ReturnType<typeof sopScore>, finalRating: number, comments: string, by: string) {
  const weights = rv.weights || { kra: 60, behaviour: 25, sop: 15 };
  const kra = kraPillar(rv.kpis || [], true); const beh = behaviourPillar(comps, true);
  const overall = overallScore({ kra: kra.score, behaviour: beh.score, sop: sop.score }, weights);
  return { overall: overall.score, parts: overall.parts, partial: overall.partial, missing: overall.missing, formula: overall.formula, weights, finalRating, band: ratingBand(overall.score)?.label || '', comments, criticalFailures: sop.criticalFailures, approvedBy: by, approvedAt: nowIso() };
}

async function reviewApprove(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (isFinal(rv!.status)) return fail(409, FINAL_MSG);
  if (!c.isApprover) return fail(403, 'Only an authorized approver can approve a review.');
  if (rv!.uid === c.ctx.uid) return fail(403, 'You cannot approve your own review. It must be approved by someone else with approval rights.');
  if (rv!.status !== 'HR_REVIEWED') return fail(409, 'HR has not finished checking this review.');
  const decision = str(b.decision, 10).toUpperCase() || 'APPROVE';
  const note = str(b.note || b.comments, 800);
  if (decision === 'RETURN') {
    if (!note) return fail(400, 'Say what needs to change.');
    await putK({ id: newId(), companyId: c.cid, kind: 'approval', reviewId: rv!.id, approver: c.who, approverUid: c.ctx.uid, decision: 'RETURNED', note, at: nowIso() });
    const next = await setStatus(c, rv!, 'SELF_ASSESSED', { manager: { ...rv!.manager, submittedAt: '' }, discussion: { heldOn: '', notes: '' } }, 'APPROVER_RETURNED', note);
    if (next.managerUid) await tell(c, [next.managerUid], `Review for ${rv!.employeeName} sent back`, `The approver asks: ${note}`);
    return ok({ item: next });
  }
  const v = await compute(c, rv!);
  const finalRating = Number(b.finalRating);
  if (!isRating(finalRating)) return fail(400, `Choose the final rating from 1 to 5${v.band ? ` (the scores suggest ${v.band.value} - ${v.band.label})` : ''}.`);
  const comments = str(b.finalComments, 1500);
  if (comments.length < 5) return fail(400, 'Write the final comments the employee will read.');
  // Calibration: the approver may adjust individual ratings, but only with a reason each time.
  const kpis: KpiResult[] = [...(rv!.kpis || [])];
  for (const cal of Array.isArray(b.calibrations) ? b.calibrations : []) {
    const reason = str(cal?.reason, 400);
    const val = cal?.finalRating === 'NOT_OBSERVED' ? 'NOT_OBSERVED' : Number(cal?.finalRating);
    if (val !== 'NOT_OBSERVED' && !isRating(val)) return fail(400, 'Calibrated ratings are from 1 to 5.');
    if (!reason) return fail(400, 'Every calibration needs a reason.');
    if (cal.targetId) { const k = kpis.find((x) => x.targetId === str(cal.targetId, 80)); if (k && val !== 'NOT_OBSERVED') { k.finalRating = val as number; k.calibrationReason = reason; } }
  }
  await setComps(c, rv!, (Array.isArray(b.calibrations) ? b.calibrations : []).filter((x: any) => x.competencyId), (x) => ({ finalRating: x.finalRating === 'NOT_OBSERVED' ? 'NOT_OBSERVED' : Number(x.finalRating), calibrationReason: str(x.reason, 400) }));
  const v2 = await compute(c, { ...rv!, kpis });
  const comps = v2.comps.map((x) => ({ ...x, finalRating: x.finalRating ?? x.managerRating }));
  const final = finalise({ ...rv!, kpis }, comps, v2.sop, finalRating, comments, c.who);
  await putK({ id: newId(), companyId: c.cid, kind: 'approval', reviewId: rv!.id, approver: c.who, approverUid: c.ctx.uid, decision: 'APPROVED', note: comments, at: nowIso(), overall: final.overall, finalRating });
  const next = await setStatus(c, { ...rv!, kpis }, 'APPROVED', { kpis, final }, 'APPROVED', comments);
  await feedHrbp(c, next);
  return ok({ item: next, message: 'Approved. Publish it when you are ready for the employee to see it.' });
}

/** Step 12 of the lifecycle: approved outcomes feed HRBP / L&D. Training needs written in the review become HRBP training needs (once each). */
async function feedHrbp(c: C, rv: Item): Promise<void> {
  const seen = new Set<string>();
  const lines = `${rv.self?.trainingNeeds || ''}\n${rv.manager?.trainingNeeds || ''}`.split(/\r?\n|;/).map((x) => str(x, 120)).filter(Boolean);
  let i = 0;
  for (const skill of lines) {
    if (seen.has(lc(skill)) || i >= 10) continue;
    seen.add(lc(skill));
    const id = `pmneed_${rv.id}_${i++}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);
    const s = await db().collection('hrbpItems').doc(id).get();
    if (!s.exists) await db().collection('hrbpItems').doc(id).set({ id, companyId: c.cid, kind: 'trainingNeed', employeeUid: rv.uid, employeeName: rv.employeeName, skill, source: 'REVIEW', priority: 'MEDIUM', status: 'OPEN', notes: `From the ${rv.cycleName} review`, createdAt: nowIso(), updatedAt: nowIso() });
  }
}

async function reviewPublish(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (!(c.isHr || c.isApprover)) return fail(403, 'Only HR or an authorized approver can publish a review.');
  if (rv!.uid === c.ctx.uid) return fail(403, 'You cannot publish your own review. Someone else must.');
  if (rv!.status !== 'APPROVED') return fail(409, 'Only an approved review can be published.');
  const next = await setStatus(c, rv!, 'PUBLISHED', { publishedAt: nowIso(), publishedBy: c.who }, 'PUBLISHED');
  await tell(c, [rv!.uid], `Your ${rv!.cycleName} review is ready`, 'Open Performance > My performance to read it. You can acknowledge it, or record that you disagree and why.');
  return ok({ item: next, message: 'Published. The employee has been told.' });
}

async function reviewRespond(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (rv!.uid !== c.ctx.uid) return fail(403, 'Only the employee responds to their own review.');
  if (rv!.status !== 'PUBLISHED') return fail(409, 'The review has not been published to you yet, or you have already responded.');
  const type = str(b.response, 12).toUpperCase();
  const comment = str(b.comment, 1500);
  if (type === 'DISAGREE') {
    if (comment.length < 10) return fail(400, 'Say what you disagree with. For example a factual error, or evidence that was missed.');
    const next = await setStatus(c, rv!, 'DISPUTED', { response: { type: 'DISAGREE', comment, at: nowIso() } }, 'DISPUTED', comment);
    await raise(c, 'REVIEW_DISPUTED', { refId: rv!.id, subjectUid: rv!.uid, refLabel: `${rv!.employeeName} - ${rv!.cycleName}`, detail: `${rv!.employeeName} recorded: "${comment}". Your words are kept exactly as written; HR will route a formal review.`, notifyUids: [] });
    return ok({ item: next, message: 'Your disagreement is recorded exactly as you wrote it. HR will review it formally.' });
  }
  if (type !== 'ACKNOWLEDGE') return fail(400, 'Choose to acknowledge the review or to record that you disagree.');
  const next = await setStatus(c, rv!, 'ACKNOWLEDGED', { response: { type: 'ACKNOWLEDGE', comment, at: nowIso() } }, 'ACKNOWLEDGED', comment);
  if (rv!.managerUid) await tell(c, [rv!.managerUid], `${rv!.employeeName} acknowledged the review`, 'Next: agree a development plan and goals for the next cycle (Performance > Development).');
  return ok({ item: next, message: 'Thank you. Next, your manager will agree a development plan with you.' });
}

async function reviewResolve(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (!(c.isHr || c.isApprover)) return fail(403, 'Only HR or an authorized approver can resolve a disagreement.');
  if (rv!.uid === c.ctx.uid) return fail(403, 'You cannot resolve a disagreement about your own review.');
  if (rv!.status !== 'DISPUTED') return fail(409, 'There is no recorded disagreement to resolve.');
  const outcome = str(b.outcome, 10).toUpperCase(); const note = str(b.note, 1000);
  if (!['UPHELD', 'AMENDED'].includes(outcome)) return fail(400, 'Say whether the review was upheld or amended (amend it first, then resolve).');
  if (note.length < 5) return fail(400, 'Write the outcome of the formal review.');
  const next = await setStatus(c, rv!, 'ACKNOWLEDGED', { response: { ...rv!.response, resolution: { outcome, note, by: c.who, at: nowIso() } } }, 'DISPUTE_RESOLVED', note);
  await clearException(c, 'REVIEW_DISPUTED', rv!.id, `${outcome}: ${note}`);
  await tell(c, [rv!.uid], 'The formal review of your disagreement is complete', `Outcome: ${outcome.toLowerCase()}. ${note}`);
  return ok({ item: next });
}

/** The only way to change a final review: an authorized person, a reason, and a record of before and after. */
async function reviewAmend(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (!c.isApprover) return fail(403, 'Only an authorized approver can amend a final review.');
  if (rv!.uid === c.ctx.uid) return fail(403, 'You cannot amend your own review.');
  if (!isFinal(rv!.status)) return fail(409, 'This review is not final yet, so edit it through the normal steps.');
  const reason = str(b.reason, 600);
  if (reason.length < 10) return fail(400, 'Every amendment needs a reason, so the record explains itself.');
  const kpis: KpiResult[] = (rv!.kpis || []).map((k: KpiResult) => ({ ...k }));
  for (const a of Array.isArray(b.kpis) ? b.kpis : []) { const k = kpis.find((x) => x.targetId === str(a?.targetId, 80)); if (k && isRating(Number(a.finalRating))) { k.finalRating = Number(a.finalRating); k.calibrationReason = reason; } }
  await setComps(c, rv!, Array.isArray(b.comps) ? b.comps : [], (x) => (isRating(Number(x.finalRating)) ? { finalRating: Number(x.finalRating), calibrationReason: reason } : {}));
  const v = await compute(c, { ...rv!, kpis });
  const finalRating = b.finalRating !== undefined && isRating(Number(b.finalRating)) ? Number(b.finalRating) : rv!.final?.finalRating;
  const comments = b.finalComments !== undefined && str(b.finalComments, 1500).length >= 5 ? str(b.finalComments, 1500) : rv!.final?.comments;
  const after = { ...finalise({ ...rv!, kpis }, v.comps.map((x) => ({ ...x, finalRating: x.finalRating ?? x.managerRating })), v.sop, finalRating, comments, rv!.final?.approvedBy || c.who), approvedAt: rv!.final?.approvedAt };
  const amendment = { at: nowIso(), by: c.who, byUid: c.ctx.uid, reason, before: { overall: rv!.final?.overall, finalRating: rv!.final?.finalRating, comments: rv!.final?.comments }, after: { overall: after.overall, finalRating: after.finalRating, comments: after.comments } };
  const next = { ...rv!, kpis, final: after, amendments: [...(rv!.amendments || []), amendment] };
  await putK(next);
  await audit(c, 'review', rv!.id, 'AMENDED', amendment.before, { ...amendment.after, reason }, rv!.uid);
  await raise(c, 'REVIEW_AMENDED', { refId: `${rv!.id}_${(rv!.amendments || []).length + 1}`, subjectUid: rv!.uid, refLabel: `${rv!.employeeName} - ${rv!.cycleName}`, detail: `Amended by ${c.who}: ${reason}` });
  await tell(c, [rv!.uid], 'Your performance review was amended', `An authorized person amended your ${rv!.cycleName} review. Reason: ${reason}. Open Performance > My performance to see the record of changes.`);
  return ok({ item: next, message: 'Amended. The old and new values are both kept in the record.' });
}

async function reviewDefer(c: C, b: any): Promise<Result> {
  const { rv, err } = await mine(c, b.id); if (err) return err;
  if (!c.isHr) return fail(403, 'Only HR can defer a review.');
  if (b.resume === true) {
    if (rv!.status !== 'DEFERRED') return fail(409, 'This review is not deferred.');
    const back = (rv!.statusBeforeDefer || 'OPEN') as ReviewStatus;
    const next = await setStatus(c, rv!, back, { statusBeforeDefer: '', deferral: { ...(rv!.deferral || {}), resumedAt: nowIso(), resumedBy: c.who } }, 'RESUMED');
    return ok({ item: next });
  }
  if (isFinal(rv!.status) || ['DEFERRED', 'CONFIGURATION_PENDING'].includes(rv!.status)) return fail(409, 'This review cannot be deferred from its current step.');
  const reason = str(b.reason, 400);
  if (!reason) return fail(400, 'Say why it is deferred (for example approved extended leave).');
  const extendDays = Math.max(0, Math.min(180, Number(b.extendDays) || 0));
  const bump = (d: string) => (d && extendDays ? addDays(d, extendDays) : d);
  const next = await setStatus(c, rv!, 'DEFERRED', { statusBeforeDefer: rv!.status, deferral: { reason, by: c.who, at: nowIso(), extendDays }, selfReviewDeadline: bump(rv!.selfReviewDeadline), managerDeadline: bump(rv!.managerDeadline), hrDeadline: bump(rv!.hrDeadline) }, 'DEFERRED', reason);
  await clearException(c, 'EXTENDED_LEAVE', `review_${rv!.id}`, `Deferred: ${reason}`);
  return ok({ item: next });
}

// ------------------------------------------------------------------ reminders and escalation (REVIEW_OVERDUE)

export async function reviewReminders(c: C): Promise<{ reminded: number }> {
  const t = today();
  let reminded = 0;
  for (const rv of (await listK(c.cid, 'review')).filter((r) => !isFinal(r.status) && !['DEFERRED', 'CONFIGURATION_PENDING'].includes(r.status))) {
    const waitingOnEmployee = rv.status === 'OPEN';
    const due = waitingOnEmployee ? rv.selfReviewDeadline : ['SELF_ASSESSED', 'MANAGER_EVALUATED', 'DISCUSSED'].includes(rv.status) ? rv.managerDeadline : rv.hrDeadline;
    if (!due || due >= t || rv.remindedOn === t) continue;
    const late = Math.round((Date.parse(t) - Date.parse(due)) / 86400000);
    const to = waitingOnEmployee ? [rv.uid] : rv.managerUid ? [rv.managerUid] : [];
    const up = !waitingOnEmployee && rv.managerUid ? managerOf(c, rv.managerUid) : '';
    await putK({ ...rv, remindedOn: t });
    await tell(c, late > 7 && up ? [...to, up] : to, `Overdue: ${rv.employeeName}'s ${rv.cycleName}`, `This was due on ${due}. Please complete it.${late > 7 && up ? ' It has been escalated to the next manager.' : ''}`);
    await raise(c, 'REVIEW_OVERDUE', { refId: rv.id, subjectUid: rv.uid, refLabel: `${rv.employeeName} - ${rv.cycleName}`, ownerUid: to[0] || '', detail: `${late} day${late > 1 ? 's' : ''} past the ${due} deadline.${late > 7 && up ? ' Escalated.' : ''}` });
    reminded++;
  }
  return { reminded };
}

export const REVIEW_ROUTES: Record<string, Route> = {
  'cycle-open': { method: 'POST', who: 'hr', run: (c, b) => cycleOpen(c, b) },
  'cycle-lock': { method: 'POST', who: 'hr', run: (c, b) => cycleLock(c, b) },
  'review-list': { method: 'GET', who: 'any', run: (c, b, q) => reviewList(c, b, q) },
  'review-get': { method: 'GET', who: 'any', run: (c, b, q) => reviewGet(c, b, q) },
  'review-self': { method: 'POST', who: 'any', run: (c, b) => reviewSelf(c, b) },
  'review-waive': { method: 'POST', who: 'any', run: (c, b) => reviewSelfWaive(c, b) },
  'review-manager': { method: 'POST', who: 'any', run: (c, b) => reviewManager(c, b) },
  'review-discuss': { method: 'POST', who: 'any', run: (c, b) => reviewDiscuss(c, b) },
  'review-hr': { method: 'POST', who: 'hr', run: (c, b) => reviewHr(c, b) },
  'review-approve': { method: 'POST', who: 'approver', run: (c, b) => reviewApprove(c, b) },
  'review-publish': { method: 'POST', who: 'any', run: (c, b) => reviewPublish(c, b) },
  'review-respond': { method: 'POST', who: 'any', run: (c, b) => reviewRespond(c, b) },
  'review-resolve': { method: 'POST', who: 'any', run: (c, b) => reviewResolve(c, b) },
  'review-amend': { method: 'POST', who: 'approver', run: (c, b) => reviewAmend(c, b) },
  'review-defer': { method: 'POST', who: 'hr', run: (c, b) => reviewDefer(c, b) },
};

export { compute as computeReview, round, overlapDays, REVIEW_TYPES, closeSuperseded };
