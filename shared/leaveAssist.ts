/**
 * Leave helpers that explain and prepare, but never decide.
 *
 * Everything here is deterministic code working from the published policy and the person's own data: it turns a
 * sentence into a draft request the employee must check, answers policy questions from the policy itself (with the
 * policy version it quoted), summarises a request for the approver, and finds days a team is short of people.
 * Eligibility, day counts and balances always come from the leave engine, never from this file.
 */
import { addDays, isIsoDate, weekday, type LeaveSettings, type LeaveType } from './leaveEngine.js';

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

export interface LeaveDraft {
  typeId: string;
  from: string;
  to: string;
  halfFrom: boolean;
  halfTo: boolean;
  halfPart: 'FIRST' | 'SECOND';
  emergency: boolean;
  reason: string;
}

export interface ParsedLeave {
  draft: LeaveDraft | null;
  /** What was understood, in plain words, for the employee to check. */
  understood: string[];
  /** What could not be worked out and must be chosen by the employee. */
  missing: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The next date on or after `from` that falls on the given weekday ("next" skips today). */
function nextWeekday(from: string, wd: number, skipToday: boolean): string {
  let d = skipToday ? addDays(from, 1) : from;
  for (let i = 0; i < 8; i++) { if (weekday(d) === wd) return d; d = addDays(d, 1); }
  return from;
}

function dateWords(text: string, today: string): string[] {
  const found: { at: number; date: string }[] = [];
  const t = text.toLowerCase();
  const push = (at: number, date: string) => { if (isIsoDate(date)) found.push({ at, date }); };

  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index || 0, m[0]);
  const year = parseInt(today.slice(0, 4), 10);
  // "2 nov", "2nd november", "nov 2"
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/g)) {
    const mo = MONTHS[m[2]];
    if (!mo) continue;
    let d = `${year}-${pad(mo)}-${pad(parseInt(m[1], 10))}`;
    if (d < today) d = `${year + 1}-${pad(mo)}-${pad(parseInt(m[1], 10))}`;
    push(m.index || 0, d);
  }
  for (const m of t.matchAll(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/g)) {
    const mo = MONTHS[m[1]];
    if (!mo) continue;
    let d = `${year}-${pad(mo)}-${pad(parseInt(m[2], 10))}`;
    if (d < today) d = `${year + 1}-${pad(mo)}-${pad(parseInt(m[2], 10))}`;
    push(m.index || 0, d);
  }
  if (/\bday after tomorrow\b/.test(t)) push(t.indexOf('day after tomorrow'), addDays(today, 2));
  else if (/\btomorrow\b/.test(t)) push(t.indexOf('tomorrow'), addDays(today, 1));
  if (/\btoday\b/.test(t)) push(t.indexOf('today'), today);
  if (/\byesterday\b/.test(t)) push(t.indexOf('yesterday'), addDays(today, -1));
  for (const m of t.matchAll(/\b(next|this|on)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thur?s?|fri|sat)\b/g)) {
    push((m.index || 0) + (m[1] ? m[1].length : 0), nextWeekday(today, WEEKDAYS[m[2]], m[1] === 'next' && weekday(today) === WEEKDAYS[m[2]]));
  }
  const seen = new Set<string>();
  return found.sort((a, b) => a.at - b.at).map((f) => f.date).filter((d) => (seen.has(d) ? false : (seen.add(d), true)));
}

