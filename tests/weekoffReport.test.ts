import assert from 'node:assert/strict';
import { defaultOptions, groupRows, weekoffRows, weekoffTable } from '../src/components/employee/weekoffReport.ts';
import { printHtml, type ReportData } from '../src/components/leave/attendanceReports.ts';

const day = (date: string, status: string, o: any = {}) => ({ date, status, checkIn: null, checkOut: null, workedMinutes: 0, late: false, sessions: [], ...o });
const data: ReportData = {
  from: '2026-10-17', to: '2026-10-21', today: '2026-10-28',
  shift: { start: '09:00', end: '18:30', graceMinutes: 15, fullDayMinutes: 480 },
  people: [
    { uid: 'a', name: 'Asha', empId: 'E1', department: 'Ops', days: [
      day('2026-10-17', 'WEEKLY_OFF'), day('2026-10-18', 'WEEKLY_OFF'), day('2026-10-19', 'PRESENT'),
      day('2026-10-20', 'HOLIDAY', { holiday: 'Diwali' }), day('2026-10-21', 'PRESENT', { holiday: 'Optional Day', optional: true }),
    ] },
    { uid: 'b', name: 'Bo', empId: 'E2', department: 'Sales', days: [day('2026-10-17', 'WEEKLY_OFF'), day('2026-10-20', 'HOLIDAY', { holiday: 'Diwali' }), day('2026-10-21', 'ABSENT')] },
  ],
};

let rows = weekoffRows(data, defaultOptions);
assert.equal(rows.length, 5, '3 week-offs + 2 holidays; restricted is off by default');
assert.deepEqual(rows.map((r) => r.type).filter((t) => t === 'Restricted holiday'), []);
assert.equal(rows[0].date, '2026-10-17'); assert.equal(rows[0].name, 'Asha', 'sorted by date then name');
assert.equal(weekoffRows(data, { ...defaultOptions, includeRestricted: true }).length, 6);
assert.equal(weekoffRows(data, { ...defaultOptions, includeRestricted: true }).find((r) => r.type === 'Restricted holiday')!.holiday, 'Optional Day');
assert.equal(weekoffRows(data, { ...defaultOptions, includeWeekoff: false }).every((r) => r.type === 'Holiday'), true);
assert.equal(weekoffRows(data, { ...defaultOptions, includeHoliday: false }).every((r) => r.type === 'Weekly off'), true);
assert.equal(weekoffRows(data, { ...defaultOptions, department: 'Sales' }).length, 2);
assert.equal(weekoffRows(data, { ...defaultOptions, includeWeekoff: false, includeHoliday: false }).length, 0);

const byDept = groupRows(weekoffRows(data, { ...defaultOptions, groupBy: 'department' }), 'department');
assert.deepEqual(byDept.map((g) => [g.title, g.weekoffs, g.holidays]), [['Ops', 2, 1], ['Sales', 1, 1]]);
const byEmp = groupRows(weekoffRows(data, { ...defaultOptions, groupBy: 'employee' }), 'employee');
assert.deepEqual(byEmp.map((g) => g.title), ['E1 - Asha', 'E2 - Bo']);
assert.equal(groupRows(rows, 'month')[0].title, 'October 2026');
assert.equal(groupRows(rows, 'none').length, 1);

const t = weekoffTable(rows, 'none');
assert.equal(t.rows.length, 5); assert.equal(t.headers[0], 'Emp ID'); assert.equal(t.note, undefined);
assert.match(weekoffTable(rows, 'department').note!, /Ops: 2 week-off, 1 holiday/);
// the printed page names the company and escapes everything
const html = printHtml('Weekoff Holiday Report', 'Oct', { headers: ['A'], rows: [['<b>x</b>']] }, 'Acme <Ltd>');
assert.ok(html.includes('Acme &lt;Ltd&gt;') && html.includes('&lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'));
assert.ok(!printHtml('T', 's', { headers: [], rows: [] }).includes('letter-spacing'), 'no company line when none is given');

console.log('weekoff report tests passed');
