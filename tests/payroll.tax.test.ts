import assert from 'node:assert/strict';
import { calculateLine, lineFacts, payDaysFor, splitCtc, starterPayrollSettings, totalsOf, type SalaryStructure } from '../shared/payrollEngine.ts';
import { arrearsFor, gratuityFor, noticeFor, serviceOf, settlementTotals } from '../shared/settlementEngine.ts';
import {
  computeAnnualTax, emptyDeclaration, fyLabel, fyMonths, fyStartYear, hraExemption, monthsAfterInFy, projectTds, sanitizeDeclaration, sanitizeTaxSettings,
  slabTax, starterTaxSettings,
} from '../shared/taxEngine.ts';

const ts = starterTaxSettings();
const none = { grossSalary: 0, basicAnnual: 0, hraAnnual: 0, epfAnnual: 0, ptAnnual: 0 };

// ---------------------------------------------------------------- financial year
assert.equal(fyStartYear('2026-03'), 2025);
assert.equal(fyStartYear('2026-04'), 2026);
assert.equal(fyLabel(2026), '2026-27');
assert.deepEqual([fyMonths(2026)[0], fyMonths(2026)[11]], ['2026-04', '2027-03']);
assert.equal(monthsAfterInFy('2026-04'), 11);
assert.equal(monthsAfterInFy('2027-03'), 0);
assert.equal(monthsAfterInFy('2027-01'), 2);

// ---------------------------------------------------------------- slabs and the annual computation
assert.equal(slabTax(1_200_000, ts.new.slabs), 60_000);
assert.equal(slabTax(300_000, ts.new.slabs), 0);
assert.equal(slabTax(2_000_000, ts.new.slabs), 200_000);

// new regime: 12.75 lakh salary is nil after the standard deduction and the 87A rebate
const nil = computeAnnualTax(ts, emptyDeclaration('NEW'), { ...none, grossSalary: 1_275_000 });
assert.equal(nil.taxableIncome, 1_200_000);
assert.equal(nil.totalTax, 0);
// just above the limit: marginal relief caps the tax at the income above 12 lakh (25,000) plus 4% cess
const relief = computeAnnualTax(ts, emptyDeclaration('NEW'), { ...none, grossSalary: 1_300_000 });
assert.equal(relief.taxableIncome, 1_225_000);
assert.equal(relief.marginalRelief, 38_750);
assert.equal(relief.totalTax, 26_000);
// 20 lakh taxable
assert.equal(computeAnnualTax(ts, emptyDeclaration('NEW'), { ...none, grossSalary: 2_075_000 }).totalTax, 208_000);
// the old regime allows 80C, but not the new one
const d80c = { ...emptyDeclaration('OLD'), sec80C: 150_000 };
const old = computeAnnualTax(ts, d80c, { ...none, grossSalary: 1_000_000 });
assert.equal(old.taxableIncome, 800_000);
assert.equal(old.totalTax, 75_400);
assert.equal(computeAnnualTax(ts, { ...d80c, regime: 'NEW' }, { ...none, grossSalary: 1_000_000 }).deductions.sec80C, 0);
// 80C is capped, and PF counts toward it
assert.equal(computeAnnualTax(ts, { ...emptyDeclaration('OLD'), sec80C: 200_000 }, { ...none, grossSalary: 1_000_000 }).deductions.sec80C, 150_000);
assert.equal(computeAnnualTax(ts, { ...emptyDeclaration('OLD'), sec80C: 100_000 }, { ...none, grossSalary: 1_000_000, epfAnnual: 21_600 }).deductions.sec80C, 121_600);
// professional tax is deductible only in the old regime
assert.equal(computeAnnualTax(ts, emptyDeclaration('OLD'), { ...none, grossSalary: 1_000_000, ptAnnual: 2_400 }).professionalTax, 2_400);
assert.equal(computeAnnualTax(ts, emptyDeclaration('NEW'), { ...none, grossSalary: 1_000_000, ptAnnual: 2_400 }).professionalTax, 0);
// earlier employer income counts and so does tax already deducted elsewhere
assert.equal(computeAnnualTax(ts, { ...emptyDeclaration('NEW'), prevIncome: 1_275_000 }, none).taxableIncome, 1_200_000);
// surcharge above 50 lakh
const rich = computeAnnualTax(ts, emptyDeclaration('NEW'), { ...none, grossSalary: 6_075_000 });
assert.equal(rich.taxableIncome, 6_000_000);
assert.ok(rich.surcharge > 0);
// HRA exemption: least of HRA received, rent less 10% of basic, 40% or 50% of basic
assert.equal(hraExemption(240_000, 600_000, 300_000, true), 240_000);
assert.equal(hraExemption(240_000, 600_000, 200_000, false), 140_000);
assert.equal(hraExemption(240_000, 600_000, 0, true), 0);
const withHra = computeAnnualTax(ts, { ...emptyDeclaration('OLD'), rentPaidAnnual: 200_000 }, { ...none, grossSalary: 1_000_000, basicAnnual: 600_000, hraAnnual: 240_000 });
assert.equal(withHra.hraExemption, 140_000);

