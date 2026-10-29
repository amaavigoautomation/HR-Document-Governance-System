import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routePerf } from '../api/_lib/perfApi.ts';
import { addDays, istToday } from '../shared/leaveEngine.ts';
import { MOOD_SCORE, buildMoodReport, lowMoodDepartments, moodGroup } from '../shared/mood.ts';

// ---- pure helpers
const rows = (uids: string[], date: string, mood: string) => uids.map((uid) => ({ uid, date, mood }));
assert.equal(moodGroup(rows(['a', 'b'], '2026-10-01', 'OK')).hidden, true, 'two people: hidden');
const g = moodGroup([...rows(['a', 'b', 'c'], '2026-10-01', 'EXCITED'), ...rows(['a'], '2026-10-02', 'UNHAPPY')]);
assert.equal(g.hidden, false);
assert.equal(g.people, 3);
assert.equal(g.average, (5 * 3 + 1) / 4);
assert.equal(g.counts!.EXCITED, 3);
assert.equal(moodGroup([{ uid: 'a', date: 'x', mood: 'NOPE' }]).responses, 0, 'unknown moods ignored');
assert.ok(MOOD_SCORE.UNHAPPY < MOOD_SCORE.SAD && MOOD_SCORE.SATISFIED < MOOD_SCORE.EXCITED);

const dept = (u: string) => (['a', 'b', 'c'].includes(u) ? 'Ops' : 'Sales');
const rep = buildMoodReport([...rows(['a', 'b', 'c'], '2026-10-02', 'SAD'), ...rows(['d'], '2026-10-02', 'EXCITED')], dept, 10, '2026-10-01', '2026-10-03');
assert.equal(rep.series.length, 3);
assert.equal(rep.series[0].responses, 0);
assert.equal(rep.series[1].hidden, false);
assert.equal(rep.participation.percent, 40);
assert.equal(rep.departments.find((d) => d.department === 'Sales')!.hidden, true, 'one person: hidden');
assert.equal(rep.departments.find((d) => d.department === 'Ops')!.average, 2);

const low = (days: string[]) => days.flatMap((d) => rows(['a', 'b', 'c'], d, 'SAD'));
assert.equal(lowMoodDepartments(low(['2026-10-01', '2026-10-02', '2026-10-03']), dept, '2026-10-03').length, 1);
assert.equal(lowMoodDepartments(low(['2026-10-02', '2026-10-03']), dept, '2026-10-03').length, 0, 'a missing day is not flagged');
assert.equal(lowMoodDepartments([...low(['2026-10-01', '2026-10-02']), ...rows(['a', 'b', 'c'], '2026-10-03', 'EXCITED')], dept, '2026-10-03').length, 0, 'recovered');

// ---- API
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = []) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid: CID, cs: 'ACTIVE', perms })).toString('base64')}` });
fdb.seed('companies', CID, { name: 'Acme' });
const ppl = ['u_hr', 'u_mgr', 'u_1', 'u_2', 'u_3', 'u_4'];
for (const uid of ppl) {
  fdb.seed('employees', uid, { companyId: CID, authUid: uid, name: uid, email: `${uid}@acme.com`, active: true, createdAt: '2020-01-01T00:00:00Z', departmentName: uid === 'u_hr' ? 'HR' : 'Ops' });
  fdb.seed('leaveProfiles', `${CID}__${uid}`, { companyId: CID, uid, managerUid: ['u_1', 'u_2', 'u_3', 'u_4'].includes(uid) ? 'u_mgr' : '' });
}
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routePerf({ method, action, headers: h, body, query });
const ok = async (h: any, m: string, a: string, b?: any, q?: any) => { const r = await call(h, m, a, b, q); assert.equal(r.status, 200, `${a}: ${JSON.stringify(r.json)}`); return r.json; };

assert.equal((await call(tok('u_1'), 'POST', 'mood-save', { mood: 'HAPPY?' })).status, 400);
await ok(tok('u_1'), 'POST', 'mood-save', { mood: 'SAD' });
await ok(tok('u_1'), 'POST', 'mood-save', { mood: 'OK' });
assert.equal((await ok(tok('u_1'), 'GET', 'mood-me')).today, 'OK', 'one answer a day, last one wins');
assert.equal((await ok(tok('u_1'), 'GET', 'mood-me')).history.length, 1);
assert.equal((await call(tok('u_1'), 'GET', 'mood-report', {}, { scope: 'company' })).status, 403, 'employees cannot see company mood');
assert.equal((await call(tok('u_1'), 'GET', 'mood-report', {}, { scope: 'team' })).status, 403, 'not a manager');

// two people so far: hidden
await ok(tok('u_2'), 'POST', 'mood-save', { mood: 'SAD' });
let r = await ok(tok('u_hr', ['perf.view']), 'GET', 'mood-report', {}, { scope: 'company', days: 7 });
assert.equal(r.report.overall.hidden, true);
assert.equal(r.report.overall.counts, null, 'no counts under 3 people');
await ok(tok('u_3'), 'POST', 'mood-save', { mood: 'UNHAPPY' });
r = await ok(tok('u_hr', ['perf.view']), 'GET', 'mood-report', {}, { scope: 'company', days: 7 });
assert.equal(r.report.overall.hidden, false);
assert.equal(r.report.overall.people, 3);
assert.equal(r.report.participation.responders, 3);
assert.equal(r.report.series.length, 7);
const team = await ok(tok('u_mgr'), 'GET', 'mood-report', {}, { scope: 'team' });
assert.equal(team.report.overall.hidden, false);
assert.deepEqual(team.report.departments, []);
assert.ok(!JSON.stringify(team).includes('u_1'), 'no names in group results');

// low mood: three days of sad/unhappy in Ops raises a group-level exception, once
const today = istToday();
for (const d of [addDays(today, -2), addDays(today, -1)]) for (const uid of ['u_1', 'u_2', 'u_3']) fdb.seed('moodCheckins', `${CID}__${uid}__${d}`, { companyId: CID, uid, date: d, mood: 'SAD', at: '' });
fdb.seed('perfSettings', CID, { companyId: CID, competencies: [{ id: 'x', name: 'x', standard: '', evidence: '', group: 'CORE', active: true }], roleFamilies: [], competencyVersion: 1, webhookKey: '', updatedAt: '', updatedBy: '' });
process.env.CRON_SECRET = 'secret-secret';
const c1 = await ok({}, 'GET', 'cron', {}, { key: 'secret-secret' });
assert.equal(c1.companies[0].error, undefined);
assert.equal(c1.companies[0].lowMood, 1);
await ok({}, 'GET', 'cron', {}, { key: 'secret-secret' });
const ex = (await ok(tok('u_hr', ['perf.manage']), 'GET', 'exceptions')).items.filter((e: any) => e.category === 'MOOD_LOW');
assert.equal(ex.length, 1, 'a rerun does not repeat the alert');
assert.ok(!/u_[0-9]/.test(ex[0].message), 'the alert names a group, not people');

console.log('mood tests passed');
