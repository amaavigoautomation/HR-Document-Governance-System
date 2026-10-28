import assert from 'node:assert/strict';
import { clearanceRows, clearanceTable, clearanceTotals, groupClearance, type ClearanceOptions, type ExitView } from '../src/components/employee/exitClearanceReport.ts';
import { printHtml } from '../src/components/leave/attendanceReports.ts';

const ex = (uid: string, name: string, status: string, last: string, clearance: any[], at = '2026-10-10T08:00:00Z', extra: any = {}): ExitView => ({
  uid, status, lastWorkingDay: last, requestedLastDay: last, resignationDate: '2026-09-01', docNo: `SEP-${uid}`,
  employee: { name, empId: uid.toUpperCase(), department: 'Ops' }, clearance, events: [{ at }], ...extra,
});
const c = (deptId: string, label: string, status: string, o: any = {}) => ({ deptId, label, ownerName: 'Owner ' + deptId, status, dues: 0, note: '', ...o });
const exits: ExitView[] = [
  ex('a', 'Asha', 'APPROVED', '2026-10-20', [c('it', 'IT assets', 'CLEARED', { by: 'Ian', at: '2026-10-12T10:00:00Z' }), c('fin', 'Finance', 'DUES', { dues: 5000, note: 'Advance' }), c('hr', 'HR', 'PENDING')]),
  ex('b', 'Bo', 'SUBMITTED', '2026-11-05', []),
  ex('c', 'Cy', 'COMPLETED', '2026-08-15', [c('it', 'IT assets', 'CLEARED'), c('fin', 'Finance', 'WAIVED')], '2026-08-16T08:00:00Z'),
  ex('d', 'Di', 'WITHDRAWN', '', [], '2026-10-01T08:00:00Z', { requestedLastDay: '' }),
];
const all: ClearanceOptions = { leavingFrom: '', leavingTill: '', statusFrom: '', statusTill: '', taskStatus: 'ALL', taskRole: '', uid: 'ALL', exitStatus: '' };

let rows = clearanceRows(exits, all);
assert.equal(rows.length, 3 + 1 + 2 + 1, 'one row per clearance item; an exit with none shows one "not started" line');
assert.deepEqual(rows.map((r) => r.name).filter((n, i, a) => a.indexOf(n) === i), ['Di', 'Cy', 'Asha', 'Bo'], 'earliest last day first, no date first');
assert.equal(rows.find((r) => r.name === 'Bo')!.status, 'NOT_STARTED');

rows = clearanceRows(exits, { ...all, leavingFrom: '2026-10-01', leavingTill: '2026-10-31' });
assert.deepEqual(rows.map((r) => r.name), ['Asha', 'Asha', 'Asha'], 'leaving window; exits with no date are left out');
assert.equal(clearanceRows(exits, { ...all, statusFrom: '2026-10-05' }).every((r) => r.name === 'Asha' || r.name === 'Bo'), true, 'status date window uses the newest history entry');
assert.equal(clearanceRows(exits, { ...all, statusTill: '2026-09-30' }).every((r) => r.name === 'Cy'), true);
assert.deepEqual(clearanceRows(exits, { ...all, taskStatus: 'DUES' }).map((r) => [r.name, r.dues]), [['Asha', 5000]], 'task status filter hides the not-started lines');
assert.deepEqual(clearanceRows(exits, { ...all, taskRole: 'it' }).map((r) => r.name), ['Cy', 'Asha']);
assert.deepEqual(clearanceRows(exits, { ...all, uid: 'c' }).map((r) => r.name), ['Cy', 'Cy']);
assert.deepEqual(clearanceRows(exits, { ...all, exitStatus: 'COMPLETED' }).map((r) => r.name), ['Cy', 'Cy']);

const g = groupClearance(clearanceRows(exits, all));
const asha = g.find((x) => x.uid === 'a')!;
assert.deepEqual([asha.done, asha.total, asha.dues], [1, 3, 5000], 'pending and dues are not "done"');
assert.deepEqual([g.find((x) => x.uid === 'c')!.done, g.find((x) => x.uid === 'c')!.total], [2, 2], 'waived counts as done');
assert.deepEqual([g.find((x) => x.uid === 'b')!.done, g.find((x) => x.uid === 'b')!.total], [0, 0], 'not started is not counted');
const t = clearanceTotals(clearanceRows(exits, all));
assert.deepEqual(t, { employees: 4, pending: 1, withDues: 1, dues: 5000 });
const tbl = clearanceTable(clearanceRows(exits, all));
assert.equal(tbl.headers.length, tbl.rows[0].length);
assert.match(tbl.note!, /4 employees · 1 pending · 1 with dues · Rs. 5,000 owed/);

// one-page print gets a landscape page and a zoom that shrinks with the row count
const small = printHtml('T', 's', { headers: ['A'], rows: [['x']] }, '', true);
const big = printHtml('T', 's', { headers: ['A'], rows: Array.from({ length: 100 }, () => ['x']) }, '', true);
assert.ok(small.includes('landscape') && small.includes('zoom:1.00'));
assert.ok(big.includes('zoom:0.38'));
assert.ok(!printHtml('T', 's', { headers: ['A'], rows: [['x']] }).includes('landscape'), 'normal print is untouched');

console.log('exit clearance report tests passed');
