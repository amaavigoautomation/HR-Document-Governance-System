/**
 * HR Business Partner rules that need no database: the 9-box grid, KPI status, PIP workflow, certificate expiry,
 * client allocation, anonymous survey results and succession coverage. Used by api/_lib/hrbpApi.ts and tested on their own.
 */

// ------------------------------------------------------------------ 9-box talent grid

export type Level = 1 | 2 | 3;
const BOX: Record<string, string> = {
  '3-3': 'Star', '3-2': 'High performer', '3-1': 'Solid but needs a stretch',
  '2-3': 'High potential', '2-2': 'Core player', '2-1': 'Effective',
  '1-3': 'Rough diamond', '1-2': 'Inconsistent', '1-1': 'Underperformer',
};
/** Performance and potential are each 1 (low) to 3 (high). */
export function nineBox(performance: number, potential: number): { cell: string; label: string } | null {
  if (![1, 2, 3].includes(performance) || ![1, 2, 3].includes(potential)) return null;
  const cell = `${performance}-${potential}`;
  return { cell, label: BOX[cell] };
}

// ------------------------------------------------------------------ KPIs

export type KpiStatus = 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';
/** Attainment as a percentage of target. For "lower is better" KPIs (cost, defects) the ratio is flipped. */
export function kpiAttainment(target: number, actual: number | null | undefined, direction: 'HIGHER' | 'LOWER' = 'HIGHER'): number | null {
  if (actual === null || actual === undefined || !Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return null;
  if (direction === 'LOWER') return actual <= 0 ? 100 : Math.round((target / actual) * 1000) / 10;
  return Math.round((actual / target) * 1000) / 10;
}
export function kpiStatus(attainment: number | null): KpiStatus {
  if (attainment === null) return 'NO_DATA';
  return attainment >= 90 ? 'GREEN' : attainment >= 70 ? 'AMBER' : 'RED';
}

// ------------------------------------------------------------------ performance improvement plan

export type PipStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'EXTENDED' | 'FAILED' | 'CANCELLED';
export const PIP_FINAL: PipStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
export type PipAction = 'start' | 'checkin' | 'extend' | 'complete' | 'fail' | 'cancel';

const PIP_NEXT: Record<PipAction, { from: PipStatus[]; to: PipStatus | null }> = {
  start: { from: ['DRAFT'], to: 'ACTIVE' },
  checkin: { from: ['ACTIVE', 'EXTENDED'], to: null },
  extend: { from: ['ACTIVE', 'EXTENDED'], to: 'EXTENDED' },
  complete: { from: ['ACTIVE', 'EXTENDED'], to: 'COMPLETED' },
  fail: { from: ['ACTIVE', 'EXTENDED'], to: 'FAILED' },
  cancel: { from: ['DRAFT', 'ACTIVE', 'EXTENDED'], to: 'CANCELLED' },
};
export function pipTransition(status: PipStatus, action: PipAction): { ok: boolean; to?: PipStatus | null; error?: string } {
  const rule = PIP_NEXT[action];
  if (!rule) return { ok: false, error: 'Unknown action.' };
  const verb: Record<PipAction, string> = { start: 'started', checkin: 'checked in on', extend: 'extended', complete: 'completed', fail: 'marked as failed', cancel: 'cancelled' };
  if (!rule.from.includes(status)) return { ok: false, error: `A plan that is ${status.toLowerCase()} cannot be ${verb[action]}.` };
  return { ok: true, to: rule.to };
}

const dayMs = 86400000;
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / dayMs);
}

export function validatePipPlan(p: { startOn: string; endOn: string; reason: string; goals: { text: string; dueOn?: string }[] }): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.startOn) || !/^\d{4}-\d{2}-\d{2}$/.test(p.endOn)) return 'Start and end dates are required.';
  const len = daysBetween(p.startOn, p.endOn);
  if (len < 14) return 'A plan must run for at least 14 days.';
  if (len > 120) return 'A plan cannot run for more than 120 days. Use an extension if more time is needed.';
  if (!p.reason.trim()) return 'Say what performance gap this plan is about.';
  if (!p.goals.length) return 'Add at least one measurable goal.';
  if (p.goals.length > 10) return 'Use at most 10 goals.';
  for (const g of p.goals) {
    if (!g.text.trim()) return 'Every goal needs a description.';
    if (g.dueOn && (g.dueOn < p.startOn || g.dueOn > p.endOn)) return 'A goal due date falls outside the plan period.';
  }
  return null;
}

