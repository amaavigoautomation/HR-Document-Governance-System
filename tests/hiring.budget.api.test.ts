import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });

const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const FOUNDER = tok('u_founder', ['req.founder_decide']);
const BUDGETER = tok('u_budget', ['hiring.budget.manage']);
const HR = tok('u_hr', ['req.hr_decide']);
const EMP = tok('u_emp');
const OTHER_CO = tok('u_x', ['req.founder_decide', 'hiring.budget.manage'], 'c2');

const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHiring({ method, action, headers: h, body, query });
const year = new Date().getFullYear();

fdb.seed('companies', CID, { name: 'Acme Cloud Marketing' }); // prefix ACM
fdb.seed('companies', 'c2', { name: 'Other Co' });
fdb.seed('departments', 'd1', { id: 'd1', companyId: CID, name: 'Marketing' });
fdb.seed('departments', 'd2', { id: 'd2', companyId: CID, name: 'Finance' });
fdb.seed('departments', 'd3', { id: 'd3', companyId: 'c2', name: 'Marketing' });

// 7 active people in Marketing (one more is inactive), 2 in Finance; another company's people never count
for (let i = 0; i < 7; i++) fdb.seed('employees', `m${i}`, { companyId: CID, authUid: `m${i}`, name: `M${i}`, active: true, departmentName: 'Marketing' });
fdb.seed('employees', 'm_gone', { companyId: CID, authUid: 'm_gone', name: 'Gone', active: false, departmentName: 'Marketing' });
for (let i = 0; i < 2; i++) fdb.seed('employees', `f${i}`, { companyId: CID, authUid: `f${i}`, name: `F${i}`, active: true, departmentName: 'Finance' });
for (let i = 0; i < 20; i++) fdb.seed('employees', `x${i}`, { companyId: 'c2', authUid: `x${i}`, name: `X${i}`, active: true, departmentName: 'Marketing' });
fdb.seed('employees', 'u_founder', { companyId: CID, authUid: 'u_founder', name: 'Fay Founder', active: true, departmentName: 'Management' });

const req = (id: string, over: Record<string, any>) => ({
  id, reqNo: `REQ-${year}-${id}`, companyId: CID, positionTitle: 'Role', departmentName: 'Marketing', vacancies: 2, status: 'PENDING_FOUNDER',
  justification: 'Growth', events: [{ at: '2026-01-01T00:00:00Z', action: 'Raised', byId: 'a', byName: 'A' }], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});
fdb.seed('requisitions', 'r1', req('r1', { ctcMaxLpa: 8 }));
fdb.seed('requisitions', 'r_open', req('r_open', { status: 'JOB_OPEN', vacancies: 1 }));            // approved: counts as committed
fdb.seed('requisitions', 'r_pending', req('r_pending', { status: 'PENDING_HR', vacancies: 5 }));   // not approved yet: does not count
fdb.seed('requisitions', 'r_closed', req('r_closed', { status: 'CLOSED', vacancies: 9 }));         // finished: does not count
fdb.seed('requisitions', 'r_fin', req('r_fin', { departmentName: 'Finance', vacancies: 1 }));
fdb.seed('requisitions', 'r_old', req('r_old', { budgetRange: 'INR 12-14 LPA' }));                  // old free-text range only
fdb.seed('requisitions', 'r_other', req('r_other', { companyId: 'c2' }));

