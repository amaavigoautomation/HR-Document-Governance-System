import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
process.env.HOME_COMPANY_ID = 'home';
const tok = (cid: string, perms: string[]) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid: 'u', email: 'u@x.com', cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const call = (h: any, method = 'POST') => routeHiring({ method, action: 'website-sync', headers: h, body: {}, query: {} });

const feed = [
  { id: 11, name: 'Asha', email: 'asha@x.com', designation: { title: 'react developer' }, interview_status: { title: 'Shortlisted' }, created_at: '2026-10-01' },
  { id: 12, name: 'Bo', email: 'bo@x.com', designation: 'Designer', created_at: '2026-10-02' },
  { id: 13, name: 'NoMail', email: 'bad', designation: 'Designer' },
];
(globalThis as any).fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ data: feed }) });

async function main() {
  assert.equal((await call({})).status, 401);
  assert.equal((await call(tok('home', []))).status, 403);
  assert.equal((await call(tok('home', ['app.manage']), 'GET')).status, 405);

  // A non-home company is skipped and nothing is written.
  const other = await call(tok('c2', ['app.manage']));
  assert.equal(other.json.skipped, true);
  assert.equal(fdb.all('applications').length, 0);

  // The home company gets the valid rows, with the website stage kept.
  const first = await call(tok('home', ['app.manage']));
  assert.equal(first.json.created, 2); assert.equal(first.json.invalid, 1);
  const rows = fdb.all('applications');
  assert.ok(rows.every((r: any) => r.companyId === 'home'));
  assert.equal(rows.find((r: any) => r.name === 'Asha')!.status, 'Shortlisted');

  // Re-running adds nothing and keeps work done since (stage moved by HR).
  const asha = rows.find((r: any) => r.name === 'Asha')!;
  fdb.seed('applications', asha.id, { ...asha, status: 'Interviewed' });
  const again = await call(tok('home', ['app.manage']));
  assert.equal(again.json.created, 0); assert.equal(again.json.existing, 2);
  assert.equal(fdb.all('applications').find((r: any) => r.name === 'Asha')!.status, 'Interviewed');
  console.log('website sync ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
