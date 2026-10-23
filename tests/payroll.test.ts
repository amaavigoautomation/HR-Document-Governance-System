import assert from 'node:assert/strict';
import {
  calculateLine, daysInMonth, paidDaysFor, payDaysFor, professionalTax, splitCtc, starterPayrollSettings, totalsOf,
  type SalaryStructure,
} from '../shared/payrollEngine.ts';

const s = starterPayrollSettings();
const structure = (amounts: Record<string, number>, over: Partial<SalaryStructure> = {}): SalaryStructure => ({
  amounts, state: 'Maharashtra', gender: 'M', pfApplicable: true, esicApplicable: true, pfOnActualWage: false, ...over,
});
const line = (st: SalaryStructure, month: string, paidDays?: number, extra: any = {}) => {
  const payDays = payDaysFor(s, month);
  return calculateLine({ settings: s, structure: st, month, paidDays: paidDays ?? payDays, payDays, encashDays: 0, adjustments: [], loanRecoveries: [], ...extra });
};

// --- days
assert.equal(daysInMonth('2026-02'), 28);
assert.equal(daysInMonth('2028-02'), 29);
assert.equal(daysInMonth('2026-10'), 31);
assert.equal(paidDaysFor(31, 2.5, 0), 28.5);
assert.equal(paidDaysFor(31, 40, 0), 0, 'never below zero');
assert.equal(paidDaysFor(30, 0, 10), 20, 'days before joining are unpaid');
assert.equal(payDaysFor({ daysBasis: 'FIXED_30' }, '2026-10'), 30);

// --- CTC split: 6,00,000 a year = 50,000 a month
const split = splitCtc(600000, s.ctcTemplate, s.components);
assert.deepEqual(split.warnings, []);
assert.equal(split.amounts.basic, 25000);
assert.equal(split.amounts.hra, 10000);
assert.equal(split.amounts.conveyance, 1600);
assert.equal(split.amounts.special, 13400);
assert.equal(Object.values(split.amounts).reduce((n, v) => n + v, 0), 50000, 'the split adds back to the monthly pay');
const tooSmall = splitCtc(12000, s.ctcTemplate, s.components);
assert.ok(tooSmall.warnings.length > 0, 'a CTC too small for the fixed parts is flagged');

// --- full month, higher earner: PF capped at the ceiling, no ESIC (above 21,000)
const big = line(structure(split.amounts), '2026-10');
assert.equal(big.gross, 50000);
assert.equal(big.statutory.pfWage, 25000);
assert.equal(big.statutory.pfEmployee, 1800, '12% of the 15,000 ceiling');
assert.equal(big.statutory.pfEmployer, 1800);
assert.equal(big.statutory.edli, 75);
assert.equal(big.statutory.pfAdmin, 75);
assert.equal(big.statutory.esicEmployee, 0, 'above the ESIC ceiling');
assert.equal(big.statutory.pt, 200, 'Maharashtra, October');
assert.equal(big.totalDeductions, 2000);
assert.equal(big.net, 48000);
assert.equal(big.employerCost, 50000 + 1800 + 75 + 75);
assert.equal(big.blocking, false);

// PF on actual wage when the person opts in
const actual = line(structure(split.amounts, { pfOnActualWage: true }), '2026-10');
assert.equal(actual.statutory.pfEmployee, 3000);

// February professional tax is higher in Maharashtra
assert.equal(line(structure(split.amounts), '2027-02').statutory.pt, 300);

// --- loss of pay: 3 days of 31 cut from prorated earnings, fixed deductions are not prorated
const lop = line(structure({ ...split.amounts, tds: 1000 }), '2026-10', 28);
assert.equal(lop.earnings.find((e) => e.id === 'basic')!.amount, Math.round((25000 * 28 / 31) * 100) / 100);
assert.equal(lop.deductions.find((d) => d.id === 'tds')!.amount, 1000);
assert.ok(lop.gross < 50000 && lop.gross > 44000);