async function main() {
  // ---- access
  assert.equal((await call(EMP, 'GET', 'budget-list')).status, 403);
  assert.equal((await call({}, 'GET', 'budget-list')).status, 401);
  assert.equal((await call(HR, 'POST', 'budget-save', { departmentName: 'Marketing', approvedHeadcount: 5 })).status, 403, 'HR without the budget permission cannot set budgets');
  assert.equal((await call(FOUNDER, 'POST', 'budget-save', { departmentName: 'Marketing', approvedHeadcount: 5 })).status, 403);
  assert.equal((await call(BUDGETER, 'GET', 'budget-save')).status, 405);
  assert.equal((await call(HR, 'GET', 'req-founder-approve')).status, 405);
  assert.equal((await call(HR, 'POST', 'req-founder-approve', { requisitionId: 'r1' })).status, 403, 'only the founder permission can approve');
  assert.equal((await call(BUDGETER, 'POST', 'req-founder-approve', { requisitionId: 'r1' })).status, 403);

  // ---- saving budgets
  assert.equal((await call(BUDGETER, 'POST', 'budget-save', { departmentName: 'Nowhere', approvedHeadcount: 5 })).status, 404, 'unknown department');
  assert.equal((await call(BUDGETER, 'POST', 'budget-save', { departmentName: 'Marketing', approvedHeadcount: -2 })).status, 400);
  assert.equal((await call(BUDGETER, 'POST', 'budget-save', { departmentName: 'Marketing', maxCtcLpa: 'lots' })).status, 400);
  assert.equal((await call(BUDGETER, 'POST', 'budget-save', {})).status, 400);
  // a department of another company is not reachable by name
  assert.equal((await call(OTHER_CO, 'POST', 'budget-save', { departmentName: 'Finance', approvedHeadcount: 3 })).status, 404);

  const saved = await call(BUDGETER, 'POST', 'budget-save', { departmentName: ' marketing ', approvedHeadcount: '11', maxCtcLpa: '10' });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));

  const list = (await call(HR, 'GET', 'budget-list')).json.items as any[];
  assert.deepEqual(list.map((i) => i.departmentName), ['Finance', 'Marketing']);
  const mk = list.find((i) => i.departmentName === 'Marketing');
  assert.equal(mk.approvedHeadcount, 11);
  assert.equal(mk.maxCtcLpa, 10);
  assert.equal(mk.currentHeadcount, 7, 'active people only, this company only');
  assert.equal(mk.committedVacancies, 1, 'only approved requisitions count');
  const fin = list.find((i) => i.departmentName === 'Finance');
  assert.equal(fin.approvedHeadcount, null);
  assert.equal(fin.currentHeadcount, 2);

  // ---- the check
  const ok = (await call(FOUNDER, 'GET', 'budget-check', {}, { requisitionId: 'r1' })).json.check;
  assert.equal(ok.status, 'OK');
  assert.equal(ok.headcountAfter, 10, '7 in the team + 1 approved + 2 requested');
  assert.equal((await call(FOUNDER, 'GET', 'budget-check', {}, { requisitionId: 'nope' })).status, 404);
  assert.equal((await call(FOUNDER, 'GET', 'budget-check', {}, { requisitionId: 'r_other' })).status, 404, 'another company\'s requisition');
  assert.equal((await call(OTHER_CO, 'GET', 'budget-check', {}, { requisitionId: 'r1' })).status, 404);
  // the old free-text range is read: 14 LPA is above the 10 LPA limit
  const old = (await call(FOUNDER, 'GET', 'budget-check', {}, { requisitionId: 'r_old' })).json.check;
  assert.equal(old.status, 'OVER_BUDGET');
  assert.equal(old.requestedCtcMaxLpa, 14);

  // ---- approving inside the budget needs no reason and issues Position ID 1
  const a1 = await call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r1' });
  assert.equal(a1.status, 200, JSON.stringify(a1.json));
  const r1 = a1.json.requisition;
  assert.equal(r1.status, 'JD_DRAFT');
  assert.equal(r1.positionId, `POS-ACM-${year}-001`);
  assert.equal(r1.founderDecision.byName, 'Fay Founder');
  assert.equal(r1.budgetCheck.status, 'OK');
  assert.equal(r1.events.length, 2);
  assert.equal(fdb.all('requisitions').find((r) => r.id === 'r1')!.positionId, `POS-ACM-${year}-001`, 'saved to the database');
  // deciding twice is refused
  assert.equal((await call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r1' })).status, 409);
  // a requisition that is not waiting for the founder cannot be approved
  assert.equal((await call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r_pending' })).status, 409);
  assert.equal((await call(OTHER_CO, 'POST', 'req-founder-approve', { requisitionId: 'r_fin' })).status, 404, 'another company cannot approve it');

  // ---- r1 is now approved, so Marketing has 7 + 1 + 2 = 10 committed. An over-budget request needs a reason.
  const over = await call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r_old' });
  assert.equal(over.status, 400);
  assert.equal(over.json.overrideRequired, true);
  assert.equal(over.json.budgetCheck.status, 'OVER_BOTH', '7 + 3 approved + 2 requested = 12 > 11, and 14 LPA > 10 LPA');
  assert.equal(fdb.all('requisitions').find((r) => r.id === 'r_old')!.status, 'PENDING_FOUNDER', 'nothing was changed');
  assert.equal((await call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r_old', comments: '   ' })).status, 400, 'a blank reason is not a reason');
  const forced = await call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r_old', comments: 'Client contract needs two more people' });
  assert.equal(forced.status, 200);
  assert.equal(forced.json.requisition.positionId, `POS-ACM-${year}-002`, 'numbers keep counting up');
  assert.equal(forced.json.requisition.budgetCheck.overrideReason, 'Client contract needs two more people');
  assert.ok(forced.json.requisition.events.at(-1).action.includes('budget exception'));
  assert.equal(forced.json.requisition.events.at(-1).note, 'Client contract needs two more people');

  // ---- a department with no budget at all: allowed with a reason
  const none = await call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r_fin' });
  assert.equal(none.status, 400);
  assert.equal(none.json.budgetCheck.status, 'NO_BUDGET_SET');
  const none2 = await call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r_fin', comments: 'Budget is being finalised' });
  assert.equal(none2.status, 200);
  assert.equal(none2.json.requisition.positionId, `POS-ACM-${year}-003`);

  // ---- numbers are per company: the other company starts at 1
  fdb.seed('requisitions', 'r_c2', req('r_c2', { companyId: 'c2' }));
  const c2 = await call(OTHER_CO, 'POST', 'req-founder-approve', { requisitionId: 'r_c2', comments: 'No budget yet' });
  assert.equal(c2.status, 200);
  assert.equal(c2.json.requisition.positionId, `POS-OC-${year}-001`);

  // two founders approving the same requisition together: exactly one wins
  fdb.seed('requisitions', 'r_race', req('r_race', { departmentName: 'Finance', vacancies: 1 }));
  const results = await Promise.all([
    call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r_race', comments: 'go' }),
    call(FOUNDER, 'POST', 'req-founder-approve', { requisitionId: 'r_race', comments: 'go' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);

  console.log('hiring budget api ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
