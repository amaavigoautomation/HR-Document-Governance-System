/**
 * Multi-tenant administration API (shared by server.ts and the Vercel handler).
 *
 * Everything that must be trusted lives here and runs with the Admin SDK ("master key"):
 *   - company self-signup (starts PENDING) and platform-admin approval
 *   - creating login accounts, importing users, changing roles / departments
 *   - stamping the company + permission claims onto each user's ID token
 *
 * The browser can read its own company's data directly from Firestore (rules enforce the claims),
 * but it can never write users, roles, departments or companies - only this file can.
 */
import { randomBytes } from 'node:crypto';
import { FieldValue, type DocumentReference, type Firestore, type Query } from 'firebase-admin/firestore';
import { adminApp, adminAuth, adminDb, isAdminConfigured } from './firebaseAdmin.js';
import { authenticate, requirePermission, requirePlatformAdmin, authErrorResponse, AuthError, type AuthContext } from './authContext.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { syncDepartmentManagers, syncDepartmentManagersQuietly } from './deptManager.js';
import {
  ALL_MODULE_KEYS,
  DEFAULT_ROLE_TEMPLATES,
  canGrantPermissions,
  claimsFitLimit,
  effectivePermissions,
  isKnownPermission,
  RETIRED_PERMISSIONS,
  portalForRoles,
  slugify,
  type Portal,
  type RoleDef,
  type TenantClaims,
} from '../../shared/permissions.js';

export interface TenantRequest {
  method: string;
  action: string;
  body: any;
  headers: Record<string, any>;
  origin?: string;
}

export interface TenantResult {
  status: number;
  json: any;
}

