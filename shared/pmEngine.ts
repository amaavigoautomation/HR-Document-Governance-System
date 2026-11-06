/**
 * Performance Management: the rules, in one place, shared by the server and the screens.
 *
 * Three things are measured: Results (KRA/KPI), Behaviour (competencies) and SOP compliance (processes).
 * Ratings are 1 to 5, or "Not observed". "Not observed" is left out, never counted as 0 or 3.
 * Nothing in this file touches the database, so every rule here is easy to test.
 */

// ------------------------------------------------------------------ ratings

export type Rating = 1 | 2 | 3 | 4 | 5 | 'NO';
export const NOT_OBSERVED = 'NO' as const;
export const RATING_WORDS: Record<number, string> = { 1: 'Below Standard', 2: 'Developing', 3: 'Meets Standard', 4: 'Exceeds Standard', 5: 'Exemplary' };
export const RATING_HELP: Record<number, string> = {
  1: 'Repeated, evidenced gaps against what was expected',
  2: 'Some standards met; improvement required',
  3: 'Consistently meets the expected standard',
  4: 'Frequently exceeds expectations, with evidence',
  5: 'Sustained exceptional contribution, with clear evidence',
};
export const isRating = (v: unknown): v is Rating => v === 'NO' || v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
export const scored = (v: unknown): v is 1 | 2 | 3 | 4 | 5 => isRating(v) && v !== 'NO';

/** SOP checklist answer for one process. NA and NV are left out of the score, like "Not observed". */
export type SopResult = 'C' | 'N' | 'NA' | 'NV';
export const SOP_WORDS: Record<SopResult, string> = { C: 'Compliant', N: 'Not compliant', NA: 'Not applicable', NV: 'Not verified' };
export const isSopResult = (v: unknown): v is SopResult => v === 'C' || v === 'N' || v === 'NA' || v === 'NV';

// ------------------------------------------------------------------ defaults HR starts from

export interface Weights { results: number; behaviour: number; sop: number }
export const DEFAULT_WEIGHTS: Weights = { results: 60, behaviour: 25, sop: 15 };

export interface Competency { id: string; name: string; standard: string }
export const DEFAULT_COMPETENCIES: Competency[] = [
  { id: 'own', name: 'Ownership & Accountability', standard: 'Accepts responsibility and closes commitments' },
  { id: 'com', name: 'Communication', standard: 'Communicates clearly and in a timely manner' },
  { id: 'team', name: 'Teamwork & Collaboration', standard: 'Cooperates respectfully across functions' },
  { id: 'qual', name: 'Quality Orientation', standard: 'Checks accuracy and corrects defects' },
  { id: 'time', name: 'Time & Priority Management', standard: 'Plans work and flags deadline risks early' },
  { id: 'learn', name: 'Learning & Adaptability', standard: 'Applies feedback and learns relevant skills' },
  { id: 'prob', name: 'Problem Solving', standard: 'Identifies issues and proposes workable solutions' },
  { id: 'cond', name: 'Professional Conduct', standard: 'Maintains respectful, ethical workplace behaviour' },
  { id: 'client', name: 'Client / Stakeholder Responsibility', standard: 'Handles commitments and information professionally' },
  { id: 'proc', name: 'Process Discipline', standard: 'Follows approved processes and documentation' },
  { id: 'sec', name: 'Information Security & Confidentiality', standard: 'Uses approved systems and protects information' },
  { id: 'ai', name: 'Responsible AI & Technology Use', standard: 'Uses authorized AI tools and checks their output' },
];
/** Added automatically for anyone who has people reporting to them. */
export const MANAGER_EXTRAS: Competency[] = [
  { id: 'm_coach', name: 'Coaching & Feedback', standard: 'Gives regular, specific feedback and coaches the team' },
  { id: 'm_deleg', name: 'Delegation & Workload Planning', standard: 'Plans and shares work fairly and realistically' },
  { id: 'm_fair', name: 'Fair Decision-Making', standard: 'Makes consistent, evidence-based decisions' },
  { id: 'm_dev', name: 'Team Development', standard: 'Grows the skills of the people in the team' },
];

/** A starting list HR can pick KPIs from when making a role template (the spec's Performance Marketing example plus common ones). */
export const KPI_SUGGESTIONS: { kra: string; kpi: string; measure: string }[] = [
  { kra: 'Campaign Execution', kpi: 'Campaigns launched according to the approved plan', measure: 'Launch checklist / task records' },
  { kra: 'Campaign Optimisation', kpi: 'Timely, documented optimisation', measure: 'Platform and task records' },
  { kra: 'Lead Quality', kpi: 'Valid leads and lead-quality feedback', measure: 'CRM records' },
  { kra: 'Reporting', kpi: 'Accurate, on-time reports', measure: 'Dashboard / report submission' },
  { kra: 'Process Compliance', kpi: 'Tracking and QA checklist completed', measure: 'Approved SOP checklist' },
  { kra: 'Delivery', kpi: 'Deliverables completed on time', measure: 'Task system: completed vs due date' },
  { kra: 'Quality', kpi: 'Work accepted without rework', measure: 'QA / review records' },
  { kra: 'Client Satisfaction', kpi: 'Client feedback on delivered work', measure: 'Client feedback with context' },
  { kra: 'Revenue', kpi: 'New business closed against target', measure: 'CRM: closed deals' },
  { kra: 'Documentation', kpi: 'Work documented as per SOP', measure: 'Repository / document records' },
];

