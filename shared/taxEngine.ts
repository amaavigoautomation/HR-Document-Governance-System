/**
 * Income tax on salary (TDS): pure functions, no database, no clock.
 *
 * Method: the employer estimates the whole financial year's taxable salary (what was already paid this
 * year + this month + the current salary for the months still to come), works out the year's tax under
 * the employee's chosen regime, subtracts the tax already deducted, and spreads the rest over the
 * remaining months.
 *
 * Every rate, slab and limit below is a STARTER VALUE for FY 2026-27 and is editable in the payroll setup.
 * They change with each Budget, so a CA must confirm them. Not handled: senior citizen slabs, surcharge
 * marginal relief, capital gains or house property income other than the home loan interest line,
 * perquisites, and exemptions other than HRA.
 */

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const rInt = (n: number) => Math.round(n + 1e-9);
const nz = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : 0);

export type Regime = 'NEW' | 'OLD';

export interface TaxSlab {
  /** Upper limit of this slab in rupees; null = no limit. */
  upTo: number | null;
  /** Rate in percent. */
  rate: number;
}

export interface RegimeConfig {
  slabs: TaxSlab[];
  standardDeduction: number;
  /** Section 87A rebate: no tax if taxable income is up to the limit (the rebate is capped at maxRebate). */
  rebate: { incomeLimit: number; maxRebate: number };
  /** Just above the rebate limit, tax is capped so that it never exceeds the income above the limit. */
  marginalRelief: boolean;
}

export interface TaxSettings {
  /** MANUAL: TDS is a fixed deduction typed on each salary. AUTO: it is calculated every month. */
  mode: 'MANUAL' | 'AUTO';
  defaultRegime: Regime;
  cessPct: number;
  surcharge: { above: number; rateNew: number; rateOld: number }[];
  new: RegimeConfig;
  old: RegimeConfig;
  limits: {
    sec80C: number;
    sec80D: number;
    sec80CCD1B: number;
    homeLoanInterest: number;
    /** Employer NPS contribution, as a percent of basic: allowed in both regimes. */
    nps80CCD2PctNew: number;
    nps80CCD2PctOld: number;
  };
}

export interface TaxDeclaration {
  regime: Regime;
  /** LIC, ELSS, PPF, tuition fees and similar. The employee's own PF is added automatically. */
  sec80C: number;
  sec80D: number;
  sec80CCD1B: number;
  /** Employer contribution to NPS. */
  nps80CCD2: number;
  homeLoanInterest: number;
  rentPaidAnnual: number;
  metroCity: boolean;
  otherDeductions: number;
  otherIncome: number;
  /** Taxable salary earned this year outside this system (a previous employer, or months before payroll started here). */
  prevIncome: number;
  /** Tax already deducted on that income. */
  prevTds: number;
}

export const emptyDeclaration = (regime: Regime = 'NEW'): TaxDeclaration => ({
  regime, sec80C: 0, sec80D: 0, sec80CCD1B: 0, nps80CCD2: 0, homeLoanInterest: 0, rentPaidAnnual: 0, metroCity: false,
  otherDeductions: 0, otherIncome: 0, prevIncome: 0, prevTds: 0,
});

export function sanitizeDeclaration(raw: any, dflt: Regime): TaxDeclaration {
  const n = (v: unknown) => Math.min(100_000_000, r2(nz(v)));
  return {
    regime: raw?.regime === 'OLD' ? 'OLD' : raw?.regime === 'NEW' ? 'NEW' : dflt,
    sec80C: n(raw?.sec80C), sec80D: n(raw?.sec80D), sec80CCD1B: n(raw?.sec80CCD1B), nps80CCD2: n(raw?.nps80CCD2),
    homeLoanInterest: n(raw?.homeLoanInterest), rentPaidAnnual: n(raw?.rentPaidAnnual), metroCity: raw?.metroCity === true,
    otherDeductions: n(raw?.otherDeductions), otherIncome: n(raw?.otherIncome), prevIncome: n(raw?.prevIncome), prevTds: n(raw?.prevTds),
  };
}

