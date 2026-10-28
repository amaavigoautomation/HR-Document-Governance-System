import { dayOf, longDate, type ReportData, type ReportTable } from '../leave/attendanceReports';

/** Weekoff Holiday Report: every weekly off and holiday per employee in a date range, built from the attendance day list. */
export type GroupBy = 'none' | 'department' | 'employee' | 'month';
export interface WeekoffOptions { includeWeekoff: boolean; includeHoliday: boolean; includeRestricted: boolean; department: string; groupBy: GroupBy }
export interface WeekoffRow { uid: string; empId: string; name: string; department: string; date: string; day: string; type: 'Weekly off' | 'Holiday' | 'Restricted holiday'; holiday: string }
export interface WeekoffGroup { key: string; title: string; rows: WeekoffRow[]; weekoffs: number; holidays: number; restricted: number }

export const defaultOptions: WeekoffOptions = { includeWeekoff: true, includeHoliday: true, includeRestricted: false, department: '', groupBy: 'none' };

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function weekoffRows(data: ReportData, o: WeekoffOptions): WeekoffRow[] {
  const rows: WeekoffRow[] = [];
  for (const p of data.people) {
    if (o.department && p.department !== o.department) continue;
    for (const d of p.days as (ReportData['people'][number]['days'][number] & { holiday?: string; optional?: boolean })[]) {
      let type: WeekoffRow['type'] | null = null;
      if (d.status === 'WEEKLY_OFF') type = 'Weekly off';
      else if (d.status === 'HOLIDAY') type = 'Holiday';
      else if (d.optional && d.holiday) type = 'Restricted holiday'; // a working day unless the person chooses to take it
      if (!type) continue;
      if ((type === 'Weekly off' && !o.includeWeekoff) || (type === 'Holiday' && !o.includeHoliday) || (type === 'Restricted holiday' && !o.includeRestricted)) continue;
      rows.push({ uid: p.uid, empId: p.empId, name: p.name, department: p.department || '', date: d.date, day: dayOf(d.date), type, holiday: d.holiday || '' });
    }
  }
  const by = (a: WeekoffRow, b: WeekoffRow) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name);
  return rows.sort(o.groupBy === 'employee' || o.groupBy === 'department' ? (a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date) : by);
}

export function groupRows(rows: WeekoffRow[], groupBy: GroupBy): WeekoffGroup[] {
  const key = (r: WeekoffRow) => groupBy === 'department' ? r.department || 'No department' : groupBy === 'employee' ? r.uid : groupBy === 'month' ? r.date.slice(0, 7) : 'all';
  const title = (r: WeekoffRow) => groupBy === 'department' ? r.department || 'No department' : groupBy === 'employee' ? `${r.empId ? r.empId + ' - ' : ''}${r.name}` : groupBy === 'month' ? `${MONTH[Number(r.date.slice(5, 7)) - 1]} ${r.date.slice(0, 4)}` : '';
  const map = new Map<string, WeekoffGroup>();
  for (const r of rows) {
    const k = key(r);
    if (!map.has(k)) map.set(k, { key: k, title: title(r), rows: [], weekoffs: 0, holidays: 0, restricted: 0 });
    const g = map.get(k)!;
    g.rows.push(r);
    if (r.type === 'Weekly off') g.weekoffs += 1; else if (r.type === 'Holiday') g.holidays += 1; else g.restricted += 1;
  }
  const out = Array.from(map.values());
  return groupBy === 'month' ? out.sort((a, b) => a.key.localeCompare(b.key)) : groupBy === 'none' ? out : out.sort((a, b) => a.title.localeCompare(b.title));
}

export function weekoffTable(rows: WeekoffRow[], groupBy: GroupBy): ReportTable {
  const grouped = groupBy !== 'none';
  const groups = groupRows(rows, groupBy);
  return {
    headers: ['Emp ID', 'Employee', 'Department', 'Date', 'Day', 'Type', 'Holiday'],
    rows: groups.flatMap((g) => g.rows.map((r) => [r.empId, r.name, r.department, longDate(r.date), r.day, r.type, r.holiday])),
    note: grouped ? `Grouped by ${groupBy}. ${groups.map((g) => `${g.title}: ${g.weekoffs} week-off, ${g.holidays} holiday${g.restricted ? `, ${g.restricted} restricted` : ''}`).join(' | ')}` : undefined,
  };
}