// ---------------------------------------------------------------- monthly TDS (projection)
const full2 = { gross: 200_000, basic: 100_000, hra: 40_000, epf: 1_800, pt: 200 };
const apr = projectTds({ settings: ts, decl: emptyDeclaration('NEW'), month: '2026-04', paid: { gross: 0, basic: 0, hra: 0, epf: 0, pt: 0, tds: 0 }, current: full2, fullMonth: full2 });
assert.equal(apr.annualTax, 292_500);
assert.equal(apr.monthsLeft, 12);
assert.equal(apr.tds, 24_375);
// halfway through the year, having deducted exactly the right amount so far, the instalment is unchanged
const oct = projectTds({
  settings: ts, decl: emptyDeclaration('NEW'), month: '2026-10', paid: { gross: 1_200_000, basic: 600_000, hra: 240_000, epf: 10_800, pt: 1_200, tds: 146_250 },
  current: full2, fullMonth: full2,
});
assert.equal(oct.monthsLeft, 6);
assert.equal(oct.tds, 24_375);
// a raise mid-year raises the instalment so the year still balances
const raised = projectTds({
  settings: ts, decl: emptyDeclaration('NEW'), month: '2026-10', paid: { gross: 1_200_000, basic: 600_000, hra: 240_000, epf: 10_800, pt: 1_200, tds: 146_250 },
  current: { ...full2, gross: 300_000 }, fullMonth: { ...full2, gross: 300_000 },
});
assert.ok(raised.tds > 24_375);
// tax already deducted at a previous employer reduces what is left
const withPrev = projectTds({ settings: ts, decl: { ...emptyDeclaration('NEW'), prevTds: 50_000 }, month: '2026-04', paid: { gross: 0, basic: 0, hra: 0, epf: 0, pt: 0, tds: 0 }, current: full2, fullMonth: full2 });
assert.equal(withPrev.tds, Math.round((292_500 - 50_000) / 12));
// a final settlement spreads nothing forward
const final = projectTds({ settings: ts, decl: emptyDeclaration('NEW'), month: '2026-10', paid: { gross: 1_200_000, basic: 0, hra: 0, epf: 0, pt: 0, tds: 100_000 }, current: full2, fullMonth: full2, monthsAfter: 0 });
assert.equal(final.monthsLeft, 1);
// no tax, no negative TDS
assert.equal(projectTds({ settings: ts, decl: emptyDeclaration('NEW'), month: '2026-04', paid: { gross: 0, basic: 0, hra: 0, epf: 0, pt: 0, tds: 0 }, current: { gross: 50_000, basic: 25_000, hra: 10_000, epf: 1_800, pt: 200 }, fullMonth: { gross: 50_000, basic: 25_000, hra: 10_000, epf: 1_800, pt: 200 } }).tds, 0);

