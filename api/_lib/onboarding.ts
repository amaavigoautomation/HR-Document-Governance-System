/**
 * Candidate onboarding flow (replaces the n8n "Candidate Onboarding Form" workflow).
 *
 * Steps
 *  1. Employee ID (AM001, AM002 ...) is generated when HR clicks "Onboard".
 *  2. Firestore is checked for a previous employee/onboarding with the same email or mobile.
 *     Match -> HR must decide (PROCEED / STOP). No match -> continue automatically.
 *  3. Candidate gets an email with the document list + a private upload link.
 *  4. HR is notified when the candidate submits.
 *  5. HR verifies the documents or rejects the candidate.
 *  6. HR gets the accounts checklist (Microsoft, HRMS, assets, system) + an email; HR fills in the details.
 *  7. A cron job (cronjob.org, 09:00 IST) sends the welcome email and then the credentials email
 *     on the onboarding date.
 *
 * Shared by server.ts (Express) and api/onboarding/[action].ts (Vercel).
 *
 * NO SERVICE-ACCOUNT KEY NEEDED: the server uses the normal Firebase web SDK and signs in as one
 * dedicated Firebase Auth user (ONBOARDING_SERVER_EMAIL / ONBOARDING_SERVER_PASSWORD). The Firestore
 * rules only allow that user to touch the onboarding collections, so browsers cannot read them.
 * Candidate documents are stored in Firestore (chunked) instead of Firebase Storage, so no Storage
 * bucket or billing plan is required.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type QuerySnapshot,
} from 'firebase/firestore';
import { dispatchLiveEmail } from './serverEmail.js';
import { getApplicationRecord } from './serverSheets.js';

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

// ------------------------------------------------------------------ firebase (web SDK, signed in as the server user)

/** Optional local fallback: firebase-applet-config.json in the project root (env vars win). */
const fileConfig: Record<string, any> = (() => {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
  } catch {
    return {};
  }
})();

let appInstance: FirebaseApp | null = null;
let fsInstance: Firestore | null = null;
let signIn: Promise<void> | null = null;

function cfg(envKey: string, fileKey: string): string {
  return (process.env[envKey] || fileConfig[fileKey] || '').toString().trim();
}

function firebaseApp(): FirebaseApp {
  if (appInstance) return appInstance;
  // Use a named app so we never clash with any other Firebase app in the same process.
  const name = 'onboarding-server';
  const existing = getApps().find((a) => a.name === name);
  appInstance = existing
    ? getApp(name)
    : initializeApp(
        {
          apiKey: cfg('FIREBASE_API_KEY', 'apiKey'),
          authDomain: cfg('FIREBASE_AUTH_DOMAIN', 'authDomain'),
          projectId: cfg('FIREBASE_PROJECT_ID', 'projectId'),
          appId: cfg('FIREBASE_APP_ID', 'appId'),
        },
        name
      );
  return appInstance;
}

function firestoreDb(): Firestore {
  if (fsInstance) return fsInstance;
  const databaseId = cfg('FIREBASE_DATABASE_ID', 'firestoreDatabaseId') || undefined;
  try {
    fsInstance = initializeFirestore(firebaseApp(), { experimentalAutoDetectLongPolling: true }, databaseId);
  } catch {
    fsInstance = getFirestore(firebaseApp(), databaseId);
  }
  return fsInstance;
}

/** Signs in once per server instance as the dedicated onboarding user and returns Firestore. */
async function fs(): Promise<Firestore> {
  if (!signIn) {
    const email = (process.env.ONBOARDING_SERVER_EMAIL || 'onboarding-server@amaavigo.app').trim();
    const password = (process.env.ONBOARDING_SERVER_PASSWORD || '').trim();
    if (!password) {
      throw new Error('ONBOARDING_SERVER_PASSWORD is not configured.');
    }
    signIn = signInWithEmailAndPassword(getAuth(firebaseApp()), email, password)
      .then(() => undefined)
      .catch((err) => {
        signIn = null;
        throw new Error(`Could not sign in the onboarding server user: ${err?.code || err?.message || err}`);
      });
  }
  await signIn;
  return firestoreDb();
}

const col = async (name: string) => collection(await fs(), name);
const ref = async (name: string, id: string) => doc(await fs(), name, id);

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
  const list = [rec.hrEmail, ...(process.env.HR_NOTIFY_EMAIL || '').split(',')]
    .map((x: string) => s(x).toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(list));
}

