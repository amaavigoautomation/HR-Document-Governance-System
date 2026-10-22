import assert from 'node:assert/strict';
import {
  cycleOf, countLeaveDays, plannedCredits, rollover, entitledMonths, approvalSteps, computeDayStatus,
  summarizeMonth, istToInstant, istParts, isWeeklyOff, dayKind, starterSettings, DEFAULT_SHIFT, previousCycle,
} from '../shared/leaveEngine.ts';

// leave year
assert.deepEqual(cycleOf('2026-10-22', 4), { key: '2026', start: '2026-04-01', end: '2027-03-31', label: 'FY 2026-27' });
assert.equal(cycleOf('2027-02-10', 4).key, '2026');
assert.deepEqual(cycleOf('2026-10-22', 1), { key: '2026', start: '2026-01-01', end: '2026-12-31', label: '2026' });
assert.equal(cycleOf('2026-10-22', 9).label, 'FY 2026-27'.replace('27', '27'));
assert.equal(cycleOf('2026-10-22', 9).end, '2027-08-31');
assert.equal(previousCycle(cycleOf('2026-10-22', 4), 4).key, '2025');

// weekly offs: Sundays + 2nd and 4th Saturday
const loc = { weeklyOff: { '0': 'ALL' as const, '6': [2, 4] }, holidays: [{ date: '2026-10-02', name: 'Gandhi Jayanti' }, { date: '2026-10-20', name: 'Optional', optional: true }] };
assert.ok(isWeeklyOff('2026-10-11', loc.weeklyOff)); // Sunday
assert.ok(isWeeklyOff('2026-10-10', loc.weeklyOff)); // 2nd Saturday
assert.ok(!isWeeklyOff('2026-10-03', loc.weeklyOff)); // 1st Saturday
assert.equal(dayKind('2026-10-02', loc), 'HOLIDAY');
assert.equal(dayKind('2026-10-20', loc), 'WORK'); // optional holiday is a working day

// day counting: Mon 12 Oct to Mon 19 Oct 2026 (Sat 17 is the 3rd Saturday, Sun 18 off)
let c = countLeaveDays({ from: '2026-10-12', to: '2026-10-19', loc, dayCounting: 'WORKING', sandwich: false });
assert.equal(c.days, 7); // Sat 17 is a working day here; only Sun 18 is off
c = countLeaveDays({ from: '2026-10-09', to: '2026-10-12', loc, dayCounting: 'WORKING', sandwich: false });
assert.equal(c.days, 2); // Fri + Mon; 2nd Sat and Sun are off
c = countLeaveDays({ from: '2026-10-09', to: '2026-10-12', loc, dayCounting: 'WORKING', sandwich: true });
assert.equal(c.days, 4); // sandwich counts the weekend between
c = countLeaveDays({ from: '2026-10-14', to: '2026-10-14', halfFrom: true, loc, dayCounting: 'WORKING', sandwich: false });
assert.equal(c.days, 0.5);
c = countLeaveDays({ from: '2026-10-01', to: '2026-10-03', loc, dayCounting: 'CALENDAR', sandwich: false });
assert.equal(c.days, 3);
assert.equal(countLeaveDays({ from: '2026-10-05', to: '2026-10-01', loc, dayCounting: 'WORKING', sandwich: false }).days, 0);

// accrual and pro-rating
const cy = cycleOf('2026-10-22', 4);
assert.equal(entitledMonths(cy, '2025-01-01'), 12);
assert.equal(entitledMonths(cy, '2026-10-10'), 6); // Oct..Mar
assert.equal(entitledMonths(cy, '2026-10-20'), 5); // after the 15th: from Nov
assert.equal(entitledMonths(cy, '2027-04-05'), 0);
const monthly = plannedCredits({ typeId: 'cl', quota: 12, accrual: 'MONTHLY', carryForward: false, carryCap: 0 }, cy, '2020-01-01', '2026-10-22');
assert.equal(monthly.length, 7); // Apr..Oct
assert.equal(monthly[0].amount, 1);
assert.equal(monthly[0].period, 'M2026-04');
const upfront = plannedCredits({ typeId: 'sl', quota: 6, accrual: 'UPFRONT', carryForward: false, carryCap: 0 }, cy, '2026-10-10', '2026-10-22');
assert.deepEqual(upfront.map((x) => x.amount), [3]);
const quarterly = plannedCredits({ typeId: 'x', quota: 8, accrual: 'QUARTERLY', carryForward: false, carryCap: 0 }, cy, '2020-01-01', '2026-10-22');
assert.deepEqual(quarterly.map((x) => x.period), ['Q1', 'Q2', 'Q3']);
assert.equal(plannedCredits({ typeId: 'x', quota: 0, accrual: 'MONTHLY', carryForward: false, carryCap: 0 }, cy, undefined, '2026-10-22').length, 0);

// rollover
assert.deepEqual(rollover(10, { carryForward: false, carryCap: 0 }), { carry: 0, lapse: 10 });
assert.deepEqual(rollover(40, { carryForward: true, carryCap: 30 }), { carry: 30, lapse: 10 });
assert.deepEqual(rollover(12, { carryForward: true, carryCap: 0 }), { carry: 12, lapse: 0 });
assert.deepEqual(rollover(-2, { carryForward: false, carryCap: 0 }), { carry: -2, lapse: 0 });

