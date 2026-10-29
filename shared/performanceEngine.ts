/**
 * Performance Management engine: pure rules with no database, no network and no clock.
 * Scoring, weight checks, effective dating, review state machine, segregation of duties, fairness checks
 * and the guardrails that keep AI output to summarising documented, evidenced facts.
 *
 * Design rules this file enforces:
 *   - "Not observed" and "insufficient evidence" are left out of a score; they are never counted as 0 or 3.
 *   - Task counts, login hours and activity never become ratings. Only a person's rating of evidence does.
 *   - Critical SOP findings are reported separately and are never averaged away.
 *   - Nobody approves their own review, and the evaluating manager does not give the final approval.
 */
import { addDays, daysBetween, isIsoDate } from './leaveEngine.js';
import {
  RATING_SCALE,
  type Adjustment, type CompetencyAssessment, type DevOutcome, type EmployeeCategory, type Framework, type KpiAssessment, type KpiDef, type KraDef,
  type Plan, type Review, type ReviewStatus, type RoleFamily, type Scores, type Severity, type SopCheck, type Weights,
} from './performance.js';

export const r2 = (n: number) => Math.round(n * 100) / 100;
const clean = (v: unknown, max = 500) => (v === undefined || v === null ? '' : String(v)).trim().slice(0, max);
export const safeId = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);

// ------------------------------------------------------------------ ids (deterministic ids make repeated runs idempotent)

export const reviewIdOf = (cid: string, cycleId: string, uid: string) => safeId(`${cid}__${cycleId}__${uid}`);
export const planIdOf = (cid: string, uid: string, n: number) => safeId(`${cid}__${uid}__p${n}`);
export const sopAssignmentIdOf = (cid: string, uid: string, sopId: string, versionId: string) => safeId(`${cid}__${uid}__${sopId}__${versionId || 'v0'}`);
export const checkinIdOf = (cid: string, uid: string, month: string) => safeId(`${cid}__${uid}__${month}`);

// ------------------------------------------------------------------ weights and targets

/** Framework weights must add up to exactly 100. */
export function validateWeights(w: Weights): string | null {
  for (const k of ['kra', 'behaviour', 'sop'] as const) {
    if (typeof w?.[k] !== 'number' || !Number.isFinite(w[k]) || w[k] < 0 || w[k] > 100) return `The ${k === 'kra' ? 'KRA/KPI' : k === 'sop' ? 'SOP' : 'behaviour'} weight must be a number from 0 to 100.`;
  }
  const total = r2(w.kra + w.behaviour + w.sop);
  return total === 100 ? null : `Weights add up to ${total}%, they must add up to 100%.`;
}

export function totalKpiWeight(kras: KraDef[]): number {
  return r2(kras.reduce((n, k) => n + k.kpis.reduce((m, p) => m + (Number(p.weightage) || 0), 0), 0));
}

/** KPI weightages in a plan or template must add up to 100% and every KPI needs a positive weight. */
export function validateKpiWeights(kras: KraDef[]): string | null {
  const kpis = kras.flatMap((k) => k.kpis);
  if (kras.length === 0 || kpis.length === 0) return 'Add at least one KRA with one KPI.';
  if (kpis.some((p) => !(Number(p.weightage) > 0))) return 'Every KPI needs a weightage above 0.';
  const total = totalKpiWeight(kras);
  return total === 100 ? null : `KPI weightages add up to ${total}%, they must add up to 100%.`;
}

const VAGUE_WORDS = /\b(good|better|best|improve|improved|improvement|maximi[sz]e|minimi[sz]e|asap|as required|as needed|as per need|regularly|timely|many|few|some|significant|etc)\b/i;

/** Why a target is too vague to measure, or null when it reads as measurable. A blank target means "not agreed yet". */
export function vagueTarget(target: string): string | null {
  const t = clean(target, 300);
  if (!t) return 'No target agreed yet.';
  if (!/\d/.test(t) && VAGUE_WORDS.test(t)) return 'The target has no number or date, so it cannot be measured.';
  if (t.length < 4) return 'The target is too short to be clear.';
  return null;
}