const ok = (json: any = {}): TenantResult => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): TenantResult => ({ status, json: { success: false, error } });

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('hex')}`;
const db = (): Firestore => adminDb();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v: unknown, max = 200) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));

// ------------------------------------------------------------------ types

interface CompanyDoc {
  id: string;
  name: string;
  slug: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  modules: string[];
  plan: string;
  adminEmail: string;
  employeeIdPrefix: string;
  nextEmployeeNumber: number;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

interface EmployeeDoc {
  id: string;
  authUid: string;
  companyId: string;
  companyName: string;
  empId: string;
  loginId: string;
  name: string;
  email: string;
  title: string;
  departmentId: string;
  departmentName: string;
  roleIds: string[];
  roleNames: string[];
  role: Portal;
  perms: string[];
  authorizedModules: string;
  isDepartmentHead?: boolean;
  /** Earlier sign-in emails, newest last (at most 10), so an old address can still be traced to the person. */
  emailHistory?: { email: string; changedAt: string; changedBy: string }[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ helpers

export function prefixFromName(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, '')[0] || '')
    .join('')
    .toUpperCase();
  return (letters.length >= 2 ? letters : name.replace(/[^A-Za-z]/g, '').toUpperCase()).slice(0, 4) || 'EMP';
}

async function loadCompany(companyId: string): Promise<CompanyDoc> {
  const snap = await db().collection('companies').doc(companyId).get();
  if (!snap.exists) throw new AuthError(404, 'Company not found.');
  return snap.data() as CompanyDoc;
}

async function loadRoles(companyId: string): Promise<RoleDef[]> {
  const snap = await db().collection('roles').where('companyId', '==', companyId).get();
  return snap.docs.map((d) => d.data() as RoleDef);
}

export async function seedDefaultRoles(companyId: string): Promise<Record<string, RoleDef>> {
  const batch = db().batch();
  const bySlug: Record<string, RoleDef> = {};
  const ts = nowIso();
  for (const t of DEFAULT_ROLE_TEMPLATES) {
    const role: RoleDef = {
      id: `${companyId}_${t.slug}`,
      companyId,
      name: t.name,
      description: t.description,
      permissions: t.permissions,
      portal: t.portal,
      isAdmin: t.isAdmin === true,
      isDefault: true,
      createdAt: ts,
      updatedAt: ts,
    };
    bySlug[t.slug] = role;
    batch.set(db().collection('roles').doc(role.id), role);
  }
  await batch.commit();
  return bySlug;
}

async function findEmployeeRef(uid: string): Promise<DocumentReference | null> {
  const direct = db().collection('employees').doc(uid);
  if ((await direct.get()).exists) return direct;
  const q = await db().collection('employees').where('authUid', '==', uid).limit(1).get();
  return q.empty ? null : q.docs[0].ref;
}

/**
 * Recomputes everything derived from a user's roles (permissions, portal, modules) from the source of
 * truth, writes it back to their employee doc and stamps it onto their ID token claims.
 */
export async function syncUser(uid: string, preloaded?: { company?: CompanyDoc; roles?: RoleDef[] }): Promise<void> {
  const ref = await findEmployeeRef(uid);
  if (!ref) return;
  const emp = (await ref.get()).data() as EmployeeDoc;
  const company = preloaded?.company || (await loadCompany(emp.companyId));
  const allRoles = preloaded?.roles || (await loadRoles(emp.companyId));
  const mine = allRoles.filter((r) => emp.roleIds.includes(r.id));
  const modules = company.status === 'ACTIVE' ? company.modules : [];
  const perms = effectivePermissions(mine, company.status === 'ACTIVE' ? company.modules : ALL_MODULE_KEYS);
  const isAdmin = mine.some((r) => r.isAdmin);

  const claims: TenantClaims = {
    cid: company.id,
    cs: company.status,
    perms: emp.active && company.status === 'ACTIVE' ? perms : [],
    adm: emp.active && company.status === 'ACTIVE' && isAdmin,
  };
  if (!claimsFitLimit(claims)) throw new Error('Too many permissions to fit in the sign-in token. Remove some from the role.');

  const auth = adminAuth();
  const existing = await auth.getUser(uid);
  const keepPlatformAdmin = (existing.customClaims as TenantClaims | undefined)?.pa === true;
  await auth.setCustomUserClaims(uid, keepPlatformAdmin ? { ...claims, pa: true } : claims);
  if (existing.disabled === emp.active) await auth.updateUser(uid, { disabled: !emp.active });

  await ref.update({
    companyName: company.name,
    roleNames: mine.map((r) => r.name),
    role: portalForRoles(mine),
    perms,
    authorizedModules: modules.length === ALL_MODULE_KEYS.length ? 'ALL' : modules.join(',') || 'ALL',
    updatedAt: nowIso(),
  });
}

async function syncCompanyUsers(companyId: string): Promise<number> {
  const [company, roles] = await Promise.all([loadCompany(companyId), loadRoles(companyId)]);
  const snap = await db().collection('employees').where('companyId', '==', companyId).get();
  let n = 0;
  for (const d of snap.docs) {
    const uid = (d.data() as EmployeeDoc).authUid;
    if (!uid) continue;
    await syncUser(uid, { company, roles });
    n++;
  }
  return n;
}

async function nextEmployeeId(companyId: string): Promise<string> {
  const ref = db().collection('companies').doc(companyId);
  return db().runTransaction(async (tx) => {
    const c = (await tx.get(ref)).data() as CompanyDoc;
    const n = c.nextEmployeeNumber || 1;
    tx.update(ref, { nextEmployeeNumber: n + 1 });
    return `${c.employeeIdPrefix}${String(n).padStart(3, '0')}`;
  });
}

async function activeAdminCount(companyId: string, adminRoleIds: string[], excludeUid?: string): Promise<number> {
  if (!adminRoleIds.length) return 0;
  const snap = await db().collection('employees').where('companyId', '==', companyId).get();
  return snap.docs.filter((d) => {
    const e = d.data() as EmployeeDoc;
    return e.active !== false && e.authUid !== excludeUid && e.roleIds?.some((r) => adminRoleIds.includes(r));
  }).length;
}

async function sendInvite(email: string, name: string, companyName: string, origin?: string): Promise<{ link: string; emailed: boolean }> {
  // The "continue" address must be on Firebase's authorized-domains list; if it is not, fall back to the plain link
  // so the person still gets an email instead of the invite failing silently.
  let link: string;
  try {
    link = await adminAuth().generatePasswordResetLink(email, origin ? { url: origin } : undefined);
  } catch (e) {
    if (!origin) throw e;
    link = await adminAuth().generatePasswordResetLink(email);
  }
  const result = await dispatchLiveEmail({
    to: email,
    recipientName: name,
    subject: `You have been invited to ${companyName}`,
    body:
      `Dear ${name},\n\n${companyName} has set up an account for you on the HR portal.\n\n` +
      `Set your password and sign in using this link:\n${link}\n\n` +
      `If you were not expecting this, you can ignore this email.`,
  }).catch(() => ({ success: false }) as any);
  return { link, emailed: !!result?.success };
}

/** Roles the actor is allowed to hand out. Only company admins can grant the admin role. */
function assertCanAssign(actor: AuthContext, roles: RoleDef[], roleIds: string[]): void {
  for (const id of roleIds) {
    const role = roles.find((r) => r.id === id);
    if (!role) throw new AuthError(400, 'One of the selected roles does not exist.');
    if (role.isAdmin && !actor.isCompanyAdmin) throw new AuthError(403, 'Only a Company Admin can assign the Company Admin role.');
    if (!canGrantPermissions(actor.perms, actor.isCompanyAdmin, role.permissions)) {
      throw new AuthError(403, `You cannot assign "${role.name}" because it grants permissions you do not have.`);
    }
  }
}

// ------------------------------------------------------------------ actions

async function signup(body: any, origin?: string): Promise<TenantResult> {
  const companyName = str(body.companyName, 120);
  const adminName = str(body.adminName, 120);
  const email = str(body.email, 200).toLowerCase();
  const password = String(body.password || '');

  if (companyName.length < 2) return fail(400, 'Company name is required.');
  if (adminName.length < 2) return fail(400, 'Your name is required.');
  if (!EMAIL_RE.test(email)) return fail(400, 'A valid work email is required.');
  if (password.length < 8) return fail(400, 'Password must be at least 8 characters.');

  const auth = adminAuth();
  try {
    await auth.getUserByEmail(email);
    return fail(409, 'An account with this email already exists. Try signing in instead.');
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') throw e;
  }

  const companyId = newId('cmp');
  const ts = nowIso();
  const company: CompanyDoc = {
    id: companyId,
    name: companyName,
    slug: slugify(companyName) || companyId,
    status: 'PENDING',
    modules: [],
    plan: 'trial',
    adminEmail: email,
    employeeIdPrefix: prefixFromName(companyName),
    nextEmployeeNumber: 2,
    createdAt: ts,
    updatedAt: ts,
  };

  const user = await auth.createUser({ email, password, displayName: adminName, emailVerified: false });
  try {
    await db().collection('companies').doc(companyId).set(company);
    const roles = await seedDefaultRoles(companyId);
    const deptId = newId('dep');
    await db().collection('departments').doc(deptId).set({
      id: deptId, companyId, name: 'Management', headUserId: user.uid, createdAt: ts, updatedAt: ts,
    });
    const adminRole = roles['company-admin'];
    const employee: EmployeeDoc = {
      id: user.uid,
      authUid: user.uid,
      companyId,
      companyName,
      empId: `${company.employeeIdPrefix}001`,
      loginId: email,
      name: adminName,
      email,
      title: 'Company Administrator',
      departmentId: deptId,
      departmentName: 'Management',
      roleIds: [adminRole.id],
      roleNames: [adminRole.name],
      role: 'CREATOR',
      perms: [],
      authorizedModules: 'ALL',
      active: true,
      createdAt: ts,
      updatedAt: ts,
    };
    await db().collection('employees').doc(user.uid).set(employee);
    await syncUser(user.uid);
  } catch (err) {
    // Roll back so a failed signup never leaves half a company behind.
    await auth.deleteUser(user.uid).catch(() => {});
    await db().collection('companies').doc(companyId).delete().catch(() => {});
    throw err;
  }
  return ok({ companyId, status: 'PENDING', message: 'Registration received. We will review it and activate your account.' });
}

async function listCompanies(headers: Record<string, any>): Promise<TenantResult> {
  await requirePlatformAdmin(headers);
  const snap = await db().collection('companies').get();
  const companies = snap.docs.map((d) => d.data()).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ companies });
}

async function setCompanyStatus(headers: Record<string, any>, body: any, status: CompanyDoc['status']): Promise<TenantResult> {
  const actor = await requirePlatformAdmin(headers);
  const companyId = str(body.companyId, 128);
  const company = await loadCompany(companyId);
  const update: Partial<CompanyDoc> = { status, updatedAt: nowIso() };

  if (status === 'ACTIVE') {
    const requested: string[] = Array.isArray(body.modules) ? body.modules.map(String) : company.modules.length ? company.modules : ALL_MODULE_KEYS;
    update.modules = requested.filter((m) => (ALL_MODULE_KEYS as string[]).includes(m));
    if (!update.modules.length) return fail(400, 'Enable at least one module for this company.');
    update.approvedAt = nowIso();
    update.approvedBy = actor.email;
    if (body.plan) update.plan = str(body.plan, 40);
  }
  await db().collection('companies').doc(companyId).update(update);
  const updated = await syncCompanyUsers(companyId);
  return ok({ companyId, status, usersUpdated: updated });
}

// ------------------------------------------------------------------ delete a whole company

/** Collections that are never swept by company id: the company record is removed last, employees have their own phase. */
const PURGE_SKIP = new Set(['companies', 'employees', 'platformAudit']);
/** Stay under the serverless time limit; the screen calls again until the server says it is done. */
const purgeBudgetMs = () => Number(process.env.TENANT_PURGE_BUDGET_MS) || 7000;

async function drainQuery(q: Query, deadline: number): Promise<{ deleted: number; more: boolean }> {
  let deleted = 0;
  for (;;) {
    const snap = await q.limit(400).get();
    if (snap.empty) return { deleted, more: false };
    const batch = db().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
    if (Date.now() > deadline) return { deleted, more: true };
  }
}

/**
 * Permanently deletes a company: its login accounts, its employees and every record that carries its company id
 * in every collection (leave, payroll, hiring, documents, files...), then the company itself.
 * It is resumable: the first call suspends the company (so nobody can use it while it is wiped), each call works for
 * about seven seconds, and the screen calls again while `done` is false. A repeat call after a failure carries on.
 */
async function deleteCompany(headers: Record<string, any>, body: any): Promise<TenantResult> {
  const actor = await requirePlatformAdmin(headers);
  const companyId = str(body.companyId, 128);
  const company = await loadCompany(companyId);

  if ((process.env.HOME_COMPANY_ID || '').trim() === companyId) {
    return fail(400, 'This is the home company (HOME_COMPANY_ID). Unset that setting before deleting it, because older records without a company id belong to it.');
  }
  if (actor.companyId === companyId) return fail(400, 'You cannot delete the company your own account belongs to.');
  const own = await db().collection('employees').where('companyId', '==', companyId).where('authUid', '==', actor.uid).limit(1).get();
  if (!own.empty) return fail(400, 'You cannot delete the company your own account belongs to.');
  if (str(body.confirmName, 200) !== company.name) return fail(400, 'Type the company name exactly to confirm the deletion.');

  const deadline = Date.now() + purgeBudgetMs();
  const progress = ((company as any).deleteProgress || {}) as { employeesDone?: boolean; purged?: string[]; counts?: Record<string, number> };
  const purged = new Set<string>(progress.purged || []);
  const counts: Record<string, number> = { ...(progress.counts || {}) };
  const add = (k: string, n: number) => { if (n) counts[k] = (counts[k] || 0) + n; };

  // 1. Lock the company first so nobody can sign in or write while it is being wiped.
  if (company.status !== 'SUSPENDED') {
    await db().collection('companies').doc(companyId).update({ status: 'SUSPENDED', updatedAt: nowIso(), deleting: true, deleteRequestedBy: actor.email, deleteRequestedAt: nowIso() });
    await syncCompanyUsers(companyId);
  }

  const save = async () => {
    await db().collection('companies').doc(companyId).update({ deleteProgress: { employeesDone: !!progress.employeesDone, purged: [...purged], counts } }).catch(() => {});
  };
  const finish = async (done: boolean) => {
    await save();
    return ok({ companyId, done, deleted: counts });
  };

  // 2. Login accounts and employee records.
  if (!progress.employeesDone) {
    for (;;) {
      const snap = await db().collection('employees').where('companyId', '==', companyId).limit(200).get();
      if (snap.empty) { progress.employeesDone = true; break; }
      const uids = snap.docs.map((d) => String((d.data() as EmployeeDoc).authUid || d.id)).filter(Boolean);
      // Never delete a platform administrator's login, even if they also have an employee record here.
      const protectedUids = new Set<string>();
      for (let i = 0; i < uids.length; i += 100) {
        const found = await adminAuth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
        found.users.forEach((u) => { if ((u.customClaims as TenantClaims | undefined)?.pa === true) protectedUids.add(u.uid); });
      }
      const res = await adminAuth().deleteUsers(uids.filter((u) => !protectedUids.has(u)));
      if (res.failureCount) console.warn('[tenant] deleteCompany: some login accounts were already gone or could not be deleted', res.errors.slice(0, 3));
      const batch = db().batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      add('employees', snap.size);
      if (Date.now() > deadline) return finish(false);
    }
  }

  // 3. Every other collection, discovered at run time so new features are covered without changing this code.
  const names = (await db().listCollections()).map((c) => c.id).filter((n) => !PURGE_SKIP.has(n) && !purged.has(n));
  let timedOut = false;
  for (let i = 0; i < names.length && !timedOut; i += 8) {
    const group = names.slice(i, i + 8);
    await Promise.all(group.map(async (name) => {
      const col = db().collection(name);
      const r = await drainQuery(col.where('companyId', '==', companyId), deadline);
      add(name, r.deleted);
      // Settings-style documents are keyed by the company id itself.
      const keyed = await col.doc(companyId).get();
      if (keyed.exists) {
        const cid = (keyed.data() as any)?.companyId;
        if (cid === undefined || cid === companyId) { await keyed.ref.delete(); add(name, 1); }
      }
      if (r.more) timedOut = true; else purged.add(name);
    }));
    if (Date.now() > deadline) timedOut = true;
  }
  if (timedOut) return finish(false);

  // 4. The company itself, then a record of who deleted what.
  await db().collection('platformAudit').doc(newId('aud')).set({
    action: 'DELETE_COMPANY',
    companyId,
    companyName: company.name,
    adminEmail: company.adminEmail,
    deletedBy: actor.email,
    deletedAt: nowIso(),
    deleted: counts,
  });
  await db().collection('companies').doc(companyId).delete();
  return ok({ companyId, done: true, deleted: counts });
}

async function updateCompanyModules(headers: Record<string, any>, body: any): Promise<TenantResult> {
  await requirePlatformAdmin(headers);
  const companyId = str(body.companyId, 128);
  const modules = (Array.isArray(body.modules) ? body.modules.map(String) : []).filter((m: string) => (ALL_MODULE_KEYS as string[]).includes(m));
  if (!modules.length) return fail(400, 'Enable at least one module.');
  await loadCompany(companyId);
  await db().collection('companies').doc(companyId).update({ modules, updatedAt: nowIso(), ...(body.plan ? { plan: str(body.plan, 40) } : {}) });
  const updated = await syncCompanyUsers(companyId);
  return ok({ companyId, modules, usersUpdated: updated });
}

async function createUser(headers: Record<string, any>, body: any, origin?: string): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'users.manage');
  const companyId = actor.companyId!;
  const row = await createUserInternal(actor, companyId, body, origin);
  return ok(row);
}

async function createUserInternal(actor: AuthContext, companyId: string, body: any, origin?: string, cache?: { company: CompanyDoc; roles: RoleDef[]; depts: Map<string, string> }) {
  const name = str(body.name, 120);
  const email = str(body.email, 200).toLowerCase();
  if (name.length < 2) throw new AuthError(400, 'Name is required.');
  if (!EMAIL_RE.test(email)) throw new AuthError(400, `"${email || 'email'}" is not a valid email.`);

  const company = cache?.company || (await loadCompany(companyId));
  const roles = cache?.roles || (await loadRoles(companyId));
  const roleIds: string[] = Array.isArray(body.roleIds) && body.roleIds.length ? body.roleIds.map(String) : [`${companyId}_employee`];
  assertCanAssign(actor, roles, roleIds);

  let departmentName = '';
  const departmentId = str(body.departmentId, 128);
  if (departmentId) {
    const known = cache?.depts.get(departmentId);
    if (known !== undefined) departmentName = known;
    else {
      const d = await db().collection('departments').doc(departmentId).get();
      if (!d.exists || d.data()?.companyId !== companyId) throw new AuthError(400, 'Selected department does not exist.');
      departmentName = String(d.data()?.name || '');
    }
  }

  try {
    await adminAuth().getUserByEmail(email);
    throw new AuthError(409, `${email} already has an account.`);
  } catch (e: any) {
    if (e instanceof AuthError) throw e;
    if (e?.code !== 'auth/user-not-found') throw e;
  }

  const tempPassword = randomBytes(18).toString('base64url');
  const user = await adminAuth().createUser({ email, password: tempPassword, displayName: name });
  const ts = nowIso();
  const empId = await nextEmployeeId(companyId);
  const employee: EmployeeDoc = {
    id: user.uid,
    authUid: user.uid,
    companyId,
    companyName: company.name,
    empId,
    loginId: email,
    name,
    email,
    title: str(body.title, 120),
    departmentId,
    departmentName,
    roleIds,
    roleNames: [],
    role: 'EMPLOYEE',
    perms: [],
    authorizedModules: 'ALL',
    active: true,
    createdAt: ts,
    updatedAt: ts,
  };
  try {
    await db().collection('employees').doc(user.uid).set(employee);
    await syncUser(user.uid, { company, roles });
  } catch (err) {
    await adminAuth().deleteUser(user.uid).catch(() => {});
    await db().collection('employees').doc(user.uid).delete().catch(() => {});
    throw err;
  }
  // A new person in a department reports to that department's head.
  if (departmentId) await syncDepartmentManagersQuietly(companyId, { uids: [user.uid] });

  let invite: { link: string; emailed: boolean } | null = null;
  let inviteError: string | undefined;
  if (body.sendInvite !== false) {
    invite = await sendInvite(email, name, company.name, origin).catch((e: any) => {
      console.error('[tenant] invite failed for', email, e?.message || e);
      inviteError = e?.message || 'Could not create the invite link.';
      return null;
    });
  }
  return {
    userId: user.uid, empId, emailed: invite?.emailed ?? false,
    inviteLink: invite && !invite.emailed ? invite.link : undefined,
    // Set when no invite went out and there is no link to share either, so the screen can say so instead of claiming success.
    inviteError: !invite && body.sendInvite !== false ? inviteError : undefined,
  };
}

async function importUsers(headers: Record<string, any>, body: any, origin?: string): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'users.manage');
  const companyId = actor.companyId!;
  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return fail(400, 'No rows to import.');
  if (rows.length > 300) return fail(400, 'Import up to 300 users at a time.');

  const [company, roles, deptSnap] = await Promise.all([
    loadCompany(companyId),
    loadRoles(companyId),
    db().collection('departments').where('companyId', '==', companyId).get(),
  ]);
  const deptByName = new Map(deptSnap.docs.map((d) => [String(d.data().name).toLowerCase(), d.data() as { id: string; name: string }]));
  const roleByName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));
  const depts = new Map(deptSnap.docs.map((d) => [d.id, String(d.data().name)]));

  const results: { row: number; email: string; ok: boolean; error?: string; emailed?: boolean; inviteLink?: string; inviteError?: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const email = str(r.email, 200).toLowerCase();
    try {
      // Departments named in the CSV are created on the fly so admins do not have to pre-create them.
      let dept = deptByName.get(str(r.department, 120).toLowerCase());
      if (!dept && str(r.department, 120)) {
        const id = newId('dep');
        const ts = nowIso();
        dept = { id, name: str(r.department, 120) };
        await db().collection('departments').doc(id).set({ id, companyId, name: dept.name, headUserId: '', createdAt: ts, updatedAt: ts });
        deptByName.set(dept.name.toLowerCase(), dept);
        depts.set(id, dept.name);
      }
      const roleNames = str(r.roles ?? r.role, 300).split(/[;|]/).map((s) => s.trim()).filter(Boolean);
      const roleIds = roleNames.length
        ? roleNames.map((n) => {
            const role = roleByName.get(n.toLowerCase());
            if (!role) throw new AuthError(400, `Unknown role "${n}".`);
            return role.id;
          })
        : [`${companyId}_employee`];
      const res = await createUserInternal(
        actor,
        companyId,
        { name: r.name, email, title: r.title, departmentId: dept?.id || '', roleIds, sendInvite: body.sendInvite !== false },
        origin,
        { company, roles, depts }
      );
      results.push({ row: i + 1, email, ok: true, emailed: res.emailed, inviteLink: res.inviteLink, inviteError: res.inviteError });
    } catch (e: any) {
      results.push({ row: i + 1, email, ok: false, error: e?.message || 'Failed' });
    }
  }
  return ok({ imported: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results });
}

async function updateUser(headers: Record<string, any>, body: any, origin?: string): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'users.manage');
  const companyId = actor.companyId!;
  const userId = str(body.userId, 128);
  const ref = db().collection('employees').doc(userId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.companyId !== companyId) return fail(404, 'User not found.');
  const current = snap.data() as EmployeeDoc;

  const [company, roles] = await Promise.all([loadCompany(companyId), loadRoles(companyId)]);
  const updates: Record<string, any> = { updatedAt: nowIso() };
  if (body.name !== undefined) updates.name = str(body.name, 120) || current.name;
  if (body.title !== undefined) updates.title = str(body.title, 120);

  if (body.departmentId !== undefined) {
    const departmentId = str(body.departmentId, 128);
    if (departmentId) {
      const d = await db().collection('departments').doc(departmentId).get();
      if (!d.exists || d.data()?.companyId !== companyId) return fail(400, 'Selected department does not exist.');
      updates.departmentId = departmentId;
      updates.departmentName = String(d.data()?.name || '');
    } else {
      updates.departmentId = '';
      updates.departmentName = '';
    }
  }

  const adminRoleIds = roles.filter((r) => r.isAdmin).map((r) => r.id);

  // Changing the sign-in email. Everything that can fail is checked here, before anything is written.
  const oldEmail = String(current.email || '').toLowerCase();
  const nextEmail = body.email === undefined ? oldEmail : str(body.email, 200).toLowerCase();
  const emailChanged = !!nextEmail && nextEmail !== oldEmail;
  if (body.email !== undefined && !nextEmail) return fail(400, 'Email cannot be empty.');
  let authUser: { metadata?: { lastSignInTime?: string }; customClaims?: Record<string, any> } | undefined;
  if (emailChanged) {
    if (!EMAIL_RE.test(nextEmail)) return fail(400, `"${nextEmail}" is not a valid email.`);
    // Whoever controls a person's email can reset their password, so it needs the same standing as giving them access.
    const targetIsAdmin = current.roleIds.some((r) => adminRoleIds.includes(r));
    if (targetIsAdmin && !actor.isCompanyAdmin) return fail(403, 'Only a Company Admin can change the email of another admin.');
    // Everyone-level permissions (read and acknowledge policies) never count as "more access".
    const beyondBaseline = (current.perms || []).filter((p) => p !== 'doc.acknowledge' && p !== 'doc.suggest');
    if (!canGrantPermissions(actor.perms, actor.isCompanyAdmin, beyondBaseline)) {
      return fail(403, 'You cannot change the email of someone who has access you do not have.');
    }
    try {
      authUser = await adminAuth().getUser(current.authUid);
    } catch {
      return fail(404, 'This person has no login account to change.');
    }
    if ((authUser.customClaims as TenantClaims | undefined)?.pa === true) return fail(403, 'A platform administrator\'s email cannot be changed here.');
    try {
      const taken = await adminAuth().getUserByEmail(nextEmail);
      if (taken.uid !== current.authUid) return fail(409, `${nextEmail} already has an account.`);
    } catch (e: any) {
      if (e?.code !== 'auth/user-not-found') throw e;
    }
  }

  let nextRoleIds = current.roleIds;
  if (Array.isArray(body.roleIds)) {
    nextRoleIds = body.roleIds.map(String);
    if (!nextRoleIds.length) return fail(400, 'A user needs at least one role.');
    assertCanAssign(actor, roles, nextRoleIds.filter((id) => !current.roleIds.includes(id)));
    updates.roleIds = nextRoleIds;
  }
  const nextActive = body.active === undefined ? current.active !== false : body.active === true;
  updates.active = nextActive;

  const wasAdmin = current.active !== false && current.roleIds.some((r) => adminRoleIds.includes(r));
  const willBeAdmin = nextActive && nextRoleIds.some((r) => adminRoleIds.includes(r));
  if (wasAdmin && !willBeAdmin) {
    if (!actor.isCompanyAdmin) return fail(403, 'Only a Company Admin can remove another admin.');
    if ((await activeAdminCount(companyId, adminRoleIds, current.authUid)) < 1) {
      return fail(400, 'Every company needs at least one active Company Admin.');
    }
  }

  if (emailChanged) {
    // Login first (it is the part most likely to be refused), then the directory record; undo the login if the record fails.
    await adminAuth().updateUser(current.authUid, { email: nextEmail });
    updates.email = nextEmail;
    if (String(current.loginId || '').toLowerCase() === oldEmail) updates.loginId = nextEmail;
    updates.emailHistory = [...(current.emailHistory || []).slice(-9), { email: oldEmail, changedAt: nowIso(), changedBy: actor.email }];
    try {
      await ref.update(updates);
    } catch (err) {
      await adminAuth().updateUser(current.authUid, { email: oldEmail }).catch(() => {});
      throw err;
    }
  } else {
    await ref.update(updates);
  }
  await syncUser(current.authUid, { company, roles });
  // Moving department changes who the person reports to; switching a person on or off can change what their department's members report to.
  const movedDepartment = body.departmentId !== undefined && String(updates.departmentId ?? '') !== String(current.departmentId || '');
  const switched = nextActive !== (current.active !== false);
  if (movedDepartment) await syncDepartmentManagersQuietly(companyId, { uids: [current.authUid] });
  if (switched && current.departmentId) await syncDepartmentManagersQuietly(companyId, { departmentId: current.departmentId });
  if (!nextActive || (emailChanged && current.authUid !== actor.uid)) await adminAuth().revokeRefreshTokens(current.authUid);

  let invite: { emailed: boolean; inviteLink?: string } | undefined;
  if (emailChanged) await afterEmailChange({ companyId, company, current, oldEmail, nextEmail, authUser, origin, onInvite: (i) => { invite = i; } });
  return ok({ userId, emailChanged, invite });
}

/**
 * Keeps the rest of the system pointing at the new address. All of it is best effort: the sign-in email itself has
 * already changed, so a failure here is logged and never undoes it.
 */
async function afterEmailChange(a: {
  companyId: string; company: CompanyDoc; current: EmployeeDoc; oldEmail: string; nextEmail: string;
  authUser?: { metadata?: { lastSignInTime?: string } }; origin?: string; onInvite: (i: { emailed: boolean; inviteLink?: string }) => void;
}): Promise<void> {
  const { companyId, company, current, oldEmail, nextEmail } = a;
  // Policy acknowledgements carry a copy of the email that compliance reminders are sent to.
  try {
    const ids = [current.empId, current.id].filter((v, i, arr) => v && arr.indexOf(v) === i);
    for (const id of ids) {
      const snap = await db().collection('acknowledgments').where('companyId', '==', companyId).where('employeeId', '==', id).get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db().batch();
        snap.docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, { employeeEmail: nextEmail }));
        await batch.commit();
      }
    }
  } catch (e: any) {
    console.warn('[tenant] could not update acknowledgement emails:', e?.message || e);
  }
  // The platform admin's Companies page shows the company's admin email.
  if (String(company.adminEmail || '').toLowerCase() === oldEmail) {
    await db().collection('companies').doc(companyId).update({ adminEmail: nextEmail, updatedAt: nowIso() }).catch(() => {});
  }
  // Someone who never signed in still has a pending invite at the old address: send a fresh one to the new address.
  const neverSignedIn = !a.authUser?.metadata?.lastSignInTime;
  if (neverSignedIn) {
    const r = await sendInvite(nextEmail, current.name, company.name, a.origin).catch(() => null);
    a.onInvite(r ? { emailed: r.emailed, inviteLink: r.emailed ? undefined : r.link } : { emailed: false });
    return;
  }
  // Otherwise tell both addresses, so a change nobody asked for does not go unnoticed.
  const note = (to: string, line: string) =>
    dispatchLiveEmail({
      to, recipientName: current.name, subject: 'Your sign-in email for the HR portal was changed',
      body: `Dear ${current.name},\n\n${line}\n\nIf you did not expect this, contact your company administrator.`,
    }).catch(() => undefined);
  await Promise.all([
    note(oldEmail, `Your sign-in email at ${company.name} was changed from ${oldEmail} to ${nextEmail}. Use ${nextEmail} from now on.`),
    note(nextEmail, `Your sign-in email at ${company.name} is now ${nextEmail}. Your password has not changed.`),
  ]);
}

async function resendInvite(headers: Record<string, any>, body: any, origin?: string): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'users.manage');
  const snap = await db().collection('employees').doc(str(body.userId, 128)).get();
  if (!snap.exists || snap.data()?.companyId !== actor.companyId) return fail(404, 'User not found.');
  const e = snap.data() as EmployeeDoc;
  const invite = await sendInvite(e.email, e.name, e.companyName, origin);
  return ok({ emailed: invite.emailed, inviteLink: invite.emailed ? undefined : invite.link });
}

async function saveDepartment(headers: Record<string, any>, body: any): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'departments.manage');
  const companyId = actor.companyId!;
  const name = str(body.name, 120);
  if (name.length < 2) return fail(400, 'Department name is required.');

  const existing = await db().collection('departments').where('companyId', '==', companyId).get();
  const id = str(body.departmentId, 128);
  if (existing.docs.some((d) => d.id !== id && String(d.data().name).toLowerCase() === name.toLowerCase())) {
    return fail(409, 'A department with this name already exists.');
  }

  let headUserId = '';
  if (body.headUserId) {
    const h = await db().collection('employees').doc(str(body.headUserId, 128)).get();
    if (!h.exists || h.data()?.companyId !== companyId) return fail(400, 'Department head must be a user in your company.');
    headUserId = h.id;
  }

  const ts = nowIso();
  if (id) {
    const ref = db().collection('departments').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.companyId !== companyId) return fail(404, 'Department not found.');
    await ref.update({ name, headUserId, updatedAt: ts });
    // Keep the denormalised name on employees in step.
    const people = await db().collection('employees').where('companyId', '==', companyId).where('departmentId', '==', id).get();
    const batch = db().batch();
    people.docs.forEach((p) => batch.update(p.ref, { departmentName: name, updatedAt: ts }));
    await batch.commit();
    // A new head (or none) changes who everyone in the department reports to, unless their manager was picked by hand.
    await syncDepartmentManagersQuietly(companyId, { departmentId: id });
    return ok({ departmentId: id });
  }
  const newDeptId = newId('dep');
  await db().collection('departments').doc(newDeptId).set({ id: newDeptId, companyId, name, headUserId, createdAt: ts, updatedAt: ts });
  return ok({ departmentId: newDeptId });
}

/** Applies every department head to the people in their department (those whose manager was not picked by hand). */
async function syncManagers(headers: Record<string, any>): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'departments.manage');
  const updated = await syncDepartmentManagers(actor.companyId!, { all: true });
  return ok({ updated });
}

async function deleteDepartment(headers: Record<string, any>, body: any): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'departments.manage');
  const id = str(body.departmentId, 128);
  const ref = db().collection('departments').doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.companyId !== actor.companyId) return fail(404, 'Department not found.');
  const people = await db().collection('employees').where('companyId', '==', actor.companyId).where('departmentId', '==', id).limit(1).get();
  if (!people.empty) return fail(400, 'Move the people in this department elsewhere before deleting it.');
  await ref.delete();
  return ok();
}

async function saveRole(headers: Record<string, any>, body: any): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'roles.manage');
  const companyId = actor.companyId!;
  const name = str(body.name, 80);
  if (name.length < 2) return fail(400, 'Role name is required.');
  const permissions: string[] = Array.from(new Set<string>((Array.isArray(body.permissions) ? body.permissions : []).map(String))).filter((p) => !RETIRED_PERMISSIONS.includes(p));
  if (permissions.some((p) => !isKnownPermission(p))) return fail(400, 'Unknown permission in role.');
  if (!canGrantPermissions(actor.perms, actor.isCompanyAdmin, permissions)) {
    return fail(403, 'You cannot give a role permissions that you do not have yourself.');
  }
  const portal: Portal = ['CREATOR', 'REVIEWER', 'EMPLOYEE'].includes(body.portal) ? body.portal : 'EMPLOYEE';
  // Management permissions only have a screen to live on in the HR or Approver portal.
  const EMPLOYEE_SAFE = ['doc.acknowledge', 'doc.suggest', 'req.create'];
  if (portal === 'EMPLOYEE' && permissions.some((p) => !EMPLOYEE_SAFE.includes(p))) {
    return fail(400, 'A role with management permissions must open in the HR or Approver portal.');
  }

  const roles = await loadRoles(companyId);
  const id = str(body.roleId, 128);
  if (roles.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) return fail(409, 'A role with this name already exists.');

  const ts = nowIso();
  if (id) {
    const current = roles.find((r) => r.id === id);
    if (!current) return fail(404, 'Role not found.');
    if (current.isAdmin) return fail(400, 'The Company Admin role cannot be edited.');
    await db().collection('roles').doc(id).update({ name, description: str(body.description, 300), permissions, portal, updatedAt: ts });
    const people = await db().collection('employees').where('companyId', '==', companyId).where('roleIds', 'array-contains', id).get();
    const company = await loadCompany(companyId);
    const fresh = await loadRoles(companyId);
    for (const p of people.docs) await syncUser((p.data() as EmployeeDoc).authUid, { company, roles: fresh });
    return ok({ roleId: id, usersUpdated: people.size });
  }
  const roleId = `${companyId}_${slugify(name) || 'role'}_${randomBytes(3).toString('hex')}`;
  const role: RoleDef = { id: roleId, companyId, name, description: str(body.description, 300), permissions, portal, isAdmin: false, isDefault: false, createdAt: ts, updatedAt: ts };
  await db().collection('roles').doc(roleId).set(role);
  return ok({ roleId });
}

async function deleteRole(headers: Record<string, any>, body: any): Promise<TenantResult> {
  const actor = await requirePermission(headers, 'roles.manage');
  const id = str(body.roleId, 128);
  const ref = db().collection('roles').doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.companyId !== actor.companyId) return fail(404, 'Role not found.');
  if (snap.data()?.isAdmin) return fail(400, 'The Company Admin role cannot be deleted.');
  const used = await db().collection('employees').where('companyId', '==', actor.companyId).where('roleIds', 'array-contains', id).limit(1).get();
  if (!used.empty) return fail(400, 'Reassign the people who hold this role before deleting it.');
  await ref.delete();
  return ok();
}

/** Called by the browser after signing in so a stale token picks up claim changes. */
async function me(headers: Record<string, any>): Promise<TenantResult> {
  const ctx = await authenticate(headers);
  if (ctx.isPlatformAdmin) return ok({ platformAdmin: true, email: ctx.email });
  if (!ctx.companyId) return fail(403, 'Your account is not linked to a company.');
  const company = await loadCompany(ctx.companyId);
  return ok({ company: { id: company.id, name: company.name, status: company.status, modules: company.modules } });
}

// ------------------------------------------------------------------ router

/**
 * Temporary setup check: GET /api/tenant/diagnose. Reports whether the Firebase service account works from
 * this deployment (booleans and short error text only - never secrets). Remove once sign-up works.
 */
async function diagnose(): Promise<TenantResult> {
  const withTimeout = <T,>(p: Promise<T>, ms = 7000) =>
    Promise.race<T>([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms))]);
  const brief = (e: any) => String(e?.code ? `${e.code}: ${e.message}` : e?.message || e).slice(0, 300);
  const out: Record<string, any> = {
    serviceAccountSet: isAdminConfigured(),
    projectIdEnv: process.env.FIREBASE_PROJECT_ID || null,
    databaseIdEnv: process.env.FIREBASE_DATABASE_ID || null,
    homeCompanyIdSet: !!process.env.HOME_COMPANY_ID,
    node: process.version,
  };
  try {
    const app = adminApp();
    out.keyParses = true;
    out.projectId = app.options.projectId;
  } catch (e) {
    out.keyParses = false;
    out.keyError = brief(e);
    return { status: 200, json: out };
  }
  try {
    await withTimeout(adminAuth().listUsers(1));
    out.authOk = true;
  } catch (e) {
    out.authOk = false;
    out.authError = brief(e);
  }
  try {
    await withTimeout(db().collection('companies').limit(1).get());
    out.firestoreOk = true;
  } catch (e) {
    out.firestoreOk = false;
    out.firestoreError = brief(e);
  }
  return { status: 200, json: out };
}

export async function routeTenant(r: TenantRequest): Promise<TenantResult> {
  try {
    if (r.method === 'GET' && r.action === 'diagnose') return await diagnose();
    if (!isAdminConfigured()) {
      return fail(503, 'Server is not configured for multi-company mode (FIREBASE_SERVICE_ACCOUNT_JSON is missing).');
    }
    const { action, body, headers, origin } = r;
    const b = body && typeof body === 'object' ? body : {};

    if (r.method === 'POST' && action === 'signup') return await signup(b, origin);
    if (r.method === 'GET' && action === 'me') return await me(headers);
    if (r.method === 'GET' && action === 'companies') return await listCompanies(headers);

    if (r.method !== 'POST') return fail(405, 'Method not allowed.');
    switch (action) {
      case 'approve-company': return await setCompanyStatus(headers, b, 'ACTIVE');
      case 'suspend-company': return await setCompanyStatus(headers, b, 'SUSPENDED');
      case 'update-company-modules': return await updateCompanyModules(headers, b);
      case 'delete-company': return await deleteCompany(headers, b);
      case 'create-user': return await createUser(headers, b, origin);
      case 'import-users': return await importUsers(headers, b, origin);
      case 'update-user': return await updateUser(headers, b, origin);
      case 'resend-invite': return await resendInvite(headers, b, origin);
      case 'save-department': return await saveDepartment(headers, b);
      case 'delete-department': return await deleteDepartment(headers, b);
      case 'sync-managers': return await syncManagers(headers);
      case 'save-role': return await saveRole(headers, b);
      case 'delete-role': return await deleteRole(headers, b);
      default: return fail(404, `Unknown tenant action "${action}".`);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    console.error('[tenant] error:', err);
    return fail(500, err?.message || 'Request failed.');
  }
}
