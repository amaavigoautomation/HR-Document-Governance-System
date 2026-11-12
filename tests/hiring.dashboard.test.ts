import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { computeDashboard } from '../shared/hiringAnalytics.ts';

const STAGES = ['New Applicant', 'Shortlisted', 'Selected', 'Rejected'];
const today = '2026-11-02';

// ---- pure numbers
const d = computeDashboard({
  today, stages: STAGES, headcount: 40,
  requisitions: [
    { id: 'r1', status: 'JOB_OPEN', departmentName: 'Eng', positionTitle: 'Dev', vacancies: 2, ctcMaxLpa: 10, createdAt: '2026-09-01T00:00:00Z', founderApprovedAt: '2026-09-11T00:00:00Z' },
    { id: 'r2', status: 'JD_DRAFT', departmentName: 'Eng', vacancies: 1, ctcMaxLpa: 8 },
    { id: 'r3', status: 'CLOSED', departmentName: 'QA', vacancies: 1 },
    { id: 'r4', status: 'PENDING_FOUNDER', departmentName: 'QA', vacancies: 1 },
  ],
  applications: [
    { id: 'a1', status: 'Selected', source: 'REFERRAL' }, { id: 'a2', status: 'Selected', source: 'MANUAL' }, { id: 'a3', status: 'New Applicant', source: 'MANUAL' }, { id: 'a4', status: 'Interviewed', source: 'MANUAL' },
  ],
  offers: [
    { id: 'o1', requisitionId: 'r1', applicationId: 'a1', status: 'ACCEPTED', approvedCtcLpa: 9, joiningDate: '2026-11-20', candidateName: 'Cat', designation: 'Dev', acceptedAt: '2026-10-01T05:00:00Z' },
    { id: 'o2', requisitionId: 'r1', applicationId: 'a2', status: 'JOINED', approvedCtcLpa: 7, joiningDate: '2026-10-15', acceptedAt: '2026-09-21T05:00:00Z' },
    { id: 'o3', requisitionId: 'r1', status: 'DECLINED' }, { id: 'o4', requisitionId: 'r1', status: 'GHOSTED' }, { id: 'o5', requisitionId: 'r1', status: 'SENT' },
    { id: 'o6', requisitionId: 'r1', status: 'ACCEPTED', joiningDate: '2027-03-01', approvedCtcLpa: 5 },
  ],
  costs: [{ amount: 30000, category: 'JOB_BOARD' }, { amount: 15000, category: 'AGENCY_FEE' }, { amount: 6000, category: 'JOB_BOARD' }],
  exits: [{ status: 'COMPLETED', lastWorkingDay: '2026-10-31' }, { status: 'COMPLETED', lastWorkingDay: '2026-03-31' }, { status: 'COMPLETED', lastWorkingDay: '2024-01-01' }, { status: 'APPROVED', lastWorkingDay: '2026-11-30' }],
});
assert.deepEqual(d.positions, { open: 2, closed: 1, pendingApproval: 1, openVacancies: 3 });
assert.deepEqual(d.vacanciesByDepartment, [{ department: 'Eng', vacancies: 3, positions: 2 }]);
assert.equal(d.pipeline.find((p) => p.stage === 'Selected')!.count, 2);
assert.equal(d.pipeline.find((p) => p.stage === 'Interviewed')!.count, 1, 'stages outside the standard list still show');
assert.equal(d.timeToHire.sample, 2, 'only offers with a known approval date and acceptance date count (o6 has no acceptance date)');
assert.equal(d.timeToHire.averageDays, 15, '(20 + 10) / 2');
assert.equal(d.timeToHire.slowest[0].days, 20);
assert.equal(d.timeToHire.byMonth.length, 6, 'six months of time-to-hire, ending this month');
assert.equal(d.timeToHire.byMonth.at(-1)!.month, '2026-11');
const sep = d.timeToHire.byMonth.find((m) => m.month === '2026-09')!;
const oct = d.timeToHire.byMonth.find((m) => m.month === '2026-10')!;
assert.equal(sep.hires, 1); assert.equal(oct.hires, 1);
assert.equal(d.timeToHire.byMonth.at(-1)!.averageDays, null, 'no hires this month');
assert.equal(d.timeToHire.changePct, Math.round(((oct.averageDays! - sep.averageDays!) / sep.averageDays!) * 100), 'latest month with hires against the one before');
assert.equal(d.offers.answered, 5);
assert.equal(d.offers.acceptanceRate, 60, '3 of 5 answered offers were accepted (the SENT one is still open)');
assert.equal(d.costs.total, 51000);
assert.equal(d.costs.hires, 3);
assert.equal(d.costs.perHire, 17000);
assert.deepEqual(d.costs.byCategory[0], { category: 'JOB_BOARD', amount: 36000 });
assert.equal(d.upcomingJoinings.next30Days, 1);
assert.equal(d.upcomingJoinings.list.length, 2);
assert.equal(d.upcomingJoinings.list[0].daysAway, 18);
const eng = d.budgetVsActual.find((b) => b.department === 'Eng')!;
assert.equal(eng.budgetedLpa, 28, '2 x 10 + 1 x 8');
assert.equal(eng.actualLpa, 21, '9 + 7 + 5 from accepted and joined offers');
assert.equal(eng.varianceLpa, 7);
assert.equal(d.sources.find((s) => s.source === 'REFERRAL')!.hires, 1);
assert.equal(d.sources.find((s) => s.source === 'MANUAL')!.applications, 3);
assert.equal(d.attrition.exits12m, 2);
assert.equal(d.attrition.ratePct, 5);
assert.equal(d.attrition.byMonth.length, 12);
const empty = computeDashboard({ today, stages: STAGES, headcount: 0, requisitions: [], applications: [], offers: [], costs: [], exits: [] });
assert.equal(empty.offers.acceptanceRate, null);
assert.equal(empty.costs.perHire, null);
assert.equal(empty.timeToHire.averageDays, null);
assert.equal(empty.attrition.ratePct, null);