// declarations and settings are sanitised
const dirty = sanitizeDeclaration({ regime: 'OLD', sec80C: -5, sec80D: '12000', metroCity: 'yes', prevIncome: 'abc' }, 'NEW');
assert.equal(dirty.regime, 'OLD');
assert.equal(dirty.sec80C, 0);
assert.equal(dirty.sec80D, 12_000);
assert.equal(dirty.metroCity, false);
assert.equal(dirty.prevIncome, 0);
assert.equal(sanitizeDeclaration({}, 'OLD').regime, 'OLD');
const cleaned = sanitizeTaxSettings({ mode: 'AUTO', new: { slabs: [{ upTo: 800_000, rate: 5 }, { upTo: 400_000, rate: 0 }] } });
assert.equal(cleaned.mode, 'AUTO');
assert.deepEqual(cleaned.new.slabs, [{ upTo: 400_000, rate: 0 }, { upTo: null, rate: 5 }], 'slabs are sorted and the last one is open ended');
assert.equal(sanitizeTaxSettings({}).mode, 'MANUAL');

// ---------------------------------------------------------------- the payroll line with reimbursements and automatic TDS
const s = starterPayrollSettings();
const split = splitCtc(600_000, s.ctcTemplate, s.components);
const st: SalaryStructure = { amounts: { ...split.amounts, tds: 5_000 }, state: 'Maharashtra', gender: 'M', pfApplicable: true, esicApplicable: true, pfOnActualWage: false };
const month = '2026-10';
const base = { settings: s, structure: st, month, paidDays: 31, payDays: payDaysFor(s, month), encashDays: 0, adjustments: [], loanRecoveries: [] };

const manual = calculateLine(base);
assert.equal(manual.tds, 5_000, 'MANUAL: the TDS component on the salary is deducted');
assert.equal(manual.totalDeductions, 1_800 + 200 + 5_000);

const auto = calculateLine({ ...base, tds: 3_000, reimbursements: [{ id: 'c1', label: 'Travel', amount: 1_200 }] });
assert.equal(auto.tds, 3_000, 'AUTO: the calculated TDS replaces the component');
assert.equal(auto.deductions.filter((d) => d.code === 'TDS').length, 1);
assert.equal(auto.gross, 50_000, 'reimbursements are not part of gross');
assert.equal(auto.statutory.pt, 200, 'professional tax ignores reimbursements');
assert.equal(auto.totalDeductions, 1_800 + 200 + 3_000);
assert.equal(auto.reimbursementTotal, 1_200);
assert.equal(auto.net, 50_000 + 1_200 - 5_000);
assert.equal(auto.employerCost, 50_000 + 1_200 + 1_800 + 75 + 75);
assert.equal(calculateLine({ ...base, tds: 0 }).tds, 0);
assert.equal(calculateLine({ ...base, tds: 3_000, paidDays: 0 }).tds, 0, 'no pay, no TDS');

const f = lineFacts(auto, s.components);
assert.deepEqual([f.gross, f.basic, f.hra, f.epf, f.pt, f.tds], [50_000, 25_000, 10_000, 1_800, 200, 3_000]);
// older stored lines have no tds field: fall back to the TDS deduction
const legacy = { ...manual } as any;
delete legacy.tds;
assert.equal(lineFacts(legacy, s.components).tds, 5_000);
const totals = totalsOf([auto, manual]);
assert.equal(totals.reimbursements, 1_200);
assert.equal(totals.tds, 8_000);

