/**
 * Pure helpers for the recruitment AI (no I/O, no model calls), so the parts that matter for fairness and accuracy can be tested:
 *  - employment history analysis: gaps, tenure, stability (computed from dates, never guessed by a model)
 *  - cleaning what a model returns
 *  - duplicate detection
 *  - a hiring recommendation built from facts, with the reasons listed
 *  - plain-language insights from the founder dashboard numbers
 * The model only reads and writes language; scores and verdicts come from here.
 */
import type { Dashboard } from './hiringAnalytics.js';

// ------------------------------------------------------------------ employment history

export interface Job { company: string; role: string; from: string; to: string }
const ym = (s: string) => /^\d{4}-\d{2}$/.test(s);
const monthIndex = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;

export interface HistoryAnalysis {
  jobs: number; totalMonths: number; averageTenureMonths: number | null; shortStints: number;
  gaps: { from: string; to: string; months: number }[]; stabilityScore: number | null; label: string;
}

/** `to` may be "present". A gap is three or more months between the end of one job and the start of the next. */
export function analyseHistory(history: Job[], todayYm: string): HistoryAnalysis {
  const jobs = history
    .map((j) => ({ ...j, to: j.to === 'present' || !j.to ? todayYm : j.to }))
    .filter((j) => ym(j.from) && ym(j.to) && monthIndex(j.to) >= monthIndex(j.from))
    .sort((a, b) => monthIndex(a.from) - monthIndex(b.from));
  if (!jobs.length) return { jobs: 0, totalMonths: 0, averageTenureMonths: null, shortStints: 0, gaps: [], stabilityScore: null, label: 'No dated employment history found' };
  const tenures = jobs.map((j) => monthIndex(j.to) - monthIndex(j.from) + 1);
  const gaps: HistoryAnalysis['gaps'] = [];
  let reach = monthIndex(jobs[0].to);
  for (const j of jobs.slice(1)) {
    const gap = monthIndex(j.from) - reach - 1;
    if (gap >= 3) gaps.push({ from: `${Math.floor((reach + 1) / 12)}-${String(((reach + 1) % 12) + 1).padStart(2, '0')}`, to: j.from, months: gap });
    reach = Math.max(reach, monthIndex(j.to));
  }
  const avg = tenures.reduce((a, c) => a + c, 0) / tenures.length;
  const short = tenures.filter((t) => t < 6).length;
  let score = Math.min(100, (avg / 24) * 100);
  score -= Math.min(30, gaps.length * 10);
  score -= Math.min(30, short * 10);
  score = Math.round(Math.max(0, score));
  const label = score >= 75 ? 'Stable history' : score >= 50 ? 'Mixed history' : 'Frequent changes or gaps';
  return { jobs: jobs.length, totalMonths: tenures.reduce((a, c) => a + c, 0), averageTenureMonths: Math.round(avg * 10) / 10, shortStints: short, gaps, stabilityScore: score, label };
}

// ------------------------------------------------------------------ cleaning a model's answer

export interface Extraction {
  skills: string[]; yearsExperience: number | null; education: { degree: string; institute: string; year: string }[]; certifications: string[];
  history: Job[]; projects: string[]; summary: string;
}
const strs = (v: unknown, n: number, len: number): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim().slice(0, len)).filter(Boolean).slice(0, n) : []);

/** Anything the model gets wrong or leaves out becomes empty rather than made-up. */
export function cleanExtraction(raw: any): Extraction {
  const years = Number(raw?.yearsExperience);
  const ymOrPresent = (s: unknown) => { const v = String(s ?? '').trim().toLowerCase(); return v === 'present' || v === 'current' || v === 'now' ? 'present' : ym(v) ? v : ''; };
  return {
    skills: strs(raw?.skills, 40, 60),
    yearsExperience: Number.isFinite(years) && years >= 0 && years <= 50 ? Math.round(years * 10) / 10 : null,
    education: (Array.isArray(raw?.education) ? raw.education : []).slice(0, 6).map((e: any) => ({ degree: String(e?.degree ?? '').slice(0, 100), institute: String(e?.institute ?? '').slice(0, 120), year: String(e?.year ?? '').slice(0, 10) })).filter((e: any) => e.degree || e.institute),
    certifications: strs(raw?.certifications, 15, 100),
    history: (Array.isArray(raw?.history) ? raw.history : []).slice(0, 20).map((j: any) => ({ company: String(j?.company ?? '').slice(0, 100), role: String(j?.role ?? '').slice(0, 100), from: ymOrPresent(j?.from), to: ymOrPresent(j?.to) })).filter((j: Job) => j.from && j.to),
    projects: strs(raw?.projects, 8, 200),
    summary: String(raw?.summary ?? '').trim().slice(0, 600),
  };
}

