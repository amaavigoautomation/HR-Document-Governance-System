/**
 * Candidate onboarding flow, one set of records per company (multi-tenant).
 *
 * Steps
 *  1. Employee ID (e.g. AM001, ACM001 ...) is generated when HR clicks "Onboard". Each company has its own
 *     prefix and counter.
 *  2. Firestore is checked for a previous employee/onboarding with the same email or mobile in the same company.
 *     Match -> HR must decide (PROCEED / STOP). No match -> continue automatically.
 *  3. Candidate gets an email with the document list + a private upload link.
 *  4. HR is notified when the candidate submits.
 *  5. HR verifies the documents or rejects the candidate.
 *  6. HR gets the accounts checklist (Microsoft, HRMS, assets, system) + an email; HR fills in the details.
 *  7. A cron job (cronjob.org, 09:00 IST) sends the welcome email and then the credentials email
 *     on the onboarding date, for every company.
 *
 * Shared by server.ts (Express) and api/onboarding/[action].ts (Vercel).
 *
 * Every record carries `companyId`. The server uses the Firebase Admin SDK (the collections are closed to
 * browsers by the Firestore rules). Records created before multi-company support have no companyId; they are
 * treated as belonging to the home company (HOME_COMPANY_ID), see scripts/backfill-onboarding-company.ts.
 * Candidate documents are stored in Firestore (chunked) instead of Firebase Storage.
 */
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { getApplicationRecord } from './serverSheets.js';
import { authErrorResponse, requirePermission } from './authContext.js';
import { getCompanyName, getSettings, defaultPrefix, cleanPrefix, usesLegacySource } from './recruitmentData.js';

// ------------------------------------------------------------------ constants

export const ONBOARDING_DOCUMENTS = [
  { key: 'photo', label: 'Passport-size photograph', required: true },
  { key: 'id_proof', label: 'Photo ID proof (Aadhaar / PAN / Passport)', required: true },
  { key: 'address_proof', label: 'Address proof', required: true },
  { key: 'education', label: 'Highest qualification certificate', required: true },
  { key: 'bank', label: 'Cancelled cheque / bank passbook first page', required: true },
  { key: 'prev_employment', label: 'Previous employment relieving / experience letter', required: false },
  { key: 'payslips', label: 'Last 3 months payslips', required: false },
] as const;

export const ACCOUNT_ITEMS = [
  { key: 'microsoft', label: 'Microsoft account', fields: ['username', 'password'] },
  { key: 'hrms', label: 'HRMS credentials', fields: ['username', 'password'] },
  { key: 'assets', label: 'Asset allocation', fields: ['details'] },
  { key: 'system', label: 'System credentials', fields: ['username', 'password'] },
] as const;

export type OnboardingStatus =
  | 'PRIOR_EMPLOYEE_REVIEW'
  | 'HR_STOPPED'
  | 'DOCS_REQUESTED'
  | 'DOCS_SUBMITTED'
  | 'REJECTED'
  | 'ACCOUNTS_PENDING'
  | 'READY_FOR_JOINING'
  | 'ONBOARDED';

export type CandidateStatus = 'PENDING' | 'ON_HOLD' | 'REJECTED';

const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel serverless request limit is ~4.5 MB
const CHUNK_CHARS = 700_000; // base64 chars per Firestore doc (1 MiB doc limit)
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const HR_ROLE = 'CREATOR';

// ------------------------------------------------------------------ firestore (Admin SDK)

const db = () => adminDb();
const col = (name: string) => db().collection(name);

/** Records made before multi-company support have no companyId and belong to the home company. */
function inCompany(data: any, cid: string): boolean {
  const own = s(data?.companyId);
  return own ? own === cid : usesLegacySource(cid);
}

/** All documents of a collection that belong to a company (home company also gets the legacy, untagged ones). */
async function companyDocs(name: string, cid: string) {
  if (usesLegacySource(cid)) {
    const all = await col(name).get();
    return all.docs.filter((d) => inCompany(d.data(), cid));
  }
  return (await col(name).where('companyId', '==', cid).get()).docs;
}

/** Candidate-status documents: legacy id for the home company, company-prefixed id for everyone else. */
const statusDocId = (cid: string, applicationId: string) => (usesLegacySource(cid) ? applicationId : `${cid}__${applicationId}`);

