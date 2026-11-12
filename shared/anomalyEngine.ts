/**
 * Flags: pure detectors for payroll inputs, repeated late marks and leave patterns. No browser or Node imports, so the
 * API, the daily scan and the tests share one set of rules.
 *
 * Everything here is arithmetic on recorded data. A flag says "worth a second look" and carries the evidence (figures or
 * dates) so a person can judge it. Nothing is deducted, sent to the employee or changed because of a flag.
 */

export type FlagType = 'PAYROLL' | 'LATE' | 'LEAVE';
export type FlagSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Flag {
  /** Stable id for the same finding: running the checks twice gives the same key, so nothing is raised twice. */
  key: string;
  type: FlagType;
  code: string;
  severity: FlagSeverity;
  /** Employee the flag is about; empty for a company-wide flag. */
  uid: string;
  name: string;
  /** YYYY-MM the flag belongs to. */
  month: string;
  message: string;
  /** Short facts shown as chips: figures or dates. */
  evidence: string[];
  /** The raw numbers behind the message. The AI explanation may only use numbers found here. */
  facts: Record<string, number | string>;
  /** Changes when the finding gets worse or different, which reopens a flag that was marked as fine. */
  sig: string;
}

export interface FlagSettings {
  payroll: boolean;
  late: boolean;
  leave: boolean;
  /** Late marks in the last 30 days that raise a flag. */
  latePer30: number;
  /** Late days in a row that raise a flag. */
  lateStreak: number;
  /** Net pay change against last month, in percent. */
  payChangePct: number;
  /** Total net payroll change against last month, in percent. */
  totalChangePct: number;
  /** Leave days taken next to a weekend or holiday, in the last 90 days. */
  leaveAdjacent: number;
  /** Short sick leaves (2 days or fewer) in the last 60 days. */
  shortSick: number;
}

export const DEFAULT_FLAG_SETTINGS: FlagSettings = {
  payroll: true, late: true, leave: true, latePer30: 4, lateStreak: 3, payChangePct: 15, totalChangePct: 10, leaveAdjacent: 3, shortSick: 3,
};

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function sanitizeFlagSettings(input: any): FlagSettings {
  const d = DEFAULT_FLAG_SETTINGS;
  const o = input && typeof input === 'object' ? input : {};
  return {
    payroll: o.payroll !== false, late: o.late !== false, leave: o.leave !== false,
    latePer30: clampInt(o.latePer30, 2, 30, d.latePer30), lateStreak: clampInt(o.lateStreak, 2, 15, d.lateStreak),
    payChangePct: clampInt(o.payChangePct, 1, 100, d.payChangePct), totalChangePct: clampInt(o.totalChangePct, 1, 100, d.totalChangePct),
    leaveAdjacent: clampInt(o.leaveAdjacent, 2, 20, d.leaveAdjacent), shortSick: clampInt(o.shortSick, 2, 20, d.shortSick),
  };
}

// ------------------------------------------------------------------ small helpers

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (now: number, was: number) => (was === 0 ? 0 : ((now - was) / Math.abs(was)) * 100);
const inr = (n: number) => Math.round(n).toLocaleString('en-IN');
const lakh = (n: number) => `${(Math.round(n / 1000) / 100).toLocaleString('en-IN')} L`;
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (iso: string) => `${parseInt(iso.slice(8, 10), 10)} ${MONTHS[parseInt(iso.slice(5, 7), 10) - 1]}`;
const sev = (high: boolean): FlagSeverity => (high ? 'HIGH' : 'MEDIUM');
const keyOf = (...p: string[]) => p.join('_').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 180);

// ------------------------------------------------------------------ payroll

export interface PayrollPerson {
  uid: string;
  name: string;
  gross: number;
  net: number;
  deductions: number;
  lopDays: number;
  /** Total of one-off earnings and deductions added for the month. */
  adjustments: number;
  /** Largest single one-off amount. */
  largestAdjustment: number;
  /** Bank account compared as a hidden key (never shown). Empty = none on file. */
  accountKey: string;
}