// ------------------------------------------------------------------ certificates

export type CertStatus = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';
export function certStatus(expiresOn: string | undefined, today: string, warnDays = 60): CertStatus {
  if (!expiresOn) return 'NO_EXPIRY';
  const left = daysBetween(today, expiresOn);
  return left < 0 ? 'EXPIRED' : left <= warnDays ? 'EXPIRING' : 'VALID';
}

// ------------------------------------------------------------------ client allocation

export interface Allocation { client: string; percent: number }
export function cleanAllocations(raw: unknown): { value?: Allocation[]; error?: string } {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) return { error: 'Allocations must be a list.' };
  const out: Allocation[] = [];
  for (const a of raw) {
    const client = String(a?.client || '').trim().slice(0, 80);
    const percent = Number(a?.percent);
    if (!client) return { error: 'Every allocation needs a client name.' };
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return { error: `Allocation for ${client} must be between 1 and 100 percent.` };
    out.push({ client, percent: Math.round(percent) });
  }
  return { value: out };
}
export function allocationSummary(allocs: Allocation[], billable: boolean): { total: number; state: 'OVER' | 'FULL' | 'PARTIAL' | 'BENCH' | 'NON_BILLABLE' } {
  const total = allocs.reduce((a, x) => a + x.percent, 0);
  if (!billable) return { total, state: 'NON_BILLABLE' };
  return { total, state: total > 100 ? 'OVER' : total === 100 ? 'FULL' : total > 0 ? 'PARTIAL' : 'BENCH' };
}

// ------------------------------------------------------------------ pulse survey results

export interface SurveyQuestion { id: string; text: string; type: 'scale' | 'text' }
export const MIN_ANONYMOUS_RESPONSES = 5;
/**
 * Results are hidden until at least 5 people have answered, so a single person's answers can never be picked out.
 * Scale questions give an average and a 1-5 spread; text answers are listed without names.
 */
export function surveyAggregate(questions: SurveyQuestion[], responses: { answers: Record<string, any> }[], min = MIN_ANONYMOUS_RESPONSES) {
  if (responses.length < min) return { visible: false as const, responses: responses.length, needed: min - responses.length };
  const out = questions.map((q) => {
    if (q.type === 'scale') {
      const v = responses.map((r) => Number(r.answers?.[q.id])).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
      const spread: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
      v.forEach((n) => { spread[String(n)]++; });
      return { id: q.id, text: q.text, type: q.type, answered: v.length, average: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null, spread };
    }
    const texts = responses.map((r) => String(r.answers?.[q.id] || '').trim()).filter(Boolean).slice(0, 50);
    return { id: q.id, text: q.text, type: q.type, answered: texts.length, texts };
  });
  const scaleAvgs = out.filter((o: any) => o.type === 'scale' && o.average !== null).map((o: any) => o.average as number);
  return { visible: true as const, responses: responses.length, questions: out, overall: scaleAvgs.length ? Math.round((scaleAvgs.reduce((a, b) => a + b, 0) / scaleAvgs.length) * 100) / 100 : null };
}

// ------------------------------------------------------------------ succession

export type Readiness = 'READY_NOW' | 'ONE_TO_TWO_YEARS' | 'THREE_PLUS_YEARS';
export const READINESS_LABEL: Record<Readiness, string> = { READY_NOW: 'Ready now', ONE_TO_TWO_YEARS: 'Ready in 1-2 years', THREE_PLUS_YEARS: 'Ready in 3+ years' };
export function successionGap(plan: { critical: boolean; successors: { readiness: Readiness }[] }): 'COVERED' | 'THIN' | 'NO_SUCCESSOR' | 'OK' {
  const n = plan.successors.length;
  const ready = plan.successors.filter((s) => s.readiness === 'READY_NOW').length;
  if (n === 0) return plan.critical ? 'NO_SUCCESSOR' : 'OK';
  if (ready >= 1) return ready >= 2 || !plan.critical ? 'COVERED' : 'THIN';
  return plan.critical ? 'NO_SUCCESSOR' : 'THIN';
}
