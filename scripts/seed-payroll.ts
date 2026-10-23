/**
 * TEST ONLY. Gives a test company working payroll in one step: the payroll template (if payroll is not set up yet)
 * and a made-up salary for every active employee who does not have one.
 *
 * Usage (repo root, .env must contain FIREBASE_SERVICE_ACCOUNT_JSON):
 *   npx tsx --env-file=.env scripts/seed-payroll.ts <companyId>             dry run, changes nothing
 *   npx tsx --env-file=.env scripts/seed-payroll.ts <companyId> --apply     writes the data
 *   add --overwrite to replace salaries that already exist
 *
 * <companyId> is the document ID of the company in the Firestore "companies" collection (starts with "cmp").
 * Never run this against a real company: the salaries and bank numbers are invented.
 */
import { adminDb } from '../api/_lib/firebaseAdmin.js';
import { splitCtc, starterPayrollSettings } from '../shared/payrollEngine.js';

// Annual CTC by the part of the email before the @. Anyone else gets DEFAULT_CTC.
const CTC_BY_NAME: Record<string, number> = {
  sahil1: 1_200_000, hr1: 900_000, hr2: 540_000, hr3: 240_000, sales1: 720_000, sales2: 300_000, it1: 840_000, it2: 420_000,
};
const DEFAULT_CTC = 360_000;

async function main() {
  const companyId = process.argv[2];
  const apply = process.argv.includes('--apply');
  const overwrite = process.argv.includes('--overwrite');
  if (!companyId || companyId.startsWith('--')) {
    console.error('Usage: seed-payroll.ts <companyId> [--apply] [--overwrite]');
    process.exit(1);
  }
  const db = adminDb();
  const company = await db.collection('companies').doc(companyId).get();
  if (!company.exists) {
    console.error(`No company with id "${companyId}".`);
    process.exit(1);
  }
  console.log(`Company: ${company.get('name')} (${companyId})  mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

  // 1) payroll setup
  const settingsRef = db.collection('payrollSettings').doc(companyId);
  let settings = starterPayrollSettings();
  const existing = await settingsRef.get();
  if (existing.exists && (existing.get('components') || []).length > 0) {
    settings = existing.data() as any;
    console.log('Payroll is already set up: keeping it.');
  } else {
    settings.company.legalName = String(company.get('name') || '');
    console.log('Payroll is not set up: will apply the starter template.');
    if (apply) await settingsRef.set(JSON.parse(JSON.stringify({ ...settings, companyId, updatedAt: new Date().toISOString() })));
  }

  // 2) salaries
  const people = await db.collection('employees').where('companyId', '==', companyId).get();
  let n = 0;
  for (const doc of people.docs) {
    if (doc.get('active') === false) continue;
    const uid: string = doc.get('authUid') || doc.id;
    const email = String(doc.get('email') || '').toLowerCase();
    const ref = db.collection('payrollStructures').doc(`${companyId}__${uid}`);
    if (!overwrite && (await ref.get()).exists) {
      console.log(`  skip ${email}: already has a salary`);
      continue;
    }
    const ctc = CTC_BY_NAME[email.split('@')[0]] ?? DEFAULT_CTC;
    const split = splitCtc(ctc, settings.ctcTemplate, settings.components);
    n++;
    const monthly = Object.values(split.amounts).reduce((a, b) => a + b, 0);
    console.log(`  ${email}  CTC ${ctc}  monthly ${monthly}${split.warnings.length ? '  WARN ' + split.warnings[0] : ''}`);
    if (apply) {
      await ref.set({
        companyId, uid, amounts: split.amounts, annualCtc: ctc, state: 'Maharashtra', gender: '', pfApplicable: true, esicApplicable: true, pfOnActualWage: false,
        pan: '', uan: '', esicNo: '', bankName: 'Test Bank', bankAccount: `99900${String(n).padStart(7, '0')}`, ifsc: 'TEST0000001',
        updatedAt: new Date().toISOString(), updatedBy: 'seed script', history: [],
      });
    }
  }
  console.log(`\n${apply ? 'Wrote' : 'Would write'} ${n} salar${n === 1 ? 'y' : 'ies'}.`);
  if (!apply) console.log('Re-run with --apply to make the change.');
}

main().catch((e) => { console.error(e); process.exit(1); });
