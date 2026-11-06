import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePm } from '../api/_lib/pmApi.ts';
import { loadSystem } from '../api/_lib/pmCore.ts';
import { importCsvText } from '../api/_lib/pmEvidence.ts';
import { feedUrl } from '../api/_lib/pmAuto.ts';
import { starterSettings } from '../shared/leaveEngine.ts';
import { addDays, istToday } from '../shared/pmEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['pm.manage']); const AP = tok('u_ap', ['pm.approve']); const BOSS = tok('u_boss');
const A = tok('u_a'); const B = tok('u_b'); const D = tok('u_d'); const OTHER = tok('x1', ['pm.manage', 'pm.approve'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routePm({ method, action, headers: h, body, query });
const get = (h: any, action: string, query: any = {}) => call(h, 'GET', action, {}, query);
const post = (h: any, action: string, body: any = {}) => call(h, 'POST', action, body);
const okc = (r: any, msg = '') => assert.equal(r.status, 200, `${msg} ${JSON.stringify(r.json)}`);

const t = istToday(); const cur = t.slice(0, 7); const prev = addDays(`${cur}-01`, -1).slice(0, 7);
const emp = (id: string, name: string, dept: string, title: string) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: dept, title, createdAt: '2025-01-01T00:00:00Z' });
emp('u_hr', 'Hema HR', 'HR', 'HR Manager'); emp('u_ap', 'Ajay Approver', 'Management', 'Founder'); emp('u_boss', 'Bo Boss', 'Design', 'Design Lead');
emp('u_a', 'Asha', 'Design', 'Designer'); emp('u_b', 'Bilal', 'Design', 'Designer'); emp('u_d', 'Dev', 'Sales', 'Sales Executive');
fdb.seed('employees', 'x1', { companyId: 'c2', authUid: 'x1', name: 'Other', email: 'x1@o.com', active: true, departmentName: 'Design', title: 'Designer' });
fdb.seed('companies', CID, { status: 'ACTIVE', name: 'Acme' });
const mgr = (uid: string, m: string) => fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: m, locationId: 'hq', joinDate: '2025-01-01' });
mgr('u_a', 'u_boss'); mgr('u_b', 'u_boss'); mgr('u_d', 'u_boss'); mgr('u_boss', 'u_ap'); mgr('u_hr', 'u_ap');