// --- low earner: ESIC applies and rounds up
const low = line(structure({ basic: 9000, hra: 3000, special: 3000 }), '2026-10');
assert.equal(low.gross, 15000);
assert.equal(low.statutory.esicEmployee, 113, '0.75% of 15,000 = 112.5, rounded up');
assert.equal(low.statutory.esicEmployer, 488, '3.25% of 15,000 = 487.5, rounded up');
assert.equal(low.statutory.pfEmployee, 1080, '12% of basic 9,000');
assert.equal(low.statutory.pt, 200);

// ESIC eligibility follows the full monthly wage, not the prorated one
const lowLop = line(structure({ basic: 15000, hra: 5000, special: 1000 }), '2026-10', 10);
assert.ok(lowLop.statutory.esicEmployee > 0, 'still covered: full wage is 21,000');
const over = line(structure({ basic: 15000, hra: 5000, special: 1001 }), '2026-10', 10);
assert.equal(over.statutory.esicEmployee, 0, 'full wage above 21,000 is never covered');

// --- opt-outs
const optOut = line(structure({ basic: 9000, hra: 3000, special: 3000 }, { pfApplicable: false, esicApplicable: false }), '2026-10');
assert.equal(optOut.statutory.pfEmployee + optOut.statutory.esicEmployee, 0);

// --- professional tax by state and gender
assert.equal(professionalTax(s, 'Maharashtra', 'F', 20000, '2026-10'), 0, 'women are exempt up to 25,000 in the starter slabs');
assert.equal(professionalTax(s, 'Maharashtra', 'F', 30000, '2026-10'), 200);
assert.equal(professionalTax(s, 'Maharashtra', 'M', 8000, '2026-10'), 175);
assert.equal(professionalTax(s, 'Gujarat', 'M', 30000, '2026-10'), 200);
assert.equal(professionalTax(s, 'Delhi', 'M', 30000, '2026-10'), 0, 'no slabs set');
assert.ok(line(structure(split.amounts, { state: 'Delhi' }), '2026-10').warnings.some((w) => w.includes('professional tax')));

// --- leave encashment: 2 days at basic / 30
const enc = line(structure(split.amounts), '2026-10', undefined, { encashDays: 2 });
assert.equal(enc.encashment.perDay, 833.33);
assert.equal(enc.encashment.amount, 1666.66);
assert.equal(enc.gross, 50000 + 1666.66);
assert.equal(enc.statutory.pfWage, 25000, 'encashment is not PF wage');

// --- adjustments and loans
const adj = line(structure(split.amounts), '2026-10', undefined, {
  adjustments: [{ kind: 'EARNING', label: 'Bonus', amount: 5000 }, { kind: 'DEDUCTION', label: 'Advance recovery', amount: 2000 }],
  loanRecoveries: [{ id: 'l1', label: 'Laptop loan', amount: 1500 }],
});
assert.equal(adj.gross, 55000);
assert.equal(adj.totalDeductions, 2000 + 2000 + 1500);
assert.equal(adj.net, 55000 - 5500);

// --- a deduction larger than pay blocks approval and never pays a negative amount
const broke = line(structure({ basic: 5000 }), '2026-10', undefined, { adjustments: [{ kind: 'DEDUCTION', label: 'Recovery', amount: 9000 }] });
assert.equal(broke.net, 0);
assert.ok(broke.shortfall > 0 && broke.blocking);

// --- no paid days
const none = line(structure(split.amounts), '2026-10', 0);
assert.equal(none.gross, 0);
assert.equal(none.net, 0);
assert.equal(none.statutory.pt, 0);

// --- totals
const t = totalsOf([big, low]);
assert.equal(t.headcount, 2);
assert.equal(t.net, big.net + low.net);
assert.equal(t.pfEmployee, 1800 + 1080);

console.log('payroll engine tests passed');
