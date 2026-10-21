/**
 * One-off migration: turns the existing single-company data into the first tenant.
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON='...' \
 *   npx tsx scripts/migrate-to-multitenant.ts --company "Amaavigo Group" --admin hr@yourco.com [--dry-run]
 *
 * What it does
 *   1. Creates an ACTIVE company (all modules) and seeds the default roles.
 *   2. Creates a department for each distinct departmentName.
 *   3. For every employee: creates a login (uid = the old employee id, so links between records keep
 *      working), assigns a role from the old portal / hrLevel / isDepartmentHead, strips the old
 *      plain-text password, and sets the sign-in claims.
 *   4. Stamps companyId on documents, versions, acknowledgments, auditLogs, notifications,
 *      documentSuggestions and requisitions.
 *   5. Writes migration-password-links.csv: a password-set link per person (send these, or let people
 *      use "Forgot password"). Keep the file private and delete it afterwards.
 *
 * It prints the company id: set it as HOME_COMPANY_ID. Safe to re-run: existing logins and records are
 * reused. Employees without a valid, unique email are listed and skipped.
 */
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '../api/_lib/firebaseAdmin';
import { prefixFromName, seedDefaultRoles, syncUser } from '../api/_lib/tenantAdmin';
import { ALL_MODULE_KEYS, slugify } from '../shared/permissions';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry-run');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLLECTIONS = ['documents', 'versions', 'acknowledgments', 'auditLogs', 'notifications', 'documentSuggestions', 'requisitions'];

async function main() {
  const name = arg('company');
  const adminEmail = (arg('admin') || '').toLowerCase();
  if (!name || !adminEmail) throw new Error('Usage: --company "<name>" --admin <email of the company admin> [--dry-run]');

  const db = adminDb();
  const auth = adminAuth();
  const ts = new Date().toISOString();
  const companyId = arg('company-id') || `cmp_${slugify(name).replace(/-/g, '') || randomBytes(6).toString('hex')}`;

  const empSnap = await db.collection('employees').get();
  const employees = empSnap.docs.map((d) => ({ ref: d.ref, id: d.id, ...(d.data() as any) }));
  console.log(`Found ${employees.length} employees.`);
  if (!employees.some((e) => String(e.email || '').toLowerCase() === adminEmail)) {
    throw new Error(`No employee has the admin email ${adminEmail}.`);
  }
  if (DRY) {
    console.log(`[dry run] would create company ${companyId} and migrate ${employees.length} employees.`);
    return;
  }

  const prefix = prefixFromName(name);
  await db.collection('companies').doc(companyId).set(
    {
      id: companyId, name, slug: slugify(name), status: 'ACTIVE', modules: ALL_MODULE_KEYS, plan: 'migrated',
      adminEmail, employeeIdPrefix: prefix, nextEmployeeNumber: employees.length + 1000,
      createdAt: ts, updatedAt: ts, approvedAt: ts, approvedBy: 'migration',
    },
    { merge: true }
  );
  const roles = await seedDefaultRoles(companyId);

  const deptIds = new Map<string, string>();
  for (const dn of new Set(employees.map((e) => String(e.departmentName || '').trim()).filter(Boolean))) {
    const id = `dep_${companyId}_${slugify(dn)}`;
    deptIds.set(dn, id);
    await db.collection('departments').doc(id).set({ id, companyId, name: dn, createdAt: ts, updatedAt: ts }, { merge: true });
  }

  const links: string[] = ['name,email,empId,link'];
  const skipped: string[] = [];
  const seenEmails = new Set<string>();

  for (const e of employees) {
    const email = String(e.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seenEmails.has(email)) {
      skipped.push(`${e.name || e.id} (${email || 'no email'})`);
      continue;
    }
    seenEmails.add(email);

    let slug = 'employee';
    if (email === adminEmail) slug = 'company-admin';
    else if (e.role === 'CREATOR') slug = e.hrLevel === 'HEAD' ? 'hr-head' : 'hr';
    else if (e.role === 'REVIEWER') slug = 'approver';
    else if (e.isDepartmentHead) slug = 'department-head';
    const role = roles[slug];

    let uid = e.id;
    try {
      uid = (await auth.getUserByEmail(email)).uid;
    } catch {
      await auth.createUser({ uid: e.id, email, displayName: e.name, password: randomBytes(18).toString('base64url'), emailVerified: true });
    }

    await e.ref.set(
      {
        authUid: uid, companyId, companyName: name,
        departmentId: deptIds.get(String(e.departmentName || '').trim()) || '',
        roleIds: [role.id], roleNames: [role.name],
        active: e.active !== false, updatedAt: ts,
        password: FieldValue.delete(), hrLevel: FieldValue.delete(),
      },
      { merge: true }
    );
    await syncUser(uid);
    try {
      links.push([e.name, email, e.empId || '', await auth.generatePasswordResetLink(email)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    } catch {
      /* link generation is best effort */
    }
  }

  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).get();
    let batch = db.batch();
    let n = 0;
    for (const d of snap.docs) {
      if (d.data().companyId) continue;
      batch.update(d.ref, { companyId });
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    console.log(`  ${col}: stamped ${n} of ${snap.size}`);
  }

  writeFileSync('migration-password-links.csv', links.join('\n'));
  console.log(`\nDone. Company id: ${companyId}\nSet HOME_COMPANY_ID=${companyId}`);
  if (skipped.length) console.log(`\nSkipped (fix the email, then re-run):\n  ${skipped.join('\n  ')}`);
  console.log('\nPassword-set links saved to migration-password-links.csv (keep private, delete after use).');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
