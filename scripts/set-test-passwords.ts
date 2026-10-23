/**
 * TEST ONLY. Sets every employee's login password in ONE company to be the same as their email.
 *
 * Usage (from the repo root, with .env containing FIREBASE_SERVICE_ACCOUNT_JSON):
 *   npx tsx --env-file=.env scripts/set-test-passwords.ts <companyId>            # dry run, changes nothing
 *   npx tsx --env-file=.env scripts/set-test-passwords.ts <companyId> --apply    # actually sets passwords
 *
 * Find <companyId> in Firestore: companies collection, the document ID of your fake company (starts with "cmp").
 * Never run this against a real company: password = email is trivially guessable.
 */
import { adminAuth, adminDb } from '../api/_lib/firebaseAdmin.js';

async function main() {
  const companyId = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!companyId || companyId.startsWith('--')) {
    console.error('Usage: set-test-passwords.ts <companyId> [--apply]');
    process.exit(1);
  }

  const company = await adminDb().collection('companies').doc(companyId).get();
  if (!company.exists) {
    console.error(`No company with id "${companyId}".`);
    process.exit(1);
  }
  console.log(`Company: ${company.get('name')} (${companyId})  mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

  const snap = await adminDb().collection('employees').where('companyId', '==', companyId).get();
  let ok = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const uid: string = doc.get('authUid') || doc.id;
    const email: string = String(doc.get('email') || '').trim().toLowerCase();
    if (!email || email.length < 6) {
      console.log(`  skip ${uid}: email missing or shorter than 6 characters (Firebase minimum password length)`);
      skipped++;
      continue;
    }
    console.log(`  ${email}  ->  password = ${email}`);
    if (apply) {
      await adminAuth().updateUser(uid, { password: email, emailVerified: true });
    }
    ok++;
  }
  console.log(`\n${apply ? 'Updated' : 'Would update'} ${ok} user(s), skipped ${skipped}.`);
  if (!apply) console.log('Re-run with --apply to make the change.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});