async function mail(to: string, recipientName: string, subject: string, body: string) {
  try {
    const r = await dispatchLiveEmail({ to, recipientName, subject, body });
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
  await Promise.all(to.map((t) => mail(t, 'HR Team', subject, body)));
}

function appBase(origin?: string): string {
  return (process.env.APP_URL || origin || 'http://localhost:3000').replace(/\/+$/, '');
}

function uploadLink(rec: any, origin?: string): string {
  return `${appBase(origin)}/onboarding/upload?token=${rec.token}`;
}

// ------------------------------------------------------------------ employee id

async function seedLast(): Promise<number> {
  let max = 0;
  const scan = (v: unknown) => {
    const m = /^AM(\d+)$/i.exec(s(v));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };
  (await getDocs(await col('employees'))).forEach((d) => {
    scan(d.get('empId'));
    scan(d.get('id'));
  });
  (await getDocs(await col('onboardings'))).forEach((d) => scan(d.get('employeeId')));
  return max;
}

async function nextEmployeeId(): Promise<string> {
  const counterRef = await ref('counters', 'employeeId');
  const seed = await seedLast();
  const n = await runTransaction(await fs(), async (tx) => {
    const snap = await tx.get(counterRef);
    const stored = snap.exists() ? Number(snap.get('last')) : 0;
    const next = Math.max(stored, seed) + 1;
    tx.set(counterRef, { last: next, updatedAt: new Date().toISOString() });
    return next;
  });
  return `AM${String(n).padStart(3, '0')}`;
}

// ------------------------------------------------------------------ prior employee check

async function findPriorMatches(email: string, mobile: string, selfId: string) {
  const matches: { source: string; id: string; name: string; email: string; detail: string }[] = [];
  const lower = email.toLowerCase();

  const seen = new Set<string>();
  const empQueries = [email, lower].filter((v, i, a) => v && a.indexOf(v) === i);
  for (const e of empQueries) {
    const snap = await getDocs(query(await col('employees'), where('email', '==', e)));
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

  const addOnboardings = (snap: QuerySnapshot) =>
    snap.forEach((d) => {
      if (d.id === selfId || seen.has(`on:${d.id}`)) return;
      seen.add(`on:${d.id}`);
      matches.push({
        source: 'Previous onboarding',
        id: s(d.get('employeeId')),
        name: s(d.get('name')),
        email: s(d.get('email')),
        detail: `Status ${s(d.get('status'))} · onboarding date ${s(d.get('onboardingDate'))}`,
      });
    });
  if (lower) addOnboardings(await getDocs(query(await col('onboardings'), where('emailLower', '==', lower))));
  if (mobile) addOnboardings(await getDocs(query(await col('onboardings'), where('mobile', '==', mobile))));

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
    `Welcome to Amaavigo! We are pleased to move forward with your onboarding for the role of ${rec.designation}.`,
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
  return mail(rec.email, rec.name, `Action required: upload your onboarding documents (${rec.employeeId})`, body);
}

async function sendWelcome(rec: any) {
  const body = [
    `Dear ${rec.name},`,
    '',
    `Welcome to Amaavigo! Today is your first day as ${rec.designation}, and we are delighted to have you with us.`,
    `Your Employee ID is ${rec.employeeId}.`,
    '',
    'You will receive a separate email shortly with your account credentials.',
    'If you need anything, please reach out to the HR team.',
    '',
    'We wish you a great start.',
  ].join('\n');
  return mail(rec.email, rec.name, `Welcome to Amaavigo, ${rec.name.split(' ')[0]}!`, body);
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
  return mail(rec.email, rec.name, `Your Amaavigo account credentials (${rec.employeeId})`, body);
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

async function getRec(id: string) {
  if (!id) return null;
  const snap = await getDoc(await ref('onboardings', id));
  return snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null;
}

async function saveRec(id: string, patch: Record<string, any>, ev?: any) {
  const upd: Record<string, any> = { ...patch, updatedAt: new Date().toISOString() };
  if (ev) upd.events = arrayUnion(ev);
  await setDoc(await ref('onboardings', id), upd, { merge: true });
}

// ------------------------------------------------------------------ HR actions

async function startOnboarding(body: any, origin?: string): Promise<Result> {
  const applicationId = s(body.applicationId);
  const onboardingDate = s(body.onboardingDate);
  if (!applicationId) return fail(400, 'applicationId is required.');
  if (!isIsoDate(onboardingDate)) return fail(400, 'A valid onboarding date is required.');

  const cs = await getDoc(await ref('candidateStatuses', applicationId));
  if (cs.exists() && cs.get('status') === 'REJECTED') {
    return fail(409, 'This candidate is marked Rejected. Change the status before onboarding.');
  }

  const dup = await getDocs(query(await col('onboardings'), where('applicationId', '==', applicationId)));
  const active = dup.docs.find((d) => !['HR_STOPPED', 'REJECTED'].includes(d.get('status')));
  if (active) return fail(409, `Onboarding already exists for this candidate (${active.get('employeeId')}).`, { onboardingId: active.id });

  const app = await getApplicationRecord(applicationId);
  if (!app) return fail(404, 'Candidate application not found in the job-applications API.');
  if (!app.email) return fail(400, 'This candidate has no email address, so documents cannot be requested.');

  const employeeId = await nextEmployeeId(); // step 1
  const id = doc(await col('onboardings')).id;
  const now = new Date().toISOString();
  const emailLower = app.email.toLowerCase();

  const matches = await findPriorMatches(app.email, app.mobile, id); // step 2
  const rec: any = {
    id,
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
  await setDoc(await ref('onboardings', id), rec);

  if (matches.length > 0) {
    await saveRec(id, {}, event(`Possible previous employee found (${matches.length} match${matches.length > 1 ? 'es' : ''}). Waiting for HR decision.`));
    await mailHr(
      rec,
      `Decision needed: ${rec.name} may have worked at Amaavigo before`,
      `${rec.name} (${rec.designation}) has been matched against ${matches.length} existing record(s).\n\nOpen Onboarding in the HR portal to review the candidate's data and choose whether to move forward.`
    );
    return ok({ onboardingId: id, employeeId, status: 'PRIOR_EMPLOYEE_REVIEW', priorMatches: matches });
  }

  const sent = await sendDocsRequest(rec, origin);
  await saveRec(id, {}, event(sent ? 'Document request emailed to the candidate.' : 'Document request email could not be sent (check SMTP settings).'));
  return ok({ onboardingId: id, employeeId, status: 'DOCS_REQUESTED', emailSent: sent });
}

async function decidePrior(body: any, origin?: string): Promise<Result> {
  const rec: any = await getRec(s(body.onboardingId));
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

async function resendDocs(body: any, origin?: string): Promise<Result> {
  const rec: any = await getRec(s(body.onboardingId));
  if (!rec) return fail(404, 'Onboarding not found.');
  if (rec.status !== 'DOCS_REQUESTED') return fail(409, 'Documents are not currently being requested.');
  const sent = await sendDocsRequest(rec, origin);
  await saveRec(rec.id, {}, event(sent ? 'Document request re-sent.' : 'Re-send failed.'));
  return ok({ emailSent: sent });
}

async function reviewDocs(body: any): Promise<Result> {
  const rec: any = await getRec(s(body.onboardingId));
  if (!rec) return fail(404, 'Onboarding not found.');
  if (rec.status !== 'DOCS_SUBMITTED') return fail(409, 'Documents have not been submitted yet.');
  const by = s(body.hrName) || 'HR';

  if (s(body.decision) === 'REJECT') {
    const reason = s(body.reason);
    await saveRec(rec.id, { status: 'REJECTED', rejectionReason: reason }, event(`Document verification failed. Candidate rejected${reason ? `: ${reason}` : ''}.`, by));
    await setDoc(
      await ref('candidateStatuses', rec.applicationId),
      { status: 'REJECTED', updatedBy: by, updatedAt: new Date().toISOString() },
      { merge: true }
    );
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

async function saveAccounts(body: any): Promise<Result> {
  const rec: any = await getRec(s(body.onboardingId));
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

async function updateDate(body: any): Promise<Result> {
  const rec: any = await getRec(s(body.onboardingId));
  if (!rec) return fail(404, 'Onboarding not found.');
  if (rec.status === 'ONBOARDED') return fail(409, 'Already onboarded.');
  const d = s(body.onboardingDate);
  if (!isIsoDate(d)) return fail(400, 'A valid onboarding date is required.');
  await saveRec(rec.id, { onboardingDate: d }, event(`Onboarding date changed to ${d}.`, s(body.hrName) || 'HR'));
  return ok({});
}

async function setCandidateStatus(body: any): Promise<Result> {
  const applicationId = s(body.applicationId);
  const status = s(body.status) as CandidateStatus;
  if (!applicationId) return fail(400, 'applicationId is required.');
  if (!['PENDING', 'ON_HOLD', 'REJECTED'].includes(status)) return fail(400, 'Invalid status.');
  await setDoc(
    await ref('candidateStatuses', applicationId),
    { status, updatedBy: s(body.hrName) || 'HR', updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return ok({ status });
}

async function candidateStatuses(): Promise<Result> {
  const statuses: Record<string, string> = {};
  (await getDocs(await col('candidateStatuses'))).forEach((d) => (statuses[d.id] = s(d.get('status'))));
  const onboardings: Record<string, any> = {};
  (await getDocs(await col('onboardings'))).forEach((d) => {
    const st = s(d.get('status'));
    if (st === 'HR_STOPPED') return;
    onboardings[s(d.get('applicationId'))] = { id: d.id, status: st, employeeId: s(d.get('employeeId')) };
  });
  return ok({ statuses, onboardings });
}

async function listOnboardings(): Promise<Result> {
  const snap = await getDocs(await col('onboardings'));
  const items = snap.docs.map((d) => listView({ id: d.id, ...(d.data() as any) }));
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ items, documents: ONBOARDING_DOCUMENTS, accountItems: ACCOUNT_ITEMS });
}

async function readFile(onboardingId: string, docKey: string): Promise<Result> {
  const rec: any = await getRec(onboardingId);
  const meta = rec?.docs?.[docKey];
  if (!meta?.fileId) return fail(404, 'File not found.');
  const store = await fs();
  const parts: string[] = [];
  for (let i = 0; i < (meta.chunks || 0); i++) {
    const snap = await getDoc(doc(store, 'onboardingFiles', `${meta.fileId}_${i}`));
    if (!snap.exists()) return fail(500, 'File is incomplete.');
    parts.push(String(snap.get('data')));
  }
  return { status: 200, json: {}, file: { data: Buffer.from(parts.join(''), 'base64'), mime: meta.mime, name: meta.fileName } };
}

// ------------------------------------------------------------------ candidate (public, token) actions

async function recByToken(token: string): Promise<any | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const snap = await getDocs(query(await col('onboardings'), where('token', '==', token)));
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
  const type = mime.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME.includes(type)) return fail(415, 'Only PDF, JPG or PNG files are allowed.');

  // Store the file as base64 chunks in Firestore (1 MiB doc limit), replacing any earlier upload.
  const fileId = `${rec.id}_${docKey}_${Date.now()}`;
  const b64 = data.toString('base64');
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_CHARS) chunks.push(b64.slice(i, i + CHUNK_CHARS));
  const store = await fs();
  const batch = writeBatch(store);
  chunks.forEach((c, i) => batch.set(doc(store, 'onboardingFiles', `${fileId}_${i}`), { data: c }));
  await batch.commit();

  const old = rec.docs?.[docKey];
  await updateDoc(await ref('onboardings', rec.id), {
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
    const del = writeBatch(store);
    for (let i = 0; i < (old.chunks || 0); i++) del.delete(doc(store, 'onboardingFiles', `${old.fileId}_${i}`));
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
  const snap = await getDocs(query(await col('onboardings'), where('onboardingDate', '<=', today)));
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
    const role = s(r.headers['x-user-role']);
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

    // ---- HR only (header-based role check, same stopgap as the other routes)
    if (role !== HR_ROLE && !(action === 'candidate-statuses' && role === 'REVIEWER')) {
      return fail(403, 'Access denied: only HR can use onboarding.');
    }

    if (action === 'candidate-statuses' && r.method === 'GET') return await candidateStatuses();
    if (action === 'list' && r.method === 'GET') return await listOnboardings();
    if (action === 'file' && r.method === 'GET') return await readFile(s(r.query.id), s(r.query.key));
    if (action === 'get' && r.method === 'GET') {
      const rec = await getRec(s(r.query.id));
      return rec ? ok({ item: await hrView(rec) }) : fail(404, 'Onboarding not found.');
    }
    if (r.method !== 'POST') return fail(405, 'Method not allowed.');

    switch (action) {
      case 'start': return await startOnboarding(body, r.origin);
      case 'decide-prior': return await decidePrior(body, r.origin);
      case 'resend-docs': return await resendDocs(body, r.origin);
      case 'review-docs': return await reviewDocs(body);
      case 'save-accounts': return await saveAccounts(body);
      case 'update-date': return await updateDate(body);
      case 'set-status': return await setCandidateStatus(body);
      default: return fail(404, `Unknown onboarding action '${action}'.`);
    }
  } catch (err: any) {
    console.error('[Onboarding] error:', err);
    return fail(500, err?.message || 'Onboarding request failed.');
  }
}
