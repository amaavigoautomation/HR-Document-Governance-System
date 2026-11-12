import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHrbp } from '../api/_lib/hrbpApi.ts';
import { ensureDraftMapping, setMappingStatus } from '../api/_lib/hrbpOrg.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = []) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms })).toString('base64')}` });
const HRBP = tok('u_hrbp', ['hrbp.manage']);
const VIEWER = tok('u_view', ['hrbp.view']);
const EMP = tok('u_a');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHrbp({ method, action, headers: h, body, query });

const emp = (id: string, name: string, dept: string, extra: any = {}) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: dept, title: 'Staff', ...extra });
const prof = (uid: string, managerUid: string, extra: any = {}) => fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid, managerManual: true, ...extra });
emp('u_hrbp', 'Hema HRBP', 'HR'); emp('u_boss', 'Bo Boss', 'Management'); emp('u_view', 'Vee Viewer', 'Management'); emp('u_a', 'Asha', 'Eng'); emp('u_b', 'Bilal', 'Eng'); emp('u_c', 'Chen', 'Eng'); emp('u_d', 'Dev', 'Sales'); emp('u_e', 'Esha', 'Eng');
prof('u_a', 'u_boss'); prof('u_b', 'u_boss'); prof('u_c', 'u_a');
fdb.seed('hiringBudgets', 'c1__eng', { companyId: CID, departmentName: 'Eng', approvedHeadcount: 5 });
fdb.seed('hiringBudgets', 'c1__sales', { companyId: CID, departmentName: 'Sales', approvedHeadcount: 2 });
fdb.seed('requisitions', 'rq', { id: 'rq', companyId: CID, departmentName: 'Eng', status: 'JOB_OPEN', vacancies: 1 });

