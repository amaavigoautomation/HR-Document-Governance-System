// Copies all top-level Firestore collections from a source DB to a destination DB.
// Usage:
//   SRC_PROJECT=gen-lang-client-0203665344 \
//   SRC_DB=ai-studio-hrdocumentgovern-f71a32a8-1c50-4d39-bfab-6a034be035cc \
//   DST_PROJECT=<new-project-id> \
//   DST_DB="(default)" \
//   node copy-firestore.mjs            # add DRY_RUN=1 to only count
//
// Optional service-account key files (otherwise uses gcloud Application Default Credentials):
//   SRC_KEY=./old-key.json DST_KEY=./new-key.json

import { readFileSync } from 'node:fs';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const {
  SRC_PROJECT, SRC_DB = '(default)',
  DST_PROJECT, DST_DB = '(default)',
  SRC_KEY, DST_KEY, DRY_RUN,
} = process.env;

if (!SRC_PROJECT || !DST_PROJECT) {
  console.error('Set SRC_PROJECT and DST_PROJECT (and SRC_DB / DST_DB if not "(default)").');
  process.exit(1);
}

const credential = (keyPath) =>
  keyPath ? cert(JSON.parse(readFileSync(keyPath, 'utf8'))) : applicationDefault();

const srcApp = initializeApp({ projectId: SRC_PROJECT, credential: credential(SRC_KEY) }, 'src');
const dstApp = initializeApp({ projectId: DST_PROJECT, credential: credential(DST_KEY) }, 'dst');

const src = getFirestore(srcApp, SRC_DB);
const dst = getFirestore(dstApp, DST_DB);

const collections = await src.listCollections();
console.log(`Found ${collections.length} collections: ${collections.map((c) => c.id).join(', ')}`);

const writer = dst.bulkWriter();
writer.onWriteError((err) => {
  console.error(`Write failed for ${err.documentRef.path}: ${err.message}`);
  return err.failedAttempts < 3; // retry up to 3 times
});

let total = 0;
for (const col of collections) {
  const snap = await col.get();
  console.log(`${col.id}: ${snap.size} documents`);
  for (const doc of snap.docs) {
    total++;
    if (!DRY_RUN) writer.set(dst.collection(col.id).doc(doc.id), doc.data());
  }
}

if (DRY_RUN) {
  console.log(`DRY RUN: would copy ${total} documents.`);
} else {
  await writer.close();
  console.log(`Done. Copied ${total} documents.`);
}