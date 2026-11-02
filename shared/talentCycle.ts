/**
 * Probation, OKRs, promotions and the quarterly review round: pure rules shared by the browser and the API (no I/O).
 */

const DAY = 86_400_000;
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ probation

export interface Milestone {
  key: string;
  label: string;
  dueOn: string;
  /** The review that closes the probation: the confirmation decision is made after this one. */
  final?: boolean;
  status: 'PENDING' | 'SUBMITTED';
  rating?: number | null;
  kpiPct?: number | null;
  recommendation?: Recommendation;
  strengths?: string;
  improvements?: string;
  by?: string;
  at?: string;
}
export type Recommendation = 'CONTINUE' | 'CONFIRM' | 'EXTEND' | 'CONCERN';
export const RECOMMENDATIONS: Recommendation[] = ['CONTINUE', 'CONFIRM', 'EXTEND', 'CONCERN'];
export const RECOMMENDATION_LABEL: Record<Recommendation, string> = { CONTINUE: 'On track, continue', CONFIRM: 'Ready to confirm', EXTEND: 'Extend probation', CONCERN: 'Serious concerns' };

/**
 * Reviews at 30, 60 and 90 days (the ones that fall inside the probation), and one more a week before the end when the probation is
 * longer than 90 days. The last review is marked final.
 */
export function probationMilestones(joinDate: string, months: number): { endDate: string; milestones: Milestone[] } {
  const endDate = addMonths(joinDate, months);
  const length = diffDays(joinDate, endDate);
  const mk = (day: number): Milestone => ({ key: `d${day}`, label: `${day}-day review`, dueOn: addDays(joinDate, day), status: 'PENDING' });
  const list = [30, 60, 90].filter((d) => d <= length).map(mk);
  if (length > 97 || list.length === 0) list.push({ key: 'final', label: 'Confirmation review', dueOn: addDays(endDate, -7), status: 'PENDING' });
  list[list.length - 1].final = true;
  if (list[list.length - 1].key !== 'final') list[list.length - 1].label = `${list[list.length - 1].label} (confirmation)`;
  return { endDate, milestones: list };
}

export type ProbReminder = { type: 'soon' | 'due' | 'late'; key: string; milestone: Milestone };
/** Which reviews need a nudge to the manager today. A "soon" and a "due" nudge go once; a "late" one goes daily until it is submitted. */
export function probationReminders(milestones: Milestone[], today: string, sent: string[] = []): ProbReminder[] {
  const out: ProbReminder[] = [];
  const done = new Set(sent);
  for (const m of milestones) {
    if (m.status !== 'PENDING') continue;
    const left = diffDays(today, m.dueOn);
    const add = (type: ProbReminder['type'], key: string) => { if (!done.has(key)) out.push({ type, key, milestone: m }); };
    if (left > 0 && left <= 3) add('soon', `soon:${m.key}`);
    else if (left === 0) add('due', `due:${m.key}`);
    else if (left < 0) add('late', `late:${m.key}:${today}`);
  }
  return out;
}