// ------------------------------------------------------------------ helpers

type Result = { status: number; json: any; file?: { data: Buffer; mime: string; name: string } };
const ok = (json: any = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string, extra: any = {}): Result => ({
  status,
  json: { success: false, error, ...extra },
});

function s(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

function newToken(): string {
  return randomBytes(24).toString('hex');
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'file';
}

function event(message: string, by = 'System') {
  return { at: new Date().toISOString(), by, message };
}

function hrRecipients(rec: any): string[] {
  // HR_NOTIFY_EMAIL is the home company's shared inbox; other companies are only notified at the HR address given when onboarding started.
  const shared = usesLegacySource(s(rec.companyId) || '') || !s(rec.companyId) ? (process.env.HR_NOTIFY_EMAIL || '').split(',') : [];
  const list = [rec.hrEmail, ...shared]
    .map((x: string) => s(x).toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(list));
}

const companyLabel = (rec: any) => s(rec?.companyName) || 'Amaavigo';

async function mail(to: string, recipientName: string, subject: string, body: string, fromName?: string) {
  try {
    const r = await dispatchLiveEmail({ to, recipientName, subject, body, fromName });
    if (!r.success) console.warn('[Onboarding] email not sent:', r.error || r.note);
    return r.success;
  } catch (err: any) {
    console.warn('[Onboarding] email failed:', err?.message || err);
    return false;
  }
}

async function mailHr(rec: any, subject: string, body: string) {
  const to = hrRecipients(rec);
  if (to.length === 0) {
    console.warn('[Onboarding] no HR email to notify (set hrEmail or HR_NOTIFY_EMAIL).');
    return;
  }
  await Promise.all(to.map((t) => mail(t, 'HR Team', subject, body, companyLabel(rec))));
}

function appBase(origin?: string): string {
  return (process.env.APP_URL || origin || 'http://localhost:3000').replace(/\/+$/, '');
}

function uploadLink(rec: any, origin?: string): string {
  return `${appBase(origin)}/onboarding/upload?token=${rec.token}`;
}

// ------------------------------------------------------------------ employee id

/** Employee-ID prefix: AM for the home company, otherwise the company's saved prefix (or one made from its name). */
async function employeePrefix(cid: string, companyName: string): Promise<string> {
  if (usesLegacySource(cid)) return 'AM';
  const saved = cleanPrefix((await getSettings(cid))?.employeeIdPrefix);
  return saved || cleanPrefix(defaultPrefix(companyName)) || 'EMP';
}

async function seedLast(cid: string, prefix: string): Promise<number> {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  const scan = (v: unknown) => {
    const m = re.exec(s(v));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };
  (await companyDocs('employees', cid)).forEach((d) => {
    scan(d.get('empId'));
    scan(d.get('id'));
  });
  (await companyDocs('onboardings', cid)).forEach((d) => scan(d.get('employeeId')));
  return max;
}

async function nextEmployeeId(cid: string, companyName: string): Promise<string> {
  const prefix = await employeePrefix(cid, companyName);
  // The home company keeps its original counter document so numbering continues unbroken.
  const counterRef = col('counters').doc(usesLegacySource(cid) ? 'employeeId' : `employeeId_${cid}`);
  const seed = await seedLast(cid, prefix);
  const n = await db().runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const stored = snap.exists ? Number(snap.get('last')) : 0;
    const next = Math.max(stored, seed) + 1;
    tx.set(counterRef, { last: next, companyId: cid, prefix, updatedAt: new Date().toISOString() });
    return next;
  });
  return `${prefix}${String(n).padStart(3, '0')}`;
}

// ------------------------------------------------------------------ prior employee check