export function kpiQualityFlags(k: KpiDef): string[] {
  const out: string[] = [];
  const v = vagueTarget(k.target);
  if (v) out.push(v);
  if (!clean(k.measurement)) out.push('Say how this will be measured.');
  if (!clean(k.evidenceSource)) out.push('Name an approved evidence source.');
  return out;
}

export function validateFramework(f: { weights: Weights; effectiveFrom: string; effectiveTo: string; name: string }): string | null {
  if (!clean(f.name)) return 'Give the framework a name.';
  const w = validateWeights(f.weights);
  if (w) return w;
  if (!isIsoDate(f.effectiveFrom)) return 'Choose the date the framework starts.';
  if (f.effectiveTo && (!isIsoDate(f.effectiveTo) || f.effectiveTo < f.effectiveFrom)) return 'The end date cannot be before the start date.';
  return null;
}

// ------------------------------------------------------------------ KRA sanitising

function uniqueId(used: Set<string>, raw: string, fallback: string): string {
  const base = safeId(clean(raw, 40)).toLowerCase() || fallback;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

const FREQ = ['WEEKLY', 'MONTHLY', 'QUARTERLY'] as const;

/** Cleans KRAs coming from a browser. Targets stay exactly as typed: numbers are agreed by people, never invented. */
export function cleanKras(input: unknown): KraDef[] {
  const kraIds = new Set<string>();
  const kpiIds = new Set<string>();
  const codes = new Set<string>();
  const list = Array.isArray(input) ? input.slice(0, 25) : [];
  return list.map((k: any, i: number) => {
    const kraId = uniqueId(kraIds, k?.id, `kra-${i + 1}`);
    const kpis = (Array.isArray(k?.kpis) ? k.kpis.slice(0, 25) : []).map((p: any, j: number) => {
      const id = uniqueId(kpiIds, p?.id, `kpi-${i + 1}-${j + 1}`);
      let code = clean(p?.code, 20).toUpperCase().replace(/[^A-Z0-9_-]/g, '') || `K${i + 1}-${j + 1}`;
      let n = 2;
      const base = code;
      while (codes.has(code)) code = `${base}-${n++}`;
      codes.add(code);
      const w = Number(p?.weightage);
      return {
        id, code,
        description: clean(p?.description, 300),
        measurement: clean(p?.measurement, 300),
        target: clean(p?.target, 300),
        weightage: Number.isFinite(w) ? r2(Math.min(100, Math.max(0, w))) : 0,
        frequency: (FREQ as readonly string[]).includes(p?.frequency) ? p.frequency : 'MONTHLY',
        evidenceSource: clean(p?.evidenceSource, 200),
        sopRef: clean(p?.sopRef, 200),
      } as KpiDef;
    });
    return { id: kraId, name: clean(k?.name, 120) || `KRA ${i + 1}`, description: clean(k?.description, 400), kpis };
  });
}

// ------------------------------------------------------------------ scoring

const rating = (v: unknown): number | null => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : Math.min(5, Math.max(1, n));
};