async function main() {
  // ---- org chart and span of control
  const org = (await call(HRBP, 'GET', 'org')).json;
  const node = (uid: string) => org.tree.nodes.find((n: any) => n.uid === uid);
  assert.equal(node('u_a').managerUid, 'u_boss');
  assert.equal(node('u_c').managerUid, 'u_a');
  assert.equal(node('u_boss').managerUid, '', 'the boss has no manager: a root of the chart');
  const boss = org.tree.spans.find((s: any) => s.uid === 'u_boss');
  assert.equal(boss.direct, 2, 'Asha and Bilal report to the boss directly');
  assert.equal(boss.total, 3, 'Chen reports to Asha, so is three levels of people under the boss in total');
  assert.equal(org.tree.spans.find((s: any) => s.uid === 'u_a').direct, 1);
  assert.equal(org.tree.spans[0].uid, 'u_boss', 'widest span first');
  assert.equal(org.tree.averageSpan, 1.5, '(2 + 1) / 2 managers');

  // ---- positions: vacant and critical roles
  assert.equal((await call(EMP, 'GET', 'pos-list')).status, 403, 'plain employees do not see positions');
  assert.equal((await call(VIEWER, 'POST', 'pos-save', { title: 'X' })).status, 403, 'viewers cannot change them');
  assert.equal((await call(HRBP, 'POST', 'pos-save', { title: '' })).status, 400);
  assert.equal((await call(HRBP, 'POST', 'pos-save', { title: 'Head of Sales', reportsToUid: 'nobody' })).status, 400);
  const pos = await call(HRBP, 'POST', 'pos-save', { title: 'Head of Sales', department: 'Sales', reportsToUid: 'u_boss', critical: true, status: 'VACANT', requisitionRef: 'REQ-9' });
  assert.equal(pos.status, 200, JSON.stringify(pos.json));
  assert.equal((await call(VIEWER, 'GET', 'pos-list')).json.items.length, 1);
  const org2 = (await call(HRBP, 'GET', 'org')).json;
  assert.equal(org2.vacantCount, 1);
  assert.equal(org2.criticalVacant, 1);
  assert.equal(org2.positions[0].reportsToUid, 'u_boss', 'the vacancy hangs under the boss on the chart');
  const filled = await call(HRBP, 'POST', 'pos-save', { id: pos.json.item.id, title: 'Head of Sales', critical: true, status: 'FILLED', incumbentUid: 'u_d', reportsToUid: 'u_boss' });
  assert.equal(filled.json.item.incumbentName, 'Dev');
  assert.equal((await call(HRBP, 'GET', 'org')).json.vacantCount, 0, 'filling the role clears the vacancy');

  // ---- default HRBP on a business unit
  const bu = await call(HRBP, 'POST', 'bu-save', { name: 'Delivery', defaultHrbpUid: 'u_hrbp' });
  assert.equal(bu.json.item.defaultHrbpName, 'Hema HRBP');
  assert.equal((await call(HRBP, 'POST', 'bu-save', { name: 'Delivery', defaultHrbpUid: 'ghost' })).status, 400);

  const dflt = await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_e', businessUnit: 'delivery', billable: false });
  assert.equal(dflt.json.item.hrbpName, 'Hema HRBP', 'no HRBP given: the business unit default is used');
  const own = await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_e', businessUnit: 'Delivery', billable: false, hrbpUid: 'u_boss' });
  assert.equal(own.json.item.hrbpName, 'Bo Boss', 'an HRBP chosen by hand is never replaced');

  // ---- automatic draft mapping when someone joins or is confirmed
  assert.equal(await ensureDraftMapping(CID, 'u_d', 'PROBATION'), true);
  assert.equal(await ensureDraftMapping(CID, 'u_d', 'PROBATION'), false, 'a second call never makes a second mapping');
  assert.equal(await ensureDraftMapping(CID, 'ghost', 'PROBATION'), false, 'unknown people are ignored');
  const maps = (await call(HRBP, 'GET', 'map-list')).json.items.filter((m: any) => m.employeeUid === 'u_d');
  assert.equal(maps.length, 1);
  assert.equal(maps[0].draft, true);
  assert.equal(maps[0].employmentStatus, 'PROBATION');
  let o = (await call(HRBP, 'GET', 'org')).json;
  assert.equal(o.awaiting.find((x: any) => x.uid === 'u_d').reason, 'DRAFT');
  assert.equal(o.awaiting.find((x: any) => x.uid === 'u_b').reason, 'NO_MAPPING');
  const before = o.unmapped;
  await setMappingStatus(CID, 'u_d', 'CONFIRMED');
  assert.equal((await call(HRBP, 'GET', 'map-list')).json.items.find((m: any) => m.employeeUid === 'u_d').employmentStatus, 'CONFIRMED');
  const saved = await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_d', businessUnit: 'Delivery', hrbpUid: 'u_hrbp', billable: true, employmentStatus: 'CONFIRMED' });
  assert.equal(saved.json.item.draft, false, 'saving the mapping completes the draft');
  o = (await call(HRBP, 'GET', 'org')).json;
  assert.equal(o.unmapped, before - 1);
  assert.equal(o.awaiting.some((x: any) => x.uid === 'u_d'), false);

  // ---- transfers
  assert.equal((await call(EMP, 'POST', 'transfer-save', {})).status, 403);
  assert.equal((await call(VIEWER, 'POST', 'transfer-save', {})).status, 403);
  assert.equal((await call(HRBP, 'POST', 'transfer-save', { employeeUid: 'ghost', department: 'Sales', reason: 'x' })).status, 400);
  assert.equal((await call(HRBP, 'POST', 'transfer-save', { employeeUid: 'u_c', department: 'Sales' })).status, 400, 'a reason is required');
  assert.equal((await call(HRBP, 'POST', 'transfer-save', { employeeUid: 'u_c', reason: 'x' })).status, 400, 'nothing is changing');
  assert.equal((await call(HRBP, 'POST', 'transfer-save', { employeeUid: 'u_c', department: 'Eng', reason: 'x' })).status, 400, 'same department is no change');
  assert.equal((await call(HRBP, 'POST', 'transfer-save', { employeeUid: 'u_c', department: 'Sales', reason: 'x', effectiveDate: '2999-01-01' })).status, 400, 'no future dates');
  assert.equal((await call(HRBP, 'POST', 'transfer-save', { employeeUid: 'u_boss', managerUid: 'u_c', reason: 'x' })).status, 409, 'the boss cannot report to his own report');
  const tr = await call(HRBP, 'POST', 'transfer-save', { employeeUid: 'u_c', department: 'Sales', businessUnit: 'Delivery', managerUid: 'u_b', reason: 'Moved to the sales project' });
  assert.equal(tr.status, 200, JSON.stringify(tr.json));
  assert.equal(tr.json.item.from.department, 'Eng');
  assert.equal(tr.json.item.to.department, 'Sales');
  assert.equal(tr.json.item.to.managerName, 'Bilal');
  o = (await call(HRBP, 'GET', 'org')).json;
  const moved = o.tree.nodes.find((n: any) => n.uid === 'u_c');
  assert.equal(moved.department, 'Sales', 'the org chart follows the transfer');
  assert.equal(moved.managerUid, 'u_b');
  assert.equal(moved.businessUnit, 'Delivery');
  assert.equal(o.tree.spans.find((s: any) => s.uid === 'u_a'), undefined, 'Asha no longer manages anyone');
  assert.equal((await call(VIEWER, 'GET', 'transfer-list')).json.items.length, 1);

  // ---- headcount grouped three ways
  const dept = (await call(HRBP, 'GET', 'headcount')).json;
  assert.equal(dept.by, 'department');
  assert.equal(dept.rows.find((r: any) => r.department === 'Eng').approved, 5);
  const mgr = (await call(HRBP, 'GET', 'headcount', {}, { by: 'manager' })).json;
  assert.equal(mgr.by, 'manager');
  assert.equal(mgr.rows.find((r: any) => r.department === 'Bo Boss').headcount, 2);
  assert.equal(mgr.rows.find((r: any) => r.department === 'Bilal').headcount, 1);
  assert.equal(mgr.rows.every((r: any) => r.approved === null), true, 'approved numbers are not kept per manager');
  const co = (await call(HRBP, 'GET', 'headcount', {}, { by: 'company' })).json;
  assert.equal(co.rows.length, 1);
  assert.equal(co.rows[0].department, 'Whole company');
  assert.equal(co.rows[0].approved, 7, '5 + 2 approved across departments');
  assert.equal(co.rows[0].headcount, 8, 'everyone: the eight people seeded');
  assert.equal((await call(HRBP, 'GET', 'headcount', {}, { by: 'junk' })).json.by, 'department', 'unknown grouping falls back');

  console.log('hrbp org ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