async function findPriorMatches(cid: string, email: string, mobile: string, selfId: string) {
  const matches: { source: string; id: string; name: string; email: string; detail: string }[] = [];
  const lower = email.toLowerCase();

  const seen = new Set<string>();
  const empQueries = [email, lower].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const e of empQueries) {
    const snap = await col('employees').where('companyId', '==', cid).where('email', '==', e).get();
    snap.forEach((d) => {
      if (seen.has(`emp:${d.id}`)) return;
      seen.add(`emp:${d.id}`);
      matches.push({
        source: 'Employee directory',
        id: s(d.get('empId')) || d.id,
        name: s(d.get('name')),
        email: s(d.get('email')),
        detail: [s(d.get('title')), s(d.get('departmentName'))].filter(Boolean).join(' · ') || 'Existing employee record',
      });
    });
  }

  for (const d of await companyDocs('onboardings', cid)) {
    if (d.id === selfId || seen.has(`on:${d.id}`)) continue;
    const sameEmail = !!lower && s(d.get('emailLower')) === lower;
    const sameMobile = !!mobile && s(d.get('mobile')) === mobile;
    if (!sameEmail && !sameMobile) continue;
    seen.add(`on:${d.id}`);
    matches.push({
      source: 'Previous onboarding',
      id: s(d.get('employeeId')),
      name: s(d.get('name')),
      email: s(d.get('email')),
      detail: `Status ${s(d.get('status'))} · onboarding date ${s(d.get('onboardingDate'))}`,
    });
  }

  return matches;
}

// ------------------------------------------------------------------ emails

async function sendDocsRequest(rec: any, origin?: string) {
  const list = ONBOARDING_DOCUMENTS.map(
    (d, i) => `${i + 1}. ${d.label}${d.required ? '' : ' (if applicable)'}`
  ).join('\n');
  const body = [
    `Dear ${rec.name},`,
    '',
    `Welcome to ${companyLabel(rec)}! We are pleased to move forward with your onboarding for the role of ${rec.designation}.`,
    `Your Employee ID is ${rec.employeeId}.`,
    '',
    'DOCUMENT DETAILS',
    list,
    '',
    'NEXT STEPS',
    '1. Open your personal upload link below.',
    '2. Upload each document (PDF, JPG or PNG, up to 4 MB each).',
    '3. Click Submit once everything is uploaded.',
    '',
    `Upload link: ${uploadLink(rec, origin)}`,
    '',
    'Please keep this link private. It is created only for you.',
  ].join('\n');
  return mail(rec.email, rec.name, `Action required: upload your onboarding documents (${rec.employeeId})`, body, companyLabel(rec));
}

async function sendWelcome(rec: any) {
  const body = [
    `Dear ${rec.name},`,
    '',
    `Welcome to ${companyLabel(rec)}! Today is your first day as ${rec.designation}, and we are delighted to have you with us.`,
    `Your Employee ID is ${rec.employeeId}.`,
    '',
    'You will receive a separate email shortly with your account credentials.',
    'If you need anything, please reach out to the HR team.',
    '',
    'We wish you a great start.',
  ].join('\n');
  return mail(rec.email, rec.name, `Welcome to ${companyLabel(rec)}, ${rec.name.split(' ')[0]}!`, body, companyLabel(rec));
}