// ---------------------------------------------------------------- salary revision arrears
const comps = s.components;
const paidMonths = [
  { month: '2026-04', payDays: 30, paidDays: 30, oldEarnings: { basic: 25_000, hra: 10_000, special: 13_400, conveyance: 1_600 } },
  { month: '2026-05', payDays: 31, paidDays: 31, oldEarnings: { basic: 25_000, hra: 10_000, special: 13_400, conveyance: 1_600 } },
  { month: '2026-06', payDays: 30, paidDays: 15, oldEarnings: { basic: 25_000, hra: 10_000, special: 13_400, conveyance: 1_600 } },
];
const arrears = arrearsFor({ basic: 30_000, hra: 12_000, special: 13_400, conveyance: 1_600 }, comps, paidMonths);
assert.deepEqual(arrears.months, [{ month: '2026-04', amount: 7_000 }, { month: '2026-05', amount: 7_000 }, { month: '2026-06', amount: 3_500 }]);
assert.equal(arrears.total, 17_500);
assert.equal(arrearsFor({ basic: 25_000, hra: 10_000, special: 13_400, conveyance: 1_600 }, comps, paidMonths).total, 0, 'no change, no arrears');
assert.equal(arrearsFor({ basic: 20_000, hra: 10_000, special: 13_400, conveyance: 1_600 }, comps, paidMonths.slice(0, 1)).total, -5_000, 'a pay cut gives negative arrears');

// ---------------------------------------------------------------- service, gratuity, notice
assert.equal(serviceOf('2020-01-01', '2025-06-30').years, 5);
assert.equal(serviceOf('2020-01-01', '2025-07-15').years, 6, 'over six months in the last year rounds up');
assert.equal(serviceOf('2020-01-01', '2025-12-31').years, 6);
assert.equal(serviceOf('2020-01-31', '2020-03-30').months, 2);
assert.equal(serviceOf('2025-01-01', '2024-01-01').years, 0);
const g = s.gratuity;
const six = gratuityFor({ settings: g, joinDate: '2020-01-01', lastDay: '2025-12-31', lastWage: 30_000 });
assert.equal(six.eligible, true);
assert.equal(six.amount, 103_846.15);
const three = gratuityFor({ settings: g, joinDate: '2023-01-01', lastDay: '2025-12-31', lastWage: 30_000 });
assert.equal(three.eligible, false);
assert.equal(three.amount, 0);
const death = gratuityFor({ settings: g, joinDate: '2023-01-01', lastDay: '2025-12-31', lastWage: 30_000, forceEligible: true });
assert.equal(death.eligible, true);
assert.equal(death.amount, 51_923.08, '3 years x 15/26 x 30,000');
assert.equal(gratuityFor({ settings: g, joinDate: '1990-01-01', lastDay: '2025-12-31', lastWage: 1_000_000 }).amount, 2_000_000, 'capped');
assert.equal(gratuityFor({ settings: { ...g, enabled: false }, joinDate: '2020-01-01', lastDay: '2025-12-31', lastWage: 30_000 }).eligible, false);
assert.equal(gratuityFor({ settings: g, joinDate: '', lastDay: '2025-12-31', lastWage: 30_000 }).eligible, false);

const n = noticeFor({ requiredDays: 30, servedDays: 10, monthlyGross: 60_000, recover: true });
assert.deepEqual([n.shortfallDays, n.perDay, n.recovery], [20, 2_000, 40_000]);
assert.equal(noticeFor({ requiredDays: 30, servedDays: 10, monthlyGross: 60_000, recover: false }).recovery, 0);
assert.equal(noticeFor({ requiredDays: 30, servedDays: 45, monthlyGross: 60_000, recover: true }).recovery, 0);

const tot = settlementTotals({ gross: 40_000, totalDeductions: 5_000, reimbursementTotal: 1_000 }, 100_000, 10_000, 2_000);
assert.equal(tot.net, 40_000 + 1_000 + 100_000 - 5_000 - 10_000 - 2_000);
assert.equal(tot.recoverable, 0);
const owes = settlementTotals({ gross: 10_000, totalDeductions: 5_000, reimbursementTotal: 0 }, 0, 20_000, 0);
assert.equal(owes.net, -15_000);
assert.equal(owes.payable, 0);
assert.equal(owes.recoverable, 15_000);

console.log('payroll tax and settlement engine tests passed');
