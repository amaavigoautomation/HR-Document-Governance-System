import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHrbp } from '../api/_lib/hrbpApi.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HRBP = tok('u_hrbp', ['hrbp.manage']);
const VIEWER = tok('u_boss', ['hrbp.view']);
const EMP = tok('u_a');
const EMP2 = tok('u_b');
const OTHER = tok('u_x', ['hrbp.manage'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHrbp({ method, action, headers: h, body, query });

const emp = (id: string, name: string, dept: string, extra: any = {}) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: dept, ...extra });
emp('u_hrbp', 'Hema HRBP', 'HR'); emp('u_boss', 'Bo Boss', 'Management'); emp('u_a', 'Asha', 'Eng'); emp('u_b', 'Bilal', 'Eng'); emp('u_c', 'Chen', 'Sales'); emp('u_d', 'Dev', 'Sales'); emp('u_e', 'Esha', 'Sales'); emp('u_f', 'Farid', 'Sales');
emp('u_gone', 'Gone', 'Eng', { active: false });
fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Other Co Person', email: 'x1@o.com', active: true, departmentName: 'Eng' });
fdb.seed('hiringBudgets', 'c1__eng', { companyId: CID, departmentName: 'Eng', approvedHeadcount: 5 });
fdb.seed('requisitions', 'rq', { id: 'rq', companyId: CID, departmentName: 'Eng', status: 'JOB_OPEN', vacancies: 1 });

