/**
 * Pure maths for salary revisions (arrears) and full and final settlements. No database, no clock.
 *
 * Gratuity uses the Payment of Gratuity Act formula: last drawn basic x 15 / 26 x completed years of service
 * (a part year over six months counts as a full year), up to a cap, and only after the minimum service.
 * All of these numbers are editable settings. Have a CA or lawyer confirm them: the labour codes change
 * what counts as wages and when gratuity is payable (for example fixed-term employees).
 */
import { addDays, daysBetween } from './leaveEngine.js';
import { r2, type PayComponent, type PayrollLine, type PayrollSettings } from './payrollEngine.js';

// ------------------------------------------------------------------ arrears for a salary revision

export interface PaidMonth {
  month: string;
  payDays: number;
  paidDays: number;
  /** Full-month earnings that were actually paid, by component id. */
  oldEarnings: Record<string, number>;
}

export interface ArrearsResult {
  total: number;
  months: { month: string; amount: number }[];
}

/**
 * What a person is owed (or owes) because new salary amounts should have applied to months that were already paid.
 * Pro-rated components follow the days that were paid in each month; fixed ones count in full.
 * PF, ESIC and professional tax are not recalculated on arrears.
 */
export function arrearsFor(newAmounts: Record<string, number>, components: PayComponent[], paid: PaidMonth[]): ArrearsResult {
  const earnings = components.filter((c) => c.kind === 'EARNING' && c.active);
  const months = paid.map((m) => {
    const factor = m.payDays > 0 ? Math.min(1, m.paidDays / m.payDays) : 0;
    const diff = earnings.reduce((n, c) => n + ((newAmounts[c.id] || 0) - (m.oldEarnings[c.id] || 0)) * (c.prorate ? factor : 1), 0);
    return { month: m.month, amount: r2(diff) };
  }).filter((m) => m.amount !== 0);
  return { total: r2(months.reduce((n, m) => n + m.amount, 0)), months };
}

// ------------------------------------------------------------------ service and gratuity

export interface Service {
  /** Whole months from joining to the last working day, both days counted. */
  months: number;
  extraDays: number;
  /** Completed years, rounded up when the part year is over six months. */
  years: number;
}

const addMonthsIso = (iso: string, n: number) => {
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10) - 1 + n;
  const d = parseInt(iso.slice(8, 10), 10);
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

export function serviceOf(joinDate: string, lastDay: string): Service {
  if (!joinDate || !lastDay || lastDay < joinDate) return { months: 0, extraDays: 0, years: 0 };
  const end = addDays(lastDay, 1); // the last day is worked, so service runs up to the day after it
  let months = (parseInt(end.slice(0, 4), 10) - parseInt(joinDate.slice(0, 4), 10)) * 12 + (parseInt(end.slice(5, 7), 10) - parseInt(joinDate.slice(5, 7), 10));
  if (addMonthsIso(joinDate, months) > end) months -= 1;
  months = Math.max(0, months);
  const extraDays = Math.max(0, daysBetween(addMonthsIso(joinDate, months), end));
  const rem = months % 12;
  const years = Math.floor(months / 12) + (rem > 6 || (rem === 6 && extraDays > 0) ? 1 : 0);
  return { months, extraDays, years };
}

export interface GratuityResult {
  eligible: boolean;
  service: Service;
  lastWage: number;
  amount: number;
  note: string;
}

export function gratuityFor(o: {
  settings: PayrollSettings['gratuity'];
  joinDate: string;
  lastDay: string;
  /** Basic (plus dearness allowance) for a full month. */
  lastWage: number;
  /** Death or disability: payable whatever the length of service. */
  forceEligible?: boolean;
}): GratuityResult {
  const service = serviceOf(o.joinDate, o.lastDay);
  const base = { service, lastWage: o.lastWage };
  if (!o.settings.enabled) return { ...base, eligible: false, amount: 0, note: 'Gratuity is switched off in the payroll setup.' };
  if (!o.joinDate) return { ...base, eligible: false, amount: 0, note: 'No joining date is recorded, so gratuity cannot be worked out.' };
  const minMonths = o.settings.minYears * 12;
  if (!o.forceEligible && service.months < minMonths) {
    return { ...base, eligible: false, amount: 0, note: `Service of ${Math.floor(service.months / 12)} year(s) ${service.months % 12} month(s) is below the ${o.settings.minYears} years needed.` };
  }
  if (o.lastWage <= 0) return { ...base, eligible: false, amount: 0, note: 'The salary has no basic, so gratuity cannot be worked out.' };
  const raw = (o.lastWage * o.settings.daysPerYear * service.years) / o.settings.divisor;
  const capped = o.settings.cap > 0 ? Math.min(raw, o.settings.cap) : raw;
  return {
    ...base, eligible: true, amount: r2(capped),
    note: `${service.years} year(s) x ${o.settings.daysPerYear}/${o.settings.divisor} x basic ${o.lastWage}${capped < raw ? ` (capped at ${o.settings.cap})` : ''}${o.forceEligible && service.months < minMonths ? ' (minimum service waived)' : ''}.`,
  };
}

// ------------------------------------------------------------------ notice period

export interface NoticeResult {
  requiredDays: number;
  servedDays: number;
  shortfallDays: number;
  perDay: number;
  recovery: number;
}

export function noticeFor(o: { requiredDays: number; servedDays: number; monthlyGross: number; recover: boolean }): NoticeResult {
  const required = Math.max(0, o.requiredDays);
  const served = Math.max(0, o.servedDays);
  const shortfall = Math.max(0, r2(required - served));
  const perDay = r2(o.monthlyGross / 30);
  return { requiredDays: required, servedDays: served, shortfallDays: shortfall, perDay, recovery: o.recover ? r2(shortfall * perDay) : 0 };
}

// ------------------------------------------------------------------ the settlement itself

export interface SettlementTotals {
  /** Final month's gross (with encashment and extras) plus gratuity. */
  gross: number;
  reimbursements: number;
  gratuity: number;
  deductions: number;
  net: number;
  payable: number;
  /** When the employee owes more than they are owed. */
  recoverable: number;
}

export function settlementTotals(line: Pick<PayrollLine, 'gross' | 'totalDeductions' | 'reimbursementTotal'>, gratuity: number, noticeRecovery: number, overpaid: number): SettlementTotals {
  const deductions = r2(line.totalDeductions + noticeRecovery + overpaid);
  const net = r2(line.gross + line.reimbursementTotal + gratuity - deductions);
  return {
    gross: r2(line.gross + gratuity), reimbursements: line.reimbursementTotal, gratuity, deductions, net,
    payable: Math.max(0, net), recoverable: Math.max(0, -net),
  };
}