// ------------------------------------------------------------------ validation (the "can't get it wrong" rules)

const whole = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100;

/** Null when fine, otherwise a sentence that says exactly what to fix. */
export function weightsProblem(w: Partial<Weights>): string | null {
  const parts: [keyof Weights, string][] = [['results', 'Results'], ['behaviour', 'Behaviour'], ['sop', 'SOP']];
  for (const [k, label] of parts) if (!whole(w[k])) return `${label} weight must be a whole number from 0 to 100.`;
  const total = (w.results || 0) + (w.behaviour || 0) + (w.sop || 0);
  if (total !== 100) return `The three weights add up to ${total}. They must add up to 100.`;
  if (!w.results) return 'Results cannot be 0. It is the main part of a review.';
  return null;
}

export interface KpiDef { id: string; kra: string; kpi: string; measure: string; weight: number; frequency?: string; source?: string; target?: string }
export function kpiProblem(kpis: KpiDef[]): string | null {
  if (!kpis.length) return 'Add at least one KPI.';
  if (kpis.length > 12) return 'Use 12 KPIs or fewer. More than that is hard to rate fairly.';
  for (const [i, k] of kpis.entries()) {
    if (!k.kra.trim() || !k.kpi.trim()) return `KPI ${i + 1}: fill in both the responsibility area and the KPI.`;
    if (!whole(k.weight) || k.weight === 0) return `KPI ${i + 1} ("${k.kpi}"): weight must be a whole number from 1 to 100.`;
  }
  const total = kpis.reduce((s, k) => s + k.weight, 0);
  if (total !== 100) return `KPI weights add up to ${total}. They must add up to 100.`;
  return null;
}

// ------------------------------------------------------------------ review periods: calendar quarters

export interface Quarter { key: string; name: string; from: string; to: string }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function quarterOf(date: string): Quarter {
  const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7));
  const q = Math.floor((m - 1) / 3) + 1;
  return quarter(y, q);
}
export function quarter(y: number, q: number): Quarter {
  const m1 = (q - 1) * 3 + 1; const m3 = m1 + 2;
  const last = new Date(Date.UTC(y, m3, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return { key: `${y}-Q${q}`, name: `Q${q} ${y} (${MONTHS[m1 - 1]}–${MONTHS[m3 - 1]})`, from: `${y}-${p(m1)}-01`, to: `${y}-${p(m3)}-${p(last)}` };
}
export function quarterByKey(key: string): Quarter | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key || '');
  return m ? quarter(Number(m[1]), Number(m[2])) : null;
}
/** The quarter that ended most recently before `date` (the one whose review opens on the first day of the next quarter). */
export function previousQuarter(date: string): Quarter {
  const cur = quarterOf(date);
  const y = Number(cur.key.slice(0, 4)); const q = Number(cur.key.slice(6));
  return q === 1 ? quarter(y - 1, 4) : quarter(y, q - 1);
}

// ------------------------------------------------------------------ scoring

export interface ScoreInput {
  kpis: { id: string; weight: number; rating: unknown }[];
  comps: { id: string; rating: unknown }[];
  sops: { id: string; critical: boolean; result: unknown }[];
}
export type Pillar = 'results' | 'behaviour' | 'sop';
export interface Score {
  results: number | null; behaviour: number | null; sop: number | null;
  overall: number | null; band: string;
  /** Pillars with nothing rated. Results and Behaviour block the review; an empty SOP part is left out and the weights rescaled. */
  missing: Pillar[];
  /** Weights actually used (after rescaling for an empty SOP part). */
  used: Weights;
  /** A critical process marked "Not compliant". Never averaged away: HR must look at it before approving. */
  criticalBreach: boolean;
  blocking: string[];
}
const r2 = (n: number) => Math.round(n * 100) / 100;
export const bandOf = (n: number | null) => (n === null ? 'Not scored' : RATING_WORDS[Math.min(5, Math.max(1, Math.round(n)))]);