export function payrollFlags(month: string, cur: PayrollPerson[], prev: PayrollPerson[] | null, skippedUids: string[], s: FlagSettings): Flag[] {
  if (!s.payroll) return [];
  const out: Flag[] = [];
  const add = (f: Omit<Flag, 'type' | 'month'>) => out.push({ type: 'PAYROLL', month, ...f });
  const before = new Map((prev || []).map((p) => [p.uid, p]));
  const skipped = new Set(skippedUids);

  for (const p of cur) {
    if (p.net <= 0) {
      add({ key: keyOf('FLAG', 'PAY', month, 'NEG', p.uid), code: 'NEGATIVE_NET', severity: 'HIGH', uid: p.uid, name: p.name,
        message: `Net pay is ${p.net < 0 ? 'below zero' : 'zero'} this month.`, evidence: [`Gross ${inr(p.gross)}`, `Deductions ${inr(p.deductions)}`, `Net ${inr(p.net)}`],
        facts: { gross: r2(p.gross), deductions: r2(p.deductions), net: r2(p.net) }, sig: `${r2(p.net)}` });
    } else if (p.gross > 0 && p.deductions > p.gross * 0.5) {
      add({ key: keyOf('FLAG', 'PAY', month, 'DED', p.uid), code: 'HIGH_DEDUCTIONS', severity: 'MEDIUM', uid: p.uid, name: p.name,
        message: 'Deductions are more than half of gross pay.', evidence: [`Gross ${inr(p.gross)}`, `Deductions ${inr(p.deductions)}`],
        facts: { gross: r2(p.gross), deductions: r2(p.deductions) }, sig: `${r2(p.deductions)}` });
    }
    if (p.gross > 0 && p.largestAdjustment > p.gross * 0.5) {
      add({ key: keyOf('FLAG', 'PAY', month, 'ADJ', p.uid), code: 'LARGE_ADJUSTMENT', severity: 'MEDIUM', uid: p.uid, name: p.name,
        message: 'A one-off amount is more than half of monthly gross pay.', evidence: [`One-off ${inr(p.largestAdjustment)}`, `Gross ${inr(p.gross)}`],
        facts: { oneOff: r2(p.largestAdjustment), gross: r2(p.gross) }, sig: `${r2(p.largestAdjustment)}` });
    }
    const was = before.get(p.uid);
    if (!was) continue;
    const change = pct(p.net, was.net);
    const lopDelta = r2(p.lopDays - was.lopDays);
    if (Math.abs(change) >= s.payChangePct && was.net > 0) {
      const explained = p.adjustments > 0 || was.adjustments > 0 || lopDelta !== 0;
      const unexplained = !explained;
      add({ key: keyOf('FLAG', 'PAY', month, 'CHG', p.uid), code: 'NET_CHANGE', severity: sev(unexplained || Math.abs(change) >= s.payChangePct * 2), uid: p.uid, name: p.name,
        message: `Net pay is ${Math.abs(Math.round(change))}% ${change < 0 ? 'lower' : 'higher'} than last month${unexplained ? ' with no loss of pay, bonus or deduction to explain it' : ''}.`,
        evidence: [`Last month ${inr(was.net)}`, `This month ${inr(p.net)}`, `Loss of pay ${r2(was.lopDays)} → ${r2(p.lopDays)}`],
        facts: { lastNet: r2(was.net), net: r2(p.net), changePct: Math.round(change), lopLast: r2(was.lopDays), lop: r2(p.lopDays), oneOffs: r2(p.adjustments) },
        sig: `${Math.round(change)}` });
    } else if (lopDelta >= 3) {
      add({ key: keyOf('FLAG', 'PAY', month, 'LOP', p.uid), code: 'LOP_JUMP', severity: 'MEDIUM', uid: p.uid, name: p.name,
        message: `Loss of pay days jumped by ${lopDelta} compared with last month.`, evidence: [`Loss of pay ${r2(was.lopDays)} → ${r2(p.lopDays)}`],
        facts: { lopLast: r2(was.lopDays), lop: r2(p.lopDays) }, sig: `${r2(p.lopDays)}` });
    }
  }

  if (prev && prev.length) {
    const now = new Set(cur.map((p) => p.uid));
    for (const w of prev) {
      if (!now.has(w.uid) && !skipped.has(w.uid)) {
        add({ key: keyOf('FLAG', 'PAY', month, 'GONE', w.uid), code: 'MISSING', severity: 'MEDIUM', uid: w.uid, name: w.name,
          message: 'Paid last month but not in this run, and not marked as settled.', evidence: [`Last month net ${inr(w.net)}`], facts: { lastNet: r2(w.net) }, sig: 'gone' });
      }
    }
    for (const p of cur) {
      if (!before.has(p.uid)) {
        add({ key: keyOf('FLAG', 'PAY', month, 'NEW', p.uid), code: 'NEW_IN_RUN', severity: 'LOW', uid: p.uid, name: p.name,
          message: 'Not in last month\'s run. Check the salary structure and joining date.', evidence: [`Net ${inr(p.net)}`], facts: { net: r2(p.net) }, sig: 'new' });
      }
    }
  }

  const byAccount = new Map<string, PayrollPerson[]>();
  for (const p of cur) if (p.accountKey) byAccount.set(p.accountKey, [...(byAccount.get(p.accountKey) || []), p]);
  for (const group of byAccount.values()) {
    if (group.length < 2) continue;
    const names = group.map((g) => g.name).sort();
    add({ key: keyOf('FLAG', 'PAY', month, 'BANK', group.map((g) => g.uid).sort().join('-')), code: 'DUPLICATE_BANK', severity: 'HIGH', uid: '', name: names.join(', '),
      message: `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} have the same bank account on file.`, evidence: ['Account number hidden'],
      facts: { employees: names.length }, sig: names.join('|') });
  }

  if (prev && prev.length && cur.length) {
    const tNow = cur.reduce((n, p) => n + p.net, 0);
    const tWas = prev.reduce((n, p) => n + p.net, 0);
    const change = pct(tNow, tWas);
    if (Math.abs(change) >= s.totalChangePct) {
      add({ key: keyOf('FLAG', 'PAY', month, 'TOTAL'), code: 'TOTAL_CHANGE', severity: 'MEDIUM', uid: '', name: 'Whole company',
        message: `Total net payroll is ${Math.abs(Math.round(change))}% ${change < 0 ? 'lower' : 'higher'} than last month.`,
        evidence: [`Last month ${lakh(tWas)}`, `This month ${lakh(tNow)}`, `People ${prev.length} → ${cur.length}`],
        facts: { lastTotal: r2(tWas), total: r2(tNow), changePct: Math.round(change), peopleLast: prev.length, people: cur.length }, sig: `${Math.round(change)}` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ late marks

export interface AttendanceDay { date: string; status: string; late: boolean }

const NON_WORKING = new Set(['WEEKLY_OFF', 'HOLIDAY', 'LEAVE', 'HALF_LEAVE', 'FUTURE', 'TODAY', 'NOT_EMPLOYED']);

export function lateFlags(today: string, people: { uid: string; name: string; days: AttendanceDay[] }[], s: FlagSettings): Flag[] {
  if (!s.late) return [];
  const out: Flag[] = [];
  const month = today.slice(0, 7);
  const from = addDays(today, -29);
  for (const p of people) {
    const days = p.days.filter((d) => d.date >= from && d.date < today).sort((a, b) => a.date.localeCompare(b.date));
    const lates = days.filter((d) => d.late || d.status === 'LATE').map((d) => d.date);
    let streak = 0;
    let best = 0;
    let bestEnd = '';
    for (const d of days) {
      if (NON_WORKING.has(d.status)) continue;
      if (d.late || d.status === 'LATE') { streak++; if (streak > best) { best = streak; bestEnd = d.date; } } else streak = 0;
    }
    if (lates.length >= s.latePer30 || best >= s.lateStreak) {
      out.push({
        key: keyOf('FLAG', 'LATE', 'MARKS', p.uid), type: 'LATE', code: 'LATE_MARKS', severity: 'MEDIUM', uid: p.uid, name: p.name, month,
        message: `${lates.length} late mark${lates.length === 1 ? '' : 's'} in the last 30 days${best >= s.lateStreak ? `, ${best} of them in a row` : ''}.`,
        evidence: lates.slice(-8).map(shortDay), facts: { lateMarks: lates.length, inARow: best, lastStreakEnd: bestEnd }, sig: `${lates.length}-${best}`,
      });
    }
    const incomplete = days.filter((d) => d.status === 'INCOMPLETE').map((d) => d.date);
    if (incomplete.length >= 3) {
      out.push({
        key: keyOf('FLAG', 'LATE', 'OPEN', p.uid), type: 'LATE', code: 'MISSING_PUNCH_OUT', severity: 'LOW', uid: p.uid, name: p.name, month,
        message: `${incomplete.length} days in the last 30 days with a missing check-out.`, evidence: incomplete.slice(-8).map(shortDay),
        facts: { incompleteDays: incomplete.length }, sig: `${incomplete.length}`,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ leave patterns

export interface LeaveItem {
  from: string;
  to: string;
  days: number;
  typeName: string;
  status: string;
  createdOn: string;
}

export function leaveFlags(today: string, people: { uid: string; name: string; isOff: (date: string) => boolean; requests: LeaveItem[] }[], s: FlagSettings): Flag[] {
  if (!s.leave) return [];
  const out: Flag[] = [];
  const month = today.slice(0, 7);
  const since90 = addDays(today, -90);
  const since60 = addDays(today, -60);
  for (const p of people) {
    const taken = p.requests.filter((r) => r.status === 'APPROVED' && r.to >= since90 && r.from <= today);
    const adjacent = taken.filter((r) => p.isOff(addDays(r.from, -1)) || p.isOff(addDays(r.to, 1)));
    if (adjacent.length >= s.leaveAdjacent) {
      out.push({
        key: keyOf('FLAG', 'LEAVE', 'ADJ', p.uid), type: 'LEAVE', code: 'LEAVE_NEXT_TO_OFF', severity: 'LOW', uid: p.uid, name: p.name, month,
        message: `${adjacent.length} leaves in the last 90 days were taken right before or after a weekend or holiday.`,
        evidence: adjacent.slice(-6).map((r) => (r.from === r.to ? shortDay(r.from) : `${shortDay(r.from)} to ${shortDay(r.to)}`)),
        facts: { leaves: adjacent.length }, sig: `${adjacent.length}`,
      });
    }
    const sick = taken.filter((r) => /sick|medical/i.test(r.typeName) && r.from >= since60 && r.days <= 2);
    if (sick.length >= s.shortSick) {
      out.push({
        key: keyOf('FLAG', 'LEAVE', 'SICK', p.uid), type: 'LEAVE', code: 'SHORT_SICK_LEAVES', severity: 'LOW', uid: p.uid, name: p.name, month,
        message: `${sick.length} short sick leaves (2 days or fewer) in the last 60 days.`, evidence: sick.slice(-6).map((r) => shortDay(r.from)),
        facts: { leaves: sick.length }, sig: `${sick.length}`,
      });
    }
    const retro = p.requests.filter((r) => ['APPROVED', 'PENDING'].includes(r.status) && r.createdOn > r.to && r.to >= since90);
    if (retro.length >= 3) {
      out.push({
        key: keyOf('FLAG', 'LEAVE', 'RETRO', p.uid), type: 'LEAVE', code: 'APPLIED_AFTER_THE_FACT', severity: 'LOW', uid: p.uid, name: p.name, month,
        message: `${retro.length} leaves in the last 90 days were applied for after the leave had ended.`, evidence: retro.slice(-6).map((r) => shortDay(r.from)),
        facts: { leaves: retro.length }, sig: `${retro.length}`,
      });
    }
  }
  return out;
}

export const SEVERITY_ORDER: Record<FlagSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
