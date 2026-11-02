/**
 * Hiring budget rules and Position IDs (pure TypeScript: no browser, Node or database imports, so the browser,
 * the API and the tests can all use it).
 *
 * Each department can have an approved headcount and a maximum CTC (in lakhs per year, LPA). A requisition is checked
 * against both when the founder is about to approve it:
 *
 *   people in the team now + people already approved to be hired + people this requisition asks for  <=  approved headcount
 *   the highest CTC this requisition offers                                                          <=  the department's maximum CTC
 *
 * The check never blocks on its own. When it is not OK, or when no budget has been set, the founder can still approve but
 * has to give a reason, and the result is stored on the requisition so the decision can be explained later.
 */

export const deptKey = (name: unknown): string => String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface DeptBudget {
  /** Whole people. Null means no limit has been set. */
  approvedHeadcount: number | null;
  /** Highest CTC allowed for one hire, in lakhs per year. Null means no limit has been set. */
  maxCtcLpa: number | null;
}

export type BudgetStatus = 'OK' | 'OVER_HEADCOUNT' | 'OVER_BUDGET' | 'OVER_BOTH' | 'NO_BUDGET_SET';

export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = {
  OK: 'Within budget',
  OVER_HEADCOUNT: 'Over approved headcount',
  OVER_BUDGET: 'Over the CTC limit',
  OVER_BOTH: 'Over headcount and CTC limit',
  NO_BUDGET_SET: 'No budget set for this department',
};

export interface BudgetCheck {
  status: BudgetStatus;
  /** True for anything other than OK: the founder must then give a reason to approve. */
  overrideRequired: boolean;
  approvedHeadcount: number | null;
  currentHeadcount: number;
  /** Vacancies on requisitions already approved (job draft or open) in this department, not counting this one. */
  committedVacancies: number;
  requestedVacancies: number;
  headcountAfter: number;
  maxCtcLpa: number | null;
  requestedCtcMaxLpa: number | null;
  messages: string[];
  checkedAt: string;
}

export interface BudgetCheckInput {
  budget?: Partial<DeptBudget> | null;
  currentHeadcount: number;
  committedVacancies: number;
  requestedVacancies: number;
  requestedCtcMaxLpa: number | null;
  now?: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

export function evaluateBudget(input: BudgetCheckInput): BudgetCheck {
  const approved = num(input.budget?.approvedHeadcount);
  const maxCtc = num(input.budget?.maxCtcLpa);
  const current = Math.max(0, Math.floor(num(input.currentHeadcount) ?? 0));
  const committed = Math.max(0, Math.floor(num(input.committedVacancies) ?? 0));
  const requested = Math.max(0, Math.floor(num(input.requestedVacancies) ?? 0));
  const requestedCtc = num(input.requestedCtcMaxLpa);
  const after = current + committed + requested;
  const checkedAt = input.now || new Date().toISOString();

  const base = {
    approvedHeadcount: approved,
    currentHeadcount: current,
    committedVacancies: committed,
    requestedVacancies: requested,
    headcountAfter: after,
    maxCtcLpa: maxCtc,
    requestedCtcMaxLpa: requestedCtc,
    checkedAt,
  };

  if (approved === null && maxCtc === null) {
    return {
      ...base,
      status: 'NO_BUDGET_SET',
      overrideRequired: true,
      messages: ['No approved headcount or CTC limit has been set for this department (Talent Acquisition > Hiring budgets).'],
    };
  }

  const messages: string[] = [];
  let overHeadcount = false;
  let overCtc = false;

  if (approved !== null) {
    overHeadcount = after > approved;
    const sum = `${current} in the team now + ${committed} already approved to hire + ${requested} requested = ${after}`;
    messages.push(overHeadcount ? `${sum}, which is above the approved headcount of ${approved}.` : `${sum}, within the approved headcount of ${approved}.`);
  } else {
    messages.push('No approved headcount is set for this department, so headcount was not checked.');
  }

  if (maxCtc !== null) {
    if (requestedCtc === null) {
      messages.push(`No CTC was stated on the requisition, so the limit of ${fmt(maxCtc)} LPA could not be checked.`);
    } else {
      overCtc = requestedCtc > maxCtc;
      messages.push(
        overCtc
          ? `The requisition offers up to ${fmt(requestedCtc)} LPA, above the department limit of ${fmt(maxCtc)} LPA.`
          : `The requisition offers up to ${fmt(requestedCtc)} LPA, within the department limit of ${fmt(maxCtc)} LPA.`
      );
    }
  } else {
    messages.push('No CTC limit is set for this department, so pay was not checked.');
  }

  const status: BudgetStatus = overHeadcount && overCtc ? 'OVER_BOTH' : overHeadcount ? 'OVER_HEADCOUNT' : overCtc ? 'OVER_BUDGET' : 'OK';
  return { ...base, status, overrideRequired: status !== 'OK', messages };
}

/** Why a department budget entry is not acceptable, or the cleaned values. A blank field means "no limit". */
export function cleanBudgetInput(raw: { approvedHeadcount?: unknown; maxCtcLpa?: unknown }): { value?: DeptBudget; error?: string } {
  const h = raw.approvedHeadcount;
  const c = raw.maxCtcLpa;
  let approvedHeadcount: number | null = null;
  let maxCtcLpa: number | null = null;
  if (h !== null && h !== undefined && String(h).trim() !== '') {
    const n = Number(h);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return { error: 'Approved headcount must be a whole number from 0 to 100000.' };
    approvedHeadcount = n;
  }
  if (c !== null && c !== undefined && String(c).trim() !== '') {
    const n = Number(c);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) return { error: 'The CTC limit must be a number above 0 and up to 1000 (lakhs per year).' };
    maxCtcLpa = Math.round(n * 100) / 100;
  }
  return { value: { approvedHeadcount, maxCtcLpa } };
}

