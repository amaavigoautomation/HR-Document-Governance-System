/** Checks that the MongoDB adapter behaves like the Firestore Admin API on the points the app relies on. */
import assert from 'node:assert/strict';
import { MongoFirestore, MongoFieldValues as FV } from '../api/_lib/mongoFirestore.ts';
import { StubMongoDb } from './mongoStub.ts';

const db = new MongoFirestore(new StubMongoDb() as any);
const c = db.collection('things');

async function main() {
  // set / get / exists / undefined fields are skipped
  await c.doc('a').set({ companyId: 'c1', name: 'A', tags: ['x'], nested: { k: 1, j: 2 }, skipped: undefined });
  const a = await c.doc('a').get();
  assert.equal(a.exists, true);
  assert.deepEqual(a.data(), { companyId: 'c1', name: 'A', tags: ['x'], nested: { k: 1, j: 2 } });
  assert.equal((await c.doc('nope').get()).exists, false);
  assert.equal((await c.doc('nope').get()).data(), undefined);

  // set(merge) deep-merges maps and replaces arrays; update() replaces a map field
  await c.doc('a').set({ nested: { k: 9 }, tags: ['y'] }, { merge: true });
  assert.deepEqual((await c.doc('a').get()).data()!.nested, { k: 9, j: 2 });
  assert.deepEqual((await c.doc('a').get()).data()!.tags, ['y']);
  await c.doc('a').update({ nested: { only: true } });
  assert.deepEqual((await c.doc('a').get()).data()!.nested, { only: true });
  await c.doc('a').update({ 'deep.path': 5 });
  assert.equal((await c.doc('a').get()).get('deep.path'), 5);

  // update() on a missing document fails; set() creates it
  await assert.rejects(() => c.doc('missing').update({ x: 1 }), /NOT_FOUND/);
  await c.doc('made').set({ companyId: 'c1' }, { merge: true });
  assert.equal((await c.doc('made').get()).exists, true);

  // FieldValue helpers
  await c.doc('f').set({ companyId: 'c1', n: 1, list: ['a'], gone: 1 });
  await c.doc('f').update({ n: FV.increment(4), list: FV.arrayUnion('a', 'b'), gone: FV.delete(), at: FV.serverTimestamp() });
  let f = (await c.doc('f').get()).data()!;
  assert.equal(f.n, 5);
  assert.deepEqual(f.list, ['a', 'b']);
  assert.equal('gone' in f, false);
  assert.ok(f.at instanceof Date);
  await c.doc('f').update({ list: FV.arrayRemove('a') });
  assert.deepEqual((await c.doc('f').get()).data()!.list, ['b']);

  // queries
  for (const [id, d] of Object.entries({
    q1: { companyId: 'c1', status: 'OPEN', n: 1, tags: ['red', 'big'] },
    q2: { companyId: 'c1', status: 'DONE', n: 2, tags: ['blue'] },
    q3: { companyId: 'c2', status: 'OPEN', n: 3, tags: ['red'] },
  })) await db.collection('qs').doc(id).set(d);
  const q = db.collection('qs');
  const ids = async (qq: any) => (await qq.get()).docs.map((d: any) => d.id).sort();
  assert.deepEqual(await ids(q.where('companyId', '==', 'c1')), ['q1', 'q2']);
  assert.deepEqual(await ids(q.where('companyId', '==', 'c1').where('status', '==', 'OPEN')), ['q1']);
  assert.deepEqual(await ids(q.where('status', 'in', ['DONE', 'OPEN'])), ['q1', 'q2', 'q3']);
  assert.deepEqual(await ids(q.where('n', '<=', 2)), ['q1', 'q2']);
  assert.deepEqual(await ids(q.where('status', '!=', 'OPEN')), ['q2']);
  assert.deepEqual(await ids(q.where('tags', 'array-contains', 'red')), ['q1', 'q3']);
  assert.deepEqual(await ids(q.where('n', '>', 1).where('n', '<', 3)), ['q2']);
  assert.equal((await q.limit(2).get()).size, 2);
  assert.equal((await q.where('companyId', '==', 'zzz').get()).empty, true);
  const slim = await q.where('companyId', '==', 'c1').select('status').get();
  assert.deepEqual(slim.docs.map((d: any) => d.data()).sort((x: any, y: any) => x.status.localeCompare(y.status)), [{ status: 'DONE' }, { status: 'OPEN' }]);
  const snap = (await q.where('status', '==', 'DONE').get()).docs[0];
  await snap.ref.delete();
  assert.equal((await q.doc('q2').get()).exists, false);

  // auto ids are 20 chars and unique
  const x = c.doc().id, y = c.doc().id;
  assert.equal(x.length, 20);
  assert.notEqual(x, y);

  // batch applies everything
  const b = db.batch();
  b.set(c.doc('b1'), { companyId: 'c1', v: 1 });
  b.set(c.doc('b2'), { companyId: 'c1', v: 2 });
  b.update(c.doc('b1'), { v: 10 });
  b.delete(c.doc('b2'));
  await b.commit();
  assert.equal((await c.doc('b1').get()).data()!.v, 10);
  assert.equal((await c.doc('b2').get()).exists, false);

  // transactions: read-modify-write, and two at once never both win
  await c.doc('seat').set({ companyId: 'c1', taken: false, by: '' });
  const take = (who: string) =>
    db.runTransaction(async (tx: any) => {
      const s = await tx.get(c.doc('seat'));
      if (s.data().taken) return 'refused';
      tx.update(c.doc('seat'), { taken: true, by: who });
      return 'ok';
    });
  const results = await Promise.all([take('p1'), take('p2'), take('p3')]);
  assert.deepEqual(results.filter((r) => r === 'ok').length, 1, 'only one wins the seat');
  assert.equal(results.filter((r) => r === 'refused').length, 2);

  await c.doc('ctr').set({ companyId: 'c1', n: 0 });
  await Promise.all(Array.from({ length: 8 }, () => db.runTransaction(async (tx: any) => {
    const s = await tx.get(c.doc('ctr'));
    tx.update(c.doc('ctr'), { n: s.data().n + 1 });
  })));
  assert.equal((await c.doc('ctr').get()).data()!.n, 8, 'no lost updates');

  assert.ok((await db.listCollections()).some((x: any) => x.id === 'qs'));
  console.log('mongo adapter tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
