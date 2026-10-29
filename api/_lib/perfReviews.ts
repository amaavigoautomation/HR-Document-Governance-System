/**
 * Performance Management: review cycles and the review workflow (HR-PM-005 to HR-PM-007).
 *
 *   SELF_PENDING -> MANAGER_PENDING -> DISCUSSION_PENDING -> HR_REVIEW -> APPROVAL_PENDING -> PUBLISHED -> ACKNOWLEDGED | DISPUTED -> CLOSED
 *
 * Reviews are created once per person per cycle (deterministic id). Plan, framework and SOP versions are copied into the
 * review, so a later change never rewrites a past review.
 */
import { istToday } from '../../shared/leaveEngine.js';
import type { Adjustment, Cycle, Evidence, Framework, Plan, Review, ReviewHistory, Sop, SopAssignment, SopCheck } from '../../shared/performance.js';
import {
  adjustmentProblem, approveProblems, blankCompetencyAssessments, blankKpiAssessments, computeScores, isFinal, leaveShare, managerSubmitProblems, nextStatus,
  pickFramework, planActiveAt, reviewIdOf, EXTENDED_LEAVE_SHARE, selfApprovalProblem, selfSubmitProblems, visibleToEmployee, type ReviewAction,
} from '../../shared/performanceEngine.js';
import { C, PerfError, audit, db, getOne, list, loadDirectory, nowIso, ok, peopleWithPerm, put, raise, str, tell, type Directory, type Result } from './perfCore.js';
import { needHrOrApprover, needManage, relationTo, type Who } from './perfSetup.js';
import { currentPlan, planContext, syncSops, type PlanContext } from './perfPlans.js';

const rate = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
};

// ------------------------------------------------------------------ building a review

async function approvedLeaves(cid: string): Promise<Map<string, { from: string; to: string }[]>> {
  const rows = await list<{ uid: string; from: string; to: string }>('leaveRequests', cid, { status: 'APPROVED' });
  const map = new Map<string, { from: string; to: string }[]>();
  for (const r of rows) map.set(r.uid, [...(map.get(r.uid) || []), { from: r.from, to: r.to }]);
  return map;
}

function sopSnapshot(sops: Sop[], assignments: SopAssignment[], uid: string): { versions: Review['sopVersions']; checks: SopCheck[] } {
  const mine = assignments.filter((a) => a.uid === uid && a.status === 'ACTIVE');
  const versions: Review['sopVersions'] = [];
  const checks: SopCheck[] = [];
  for (const a of mine) {
    const s = sops.find((x) => x.id === a.sopId && x.active);
    if (!s) continue;
    versions.push({ sopId: s.id, title: s.title, versionNumber: a.versionNumber, criticality: s.criticality });
    for (const cp of s.checkpoints) {
      checks.push({
        sopId: s.id, sopTitle: s.title, versionNumber: a.versionNumber, checkpointId: cp.id, checkpoint: cp.text, critical: cp.critical,
        result: 'NOT_VERIFIED', evidence: '', severity: 'MEDIUM', correctiveAction: '', reviewerUid: '', reviewedAt: '',
      });
    }
  }
  return { versions, checks };
}

interface BuildEnv {
  ctx: PlanContext;
  sops: Sop[];
  assignments: SopAssignment[];
  leaves: Map<string, { from: string; to: string }[]>;
}

async function buildEnv(cid: string, dir: Directory): Promise<BuildEnv> {
  const [ctx, sops, assignments, leaves] = await Promise.all([planContext(cid, dir), list<Sop>(C.sops, cid), list<SopAssignment>(C.assignments, cid), approvedLeaves(cid)]);
  return { ctx, sops, assignments, leaves };
}