const hasWord = (t: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}\\b`).test(t));

/** Finds the leave type a sentence is about, among the types the person may take. */
export function findTypeIn<T extends Pick<LeaveType, 'id' | 'name' | 'code'>>(text: string, types: T[]): T | null {
  const t = text.toLowerCase();
  const byName = types.find((x) => t.includes(x.name.toLowerCase()) || new RegExp(`\\b${x.code.toLowerCase()}\\b`).test(t));
  if (byName) return byName;
  const alias: [string[], string[]][] = [
    [['sick', 'unwell', 'fever', 'ill', 'doctor', 'medical', 'hospital', 'surgery'], ['sick']],
    [['casual', 'personal', 'errand', 'family function', 'wedding'], ['casual']],
    [['earned', 'privilege', 'annual', 'vacation', 'holiday trip', 'travel'], ['earned', 'privilege', 'annual']],
    [['comp off', 'compensatory', 'comp-off'], ['comp']],
    [['maternity', 'baby'], ['maternity']],
    [['paternity'], ['paternity']],
    [['bereavement', 'funeral', 'passed away'], ['bereavement']],
    [['without pay', 'unpaid', 'loss of pay', 'lop'], ['loss', 'unpaid', 'lop']],
  ];
  for (const [words, names] of alias) {
    if (words.some((w) => t.includes(w))) {
      const m = types.find((x) => names.some((n) => x.name.toLowerCase().includes(n) || x.code.toLowerCase().startsWith(n)));
      if (m) return m;
    }
  }
  return null;
}

/** Turns "I need Monday and Tuesday off" into a draft request. The employee always reviews it before sending. */
export function parseLeaveText(text: string, today: string, types: Pick<LeaveType, 'id' | 'name' | 'code'>[], workingWeekdays: number[] = [1, 2, 3, 4, 5]): ParsedLeave {
  const raw = (text || '').trim().slice(0, 400);
  const understood: string[] = [];
  const missing: string[] = [];
  if (!raw) return { draft: null, understood, missing: ['Describe the leave, for example: "sick leave tomorrow" or "Monday and Tuesday off".'] };
  const t = raw.toLowerCase();

  let dates = dateWords(raw, today);
  const forDays = /\b(\d{1,2})\s+days?\b/.exec(t);
  let from = dates[0] || '';
  let to = dates.length > 1 ? dates[dates.length - 1] : from;
  if (from && forDays && dates.length === 1) {
    // "3 days from Monday": count working days from the start date
    let left = Math.min(30, parseInt(forDays[1], 10)) - 1;
    to = from;
    while (left > 0) { to = addDays(to, 1); if (workingWeekdays.includes(weekday(to))) left--; }
  }
  if (to < from) [from, to] = [to, from];
  if (!from) missing.push('Which dates? Say a day, like "tomorrow" or "Monday", or a date like "12 Nov".');
  else understood.push(from === to ? `Date: ${from}` : `From ${from} to ${to}`);

  const type = findTypeIn(raw, types);
  if (type) understood.push(`Leave type: ${type.name}`);
  else missing.push('Which leave type? Choose it from the list.');

  const half = /\bhalf[\s-]?day\b|\bfirst half\b|\bsecond half\b|\bmorning\b|\bafternoon\b|\bhalf\b/.test(t);
  const halfPart: 'FIRST' | 'SECOND' = /\b(first half|morning)\b/.test(t) ? 'FIRST' : 'SECOND';
  if (half) {
    if (from && from !== to) missing.push('Half days can only be taken on a single day, or at the start or end of a longer leave. Check the form.');
    else understood.push(`Half day (${halfPart === 'FIRST' ? 'first half' : 'second half'})`);
  }
  const emergency = hasWord(t, ['emergency', 'urgent', 'hospital', 'accident', 'ambulance']);
  if (emergency) understood.push('Marked as an emergency');

  if (!from) return { draft: null, understood, missing };
  return {
    draft: {
      typeId: type?.id || '', from, to, halfFrom: half && from === to, halfTo: half && from === to, halfPart, emergency, reason: raw.slice(0, 200),
    },
    understood, missing,
  };
}

// ------------------------------------------------------------------ policy questions

export interface PolicyAnswer {
  answer: string;
  /** The policy version and document the answer was read from. */
  reference: string;
  /** False when the question could not be answered from the policy; the person should ask HR. */
  answered: boolean;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function policyReference(s: Pick<LeaveSettings, 'policyVersion' | 'effectiveFrom' | 'governanceRef'>): string {
  return `Leave policy v${s.policyVersion || 1}${s.effectiveFrom ? `, in force since ${s.effectiveFrom}` : ''}${s.governanceRef ? `, document ${s.governanceRef}` : ''}`;
}

/**
 * Answers a question using only what the published policy says. If the question is not covered it says so and
 * points to HR instead of guessing.
 */
export function answerPolicyQuestion(question: string, s: LeaveSettings, policyId: string): PolicyAnswer {
  const reference = policyReference(s);
  const q = (question || '').toLowerCase();
  const policy = s.policies.find((p) => p.id === policyId) || s.policies.find((p) => p.isDefault) || s.policies[0];
  const types = s.types.filter((t) => t.active && (!policy || policy.entries.some((e) => e.typeId === t.id)));
  const type = findTypeIn(q, types);
  const entry = type && policy ? policy.entries.find((e) => e.typeId === type.id) : undefined;
  const no = (): PolicyAnswer => ({ answer: 'That is not covered by the published policy, so I will not guess. Please ask HR.', reference, answered: false });

  if (/\b(year start|leave year|financial year|calendar year|when does the year)\b/.test(q)) {
    return { answer: s.yearStartMonth === 1 ? 'The leave year follows the calendar year (January to December).' : `The leave year starts in month ${s.yearStartMonth} and ends the month before.`, reference, answered: true };
  }
  if (/\b(probation)\b/.test(q) && !type) {
    const blocked = s.types.filter((t) => t.blockInProbation).map((t) => t.name);
    return { answer: (s.probationDays || 0) > 0 ? `Probation is ${plural(s.probationDays || 0, 'day')} from joining.${blocked.length ? ` ${blocked.join(', ')} cannot be taken during it.` : ''}` : 'There is no probation rule in the leave policy.', reference, answered: true };
  }
  if (/\b(sandwich|weekend)\b/.test(q) && !type) {
    return { answer: s.sandwichRule ? 'Weekly offs and holidays between two leave days count as leave (sandwich rule).' : 'Only working days are counted as leave; weekly offs and holidays inside a leave are not.', reference, answered: true };
  }
  if (/\b(holiday|holidays)\b/.test(q) && !type) {
    const loc = s.locations[0];
    const upcoming = (loc?.holidays || []).filter((h) => h.date >= new Date().toISOString().slice(0, 10)).slice(0, 5);
    return upcoming.length ? { answer: `Next holidays: ${upcoming.map((h) => `${h.name} (${h.date})`).join(', ')}.`, reference, answered: true } : no();
  }
  if (!type) {
    if (/\b(types?|kinds?|which leaves?|what leaves?)\b/.test(q)) return { answer: `Your leave types: ${types.map((t) => t.name).join(', ')}.`, reference, answered: true };
    return no();
  }
  const t = type;
  if (/\b(how many|entitle|quota|days a year|per year|get)\b/.test(q) && entry) {
    return { answer: `${t.name}: ${plural(entry.quota, 'day')} a year, ${entry.accrual === 'MONTHLY' ? 'added monthly' : entry.accrual === 'QUARTERLY' ? 'added every 3 months' : entry.accrual === 'UPFRONT' ? 'all at the start of the year' : 'not added automatically'}.`, reference, answered: true };
  }
  if (/\b(carry|forward|expire|lapse|encash)\b/.test(q) && entry) {
    return { answer: entry.carryForward ? `${t.name}: unused days carry to next year${entry.carryCap ? `, up to ${entry.carryCap}` : ' without a limit'}.${entry.encashCap ? ` Up to ${entry.encashCap} more are paid out.` : ''}` : `${t.name}: unused days expire at year end.${entry.encashCap ? ` Up to ${entry.encashCap} are paid out.` : ''}`, reference, answered: true };
  }
  if (/\b(notice|advance|how early|in advance)\b/.test(q)) {
    return { answer: t.minNoticeDays > 0 ? `${t.name} needs ${plural(t.minNoticeDays, 'day')} notice (emergency leave is exempt).` : `${t.name} needs no advance notice.`, reference, answered: true };
  }
  if (/\b(max|maximum|at a time|in one go|longest|consecutive)\b/.test(q)) {
    return { answer: t.maxDaysPerRequest > 0 ? `${t.name}: at most ${plural(t.maxDaysPerRequest, 'day')} in one request.` : `${t.name} has no limit per request.`, reference, answered: true };
  }
  if (/\b(document|certificate|proof|medical)\b/.test(q)) {
    return { answer: t.docRequiredAfterDays > 0 ? `${t.name} longer than ${plural(t.docRequiredAfterDays, 'day')} needs a supporting document.` : `${t.name} does not need a supporting document.`, reference, answered: true };
  }
  if (/\b(half)\b/.test(q)) return { answer: t.halfDay ? `${t.name} can be taken as a half day.` : `${t.name} can only be taken in full days.`, reference, answered: true };
  if (/\b(approve|approval|approver|who)\b/.test(q)) {
    return { answer: t.approval === 'HR' ? `${t.name} is approved by HR.` : t.approval === 'MANAGER_HR' ? `${t.name} is approved by your manager and then HR.` : `${t.name} is approved by your manager${s.hrApprovalAboveDays > 0 ? `; longer than ${plural(s.hrApprovalAboveDays, 'day')} also goes to HR` : ''}.`, reference, answered: true };
  }
  if (/\b(negative|borrow|overdraw|advance leave)\b/.test(q)) {
    return { answer: t.allowNegative ? `${t.name} can go below zero (borrowing from future balance).` : `${t.name} cannot go below zero.`, reference, answered: true };
  }
  if (/\b(paid|unpaid|salary|pay)\b/.test(q)) return { answer: t.paid ? `${t.name} is paid leave.` : `${t.name} is unpaid.`, reference, answered: true };
  if (/\b(eligible|eligibility|can i|who can|service|joining)\b/.test(q)) {
    const bits = [t.gender !== 'ANY' ? `for ${t.gender === 'F' ? 'women' : 'men'} only` : '', t.minServiceDays > 0 ? `after ${plural(t.minServiceDays, 'day')} of service` : '',
      t.blockInProbation && (s.probationDays || 0) > 0 ? 'not during probation' : '', t.blockInNotice ? 'not during a notice period' : ''].filter(Boolean);
    return { answer: bits.length ? `${t.name} is available ${bits.join(', ')}.` : `${t.name} has no special eligibility conditions.`, reference, answered: true };
  }
  return no();
}

// ------------------------------------------------------------------ approver summary and team cover

export interface SummaryInput {
  name: string; typeName: string; from: string; to: string; days: number; emergency?: boolean; reason?: string;
  daysNotice: number; balanceAfter?: number | null; teamAway: string[]; hasDocument: boolean; warnings?: string[];
}

/** A short factual note for the approver. No judgement about the person, only what the request is. */
export function requestSummary(i: SummaryInput): string {
  const parts = [`${i.name} asks for ${plural(i.days, 'day')} of ${i.typeName} (${i.from === i.to ? i.from : `${i.from} to ${i.to}`}).`];
  if (i.emergency) parts.push('Marked as an emergency.');
  else if (i.daysNotice < 0) parts.push(`Applied ${plural(-i.daysNotice, 'day')} after the leave started.`);
  else parts.push(`${plural(i.daysNotice, 'day')} notice.`);
  if (i.balanceAfter !== null && i.balanceAfter !== undefined) parts.push(i.balanceAfter < 0 ? `Balance goes below zero (${i.balanceAfter}).` : `${i.balanceAfter} day(s) left afterwards.`);
  if (i.teamAway.length) parts.push(`Also away then: ${i.teamAway.slice(0, 4).join(', ')}${i.teamAway.length > 4 ? ` +${i.teamAway.length - 4}` : ''}.`);
  if (i.hasDocument) parts.push('A supporting document is attached (HR can open it).');
  return parts.join(' ');
}

export interface CoverGap { date: string; away: string[]; share: number }

/**
 * Days where a team is short of people. A gap is a day when at least two people, or a third of the team, are away.
 * It only shows the facts; the manager decides what to do.
 */
export function coverageGaps(teamSize: number, awayByDate: Map<string, string[]>, from: string, to: string): CoverGap[] {
  const out: CoverGap[] = [];
  if (teamSize <= 0) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const away = awayByDate.get(d) || [];
    const share = away.length / teamSize;
    if (away.length >= 2 || (away.length >= 1 && share >= 1 / 3)) out.push({ date: d, away, share: Math.round(share * 100) / 100 });
  }
  return out;
}

export interface MisInput {
  month: string; headcount: number; approvedDays: number; byType: { type: string; days: number }[]; pending: number; overdue: number;
  openExceptions: number; unpaidDays: number; emergency: number; busiestDay?: { date: string; away: number } | null; previousApprovedDays: number;
}

/** The monthly leave summary as plain sentences, built from the numbers only. HR reviews it before it is shared. */
export function misSummary(m: MisInput): string {
  const lines: string[] = [];
  const delta = m.approvedDays - m.previousApprovedDays;
  lines.push(`In ${m.month}, ${plural(Math.round(m.approvedDays * 10) / 10, 'day')} of leave were approved across ${plural(m.headcount, 'employee')}${m.previousApprovedDays > 0 ? ` (${delta === 0 ? 'the same as' : `${delta > 0 ? 'up' : 'down'} ${Math.abs(Math.round(delta * 10) / 10)} from`} the month before)` : ''}.`);
  if (m.byType.length) lines.push(`Most used: ${m.byType.slice(0, 3).map((t) => `${t.type} (${Math.round(t.days * 10) / 10})`).join(', ')}.`);
  if (m.unpaidDays > 0) lines.push(`${Math.round(m.unpaidDays * 10) / 10} day(s) were unpaid and flow to payroll.`);
  if (m.emergency > 0) lines.push(`${plural(m.emergency, 'emergency request')} needed regularising.`);
  if (m.busiestDay && m.busiestDay.away > 1) lines.push(`The busiest day was ${m.busiestDay.date}, with ${m.busiestDay.away} people away.`);
  lines.push(m.pending > 0 ? `${plural(m.pending, 'request')} still waiting for a decision${m.overdue ? `, ${m.overdue} overdue` : ''}.` : 'No requests are waiting for a decision.');
  lines.push(m.openExceptions > 0 ? `${plural(m.openExceptions, 'open exception')} to resolve before the month is reconciled.` : 'There are no open exceptions.');
  return lines.join(' ');
}
