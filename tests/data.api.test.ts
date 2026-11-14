/** The browser data gateway (api/_lib/dataApi.ts): the client-facing part of firestore.rules, enforced on the server. */
import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeData } from '../api/_lib/dataApi.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });

const tok = (uid: string, perms: string[] = [], cid = 'c1', cs = 'ACTIVE', extra: any = {}) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@a.com`, cid, cs, perms, adm: false, ...extra })).toString('base64')}` });
const call = (action: string, headers: any, body: any) => routeData({ method: 'POST', action, body, headers });
const code = async (p: Promise<{ status: number }>) => (await p).status;

async function main() {
  fdb.seed('companies', 'c1', { name: 'Acme', status: 'ACTIVE' });
  fdb.seed('companies', 'c2', { name: 'Other', status: 'ACTIVE' });
  fdb.seed('employees', 'e1', { companyId: 'c1', name: 'Eve', email: 'e1@a.com' });
  fdb.seed('employees', 'e2', { companyId: 'c1', name: 'Bob' });
  fdb.seed('employees', 'x1', { companyId: 'c2', name: 'Mallory' });
  fdb.seed('documents', 'd1', { companyId: 'c1', id: 'd1', title: 'Policy' });
  fdb.seed('documents', 'dx', { companyId: 'c2', id: 'dx', title: 'Secret' });
  fdb.seed('hiringItems', 'h1', { companyId: 'c1' });

  const eve = tok('e1');
  const author = tok('e1', ['doc.create', 'doc.review', 'doc.publish', 'doc.delete']);

  // nothing without a token
  assert.equal(await code(call('data-get', {}, { collection: 'documents', id: 'd1' })), 401);

  // companies: own company only (even while pending), platform admin any
  assert.equal((await call('data-get', eve, { collection: 'companies', id: 'c1' })).json.exists, true);
  assert.equal((await call('data-get', eve, { collection: 'companies', id: 'c2' })).json.exists, false);
  assert.equal((await call('data-get', tok('e1', [], 'c1', 'PENDING'), { collection: 'companies', id: 'c1' })).json.data.status, 'ACTIVE');
  assert.equal((await call('data-get', tok('pa', [], '', '', { pa: true }), { collection: 'companies', id: 'c2' })).json.exists, true);

  // employees: self, or same company; never another company; list is company-scoped
  assert.equal((await call('data-get', eve, { collection: 'employees', id: 'e2' })).json.exists, true);
  assert.equal((await call('data-get', eve, { collection: 'employees', id: 'x1' })).json.exists, false);
  const list = await call('data-list', eve, { collection: 'employees', filters: [{ field: 'companyId', op: '==', value: 'c1' }] });
  assert.deepEqual(list.json.docs.map((d: any) => d.id).sort(), ['e1', 'e2']);
  // asking for another company's records is refused, and omitting the filter still only returns your own
  assert.equal(await code(call('data-list', eve, { collection: 'employees', filters: [{ field: 'companyId', op: '==', value: 'c2' }] })), 403);
  assert.equal((await call('data-list', eve, { collection: 'employees', filters: [] })).json.docs.length, 2);
  assert.equal((await call('data-list', eve, { collection: 'employees', filters: [{ field: 'name', op: '==', value: 'Eve' }] })).json.docs.length, 1);

  // server-only collections are not reachable from the browser
  assert.equal(await code(call('data-get', eve, { collection: 'hiringItems', id: 'h1' })), 403);
  assert.equal(await code(call('data-list', eve, { collection: 'integrationSecrets' })), 403);
  assert.equal(await code(call('data-set', author, { collection: 'payrollRuns', id: 'r1', data: {} })), 403);

  // reading documents is company-scoped
  assert.equal((await call('data-get', eve, { collection: 'documents', id: 'd1' })).json.exists, true);
  assert.equal((await call('data-get', eve, { collection: 'documents', id: 'dx' })).json.exists, false);

  // employees / departments / roles are read-only from the browser
  assert.equal(await code(call('data-set', author, { collection: 'employees', id: 'e1', data: { name: 'Hacked' } })), 403);
  assert.equal(await code(call('data-delete', author, { collection: 'employees', id: 'e1' })), 403);

  // creating needs the permission, and the company is stamped by the server
  assert.equal(await code(call('data-set', eve, { collection: 'documents', id: 'd2', data: { id: 'd2', title: 'X' } })), 403);
  assert.equal(await code(call('data-set', author, { collection: 'documents', id: 'd2', data: { id: 'd2', title: 'New', companyId: 'c2' } })), 403);
  assert.equal(await code(call('data-set', author, { collection: 'documents', id: 'd2', data: { id: 'd2', title: 'New' } })), 200);
  assert.equal(fdb.all('documents').find((d) => d.id === 'd2')!.companyId, 'c1');
  assert.equal(await code(call('data-set', author, { collection: 'documents', id: 'bad id!', data: {} })), 400);
  assert.equal(await code(call('data-set', author, { collection: 'documents', id: 'd3', data: { id: 'other', title: 'N' } })), 400);

  // updating: permission, same company, id cannot change
  assert.equal(await code(call('data-set', eve, { collection: 'documents', id: 'd1', data: { id: 'd1', title: 'Edit' } })), 403);
  assert.equal(await code(call('data-set', author, { collection: 'documents', id: 'dx', data: { id: 'dx', title: 'Steal' } })), 403);
  assert.equal(await code(call('data-update', author, { collection: 'documents', id: 'd1', data: { id: 'zzz' } })), 403);
  assert.equal(await code(call('data-update', author, { collection: 'documents', id: 'd1', data: { title: 'Renamed' } })), 200);
  assert.equal(fdb.all('documents').find((d) => d.id === 'd1')!.title, 'Renamed');
  assert.equal(await code(call('data-update', author, { collection: 'documents', id: 'nope', data: { title: 'x' } })), 404);
  assert.equal(await code(call('data-set', author, { collection: 'documents', id: 'd1', data: { x: 'y' }, merge: true })), 200);

  // deleting
  assert.equal(await code(call('data-delete', eve, { collection: 'documents', id: 'd2' })), 403);
  assert.equal(await code(call('data-delete', author, { collection: 'documents', id: 'dx' })), 403);
  assert.equal(await code(call('data-delete', author, { collection: 'documents', id: 'd2' })), 200);
  assert.equal(fdb.all('documents').some((d) => d.id === 'd2'), false);

  // audit logs: any member may add one; nobody may change or delete it
  assert.equal(await code(call('data-set', eve, { collection: 'auditLogs', id: 'l1', data: { id: 'l1', action: 'VIEW' } })), 200);
  assert.equal(await code(call('data-set', eve, { collection: 'auditLogs', id: 'l1', data: { id: 'l1', action: 'EDIT' } })), 403);
  assert.equal(await code(call('data-update', author, { collection: 'auditLogs', id: 'l1', data: { action: 'EDIT' } })), 403);
  assert.equal(await code(call('data-delete', author, { collection: 'auditLogs', id: 'l1' })), 403);

  // acknowledgments cannot go back from ACKNOWLEDGED to PENDING
  const ack = tok('e1', ['doc.acknowledge']);
  assert.equal(await code(call('data-set', ack, { collection: 'acknowledgments', id: 'k1', data: { status: 'PENDING' } })), 200);
  assert.equal(await code(call('data-set', ack, { collection: 'acknowledgments', id: 'k1', data: { status: 'ACKNOWLEDGED' } })), 200);
  assert.equal(await code(call('data-set', ack, { collection: 'acknowledgments', id: 'k1', data: { status: 'PENDING' } })), 403);

  // requisitions: need hiring permissions to read, and can never be deleted
  const hr = tok('e1', ['req.create', 'req.hr_decide']);
  assert.equal(await code(call('data-list', eve, { collection: 'requisitions' })), 403);
  assert.equal(await code(call('data-set', hr, { collection: 'requisitions', id: 'r1', data: { id: 'r1', status: 'REQUESTED' } })), 200);
  assert.equal((await call('data-list', hr, { collection: 'requisitions' })).json.docs.length, 1);
  assert.equal(await code(call('data-delete', hr, { collection: 'requisitions', id: 'r1' })), 403);

  // a pending / suspended company can write nothing
  assert.equal(await code(call('data-set', tok('e1', ['doc.create'], 'c1', 'PENDING'), { collection: 'documents', id: 'd9', data: { id: 'd9' } })), 403);

  // unsafe filters are refused
  assert.equal(await code(call('data-list', eve, { collection: 'documents', filters: [{ field: '$where', op: '==', value: 1 }] })), 400);
  assert.equal(await code(call('data-list', eve, { collection: 'documents', filters: [{ field: 'title', op: '==', value: { $ne: 1 } }] })), 400);
  assert.equal(await code(call('data-list', eve, { collection: 'documents', filters: [{ field: 'title', op: '>', value: 1 }] })), 400);

  console.log('data gateway tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