async function main() {
  // ---- access
  assert.equal((await call({}, 'GET', 'dash')).status, 401);
  assert.equal((await call(EMP, 'GET', 'dash')).status, 403);
  assert.equal((await call(EMP, 'GET', 'map-list')).status, 403);
  assert.equal((await call(VIEWER, 'POST', 'map-save', {})).status, 403, 'the dashboard viewer cannot change anything');
  assert.equal((await call(VIEWER, 'GET', 'talent-list')).status, 403, 'sensitive lists are for managers only');
  assert.equal((await call(VIEWER, 'GET', 'dash')).status, 200);
  assert.equal((await call(HRBP, 'POST', 'dash')).status, 405);
  assert.equal((await call(HRBP, 'GET', 'nope')).status, 404);
  assert.equal((await call(EMP, 'GET', 'me')).status, 200);

  // ---- business units and mapping
  assert.equal((await call(HRBP, 'POST', 'bu-save', { name: '' })).status, 400);
  assert.equal((await call(HRBP, 'POST', 'bu-save', { name: 'Delivery', headUid: 'x1' })).status, 400, 'head must be in this company');
  const bu = await call(HRBP, 'POST', 'bu-save', { name: 'Delivery', headUid: 'u_boss' });
  assert.equal(bu.json.item.headName, 'Bo Boss');
  assert.equal((await call(HRBP, 'POST', 'bu-save', { name: 'delivery' })).json.item.id, bu.json.item.id, 'same name updates, never duplicates');

  assert.equal((await call(HRBP, 'POST', 'map-save', { employeeUid: 'x1', businessUnit: 'Delivery' })).status, 400, 'another company\'s person');
  assert.equal((await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_gone' })).status, 400, 'inactive');
  assert.equal((await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_a', billable: false, clientAllocation: [{ client: 'Acme', percent: 50 }] })).status, 400, 'non-billable cannot be allocated');
  assert.equal((await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_a', billable: true, clientAllocation: [{ client: 'Acme', percent: 500 }] })).status, 400);
  const m1 = await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_a', businessUnit: 'Delivery', costCentre: 'CC-10', billable: true, clientAllocation: [{ client: 'Acme', percent: 60 }, { client: 'Beta', percent: 50 }], hrbpUid: 'u_hrbp' });
  assert.equal(m1.status, 200, JSON.stringify(m1.json));
  assert.equal(m1.json.item.hrbpName, 'Hema HRBP');
  assert.equal((await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_a', businessUnit: 'Delivery', billable: true, hrbpUid: 'u_hrbp', clientAllocation: [{ client: 'Acme', percent: 60 }, { client: 'Beta', percent: 50 }] })).json.item.id, m1.json.item.id, 'one mapping per employee');
  await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_b', businessUnit: 'Delivery', billable: true, clientAllocation: [] });
  await call(HRBP, 'POST', 'map-save', { employeeUid: 'u_c', businessUnit: 'Sales', billable: false });

  // ---- computed views
  const res = (await call(HRBP, 'GET', 'resource')).json;
  assert.equal(res.summary.over, 1, 'Asha is at 110 percent');
  assert.equal(res.summary.bench, 1, 'Bilal is billable with nothing allocated');
  assert.equal(res.clients.find((c: any) => c.client === 'Acme').fte, 0.6);
  const org = (await call(HRBP, 'GET', 'org')).json;
  assert.equal(org.units.find((u: any) => u.name === 'Delivery').people, 2);
  assert.equal(org.unmapped, 5, 'u_hrbp, u_boss, u_d, u_e, u_f have no mapping; inactive and other-company people are not counted');
  assert.equal(org.hrbpLoad['Hema HRBP'], 1);
  const hc = (await call(HRBP, 'GET', 'headcount')).json;
  const eng = hc.rows.find((r: any) => r.department === 'Eng');
  assert.equal(eng.headcount, 2);
  assert.equal(eng.approved, 5);
  assert.equal(eng.openVacancies, 1);
  assert.equal(eng.gap, 2, '5 approved - 2 now - 1 open');

  // ---- talent review
  assert.equal((await call(HRBP, 'POST', 'talent-save', { employeeUid: 'u_a', performance: 5, potential: 2 })).status, 400);
  assert.equal((await call(HRBP, 'POST', 'talent-save', { employeeUid: 'u_a', performance: 3, potential: 3, quarter: 'Q4' })).status, 400);
  const t = await call(HRBP, 'POST', 'talent-save', { employeeUid: 'u_a', performance: 3, potential: 3, flightRisk: 'HIGH', notes: 'Poached risk' });
  assert.equal(t.json.item.box.label, 'Star');
  const t2 = await call(HRBP, 'POST', 'talent-save', { employeeUid: 'u_a', performance: 3, potential: 2, flightRisk: 'HIGH' });
  assert.equal(t2.json.item.id, t.json.item.id, 'one review per person per quarter');
  assert.equal((await call(HRBP, 'GET', 'talent-list')).json.items.length, 1);

  // ---- KPI
  assert.equal((await call(HRBP, 'POST', 'kpi-save', { employeeUid: 'u_a', name: 'Bugs fixed', target: 0 })).status, 400);
  const k = (await call(HRBP, 'POST', 'kpi-save', { employeeUid: 'u_a', name: 'Bugs fixed', target: 20, actual: 12, unit: 'bugs' })).json.item;
  assert.equal(k.attainment, 60);
  assert.equal(k.status, 'RED');
  assert.equal((await call(HRBP, 'POST', 'kpi-save', { id: k.id, employeeUid: 'u_a', name: 'Bugs fixed', target: 20, actual: 19 })).json.item.status, 'GREEN');
  assert.equal((await call(HRBP, 'POST', 'kpi-save', { scope: 'DEPARTMENT', department: 'Sales', name: 'Revenue', target: 100, direction: 'HIGHER' })).json.item.status, 'NO_DATA');

  // ---- PIP workflow
  const pipBody = { employeeUid: 'u_b', startOn: '2026-11-01', endOn: '2026-12-15', reason: 'Missed three deadlines', goals: [{ text: 'Deliver sprint tasks on time', dueOn: '2026-12-01' }, { text: 'Weekly status updates' }] };
  assert.equal((await call(HRBP, 'POST', 'pip-save', { ...pipBody, goals: [] })).status, 400);
  assert.equal((await call(HRBP, 'POST', 'pip-save', { ...pipBody, endOn: '2026-11-05' })).status, 400);
  assert.equal((await call(HRBP, 'POST', 'pip-save', { ...pipBody, employeeUid: 'x1' })).status, 400);
  const pip = (await call(HRBP, 'POST', 'pip-save', pipBody)).json.item;
  assert.equal(pip.status, 'DRAFT');
  assert.equal((await call(HRBP, 'POST', 'pip-save', pipBody)).status, 409, 'one open plan per person');
  assert.equal((await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'checkin', note: 'x' })).status, 409, 'cannot check in on a draft');
  assert.equal((await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'start' })).json.item.status, 'ACTIVE');
  assert.equal((await call(EMP2, 'GET', 'me')).json.pip.goals.length, 2, 'the employee sees their own plan');
  assert.equal((await call(EMP, 'GET', 'me')).json.pip, null, 'and nobody else\'s');
  assert.equal((await call(HRBP, 'POST', 'pip-save', { ...pipBody, id: pip.id })).status, 409, 'a running plan cannot be edited');
  assert.equal((await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'checkin', note: '' })).status, 400);
  const ci = await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'checkin', note: 'Good progress on sprint', rating: 4, goalsDone: [0] });
  assert.equal(ci.json.item.goals[0].done, true);
  assert.equal(ci.json.item.checkins.length, 1);
  assert.equal((await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'complete', note: 'Improved' })).status, 409, 'one goal is still open');
  assert.equal((await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'extend', note: 'More time', endOn: '2026-11-10' })).status, 400, 'must be later');
  assert.equal((await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'extend', note: 'More time', endOn: '2027-01-15' })).json.item.status, 'EXTENDED');
  assert.equal((await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'complete', note: 'Improved', confirmIncomplete: true })).json.item.status, 'COMPLETED');
  assert.equal((await call(HRBP, 'POST', 'pip-act', { id: pip.id, action: 'fail', note: 'x' })).status, 409, 'final');
  assert.equal((await call(OTHER, 'POST', 'pip-act', { id: pip.id, action: 'cancel', note: 'x' })).status, 404);
  assert.equal((await call(HRBP, 'POST', 'pip-save', pipBody)).status, 200, 'a finished plan frees the person for a new one');

  // ---- pulse survey is anonymous
  assert.equal((await call(HRBP, 'POST', 'survey-save', { title: 'Pulse', questions: [] })).status, 400);
  const sv = (await call(HRBP, 'POST', 'survey-save', { title: 'Q4 pulse', questions: [{ text: 'I enjoy my work', type: 'scale' }, { text: 'Anything else?', type: 'text' }] })).json.item;
  assert.equal((await call(EMP, 'GET', 'survey-list')).json.items.length, 1);
  assert.equal((await call(EMP, 'POST', 'survey-respond', { surveyId: sv.id, answers: { q1: 9 } })).status, 400);
  assert.equal((await call(EMP, 'POST', 'survey-respond', { surveyId: sv.id, answers: { q1: 5, q2: 'secret-comment-xyz' } })).status, 200);
  assert.equal((await call(EMP, 'POST', 'survey-respond', { surveyId: sv.id, answers: { q1: 1 } })).status, 409, 'once only');
  assert.equal((await call(EMP, 'GET', 'survey-list')).json.items[0].answered, true);
  assert.equal((await call(EMP2, 'GET', 'survey-list')).json.items[0].answered, false);
  assert.equal((await call(EMP, 'GET', 'survey-results', {}, { surveyId: sv.id })).status, 403);
  const early = (await call(HRBP, 'GET', 'survey-results', {}, { surveyId: sv.id })).json;
  assert.equal(early.results.visible, false, 'under 5 answers: nothing shown');
  assert.equal(JSON.stringify(early).includes('secret-comment-xyz'), false);
  // the stored response carries no identity
  const stored = fdb.all('hrbpItems').filter((i) => i.kind === 'surveyResponse');
  assert.equal(stored.length, 1);
  assert.equal(JSON.stringify(stored[0]).includes('u_a'), false, 'no uid in the response');
  assert.equal(Object.keys(stored[0]).includes('createdAt'), false, 'no timestamp to match to a login time');
  // simultaneous double submit counts once
  const dup = await Promise.all([1, 2].map(() => call(EMP2, 'POST', 'survey-respond', { surveyId: sv.id, answers: { q1: 4 } })));
  assert.deepEqual(dup.map((d) => d.status).sort(), [200, 409]);
  for (const id of ['u_c', 'u_d', 'u_e']) await call(tok(id), 'POST', 'survey-respond', { surveyId: sv.id, answers: { q1: 3 } });
  const full = (await call(HRBP, 'GET', 'survey-results', {}, { surveyId: sv.id })).json;
  assert.equal(full.results.visible, true);
  assert.equal(full.results.questions[0].average, 3.6);
  assert.equal(full.participation.responses, 5);
  assert.equal((await call(HRBP, 'POST', 'survey-close', { id: sv.id })).status, 200);
  assert.equal((await call(tok('u_f'), 'POST', 'survey-respond', { surveyId: sv.id, answers: { q1: 3 } })).status, 404, 'closed');

  // ---- recognition
  assert.equal((await call(EMP, 'POST', 'recog-give', { toUid: 'u_a', message: 'Great job on the release' })).status, 400, 'not yourself');
  assert.equal((await call(EMP, 'POST', 'recog-give', { toUid: 'u_b', message: 'short' })).status, 400);
  assert.equal((await call(EMP, 'POST', 'recog-give', { toUid: 'x1', message: 'Great job on the release' })).status, 400, 'other company');
  assert.equal((await call(EMP, 'POST', 'recog-give', { toUid: 'u_b', value: 'Teamwork', message: 'Helped me debug for hours' })).status, 200);
  assert.equal((await call(EMP2, 'GET', 'recog-list')).json.items.length, 1);
  for (let i = 0; i < 4; i++) await call(EMP, 'POST', 'recog-give', { toUid: 'u_c', message: `Thanks for the help number ${i}` });
  assert.equal((await call(EMP, 'POST', 'recog-give', { toUid: 'u_d', message: 'One more kind word today' })).status, 429, 'five a day');

  // ---- wellness
  const w = (await call(HRBP, 'POST', 'well-save', { title: 'Yoga Friday', type: 'EVENT', date: '2026-11-20' })).json.item;
  assert.equal((await call(EMP, 'POST', 'well-join', { id: w.id })).json.joined, true);
  const wl = (await call(EMP2, 'GET', 'well-list')).json.items[0];
  assert.equal(wl.joined, false);
  assert.equal(wl.participantCount, 1);
  assert.equal('participants' in wl, false, 'employees never see who else joined');
  assert.equal('participants' in (await call(HRBP, 'GET', 'well-list')).json.items[0], true);

  // ---- learning
  assert.equal((await call(HRBP, 'POST', 'path-save', { name: 'Onboarding', steps: [] })).status, 400);
  const path = (await call(HRBP, 'POST', 'path-save', { name: 'Backend basics', role: 'Engineer', steps: [{ title: 'SQL course', type: 'COURSE', hours: 6 }, { title: 'Build an API', type: 'PROJECT', hours: 10 }] })).json.item;
  assert.equal((await call(EMP, 'POST', 'path-assign', { pathId: path.id, employeeUids: ['u_a'] })).status, 403);
  assert.equal((await call(HRBP, 'POST', 'path-assign', { pathId: path.id, employeeUids: ['x1'] })).status, 400);
  assert.equal((await call(HRBP, 'POST', 'path-assign', { pathId: path.id, employeeUids: ['u_a', 'u_b'] })).json.assigned, 2);
  assert.equal((await call(HRBP, 'POST', 'path-assign', { pathId: path.id, employeeUids: ['u_a'] })).json.skipped, 1, 'no duplicate assignment');
  const mine = (await call(EMP, 'GET', 'assign-list')).json.items;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].pathName, 'Backend basics');
  assert.equal((await call(EMP2, 'POST', 'path-progress', { id: mine[0].id, step: 0 })).status, 403, 'only the assignee or HR');
  assert.equal((await call(EMP, 'POST', 'path-progress', { id: mine[0].id, step: 5 })).status, 400);
  assert.equal((await call(EMP, 'POST', 'path-progress', { id: mine[0].id, step: 0 })).json.percent, 50);
  assert.equal((await call(EMP, 'POST', 'path-progress', { id: mine[0].id, step: 1 })).json.percent, 100);
  assert.equal((await call(HRBP, 'GET', 'assign-list')).json.items.length, 2, 'HR sees everyone\'s');

  // ---- certificates, training needs, retention, succession
  assert.equal((await call(HRBP, 'POST', 'cert-save', { employeeUid: 'u_a', name: 'AWS', issuedOn: '2026-05-01', expiresOn: '2026-04-01' })).status, 400);
  await call(HRBP, 'POST', 'cert-save', { employeeUid: 'u_a', name: 'First aid', expiresOn: '2020-01-01', mandatory: true });
  await call(HRBP, 'POST', 'cert-save', { employeeUid: 'u_a', name: 'Fire safety', expiresOn: '2099-01-01' });
  const certs = (await call(HRBP, 'GET', 'cert-list')).json.items;
  assert.equal(certs.find((x: any) => x.name === 'First aid').status, 'EXPIRED');
  assert.equal(certs.find((x: any) => x.name === 'Fire safety').status, 'VALID');
  assert.equal((await call(EMP, 'GET', 'me')).json.certs.length, 2, 'employees see their own certificates');
  assert.equal((await call(EMP2, 'GET', 'me')).json.certs.length, 0);
  assert.equal((await call(HRBP, 'POST', 'need-save', { employeeUid: 'u_b', skill: 'Time management', source: 'PIP', priority: 'HIGH' })).status, 200);
  assert.equal((await call(EMP2, 'GET', 'me')).json.needs.length, 1);
  await call(HRBP, 'POST', 'retention-save', { employeeUid: 'u_a', risk: 'HIGH', reasons: 'Offers elsewhere', actions: 'Role review' });
  assert.equal((await call(HRBP, 'POST', 'retention-save', { employeeUid: 'u_a', risk: 'MEDIUM' })).json.item.risk, 'MEDIUM', 'one plan per person');
  assert.equal((await call(HRBP, 'POST', 'succ-save', { role: 'Head of Eng', incumbentUid: 'u_a', successors: [{ employeeUid: 'u_a', readiness: 'READY_NOW' }] })).status, 400, 'not their own successor');
  assert.equal((await call(HRBP, 'POST', 'succ-save', { role: 'Head of Eng', successors: [{ employeeUid: 'u_b' }, { employeeUid: 'u_b' }] })).status, 400, 'no duplicates');
  const sc = (await call(HRBP, 'POST', 'succ-save', { role: 'Head of Eng', incumbentUid: 'u_a', critical: true, successors: [{ employeeUid: 'u_b', readiness: 'ONE_TO_TWO_YEARS' }] })).json.item;
  assert.equal(sc.gap, 'NO_SUCCESSOR', 'critical role with nobody ready now');
  assert.equal((await call(HRBP, 'POST', 'succ-save', { id: sc.id, role: 'Head of Eng', incumbentUid: 'u_a', critical: true, successors: [{ employeeUid: 'u_b', readiness: 'READY_NOW' }] })).json.item.gap, 'THIN');

  // ---- dashboard
  const dash = (await call(VIEWER, 'GET', 'dash')).json;
  assert.equal(dash.headcount.headcount, 8);
  assert.equal(dash.resource.over, 1);
  assert.equal(dash.kpi.green, 1);
  assert.equal(dash.pip.draft, 1);
  assert.equal(dash.certs.expired, 1);
  assert.equal(dash.succession.criticalRoles, 1);
  assert.equal(dash.pulse.participation.responses, 5);
  assert.ok(dash.attention.length >= 2);

  // ---- tenant isolation
  assert.equal((await call(OTHER, 'GET', 'map-list')).json.items.length, 0);
  assert.equal((await call(OTHER, 'GET', 'dash')).json.headcount.headcount, 1);
  assert.equal((await call(OTHER, 'POST', 'bu-delete', { id: bu.json.item.id })).status, 404);
  assert.equal((await call(HRBP, 'POST', 'bu-delete', { id: bu.json.item.id })).status, 200);

  console.log('hrbp api ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
