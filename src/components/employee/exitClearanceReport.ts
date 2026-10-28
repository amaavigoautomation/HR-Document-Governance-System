import { EXIT_STATUS_LABEL } from '../../../shared/lifecycleEngine';
import { longDate, type ReportTable } from '../leave/attendanceReports';

/** Exit Clearance Report: every clearance item of every exit that matches, with who still has to sign off and what is owed. */
export interface ExitView {
  uid: string; status: string; lastWorkingDay: string; requestedLastDay: string; resignationDate: string; docNo?: string;
  employee: { name: string; empId: string; department: string };
  clearance: { deptId: string; label: string; ownerName?: string; status: string; dues: number; note: string; by?: string; at?: string }[];
  events: { at: string }[];
}
export type TaskStatus = 'ALL' | 'PENDING' | 'CLEARED' | 'DUES' | 'WAIVED';
export interface ClearanceOptions {
  leavingFrom: string; leavingTill: string; statusFrom: string; statusTill: string;
  taskStatus: TaskStatus; taskRole: string; uid: string; exitStatus: string;
}
export interface ClearanceRow {
  uid: string; empId: string; name: string; department: string; lastWorkingDay: string; exitStatus: string; docNo: string;
  item: string; owner: string; status: string; dues: number; note: string; doneBy: string; doneOn: string;
}
export interface ClearanceGroup { uid: string; title: string; exitStatus: string; lastWorkingDay: string; docNo: string; rows: ClearanceRow[]; done: number; total: number; dues: number }

export const TASK_STATUS_LABEL: Record<string, string> = { PENDING: 'Pending', CLEARED: 'Cleared', DUES: 'Dues', WAIVED: 'Waived', NOT_STARTED: 'Not started' };
const leaving = (e: ExitView) => e.lastWorkingDay || e.requestedLastDay || '';
/** The day the case last changed: its newest history entry. */
const statusDay = (e: ExitView) => (e.events.length ? e.events[e.events.length - 1].at.slice(0, 10) : e.resignationDate);

export function clearanceRows(exits: ExitView[], o: ClearanceOptions): ClearanceRow[] {
  const rows: ClearanceRow[] = [];
  for (const e of exits) {
    const lw = leaving(e);
    if (o.uid !== 'ALL' && e.uid !== o.uid) continue;
    if (o.exitStatus && e.status !== o.exitStatus) continue;
    if (o.leavingFrom && (!lw || lw < o.leavingFrom)) continue;
    if (o.leavingTill && (!lw || lw > o.leavingTill)) continue;
    const sd = statusDay(e);
    if (o.statusFrom && sd < o.statusFrom) continue;
    if (o.statusTill && sd > o.statusTill) continue;
    const base = { uid: e.uid, empId: e.employee.empId, name: e.employee.name, department: e.employee.department, lastWorkingDay: lw, exitStatus: EXIT_STATUS_LABEL[e.status as keyof typeof EXIT_STATUS_LABEL] || e.status, docNo: e.docNo || '' };
    // Clearance opens only once the exit is approved. Until then the person still shows up, with one "not started" line.
    if (e.clearance.length === 0) {
      if (o.taskStatus === 'ALL' && !o.taskRole) rows.push({ ...base, item: '—', owner: '', status: 'NOT_STARTED', dues: 0, note: '', doneBy: '', doneOn: '' });
      continue;
    }
    for (const c of e.clearance) {
      if (o.taskStatus !== 'ALL' && c.status !== o.taskStatus) continue;
      if (o.taskRole && c.deptId !== o.taskRole) continue;
      rows.push({ ...base, item: c.label, owner: c.ownerName || '', status: c.status, dues: c.status === 'DUES' ? c.dues || 0 : 0, note: c.note || '', doneBy: c.by || '', doneOn: c.at ? c.at.slice(0, 10) : '' });
    }
  }
  return rows.sort((a, b) => a.lastWorkingDay.localeCompare(b.lastWorkingDay) || a.name.localeCompare(b.name));
}

export function groupClearance(rows: ClearanceRow[]): ClearanceGroup[] {
  const map = new Map<string, ClearanceGroup>();
  for (const r of rows) {
    if (!map.has(r.uid)) map.set(r.uid, { uid: r.uid, title: `${r.empId ? r.empId + ' - ' : ''}${r.name}`, exitStatus: r.exitStatus, lastWorkingDay: r.lastWorkingDay, docNo: r.docNo, rows: [], done: 0, total: 0, dues: 0 });
    const g = map.get(r.uid)!;
    g.rows.push(r);
    if (r.status !== 'NOT_STARTED') { g.total += 1; if (r.status !== 'PENDING' && r.status !== 'DUES') g.done += 1; }
    g.dues += r.dues;
  }
  return Array.from(map.values());
}

export function clearanceTotals(rows: ClearanceRow[]) {
  const groups = groupClearance(rows);
  return { employees: groups.length, pending: rows.filter((r) => r.status === 'PENDING').length, withDues: rows.filter((r) => r.status === 'DUES').length, dues: Math.round(rows.reduce((n, r) => n + r.dues, 0) * 100) / 100 };
}

export function clearanceTable(rows: ClearanceRow[]): ReportTable {
  const t = clearanceTotals(rows);
  return {
    headers: ['Emp ID', 'Employee', 'Department', 'Last working day', 'Exit status', 'Clearance item', 'Owner', 'Status', 'Dues (Rs.)', 'Note', 'Cleared by', 'Cleared on'],
    rows: rows.map((r) => [r.empId, r.name, r.department, r.lastWorkingDay ? longDate(r.lastWorkingDay) : '', r.exitStatus, r.item, r.owner, TASK_STATUS_LABEL[r.status] || r.status, r.dues || '', r.note, r.doneBy, r.doneOn ? longDate(r.doneOn) : '']),
    note: `${t.employees} employee${t.employees === 1 ? '' : 's'} · ${t.pending} pending · ${t.withDues} with dues · Rs. ${t.dues.toLocaleString('en-IN')} owed`,
  };
}
