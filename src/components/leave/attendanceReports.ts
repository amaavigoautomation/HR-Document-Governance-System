/**
 * The attendance reports. Each one is built in the browser from the day-by-day list the server returns
 * (GET attendance-report), so there is one data source and the rules live in one place.
 */
export interface ReportDay {
  date: string; status: string; checkIn: string | null; checkOut: string | null; workedMinutes: number; late: boolean;
  sessions?: { in: string; out: string | null; inNote?: string; outNote?: string }[]; source?: string | null; note?: string;
}
export interface ReportPerson { uid: string; name: string; empId: string; department: string; days: ReportDay[] }
export interface ReportData { from: string; to: string; today: string; shift: { start: string; end: string; graceMinutes: number; fullDayMinutes: number }; people: ReportPerson[] }
export interface ReportOptions { fromTime: string; tillTime: string }
export interface ReportTable { headers: string[]; rows: (string | number)[][]; note?: string }

export type ReportId =
  | 'in-out-activity' | 'daily-detail' | 'absent' | 'pending-applications'
  | 'in-out-summary' | 'employee-attendance'
  | 'late-coming' | 'early-going' | 'half-day' | 'missed-punch';

export interface ReportDef {
  id: ReportId; group: 'Daily reports' | 'Summary reports' | 'Monitoring reports';
  title: string; hint: string;
  /** Which period styles the criteria offers. */
  periods: ('date' | 'month')[];
  /** Shows the From time / Till time boxes. */
  timeFilter?: boolean;
  /** Loads its own data instead of the day list. */
  own?: boolean;
}

export const REPORTS: ReportDef[] = [
  { id: 'in-out-activity', group: 'Daily reports', title: 'In Out Activities Report', hint: 'Every punch in and out, with remarks', periods: ['date'], timeFilter: true },
  { id: 'daily-detail', group: 'Daily reports', title: 'Daily Detail Attendance Report', hint: 'Each day: status, in, out, hours, late and early', periods: ['month', 'date'] },
  { id: 'absent', group: 'Daily reports', title: 'Absent Report', hint: 'Days with no punches and no leave', periods: ['date', 'month'] },
  { id: 'pending-applications', group: 'Daily reports', title: 'Pending Attendance Application Report', hint: 'Applications still waiting for a decision', periods: [], own: true },
  { id: 'in-out-summary', group: 'Summary reports', title: 'Detail In Out Summary Report', hint: 'First in, last out, punches and time away each day', periods: ['date', 'month'] },
  { id: 'employee-attendance', group: 'Summary reports', title: 'Employee Attendance Report', hint: 'Totals per employee for the period', periods: ['month', 'date'] },
  { id: 'late-coming', group: 'Monitoring reports', title: 'Late Coming Report', hint: 'Days checked in after the shift start plus grace', periods: ['date', 'month'] },
  { id: 'early-going', group: 'Monitoring reports', title: 'Early Going Report', hint: 'Days the last check-out was before the shift end', periods: ['date', 'month'] },
  { id: 'half-day', group: 'Monitoring reports', title: 'Half Day Report', hint: 'Days counted as a half day', periods: ['date', 'month'] },
  { id: 'missed-punch', group: 'Monitoring reports', title: 'Missed Punch Report', hint: 'Days with a check-in but no check-out', periods: ['date', 'month'] },
];

