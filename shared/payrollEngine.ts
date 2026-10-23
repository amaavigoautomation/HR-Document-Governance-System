/**
 * Payroll engine: pure functions, no database, no clock. Shared by the server and the tests.
 *
 * Scope (India): salary components, proration for loss-of-pay days, leave encashment, PF, ESIC,
 * state professional tax, one-off adjustments and loan recoveries. Income tax (TDS) is NOT calculated:
 * enter it as a fixed deduction component.
 *
 * Statutory rates, ceilings and professional tax slabs below are STARTER VALUES. They change over
 * time (and the new labour codes may change what counts as "wages"), so every one of them is editable
 * in the company's payroll setup. Have an accountant or CA confirm them before paying real salaries.
 */

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const rInt = (n: number) => Math.round(n + 1e-9);
const ceilInt = (n: number) => Math.ceil(r2(n) - 1e-9);

// ------------------------------------------------------------------ types

export type ComponentKind = 'EARNING' | 'DEDUCTION';

export interface PayComponent {
  id: string;
  code: string;
  name: string;
  kind: ComponentKind;
  active: boolean;
  /** Earnings only: scaled by paid days / days in the month. Deductions are never prorated. */
  prorate: boolean;
  /** Counts toward the provident fund wage (basic, dearness allowance). */
  pfWage: boolean;
  /** Counts toward the ESIC wage. */
  esicWage: boolean;
  /** The basic salary component (used as the base for percentages and leave encashment). */
  isBasic?: boolean;
}

export interface CtcTemplateRow {
  componentId: string;
  mode: 'PERCENT_OF_CTC' | 'PERCENT_OF_BASIC' | 'FIXED' | 'BALANCE';
  value: number;
}

export interface PtSlab {
  from: number;
  /** null = no upper limit. */
  to: number | null;
  amount: number;
  /** Different amount for February (some states collect the balance of the year then). */
  febAmount?: number;
  gender?: 'ANY' | 'F' | 'M';
}

export interface PayrollSettings {
  /** CALENDAR: pay for the real days of the month. FIXED_30: always treat the month as 30 days. */
  daysBasis: 'CALENDAR' | 'FIXED_30';
  /**
   * ATTENDANCE: absent days (and half days) cut pay as well as unpaid leave.
   * LEAVE_ONLY: only approved unpaid leave cuts pay; attendance records are ignored.
   */
  attendanceMode: 'ATTENDANCE' | 'LEAVE_ONLY';
  deductLateMarks: boolean;
  /** Per-day value used for leave encashment: that component total divided by 30. */
  encashmentBase: 'BASIC' | 'GROSS';
  components: PayComponent[];
  ctcTemplate: CtcTemplateRow[];
  pf: { enabled: boolean; employeePct: number; employerPct: number; edliPct: number; adminPct: number; wageCeiling: number };
  esic: { enabled: boolean; employeePct: number; employerPct: number; wageCeiling: number };
  pt: { enabled: boolean; defaultState: string; states: Record<string, PtSlab[]> };
  company: { legalName: string; address: string };
}

export interface SalaryStructure {
  /** Full-month amount for each component id. */
  amounts: Record<string, number>;
  state: string;
  gender?: 'F' | 'M' | 'O' | '';
  pfApplicable: boolean;
  esicApplicable: boolean;
  /** Contribute PF on the actual wage even above the ceiling. */
  pfOnActualWage: boolean;
}

export interface Adjustment {
  kind: 'EARNING' | 'DEDUCTION';
  label: string;
  amount: number;
}

export interface LineInput {
  settings: PayrollSettings;
  structure: SalaryStructure;
  /** 1 to 12 and the year, so February can be recognised. */
  month: string;
  paidDays: number;
  /** The divisor for proration: days in the month (CALENDAR) or 30 (FIXED_30). */
  payDays: number;
  encashDays: number;
  adjustments: Adjustment[];
  loanRecoveries: { id: string; label: string; amount: number }[];
}