export function validateFeedback(f: { rating?: unknown; kpiPct?: unknown; recommendation?: unknown }): string {
  const r = Number(f.rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return 'Give an overall rating from 1 to 5.';
  if (f.kpiPct !== null && f.kpiPct !== undefined && f.kpiPct !== '') {
    const k = Number(f.kpiPct);
    if (!Number.isFinite(k) || k < 0 || k > 200) return 'KPI achievement is a percentage between 0 and 200.';
  }
  if (!RECOMMENDATIONS.includes(f.recommendation as Recommendation)) return 'Choose your recommendation.';
  return '';
}

// ------------------------------------------------------------------ OKRs

export interface KeyResult { id: string; title: string; start: number; target: number; current: number; unit: string; weight: number }
export type OkrStatus = 'DONE' | 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK';
export const OKR_STATUS_LABEL: Record<OkrStatus, string> = { DONE: 'Achieved', ON_TRACK: 'On track', AT_RISK: 'At risk', OFF_TRACK: 'Off track' };

/** 0 to 1. Works for targets that go down (reduce complaints from 40 to 10) as well as up. */
export function krProgress(kr: Pick<KeyResult, 'start' | 'target' | 'current'>): number {
  if (kr.target === kr.start) return kr.current >= kr.target ? 1 : 0;
  const p = (kr.current - kr.start) / (kr.target - kr.start);
  return Math.max(0, Math.min(1, p));
}
export function objectiveProgress(krs: Pick<KeyResult, 'start' | 'target' | 'current' | 'weight'>[]): number {
  const w = krs.reduce((a, k) => a + (k.weight > 0 ? k.weight : 1), 0);
  if (!w) return 0;
  return krs.reduce((a, k) => a + krProgress(k) * (k.weight > 0 ? k.weight : 1), 0) / w;
}
export const isQuarter = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-Q[1-4]$/.test(s);
export const quarterOf = (iso: string) => `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;
export function quarterBounds(q: string): { start: string; end: string } {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(6, 7));
  const start = new Date(Date.UTC(y, (n - 1) * 3, 1));
  const end = new Date(Date.UTC(y, n * 3, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
export function elapsedFraction(q: string, today: string): number {
  const { start, end } = quarterBounds(q);
  const total = diffDays(start, end) + 1;
  return Math.max(0, Math.min(1, (diffDays(start, today) + 1) / total));
}
export function okrStatus(progress: number, elapsed: number): OkrStatus {
  if (progress >= 1) return 'DONE';
  if (progress >= elapsed * 0.9) return 'ON_TRACK';
  if (progress >= elapsed * 0.6) return 'AT_RISK';
  return 'OFF_TRACK';
}

export function cleanKeyResults(raw: unknown, prior: KeyResult[] = []): { krs?: KeyResult[]; error?: string } {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 5) return { error: 'Add 1 to 5 key results.' };
  const out: KeyResult[] = [];
  for (const [i, k] of raw.entries()) {
    const title = String(k?.title ?? '').trim().slice(0, 160);
    const start = Number(k?.start ?? 0);
    const target = Number(k?.target);
    const weight = k?.weight === undefined || k?.weight === '' ? 1 : Number(k.weight);
    if (!title) return { error: `Key result ${i + 1} needs a title.` };
    if (!Number.isFinite(start) || !Number.isFinite(target)) return { error: `Key result ${i + 1} needs a numeric start and target.` };
    if (!Number.isFinite(weight) || weight < 1 || weight > 10) return { error: `Key result ${i + 1}: weight must be 1 to 10.` };
    const id = String(k?.id || '') || `kr${i + 1}${Math.random().toString(36).slice(2, 6)}`;
    const old = prior.find((p) => p.id === id);
    const current = old ? old.current : Number.isFinite(Number(k?.current)) && k?.current !== '' && k?.current !== undefined ? Number(k.current) : start;
    out.push({ id, title, start, target, current, unit: String(k?.unit ?? '').trim().slice(0, 20), weight });
  }
  return { krs: out };
}

// ------------------------------------------------------------------ promotions

export type PromoStatus = 'PROPOSED' | 'HR_RECOMMENDED' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'WITHDRAWN';
export const PROMO_LABEL: Record<PromoStatus, string> = {
  PROPOSED: 'Proposed', HR_RECOMMENDED: 'Waiting for founder', APPROVED: 'Approved', REJECTED: 'Rejected', APPLIED: 'Applied', WITHDRAWN: 'Withdrawn',
};
export type PromoAction = 'recommend' | 'approve' | 'reject' | 'apply' | 'withdraw';
const PROMO: Record<PromoAction, { from: PromoStatus[]; to: PromoStatus }> = {
  recommend: { from: ['PROPOSED'], to: 'HR_RECOMMENDED' },
  approve: { from: ['HR_RECOMMENDED'], to: 'APPROVED' },
  reject: { from: ['PROPOSED', 'HR_RECOMMENDED'], to: 'REJECTED' },
  apply: { from: ['APPROVED'], to: 'APPLIED' },
  withdraw: { from: ['PROPOSED', 'HR_RECOMMENDED', 'APPROVED'], to: 'WITHDRAWN' },
};
export function promoTransition(from: PromoStatus, action: PromoAction): { ok: true; to: PromoStatus } | { ok: false; error: string } {
  const t = PROMO[action];
  if (!t) return { ok: false, error: 'Unknown action.' };
  if (!t.from.includes(from)) return { ok: false, error: `This promotion is "${PROMO_LABEL[from]}", so that step is not available.` };
  return { ok: true, to: t.to };
}

// ------------------------------------------------------------------ quarterly review round

export const QUARTER_STEPS: { key: string; label: string; hint: string }[] = [
  { key: 'kpi', label: 'KPI review', hint: 'Open and finish the quarterly cycle in Performance.' },
  { key: 'okr', label: 'OKR close-out', hint: 'Owners update key results; HR closes the quarter\'s OKRs.' },
  { key: 'training', label: 'Training review', hint: 'Review training needs and learning path progress in HR Business Partner.' },
  { key: 'promotion', label: 'Promotion nominations', hint: 'Managers propose; HR recommends; the founder decides.' },
  { key: 'salary', label: 'Salary revisions', hint: 'Create the approved revisions in Payroll.' },
  { key: 'pip', label: 'Improvement plans', hint: 'Check every active improvement plan.' },
];
export const quarterDueDate = (q: string) => addDays(quarterBounds(q).end, 15);