export function starterTaxSettings(): TaxSettings {
  return {
    mode: 'MANUAL',
    defaultRegime: 'NEW',
    cessPct: 4,
    surcharge: [
      { above: 5_000_000, rateNew: 10, rateOld: 10 },
      { above: 10_000_000, rateNew: 15, rateOld: 15 },
      { above: 20_000_000, rateNew: 25, rateOld: 25 },
      { above: 50_000_000, rateNew: 25, rateOld: 37 },
    ],
    new: {
      slabs: [
        { upTo: 400_000, rate: 0 }, { upTo: 800_000, rate: 5 }, { upTo: 1_200_000, rate: 10 }, { upTo: 1_600_000, rate: 15 },
        { upTo: 2_000_000, rate: 20 }, { upTo: 2_400_000, rate: 25 }, { upTo: null, rate: 30 },
      ],
      standardDeduction: 75_000,
      rebate: { incomeLimit: 1_200_000, maxRebate: 60_000 },
      marginalRelief: true,
    },
    old: {
      slabs: [{ upTo: 250_000, rate: 0 }, { upTo: 500_000, rate: 5 }, { upTo: 1_000_000, rate: 20 }, { upTo: null, rate: 30 }],
      standardDeduction: 50_000,
      rebate: { incomeLimit: 500_000, maxRebate: 12_500 },
      marginalRelief: false,
    },
    limits: { sec80C: 150_000, sec80D: 100_000, sec80CCD1B: 50_000, homeLoanInterest: 200_000, nps80CCD2PctNew: 14, nps80CCD2PctOld: 10 },
  };
}

// ------------------------------------------------------------------ financial year helpers

/** April to March. 2026-05 and 2027-02 are both in the year that starts in 2026. */
export const fyStartYear = (month: string) => {
  const y = parseInt(month.slice(0, 4), 10);
  return parseInt(month.slice(5, 7), 10) >= 4 ? y : y - 1;
};
export const fyLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
export const fyMonths = (startYear: number): string[] =>
  Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? startYear : startYear + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
  });
/** Months of the year after this one (March has none). */
export const monthsAfterInFy = (month: string) => 11 - fyMonths(fyStartYear(month)).indexOf(month);

// ------------------------------------------------------------------ the annual computation

export interface AnnualFigures {
  /** Taxable salary for the whole year: paid so far plus estimated for the rest, excluding earlier-employer income. */
  grossSalary: number;
  /** Basic plus dearness allowance for the year (for HRA exemption and employer NPS). */
  basicAnnual: number;
  hraAnnual: number;
  /** The employee's own PF for the year (counts under 80C in the old regime). */
  epfAnnual: number;
  ptAnnual: number;
}

export interface TaxComputation {
  regime: Regime;
  grossSalary: number;
  prevIncome: number;
  otherIncome: number;
  hraExemption: number;
  standardDeduction: number;
  professionalTax: number;
  deductions: { sec80C: number; sec80D: number; sec80CCD1B: number; nps80CCD2: number; homeLoanInterest: number; other: number; total: number };
  taxableIncome: number;
  taxOnIncome: number;
  rebate: number;
  marginalRelief: number;
  surcharge: number;
  cess: number;
  totalTax: number;
}

export function slabTax(taxable: number, slabs: TaxSlab[]): number {
  let tax = 0;
  let from = 0;
  for (const s of slabs) {
    const to = s.upTo === null ? Infinity : s.upTo;
    if (taxable > from) tax += (Math.min(taxable, to) - from) * (s.rate / 100);
    if (taxable <= to) break;
    from = to;
  }
  return r2(tax);
}

