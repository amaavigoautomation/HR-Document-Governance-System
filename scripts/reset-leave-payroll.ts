/**
 * DESTRUCTIVE. Deletes the leave and payroll DATA of every employee in one company. Employees, logins, roles,
 * departments and candidates are NOT touched, and neither are other companies.
 *
 * Always deleted (the transactions):
 *   leave:   leaveLedger (balances), leaveRequests, leaveAttendance, leaveRegularizations
 *   payroll: payrollStructures (salaries), payrollAdjustments, payrollLoans, payrollRuns, payrollRunLines (payslips),
 *            payrollRevisions, payrollClaims, payrollClaimFiles (bills), payrollSettlements, payrollDeclarations
 * Only with the extra flags:
 *   --include-profiles   leaveProfiles (join date, reporting manager, location and policy of each person). This also
 *                        empties the org chart and the leave approval routing until HR sets them again.
 *   --include-setup      leaveSettings and payrollSettings (leave types, policies, holidays, payroll components, statutory setup)
 *
 * Usage (repo root, .env must contain FIREBASE_SERVICE_ACCOUNT_JSON):
 *   npx tsx --env-file=.env scripts/reset-leave-payroll.ts <companyId>
 *        dry run: counts what would be deleted, changes nothing
 *   npx tsx --env-file=.env scripts/reset-leave-payroll.ts <companyId> --apply --confirm "<exact company name>"
 *        deletes it. There is no undo: export anything you need first.
 *
 * <companyId> is the document ID in the Firestore "companies" collection (starts with "cmp").
 * After a reset, balances start again from the next accrual run (it runs when someone opens Leave, or by the daily job).
 */
import { adminDb } from '../api/_lib/firebaseAdmin.js';

const TRANSACTIONS = [
  'leaveLedger', 'leaveRequests', 'leaveAttendance', 'leaveRegularizations',
  'payrollStructures', 'payrollAdjustments', 'payrollLoans', 'payrollRuns', 'payrollRunLines',
  'payrollRevisions', 'payrollClaims', 'payrollClaimFiles', 'payrollSettlements', 'payrollDeclarations',
];

async function main() {
  const args = process.argv.slice(2);
  const companyId = args[0];
  const apply = args.includes('--apply');
  const confirmIdx = args.indexOf('--confirm');
  const confirm = confirmIdx >= 0 ? args[confirmIdx + 1] : '';
  if (!companyId || companyId.startsWith('--')) {
    console.error('Usage: reset-leave-payroll.ts <companyId> [--include-profiles] [--include-setup] [--apply --confirm "<company name>"]');
    process.exit(1);
  }
  const db = adminDb();
  const company = await db.collection('companies').doc(companyId).get();
  if (!company.exists) {
    console.error(`No company with id "${companyId}".`);
    process.exit(1);
  }
  const name = String(company.get('name') || '');
  console.log(`Company: ${name} (${companyId})  mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
  if (apply && confirm !== name) {
    console.error(`Refusing to delete: --confirm must be the exact company name, "${name}".`);
    process.exit(1);
  }

  const targets = [...TRANSACTIONS];
  if (args.includes('--include-profiles')) targets.push('leaveProfiles');
  const docRefs: { col: string; ref: FirebaseFirestore.DocumentReference }[] = [];
  for (const col of targets) {
    const snap = await db.collection(col).where('companyId', '==', companyId).get();
    console.log(`  ${col.padEnd(22)} ${snap.size}`);
    snap.docs.forEach((d) => docRefs.push({ col, ref: d.ref }));
  }
  if (args.includes('--include-setup')) {
    for (const col of ['leaveSettings', 'payrollSettings']) {
      const ref = db.collection(col).doc(companyId);
      const exists = (await ref.get()).exists;
      console.log(`  ${col.padEnd(22)} ${exists ? 1 : 0}`);
      if (exists) docRefs.push({ col, ref });
    }
  }
  console.log(`Total documents: ${docRefs.length}`);
  if (!apply) {
    console.log('Dry run only. Add --apply --confirm "<company name>" to delete.');
    return;
  }
  for (let i = 0; i < docRefs.length; i += 400) {
    const batch = db.batch();
    docRefs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log(`  deleted ${Math.min(i + 400, docRefs.length)} / ${docRefs.length}`);
  }
  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
