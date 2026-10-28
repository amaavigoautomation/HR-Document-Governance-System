import assert from 'node:assert/strict';
import { buildReport, pendingTable, printHtml, type ReportData } from '../src/components/leave/attendanceReports.ts';

const day = (date: string, status: string, o: any = {}) => ({ date, status, checkIn: null, checkOut: null, workedMinutes: 0, late: false, sessions: [], ...o });
const data: ReportData = {
  from: '2026-10-19', to: '2026-10-23', today: '2026-10-28',
  shift: { start: '09:00', end: '18:30', graceMinutes: 15, fullDayMinutes: 480 },
  people: [
    { uid: 'a', name: 'Asha', empId: 'E1', department: 'Ops', days: [
      day('2026-10-19', 'PRESENT', { checkIn: '09:00', checkOut: '18:30', workedMinutes: 540, sessions: [{ in: '09:00', out: '13:00', inNote: 'hi' }, { in: '14:00', out: '18:30' }] }),
      day('2026-10-20', 'LATE', { checkIn: '09:40', checkOut: '18:30', workedMinutes: 530, late: true, sessions: [{ in: '09:40', out: '18:30' }] }),
      day('2026-10-21', 'ABSENT'),
      day('2026-10-22', 'HALF_DAY', { checkIn: '10:00', checkOut: '13:00', workedMinutes: 180, sessions: [{ in: '10:00', out: '13:00' }] }),
      day('2026-10-23', 'INCOMPLETE', { checkIn: '09:00', sessions: [{ in: '09:00', out: null }] }),
    ] },
    { uid: 'b', name: 'Bo', empId: 'E2', department: 'Ops', days: [day('2026-10-19', 'ABSENT'), day('2026-10-20', 'WEEKLY_OFF')] },
  ],
};
const opt = { fromTime: '00:00', tillTime: '23:59' };

assert.equal(buildReport('absent', data, opt).rows.length, 2);
assert.deepEqual(buildReport('late-coming', data, opt).rows.map((r) => r[5]), [40], 'late by minutes after the shift start');
assert.equal(buildReport('half-day', data, opt).rows.length, 1);
assert.equal(buildReport('missed-punch', data, opt).rows.length, 1);
// Early going: only days that were worked and ended before 18:30 (the half day left at 13:00)
const early = buildReport('early-going', data, opt);
assert.equal(early.rows.length, 1);
assert.equal(early.rows[0][early.headers.indexOf('Early by (min)')], 330);
// Time away is the gap between first in and last out that was not worked: 09:00-18:30 = 570, worked 540 -> 0:30
const sum = buildReport('in-out-summary', data, opt);
assert.equal(sum.rows[0][sum.headers.indexOf('Time away')], '00:30');
assert.equal(sum.rows[0][sum.headers.indexOf('In/out pairs')], 2);
// Totals per employee
const emp = buildReport('employee-attendance', data, opt);
assert.equal(emp.rows[0][emp.headers.indexOf('Present')], 2);
assert.equal(emp.rows[0][emp.headers.indexOf('Absent')], 1);
assert.equal(emp.rows[1][emp.headers.indexOf('Weekly offs')], 1);
// In/out activity filters by time of day
assert.equal(buildReport('in-out-activity', data, opt).rows.length, 9);
assert.equal(buildReport('in-out-activity', data, { fromTime: '13:30', tillTime: '23:59' }).rows.length, 3, 'only punches after 13:30');
// Daily detail leaves out days before joining / future
assert.equal(buildReport('daily-detail', { ...data, people: [{ ...data.people[0], days: [day('2026-10-01', 'NOT_EMPLOYED'), day('2026-10-30', 'FUTURE')] }] }, opt).rows.length, 0);

assert.equal(pendingTable([{ docNo: 'AA-1', name: 'Asha', date: '2026-10-20', checkIn: '', checkOut: '19:00', reason: 'r', appliedByName: 'Asha', appliedOn: '2026-10-21', waitingDays: 7 }]).rows[0][3], 'unchanged');
assert.ok(!printHtml('T', 's', { headers: ['<b>'], rows: [['<script>x</script>']] }).includes('<script>'), 'values are escaped in the print page');
console.log('attendance reports tests passed');