/** A review for one person, or null when they should not have one (joined after the period). */
function buildReview(cycle: Cycle, uid: string, env: BuildEnv, today: string): Review | null {
  const { dir } = env.ctx;
  const person = dir.byUid.get(uid);
  if (!person) return null;
  const join = dir.profiles.get(uid)?.joinDate || '';
  if (join && join > cycle.periodEnd) return null;
  const now = nowIso();
  const plan = planActiveAt(env.ctx.plans, uid, cycle.periodEnd) || (() => { const c = currentPlan(env.ctx.plans, uid); return c && c.status === 'ACTIVE' ? c : null; })();
  const framework: Framework | null = plan ? env.ctx.frameworks.find((f) => f.id === plan.frameworkId) || pickFramework(env.ctx.frameworks, 'INDIVIDUAL', plan.roleFamilyId, cycle.periodEnd) : null;
  const managerUid = plan?.managerUid || dir.managerOf(uid);
  const sop = sopSnapshot(env.sops, env.assignments, uid);

  let status: Review['status'] = 'SELF_PENDING';
  let pendingReason = '';
  if (!plan || !framework) {
    status = 'CONFIGURATION_PENDING';
    pendingReason = !plan ? 'No active, acknowledged KRA/KPI plan for this period.' : 'The framework for this plan is not available.';
  } else if (!managerUid) {
    status = 'CONFIGURATION_PENDING';
    pendingReason = 'No reporting manager is set.';
  } else if (leaveShare(cycle.periodStart, cycle.periodEnd, env.leaves.get(uid) || []) > EXTENDED_LEAVE_SHARE) {
    status = 'DEFERRED';
    pendingReason = 'Approved leave covered more than half of the review period.';
  }
  const kras = plan?.kras || [];
  const competencies = plan?.competencies || [];
  const r: Review = {
    id: reviewIdOf(cycle.companyId, cycle.id, uid), companyId: cycle.companyId, cycleId: cycle.id, cycleName: cycle.name, reviewType: cycle.reviewType,
    periodStart: cycle.periodStart, periodEnd: cycle.periodEnd, uid, employeeName: person.name, department: person.department, designation: person.title,
    managerUid, managerName: dir.nameOf(managerUid), planId: plan?.id || '', planVersion: plan?.version || 0, frameworkId: framework?.id || '', frameworkVersion: framework?.version || 0,
    competencyVersion: plan?.competencyVersion || 0, weights: framework?.weights || { kra: 60, behaviour: 25, sop: 15 }, kras, competencies, sopVersions: sop.versions,
    status, pendingReason, kpiAssessments: blankKpiAssessments(kras), competencyAssessments: blankCompetencyAssessments(competencies), sopChecks: sop.checks,
    achievements: '', strengths: '', improvements: '', trainingNeeds: '', managerComments: '', selfSubmittedAt: '', managerSubmittedAt: '', discussionAt: '',
    hrNote: '', hrCriticalAcknowledged: false, hrPartialAcknowledged: false, hrReviewedBy: '', hrReviewedAt: '', adjustments: [], approvedBy: '', approvedByUid: '', approvedAt: '',
    finalComments: '', scores: { kra: null, behaviour: null, sop: null, overall: null, band: 'Not rated', missing: [], partial: false, criticalFindings: [] },
    employeeResponse: { decision: '', comment: '', at: '' }, dispute: { status: '', resolution: '', resolvedBy: '', resolvedAt: '' },
    history: [{ at: now, by: 'System', byUid: '', action: 'CREATED', note: pendingReason || `Opened for ${cycle.name}.` }], createdAt: now, updatedAt: now,
  };
  r.scores = computeScores(r);
  void today;
  return r;
}

export async function openCycle(w: Who, body: any): Promise<Result> {
  needManage(w);
  const cycle = await getOne<Cycle>(C.cycles, str(body.id, 128), w.cid);
  if (!cycle) throw new PerfError(404, 'Cycle not found.');
  if (cycle.status === 'LOCKED') throw new PerfError(400, 'This cycle is locked.');
  const r = await createReviews(w.cid, cycle, w);
  if (cycle.status === 'DRAFT') {
    await put(C.cycles, cycle.id, { ...cycle, status: 'OPEN', openedAt: nowIso(), updatedAt: nowIso() });
    await audit(w.cid, 'CYCLE', cycle.id, 'CYCLE_OPENED', w, null, r);
  }
  return ok(r);
}

