import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { routeOnboarding } from '../api/_lib/onboarding.ts';
import { assetsHeldBy } from '../api/_lib/joiningApi.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['onboarding.manage']);
const EMP = tok('u_emp');
const OTHER = tok('u_x', ['app.manage'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHiring({ method, action, headers: h, body, query });
const TOKEN = 'a'.repeat(48);

fdb.seed('employees', 'u_emp', { companyId: CID, authUid: 'u_emp', name: 'Eli Employee', email: 'u_emp@acme.com', active: true, empId: 'ACM-001' });
fdb.seed('onboardings', 'ob1', { companyId: CID, applicationId: 'ap1', name: 'Cat Candidate', email: 'cat@x.com', designation: 'Dev', employeeId: 'ACM-009', token: TOKEN, status: 'DOCS_REQUESTED', docs: {}, accounts: {}, onboardingDate: '2030-01-10', createdAt: '', updatedAt: '' });
fdb.seed('hiringItems', 'of1', { id: 'of1', companyId: CID, kind: 'offer', status: 'ACCEPTED', candidateName: 'Cat Candidate', designation: 'Dev', department: 'Eng', joiningDate: '2030-01-10', approvedCtcLpa: 9, onboardingId: 'ob1' });

async function main() {
  // ---- access
  assert.equal((await call(EMP, 'GET', 'joining-board')).status, 403);
  assert.equal((await call({}, 'GET', 'asset-list')).status, 401);
  assert.equal((await call(HR, 'POST', 'joining-board')).status, 405);

  // ---- the candidate cannot submit without a contact and the signed documents
  const pub = (a: string, m: string, body: any = {}, query: any = {}) => routeOnboarding({ method: m, action: a, query, body, headers: {} } as any);
  const info = await pub('public-info', 'GET', {}, { token: TOKEN });
  assert.ok(info.json.documents.some((d: any) => d.key === 'signed_docs' && d.required));
  assert.equal((await pub('emergency', 'POST', { token: 'bad', name: 'A', phone: '12345678' })).status, 404);
  assert.equal((await pub('emergency', 'POST', { token: TOKEN, name: '', phone: '12345678' })).status, 400);
  assert.equal((await pub('emergency', 'POST', { token: TOKEN, name: 'Sam', phone: '12' })).status, 400);
  assert.equal((await pub('submit', 'POST', { token: TOKEN })).status, 400, 'documents missing');
  const docs: any = {};
  for (const d of info.json.documents.filter((x: any) => x.required)) docs[d.key] = { fileName: 'f.pdf', size: 1, uploadedAt: '' };
  fdb.seed('onboardings', 'ob1', { ...fdb.all('onboardings')[0], docs });
  assert.equal((await pub('submit', 'POST', { token: TOKEN })).json.error, 'Please add an emergency contact (name and phone).');
  assert.equal((await pub('emergency', 'POST', { token: TOKEN, name: 'Sam Parent', relation: 'Father', phone: '+91 98765 43210' })).status, 200);
  const sub = await pub('submit', 'POST', { token: TOKEN });
  assert.equal(sub.status, 200, JSON.stringify(sub.json));
  assert.equal((await pub('emergency', 'POST', { token: TOKEN, name: 'X', phone: '12345678' })).status, 409, 'locked after submitting');

  // ---- asset register
  assert.equal((await call(HR, 'POST', 'asset-save', { tag: '', type: 'LAPTOP' })).status, 400);
  assert.equal((await call(HR, 'POST', 'asset-save', { tag: 'lap-1', type: 'TOASTER' })).status, 400);
  const a1 = (await call(HR, 'POST', 'asset-save', { tag: 'lap-1', type: 'LAPTOP', serial: 'SN1' })).json.item;
  assert.equal(a1.tag, 'LAP-1');
  assert.equal(a1.status, 'IN_STOCK');
  assert.equal((await call(HR, 'POST', 'asset-save', { tag: 'LAP-1', type: 'LAPTOP' })).status, 409, 'tags are unique');
  assert.equal((await call(OTHER, 'POST', 'asset-issue', { id: a1.id, onboardingId: 'ob1' })).status, 404, 'another company cannot touch this asset');
  assert.equal((await call(HR, 'POST', 'asset-issue', { id: a1.id })).status, 400, 'choose who');
  assert.equal((await call(HR, 'POST', 'asset-issue', { id: a1.id, onboardingId: 'nope' })).status, 404);
  const [i1, i2] = await Promise.all([
    call(HR, 'POST', 'asset-issue', { id: a1.id, onboardingId: 'ob1' }),
    call(HR, 'POST', 'asset-issue', { id: a1.id, uid: 'u_emp' }),
  ]);
  assert.deepEqual([i1.status, i2.status].sort(), [200, 409], 'one laptop cannot go to two people');
  assert.equal((await call(HR, 'POST', 'asset-issue', { id: a1.id, onboardingId: 'ob1' })).status, 409);
  const held = fdb.all('hiringItems').find((x) => x.id === a1.id)!;
  assert.equal(held.status, 'ISSUED');
  if (held.holderUid === 'u_emp') assert.equal((await assetsHeldBy(CID, 'u_emp')).length, 1);
  assert.equal((await call(HR, 'GET', 'asset-list', {}, { status: 'ISSUED' })).json.items.length, 1);
  assert.equal((await call(HR, 'POST', 'asset-return', { id: 'zzz' })).status, 404);
  const ret = await call(HR, 'POST', 'asset-return', { id: a1.id, condition: 'DAMAGED', note: 'Cracked corner' });
  assert.equal(ret.json.item.status, 'IN_STOCK');
  assert.equal((await call(HR, 'POST', 'asset-return', { id: a1.id })).status, 409);
  assert.equal(ret.json.item.history.length, 2);
  await call(HR, 'POST', 'asset-issue', { id: a1.id, onboardingId: 'ob1' });
  const lost = await call(HR, 'POST', 'asset-return', { id: a1.id, condition: 'LOST' });
  assert.equal(lost.json.item.status, 'RETIRED', 'a lost asset leaves stock');
  assert.equal((await call(HR, 'POST', 'asset-issue', { id: a1.id, onboardingId: 'ob1' })).status, 409);
  const a2 = (await call(HR, 'POST', 'asset-save', { tag: 'LAP-2', type: 'LAPTOP' })).json.item;
  await call(HR, 'POST', 'asset-issue', { id: a2.id, onboardingId: 'ob1' });

  // ---- welcome kit
  const kit = (await call(HR, 'GET', 'kit-get')).json.kit;
  assert.ok(kit.items.length >= 5);
  assert.equal((await call(HR, 'POST', 'kit-save', { items: [] })).status, 400);
  await call(HR, 'POST', 'kit-save', { items: ['Laptop', 'ID card'], message: 'Come at 10.' });
  assert.deepEqual((await call(HR, 'GET', 'kit-get')).json.kit.items, ['Laptop', 'ID card']);
  assert.equal((await call(HR, 'POST', 'kit-tick', { onboardingId: 'ob1', item: 'Toaster' })).status, 400);
  assert.equal((await call(HR, 'POST', 'kit-tick', { onboardingId: 'ob1', item: 'Laptop' })).status, 200);
  assert.equal((await call(OTHER, 'POST', 'kit-tick', { onboardingId: 'ob1', item: 'Laptop' })).status, 404);

  // ---- IT setup
  assert.equal((await call(HR, 'POST', 'it-set', { onboardingId: 'ob1', key: 'wifi', status: 'DONE' })).status, 400);
  assert.equal((await call(HR, 'POST', 'it-set', { onboardingId: 'ob1', key: 'm365', status: 'MAYBE' })).status, 400);
  assert.equal((await call(HR, 'POST', 'it-set', { onboardingId: 'ob1', key: 'm365', status: 'DONE', note: 'cat@acme.com' })).status, 200);

  // ---- the board
  const board = (await call(HR, 'GET', 'joining-board')).json;
  assert.equal(board.rows.length, 1);
  const row = board.rows[0];
  assert.equal(row.emergency, true);
  assert.equal(row.kit.done, 1);
  assert.equal(row.kit.total, 2);
  assert.equal(row.itAccounts.m365.status, 'DONE');
  assert.equal(row.assets.length, 1);
  assert.equal(row.docsUploaded, row.docsRequired);
  assert.equal(JSON.stringify(board).includes('password'), false, 'credentials never appear on the board');
  assert.equal(JSON.stringify(board).includes('98765'), false, 'the emergency phone number is not on the board');
  assert.equal((await call(OTHER, 'GET', 'joining-board')).json.rows.length, 0, 'another company sees nothing');

  console.log('hiring joining ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