/**
 * Reads a pay range typed as free text on older requisitions ("INR 6-8 LPA", "6 to 8 lakh", "8 LPA").
 * Only text that says LPA, lakh or lac is read; anything else returns nulls rather than a guess.
 */
export function parseLpaRange(text: unknown): { min: number | null; max: number | null } {
  const t = String(text ?? '');
  if (!/\b(lpa|lakhs?|lacs?)\b/i.test(t)) return { min: null, max: null };
  const found = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => Number.isFinite(n) && n > 0 && n <= 1000);
  if (found.length === 0) return { min: null, max: null };
  const [a, b] = found;
  return b === undefined ? { min: a, max: a } : { min: Math.min(a, b), max: Math.max(a, b) };
}

/** The highest CTC a requisition offers: the number field when present, otherwise what the old free-text range says. */
export function requisitionMaxCtcLpa(req: { ctcMaxLpa?: unknown; budgetRange?: unknown }): number | null {
  const direct = num(req.ctcMaxLpa);
  if (direct !== null && direct > 0) return direct;
  return parseLpaRange(req.budgetRange).max;
}

/** "INR 6-8 LPA" style text kept on the requisition so older screens and the careers post still show a range. */
export function formatCtcRange(minLpa: number | null, maxLpa: number | null): string {
  if (minLpa === null && maxLpa === null) return '';
  if (minLpa !== null && maxLpa !== null && minLpa !== maxLpa) return `INR ${fmt(minLpa)}-${fmt(maxLpa)} LPA`;
  return `INR ${fmt((maxLpa ?? minLpa) as number)} LPA`;
}

/** POS-AMA-2026-001: unique per company and year. The running number comes from a server-side counter. */
export function formatPositionId(prefix: string, year: number, n: number): string {
  const p = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return ['POS', p, String(year), String(Math.max(1, Math.floor(n))).padStart(3, '0')].filter(Boolean).join('-');
}

/** Requisition statuses whose vacancies count as already approved to be hired. */
export const COMMITTED_STATUSES = ['JD_DRAFT', 'JOB_OPEN'] as const;