// ---- API access and isolation
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const call = (h: any, m: string, a: string) => routeHiring({ method: m, action: a, headers: h, body: {}, query: {} });
fdb.seed('requisitions', 'rq1', { id: 'rq1', companyId: 'c1', status: 'JOB_OPEN', departmentName: 'Eng', vacancies: 2, ctcMaxLpa: 10, founderDecision: { at: '2026-09-01T00:00:00Z' } });
fdb.seed('requisitions', 'rqx', { id: 'rqx', companyId: 'c2', status: 'JOB_OPEN', departmentName: 'Other', vacancies: 9, ctcMaxLpa: 99 });
fdb.seed('hiringItems', 'o1', { id: 'o1', companyId: 'c1', kind: 'offer', status: 'ACCEPTED', requisitionId: 'rq1', approvedCtcLpa: 9, joiningDate: '2099-01-01', history: [{ action: 'accept', at: '2026-09-21T00:00:00Z' }] });
fdb.seed('hiringItems', 'o2', { id: 'o2', companyId: 'c2', kind: 'offer', status: 'ACCEPTED', approvedCtcLpa: 50 });
(async () => {
  assert.equal((await call(tok('x', ['app.manage']), 'GET', 'hdash')).status, 403, 'HR alone cannot see salaries and spend');
  assert.equal((await call(tok('x'), 'GET', 'hdash')).status, 403);
  assert.equal((await call({}, 'GET', 'hdash')).status, 401);
  assert.equal((await call(tok('f', ['req.founder_decide']), 'POST', 'hdash')).status, 405);
  const res = await call(tok('f', ['req.founder_decide']), 'GET', 'hdash');
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.dashboard.positions.openVacancies, 2, 'the other company is not counted');
  assert.equal(res.json.dashboard.timeToHire.averageDays, 20);
  assert.equal(res.json.dashboard.budgetVsActual[0].actualLpa, 9);
  assert.equal((await call(tok('h', ['hrbp.view']), 'GET', 'hdash')).status, 200);
  console.log('hiring dashboard ok');
})().catch((e) => { console.error(e); process.exit(1); });
