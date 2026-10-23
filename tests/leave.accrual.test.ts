import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { balanceOf, companyLedger, runAccrual } from '../api/_lib/leaveCore.ts';
import { cycleOf, starterSettings } from '../shared/leaveEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: {} });
const CID = 'c1';
fdb.seed('employees', 'u1', { companyId: CID, authUid: 'u1', name: 'A', email: 'a@x.com', active: true, createdAt: '2020-01-01T00:00:00Z' });
const ASOF = '2026-10-23';

const settings = starterSettings(2026);
settings.yearStartMonth = 1;
const entry = (accrual: string, quota: number) => ({ typeId: 'cl', quota, accrual, carryForward: false, carryCap: 0 });
const setPolicy = (accrual: string, quota: number) => {
  settings.policies = [{ id: 'std', name: 'Std', isDefault: true, entries: [entry(accrual, quota)] } as any];
  fdb.seed('leaveSettings', CID, { ...settings, companyId: CID });
};
const cycle = cycleOf(ASOF, 1).key;
const bal = async () => balanceOf(await companyLedger(CID), 'cl', cycle);

// monthly: 10 months credited by 23 October
setPolicy('MONTHLY', 13);
await runAccrual(CID, ASOF);
assert.equal(await bal(), 10.8);
await runAccrual(CID, ASOF);
assert.equal(await bal(), 10.8, 'running again changes nothing');

// switch to upfront: only the missing part is credited, never a second full year
setPolicy('UPFRONT', 13);
await runAccrual(CID, ASOF);
assert.equal(await bal(), 13, 'the year is topped up to 13, not 23.8');
await runAccrual(CID, ASOF);
assert.equal(await bal(), 13);

// switching back to monthly never takes credit away or adds again
setPolicy('MONTHLY', 13);
await runAccrual(CID, ASOF);
assert.equal(await bal(), 13);

// a ledger already doubled by the old behaviour is repaired once
const dup = new FakeFirestore();
__useFakeAdmin({ db: dup, auth: {} });
dup.seed('employees', 'u1', { companyId: CID, authUid: 'u1', name: 'A', email: 'a@x.com', active: true, createdAt: '2020-01-01T00:00:00Z' });
settings.policies = [{ id: 'std', name: 'Std', isDefault: true, entries: [entry('UPFRONT', 13)] } as any];
dup.seed('leaveSettings', CID, { ...settings, companyId: CID });
for (let m = 1; m <= 10; m++) {
  const p = `M2026-${String(m).padStart(2, '0')}`;
  dup.seed('leaveLedger', `ACC_u1_cl_${cycle}_${p}`, { companyId: CID, uid: 'u1', typeId: 'cl', cycle, delta: 1.08, kind: 'ACCRUAL', date: `2026-${String(m).padStart(2, '0')}-01`, ref: p, createdAt: 'x' });
}
dup.seed('leaveLedger', `ACC_u1_cl_${cycle}_U`, { companyId: CID, uid: 'u1', typeId: 'cl', cycle, delta: 13, kind: 'ACCRUAL', date: '2026-01-01', ref: 'U', createdAt: 'x' });
assert.equal(balanceOf(await companyLedger(CID), 'cl', cycle), 23.8);
await runAccrual(CID, ASOF);
assert.equal(balanceOf(await companyLedger(CID), 'cl', cycle), 13, 'excess taken back so the year totals 13');
await runAccrual(CID, ASOF);
assert.equal(balanceOf(await companyLedger(CID), 'cl', cycle), 13, 'and only once');

console.log('leave accrual tests passed');