export function kpiScore(kras: KraDef[], assessments: KpiAssessment[]): number | null {
  const by = new Map(assessments.map((a) => [a.kpiId, a]));
  let sum = 0;
  let weight = 0;
  for (const kpi of kras.flatMap((k) => k.kpis)) {
    const a = by.get(kpi.id);
    if (!a) continue;
    const v = rating(a.finalScore) ?? (a.insufficientEvidence ? null : rating(a.managerScore));
    if (v === null) continue;
    const w = Number(kpi.weightage) || 0;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? r2(sum / weight) : null;
}

export function behaviourScore(competencies: { competencyId: string; weight: number }[], assessments: CompetencyAssessment[]): number | null {
  const by = new Map(assessments.map((a) => [a.competencyId, a]));
  let sum = 0;
  let weight = 0;
  for (const c of competencies) {
    const a = by.get(c.competencyId);
    if (!a) continue;
    let v: number | null;
    if (a.finalNotObserved) v = null;
    else v = rating(a.finalRating) ?? (a.managerNotObserved ? null : rating(a.managerRating));
    if (v === null) continue;
    const w = Number(c.weight) > 0 ? Number(c.weight) : 1;
    sum += v * w;
    weight += w;
  }
  return weight > 0 ? r2(sum / weight) : null;
}

/**
 * SOP compliance from the checklist. Not applicable and not verified rows are left out. The share of compliant checkpoints is
 * mapped onto the 1 to 5 scale. Critical misses are listed on their own because an average would hide them.
 */
export function sopScore(checks: SopCheck[]): { score: number | null; criticalFindings: Scores['criticalFindings'] } {
  const counted = checks.filter((c) => c.result === 'COMPLIANT' || c.result === 'NON_COMPLIANT');
  const criticalFindings = checks
    .filter((c) => c.result === 'NON_COMPLIANT' && c.critical)
    .map((c) => ({ sopTitle: c.sopTitle, checkpoint: c.checkpoint, severity: c.severity }));
  if (counted.length === 0) return { score: null, criticalFindings };
  const share = counted.filter((c) => c.result === 'COMPLIANT').length / counted.length;
  return { score: r2(1 + 4 * share), criticalFindings };
}

export function bandOf(score: number | null): string {
  if (score === null) return 'Not rated';
  const v = score >= 4.5 ? 5 : score >= 3.5 ? 4 : score >= 2.5 ? 3 : score >= 1.5 ? 2 : 1;
  return RATING_SCALE.find((r) => r.value === v)!.label;
}

/** A suggestion for the development conversation only. It never starts a disciplinary, pay or promotion decision. */
export function suggestedOutcome(score: number | null): DevOutcome | null {
  if (score === null) return null;
  if (score >= 4) return 'RECOGNITION';
  if (score >= 2.5) return 'DEVELOPMENT';
  return 'IMPROVEMENT';
}

export function overallScore(parts: { kra: number | null; behaviour: number | null; sop: number | null }, weights: Weights): { overall: number | null; missing: ('kra' | 'behaviour' | 'sop')[]; partial: boolean } {
  const missing = (['kra', 'behaviour', 'sop'] as const).filter((k) => parts[k] === null && weights[k] > 0);
  let sum = 0;
  let weight = 0;
  for (const k of ['kra', 'behaviour', 'sop'] as const) {
    const v = parts[k];
    if (v === null || !(weights[k] > 0)) continue;
    sum += v * weights[k];
    weight += weights[k];
  }
  return { overall: weight > 0 ? r2(sum / weight) : null, missing, partial: missing.length > 0 && weight > 0 };
}

export function computeScores(r: Pick<Review, 'kras' | 'competencies' | 'kpiAssessments' | 'competencyAssessments' | 'sopChecks' | 'weights'>): Scores {
  const kra = kpiScore(r.kras, r.kpiAssessments);
  const behaviour = behaviourScore(r.competencies, r.competencyAssessments);
  const sop = sopScore(r.sopChecks);
  const o = overallScore({ kra, behaviour, sop: sop.score }, r.weights);
  return { kra, behaviour, sop: sop.score, overall: o.overall, band: bandOf(o.overall), missing: o.missing, partial: o.partial, criticalFindings: sop.criticalFindings };
}

// ------------------------------------------------------------------ blank forms

export const blankKpiAssessments = (kras: KraDef[]): KpiAssessment[] =>
  kras.flatMap((k) => k.kpis).map((p) => ({ kpiId: p.id, selfNote: '', selfScore: null, managerNote: '', managerScore: null, insufficientEvidence: false, finalScore: null, evidenceIds: [] }));

export const blankCompetencyAssessments = (cs: { competencyId: string }[]): CompetencyAssessment[] =>
  cs.map((c) => ({ competencyId: c.competencyId, selfRating: null, selfNotObserved: false, selfExamples: '', managerRating: null, managerNotObserved: false, managerExamples: '', evidenceRefs: '', finalRating: null, finalNotObserved: false }));

// ------------------------------------------------------------------ submission checks

export function selfSubmitProblems(r: Pick<Review, 'kras' | 'competencies' | 'kpiAssessments' | 'competencyAssessments' | 'achievements'>): string[] {
  const out: string[] = [];
  if (!clean(r.achievements)) out.push('Describe your achievements for this period.');
  const kpiBy = new Map(r.kpiAssessments.map((a) => [a.kpiId, a]));
  for (const p of r.kras.flatMap((k) => k.kpis)) {
    const a = kpiBy.get(p.id);
    if (!a || (!clean(a.selfNote) && rating(a.selfScore) === null)) out.push(`Add your achievement note for KPI "${p.code}".`);
  }
  const cBy = new Map(r.competencyAssessments.map((a) => [a.competencyId, a]));
  for (const c of r.competencies) {
    const a = cBy.get(c.competencyId);
    if (!a || (rating(a.selfRating) === null && !a.selfNotObserved)) out.push(`Rate "${c.name}" or mark it not observed.`);
  }
  return out;
}

export function managerSubmitProblems(r: Pick<Review, 'kras' | 'competencies' | 'kpiAssessments' | 'competencyAssessments' | 'sopChecks' | 'managerComments'>): string[] {
  const out: string[] = [];
  const kpiBy = new Map(r.kpiAssessments.map((a) => [a.kpiId, a]));
  for (const p of r.kras.flatMap((k) => k.kpis)) {
    const a = kpiBy.get(p.id);
    if (!a || (rating(a.managerScore) === null && !a.insufficientEvidence)) out.push(`Rate KPI "${p.code}" or mark the evidence insufficient.`);
  }
  const cBy = new Map(r.competencyAssessments.map((a) => [a.competencyId, a]));
  for (const c of r.competencies) {
    const a = cBy.get(c.competencyId);
    if (!a || (rating(a.managerRating) === null && !a.managerNotObserved)) { out.push(`Rate "${c.name}" or mark it not observed.`); continue; }
    const v = rating(a.managerRating);
    if (v !== null && (v <= 2 || v >= 5) && !clean(a.managerExamples) && !clean(a.evidenceRefs)) out.push(`A rating of ${v} for "${c.name}" needs an observed example or evidence.`);
  }
  for (const c of r.sopChecks) {
    if (c.result === 'NON_COMPLIANT' && (!clean(c.correctiveAction) || !c.severity)) out.push(`Non-compliance on "${c.checkpoint}" needs a severity and a corrective action.`);
  }
  if (!clean(r.managerComments)) out.push('Add your overall comments.');
  return out;
}

export function approveProblems(r: Pick<Review, 'scores' | 'hrCriticalAcknowledged' | 'hrPartialAcknowledged'>): string[] {
  const out: string[] = [];
  if (r.scores.criticalFindings.length > 0 && !r.hrCriticalAcknowledged) out.push('There are critical SOP findings. Confirm they have been looked at separately before this goes forward.');
  if (r.scores.partial && !r.hrPartialAcknowledged) out.push('Some parts have no scorable evidence, so the overall score is partial. Confirm you accept a partial score.');
  if (r.scores.overall === null) out.push('Nothing could be scored yet. Add evidence or ratings first.');
  return out;
}

export function adjustmentProblem(a: Pick<Adjustment, 'reason'>, to: number | null): string | null {
  if (!clean(a.reason, 400)) return 'A reason is required for every change made while calibrating.';
  if (to !== null && (to < 1 || to > 5)) return 'Ratings go from 1 to 5.';
  return null;
}

// ------------------------------------------------------------------ review state machine

export type ReviewAction =
  | 'CONFIGURE' | 'DEFER' | 'RESUME' | 'SELF_SUBMIT' | 'MANAGER_SUBMIT' | 'DISCUSSION_DONE' | 'HR_FORWARD' | 'HR_RETURN' | 'APPROVE'
  | 'ACKNOWLEDGE' | 'DISAGREE' | 'RESOLVE_DISPUTE';

const TRANSITIONS: Record<ReviewStatus, Partial<Record<ReviewAction, ReviewStatus>>> = {
  CONFIGURATION_PENDING: { CONFIGURE: 'SELF_PENDING', DEFER: 'DEFERRED' },
  DEFERRED: { RESUME: 'SELF_PENDING' },
  SELF_PENDING: { SELF_SUBMIT: 'MANAGER_PENDING', DEFER: 'DEFERRED' },
  MANAGER_PENDING: { MANAGER_SUBMIT: 'DISCUSSION_PENDING', DEFER: 'DEFERRED' },
  DISCUSSION_PENDING: { DISCUSSION_DONE: 'HR_REVIEW' },
  HR_REVIEW: { HR_FORWARD: 'APPROVAL_PENDING', HR_RETURN: 'MANAGER_PENDING' },
  APPROVAL_PENDING: { APPROVE: 'PUBLISHED', HR_RETURN: 'HR_REVIEW' },
  PUBLISHED: { ACKNOWLEDGE: 'ACKNOWLEDGED', DISAGREE: 'DISPUTED' },
  ACKNOWLEDGED: {},
  DISPUTED: { RESOLVE_DISPUTE: 'CLOSED' },
  CLOSED: {},
};

export function nextStatus(from: ReviewStatus, action: ReviewAction): ReviewStatus | null {
  return TRANSITIONS[from]?.[action] ?? null;
}

/** A review that is already final can still be amended, but only by an authorised person and always with a reason and an audit record. */
export const isFinal = (s: ReviewStatus) => s === 'PUBLISHED' || s === 'ACKNOWLEDGED' || s === 'DISPUTED' || s === 'CLOSED';

/** Employees only see a review once it has been published to them. */
export const visibleToEmployee = (s: ReviewStatus) => isFinal(s) ;

/** The person being reviewed never approves or calibrates their own review. */
export function selfApprovalProblem(review: { uid: string; managerUid: string }, actorUid: string, step: 'HR' | 'APPROVE'): string | null {
  if (actorUid === review.uid) return 'You cannot approve or calibrate your own review. It needs another authorised person.';
  if (step === 'APPROVE' && review.managerUid && actorUid === review.managerUid) return 'The evaluating manager cannot give the final approval. It needs another authorised person.';
  return null;
}

// ------------------------------------------------------------------ dates and periods

export const monthOf = (iso: string) => iso.slice(0, 7);

export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

/** Calendar quarter containing a date. */
export function quarterRange(iso: string): { start: string; end: string; label: string } {
  const y = Number(iso.slice(0, 4));
  const q = Math.floor((Number(iso.slice(5, 7)) - 1) / 3);
  const start = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`;
  return { start, end: monthRange(`${y}-${String(q * 3 + 3).padStart(2, '0')}`).end, label: `Q${q + 1} ${y}` };
}

export function yearRange(iso: string): { start: string; end: string } {
  const y = iso.slice(0, 4);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export type DeadlineState = 'NONE' | 'OK' | 'DUE_SOON' | 'OVERDUE';
export function deadlineState(today: string, deadline: string): DeadlineState {
  if (!isIsoDate(deadline)) return 'NONE';
  if (today > deadline) return 'OVERDUE';
  return daysBetween(today, deadline) <= 2 ? 'DUE_SOON' : 'OK';
}

/** Approved extended leave: the part of a period spent on approved leave (overlapping ranges counted once). */
export const EXTENDED_LEAVE_SHARE = 0.5;
export function leaveShare(periodStart: string, periodEnd: string, leaves: { from: string; to: string }[]): number {
  const total = daysBetween(periodStart, periodEnd) + 1;
  if (total <= 0) return 0;
  const days = new Set<string>();
  for (const l of leaves) {
    if (!isIsoDate(l.from) || !isIsoDate(l.to)) continue;
    const from = l.from > periodStart ? l.from : periodStart;
    const to = l.to < periodEnd ? l.to : periodEnd;
    for (let d = from; d <= to && days.size <= total + 400; d = addDays(d, 1)) days.add(d);
  }
  return Math.min(1, days.size / total);
}

// ------------------------------------------------------------------ effective dating and lookups

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The role family for a person: department plus the most specific matching designation, then the department as a whole. */
export function resolveRoleFamily(families: RoleFamily[], department: string, title: string): RoleFamily | null {
  const dep = norm(department);
  const t = norm(title);
  const inDept = families.filter((f) => f.active !== false && norm(f.departmentName) === dep);
  let best: RoleFamily | null = null;
  let bestLen = 0;
  for (const f of inDept) {
    for (const kw of f.designationKeywords) {
      const k = norm(kw);
      if (k && t.includes(k) && k.length > bestLen) { best = f; bestLen = k.length; }
    }
  }
  return best || inDept.find((f) => f.designationKeywords.length === 0) || null;
}

/** An approved framework in force on a date. A framework made for one role family beats a general one for the category. */
export function pickFramework(frameworks: Framework[], category: EmployeeCategory, roleFamilyId: string, date: string): Framework | null {
  const live = frameworks.filter((f) => f.status === 'APPROVED' && f.effectiveFrom <= date && (!f.effectiveTo || date <= f.effectiveTo));
  const specific = live.filter((f) => f.roleFamilyId && f.roleFamilyId === roleFamilyId);
  const pool = specific.length ? specific : live.filter((f) => !f.roleFamilyId && f.employeeCategory === category);
  return pool.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0] || null;
}

/** The plan that applied on a date (effective dated, so history is never overwritten). */
export function planActiveAt(plans: Plan[], uid: string, date: string): Plan | null {
  return plans
    .filter((p) => p.uid === uid && (p.status === 'ACTIVE' || p.status === 'SUPERSEDED') && p.effectiveFrom <= date && (!p.effectiveTo || date <= p.effectiveTo))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.version - a.version)[0] || null;
}

/** A new major version (1.x to 2.0) is a material revision that needs fresh acknowledgement; a minor one does not. */
export function isMaterialRevision(oldNo: string, newNo: string): boolean {
  const major = (v: string) => Number(String(v || '0').split('.')[0]) || 0;
  return major(newNo) > major(oldNo);
}

// ------------------------------------------------------------------ fairness checks

export interface RatingRow {
  reviewId: string;
  uid: string;
  managerUid: string;
  overall: number | null;
  selfAverage: number | null;
  kpiCount: number;
  insufficientCount: number;
}

export interface FairnessFlag {
  kind: 'UNIFORM_MANAGER' | 'MANAGER_OUTLIER' | 'SELF_GAP' | 'MISSING_EVIDENCE';
  managerUid: string;
  reviewId: string;
  message: string;
}

export function selfAverage(r: Pick<Review, 'kpiAssessments' | 'competencyAssessments'>): number | null {
  const vals: number[] = [];
  for (const a of r.kpiAssessments) { const v = rating(a.selfScore); if (v !== null) vals.push(v); }
  for (const a of r.competencyAssessments) { const v = a.selfNotObserved ? null : rating(a.selfRating); if (v !== null) vals.push(v); }
  return vals.length ? r2(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
}

export function ratingDistribution(overalls: (number | null)[]): Record<string, number> {
  const out: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const o of overalls) {
    if (o === null) continue;
    out[String(Math.min(5, Math.max(1, Math.round(o))))]++;
  }
  return out;
}

/** Flags that help HR spot inconsistent or thin ratings. They are prompts for a human to look, never a verdict. */
export function fairnessFlags(rows: RatingRow[]): FairnessFlag[] {
  const flags: FairnessFlag[] = [];
  const scored = rows.filter((r) => r.overall !== null);
  const company = scored.length ? scored.reduce((s, r) => s + (r.overall as number), 0) / scored.length : 0;
  const byManager = new Map<string, RatingRow[]>();
  for (const r of scored) { if (!r.managerUid) continue; byManager.set(r.managerUid, [...(byManager.get(r.managerUid) || []), r]); }
  for (const [m, list] of byManager) {
    if (list.length < 3) continue;
    const mean = list.reduce((s, r) => s + (r.overall as number), 0) / list.length;
    const spread = Math.max(...list.map((r) => r.overall as number)) - Math.min(...list.map((r) => r.overall as number));
    if (spread < 0.2) flags.push({ kind: 'UNIFORM_MANAGER', managerUid: m, reviewId: '', message: `This manager gave nearly the same overall score (${r2(mean)}) to all ${list.length} people. Check the ratings reflect the evidence.` });
    if (scored.length >= 6 && Math.abs(mean - company) >= 1) flags.push({ kind: 'MANAGER_OUTLIER', managerUid: m, reviewId: '', message: `This manager's average (${r2(mean)}) is ${r2(Math.abs(mean - company))} points ${mean > company ? 'above' : 'below'} the company average (${r2(company)}).` });
  }
  for (const r of rows) {
    if (r.overall !== null && r.selfAverage !== null && Math.abs(r.overall - r.selfAverage) >= 2) {
      flags.push({ kind: 'SELF_GAP', managerUid: r.managerUid, reviewId: r.reviewId, message: `The employee's own average (${r.selfAverage}) and the final score (${r.overall}) are 2 or more points apart. Make sure the discussion covered it.` });
    }
    if (r.kpiCount > 0 && r.insufficientCount / r.kpiCount >= 0.5) {
      flags.push({ kind: 'MISSING_EVIDENCE', managerUid: r.managerUid, reviewId: r.reviewId, message: `${r.insufficientCount} of ${r.kpiCount} KPIs have insufficient evidence, so this score rests on little.` });
    }
  }
  return flags;
}