function accountsText(accounts: any): string {
  const lines: string[] = [];
  for (const item of ACCOUNT_ITEMS) {
    const a = accounts?.[item.key] || {};
    lines.push(item.label.toUpperCase());
    for (const f of item.fields) lines.push(`  ${f.charAt(0).toUpperCase() + f.slice(1)}: ${s(a[f]) || '-'}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function sendCredentials(rec: any) {
  const body = [
    `Dear ${rec.name},`,
    '',
    'Here are your account details for getting started. Please change your passwords after your first login.',
    '',
    accountsText(rec.accounts),
    'Do not share these credentials with anyone.',
  ].join('\n');
  return mail(rec.email, rec.name, `Your ${companyLabel(rec)} account credentials (${rec.employeeId})`, body, companyLabel(rec));
}

function accountsComplete(accounts: any): boolean {
  return ACCOUNT_ITEMS.every((item) => item.fields.every((f) => s(accounts?.[item.key]?.[f]) !== ''));
}

// ------------------------------------------------------------------ views

async function hrView(rec: any) {
  // File contents are fetched separately through action "file"; here we only describe them.
  const docs: Record<string, any> = {};
  for (const [key, d] of Object.entries<any>(rec.docs || {})) {
    docs[key] = { fileName: d.fileName, size: d.size, uploadedAt: d.uploadedAt };
  }
  const { token: _t, emailLower: _e, ...rest } = rec;
  return { ...rest, docs };
}

function listView(rec: any) {
  return {
    id: rec.id,
    applicationId: rec.applicationId,
    employeeId: rec.employeeId,
    name: rec.name,
    email: rec.email,
    designation: rec.designation,
    onboardingDate: rec.onboardingDate,
    status: rec.status,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

/** Loads an onboarding record, but only if it belongs to the given company. */
async function getRec(cid: string, id: string) {
  if (!id) return null;
  const snap = await col('onboardings').doc(id).get();
  if (!snap.exists || !inCompany(snap.data(), cid)) return null;
  return { id: snap.id, ...(snap.data() as any) };
}

async function saveRec(id: string, patch: Record<string, any>, ev?: any) {
  const upd: Record<string, any> = { ...patch, updatedAt: new Date().toISOString() };
  if (ev) upd.events = FieldValue.arrayUnion(ev);
  await col('onboardings').doc(id).set(upd, { merge: true });
}

// ------------------------------------------------------------------ HR actions

async function startOnboarding(cid: string, body: any, origin?: string): Promise<Result> {
  const applicationId = s(body.applicationId);
  const onboardingDate = s(body.onboardingDate);
  if (!applicationId) return fail(400, 'applicationId is required.');
  if (!isIsoDate(onboardingDate)) return fail(400, 'A valid onboarding date is required.');

  const cs = await col('candidateStatuses').doc(statusDocId(cid, applicationId)).get();
  if (cs.exists && cs.get('status') === 'REJECTED') {
    return fail(409, 'This candidate is marked Rejected. Change the status before onboarding.');
  }

  const dup = await companyDocs('onboardings', cid);
  const active = dup.find((d) => d.get('applicationId') === applicationId && !['HR_STOPPED', 'REJECTED'].includes(d.get('status')));
  if (active) return fail(409, `Onboarding already exists for this candidate (${active.get('employeeId')}).`, { onboardingId: active.id });

  const app = await getApplicationRecord(cid, applicationId);
  if (!app) return fail(404, 'Candidate application not found.');
  if (!app.email) return fail(400, 'This candidate has no email address, so documents cannot be requested.');

  const companyName = await getCompanyName(cid);
  const employeeId = await nextEmployeeId(cid, companyName); // step 1
  const id = col('onboardings').doc().id;
  const now = new Date().toISOString();
  const emailLower = app.email.toLowerCase();

  const matches = await findPriorMatches(cid, app.email, app.mobile, id); // step 2
  const rec: any = {
    id,
    companyId: cid,
    companyName,
    applicationId,
    employeeId,
    name: app.name || 'Candidate',
    email: app.email,
    emailLower,
    mobile: app.mobile,
    designation: app.designation,
    onboardingDate,
    hrEmail: s(body.hrEmail),
    hrName: s(body.hrName),
    token: newToken(),
    candidate: app.raw, // full application snapshot, shown to HR on a prior-employee match
    priorMatches: matches,
    docs: {},
    accounts: {},
    status: matches.length > 0 ? 'PRIOR_EMPLOYEE_REVIEW' : 'DOCS_REQUESTED',
    createdAt: now,
    updatedAt: now,
    events: [event(`Onboarding started by ${s(body.hrName) || 'HR'}. Employee ID ${employeeId} generated.`, s(body.hrName) || 'HR')],
  };
  await col('onboardings').doc(id).set(rec);

  if (matches.length > 0) {
    await saveRec(id, {}, event(`Possible previous employee found (${matches.length} match${matches.length > 1 ? 'es' : ''}). Waiting for HR decision.`));
    await mailHr(
      rec,
      `Decision needed: ${rec.name} may have worked at ${companyName} before`,
      `${rec.name} (${rec.designation}) has been matched against ${matches.length} existing record(s).\n\nOpen Onboarding in the HR portal to review the candidate's data and choose whether to move forward.`
    );
    return ok({ onboardingId: id, employeeId, status: 'PRIOR_EMPLOYEE_REVIEW', priorMatches: matches });
  }

  const sent = await sendDocsRequest(rec, origin);
  await saveRec(id, {}, event(sent ? 'Document request emailed to the candidate.' : 'Document request email could not be sent (check SMTP settings).'));
  return ok({ onboardingId: id, employeeId, status: 'DOCS_REQUESTED', emailSent: sent });
}