/** Idempotent: existing reviews are left alone (except ones waiting on configuration, which are tried again). */
export async function createReviews(cid: string, cycle: Cycle, by: { name: string; uid: string }): Promise<{ created: number; existing: number; pending: number; deferred: number; skipped: number }> {
  const dir = await loadDirectory(cid);
  await syncSops(cid, dir);
  const env = await buildEnv(cid, dir);
  const today = istToday();
  const inScope = dir.active.filter((p) => (cycle.scope.uids.length === 0 || cycle.scope.uids.includes(p.uid)) && (!cycle.scope.departmentName || p.department.trim().toLowerCase() === cycle.scope.departmentName.trim().toLowerCase()));
  const existing = await list<Review>(C.reviews, cid, { cycleId: cycle.id });
  const have = new Map(existing.map((r) => [r.id, r]));
  const out = { created: 0, existing: 0, pending: 0, deferred: 0, skipped: 0 };
  const selfDue: string[] = [];
  for (const p of inScope) {
    const id = reviewIdOf(cid, cycle.id, p.uid);
    const cur = have.get(id);
    if (cur && cur.status !== 'CONFIGURATION_PENDING') { out.existing++; continue; }
    const fresh = buildReview(cycle, p.uid, env, today);
    if (!fresh) { out.skipped++; continue; }
    if (cur) {
      if (fresh.status === 'CONFIGURATION_PENDING') { out.pending++; continue; }
      fresh.createdAt = cur.createdAt;
      fresh.history = [...cur.history, { at: nowIso(), by: by.name, byUid: by.uid, action: 'CONFIGURED', note: 'Plan became available.' }];
    }
    await put(C.reviews, id, fresh);
    if (cur) out.existing++; else out.created++;
    if (fresh.status === 'CONFIGURATION_PENDING') {
      out.pending++;
      await raise(cid, { category: 'NO_KRA', message: `${p.name}: ${fresh.pendingReason}`, uid: p.uid, refId: id, key: id });
    } else if (fresh.status === 'DEFERRED') {
      out.deferred++;
      await raise(cid, { category: 'EXTENDED_LEAVE', severity: 'LOW', message: `${p.name}'s review for ${cycle.name} is deferred because of approved leave.`, uid: p.uid, refId: id, key: id });
    } else selfDue.push(p.uid);
  }
  if (selfDue.length) await tell(cid, selfDue, `Self-assessment due: ${cycle.name}`, `Please complete your self-assessment by ${cycle.selfDeadline}.`, 'performance:me', `selfdue__${cycle.id}`, dir);
  return out;
}

export async function lockCycle(w: Who, body: any): Promise<Result> {
  needManage(w);
  const cycle = await getOne<Cycle>(C.cycles, str(body.id, 128), w.cid);
  if (!cycle) throw new PerfError(404, 'Cycle not found.');
  const open = (await list<Review>(C.reviews, w.cid, { cycleId: cycle.id })).filter((r) => !isFinal(r.status) && r.status !== 'DEFERRED');
  if (open.length && body.force !== true) throw new PerfError(400, `${open.length} review${open.length === 1 ? ' is' : 's are'} not finished. Finish them or lock anyway.`);
  await put(C.cycles, cycle.id, { ...cycle, status: 'LOCKED', lockedAt: nowIso(), updatedAt: nowIso() });
  await audit(w.cid, 'CYCLE', cycle.id, 'CYCLE_LOCKED', w, { open: open.length }, null);
  return ok({});
}

// ------------------------------------------------------------------ reading

type Rel = ReturnType<typeof relationTo>;

async function access(w: Who, id: string): Promise<{ r: Review; rel: Rel; dir: Directory }> {
  const r = await getOne<Review>(C.reviews, id, w.cid);
  if (!r) throw new PerfError(404, 'Review not found.');
  const dir = await loadDirectory(w.cid);
  const rel: Rel = r.uid === w.uid ? 'SELF' : r.managerUid === w.uid ? 'MANAGER' : w.canManage || w.canApprove || w.canView ? 'HR' : 'NONE';
  if (rel === 'NONE') throw new PerfError(403, 'You cannot open this review.');
  return { r, rel, dir };
}

/** What each person is allowed to see. The employee sees only their own part until the review is published. */
function shape(r: Review, rel: Rel): any {
  if (rel === 'SELF' && !visibleToEmployee(r.status)) {
    return {
      ...r,
      kpiAssessments: r.kpiAssessments.map((a) => ({ kpiId: a.kpiId, selfNote: a.selfNote, selfScore: a.selfScore })),
      competencyAssessments: r.competencyAssessments.map((a) => ({ competencyId: a.competencyId, selfRating: a.selfRating, selfNotObserved: a.selfNotObserved, selfExamples: a.selfExamples })),
      sopChecks: [], strengths: '', improvements: '', trainingNeeds: '', managerComments: '', hrNote: '', adjustments: [], scores: undefined, history: [], finalComments: '',
    };
  }
  if (rel === 'MANAGER' && !r.selfSubmittedAt) {
    return {
      ...r,
      kpiAssessments: r.kpiAssessments.map((a) => ({ ...a, selfNote: '', selfScore: null })),
      competencyAssessments: r.competencyAssessments.map((a) => ({ ...a, selfRating: null, selfNotObserved: false, selfExamples: '' })),
    };
  }
  if (rel === 'SELF') return { ...r, hrNote: '', history: r.history.filter((h) => ['PUBLISHED', 'ACKNOWLEDGED', 'DISAGREED', 'CLOSED', 'AMENDED'].includes(h.action)) };
  return r;
}