export const toMin = (hhmm: string | null | undefined) => { if (!hhmm) return NaN; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const clock = (m: number) => (m > 0 ? `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` : '');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayOf = (iso: string) => DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
export const longDate = (iso: string) => `${iso.slice(8)}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;

const WORKED = ['PRESENT', 'LATE', 'HALF_DAY', 'HALF_LEAVE'];
const STATUS: Record<string, string> = {
  PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', HALF_LEAVE: 'Half leave', ABSENT: 'Absent', INCOMPLETE: 'Missed check-out', LEAVE: 'Leave',
  HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off', TODAY: 'Today', FUTURE: '', NOT_EMPLOYED: '',
};

type Flat = { p: ReportPerson; d: ReportDay };
const flat = (data: ReportData): Flat[] => data.people.flatMap((p) => p.days.map((d) => ({ p, d })))
  .sort((a, b) => a.d.date.localeCompare(b.d.date) || a.p.name.localeCompare(b.p.name));
const who = (x: Flat) => [x.p.empId, x.p.name];
const WHO_HEAD = ['Emp ID', 'Employee'];

export function buildReport(id: ReportId, data: ReportData, opt: ReportOptions): ReportTable {
  const shiftTxt = `${data.shift.start}–${data.shift.end}`;
  const all = flat(data);
  switch (id) {
    case 'in-out-activity': {
      const from = toMin(opt.fromTime || '00:00');
      const till = toMin(opt.tillTime || '23:59');
      const rows: (string | number)[][] = [];
      for (const { p, d } of all) {
        for (const s of d.sessions || []) {
          const punches: [string, string, string][] = [[s.in, 'IN', s.inNote || '']];
          if (s.out) punches.push([s.out, 'OUT', s.outNote || '']);
          for (const [t, kind, note] of punches) {
            const m = toMin(t);
            if (m >= from && m <= till) rows.push([p.empId, p.name, longDate(d.date), t, kind, note, d.source === 'REGULARIZED' ? 'Regularized' : d.source === 'HR' ? 'HR' : 'Self']);
          }
        }
      }
      return { headers: [...WHO_HEAD, 'Date', 'Time', 'In / Out', 'Remarks', 'Source'], rows };
    }
    case 'daily-detail': {
      const rows = all.filter(({ d }) => STATUS[d.status]).map((x) => {
        const { d } = x;
        const lateBy = d.late && d.checkIn ? Math.max(0, toMin(d.checkIn) - toMin(data.shift.start)) : 0;
        const earlyBy = d.checkOut && WORKED.includes(d.status) ? Math.max(0, toMin(data.shift.end) - toMin(d.checkOut)) : 0;
        return [...who(x), `${longDate(d.date)} ${dayOf(d.date)}`, STATUS[d.status], shiftTxt, d.checkIn || '', d.checkOut || '', clock(d.workedMinutes), lateBy || '', earlyBy || '', d.note || (d.source && d.source !== 'SELF' ? d.source.toLowerCase() : '')];
      });
      return { headers: [...WHO_HEAD, 'Date', 'Status', 'Shift', 'Punch in', 'Punch out', 'Total hrs', 'Late (min)', 'Early (min)', 'Remarks'], rows };
    }
    case 'absent':
      return { headers: [...WHO_HEAD, 'Date', 'Shift'], rows: all.filter(({ d }) => d.status === 'ABSENT').map((x) => [...who(x), `${longDate(x.d.date)} ${dayOf(x.d.date)}`, shiftTxt]), note: 'Days with no punches and no leave. Weekly offs and holidays are not counted.' };
    case 'in-out-summary': {
      const rows = all.filter(({ d }) => (d.sessions || []).length > 0).map((x) => {
        const ss = x.d.sessions!;
        const first = ss[0].in;
        const last = [...ss].reverse().find((s) => s.out)?.out || '';
        const span = last ? toMin(last) - toMin(first) : 0;
        const away = span > 0 ? Math.max(0, span - x.d.workedMinutes) : 0;
        return [...who(x), longDate(x.d.date), first, last, ss.length, clock(x.d.workedMinutes), clock(away)];
      });
      return { headers: [...WHO_HEAD, 'Date', 'First in', 'Last out', 'In/out pairs', 'Worked', 'Time away'], rows, note: 'Time away is the time between the first in and the last out that was not worked (washroom, lunch).' };
    }
    case 'employee-attendance': {
      const rows = data.people.map((p) => {
        const c = (f: (d: ReportDay) => boolean) => p.days.filter(f).length;
        const worked = p.days.reduce((n, d) => n + (d.workedMinutes || 0), 0);
        const dayWorked = c((d) => d.workedMinutes > 0);
        return [p.empId, p.name, p.department, c((d) => d.status === 'PRESENT' || d.status === 'LATE'), c((d) => d.late), c((d) => d.status === 'HALF_DAY' || d.status === 'HALF_LEAVE'),
          c((d) => d.status === 'LEAVE'), c((d) => d.status === 'ABSENT'), c((d) => d.status === 'INCOMPLETE'), c((d) => d.status === 'HOLIDAY'), c((d) => d.status === 'WEEKLY_OFF'),
          clock(worked), dayWorked ? clock(Math.round(worked / dayWorked)) : ''];
      });
      return { headers: ['Emp ID', 'Employee', 'Department', 'Present', 'Late', 'Half day', 'Leave', 'Absent', 'Missed check-out', 'Holidays', 'Weekly offs', 'Total hrs', 'Avg hrs / day'], rows };
    }
    case 'late-coming':
      return { headers: [...WHO_HEAD, 'Date', 'Shift start', 'Punch in', 'Late by (min)'], rows: all.filter(({ d }) => d.late && d.checkIn).map((x) => [...who(x), longDate(x.d.date), data.shift.start, x.d.checkIn!, Math.max(0, toMin(x.d.checkIn) - toMin(data.shift.start))]), note: `Late means checking in more than ${data.shift.graceMinutes} minutes after ${data.shift.start}.` };
    case 'early-going': {
      const rows = all.filter(({ d }) => d.checkOut && WORKED.includes(d.status) && toMin(d.checkOut) < toMin(data.shift.end))
        .map((x) => [...who(x), longDate(x.d.date), data.shift.end, x.d.checkOut!, toMin(data.shift.end) - toMin(x.d.checkOut)]);
      return { headers: [...WHO_HEAD, 'Date', 'Shift end', 'Punch out', 'Early by (min)'], rows, note: 'Uses the last check-out of the day.' };
    }
    case 'half-day':
      return { headers: [...WHO_HEAD, 'Date', 'Punch in', 'Punch out', 'Total hrs', 'Status'], rows: all.filter(({ d }) => d.status === 'HALF_DAY' || d.status === 'HALF_LEAVE').map((x) => [...who(x), longDate(x.d.date), x.d.checkIn || '', x.d.checkOut || '', clock(x.d.workedMinutes), STATUS[x.d.status]]) };
    case 'missed-punch':
      return { headers: [...WHO_HEAD, 'Date', 'Punch in', 'Missing'], rows: all.filter(({ d }) => d.status === 'INCOMPLETE').map((x) => [...who(x), longDate(x.d.date), x.d.checkIn || '', 'Check-out']) , note: 'A check-in with no check-out on a past day. The person can fix it with an attendance application.' };
    default:
      return { headers: [], rows: [] };
  }
}

export function pendingTable(items: { docNo: string; name: string; date: string; checkIn: string; checkOut: string; reason: string; appliedByName: string; appliedOn: string; waitingDays: number }[]): ReportTable {
  return {
    headers: ['Doc #', 'Employee', 'Date', 'Time in', 'Time out', 'Reason', 'Applied by', 'Applied on', 'Waiting (days)'],
    rows: items.map((r) => [r.docNo, r.name, longDate(r.date), r.checkIn || 'unchanged', r.checkOut || 'unchanged', r.reason, r.appliedByName, longDate(r.appliedOn), r.waitingDays]),
  };
}

const esc = (v: string | number) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** A printable page (Print or Save as PDF from the browser's print box). Values are escaped. */
export function printHtml(title: string, subtitle: string, t: ReportTable): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:16px;margin:0}p{margin:2px 0 12px;color:#555}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}th{background:#f1f5f9}
</style></head><body><h1>${esc(title)}</h1><p>${esc(subtitle)}</p><table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