export interface LineAmount {
  id: string;
  code: string;
  name: string;
  full: number;
  amount: number;
}

export interface PayrollLine {
  paidDays: number;
  payDays: number;
  earnings: LineAmount[];
  deductions: LineAmount[];
  adjustments: Adjustment[];
  encashment: { days: number; perDay: number; amount: number };
  loans: { id: string; label: string; amount: number }[];
  statutory: {
    pfWage: number;
    pfEmployee: number;
    pfEmployer: number;
    edli: number;
    pfAdmin: number;
    esicWage: number;
    esicEmployee: number;
    esicEmployer: number;
    pt: number;
  };
  gross: number;
  totalDeductions: number;
  net: number;
  /** Cost to the company: gross plus the employer-side statutory contributions. */
  employerCost: number;
  shortfall: number;
  warnings: string[];
  /** A blocking warning stops the run from being approved until it is fixed. */
  blocking: boolean;
}

// ------------------------------------------------------------------ starter data

const C = (p: Partial<PayComponent> & Pick<PayComponent, 'id' | 'code' | 'name' | 'kind'>): PayComponent => ({
  active: true, prorate: p.kind === 'EARNING', pfWage: false, esicWage: p.kind === 'EARNING', ...p,
});

export const STARTER_COMPONENTS: PayComponent[] = [
  C({ id: 'basic', code: 'BASIC', name: 'Basic salary', kind: 'EARNING', pfWage: true, isBasic: true }),
  C({ id: 'hra', code: 'HRA', name: 'House rent allowance', kind: 'EARNING' }),
  C({ id: 'special', code: 'SPL', name: 'Special allowance', kind: 'EARNING' }),
  C({ id: 'conveyance', code: 'CONV', name: 'Conveyance allowance', kind: 'EARNING' }),
  C({ id: 'tds', code: 'TDS', name: 'Income tax (TDS)', kind: 'DEDUCTION', prorate: false, esicWage: false }),
];

export const STARTER_CTC_TEMPLATE: CtcTemplateRow[] = [
  { componentId: 'basic', mode: 'PERCENT_OF_CTC', value: 50 },
  { componentId: 'hra', mode: 'PERCENT_OF_BASIC', value: 40 },
  { componentId: 'conveyance', mode: 'FIXED', value: 1600 },
  { componentId: 'special', mode: 'BALANCE', value: 0 },
];

/**
 * Starter professional tax slabs (monthly rupees). These are NOT verified for the current year:
 * they exist so a company has something to edit. States not listed here have no slabs until HR adds them.
 */
export const STARTER_PT: Record<string, PtSlab[]> = {
  Maharashtra: [
    { from: 0, to: 7500, amount: 0, gender: 'M' },
    { from: 7501, to: 10000, amount: 175, gender: 'M' },
    { from: 10001, to: null, amount: 200, febAmount: 300, gender: 'M' },
    { from: 0, to: 25000, amount: 0, gender: 'F' },
    { from: 25001, to: null, amount: 200, febAmount: 300, gender: 'F' },
  ],
  Karnataka: [
    { from: 0, to: 24999, amount: 0 },
    { from: 25000, to: null, amount: 200 },
  ],
  Gujarat: [
    { from: 0, to: 12000, amount: 0 },
    { from: 12001, to: null, amount: 200 },
  ],
  Telangana: [
    { from: 0, to: 15000, amount: 0 },
    { from: 15001, to: 20000, amount: 150 },
    { from: 20001, to: null, amount: 200 },
  ],
  'Andhra Pradesh': [
    { from: 0, to: 15000, amount: 0 },
    { from: 15001, to: 20000, amount: 150 },
    { from: 20001, to: null, amount: 200 },
  ],
  'West Bengal': [
    { from: 0, to: 10000, amount: 0 },
    { from: 10001, to: 15000, amount: 110 },
    { from: 15001, to: 25000, amount: 130 },
    { from: 25001, to: 40000, amount: 150 },
    { from: 40001, to: null, amount: 200 },
  ],
};

