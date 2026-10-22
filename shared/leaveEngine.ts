/**
 * Leave and attendance engine: pure functions, no browser or Node imports, so the API, the screens and the
 * tests all use the same rules. Dates are 'YYYY-MM-DD' strings in the company's local calendar (India, IST).
 */

// ------------------------------------------------------------------ types

export type Accrual = 'NONE' | 'UPFRONT' | 'MONTHLY' | 'QUARTERLY';
export type ApprovalFlow = 'MANAGER' | 'MANAGER_HR' | 'HR';
export type DayCounting = 'WORKING' | 'CALENDAR';

export interface Holiday {
  date: string;
  name: string;
  /** Restricted / optional holiday: working day unless the employee chooses to take it. */
  optional?: boolean;
}

/** Weekly offs: weekday (0 = Sunday ... 6 = Saturday) -> 'ALL' or the weeks of the month that are off (e.g. [2, 4]). */
export type WeeklyOff = Record<string, 'ALL' | number[]>;

export interface LeaveLocation {
  id: string;
  name: string;
  weeklyOff: WeeklyOff;
  holidays: Holiday[];
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  active: boolean;
  /** Loss of pay: needs no balance, never blocks. */
  isLop?: boolean;
  /** When false the type has no balance (e.g. maternity, bereavement) and is only capped per request. */
  requiresBalance: boolean;
  halfDay: boolean;
  dayCounting: DayCounting;
  minNoticeDays: number;
  maxDaysPerRequest: number; // 0 = no limit
  /** A supporting document is required when the request is longer than this many days (0 = never). */
  docRequiredAfterDays: number;
  gender: 'ANY' | 'F' | 'M';
  minServiceDays: number;
  allowNegative: boolean;
  approval: ApprovalFlow;
  /** Overrides the company leave-year start month for this type (1-12). */
  startMonth?: number;
  color?: string;
}

export interface PolicyEntry {
  typeId: string;
  quota: number;
  accrual: Accrual;
  carryForward: boolean;
  /** Maximum days carried into the next year (0 with carryForward = no cap). */
  carryCap: number;
}

export interface LeavePolicy {
  id: string;
  name: string;
  isDefault?: boolean;
  entries: PolicyEntry[];
}

export interface Shift {
  start: string; // 'HH:MM'
  end: string;
  graceMinutes: number;
  /** Worked minutes for a full day / for a half day. */
  fullDayMinutes: number;
  halfDayMinutes: number;
}

export interface LeaveSettings {
  yearStartMonth: number; // 1 = calendar year, 4 = financial year
  sandwichRule: boolean;
  locations: LeaveLocation[];
  types: LeaveType[];
  policies: LeavePolicy[];
  shift: Shift;
  /** Every N late marks in a month suggests a half-day deduction (0 = off). */
  lateMarksPerHalfDay: number;
  /** Browser check-in is only accepted from these IPs / prefixes when the list is not empty. */
  allowedIps: string[];
  /** Pending requests older than this many days are escalated to HR (0 = never). */
  escalateAfterDays: number;
  /** Requests longer than this add an HR approval step (0 = never). */
  hrApprovalAboveDays: number;
  /** HR mailboxes told about requests that need HR approval and escalations. */
  notifyEmails: string[];
}

// ------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fmtDate(new Date(toUtc(iso).getTime() + n * DAY_MS));
export const weekday = (iso: string) => toUtc(iso).getUTCDay();
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
export const monthKey = (iso: string) => iso.slice(0, 7);
export const lastDayOfMonth = (year: number, month: number) => fmtDate(new Date(Date.UTC(year, month, 0)));