async function decidePrior(cid: string, body: any, origin?: string): Promise<Result> {
  const rec: any = await getRec(cid, s(body.onboardingId));
  if (!rec) return fail(404, 'Onboarding not found.');
  if (rec.status !== 'PRIOR_EMPLOYEE_REVIEW') return fail(409, 'This onboarding is not waiting for a decision.');
  const by = s(body.hrName) || 'HR';
  if (s(body.decision) === 'STOP') {
    await saveRec(rec.id, { status: 'HR_STOPPED' }, event('HR decided not to move forward. Process stopped.', by));
    return ok({ status: 'HR_STOPPED' });
  }
  if (s(body.decision) !== 'PROCEED') return fail(400, 'decision must be PROCEED or STOP.');
  await saveRec(rec.id, { status: 'DOCS_REQUESTED' }, event('HR approved moving forward despite a previous record.', by));
  const sent = await sendDocsRequest(rec, origin);
  await saveRec(rec.id, {}, event(sent ? 'Document request emailed to the candidate.' : 'Document request email could not be sent.'));
  return ok({ status: 'DOCS_REQUESTED', emailSent: sent });
}

async function resendDocs(cid: string, body: any, origin?: string): Promise<Result> {
  const rec: any = await getRec(cid, s(body.onboardingId));
  if (!rec) return fail(404, 'Onboarding not found.');
  if (rec.status !== 'DOCS_REQUESTED') return fail(409, 'Documents are not currently being requested.');
  const sent = await sendDocsRequest(rec, origin);
  await saveRec(rec.id, {}, event(sent ? 'Document request re-sent.' : 'Re-send failed.'));
  return ok({ emailSent: sent });
}

async function reviewDocs(cid: string, body: any): Promise<Result> {
  const rec: any = await getRec(cid, s(body.onboardingId));
  if (!rec) return fail(404, 'Onboarding not found.');
  if (rec.status !== 'DOCS_SUBMITTED') return fail(409, 'Documents have not been submitted yet.');
  const by = s(body.hrName) || 'HR';

  if (s(body.decision) === 'REJECT') {
    const reason = s(body.reason);
    await saveRec(rec.id, { status: 'REJECTED', rejectionReason: reason }, event(`Document verification failed. Candidate rejected${reason ? `: ${reason}` : ''}.`, by));
    await col('candidateStatuses')
      .doc(statusDocId(cid, rec.applicationId))
      .set({ companyId: cid, status: 'REJECTED', updatedBy: by, updatedAt: new Date().toISOString() }, { merge: true });
    return ok({ status: 'REJECTED' });
  }
  if (s(body.decision) !== 'VERIFY') return fail(400, 'decision must be VERIFY or REJECT.');

  await saveRec(
    rec.id,
    { status: 'ACCOUNTS_PENDING', verifiedAt: new Date().toISOString(), verifiedBy: by },
    event('Documents verified. Accounts checklist opened.', by)
  );
  await mailHr(
    rec,
    `Action required: complete the accounts list for ${rec.name} (${rec.employeeId})`,
    [
      `Documents for ${rec.name} (${rec.designation}) are verified.`,
      '',
      'Please create the following and enter the details in Onboarding in the HR portal:',
      ...ACCOUNT_ITEMS.map((a, i) => `${i + 1}. ${a.label}`),
      '',
      `Onboarding date: ${rec.onboardingDate}. The welcome and credentials emails go out that morning at 9:00 AM IST.`,
    ].join('\n')
  );
  return ok({ status: 'ACCOUNTS_PENDING' });
}

async function saveAccounts(cid: string, body: any): Promise<Result> {
  const rec: any = await getRec(cid, s(body.onboardingId));
  if (!rec) return fail(404, 'Onboarding not found.');
  if (!['ACCOUNTS_PENDING', 'READY_FOR_JOINING'].includes(rec.status)) {
    return fail(409, 'Accounts can only be edited after documents are verified and before the welcome email is sent.');
  }
  const incoming = body.accounts && typeof body.accounts === 'object' ? body.accounts : {};
  const accounts: Record<string, Record<string, string>> = {};
  for (const item of ACCOUNT_ITEMS) {
    accounts[item.key] = {};
    for (const f of item.fields) accounts[item.key][f] = s(incoming?.[item.key]?.[f]).slice(0, 500);
  }
  const complete = accountsComplete(accounts);
  const by = s(body.hrName) || 'HR';
  const newStatus = complete ? 'READY_FOR_JOINING' : 'ACCOUNTS_PENDING';
  await saveRec(
    rec.id,
    { accounts, status: newStatus },
    event(complete ? 'Accounts checklist completed.' : 'Accounts checklist saved (incomplete).', by)
  );
  return ok({ status: newStatus, complete });
}

