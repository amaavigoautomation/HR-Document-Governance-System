import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHrbp } from '../api/_lib/hrbpApi.ts';
import { sweepProbation, sweepQuarterly } from '../api/_lib/talentCycleApi.ts';
import {
  addDays, addMonths, elapsedFraction, krProgress, objectiveProgress, okrStatus, probationMilestones, probationReminders, promoTransition, quarterBounds, quarterOf,
} from '../shared/talentCycle.ts';

// ---- pure rules
assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
const pm = probationMilestones('2026-01-10', 3);
assert.equal(pm.endDate, '2026-04-10');
assert.deepEqual(pm.milestones.map((m) => m.key), ['d30', 'd60', 'd90']);
assert.equal(pm.milestones[2].final, true);
assert.equal(pm.milestones[0].dueOn, '2026-02-09');
assert.deepEqual(probationMilestones('2026-01-10', 6).milestones.map((m) => m.key), ['d30', 'd60', 'd90', 'final']);
assert.deepEqual(probationMilestones('2026-01-10', 1).milestones.map((m) => m.key), ['d30'], 'a short probation still gets its reviews');
const ms = pm.milestones;
assert.deepEqual(probationReminders(ms, '2026-02-07').map((r) => r.type), ['soon']);
assert.deepEqual(probationReminders(ms, '2026-02-09').map((r) => r.type), ['due']);
assert.deepEqual(probationReminders(ms, '2026-02-12').map((r) => r.type), ['late']);
assert.deepEqual(probationReminders(ms, '2026-02-09', ['due:d30']), [], 'no repeat');
assert.deepEqual(probationReminders(ms.map((m, i) => (i === 0 ? { ...m, status: 'SUBMITTED' as const } : m)), '2026-02-12'), [], 'submitted reviews are not chased');
assert.equal(krProgress({ start: 0, target: 100, current: 50 }), 0.5);
assert.equal(krProgress({ start: 40, target: 10, current: 25 }), 0.5, 'a target that goes down');
assert.equal(krProgress({ start: 0, target: 10, current: 99 }), 1, 'capped at 100%');
assert.equal(krProgress({ start: 5, target: 5, current: 5 }), 1);
assert.equal(objectiveProgress([{ start: 0, target: 10, current: 10, weight: 3 }, { start: 0, target: 10, current: 0, weight: 1 }]), 0.75);
assert.equal(okrStatus(0.5, 0.5), 'ON_TRACK');
assert.equal(okrStatus(0.35, 0.5), 'AT_RISK');
assert.equal(okrStatus(0.1, 0.5), 'OFF_TRACK');
assert.equal(okrStatus(1, 0.2), 'DONE');
assert.deepEqual(quarterBounds('2026-Q4'), { start: '2026-10-01', end: '2026-12-31' });
assert.equal(quarterOf('2026-11-02'), '2026-Q4');
assert.equal(elapsedFraction('2026-Q4', '2026-09-01'), 0);
assert.equal(elapsedFraction('2026-Q4', '2027-02-01'), 1);
assert.equal(promoTransition('PROPOSED', 'approve').ok, false, 'HR must recommend first');
assert.equal(promoTransition('HR_RECOMMENDED', 'approve').ok, true);
assert.equal(promoTransition('APPLIED', 'withdraw').ok, false);

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['hrbp.manage']);
const FOUNDER = tok('u_f', ['req.founder_decide']);
const MGR = tok('u_m');
const EMP = tok('u_e');
const OTHER = tok('u_o');
const OUT = tok('u_x', ['hrbp.manage'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHrbp({ method, action, headers: h, body, query });
const person = (id: string, name: string, extra: any = {}) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: 'Eng', title: 'Developer', createdAt: '2026-01-05T00:00:00Z', ...extra });
person('u_hr', 'Hana HR'); person('u_f', 'Fay Founder'); person('u_m', 'Mona Manager', { title: 'Lead' }); person('u_e', 'Eli Employee'); person('u_o', 'Olu Other');
fdb.seed('leaveProfiles', `${CID}__u_e`, { uid: 'u_e', companyId: CID, managerUid: 'u_m', joinDate: '2026-10-20' });
fdb.seed('leaveProfiles', `${CID}__u_o`, { uid: 'u_o', companyId: CID, managerUid: 'u_f', joinDate: '2026-01-05' });
const day = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

