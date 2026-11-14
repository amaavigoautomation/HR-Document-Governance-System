/**
 * Copies every Firestore collection into MongoDB (same collection names, same document ids, same fields).
 *
 *   npx tsx --env-file=.env scripts/migrate-firestore-to-mongo.ts [--dry-run] [--only a,b,c]
 *
 * Needs FIREBASE_SERVICE_ACCOUNT_JSON (to read Firestore) and MONGODB_URI (to write). It only ever inserts or
 * overwrites documents that exist in Firestore; it never deletes anything from either database, so it is safe to
 * run again (it simply refreshes the copy). Run it once while the app is quiet, then switch the app to Mongo
 * by keeping MONGODB_URI set. Firebase Authentication is not touched: users keep their logins.
 */
import { MongoClient } from 'mongodb';
import { getFirestore } from 'firebase-admin/firestore';
import { adminApp, resolveDatabaseId } from '../api/_lib/firebaseAdmin';

/** Firestore Timestamps become Dates; GeoPoints and references become plain values. Everything else is copied as it is. */
function plain(v: any): any {
  if (v === null || v === undefined) return v;
  if (typeof v.toDate === 'function' && typeof v.seconds === 'number') return v.toDate();
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 3) return { latitude: v.latitude, longitude: v.longitude };
  if (typeof v.path === 'string' && typeof v.id === 'string' && typeof v.get === 'function') return v.path;
  if (Array.isArray(v)) return v.map(plain);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array || v instanceof Date) return v;
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const onlyArg = args.indexOf('--only');
  const only = onlyArg >= 0 ? new Set(args[onlyArg + 1].split(',').map((s) => s.trim()).filter(Boolean)) : null;

  const uri = (process.env.MONGODB_URI || '').trim();
  if (!uri) throw new Error('MONGODB_URI is not set.');
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  const dbName = (process.env.MONGODB_DB || '').trim() || (m && m[1] ? decodeURIComponent(m[1]) : 'hr_governance');

  const dbId = resolveDatabaseId();
  const fs = dbId && dbId !== '(default)' ? getFirestore(adminApp(), dbId) : getFirestore(adminApp());
  const mongo = await new MongoClient(uri).connect();
  const target = mongo.db(dbName);

  console.log(`${dry ? '[dry run] ' : ''}Firestore (${dbId || '(default)'}) -> MongoDB "${dbName}"`);
  let total = 0;
  let mismatches = 0;
  try {
    const cols = (await fs.listCollections()).map((c) => c.id).filter((id) => !only || only.has(id)).sort();
    for (const name of cols) {
      let copied = 0;
      let last: string | undefined;
      for (;;) {
        let q = fs.collection(name).orderBy('__name__').limit(400);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;
        if (!dry) {
          await target.collection(name).bulkWrite(
            snap.docs.map((d) => ({
              replaceOne: { filter: { _id: d.id as any }, replacement: plain(d.data()), upsert: true },
            })),
            { ordered: false }
          );
        }
        copied += snap.size;
        last = snap.docs[snap.docs.length - 1].id;
      }
      let note = '';
      if (!dry) {
        const there = await target.collection(name).countDocuments();
        const here = (await fs.collection(name).count().get()).data().count;
        if (there < here) {
          mismatches++;
          note = `  <-- MongoDB has ${there}, Firestore has ${here}`;
        }
        await target.collection(name).createIndex({ companyId: 1 }, { name: 'companyId_1' });
      }
      total += copied;
      console.log(`  ${name.padEnd(32)} ${String(copied).padStart(7)} documents${note}`);
    }
  } finally {
    await mongo.close();
  }
  console.log(`${dry ? 'Would copy' : 'Copied'} ${total} documents.${mismatches ? ` ${mismatches} collection(s) look short: check the lines marked above.` : ''}`);
  if (mismatches) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