/** Aggregates are only shown for groups big enough that nobody can be picked out. */
export const MIN_COHORT = 3;

// ------------------------------------------------------------------ AI guardrails

/** Inferences the AI layer must never draw about a person. */
const BANNED_INFERENCE = /\b(personality|introvert\w*|extrovert\w*|\w*emotion\w*|mood|temperament|\w*motivat\w*|\w*loyal\w*|attitude problem|lazy|health|illness|sick\w*|disabilit\w*|mental|depress\w*|anxi\w*|pregnan\w*|marital|married|religio\w*|caste|ethnic\w*|race|racial|gender|age\b|political|sexual\w*|relationship with|dating|family problems?|private life|biometric|login (hours|duration)|keystroke\w*|private (message|chat|communication)s?)\b/i;

export function bannedInference(text: string): string | null {
  const m = BANNED_INFERENCE.exec(text);
  return m ? m[0] : null;
}

/**
 * Keeps only sentences that point to a supplied evidence item like [3] and that draw no banned inference.
 * Anything else is dropped and reported, so unsupported conclusions never reach a manager's draft.
 */
export function filterAiSummary(text: string, validRefs: number[]): { kept: string; dropped: number; reasons: string[] } {
  const sentences = clean(text, 4000).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const keep: string[] = [];
  const reasons: string[] = [];
  const valid = new Set(validRefs);
  for (const s of sentences) {
    const refs = [...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    const banned = bannedInference(s);
    if (banned) { reasons.push(`Mentions "${banned}", which AI must not infer.`); continue; }
    if (refs.length === 0) { reasons.push('A sentence had no evidence reference.'); continue; }
    if (refs.some((n) => !valid.has(n))) { reasons.push('A sentence referred to evidence that does not exist.'); continue; }
    keep.push(s);
  }
  return { kept: keep.join(' '), dropped: sentences.length - keep.length, reasons };
}

export const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH'];