// approval chain
const s = starterSettings(2026);
assert.deepEqual(approvalSteps({ approval: 'MANAGER' }, 2, true, s), ['MANAGER']);
assert.deepEqual(approvalSteps({ approval: 'MANAGER' }, 2, false, s), ['HR']);
assert.deepEqual(approvalSteps({ approval: 'MANAGER_HR' }, 2, true, s), ['MANAGER', 'HR']);
assert.deepEqual(approvalSteps({ approval: 'MANAGER' }, 6, true, { ...s, hrApprovalAboveDays: 5 }), ['MANAGER', 'HR']);

// attendance
assert.equal(istParts(istToInstant('2026-10-22', '09:40')).time, '09:40');
const rec = (a: string, b: string) => ({ checkIn: istToInstant('2026-10-21', a), checkOut: istToInstant('2026-10-21', b) });
const base = { date: '2026-10-21', today: '2026-10-22', loc, shift: DEFAULT_SHIFT };
assert.equal(computeDayStatus({ ...base, record: rec('09:30', '18:30') }).status, 'PRESENT');
assert.equal(computeDayStatus({ ...base, record: rec('09:50', '18:30') }).status, 'LATE');
assert.equal(computeDayStatus({ ...base, record: rec('09:30', '14:00') }).status, 'HALF_DAY');
assert.equal(computeDayStatus({ ...base, record: rec('09:30', '11:00') }).status, 'ABSENT');
assert.equal(computeDayStatus({ ...base, record: null }).status, 'ABSENT');
assert.equal(computeDayStatus({ ...base, record: { checkIn: istToInstant('2026-10-21', '09:30') } }).status, 'INCOMPLETE');
assert.equal(computeDayStatus({ ...base, leaveValue: 1 }).status, 'LEAVE');
assert.equal(computeDayStatus({ ...base, leaveValue: 0.5, record: rec('09:30', '14:00') }).status, 'HALF_LEAVE');
assert.equal(computeDayStatus({ ...base, date: '2026-10-02' }).status, 'HOLIDAY');
assert.equal(computeDayStatus({ ...base, date: '2026-10-26' }).status, 'FUTURE');
assert.equal(computeDayStatus({ ...base, date: '2026-10-22' }).status, 'TODAY');
assert.equal(computeDayStatus({ ...base, joinDate: '2026-10-26' }).status, 'NOT_EMPLOYED');

const sum = summarizeMonth([
  { status: 'PRESENT', workedMinutes: 0, late: false }, { status: 'LATE', workedMinutes: 0, late: true },
  { status: 'LATE', workedMinutes: 0, late: true }, { status: 'LATE', workedMinutes: 0, late: true },
  { status: 'HALF_DAY', workedMinutes: 0, late: false }, { status: 'ABSENT', workedMinutes: 0, late: false },
  { status: 'LEAVE', workedMinutes: 0, late: false },
], 3);
assert.equal(sum.lossOfPayDays, 1.5);
assert.equal(sum.lateDeductionDays, 0.5);
assert.equal(sum.leave, 1);

console.log('leave engine tests passed');

// settings sanitising (what HR saves is clamped and made consistent)
import { sanitizeSettings } from '../api/_lib/leaveApi.ts';
import { parseApplyInput } from '../api/_lib/leaveCore.ts';
const clean = sanitizeSettings({
  yearStartMonth: 99, sandwichRule: 'yes',
  locations: [{ name: 'Pune', weeklyOff: { '0': 'ALL', '6': [2, 4, 9], '8': 'ALL' }, holidays: [{ date: '2026-01-26', name: 'Republic Day' }, { date: '2026-01-26', name: 'dup' }, { date: 'bad', name: 'x' }] }],
  types: [{ name: 'Casual', code: 'cl' }, { name: 'Casual', code: 'cl2' }],
  policies: [{ name: 'Std', entries: [{ typeId: 'cl', quota: 9999, accrual: 'MONTHLY' }, { typeId: 'ghost', quota: 1 }] }],
  notifyEmails: ['hr@x.com', 'nope'], shift: { start: '25:99', halfDayMinutes: 900, fullDayMinutes: 300 },
}, starterSettings(2026));
assert.equal(clean.yearStartMonth, 12);
assert.deepEqual(clean.locations[0].weeklyOff, { '0': 'ALL', '6': [2, 4] });
assert.equal(clean.locations[0].holidays.length, 1);
assert.deepEqual(clean.types.map((t) => t.id), ['cl', 'cl2']);
assert.equal(clean.policies[0].entries.length, 1);
assert.equal(clean.policies[0].entries[0].quota, 400);
assert.ok(clean.policies[0].isDefault);
assert.deepEqual(clean.notifyEmails, ['hr@x.com']);
assert.equal(clean.shift.start, '09:30');
assert.ok(clean.shift.halfDayMinutes <= clean.shift.fullDayMinutes);

assert.throws(() => parseApplyInput({ from: '2026-13-40' }));
assert.throws(() => parseApplyInput({ from: '2026-10-10', to: '2026-10-09' }));
const inp = parseApplyInput({ typeId: 'cl', from: '2026-10-10', halfFrom: true });
assert.equal(inp.to, '2026-10-10');
assert.equal(inp.halfFrom, true);
console.log('leave api helper tests passed');