async function updateDate(cid: string, body: any): Promise<Result> {
  const rec: any = await getRec(cid, s(body.onboardingId));
  if (!rec) return fail(404, 'Onboarding not found.');
  if (rec.status === 'ONBOARDED') return fail(409, 'Already onboarded.');
  const d = s(body.onboardingDate);
  if (!isIsoDate(d)) return fail(400, 'A valid onboarding date is required.');
  await saveRec(rec.id, { onboardingDate: d }, event(`Onboarding date changed to ${d}.`, s(body.hrName) || 'HR'));
  return ok({});
}

async function setCandidateStatus(cid: string, body: any): Promise<Result> {
  const applicationId = s(body.applicationId);
  const status = s(body.status) as CandidateStatus;
  if (!applicationId) return fail(400, 'applicationId is required.');
  if (!['PENDING', 'ON_HOLD', 'REJECTED'].includes(status)) return fail(400, 'Invalid status.');
  await col('candidateStatuses')
    .doc(statusDocId(cid, applicationId))
    .set({ companyId: cid, status, updatedBy: s(body.hrName) || 'HR', updatedAt: new Date().toISOString() }, { merge: true });
  return ok({ status });
}

async function candidateStatuses(cid: string): Promise<Result> {
  const statuses: Record<string, string> = {};
  const prefix = usesLegacySource(cid) ? '' : `${cid}__`;
  (await companyDocs('candidateStatuses', cid)).forEach((d) => {
    const key = prefix && d.id.startsWith(prefix) ? d.id.slice(prefix.length) : d.id;
    statuses[key] = s(d.get('status'));
  });
  const onboardings: Record<string, any> = {};
  (await companyDocs('onboardings', cid)).forEach((d) => {
    const st = s(d.get('status'));
    if (st === 'HR_STOPPED') return;
    onboardings[s(d.get('applicationId'))] = { id: d.id, status: st, employeeId: s(d.get('employeeId')) };
  });
  return ok({ statuses, onboardings });
}

async function listOnboardings(cid: string): Promise<Result> {
  const docs = await companyDocs('onboardings', cid);
  const items = docs.map((d) => listView({ id: d.id, ...(d.data() as any) }));
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ items, documents: ONBOARDING_DOCUMENTS, accountItems: ACCOUNT_ITEMS });
}

async function readFile(cid: string, onboardingId: string, docKey: string): Promise<Result> {
  const rec: any = await getRec(cid, onboardingId);
  const meta = rec?.docs?.[docKey];
  if (!meta?.fileId) return fail(404, 'File not found.');
  const parts: string[] = [];
  for (let i = 0; i < (meta.chunks || 0); i++) {
    const snap = await col('onboardingFiles').doc(`${meta.fileId}_${i}`).get();
    if (!snap.exists) return fail(500, 'File is incomplete.');
    parts.push(String(snap.get('data')));
  }
  return { status: 200, json: {}, file: { data: Buffer.from(parts.join(''), 'base64'), mime: meta.mime, name: meta.fileName } };
}

// ------------------------------------------------------------------ candidate (public, token) actions

async function recByToken(token: string): Promise<any | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const snap = await col('onboardings').where('token', '==', token).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...(snap.docs[0].data() as any) };
}

async function publicInfo(token: string): Promise<Result> {
  const rec = await recByToken(token);
  if (!rec) return fail(404, 'This upload link is not valid.');
  return ok({
    name: rec.name,
    designation: rec.designation,
    employeeId: rec.employeeId,
    status: rec.status,
    open: rec.status === 'DOCS_REQUESTED',
    documents: ONBOARDING_DOCUMENTS.map((d) => ({
      ...d,
      uploaded: rec.docs?.[d.key]
        ? { fileName: rec.docs[d.key].fileName, uploadedAt: rec.docs[d.key].uploadedAt }
        : null,
    })),
  });
}

