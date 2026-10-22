/**
 * Tags onboarding records created before multi-company support with a companyId.
 *
 *   npx tsx scripts/backfill-onboarding-company.ts --company <companyId> [--dry-run]
 *
 * Touches onboardings, candidateStatuses, onboardingFiles and candidateEvaluations that have no companyId.
 * (The server already treats untagged records as the home company's, so this is optional tidying.)
 */
import { adminDb } from '../api/_lib/firebaseAdmin';

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--company');
  const companyId = i >= 0 ? args[i + 1] : '';
  const dry = args.includes('--dry-run');
  if (!companyId) throw new Error('Usage: backfill-onboarding-company.ts --company <companyId> [--dry-run]');
  const db = adminDb();
  if (!(await db.collection('companies').doc(companyId).get()).exists) throw new Error(`Company ${companyId} not found.`);

  for (const name of ['onboardings', 'candidateStatuses', 'onboardingFiles', 'candidateEvaluations']) {
    const snap = await db.collection(name).get();
    const todo = snap.docs.filter((d) => !d.get('companyId'));
    console.log(`${name}: ${todo.length} of ${snap.size} need a companyId`);
    if (dry) continue;
    for (let n = 0; n < todo.length; n += 400) {
      const batch = db.batch();
      todo.slice(n, n + 400).forEach((d) => batch.set(d.ref, { companyId }, { merge: true }));
      await batch.commit();
    }
  }
  console.log(dry ? 'Dry run only, nothing written.' : 'Done.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