export async function getReviews(w: Who, q: any): Promise<Result> {
  const scope = str(q.scope, 20);
  let rows = await list<Review>(C.reviews, w.cid);
  if (q.cycleId) rows = rows.filter((r) => r.cycleId === String(q.cycleId));
  if (scope === 'all') {
    needHrOrApprover(w);
  } else if (scope === 'team') {
    rows = rows.filter((r) => r.managerUid === w.uid);
  } else {
    rows = rows.filter((r) => r.uid === w.uid);
  }
  const today = istToday();
  const cycles = new Map((await list<Cycle>(C.cycles, w.cid)).map((c) => [c.id, c]));
  const items = rows.map((r) => {
    const c = cycles.get(r.cycleId);
    const mine = r.uid === w.uid;
    const hide = mine && !visibleToEmployee(r.status);
    return {
      id: r.id, cycleId: r.cycleId, cycleName: r.cycleName, reviewType: r.reviewType, periodStart: r.periodStart, periodEnd: r.periodEnd, uid: r.uid, employeeName: r.employeeName,
      department: r.department, managerUid: r.managerUid, managerName: r.managerName, status: r.status, pendingReason: r.pendingReason,
      overall: hide ? null : r.scores.overall, band: hide ? '' : r.scores.band, partial: hide ? false : r.scores.partial, critical: hide ? 0 : r.scores.criticalFindings.length,
      selfDeadline: c?.selfDeadline || '', managerDeadline: c?.managerDeadline || '', hrDeadline: c?.hrDeadline || '', today,
      updatedAt: r.updatedAt,
    };
  }).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.employeeName.localeCompare(b.employeeName));
  return ok({ items });
}

export async function getReview(w: Who, q: any): Promise<Result> {
  const { r, rel, dir } = await access(w, str(q.id, 200));
  const [cycle, evidence, plan] = await Promise.all([
    getOne<Cycle>(C.cycles, r.cycleId, w.cid),
    list<Evidence>(C.evidence, w.cid, { uid: r.uid }),
    r.planId ? getOne<Plan>(C.plans, r.planId, w.cid) : Promise.resolve(null),
  ]);
  const inPeriod = evidence.filter((e) => e.occurredAt >= r.periodStart && e.occurredAt <= r.periodEnd && e.status !== 'REJECTED').sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const sees = rel !== 'SELF' || visibleToEmployee(r.status);
  void plan;
  return ok({
    item: shape(r, rel), rel, evidence: inPeriod,
    cycle: cycle ? { selfDeadline: cycle.selfDeadline, managerDeadline: cycle.managerDeadline, hrDeadline: cycle.hrDeadline } : null,
    managerName: dir.nameOf(r.managerUid), canSeeScores: sees,
  });
}

// ------------------------------------------------------------------ working on a review

function history(r: Review, w: { name: string; uid: string }, action: string, note = ''): ReviewHistory[] {
  return [...r.history, { at: nowIso(), by: w.name, byUid: w.uid, action, note: note.slice(0, 500) }];
}

function move(r: Review, action: ReviewAction): Review['status'] {
  const next = nextStatus(r.status, action);
  if (!next) throw new PerfError(400, 'That step is not available for this review right now.');
  return next;
}

async function save(r: Review, w: Who, action: string, patch: Partial<Review>, note = ''): Promise<Review> {
  const doc: Review = { ...r, ...patch, history: history(r, w, action, note), updatedAt: nowIso() };
  doc.scores = computeScores(doc);
  await put(C.reviews, doc.id, doc);
  return doc;
}

/** Writes only fields that came in, matched by id, so two screens never overwrite each other. */
function mergeSelf(r: Review, body: any): Pick<Review, 'kpiAssessments' | 'competencyAssessments' | 'achievements'> {
  const kpis = r.kpiAssessments.map((a) => {
    const i = (Array.isArray(body.kpis) ? body.kpis : []).find((x: any) => x?.kpiId === a.kpiId);
    return i ? { ...a, selfNote: str(i.selfNote, 1500), selfScore: rate(i.selfScore) } : a;
  });
  const comps = r.competencyAssessments.map((a) => {
    const i = (Array.isArray(body.competencies) ? body.competencies : []).find((x: any) => x?.competencyId === a.competencyId);
    return i ? { ...a, selfRating: i.selfNotObserved ? null : rate(i.selfRating), selfNotObserved: i.selfNotObserved === true, selfExamples: str(i.selfExamples, 1000) } : a;
  });
  return { kpiAssessments: kpis, competencyAssessments: comps, achievements: body.achievements !== undefined ? str(body.achievements, 3000) : r.achievements };
}