export const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
  'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
];

export function starterPayrollSettings(): PayrollSettings {
  return {
    daysBasis: 'CALENDAR',
    attendanceMode: 'LEAVE_ONLY',
    deductLateMarks: false,
    encashmentBase: 'BASIC',
    components: STARTER_COMPONENTS.map((c) => ({ ...c })),
    ctcTemplate: STARTER_CTC_TEMPLATE.map((r) => ({ ...r })),
    pf: { enabled: true, employeePct: 12, employerPct: 12, edliPct: 0.5, adminPct: 0.5, wageCeiling: 15000 },
    esic: { enabled: true, employeePct: 0.75, employerPct: 3.25, wageCeiling: 21000 },
    pt: { enabled: true, defaultState: 'Maharashtra', states: structuredClone(STARTER_PT) },
    company: { legalName: '', address: '' },
  };
}

export function emptyPayrollSettings(): PayrollSettings {
  return { ...starterPayrollSettings(), components: [], ctcTemplate: [] };
}

// ------------------------------------------------------------------ days

export function daysInMonth(month: string): number {
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const payDaysFor = (settings: Pick<PayrollSettings, 'daysBasis'>, month: string) => (settings.daysBasis === 'FIXED_30' ? 30 : daysInMonth(month));

/**
 * Days of pay for the month: the basis minus loss-of-pay days minus days before joining.
 * Never below 0 or above the basis.
 */
export function paidDaysFor(payDays: number, lopDays: number, preJoinDays: number): number {
  return r2(Math.min(payDays, Math.max(0, payDays - lopDays - preJoinDays)));
}

// ------------------------------------------------------------------ CTC split

export interface SplitResult {
  amounts: Record<string, number>;
  /** Anything that could not be honoured, such as a negative balance. */
  warnings: string[];
}

/**
 * Turns an annual fixed pay (CTC) into monthly component amounts using the company's template.
 * Here "CTC" means the gross monthly salary times 12. Employer PF and ESIC are shown separately on top.
 */
export function splitCtc(annualCtc: number, template: CtcTemplateRow[], components: PayComponent[]): SplitResult {
  const warnings: string[] = [];
  const monthly = r2(Math.max(0, annualCtc) / 12);
  const amounts: Record<string, number> = {};
  const known = new Set(components.filter((c) => c.kind === 'EARNING' && c.active).map((c) => c.id));
  const basicId = components.find((c) => c.isBasic)?.id;

  const rows = template.filter((r) => known.has(r.componentId));
  // 1) percent of CTC and fixed amounts, 2) percent of basic, 3) the balancing component.
  for (const r of rows) {
    if (r.mode === 'PERCENT_OF_CTC') amounts[r.componentId] = r2((monthly * r.value) / 100);
    else if (r.mode === 'FIXED') amounts[r.componentId] = r2(r.value);
  }
  for (const r of rows) {
    if (r.mode !== 'PERCENT_OF_BASIC') continue;
    const basic = basicId ? amounts[basicId] || 0 : 0;
    if (!basicId || !(basicId in amounts)) warnings.push('The template needs a basic salary row before a percent-of-basic row.');
    amounts[r.componentId] = r2((basic * r.value) / 100);
  }
  const balance = rows.find((r) => r.mode === 'BALANCE');
  const used = Object.values(amounts).reduce((n, v) => n + v, 0);
  if (balance) {
    const left = r2(monthly - used);
    if (left < 0) warnings.push(`The fixed parts add up to more than the monthly pay by ${Math.abs(left)}.`);
    amounts[balance.componentId] = Math.max(0, left);
  } else if (r2(monthly - used) !== 0) {
    warnings.push(`The template leaves ${r2(monthly - used)} of the monthly pay unallocated. Add a balancing component.`);
  }
  return { amounts, warnings };
}

// ------------------------------------------------------------------ statutory

/** Professional tax for one month. Uses the slabs of the person's state; 0 when none are set. */
export function professionalTax(settings: PayrollSettings, state: string, gender: string | undefined, gross: number, month: string): number {
  if (!settings.pt.enabled) return 0;
  const slabs = settings.pt.states[state] || [];
  if (slabs.length === 0) return 0;
  const female = gender === 'F' && slabs.some((s) => s.gender === 'F');
  const pool = slabs.filter((s) => (female ? s.gender === 'F' : s.gender !== 'F'));
  const slab = pool.find((s) => gross >= s.from && (s.to === null || gross <= s.to));
  if (!slab) return 0;
  const feb = month.slice(5, 7) === '02';
  return rInt(feb && slab.febAmount !== undefined ? slab.febAmount : slab.amount);
}

// ------------------------------------------------------------------ one employee, one month

export function calculateLine(i: LineInput): PayrollLine {
  const { settings: s, structure: st } = i;
  const warnings: string[] = [];
  let blocking = false;
  const payDays = i.payDays > 0 ? i.payDays : payDaysFor(s, i.month);
  const paidDays = Math.max(0, Math.min(payDays, i.paidDays));
  const factor = payDays > 0 ? paidDays / payDays : 0;

  const earningsDef = s.components.filter((c) => c.kind === 'EARNING' && c.active);
  const deductionsDef = s.components.filter((c) => c.kind === 'DEDUCTION' && c.active);

  const earnings: LineAmount[] = earningsDef
    .filter((c) => (st.amounts[c.id] || 0) !== 0)
    .map((c) => {
      const full = r2(st.amounts[c.id] || 0);
      return { id: c.id, code: c.code, name: c.name, full, amount: r2(c.prorate ? full * factor : full) };
    });
  const deductions: LineAmount[] = deductionsDef
    .filter((c) => (st.amounts[c.id] || 0) !== 0)
    .map((c) => {
      const full = r2(st.amounts[c.id] || 0);
      return { id: c.id, code: c.code, name: c.name, full, amount: paidDays > 0 ? full : 0 };
    });

  const sumOf = (rows: LineAmount[], pick: (c: PayComponent) => boolean, useFull = false) =>
    r2(rows.filter((r) => pick(s.components.find((c) => c.id === r.id)!)).reduce((n, r) => n + (useFull ? r.full : r.amount), 0));

  // leave encashment
  const baseFull = s.encashmentBase === 'BASIC' ? sumOf(earnings, (c) => !!c.isBasic, true) : sumOf(earnings, () => true, true);
  const perDay = r2(baseFull / 30);
  const encash = { days: r2(i.encashDays), perDay, amount: r2(i.encashDays * perDay) };
  if (i.encashDays > 0 && baseFull === 0) warnings.push('Leave encashment could not be valued: the salary has no basic or earnings.');

  const adjEarn = i.adjustments.filter((a) => a.kind === 'EARNING').reduce((n, a) => n + a.amount, 0);
  const adjDed = i.adjustments.filter((a) => a.kind === 'DEDUCTION').reduce((n, a) => n + a.amount, 0);
  const gross = r2(earnings.reduce((n, e) => n + e.amount, 0) + encash.amount + adjEarn);

  // PF
  const pfWage = sumOf(earnings, (c) => c.pfWage);
  let pfEmployee = 0, pfEmployer = 0, edli = 0, pfAdmin = 0;
  if (s.pf.enabled && st.pfApplicable && pfWage > 0) {
    const wage = st.pfOnActualWage ? pfWage : Math.min(pfWage, s.pf.wageCeiling);
    pfEmployee = rInt((wage * s.pf.employeePct) / 100);
    pfEmployer = rInt((wage * s.pf.employerPct) / 100);
    edli = rInt((Math.min(wage, s.pf.wageCeiling) * s.pf.edliPct) / 100);
    pfAdmin = rInt((wage * s.pf.adminPct) / 100);
  }

  // ESIC: eligibility is decided on the full monthly wage so it does not flicker with loss of pay
  const esicWageFull = sumOf(earnings, (c) => c.esicWage, true);
  const esicWage = sumOf(earnings, (c) => c.esicWage);
  let esicEmployee = 0, esicEmployer = 0;
  if (s.esic.enabled && st.esicApplicable && esicWageFull > 0 && esicWageFull <= s.esic.wageCeiling) {
    esicEmployee = ceilInt((esicWage * s.esic.employeePct) / 100);
    esicEmployer = ceilInt((esicWage * s.esic.employerPct) / 100);
  }

  // professional tax on the month's gross
  const pt = paidDays > 0 ? professionalTax(s, st.state || s.pt.defaultState, st.gender, gross, i.month) : 0;
  if (s.pt.enabled && paidDays > 0 && (s.pt.states[st.state || s.pt.defaultState] || []).length === 0) {
    warnings.push(`No professional tax slabs are set for ${st.state || s.pt.defaultState || 'this state'}; PT is 0.`);
  }

  const loanTotal = r2(i.loanRecoveries.reduce((n, l) => n + l.amount, 0));
  const componentDed = r2(deductions.reduce((n, d) => n + d.amount, 0));
  const totalDeductions = r2(componentDed + pfEmployee + esicEmployee + pt + adjDed + loanTotal);
  const rawNet = r2(gross - totalDeductions);
  const net = Math.max(0, rawNet);
  const shortfall = rawNet < 0 ? r2(-rawNet) : 0;

  if (paidDays === 0) warnings.push('No paid days this month: nothing is payable.');
  if (shortfall > 0) {
    warnings.push(`Deductions exceed pay by ${shortfall}. Reduce a deduction, loan recovery or adjustment before approving.`);
    blocking = true;
  }
  if (earnings.length === 0 && adjEarn === 0) {
    warnings.push('The salary structure has no earnings.');
    blocking = true;
  }

  return {
    paidDays, payDays, earnings, deductions, adjustments: i.adjustments, encashment: encash, loans: i.loanRecoveries,
    statutory: { pfWage, pfEmployee, pfEmployer, edli, pfAdmin, esicWage, esicEmployee, esicEmployer, pt },
    gross, totalDeductions, net, employerCost: r2(gross + pfEmployer + edli + pfAdmin + esicEmployer), shortfall, warnings, blocking,
  };
}

// ------------------------------------------------------------------ totals

export interface RunTotals {
  headcount: number;
  gross: number;
  deductions: number;
  net: number;
  pfEmployee: number;
  pfEmployer: number;
  esicEmployee: number;
  esicEmployer: number;
  pt: number;
  employerCost: number;
}

export function totalsOf(lines: Pick<PayrollLine, 'gross' | 'totalDeductions' | 'net' | 'employerCost' | 'statutory'>[]): RunTotals {
  const t: RunTotals = { headcount: lines.length, gross: 0, deductions: 0, net: 0, pfEmployee: 0, pfEmployer: 0, esicEmployee: 0, esicEmployer: 0, pt: 0, employerCost: 0 };
  for (const l of lines) {
    t.gross += l.gross; t.deductions += l.totalDeductions; t.net += l.net; t.employerCost += l.employerCost;
    t.pfEmployee += l.statutory.pfEmployee; t.pfEmployer += l.statutory.pfEmployer;
    t.esicEmployee += l.statutory.esicEmployee; t.esicEmployer += l.statutory.esicEmployer; t.pt += l.statutory.pt;
  }
  (Object.keys(t) as (keyof RunTotals)[]).forEach((k) => { t[k] = r2(t[k]); });
  return t;
}

export const maskAccount = (v: string) => (v.length <= 4 ? v : `${'X'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`);