/** Today's date in India (IST), independent of the server's time zone. */
export function istToday(now = Date.now()): string {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Date and 'HH:MM' of an instant, in IST. */
export function istParts(isoInstant: string): { date: string; time: string; minutes: number } {
  const d = new Date(new Date(isoInstant).getTime() + 5.5 * 3600_000);
  const time = d.toISOString().slice(11, 16);
  return { date: d.toISOString().slice(0, 10), time, minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** 'YYYY-MM-DD' + 'HH:MM' in IST -> ISO instant. */
export function istToInstant(date: string, time: string): string {
  return new Date(new Date(`${date}T${time}:00Z`).getTime() - 5.5 * 3600_000).toISOString();
}

export const timeToMinutes = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  return h < 24 && min < 60 ? h * 60 + min : NaN;
};

// ------------------------------------------------------------------ leave year

export interface Cycle {
  /** Year the cycle starts in, as text (a calendar year or the first year of a financial year). */
  key: string;
  start: string;
  end: string;
  label: string;
}

export function cycleOf(date: string, startMonth: number): Cycle {
  const sm = Math.min(12, Math.max(1, Math.floor(startMonth || 1)));
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(5, 7), 10);
  const sy = m >= sm ? y : y - 1;
  const start = `${sy}-${String(sm).padStart(2, '0')}-01`;
  const endY = sm === 1 ? sy : sy + 1;
  const endM = sm === 1 ? 12 : sm - 1;
  const end = lastDayOfMonth(endY, endM);
  const label = sm === 1 ? `${sy}` : `FY ${sy}-${String((sy + 1) % 100).padStart(2, '0')}`;
  return { key: String(sy), start, end, label };
}

export const typeStartMonth = (type: Pick<LeaveType, 'startMonth'>, settings: Pick<LeaveSettings, 'yearStartMonth'>) =>
  type.startMonth && type.startMonth >= 1 && type.startMonth <= 12 ? type.startMonth : settings.yearStartMonth || 1;

export function previousCycle(c: Cycle, startMonth: number): Cycle {
  return cycleOf(addDays(c.start, -1), startMonth);
}

// ------------------------------------------------------------------ working days and holidays

export function isWeeklyOff(date: string, weeklyOff: WeeklyOff): boolean {
  const rule = weeklyOff?.[String(weekday(date))];
  if (!rule) return false;
  if (rule === 'ALL') return true;
  const week = Math.ceil(parseInt(date.slice(8, 10), 10) / 7);
  return rule.includes(week);
}

export type DayKind = 'WORK' | 'WEEKLY_OFF' | 'HOLIDAY';

export function dayKind(date: string, loc: Pick<LeaveLocation, 'weeklyOff' | 'holidays'> | undefined): DayKind {
  if (!loc) return weekday(date) === 0 ? 'WEEKLY_OFF' : 'WORK';
  if (loc.holidays.some((h) => h.date === date && !h.optional)) return 'HOLIDAY';
  if (isWeeklyOff(date, loc.weeklyOff)) return 'WEEKLY_OFF';
  return 'WORK';
}

export interface LeaveDayCount {
  date: string;
  /** Days deducted for this date: 1, 0.5 or 0. */
  value: number;
  kind: DayKind;
}

export interface CountInput {
  from: string;
  to: string;
  /** Half-day on the first / last date of the range. */
  halfFrom?: boolean;
  halfTo?: boolean;
  loc?: Pick<LeaveLocation, 'weeklyOff' | 'holidays'>;
  dayCounting: DayCounting;
  sandwich: boolean;
}

export function countLeaveDays(input: CountInput): { days: number; breakdown: LeaveDayCount[] } {
  const { from, to, loc, dayCounting, sandwich } = input;
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return { days: 0, breakdown: [] };
  const span = daysBetween(from, to);
  if (span > 400) return { days: 0, breakdown: [] };
  const breakdown: LeaveDayCount[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(from, i);
    const kind = dayKind(date, loc);
    let value = dayCounting === 'CALENDAR' || kind === 'WORK' ? 1 : 0;
    if (value && ((i === 0 && input.halfFrom) || (i === span && input.halfTo))) value = 0.5;
    breakdown.push({ date, value, kind });
  }
  if (sandwich && dayCounting === 'WORKING') {
    const first = breakdown.findIndex((d) => d.value > 0);
    let last = -1;
    breakdown.forEach((d, i) => d.value > 0 && (last = i));
    if (first >= 0 && last > first) {
      for (let i = first + 1; i < last; i++) if (breakdown[i].value === 0) breakdown[i].value = 1;
    }
  }
  const days = breakdown.reduce((n, d) => n + d.value, 0);
  return { days, breakdown };
}

// ------------------------------------------------------------------ accrual

export interface PlannedCredit {
  /** Stable id of the period, used so a credit is never granted twice. */
  period: string;
  date: string;
  amount: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const roundHalf = (n: number) => Math.round(n * 2) / 2;

/** Months of the cycle an employee is entitled to: joining on or before the 15th counts that month. */
export function entitledMonths(cycle: Cycle, joinDate: string | undefined): number {
  if (!joinDate || joinDate <= cycle.start) return 12;
  if (joinDate > cycle.end) return 0;
  const jm = (parseInt(joinDate.slice(0, 4), 10) - parseInt(cycle.start.slice(0, 4), 10)) * 12 +
    (parseInt(joinDate.slice(5, 7), 10) - parseInt(cycle.start.slice(5, 7), 10));
  const first = parseInt(joinDate.slice(8, 10), 10) <= 15 ? jm : jm + 1;
  return Math.max(0, 12 - first);
}

/** All credits due for a policy entry in a cycle up to (and including) asOf. */
export function plannedCredits(entry: PolicyEntry, cycle: Cycle, joinDate: string | undefined, asOf: string): PlannedCredit[] {
  if (entry.accrual === 'NONE' || entry.quota <= 0) return [];
  const months = entitledMonths(cycle, joinDate);
  if (months === 0) return [];
  const startsAt = joinDate && joinDate > cycle.start ? joinDate : cycle.start;
  const out: PlannedCredit[] = [];

  if (entry.accrual === 'UPFRONT') {
    if (startsAt <= asOf) out.push({ period: 'U', date: startsAt, amount: roundHalf((entry.quota * months) / 12) });
    return out;
  }

  const firstMonthIndex = 12 - months; // 0-based month of the cycle the entitlement begins
  for (let i = firstMonthIndex; i < 12; i++) {
    const y = parseInt(cycle.start.slice(0, 4), 10);
    const m0 = parseInt(cycle.start.slice(5, 7), 10) - 1 + i;
    const date = `${y + Math.floor(m0 / 12)}-${String((m0 % 12) + 1).padStart(2, '0')}-01`;
    if (date > asOf) break;
    if (entry.accrual === 'MONTHLY') {
      out.push({ period: `M${date.slice(0, 7)}`, date, amount: round2(entry.quota / 12) });
    } else if (i % 3 === 0) {
      out.push({ period: `Q${i / 3 + 1}`, date, amount: round2(entry.quota / 4) });
    }
  }
  return out;
}

/** What happens to a balance when its cycle ends. */
export function rollover(balance: number, entry: Pick<PolicyEntry, 'carryForward' | 'carryCap'>): { carry: number; lapse: number } {
  if (balance === 0) return { carry: 0, lapse: 0 };
  if (balance < 0) return { carry: balance, lapse: 0 }; // an overdrawn balance is recovered next year
  if (!entry.carryForward) return { carry: 0, lapse: balance };
  const carry = entry.carryCap > 0 ? Math.min(balance, entry.carryCap) : balance;
  return { carry: round2(carry), lapse: round2(balance - carry) };
}

// ------------------------------------------------------------------ approval chain

export type Step = 'MANAGER' | 'HR';

export function approvalSteps(type: Pick<LeaveType, 'approval'>, days: number, hasManager: boolean, settings: Pick<LeaveSettings, 'hrApprovalAboveDays'>): Step[] {
  let steps: Step[] = type.approval === 'HR' ? ['HR'] : type.approval === 'MANAGER_HR' ? ['MANAGER', 'HR'] : ['MANAGER'];
  if (settings.hrApprovalAboveDays > 0 && days > settings.hrApprovalAboveDays && !steps.includes('HR')) steps.push('HR');
  if (!hasManager) steps = steps.filter((s) => s !== 'MANAGER');
  if (steps.length === 0) steps = ['HR'];
  return steps;
}

// ------------------------------------------------------------------ attendance

export type AttendanceStatus =
  | 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'INCOMPLETE'
  | 'LEAVE' | 'HALF_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'TODAY' | 'FUTURE' | 'NOT_EMPLOYED';

export interface AttendanceRecord {
  checkIn?: string | null; // ISO instants
  checkOut?: string | null;
}

export interface DayInput {
  date: string;
  today: string;
  loc?: Pick<LeaveLocation, 'weeklyOff' | 'holidays'>;
  record?: AttendanceRecord | null;
  /** Approved leave on this date: 1 or 0.5. */
  leaveValue?: number;
  shift: Shift;
  joinDate?: string;
}

export interface DayResult {
  status: AttendanceStatus;
  workedMinutes: number;
  late: boolean;
}

export function computeDayStatus(i: DayInput): DayResult {
  const none = { workedMinutes: 0, late: false };
  if (i.joinDate && i.date < i.joinDate) return { status: 'NOT_EMPLOYED', ...none };

  const rec = i.record;
  const worked = rec?.checkIn && rec?.checkOut
    ? Math.max(0, Math.round((new Date(rec.checkOut).getTime() - new Date(rec.checkIn).getTime()) / 60000))
    : 0;
  const late = !!rec?.checkIn && istParts(rec.checkIn).minutes > timeToMinutes(i.shift.start) + i.shift.graceMinutes;

  const kind = dayKind(i.date, i.loc);
  if (kind === 'HOLIDAY') return { status: 'HOLIDAY', workedMinutes: worked, late: false };
  if (kind === 'WEEKLY_OFF') return { status: 'WEEKLY_OFF', workedMinutes: worked, late: false };
  if ((i.leaveValue ?? 0) >= 1) return { status: 'LEAVE', workedMinutes: worked, late: false };
  if (i.date > i.today) return { status: 'FUTURE', ...none };

  const halfLeave = (i.leaveValue ?? 0) > 0;
  if (i.date === i.today && !(rec?.checkIn && rec?.checkOut)) {
    return { status: halfLeave ? 'HALF_LEAVE' : 'TODAY', workedMinutes: worked, late };
  }
  if (!rec?.checkIn) return { status: halfLeave ? 'HALF_LEAVE' : 'ABSENT', ...none };
  if (!rec.checkOut) return { status: halfLeave ? 'HALF_LEAVE' : 'INCOMPLETE', workedMinutes: 0, late };

  if (halfLeave) return { status: worked >= i.shift.halfDayMinutes ? 'HALF_LEAVE' : 'ABSENT', workedMinutes: worked, late };
  if (worked >= i.shift.fullDayMinutes) return { status: late ? 'LATE' : 'PRESENT', workedMinutes: worked, late };
  if (worked >= i.shift.halfDayMinutes) return { status: 'HALF_DAY', workedMinutes: worked, late };
  return { status: 'ABSENT', workedMinutes: worked, late };
}

export interface MonthSummary {
  present: number;
  late: number;
  halfDay: number;
  leave: number;
  absent: number;
  incomplete: number;
  holidays: number;
  weeklyOffs: number;
  /** Absent days plus half of each half-day: days of pay to cut unless covered by leave. */
  lossOfPayDays: number;
  lateDeductionDays: number;
}

export function summarizeMonth(results: DayResult[], lateMarksPerHalfDay: number, leaveValues: number[] = []): MonthSummary {
  const s: MonthSummary = { present: 0, late: 0, halfDay: 0, leave: 0, absent: 0, incomplete: 0, holidays: 0, weeklyOffs: 0, lossOfPayDays: 0, lateDeductionDays: 0 };
  results.forEach((r, idx) => {
    switch (r.status) {
      case 'PRESENT': s.present++; break;
      case 'LATE': s.present++; s.late++; break;
      case 'HALF_DAY': s.halfDay++; s.present += 0.5; break;
      case 'ABSENT': s.absent++; break;
      case 'INCOMPLETE': s.incomplete++; break;
      case 'LEAVE': s.leave++; break;
      case 'HALF_LEAVE': s.leave += 0.5; s.present += 0.5; break;
      case 'HOLIDAY': s.holidays++; break;
      case 'WEEKLY_OFF': s.weeklyOffs++; break;
    }
    void leaveValues[idx];
  });
  s.lossOfPayDays = s.absent + s.halfDay * 0.5;
  s.lateDeductionDays = lateMarksPerHalfDay > 0 ? Math.floor(s.late / lateMarksPerHalfDay) * 0.5 : 0;
  return s;
}

// ------------------------------------------------------------------ starter content

export const NATIONAL_HOLIDAYS = [
  { md: '01-26', name: 'Republic Day' },
  { md: '08-15', name: 'Independence Day' },
  { md: '10-02', name: 'Gandhi Jayanti' },
];

export function nationalHolidays(year: number): Holiday[] {
  return NATIONAL_HOLIDAYS.map((h) => ({ date: `${year}-${h.md}`, name: h.name }));
}

export const DEFAULT_SHIFT: Shift = { start: '09:30', end: '18:30', graceMinutes: 15, fullDayMinutes: 480, halfDayMinutes: 240 };

export const DEFAULT_WEEKLY_OFF: WeeklyOff = { '0': 'ALL' };

const T = (p: Partial<LeaveType> & Pick<LeaveType, 'id' | 'code' | 'name'>): LeaveType => ({
  paid: true, active: true, requiresBalance: true, halfDay: true, dayCounting: 'WORKING', minNoticeDays: 0,
  maxDaysPerRequest: 0, docRequiredAfterDays: 0, gender: 'ANY', minServiceDays: 0, allowNegative: false, approval: 'MANAGER', ...p,
});

/** Starting point a company can edit. Statutory figures are defaults to check with a labour-law advisor. */
export function starterSettings(year: number, now = new Date().toISOString().slice(0, 10)): LeaveSettings {
  void now;
  return {
    yearStartMonth: 4,
    sandwichRule: false,
    locations: [{ id: 'hq', name: 'Head office', weeklyOff: { ...DEFAULT_WEEKLY_OFF }, holidays: nationalHolidays(year) }],
    types: [
      T({ id: 'cl', code: 'CL', name: 'Casual leave', maxDaysPerRequest: 5, minNoticeDays: 1 }),
      T({ id: 'sl', code: 'SL', name: 'Sick leave', docRequiredAfterDays: 2 }),
      T({ id: 'el', code: 'EL', name: 'Earned / privilege leave', minNoticeDays: 7, approval: 'MANAGER_HR' }),
      T({ id: 'co', code: 'CO', name: 'Compensatory off', minNoticeDays: 0 }),
      T({ id: 'mat', code: 'MAT', name: 'Maternity leave', requiresBalance: false, halfDay: false, dayCounting: 'CALENDAR', maxDaysPerRequest: 182, gender: 'F', minServiceDays: 80, approval: 'HR', docRequiredAfterDays: 1 }),
      T({ id: 'ber', code: 'BL', name: 'Bereavement leave', requiresBalance: false, maxDaysPerRequest: 5 }),
      T({ id: 'lop', code: 'LOP', name: 'Loss of pay', paid: false, isLop: true, requiresBalance: false }),
    ],
    policies: [
      {
        id: 'standard', name: 'Standard employee', isDefault: true,
        entries: [
          { typeId: 'cl', quota: 12, accrual: 'MONTHLY', carryForward: false, carryCap: 0 },
          { typeId: 'sl', quota: 6, accrual: 'UPFRONT', carryForward: false, carryCap: 0 },
          { typeId: 'el', quota: 15, accrual: 'MONTHLY', carryForward: true, carryCap: 30 },
          { typeId: 'co', quota: 0, accrual: 'NONE', carryForward: false, carryCap: 0 },
          { typeId: 'mat', quota: 0, accrual: 'NONE', carryForward: false, carryCap: 0 },
          { typeId: 'ber', quota: 0, accrual: 'NONE', carryForward: false, carryCap: 0 },
          { typeId: 'lop', quota: 0, accrual: 'NONE', carryForward: false, carryCap: 0 },
        ],
      },
    ],
    shift: { ...DEFAULT_SHIFT },
    lateMarksPerHalfDay: 3,
    allowedIps: [],
    escalateAfterDays: 3,
    hrApprovalAboveDays: 0,
    notifyEmails: [],
  };
}

export function emptySettings(): LeaveSettings {
  return { ...starterSettings(new Date().getUTCFullYear()), locations: [], types: [], policies: [] };
}