function sniffMime(b: Buffer): string | null {
  if (b.length >= 4 && b.slice(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b.slice(1, 4).toString('latin1') === 'PNG') return 'image/png';
  return null;
}

export async function handleCandidateUpload(
  token: string,
  docKey: string,
  fileName: string,
  mime: string,
  data: Buffer | undefined
): Promise<Result> {
  const rec = await recByToken(token);
  if (!rec) return fail(404, 'This upload link is not valid.');
  if (rec.status !== 'DOCS_REQUESTED') return fail(409, 'Documents are no longer being accepted for this onboarding.');
  if (!ONBOARDING_DOCUMENTS.some((d) => d.key === docKey)) return fail(400, 'Unknown document type.');
  if (!data || !Buffer.isBuffer(data) || data.length === 0) return fail(400, 'No file received.');
  if (data.length > MAX_FILE_BYTES) return fail(413, 'File is larger than 4 MB.');
  // The browser sends application/octet-stream (Vercel only hands us a raw Buffer for that type),
  // so the real type is detected from the file's first bytes.
  const type = sniffMime(data);
  if (!type || !ALLOWED_MIME.includes(type)) return fail(415, 'Only PDF, JPG or PNG files are allowed.');

  // Store the file as base64 chunks in Firestore (1 MiB doc limit), replacing any earlier upload.
  const fileId = `${rec.id}_${docKey}_${Date.now()}`;
  const b64 = data.toString('base64');
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_CHARS) chunks.push(b64.slice(i, i + CHUNK_CHARS));
  const batch = db().batch();
  chunks.forEach((c, i) => batch.set(col('onboardingFiles').doc(`${fileId}_${i}`), { companyId: s(rec.companyId) || null, data: c }));
  await batch.commit();

  const old = rec.docs?.[docKey];
  await col('onboardings').doc(rec.id).update({
    [`docs.${docKey}`]: {
      fileName: s(fileName).slice(0, 120),
      fileId,
      chunks: chunks.length,
      size: data.length,
      mime: type,
      uploadedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  });
  if (old?.fileId) {
    const del = db().batch();
    for (let i = 0; i < (old.chunks || 0); i++) del.delete(col('onboardingFiles').doc(`${old.fileId}_${i}`));
    del.commit().catch(() => undefined);
  }
  return ok({ key: docKey });
}

async function candidateSubmit(token: string): Promise<Result> {
  const rec = await recByToken(token);
  if (!rec) return fail(404, 'This upload link is not valid.');
  if (rec.status !== 'DOCS_REQUESTED') return fail(409, 'Documents were already submitted.');
  const missing = ONBOARDING_DOCUMENTS.filter((d) => d.required && !rec.docs?.[d.key]).map((d) => d.label);
  if (missing.length) return fail(400, `Please upload: ${missing.join(', ')}.`);

  await saveRec(rec.id, { status: 'DOCS_SUBMITTED', submittedAt: new Date().toISOString() }, event('Candidate submitted documents.', rec.name));
  await mailHr(
    rec,
    `Documents submitted by ${rec.name} (${rec.employeeId})`,
    `${rec.name} (${rec.designation}) has uploaded the onboarding documents.\n\nOpen Onboarding in the HR portal to verify them or reject the candidate.`
  );
  return ok({});
}

// ------------------------------------------------------------------ cron

export async function runOnboardingCron(): Promise<Result> {
  const today = istToday();
  // Every company's records are processed together; each record carries its own company name for the emails.
  const snap = await col('onboardings').where('onboardingDate', '<=', today).get();
  let welcomed = 0;
  let reminded = 0;
  const problems: string[] = [];

  for (const d of snap.docs) {
    const rec: any = { id: d.id, ...d.data() };
    try {
      if (rec.status === 'READY_FOR_JOINING' && !rec.welcomeSentAt) {
        const w = await sendWelcome(rec);
        if (!w) {
          problems.push(`${rec.employeeId}: welcome email failed`);
          continue;
        }
        const c = await sendCredentials(rec);
        await saveRec(
          rec.id,
          {
            welcomeSentAt: new Date().toISOString(),
            credentialsSentAt: c ? new Date().toISOString() : null,
            status: c ? 'ONBOARDED' : 'READY_FOR_JOINING',
          },
          event(c ? 'Welcome and credentials emails sent.' : 'Welcome email sent; credentials email failed (will retry).')
        );
        if (!c) problems.push(`${rec.employeeId}: credentials email failed`);
        welcomed++;
      } else if (rec.status === 'READY_FOR_JOINING' && rec.welcomeSentAt && !rec.credentialsSentAt) {
        const c = await sendCredentials(rec);
        if (c) {
          await saveRec(rec.id, { credentialsSentAt: new Date().toISOString(), status: 'ONBOARDED' }, event('Credentials email sent.'));
          welcomed++;
        }
      } else if (rec.status === 'ACCOUNTS_PENDING' && rec.accountsReminderOn !== today) {
        await mailHr(
          rec,
          `Overdue: accounts list for ${rec.name} (${rec.employeeId}) is incomplete`,
          `${rec.name} is due to join on ${rec.onboardingDate}, but the accounts checklist is not complete yet. Please finish it in Onboarding in the HR portal.`
        );
        await saveRec(rec.id, { accountsReminderOn: today });
        reminded++;
      }
    } catch (err: any) {
      problems.push(`${rec.employeeId}: ${err?.message || err}`);
    }
  }
  return ok({ today, welcomed, reminded, problems });
}

// ------------------------------------------------------------------ router

export interface OnboardingRequest {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
  origin?: string;
  /** raw file bytes for action "upload" */
  raw?: Buffer;
}

export async function routeOnboarding(r: OnboardingRequest): Promise<Result> {
  try {
    const action = r.action;
    const body = r.body && typeof r.body === 'object' && !Buffer.isBuffer(r.body) ? r.body : {};

    // ---- public, token based
    if (action === 'public-info' && r.method === 'GET') return await publicInfo(s(r.query.token));
    if (action === 'upload' && r.method === 'PUT') {
      return await handleCandidateUpload(
        s(r.query.token),
        s(r.query.docKey),
        s(r.query.fileName),
        s(r.headers['content-type']),
        r.raw
      );
    }
    if (action === 'submit' && r.method === 'POST') return await candidateSubmit(s(body.token));

    // ---- cron (cronjob.org)
    if (action === 'cron') {
      const secret = (process.env.CRON_SECRET || '').trim();
      const supplied = s(r.query.key) || s(r.headers['authorization']).replace(/^Bearer\s+/i, '') || s(r.headers['x-cron-key']);
      if (!secret) return fail(503, 'CRON_SECRET is not configured.');
      if (supplied !== secret) return fail(401, 'Invalid cron key.');
      return await runOnboardingCron();
    }

    // ---- HR only: verified Firebase identity + permission; everything is limited to the caller's company.
    let cid = '';
    try {
      const ctx =
        action === 'candidate-statuses'
          ? await requirePermission(r.headers, 'onboarding.manage', 'talent.view')
          : await requirePermission(r.headers, 'onboarding.manage');
      cid = s(ctx.companyId);
      if (!cid) return fail(403, 'Your account is not linked to a company.');
    } catch (authErr) {
      const known = authErrorResponse(authErr);
      if (known) return { status: known.status, json: known.json } as Result;
      throw authErr;
    }

    if (action === 'candidate-statuses' && r.method === 'GET') return await candidateStatuses(cid);
    if (action === 'list' && r.method === 'GET') return await listOnboardings(cid);
    if (action === 'file' && r.method === 'GET') return await readFile(cid, s(r.query.id), s(r.query.key));
    if (action === 'get' && r.method === 'GET') {
      const rec = await getRec(cid, s(r.query.id));
      return rec ? ok({ item: await hrView(rec) }) : fail(404, 'Onboarding not found.');
    }
    if (r.method !== 'POST') return fail(405, 'Method not allowed.');

    switch (action) {
      case 'start': return await startOnboarding(cid, body, r.origin);
      case 'decide-prior': return await decidePrior(cid, body, r.origin);
      case 'resend-docs': return await resendDocs(cid, body, r.origin);
      case 'review-docs': return await reviewDocs(cid, body);
      case 'save-accounts': return await saveAccounts(cid, body);
      case 'update-date': return await updateDate(cid, body);
      case 'set-status': return await setCandidateStatus(cid, body);
      default: return fail(404, `Unknown onboarding action '${action}'.`);
    }
  } catch (err: any) {
    console.error('[Onboarding] error:', err);
    return fail(500, err?.message || 'Onboarding request failed.');
  }
}