// ------------------------------------------------------------------ duplicates

export const digits = (s: string) => String(s || '').replace(/\D/g, '');
export const phoneKey = (s: string) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : ''; };
const nameTokens = (s: string) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1).sort();
const bigrams = (s: string) => { const out: string[] = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; };
/** 0 to 1; word order does not matter ("Rao Priya" matches "Priya Rao"). */
export function nameSimilarity(a: string, b: string): number {
  const x = nameTokens(a).join(' '), y = nameTokens(b).join(' ');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x), by = bigrams(y);
  if (!bx.length || !by.length) return 0;
  const counts = new Map<string, number>();
  bx.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1));
  let hit = 0;
  by.forEach((g) => { const c = counts.get(g) || 0; if (c > 0) { hit++; counts.set(g, c - 1); } });
  return (2 * hit) / (bx.length + by.length);
}

export interface DupApp { id: string; name: string; email?: string; mobile?: string; resumeUrl?: string; designation?: string; createdAt?: string }
export interface DupGroup { ids: string[]; reasons: string[]; confidence: 'SURE' | 'POSSIBLE' }

/** SURE: the same email, phone or resume link. POSSIBLE: a very similar name applying for the same role. */
export function findDuplicates(apps: DupApp[]): DupGroup[] {
  const parent = new Map<string, string>(apps.map((a) => [a.id, a.id]));
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const reasons = new Map<string, Set<string>>();
  const note = (a: string, b: string, why: string) => { union(a, b); for (const k of [a, b]) { (reasons.get(k) || reasons.set(k, new Set()).get(k)!).add(why); } };
  const sure = new Set<string>();
  const index = (key: (a: DupApp) => string, why: string) => {
    const seen = new Map<string, string>();
    for (const a of apps) {
      const k = key(a);
      if (!k) continue;
      if (seen.has(k)) { note(seen.get(k)!, a.id, why); sure.add(a.id); sure.add(seen.get(k)!); } else seen.set(k, a.id);
    }
  };
  index((a) => String(a.email || '').trim().toLowerCase(), 'Same email');
  index((a) => phoneKey(a.mobile || ''), 'Same phone number');
  index((a) => String(a.resumeUrl || '').trim().toLowerCase().replace(/[?#].*$/, ''), 'Same resume link');
  for (let i = 0; i < apps.length; i++) {
    for (let j = i + 1; j < apps.length; j++) {
      const a = apps[i], b = apps[j];
      if (find(a.id) === find(b.id)) continue;
      if (String(a.designation || '').toLowerCase() === String(b.designation || '').toLowerCase() && nameSimilarity(a.name, b.name) >= 0.9) note(a.id, b.id, 'Very similar name for the same role');
    }
  }
  const groups = new Map<string, string[]>();
  for (const a of apps) if (reasons.has(a.id)) (groups.get(find(a.id)) || groups.set(find(a.id), []).get(find(a.id))!).push(a.id);
  return [...groups.values()].filter((g) => g.length > 1).map((ids) => ({
    ids, reasons: [...new Set(ids.flatMap((id) => [...(reasons.get(id) || [])]))], confidence: ids.some((id) => sure.has(id)) ? 'SURE' as const : 'POSSIBLE' as const,
  })).sort((a, b) => (a.confidence === b.confidence ? b.ids.length - a.ids.length : a.confidence === 'SURE' ? -1 : 1));
}

// ------------------------------------------------------------------ recommendation from facts

export type Verdict = 'HIRE' | 'CONSIDER' | 'HOLD' | 'NO_HIRE';
export const VERDICT_LABEL: Record<Verdict, string> = { HIRE: 'Recommend hiring', CONSIDER: 'Worth considering', HOLD: 'Hold, more information needed', NO_HIRE: 'Do not proceed' };

export interface RecommendInput {
  score: number | null; interview: { average: number; recommendation: string } | null; screening: string; assessments: { result?: string }[]; expectedCtcLpa?: number | null; bandMaxLpa?: number | null;
}
export function recommend(i: RecommendInput): { verdict: Verdict; points: number; reasons: string[]; missing: string[] } {
  let pts = 0;
  const reasons: string[] = [];
  const missing: string[] = [];
  if (i.score === null) missing.push('weighted score');
  else {
    const p = i.score >= 75 ? 2 : i.score >= 60 ? 1 : i.score >= 50 ? -1 : -2;
    pts += p;
    reasons.push(`Weighted score ${i.score}/100 (${p >= 0 ? '+' : ''}${p}).`);
  }
  if (!i.interview) missing.push('interview feedback (all panel members must submit first)');
  else {
    const p = ({ 'Strong yes': 3, 'Lean yes': 1, 'Split / lean no': -1, No: -3 } as Record<string, number>)[i.interview.recommendation] ?? 0;
    pts += p;
    reasons.push(`Interview panel: ${i.interview.recommendation}, average ${i.interview.average}/5 (${p >= 0 ? '+' : ''}${p}).`);
  }
  if (i.screening === 'PASS') { pts += 1; reasons.push('Passed HR screening (+1).'); }
  else if (i.screening === 'FAIL') { pts -= 2; reasons.push('Did not pass HR screening (-2).'); }
  else missing.push('HR screening outcome');
  const done = i.assessments.filter((a) => a.result);
  if (done.some((a) => a.result === 'FAIL')) { pts -= 2; reasons.push('Failed an assessment (-2).'); }
  else if (done.length && done.length === i.assessments.length) { pts += 1; reasons.push('Passed every assessment (+1).'); }
  if (typeof i.expectedCtcLpa === 'number' && typeof i.bandMaxLpa === 'number' && i.expectedCtcLpa > i.bandMaxLpa) { pts -= 1; reasons.push(`Expected CTC ${i.expectedCtcLpa} LPA is above the budget of ${i.bandMaxLpa} LPA (-1).`); }
  const verdict: Verdict = pts >= 4 ? 'HIRE' : pts >= 1 ? 'CONSIDER' : pts >= -1 ? 'HOLD' : 'NO_HIRE';
  // Never a firm "hire" or "reject" on thin evidence.
  const capped: Verdict = missing.length >= 2 && (verdict === 'HIRE' || verdict === 'NO_HIRE') ? 'HOLD' : verdict;
  return { verdict: capped, points: pts, reasons, missing };
}

// ------------------------------------------------------------------ insights from the dashboard

export interface Insight { tone: 'good' | 'warn' | 'info'; text: string }
export function buildInsights(d: Dashboard): Insight[] {
  const out: Insight[] = [];
  if (d.offers.acceptanceRate !== null && d.offers.answered >= 3) {
    out.push(d.offers.acceptanceRate < 60
      ? { tone: 'warn', text: `Only ${d.offers.acceptanceRate}% of answered offers were accepted. Check whether offers are below what candidates expect, or whether the process is too slow.` }
      : { tone: 'good', text: `${d.offers.acceptanceRate}% of answered offers were accepted.` });
  }
  const ghosted = d.offers.byStatus.GHOSTED || 0;
  if (ghosted >= 2) out.push({ tone: 'warn', text: `${ghosted} candidates stopped responding after an offer. A phone call from the hiring manager after sending usually helps.` });
  if (d.timeToHire.averageDays !== null) out.push(d.timeToHire.averageDays > 45 ? { tone: 'warn', text: `Hiring takes ${d.timeToHire.averageDays} days on average from founder approval to acceptance. Slowest: ${d.timeToHire.slowest.map((s) => `${s.position} (${s.days}d)`).join(', ')}.` } : { tone: 'good', text: `Average time to hire is ${d.timeToHire.averageDays} days.` });
  const best = d.sources.filter((s) => s.hires > 0).sort((a, b) => (b.conversionPct ?? 0) - (a.conversionPct ?? 0))[0];
  if (best) out.push({ tone: 'info', text: `${best.source} brings the best results so far: ${best.hires} hire${best.hires === 1 ? '' : 's'} from ${best.applications} application${best.applications === 1 ? '' : 's'}.` });
  const over = d.budgetVsActual.filter((b) => b.varianceLpa < 0);
  if (over.length) out.push({ tone: 'warn', text: `Offers are above budget in ${over.map((b) => `${b.department} (${Math.abs(b.varianceLpa)} LPA over)`).join(', ')}.` });
  if (d.positions.openVacancies > 0 && d.pipeline.length) {
    const active = d.pipeline.filter((p) => !['Rejected', 'On Hold', 'Selected'].includes(p.stage)).reduce((a, c) => a + c.count, 0);
    if (active < d.positions.openVacancies * 5) out.push({ tone: 'warn', text: `${d.positions.openVacancies} open vacancies but only ${active} candidates still in the pipeline. Consider widening sourcing.` });
  }
  if (d.attrition.ratePct !== null && d.attrition.ratePct >= 20) out.push({ tone: 'warn', text: `Attrition over the last 12 months is ${d.attrition.ratePct}% (${d.attrition.exits12m} exits). Review exit reasons.` });
  if (d.upcomingJoinings.next30Days) out.push({ tone: 'info', text: `${d.upcomingJoinings.next30Days} people join in the next 30 days. Check their onboarding checklists.` });
  if (!out.length) out.push({ tone: 'info', text: 'Not enough hiring activity yet for insights. They appear as offers, costs and joinings are recorded.' });
  return out;
}
