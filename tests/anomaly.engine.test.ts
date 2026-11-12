import assert from 'node:assert/strict';
import { DEFAULT_FLAG_SETTINGS as S, sanitizeFlagSettings, payrollFlags, lateFlags, leaveFlags, type PayrollPerson } from '../shared/anomalyEngine';

const P = (o: Partial<PayrollPerson> & { uid: string }): PayrollPerson => ({ name: o.uid, gross: 60000, net: 52000, deductions: 8000, lopDays: 0, adjustments: 0, largestAdjustment: 0, accountKey: '', ...o });

// payroll: unexplained 21% drop is high, an explained one is medium
let f = payrollFlags('2026-11', [P({ uid: 'a', net: 41000 })], [P({ uid: 'a' })], [], S);
assert.equal(f.find((x) => x.code === 'NET_CHANGE')?.severity, 'HIGH');
f = payrollFlags('2026-11', [P({ uid: 'a', net: 41000, lopDays: 3 })], [P({ uid: 'a' })], [], S);
assert.equal(f.find((x) => x.code === 'NET_CHANGE')?.severity, 'MEDIUM');
// small change is quiet; same key on rerun
assert.equal(payrollFlags('2026-11', [P({ uid: 'a', net: 50000 })], [P({ uid: 'a' })], [], S).length, 0);
const a1 = payrollFlags('2026-11', [P({ uid: 'a', net: 41000 })], [P({ uid: 'a' })], [], S)[0];
const a2 = payrollFlags('2026-11', [P({ uid: 'a', net: 41000 })], [P({ uid: 'a' })], [], S)[0];
assert.equal(a1.key, a2.key);
// negative net, duplicate bank (account never in output), missing vs settled
f = payrollFlags('2026-11', [P({ uid: 'a', net: -5 }), P({ uid: 'b', accountKey: 'k1' }), P({ uid: 'c', accountKey: 'k1' })], [P({ uid: 'a' }), P({ uid: 'z' }), P({ uid: 'y' })], ['y'], S);
assert.ok(f.some((x) => x.code === 'NEGATIVE_NET'));
const dup = f.find((x) => x.code === 'DUPLICATE_BANK');
assert.ok(dup && !JSON.stringify(dup).includes('k1'));
assert.ok(f.some((x) => x.code === 'MISSING' && x.uid === 'z'));
assert.ok(!f.some((x) => x.code === 'MISSING' && x.uid === 'y'));
// first month (no previous): no comparison flags
assert.equal(payrollFlags('2026-11', [P({ uid: 'a', net: 41000 })], null, [], S).length, 0);
// total change
f = payrollFlags('2026-11', [P({ uid: 'a', net: 60000 }), P({ uid: 'b', net: 60000 })], [P({ uid: 'a' }), P({ uid: 'b' })], [], S);
assert.ok(f.some((x) => x.code === 'TOTAL_CHANGE'));
// switch off
assert.equal(payrollFlags('2026-11', [P({ uid: 'a', net: -1 })], null, [], { ...S, payroll: false }).length, 0);

// late marks
const days = (dates: string[], late: string[]) => dates.map((date) => ({ date, status: late.includes(date) ? 'LATE' : 'PRESENT', late: late.includes(date) }));
const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09'];
let lf = lateFlags('2026-11-12', [{ uid: 'a', name: 'A', days: days(dates, ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) }], S);
assert.equal(lf[0].code, 'LATE_MARKS');
assert.match(lf[0].message, /4 late marks.*4 of them in a row/);
assert.equal(lateFlags('2026-11-12', [{ uid: 'a', name: 'A', days: days(dates, ['2026-11-03']) }], S).length, 0);
// a weekly off between late days does not break a streak
const wk = [{ date: '2026-11-05', status: 'LATE', late: true }, { date: '2026-11-06', status: 'LATE', late: true }, { date: '2026-11-07', status: 'WEEKLY_OFF', late: false }, { date: '2026-11-09', status: 'LATE', late: true }];
assert.equal(lateFlags('2026-11-12', [{ uid: 'a', name: 'A', days: wk }], S)[0].facts.inARow, 3);

// leave patterns: Fridays (day after is weekend)
const isOff = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
const L = (from: string, o: any = {}) => ({ from, to: from, days: 1, typeName: 'Casual leave', status: 'APPROVED', createdOn: '2026-01-01', ...o });
let vf = leaveFlags('2026-11-12', [{ uid: 'a', name: 'A', isOff, requests: [L('2026-09-04'), L('2026-09-18'), L('2026-10-09')] }], S);
assert.equal(vf[0].code, 'LEAVE_NEXT_TO_OFF');
assert.equal(leaveFlags('2026-11-12', [{ uid: 'a', name: 'A', isOff, requests: [L('2026-09-04'), L('2026-09-16')] }], S).length, 0);
vf = leaveFlags('2026-11-12', [{ uid: 'a', name: 'A', isOff, requests: [L('2026-10-05', { typeName: 'Sick leave' }), L('2026-10-20', { typeName: 'Sick leave' }), L('2026-11-03', { typeName: 'Sick leave' })] }], S);
assert.ok(vf.some((x) => x.code === 'SHORT_SICK_LEAVES'));
assert.ok(!JSON.stringify(vf).toLowerCase().includes('suspicious'));

// settings are clamped
assert.equal(sanitizeFlagSettings({ latePer30: 999, payChangePct: -4 }).latePer30, 30);
assert.equal(sanitizeFlagSettings({ payChangePct: -4 }).payChangePct, 1);
assert.equal(sanitizeFlagSettings(null).latePer30, 4);
console.log('anomaly engine ok');