export async function selfSave(w: Who, body: any): Promise<Result> {
  const { r } = await access(w, str(body.id, 200));
  if (r.uid !== w.uid) throw new PerfError(403, 'Only the employee completes their self-assessment.');
  if (r.status !== 'SELF_PENDING') throw new PerfError(400, 'The self-assessment is closed.');
  const doc = await save(r, w, 'SELF_SAVED', mergeSelf(r, body));
  return ok({ item: shape(doc, 'SELF') });
}

export async function selfSubmit(w: Who, body: any): Promise<Result> {
  const { r, dir } = await access(w, str(body.id, 200));
  if (r.uid !== w.uid) throw new PerfError(403, 'Only the employee submits their self-assessment.');
  const merged = { ...r, ...mergeSelf(r, body) };
  const problems = selfSubmitProblems(merged);
  if (problems.length) throw new PerfError(400, problems[0] + (problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''));
  const status = move(r, 'SELF_SUBMIT');
  const doc = await save(r, w, 'SELF_SUBMITTED', { ...mergeSelf(r, body), status, selfSubmittedAt: nowIso() });
  await tell(w.cid, [r.managerUid], `Review ready: ${r.employeeName}`, `${r.employeeName} submitted their self-assessment for ${r.cycleName}.`, 'performance:team', `mgrdue__${r.id}`, dir);
  return ok({ item: shape(doc, 'SELF') });
}