async function main() {
  // ---- access
  assert.equal((await call(EMP, 'POST', 'prob-start', { uid: 'u_e' })).status, 403);
  assert.equal((await call({}, 'GET', 'prob-list')).status, 401);
  assert.equal((await call(HR, 'POST', 'prob-list')).status, 405);

  // ---- probation
  assert.equal((await call(HR, 'POST', 'prob-start', { uid: 'nobody' })).status, 404);
  assert.equal((await call(HR, 'POST', 'prob-start', { uid: 'u_e', months: 20 })).status, 400);
  const st = await call(HR, 'POST', 'prob-start', { uid: 'u_e', joinDate: day(-25), months: 3 });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const pid = st.json.item.id;
  assert.equal(st.json.item.managerUid, 'u_m', 'manager comes from the reporting line');
  assert.equal(st.json.item.milestones.length, 3);
  assert.equal((await call(HR, 'POST', 'prob-start', { uid: 'u_e' })).status, 409);
  assert.equal((await call(OUT, 'POST', 'prob-feedback', { id: pid })).status, 404);
  assert.equal((await call(OTHER, 'POST', 'prob-feedback', { id: pid, key: 'd30', rating: 4, recommendation: 'CONTINUE' })).status, 403, 'not their manager');
  assert.equal((await call(MGR, 'POST', 'prob-feedback', { id: pid, key: 'd30', rating: 9, recommendation: 'CONTINUE' })).status, 400);
  assert.equal((await call(MGR, 'POST', 'prob-feedback', { id: pid, key: 'd30', rating: 4, recommendation: 'MAYBE' })).status, 400);
  assert.equal((await call(MGR, 'POST', 'prob-feedback', { id: pid, key: 'd99', rating: 4, recommendation: 'CONTINUE' })).status, 404);
  assert.equal((await call(MGR, 'POST', 'prob-feedback', { id: pid, key: 'd30', rating: 4, kpiPct: 82, recommendation: 'CONTINUE', strengths: 'Learns fast', improvements: 'Estimates' })).status, 200);
  // the employee sees dates and status, not what the manager wrote
  const mine = (await call(EMP, 'GET', 'prob-list')).json.items;
  assert.equal(mine.length, 1);
  assert.equal(JSON.stringify(mine[0]).includes('Learns fast'), false);
  assert.equal(JSON.stringify((await call(MGR, 'GET', 'prob-list')).json.items).includes('Learns fast'), true);
  assert.equal((await call(OTHER, 'GET', 'prob-list')).json.items.length, 0, 'olu is neither the employee nor the manager of this case');
  assert.equal((await call(OUT, 'GET', 'prob-list')).json.items.length, 0);
  // decisions
  assert.equal((await call(MGR, 'POST', 'prob-decide', { id: pid, decision: 'CONFIRM' })).status, 403, 'only HR decides');
  assert.equal((await call(HR, 'POST', 'prob-decide', { id: pid, decision: 'MAYBE' })).status, 400);
  assert.equal((await call(HR, 'POST', 'prob-decide', { id: pid, decision: 'EXTEND', extendMonths: 2 })).status, 400, 'a reason is required');
  const ext = await call(HR, 'POST', 'prob-decide', { id: pid, decision: 'EXTEND', extendMonths: 2, note: 'Needs more time on estimates' });
  assert.equal(ext.status, 200, JSON.stringify(ext.json));
  assert.equal(ext.json.item.status, 'ACTIVE');
  assert.equal(ext.json.item.months, 5);
  assert.equal(ext.json.item.milestones.length, 4, 'an extension review was added');
  assert.equal(ext.json.item.milestones.filter((m: any) => m.final).length, 1);
  // a concern blocks a plain confirmation
  await call(MGR, 'POST', 'prob-feedback', { id: pid, key: 'd60', rating: 2, recommendation: 'CONCERN', improvements: 'Missed deadlines' });
  const blocked = await call(HR, 'POST', 'prob-decide', { id: pid, decision: 'CONFIRM' });
  assert.equal(blocked.status, 400);
  assert.ok(/concern/i.test(blocked.json.error));
  fdb.seed('hrbpItems', 'map1', { id: 'map1', companyId: CID, kind: 'mapping', employeeUid: 'u_e', employmentStatus: 'PROBATION' });
  const [d1, d2] = await Promise.all([
    call(HR, 'POST', 'prob-decide', { id: pid, decision: 'CONFIRM', override: true, note: 'Improved since, Mona agrees' }),
    call(HR, 'POST', 'prob-decide', { id: pid, decision: 'TERMINATE', note: 'x' }),
  ]);
  assert.deepEqual([d1.status, d2.status].sort(), [200, 409], 'two decisions cannot both land');
  const decided = fdb.all('hrbpItems').find((x) => x.id === pid)!;
  if (decided.status === 'CONFIRMED') assert.equal(fdb.all('hrbpItems').find((x) => x.id === 'map1')!.employmentStatus, 'CONFIRMED', 'the HRBP mapping follows');
  assert.equal((await call(MGR, 'POST', 'prob-feedback', { id: pid, key: 'd90', rating: 3, recommendation: 'CONTINUE' })).status, 409, 'decided probations are closed');

  // ---- probation reminders go once
  fdb.seed('hrbpItems', 'p2', { id: 'p2', companyId: CID, kind: 'prob', uid: 'u_o', name: 'Olu Other', status: 'ACTIVE', managerUid: 'u_f', endDate: day(60), milestones: [{ key: 'd30', label: '30-day review', dueOn: day(2), status: 'PENDING' }], remindersSent: [] });
  assert.equal((await sweepProbation()).reminded, 1);
  assert.equal((await sweepProbation()).reminded, 0, 'the same reminder is not sent twice');

  // ---- OKRs
  assert.equal((await call(MGR, 'POST', 'okr-save', { level: 'COMPANY', title: 'Grow', quarter: '2026-Q4', keyResults: [{ title: 'ARR', start: 0, target: 10, unit: 'cr' }] })).status, 403, 'only HR sets company objectives');
  const co = await call(HR, 'POST', 'okr-save', { level: 'COMPANY', title: 'Win the year', quarter: '2026-Q4', keyResults: [{ title: 'Revenue', start: 0, target: 10, unit: 'cr' }] });
  assert.equal(co.status, 200, JSON.stringify(co.json));
  assert.equal((await call(EMP, 'POST', 'okr-save', { title: 'Ship', quarter: '2026-Q4', keyResults: [] })).status, 400);
  assert.equal((await call(EMP, 'POST', 'okr-save', { title: 'Ship', quarter: '2026-Q4', keyResults: [{ title: 'Bugs', start: 'x', target: 1 }] })).status, 400);
  assert.equal((await call(EMP, 'POST', 'okr-save', { title: 'Ship', quarter: '2026-Q4', ownerUid: 'u_o', keyResults: [{ title: 'Bugs', start: 40, target: 10 }] })).status, 403, 'not for someone else');
  const mineOkr = await call(EMP, 'POST', 'okr-save', { title: 'Ship the portal', quarter: '2026-Q4', parentId: co.json.item.id, keyResults: [{ title: 'Open bugs', start: 40, target: 10, unit: 'bugs', weight: 2 }, { title: 'Pages shipped', start: 0, target: 5 }] });
  assert.equal(mineOkr.status, 200, JSON.stringify(mineOkr.json));
  assert.equal(mineOkr.json.item.parentId, co.json.item.id);
  assert.equal(mineOkr.json.item.managerUid, 'u_m');
  const oid = mineOkr.json.item.id;
  assert.equal((await call(OTHER, 'POST', 'okr-update', { id: oid, krId: 'x', current: 1 })).status, 403);
  const krId = mineOkr.json.item.keyResults[0].id;
  const upd = await call(MGR, 'POST', 'okr-update', { id: oid, krId, current: 25, note: 'Triage done' });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.item.keyResults[0].progress, 50);
  assert.equal((await call(EMP, 'POST', 'okr-update', { id: oid, krId, current: 'lots' })).status, 400);
  assert.equal((await call(EMP, 'POST', 'okr-update', { id: oid, krId: 'nope', current: 1 })).status, 404);
  assert.equal((await call(EMP, 'GET', 'okr-list', {}, { quarter: '2026-Q4' })).json.items.length, 2, 'own objective plus the company one');
  assert.equal((await call(OTHER, 'GET', 'okr-list', {}, { quarter: '2026-Q4' })).json.items.length, 1, 'others see only the company objective');
  assert.equal((await call(HR, 'GET', 'okr-list', {}, { quarter: '2026-Q4' })).json.items.length, 2);
  assert.equal((await call(OUT, 'GET', 'okr-list', {}, { quarter: '2026-Q4' })).json.items.length, 0);
  assert.equal((await call(EMP, 'POST', 'okr-delete', { id: oid })).status, 403, 'cannot delete once progress is recorded');
  assert.equal((await call(EMP, 'POST', 'okr-close', { id: oid, reflection: 'Good quarter' })).json.item.state, 'CLOSED');
  assert.equal((await call(EMP, 'POST', 'okr-update', { id: oid, krId, current: 30 })).status, 409);
  assert.equal((await call(EMP, 'POST', 'okr-close', { id: oid })).status, 409);

  // ---- promotions
  assert.equal((await call(OTHER, 'POST', 'promo-propose', { uid: 'u_e', toTitle: 'Senior Developer', effectiveDate: day(30), justification: 'x'.repeat(40) })).status, 403, 'only the manager or HR');
  assert.equal((await call(MGR, 'POST', 'promo-propose', { uid: 'u_e', toTitle: 'Senior Developer', effectiveDate: day(30), justification: 'short' })).status, 400);
  assert.equal((await call(MGR, 'POST', 'promo-propose', { uid: 'u_m', toTitle: 'Head', effectiveDate: day(30), justification: 'x'.repeat(40) })).status, 400, 'no self-promotion');
  const pr = await call(MGR, 'POST', 'promo-propose', { uid: 'u_e', toTitle: 'Senior Developer', newCtcLpa: 14, effectiveDate: day(30), justification: 'Delivered the portal and mentored two juniors this quarter.' });
  assert.equal(pr.status, 200, JSON.stringify(pr.json));
  const prId = pr.json.item.id;
  assert.equal((await call(MGR, 'POST', 'promo-propose', { uid: 'u_e', toTitle: 'Lead', effectiveDate: day(30), justification: 'x'.repeat(40) })).status, 409, 'one at a time');
  assert.equal((await call(FOUNDER, 'POST', 'promo-act', { id: prId, action: 'approve' })).status, 409, 'founder only after HR recommends');
  assert.equal((await call(MGR, 'POST', 'promo-act', { id: prId, action: 'recommend' })).status, 403);
  assert.equal((await call(HR, 'POST', 'promo-act', { id: prId, action: 'recommend' })).status, 200);
  assert.equal((await call(HR, 'POST', 'promo-act', { id: prId, action: 'approve' })).status, 403, 'HR cannot approve');
  assert.equal((await call(FOUNDER, 'POST', 'promo-act', { id: prId, action: 'approve' })).status, 200);
  assert.equal((await call(HR, 'POST', 'promo-act', { id: prId, action: 'recommend' })).status, 409);
  const applied = await call(HR, 'POST', 'promo-act', { id: prId, action: 'apply' });
  assert.equal(applied.status, 200);
  assert.ok(applied.json.next.includes('14 LPA'), 'HR is told to create the salary revision');
  assert.equal(fdb.all('employees').find((e) => e.id === 'u_e')!.title, 'Senior Developer', 'the designation is updated');
  assert.equal((await call(MGR, 'GET', 'promo-list')).json.items.length, 1);
  assert.equal((await call(OTHER, 'GET', 'promo-list')).json.items.length, 0);

  // ---- quarterly review round
  assert.equal((await call(EMP, 'GET', 'qc-list')).status, 403);
  assert.equal((await call(HR, 'POST', 'qc-open', { quarter: '2026-Q9' })).status, 400);
  const qc = await call(HR, 'POST', 'qc-open', { quarter: '2026-Q4' });
  assert.equal(qc.status, 200);
  assert.equal(qc.json.item.dueOn, '2027-01-15');
  assert.equal((await call(HR, 'POST', 'qc-open', { quarter: '2026-Q4' })).status, 409);
  assert.equal((await call(HR, 'POST', 'qc-tick', { id: qc.json.item.id, key: 'nope' })).status, 404);
  assert.equal((await call(HR, 'POST', 'qc-tick', { id: qc.json.item.id, key: 'kpi', note: 'Cycle locked' })).status, 200);
  const view = (await call(HR, 'GET', 'qc-view', {}, { id: qc.json.item.id })).json;
  assert.equal(view.live.okrs.total, 2);
  assert.equal(view.live.okrs.closed, 1);
  assert.equal(view.live.promotions.open, 0);
  assert.equal(view.live.probation.running, 1, 'p2 is still running');
  assert.equal((await call(OUT, 'GET', 'qc-view', {}, { id: qc.json.item.id })).status, 404);

  console.log('hrbp cycle ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