async function main() {
  // ---- set the module up the way HR would, then activate plans for Asha and Bilal
  okc(await post(HR, 'quickstart'));
  const fw = (await get(HR, 'fw-list')).json.items[0]; okc(await post(AP, 'fw-approve', { id: fw.id }));
  const roles = (await get(HR, 'role-list')).json.items; const designer = roles.find((r: any) => r.name === 'Designer'); const sales = roles.find((r: any) => r.name === 'Sales Executive');
  const row = (kra: string, kpi: string, w: number) => ({ kraName: kra, kpiName: kpi, measurement: 'count', weightage: w, frequency: 'MONTHLY', evidenceSource: 'TASK_SYSTEM' });
  const t1 = await post(HR, 'tpl-save', { roleId: designer.id, items: [row('Delivery', 'Delivery KPI', 60), row('Reliability', 'Attendance & punctuality', 40)] }); okc(t1); okc(await post(AP, 'tpl-approve', { id: t1.json.item.id }));
  const t2 = await post(HR, 'tpl-save', { roleId: sales.id, items: [row('Revenue', 'Revenue KPI', 100)] }); okc(t2); okc(await post(AP, 'tpl-approve', { id: t2.json.item.id }));
  okc(await post(HR, 'sync'));
  const plans = (await get(HR, 'plan-list', { scope: 'all' })).json.items;
  for (const [uid, who] of [['u_a', A], ['u_b', B]] as const) {
    const p = plans.find((x: any) => x.uid === uid); const full = (await get(who, 'plan-get', { id: p.id })).json.item;
    okc(await post(BOSS, 'plan-save', { id: p.id, targets: full.kpis.map((k: any) => ({ targetId: k.id, target: '10' })) }));
    okc(await post(BOSS, 'plan-act', { id: p.id, action: 'submit' })); okc(await post(HR, 'plan-act', { id: p.id, action: 'validate' }));
    okc(await post(AP, 'plan-act', { id: p.id, action: 'approve' })); okc(await post(who, 'plan-act', { id: p.id, action: 'acknowledge' }));
  }

  // ---- 1. the control panel: HR only, validated, everything starts off
  assert.equal((await get(A, 'auto-get')).status, 403, 'an employee cannot see or change the autopilot');
  assert.equal((await post(BOSS, 'auto-save', { autoOpen: true })).status, 403);
  const g0 = (await get(HR, 'auto-get')).json;
  assert.equal(g0.settings.autoOpen, false); assert.equal(g0.settings.autoPublish, false); assert.equal(g0.settings.autoLock, false); assert.equal(g0.settings.attendanceEvidence, false);
  assert.equal((await post(HR, 'auto-save', { attendanceEvidence: true })).status, 400, 'attendance evidence needs the KPI name');
  assert.equal((await post(HR, 'auto-save', { publishDelayDays: 99 })).status, 400);
  const off = await post(HR, 'auto-run'); okc(off);
  assert.equal(off.json.steps.openCycles.skipped, 'Off', 'with every switch off the autopilot changes nothing');
  assert.equal(off.json.steps.attendance.skipped, 'Off');
  okc(await post(HR, 'auto-save', { autoOpen: true, autoPublish: true, publishDelayDays: 0, autoLock: true, attendanceEvidence: true, attendanceKpiName: 'Attendance & punctuality' }));

  // ---- 2. attendance becomes evidence, only for people whose plan has that KPI
  fdb.seed('leaveSettings', CID, { ...starterSettings(Number(cur.slice(0, 4))), companyId: CID });
  for (const d of ['05', '06', '07', '08', '09']) fdb.seed('leaveAttendance', `${CID}__u_a__${prev}-${d}`, { companyId: CID, uid: 'u_a', date: `${prev}-${d}`, month: prev, sessions: [{ in: `${prev}-${d}T03:30:00.000Z`, out: `${prev}-${d}T12:30:00.000Z` }] });
  const r1 = await post(HR, 'auto-run'); okc(r1);
  assert.ok(r1.json.steps.attendance.stored >= 2, `attendance evidence was made: ${JSON.stringify(r1.json.steps.attendance)}`);
  const evs = (await get(HR, 'ev-list', { scope: 'all' })).json.items.filter((e: any) => e.title.startsWith('Attendance '));
  assert.ok(evs.length >= 2 && evs.every((e: any) => e.kpiName === 'Attendance & punctuality' && e.status === 'VERIFIED'), 'mapped to the named KPI, never guessed');
  assert.ok(evs.every((e: any) => e.uid !== 'u_d'), 'a sales executive has no such KPI, so gets nothing');
  const r2 = await post(HR, 'auto-run'); okc(r2);
  assert.equal(r2.json.steps.attendance.stored, 0, 'running again adds nothing twice');
  assert.equal((await get(HR, 'ev-list', { scope: 'all' })).json.items.filter((e: any) => e.title.startsWith('Attendance ')).length, evs.length);

  // ---- 3. evidence feeds: link rules, graceful failure, and a trusted system import
  assert.equal(feedUrl('https://docs.google.com/spreadsheets/d/AbC_123/edit#gid=77'), 'https://docs.google.com/spreadsheets/d/AbC_123/export?format=csv&gid=77');
  assert.equal(feedUrl('https://example.com/a.csv'), 'https://example.com/a.csv');
  assert.equal((await post(A, 'feed-save', { name: 'x', url: 'https://x.com/a.csv' })).status, 403);
  assert.equal((await post(HR, 'feed-save', { name: 'Sales', url: 'http://x.com/a.csv' })).status, 400, 'https only');
  assert.equal((await post(HR, 'feed-save', { name: '', url: 'https://x.com/a.csv' })).status, 400);
  const feed = await post(HR, 'feed-save', { name: 'Sales sheet', url: 'https://feed.invalid/a.csv' }); okc(feed);
  const bad = await post(HR, 'feed-run', { id: feed.json.item.id });
  assert.equal(bad.status, 400, 'an unreachable feed fails in plain words');
  assert.match((await get(HR, 'auto-get')).json.feeds[0].lastResult, /^Problem/);
  assert.ok((await get(HR, 'exception-list')).json.items.some((e: any) => e.type === 'TASK_EVENT_PROBLEM' && /Sales sheet/.test(e.detail)), 'a failing feed is logged for HR');
  const sys = await loadSystem(CID, 'Test feed');
  const csv = `employee_email,task_id,title,link,completed_on,kpi\nu_a@acme.com,T-1,Landing page,https://x.com/1,${t},Delivery KPI\nu_b@acme.com,T-2,Icon set,https://x.com/2,${t},Delivery KPI\nnobody@acme.com,T-3,Ghost,https://x.com/3,${t},Delivery KPI\n`;
  const imp = await importCsvText(sys, csv, { uid: 'system', name: 'Feed: test', system: true });
  assert.equal(imp.status, 200); assert.equal(imp.json.stored, 2, 'a feed may fill evidence for anyone in the company'); assert.equal(imp.json.unassigned, 1, 'an unknown email is logged, not scored');
  assert.equal((await importCsvText(sys, csv, { uid: 'system', name: 'Feed: test', system: true })).json.duplicates, 2, 'importing the same rows again duplicates nothing');
  assert.equal((await post(BOSS, 'ev-import', { csv: `employee_email,title,link\nu_hr@acme.com,Not mine,https://x.com\n` })).json.rejected.length, 1, 'a person importing is still limited to their own reports');

  // ---- 4. cycles open on their date, never twice, never early
  assert.equal((await post(HR, 'cycle-save', { name: 'Bad', periodStart: `${prev}-01`, periodEnd: t, autoOpenOn: 'soon' })).status, 400);
  const solo = await post(HR, 'cycle-save', { name: 'Solo review', reviewType: 'QUARTERLY', periodStart: `${prev}-01`, periodEnd: t, selfReviewDeadline: addDays(t, 5), managerDeadline: addDays(t, 10), hrDeadline: addDays(t, 15), scope: 'SELECTED', employeeUids: ['u_a'], autoOpenOn: addDays(t, -1) }); okc(solo);
  const later = await post(HR, 'cycle-save', { name: 'Next quarter', reviewType: 'QUARTERLY', periodStart: t, periodEnd: addDays(t, 90), scope: 'ALL', autoOpenOn: addDays(t, 30) }); okc(later);
  assert.equal((await get(HR, 'auto-get')).json.waitingCycles.length, 2);
  const open = await post(HR, 'auto-run'); okc(open);
  assert.match(open.json.steps.openCycles['Solo review'], /1 review/, 'the due cycle opened by itself');
  assert.equal(open.json.steps.openCycles['Next quarter'], undefined, 'a future date is not opened early');
  const cycles = (await get(HR, 'cycle-list')).json.items;
  assert.ok(cycles.find((c: any) => c.name === 'Solo review').openedAt && !cycles.find((c: any) => c.name === 'Next quarter').openedAt);
  const reviews = (await get(HR, 'review-list', { scope: 'all' })).json.items.filter((r: any) => r.cycleName === 'Solo review');
  assert.equal(reviews.length, 1, 'opening again would not duplicate'); assert.equal((await post(HR, 'auto-run')).json.steps.openCycles['Solo review'], undefined);
  const rv = reviews[0];

  // ---- 5. the employee's draft comes from their own recorded work and nobody else's
  okc(await post(A, 'ev-add', { title: 'Shipped the brand refresh', link: 'https://x.com/brand', completedOn: t, kpi: 'Delivery KPI', source: 'REPORT' }));
  const pre = await get(A, 'self-prefill', { reviewId: rv.id }); okc(pre);
  assert.match(pre.json.achievements, /Shipped the brand refresh/); assert.match(pre.json.achievements, /Landing page/);
  assert.ok(!/Icon set/.test(pre.json.achievements), "a colleague's work never shows up");
  assert.ok(!/Attendance/.test(pre.json.achievements), 'attendance is context, not an achievement');
  const delivery = pre.json.kpis.find((k: any) => k.evidenceIds.length >= 2); assert.ok(delivery, 'evidence is linked to the right KPI');
  assert.equal((await get(BOSS, 'self-prefill', { reviewId: rv.id })).status, 404, 'only the employee gets the draft');
  assert.equal((await get(OTHER, 'self-prefill', { reviewId: rv.id })).status, 404);

  // ---- 6. the manager's pack: for evaluators only, facts only, never a rating
  assert.equal((await get(A, 'pack-get', { reviewId: rv.id })).status, 403, 'the employee does not get the evaluator pack');
  assert.equal((await get(B, 'pack-get', { reviewId: rv.id })).status, 403, 'a colleague cannot open it');
  assert.equal((await get(OTHER, 'pack-get', { reviewId: rv.id })).status, 404, 'another company cannot open it');
  const pk = await get(BOSS, 'pack-get', { reviewId: rv.id }); okc(pk);
  const dk = pk.json.pack.kpis.find((k: any) => k.kpiName === 'Delivery KPI');
  assert.ok(dk.counts.pending >= 1 && dk.items.length >= 2, 'evidence is grouped by KPI');
  assert.equal(pk.json.pack.draft.source, 'RULES', 'without an AI key the plain summary is used');
  assert.ok(pk.json.pack.draft.points.length > 0);
  assert.ok(!JSON.stringify(pk.json).match(/"rating"\s*:\s*[1-5]/), 'the pack never carries a suggested rating');
  const ver = pk.json.pack.kpis.flatMap((k: any) => k.items).find((i: any) => i.title === 'Landing page');
  okc(await post(BOSS, 'ev-verify', { id: ver.id, decision: 'VERIFY' }));
  assert.ok((await get(BOSS, 'pack-get', { reviewId: rv.id })).json.pack.kpis.find((k: any) => k.kpiName === 'Delivery KPI').suggestedEvidenceIds.includes(ver.id), 'verified evidence is offered for attaching');

  // ---- 7. the employee submits; the manager gets exactly one pack note
  const g = (await get(A, 'review-get', { id: rv.id })).json;
  okc(await post(A, 'review-self', { id: rv.id, submit: true, achievements: pre.json.achievements, kpis: pre.json.kpis, comps: g.comps.map((c: any) => ({ competencyId: c.competencyId, selfRating: 4, selfEvidence: 'example' })) }));
  assert.ok((await get(BOSS, 'review-get', { id: rv.id })).json.item.kpis.some((k: any) => k.evidenceIds.length >= 2), 'the draft attached its evidence');
  const pack1 = await post(HR, 'auto-run'); okc(pack1);
  assert.equal(pack1.json.steps.packs.sent, 1); assert.equal(fdb.all('pmItems').filter((x) => x.kind === 'packSent' && x.reviewId === rv.id).length, 1, 'the note is recorded');
  assert.equal((await post(HR, 'auto-run')).json.steps.packs.sent, 0, 'one note per review, ever');

  // ---- 8. approved reviews publish themselves, then the finished cycle locks itself
  const kp = g.item.kpis;
  okc(await post(BOSS, 'review-manager', { id: rv.id, submit: true, managerEvaluation: 'Solid period with good delivery.', kpis: [{ targetId: kp[0].targetId, rating: 4, managerNote: 'good' }, { targetId: kp[1].targetId, insufficientEvidence: kp[1].kpiName !== 'Delivery KPI' ? false : true, rating: 3 }], comps: g.comps.map((c: any) => ({ competencyId: c.competencyId, managerRating: 4, observedExamples: 'seen in review' })), sopNotAssessedReason: 'Not in scope this period' }), 'manager');
  okc(await post(BOSS, 'review-discuss', { id: rv.id, heldOn: t, notes: 'Talked it through' }));
  okc(await post(HR, 'review-hr', { id: rv.id, decision: 'PASS', acceptPartial: true }));
  okc(await post(AP, 'review-approve', { id: rv.id, finalRating: 4, finalComments: 'Strong period.' }));
  assert.equal((await get(HR, 'review-get', { id: rv.id })).json.item.status, 'APPROVED');
  const pub = await post(HR, 'auto-run'); okc(pub);
  assert.equal(pub.json.steps.publish.published, 1);
  const published = (await get(HR, 'review-get', { id: rv.id })).json.item;
  assert.equal(published.status, 'PUBLISHED'); assert.equal(published.publishedBy, 'Autopilot');
  assert.equal(pub.json.steps.lock.locked, 0, 'not locked while the employee has not answered');
  assert.equal((await post(HR, 'auto-run')).json.steps.publish.published, 0, 'published once');
  okc(await post(A, 'review-respond', { id: rv.id, response: 'ACKNOWLEDGE', comment: 'Thanks' }));
  const fin = await post(HR, 'auto-run'); okc(fin);
  assert.equal(fin.json.steps.lock.locked, 1, 'everyone answered, so the cycle locks');
  assert.equal((await get(HR, 'cycle-list')).json.items.find((c: any) => c.name === 'Solo review').lockStatus, 'LOCKED');
  assert.equal((await get(HR, 'cycle-list')).json.items.find((c: any) => c.name === 'Next quarter').lockStatus, 'OPEN', 'other cycles are untouched');

  // ---- 9. the trail and the daily job
  const trail = (await get(HR, 'audit-list')).json.items.map((x: any) => x.action);
  for (const a of ['AUTOPILOT_SETTINGS', 'OPENED', 'PACK_VIEWED', 'PUBLISHED', 'LOCKED']) assert.ok(trail.includes(a), `${a} is on the audit trail`);
  assert.ok((await get(HR, 'auto-get')).json.settings.lastRun.at, 'HR can see when the autopilot last ran');
  process.env.CRON_SECRET = 'sekret';
  assert.equal((await call({ authorization: 'Bearer nope' }, 'GET', 'daily')).status, 401);
  const daily = await call({ authorization: 'Bearer sekret' }, 'GET', 'daily'); okc(daily);
  assert.ok(daily.json.results[CID].autopilot, 'the daily job runs the autopilot');
  void D;
  console.log('pm.auto: all checks passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