function mergeManager(r: Review, body: any, actor: { uid: string }): Partial<Review> {
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const kpis = r.kpiAssessments.map((a) => {
    const i = arr(body.kpis).find((x: any) => x?.kpiId === a.kpiId);
    if (!i) return a;
    const insufficient = i.insufficientEvidence === true;
    const valid = new Set(arr(i.evidenceIds).map(String));
    return { ...a, managerNote: str(i.managerNote, 1500), managerScore: insufficient ? null : rate(i.managerScore), insufficientEvidence: insufficient, evidenceIds: [...valid].slice(0, 30) };
  });
  const comps = r.competencyAssessments.map((a) => {
    const i = arr(body.competencies).find((x: any) => x?.competencyId === a.competencyId);
    if (!i) return a;
    return { ...a, managerNotObserved: i.managerNotObserved === true, managerRating: i.managerNotObserved ? null : rate(i.managerRating), managerExamples: str(i.managerExamples, 1000), evidenceRefs: str(i.evidenceRefs, 500) };
  });
  const checks = r.sopChecks.map((c) => {
    const i = arr(body.sopChecks).find((x: any) => x?.sopId === c.sopId && x?.checkpointId === c.checkpointId);
    if (!i) return c;
    const result = ['COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'NOT_VERIFIED'].includes(i.result) ? i.result : 'NOT_VERIFIED';
    const severity = ['LOW', 'MEDIUM', 'HIGH'].includes(i.severity) ? i.severity : 'MEDIUM';
    return { ...c, result, evidence: str(i.evidence, 600), severity, correctiveAction: str(i.correctiveAction, 600), reviewerUid: actor.uid, reviewedAt: nowIso() };
  });
  const text = (k: 'strengths' | 'improvements' | 'trainingNeeds' | 'managerComments', max: number) => (body[k] !== undefined ? str(body[k], max) : r[k]);
  return {
    kpiAssessments: kpis, competencyAssessments: comps, sopChecks: checks as any, strengths: text('strengths', 2000), improvements: text('improvements', 2000),
    trainingNeeds: text('trainingNeeds', 1500), managerComments: text('managerComments', 3000),
  };
}

function managerCheck(r: Review, w: Who) {
  if (w.uid === r.uid) throw new PerfError(403, 'You cannot assess yourself.');
  if (r.managerUid !== w.uid) throw new PerfError(403, 'Only the reporting manager for this review can do this.');
  if (r.status !== 'MANAGER_PENDING') throw new PerfError(400, 'This review is not waiting for the manager.');
}

export async function managerSave(w: Who, body: any): Promise<Result> {
  const { r } = await access(w, str(body.id, 200));
  managerCheck(r, w);
  const doc = await save(r, w, 'MANAGER_SAVED', mergeManager(r, body, w));
  return ok({ item: shape(doc, 'MANAGER') });
}

export async function managerSubmit(w: Who, body: any): Promise<Result> {
  const { r, dir } = await access(w, str(body.id, 200));
  managerCheck(r, w);
  const merged = { ...r, ...mergeManager(r, body, w) };
  const problems = managerSubmitProblems(merged);
  if (problems.length) throw new PerfError(400, problems[0] + (problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''));
  const status = move(r, 'MANAGER_SUBMIT');
  const doc = await save(r, w, 'MANAGER_SUBMITTED', { ...mergeManager(r, body, w), status, managerSubmittedAt: nowIso() });
  void dir;
  return ok({ item: shape(doc, 'MANAGER') });
}

export async function discussionDone(w: Who, body: any): Promise<Result> {
  const { r, dir } = await access(w, str(body.id, 200));
  if (r.managerUid !== w.uid) throw new PerfError(403, 'Only the reporting manager records the feedback discussion.');
  const note = str(body.note, 800);
  if (!note) throw new PerfError(400, 'Note what was discussed with the employee.');
  const status = move(r, 'DISCUSSION_DONE');
  const doc = await save(r, w, 'DISCUSSION_DONE', { status, discussionAt: nowIso() }, note);
  await tell(w.cid, await peopleWithPerm(w.cid, 'perf.manage'), `Review for HR: ${r.employeeName}`, `${r.cycleName} is ready for HR review.`, 'performance:reviews', `hrdue__${r.id}`, dir);
  return ok({ item: doc });
}

/** Calibration by HR or the approver. Every change needs a reason and is kept with who made it and when. */
function applyAdjustments(r: Review, input: any, w: Who): { patch: Partial<Review>; list: Adjustment[] } {
  const kpiAssessments = r.kpiAssessments.map((a) => ({ ...a }));
  const competencyAssessments = r.competencyAssessments.map((a) => ({ ...a }));
  const made: Adjustment[] = [];
  for (const x of Array.isArray(input) ? input.slice(0, 60) : []) {
    const target = str(x?.target, 140);
    const to = x?.to === null || x?.to === '' || x?.to === undefined ? null : rate(x.to);
    if (x?.to !== null && x?.to !== '' && x?.to !== undefined && to === null) throw new PerfError(400, 'Ratings go from 1 to 5.');
    const problem = adjustmentProblem({ reason: str(x?.reason, 400) }, to);
    if (problem) throw new PerfError(400, problem);
    const [kind, id] = target.split(':');
    let from: number | null = null;
    if (kind === 'kpi') {
      const a = kpiAssessments.find((k) => k.kpiId === id);
      if (!a) throw new PerfError(400, 'Unknown KPI in the adjustment.');
      from = a.finalScore ?? a.managerScore;
      a.finalScore = to;
    } else if (kind === 'competency') {
      const a = competencyAssessments.find((k) => k.competencyId === id);
      if (!a) throw new PerfError(400, 'Unknown competency in the adjustment.');
      from = a.finalRating ?? a.managerRating;
      a.finalRating = to;
    } else throw new PerfError(400, 'Unknown adjustment target.');
    made.push({ target, from, to, reason: str(x.reason, 400), by: w.name, byUid: w.uid, at: nowIso() });
  }
  return { patch: { kpiAssessments, competencyAssessments, adjustments: [...r.adjustments, ...made] }, list: made };
}

export async function hrSave(w: Who, body: any): Promise<Result> {
  needManage(w);
  const { r } = await access(w, str(body.id, 200));
  if (r.status !== 'HR_REVIEW') throw new PerfError(400, 'This review is not in HR review.');
  const blocked = selfApprovalProblem(r, w.uid, 'HR');
  if (blocked) throw new PerfError(403, blocked);
  const { patch } = applyAdjustments(r, body.adjustments, w);
  const doc = await save(r, w, 'HR_SAVED', {
    ...patch, hrNote: body.hrNote !== undefined ? str(body.hrNote, 1500) : r.hrNote,
    hrCriticalAcknowledged: body.hrCriticalAcknowledged === true || r.hrCriticalAcknowledged, hrPartialAcknowledged: body.hrPartialAcknowledged === true || r.hrPartialAcknowledged,
  });
  return ok({ item: doc });
}

export async function hrForward(w: Who, body: any): Promise<Result> {
  needManage(w);
  const { r, dir } = await access(w, str(body.id, 200));
  const blocked = selfApprovalProblem(r, w.uid, 'HR');
  if (blocked) throw new PerfError(403, blocked);
  const adj = applyAdjustments(r, body.adjustments, w);
  const merged: Review = { ...r, ...adj.patch, hrCriticalAcknowledged: body.hrCriticalAcknowledged === true || r.hrCriticalAcknowledged, hrPartialAcknowledged: body.hrPartialAcknowledged === true || r.hrPartialAcknowledged };
  merged.scores = computeScores(merged);
  const problems = approveProblems(merged);
  if (problems.length) throw new PerfError(400, problems[0]);
  const status = move(r, 'HR_FORWARD');
  const doc = await save(r, w, 'HR_FORWARDED', {
    ...adj.patch, status, hrCriticalAcknowledged: merged.hrCriticalAcknowledged, hrPartialAcknowledged: merged.hrPartialAcknowledged, hrNote: body.hrNote !== undefined ? str(body.hrNote, 1500) : r.hrNote,
    hrReviewedBy: w.name, hrReviewedAt: nowIso(),
  });
  await tell(w.cid, await peopleWithPerm(w.cid, 'perf.approve'), `Review to approve: ${r.employeeName}`, `${r.cycleName} is waiting for final approval.`, 'performance:reviews', `apprdue__${r.id}`, dir);
  return ok({ item: doc });
}

export async function returnReview(w: Who, body: any): Promise<Result> {
  needHrOrApprover(w);
  const { r, dir } = await access(w, str(body.id, 200));
  const note = str(body.note, 600);
  if (!note) throw new PerfError(400, 'Say what needs another look.');
  const blocked = selfApprovalProblem(r, w.uid, 'HR');
  if (blocked) throw new PerfError(403, blocked);
  if (r.status === 'HR_REVIEW' && !w.canManage) throw new PerfError(403, 'Only HR can send a review back from HR review.');
  const status = move(r, 'HR_RETURN');
  const doc = await save(r, w, 'RETURNED', { status }, note);
  const who = status === 'MANAGER_PENDING' ? [r.managerUid] : await peopleWithPerm(w.cid, 'perf.manage');
  await tell(w.cid, who, `Review returned: ${r.employeeName}`, note, 'performance:reviews', `ret__${r.id}__${doc.history.length}`, dir);
  return ok({ item: doc });
}

export async function approveReview(w: Who, body: any): Promise<Result> {
  if (!w.canApprove) throw new PerfError(403, 'Only an authorised approver can give the final approval.');
  const { r, dir } = await access(w, str(body.id, 200));
  const blocked = selfApprovalProblem(r, w.uid, 'APPROVE');
  if (blocked) throw new PerfError(403, blocked);
  const problems = approveProblems(r);
  if (problems.length) throw new PerfError(400, problems[0]);
  const status = move(r, 'APPROVE');
  const doc = await save(r, w, 'PUBLISHED', { status, approvedBy: w.name, approvedByUid: w.uid, approvedAt: nowIso(), finalComments: str(body.finalComments, 1000) });
  await tell(w.cid, [r.uid], 'Your performance review is ready', `${r.cycleName} was published. Please read it and respond.`, 'performance:me', `pub__${r.id}`, dir);
  return ok({ item: doc });
}

export async function respond(w: Who, body: any): Promise<Result> {
  const { r, dir } = await access(w, str(body.id, 200));
  if (r.uid !== w.uid) throw new PerfError(403, 'Only the employee responds to their review.');
  const agree = body.decision !== 'DISAGREE';
  const comment = str(body.comment, 1500);
  if (!agree && !comment) throw new PerfError(400, 'Tell us what you disagree with, so it can be looked at fairly.');
  const status = move(r, agree ? 'ACKNOWLEDGE' : 'DISAGREE');
  const doc = await save(r, w, agree ? 'ACKNOWLEDGED' : 'DISAGREED', {
    status, employeeResponse: { decision: agree ? 'ACKNOWLEDGED' : 'DISAGREED', comment, at: nowIso() },
    dispute: agree ? r.dispute : { status: 'OPEN', resolution: '', resolvedBy: '', resolvedAt: '' },
  }, comment);
  if (!agree) {
    await raise(w.cid, { category: 'REVIEW_DISPUTED', severity: 'HIGH', message: `${r.employeeName} disagreed with their review for ${r.cycleName}.`, uid: r.uid, refId: r.id, key: r.id });
    await tell(w.cid, await peopleWithPerm(w.cid, 'perf.manage', 'perf.approve'), `Review disputed: ${r.employeeName}`, 'An employee disagreed with a published review. It needs a fair look.', 'performance:reviews', `disp__${r.id}`, dir);
  }
  return ok({ item: shape(doc, 'SELF') });
}

export async function resolveDispute(w: Who, body: any): Promise<Result> {
  needHrOrApprover(w);
  const { r } = await access(w, str(body.id, 200));
  if (w.uid === r.uid) throw new PerfError(403, 'You cannot resolve your own dispute.');
  if (w.uid === r.managerUid) throw new PerfError(403, 'The evaluating manager cannot resolve this dispute.');
  const resolution = str(body.resolution, 1500);
  if (!resolution) throw new PerfError(400, 'Write down the outcome and the reasons.');
  const outcome = body.outcome === 'AMENDED' ? 'AMENDED' : 'UPHELD';
  const status = move(r, 'RESOLVE_DISPUTE');
  const doc = await save(r, w, 'DISPUTE_RESOLVED', { status, dispute: { status: outcome, resolution, resolvedBy: w.name, resolvedAt: nowIso() } }, resolution);
  const ex = await db().collection(C.exceptions).doc(`${w.cid}__REVIEW_DISPUTED__${r.id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200)).get();
  if (ex.exists) await ex.ref.set({ ...(ex.data() as any), status: 'RESOLVED', resolvedAt: nowIso(), resolvedBy: w.name, resolution: outcome }, { merge: true });
  await tell(w.cid, [r.uid], 'Your review dispute was resolved', resolution.slice(0, 200), 'performance:me', `disres__${r.id}`);
  return ok({ item: doc });
}

/** Changes to a finalised review: allowed only for authorised people, with a reason, recorded and visible to HR. */
export async function amendReview(w: Who, body: any): Promise<Result> {
  needHrOrApprover(w);
  const { r, dir } = await access(w, str(body.id, 200));
  if (!isFinal(r.status)) throw new PerfError(400, 'Only a finalised review is amended this way. Use calibration before that.');
  const blocked = selfApprovalProblem(r, w.uid, 'APPROVE');
  if (blocked) throw new PerfError(403, blocked);
  const adj = applyAdjustments(r, body.adjustments, w);
  if (adj.list.length === 0) throw new PerfError(400, 'Nothing to change.');
  const doc = await save(r, w, 'AMENDED', adj.patch, adj.list.map((a) => `${a.target}: ${a.from ?? '-'} to ${a.to ?? '-'} (${a.reason})`).join('; '));
  await raise(w.cid, { category: 'REVIEW_AMENDED', severity: 'MEDIUM', message: `${r.employeeName}'s finalised review for ${r.cycleName} was amended by ${w.name}.`, uid: r.uid, refId: r.id, key: `${r.id}__${doc.history.length}` });
  await audit(w.cid, 'REVIEW', r.id, 'REVIEW_AMENDED', w, { overall: r.scores.overall }, { overall: doc.scores.overall });
  await tell(w.cid, [r.uid], 'Your published review was amended', 'An authorised person changed your review after it was published. Open it to read why.', 'performance:me', `amend__${r.id}__${doc.history.length}`, dir);
  return ok({ item: doc });
}

export async function deferReview(w: Who, body: any): Promise<Result> {
  needManage(w);
  const { r } = await access(w, str(body.id, 200));
  const resume = body.resume === true;
  const status = move(r, resume ? 'RESUME' : 'DEFER');
  const note = str(body.note, 400);
  if (!resume && !note) throw new PerfError(400, 'Say why this review is deferred.');
  const doc = await save(r, w, resume ? 'RESUMED' : 'DEFERRED', { status, pendingReason: resume ? '' : note }, note);
  return ok({ item: doc });
}

/** Misconduct, harassment, safety or similar concerns do not belong in a performance review. This only records that a referral happened. */
export async function confidentialReferral(w: Who, body: any): Promise<Result> {
  const { r } = await access(w, str(body.id, 200));
  if (r.managerUid !== w.uid && !w.canManage) throw new PerfError(403, 'Only the manager or HR can refer a concern.');
  await raise(w.cid, {
    category: 'CONFIDENTIAL_REFERRAL', severity: 'HIGH', owner: 'HR (confidential)',
    message: 'A concern was referred to the confidential HR process. Details are not kept in this module.', uid: r.uid, refId: r.id, key: `${r.id}__${Date.now()}`,
  });
  await audit(w.cid, 'REVIEW', r.id, 'CONFIDENTIAL_REFERRAL', w);
  return ok({ message: 'Referred. Please pass the details to HR directly; they are not stored in the performance record.' });
}
