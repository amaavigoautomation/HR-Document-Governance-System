import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { analyseHistory, findDuplicates, nameSimilarity, phoneKey, recommend } from '../shared/resumeAi.ts';
import { followupTemplate } from '../api/_lib/aiHiringApi.ts';

delete process.env.OPENAI_API_KEY;

// ---- pure rules
const h = analyseHistory([{ company: 'A', role: 'Dev', from: '2018-01', to: '2019-12' }, { company: 'B', role: 'Dev', from: '2020-08', to: '2021-02' }, { company: 'C', role: 'Dev', from: '2021-03', to: 'present' }], '2026-11');
assert.equal(h.jobs, 3);
assert.ok(h.gaps.length >= 1, 'the 7-month gap between A and B is reported');
assert.equal(phoneKey('+91 98765-43210'), '9876543210');
assert.ok(nameSimilarity('Rahul Sharma', 'Sharma Rahul') > 0.8);
const g = findDuplicates([
  { id: '1', name: 'Rahul Sharma', email: 'r@x.com', designation: 'Dev' }, { id: '2', name: 'R Sharma', email: 'R@x.com', designation: 'QA' }, { id: '3', name: 'Other Person', email: 'o@x.com' },
]);
assert.equal(g.length, 1);
assert.equal(g[0].confidence, 'SURE');
assert.deepEqual([...g[0].ids].sort(), ['1', '2']);
const r = recommend({ score: 85, interview: { average: 4.5, recommendation: 'STRONG_HIRE' } as any, screening: 'QUALIFIED', assessments: [], expectedCtcLpa: 8, bandMaxLpa: 10 });
assert.ok(['HIRE', 'CONSIDER'].includes(r.verdict));
const thin = recommend({ score: null, interview: null, screening: '', assessments: [], expectedCtcLpa: null, bandMaxLpa: null });
assert.ok(['HOLD', 'CONSIDER'].includes(thin.verdict) && thin.verdict !== 'HIRE', 'thin evidence never gives a hire');
assert.ok(followupTemplate('reject', 'Asha', 'Dev', 'Acme').body.includes('Asha'));

// ---- API with AI off
const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const call = (h: any, m: string, a: string, body: any = {}) => routeHiring({ method: m, action: a, headers: h, body, query: {} });
const app = (id: string, o: any = {}) => ({ id, companyId: 'c1', name: 'N' + id, email: `${id}@x.com`, mobile: '', designation: 'Dev', status: 'New Applicant', createdAt: `2026-10-0${id}T00:00:00Z`, ...o });
fdb.seed('applications', '1', app('1', { email: 'same@x.com', city: 'Pune' }));
fdb.seed('applications', '2', app('2', { email: 'SAME@x.com', mobile: '9876543210' }));
fdb.seed('applications', '3', app('3'));
fdb.seed('applications', '9', app('9', { companyId: 'c2', email: 'same@x.com' }));
fdb.seed('hiringItems', 'rt1', { id: 'rt1', companyId: 'c1', kind: 'rating', applicationId: '2' });
const hr = tok('h', ['app.manage']);

(async () => {
  assert.equal((await call(tok('x'), 'GET', 'ai-status')).status, 403);
  assert.equal((await call({}, 'GET', 'dup-scan')).status, 401);
  const st = await call(hr, 'GET', 'ai-status');
  assert.equal(st.status, 200, JSON.stringify(st.json));
  assert.equal(st.json.usage.enabled, false);

  const scan = await call(hr, 'GET', 'dup-scan');
  assert.equal(scan.json.groups.length, 1, 'the other company\'s record is not matched');
  assert.equal(scan.json.groups[0].candidates.length, 2);

  assert.equal((await call(hr, 'POST', 'dup-merge', { keepId: '1', mergeIds: ['2'] })).status, 400, 'needs confirm');
  const m = await call(hr, 'POST', 'dup-merge', { keepId: '1', mergeIds: ['2'], confirm: true });
  assert.equal(m.status, 200, JSON.stringify(m.json));
  assert.equal(fdb.all('applications').some((a: any) => a.id === '2'), false);
  assert.equal(fdb.all('applications').find((a: any) => a.id === '1')!.mobile, '9876543210', 'missing phone copied from the duplicate');
  assert.equal(fdb.all('hiringItems').find((i: any) => i.id === 'rt1')!.applicationId, '1', 'attached records move to the kept candidate');
  assert.equal((await call(hr, 'POST', 'dup-merge', { keepId: '1', mergeIds: ['9'], confirm: true })).status, 404, 'cannot merge another company\'s record');

  assert.equal((await call(hr, 'POST', 'ai-compare', { applicationIds: ['1'] })).status, 400);
  const cmp = await call(hr, 'POST', 'ai-compare', { applicationIds: ['1', '3'] });
  assert.equal(cmp.status, 200, JSON.stringify(cmp.json));
  assert.equal(cmp.json.generatedBy, 'RULES');
  assert.equal(cmp.json.rows.length, 2);

  const rc = await call(hr, 'POST', 'ai-recommend', { applicationId: '1' });
  assert.equal(rc.status, 200, JSON.stringify(rc.json));
  assert.notEqual(rc.json.verdict, 'HIRE', 'a candidate with no evidence is not a hire');

  const fu = await call(hr, 'POST', 'ai-followup', { applicationId: '1', purpose: 'hold' });
  assert.equal(fu.json.generatedBy, 'TEMPLATE');
  assert.equal((await call(hr, 'POST', 'ai-followup', { applicationId: '1', purpose: 'bogus' })).status, 400);

  const ins = await call(tok('f', ['req.founder_decide']), 'GET', 'ai-insights');
  assert.equal(ins.status, 200, JSON.stringify(ins.json));
  assert.equal((await call(hr, 'GET', 'ai-insights')).status, 403);

  const rs = await call(hr, 'POST', 'ai-resume', { applicationId: '3' });
  assert.equal(rs.status, 400, 'no resume link');
  console.log('hiring ai ok');
})().catch((e) => { console.error(e); process.exit(1); });