export function hraExemption(hraReceived: number, basic: number, rentPaid: number, metro: boolean): number {
  if (hraReceived <= 0 || rentPaid <= 0) return 0;
  return r2(Math.max(0, Math.min(hraReceived, rentPaid - 0.1 * basic, (metro ? 0.5 : 0.4) * basic)));
}

export function computeAnnualTax(s: TaxSettings, decl: TaxDeclaration, f: AnnualFigures, regime: Regime = decl.regime): TaxComputation {
  const cfg = regime === 'OLD' ? s.old : s.new;
  const old = regime === 'OLD';
  const hra = old ? hraExemption(f.hraAnnual, f.basicAnnual, decl.rentPaidAnnual, decl.metroCity) : 0;
  const stdDed = Math.min(cfg.standardDeduction, nz(f.grossSalary) + nz(decl.prevIncome));
  const pt = old ? nz(f.ptAnnual) : 0;
  const npsCap = (f.basicAnnual * (old ? s.limits.nps80CCD2PctOld : s.limits.nps80CCD2PctNew)) / 100;
  const ded = {
    sec80C: old ? Math.min(s.limits.sec80C, nz(decl.sec80C) + nz(f.epfAnnual)) : 0,
    sec80D: old ? Math.min(s.limits.sec80D, nz(decl.sec80D)) : 0,
    sec80CCD1B: old ? Math.min(s.limits.sec80CCD1B, nz(decl.sec80CCD1B)) : 0,
    nps80CCD2: Math.min(nz(decl.nps80CCD2), npsCap),
    homeLoanInterest: old ? Math.min(s.limits.homeLoanInterest, nz(decl.homeLoanInterest)) : 0,
    other: old ? nz(decl.otherDeductions) : 0,
    total: 0,
  };
  ded.total = r2(ded.sec80C + ded.sec80D + ded.sec80CCD1B + ded.nps80CCD2 + ded.homeLoanInterest + ded.other);

  const income = nz(f.grossSalary) + nz(decl.prevIncome) + nz(decl.otherIncome);
  const taxable = Math.max(0, r2(income - hra - stdDed - pt - ded.total));
  let tax = slabTax(taxable, cfg.slabs);
  let rebate = 0;
  let relief = 0;
  if (taxable <= cfg.rebate.incomeLimit) {
    rebate = Math.min(tax, cfg.rebate.maxRebate);
  } else if (cfg.marginalRelief) {
    const cap = taxable - cfg.rebate.incomeLimit;
    if (tax > cap) relief = r2(tax - cap);
  }
  const afterRebate = r2(tax - rebate - relief);
  let rate = 0;
  for (const band of s.surcharge) if (taxable > band.above) rate = old ? band.rateOld : band.rateNew;
  const surcharge = r2((afterRebate * rate) / 100);
  const cess = r2(((afterRebate + surcharge) * s.cessPct) / 100);
  return {
    regime, grossSalary: r2(f.grossSalary), prevIncome: r2(decl.prevIncome), otherIncome: r2(decl.otherIncome), hraExemption: hra,
    standardDeduction: stdDed, professionalTax: pt, deductions: ded, taxableIncome: taxable, taxOnIncome: tax, rebate, marginalRelief: relief,
    surcharge, cess, totalTax: rInt(afterRebate + surcharge + cess),
  };
}

// ------------------------------------------------------------------ monthly TDS

export interface MonthFacts {
  gross: number;
  basic: number;
  hra: number;
  epf: number;
  pt: number;
}

export interface ProjectionInput {
  settings: TaxSettings;
  decl: TaxDeclaration;
  month: string;
  /** Totals of the months already paid this year (locked or paid payroll). */
  paid: MonthFacts & { tds: number };
  /** This month as calculated. */
  current: MonthFacts;
  /** A full month at the current salary, used for the months still to come. */
  fullMonth: MonthFacts;
  /** Override the number of months still to come (0 for a final settlement). */
  monthsAfter?: number;
}

