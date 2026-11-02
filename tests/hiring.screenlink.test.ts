import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { sweepScreeningLinks } from '../api/_lib/screeningLinkApi.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const tok = (uid: string, perms: string[] = [], cid = 'c1') => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const call = (h: any, m: string, a: string, body: any = {}, query: any = {}) => routeHiring({ method: m, action: a, headers: h, body, query });
fdb.seed('applications', 'a1', { id: 'a1', companyId: 'c1', name: 'Asha', email: 'asha@x.com', designation: 'Dev', status: 'New Applicant' });
fdb.seed('applications', 'a2', { id: 'a2', companyId: 'c2', name: 'Other', email: 'o@x.com', designation: 'Dev', status: 'New Applicant' });
const hr = tok('h', ['app.manage']);

(async () => {
  assert.equal((await call(tok('x'), 'POST', 'scrlink-create', { applicationId: 'a1' })).status, 403);
  assert.equal((await call(hr, 'POST', 'scrlink-create', { applicationId: 'a2' })).status, 404, 'other company');
  const c = await call(hr, 'POST', 'scrlink-create', { applicationId: 'a1' });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal((await call(hr, 'POST', 'scrlink-create', { applicationId: 'a1' })).status, 409, 'one open link per candidate');
  const stored = fdb.all('hiringItems').find((i: any) => i.kind === 'scrlink')!;
  const list = await call(hr, 'GET', 'scrlink-list');
  assert.equal(JSON.stringify(list.json).includes(stored.token), false, 'the secret token is never listed');
  assert.equal((await call({}, 'GET', 'scrlink-public-get', {}, { token: 'nope' })).status, 404);
  const g = await call({}, 'GET', 'scrlink-public-get', {}, { token: stored.token });
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal((await call({}, 'POST', 'scrlink-public-submit', { token: stored.token })).status, 400, 'needs a slot');
  const s = await call({}, 'POST', 'scrlink-public-submit', { token: stored.token, slots: ['2026-11-10T10:00'], noticePeriod: '30 days' });
  assert.equal(s.json.status, 'COMPLETED');
  assert.equal(fdb.all('hiringItems').find((i: any) => i.kind === 'scrlink')!.status, 'COMPLETED');

  // no answer after 3 days
  fdb.seed('hiringItems', 'old', { id: 'old', companyId: 'c1', kind: 'scrlink', applicationId: 'a1', status: 'PENDING', token: 'f'.repeat(48), sentAt: new Date(Date.now() - 4 * 86400_000).toISOString(), createdAt: new Date(Date.now() - 4 * 86400_000).toISOString() });
  fdb.seed('hiringItems', 'new', { id: 'new', companyId: 'c1', kind: 'scrlink', applicationId: 'a1', status: 'PENDING', token: 'e'.repeat(48), sentAt: nowIso(), createdAt: nowIso() });
  const sw = await sweepScreeningLinks();
  assert.equal(sw.marked, 1);
  assert.equal(fdb.all('hiringItems').find((i: any) => i.id === 'old')!.status, 'NO_RESPONSE');
  assert.equal(fdb.all('hiringItems').find((i: any) => i.id === 'new')!.status, 'PENDING');
  console.log('screening link ok');
})().catch((e) => { console.error(e); process.exit(1); });
function nowIso() { return new Date().toISOString(); }