export function scoreReview(input: ScoreInput, w: Weights): Score {
  const k = input.kpis.filter((x) => scored(x.rating) && x.weight > 0);
  const kw = k.reduce((s, x) => s + x.weight, 0);
  const results = kw ? r2(k.reduce((s, x) => s + x.weight * (x.rating as number), 0) / kw) : null;

  const c = input.comps.filter((x) => scored(x.rating));
  const behaviour = c.length ? r2(c.reduce((s, x) => s + (x.rating as number), 0) / c.length) : null;

  const counted = input.sops.filter((x) => x.result === 'C' || x.result === 'N');
  const compliant = counted.filter((x) => x.result === 'C').length;
  // Share compliant mapped onto 1-5: all compliant = 5, none = 1.
  const sop = counted.length ? r2(1 + (4 * compliant) / counted.length) : null;
  const criticalBreach = input.sops.some((x) => x.critical && x.result === 'N');

  const missing: Pillar[] = [];
  if (results === null) missing.push('results');
  if (behaviour === null) missing.push('behaviour');
  if (sop === null) missing.push('sop');

  const blocking: string[] = [];
  if (results === null) blocking.push('No KPI has a rating yet. Rate at least one KPI (or the review cannot be scored).');
  if (behaviour === null) blocking.push('No behaviour has a rating yet. Rate at least one behaviour.');

  let used: Weights = { ...w };
  if (sop === null && w.sop > 0) {
    const rest = w.results + w.behaviour;
    used = { results: r2((w.results * 100) / rest), behaviour: r2((w.behaviour * 100) / rest), sop: 0 };
  }
  const overall = blocking.length ? null : r2(((results || 0) * used.results + (behaviour || 0) * used.behaviour + (sop || 0) * used.sop) / 100);
  return { results, behaviour, sop, overall, band: bandOf(overall), missing, used, criticalBreach, blocking };
}

/** What follows a published review. */
export type GrowthType = 'IMPROVEMENT' | 'DEVELOPMENT' | 'RECOGNITION';
export const growthFor = (overall: number | null): GrowthType => (overall !== null && overall < 2.5 ? 'IMPROVEMENT' : overall !== null && overall >= 4 ? 'RECOGNITION' : 'DEVELOPMENT');
export const GROWTH_WORDS: Record<GrowthType, string> = { IMPROVEMENT: 'Improvement plan', DEVELOPMENT: 'Development plan', RECOGNITION: 'Recognition' };

// ------------------------------------------------------------------ AI guard

const FORBIDDEN_INFERENCE = /\b(personalit\w*|introver\w*|extrover\w*|emotional(?:ly)?\s+(?:stab\w*|unstab\w*|fragile)|loyal\w*|disloyal\w*|motivat\w*|demotivat\w*|attitude problem|mental health|depress\w*|anxi\w*|health|illness|sick\w*|pregnan\w*|religio\w*|caste|gender|marital|married|ethnic\w*|race|racial|disabilit\w*|sexual\w*|political\w*|dating|affair|biometric|login (?:hours|duration)|private (?:chat|message)\w*)\b/i;
/** AI output must stay on documented work. Anything that infers personality, motivation, loyalty, health or protected traits is rejected. */
export function unsupportedInference(text: string): string | null {
  const m = FORBIDDEN_INFERENCE.exec(text || '');
  return m ? m[0] : null;
}

/** A plain rule-based check of KPI wording, used when AI is off and as a first pass when it is on. */
export function vagueKpi(text: string): string | null {
  const t = (text || '').toLowerCase();
  if (t.length < 8) return 'Too short to measure. Say what is delivered and how it is counted.';
  if (/\b(good|better|best|proper|properly|nice|great|excellent|improve|as needed|asap|etc)\b/.test(t) && !/\d|%|on time|per (day|week|month|quarter)|within/.test(t)) return 'Sounds vague. Add how it is measured (a number, a %, "on time", "within N days").';
  return null;
}

// ------------------------------------------------------------------ dates (India time, like the rest of the app)

export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ------------------------------------------------------------------ status words used by the screens

export const PLAN_WORDS: Record<string, string> = { ON_HOLD: 'On hold: setup missing', SET_TARGETS: 'Manager to set targets', HR_CHECK: 'Waiting for HR', ACTIVE: 'Active', CLOSED: 'Closed (kept for history)' };
export const REVIEW_WORDS: Record<string, string> = {
  ON_HOLD: 'On hold: setup missing', SELF: 'Waiting for self-review', MANAGER: 'Waiting for manager', HR: 'Waiting for HR approval', APPROVED: 'Approved, shared soon',
  PUBLISHED: 'Shared: waiting for employee', ACKNOWLEDGED: 'Done', DISPUTED: 'Employee disagrees', RESOLVED: 'Done (disagreement handled)', DEFERRED: 'Paused (long leave)',
};
export const GROWTH_STATUS_WORDS: Record<string, string> = { PROPOSED: 'Manager to confirm', ACTIVE: 'In progress', DONE: 'Completed', CANCELLED: 'Cancelled' };