export interface TdsResult {
  regime: Regime;
  tds: number;
  annualTax: number;
  taxDeductedSoFar: number;
  monthsLeft: number;
  taxableIncome: number;
  computation: TaxComputation;
}

export function projectTds(p: ProjectionInput): TdsResult {
  const after = p.monthsAfter ?? monthsAfterInFy(p.month);
  const sum = (k: keyof MonthFacts) => r2(p.paid[k] + p.current[k] + p.fullMonth[k] * after);
  const figures: AnnualFigures = { grossSalary: sum('gross'), basicAnnual: sum('basic'), hraAnnual: sum('hra'), epfAnnual: sum('epf'), ptAnnual: sum('pt') };
  const computation = computeAnnualTax(p.settings, p.decl, figures);
  const soFar = r2(p.paid.tds + nz(p.decl.prevTds));
  const monthsLeft = 1 + after;
  const remaining = Math.max(0, computation.totalTax - soFar);
  return {
    regime: computation.regime, tds: rInt(remaining / monthsLeft), annualTax: computation.totalTax, taxDeductedSoFar: soFar, monthsLeft,
    taxableIncome: computation.taxableIncome, computation,
  };
}

export function sanitizeTaxSettings(input: any): TaxSettings {
  const base = starterTaxSettings();
  const num = (v: unknown, dflt: number, max = 1_000_000_000) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : dflt;
  };
  const regime = (raw: any, dflt: RegimeConfig): RegimeConfig => {
    const slabs: TaxSlab[] = (Array.isArray(raw?.slabs) ? raw.slabs : dflt.slabs).slice(0, 12).map((s: any) => ({
      upTo: s?.upTo === null || s?.upTo === '' || s?.upTo === undefined ? null : num(s.upTo, 0), rate: num(s?.rate, 0, 100),
    }));
    // keep the slabs in order and make the last one open-ended
    slabs.sort((a, b) => (a.upTo === null ? Infinity : a.upTo) - (b.upTo === null ? Infinity : b.upTo));
    if (slabs.length === 0) slabs.push({ upTo: null, rate: 0 });
    slabs[slabs.length - 1].upTo = null;
    return {
      slabs, standardDeduction: num(raw?.standardDeduction, dflt.standardDeduction),
      rebate: { incomeLimit: num(raw?.rebate?.incomeLimit, dflt.rebate.incomeLimit), maxRebate: num(raw?.rebate?.maxRebate, dflt.rebate.maxRebate) },
      marginalRelief: raw?.marginalRelief === undefined ? dflt.marginalRelief : raw.marginalRelief === true,
    };
  };
  const l = input?.limits || {};
  return {
    mode: input?.mode === 'AUTO' ? 'AUTO' : 'MANUAL',
    defaultRegime: input?.defaultRegime === 'OLD' ? 'OLD' : 'NEW',
    cessPct: num(input?.cessPct, base.cessPct, 100),
    surcharge: (Array.isArray(input?.surcharge) ? input.surcharge : base.surcharge).slice(0, 8)
      .map((b: any) => ({ above: num(b?.above, 0), rateNew: num(b?.rateNew, 0, 100), rateOld: num(b?.rateOld, 0, 100) }))
      .sort((a: any, b: any) => a.above - b.above),
    new: regime(input?.new, base.new),
    old: regime(input?.old, base.old),
    limits: {
      sec80C: num(l.sec80C, base.limits.sec80C), sec80D: num(l.sec80D, base.limits.sec80D), sec80CCD1B: num(l.sec80CCD1B, base.limits.sec80CCD1B),
      homeLoanInterest: num(l.homeLoanInterest, base.limits.homeLoanInterest), nps80CCD2PctNew: num(l.nps80CCD2PctNew, base.limits.nps80CCD2PctNew, 100),
      nps80CCD2PctOld: num(l.nps80CCD2PctOld, base.limits.nps80CCD2PctOld, 100),
    },
  };
}
