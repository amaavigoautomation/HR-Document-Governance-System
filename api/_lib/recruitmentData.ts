/**
 * Per-company candidate data: applications, the application webhook settings and the open jobs.
 *
 * Every record carries a companyId and every query filters on it, so one company can never see another's
 * candidates. Companies that already run on the Amaavigo website APIs (the HOME_COMPANY_ID company) keep
 * using them through serverSheets.ts; everyone else uses what is stored here.
 *
 * Collections (Admin SDK only, see firestore.rules)
 *   applications          one document per application
 *   recruitmentSettings   one document per company: webhook id and key, allowed websites, employee id prefix
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';

// ------------------------------------------------------------------ which companies use the old source

export function legacyCompanyId(): string {
  return (process.env.HOME_COMPANY_ID || '').trim();
}

/** True for the one company whose candidates still come from the Amaavigo website APIs. */
export function usesLegacySource(companyId: string | null | undefined): boolean {
  const home = legacyCompanyId();
  return !!home && !!companyId && companyId === home;
}

// ------------------------------------------------------------------ types

export const APPLICATION_STAGES = ['New Applicant', 'Shortlisted', 'Interview Scheduled', 'Interviewed', 'Selected', 'On Hold', 'Rejected'] as const;

export type ApplicationSource = 'WEBHOOK' | 'MANUAL' | 'CSV';

export interface ApplicationDoc {
  id: string;
  companyId: string;
  name: string;
  email: string;
  emailLower: string;
  mobile: string;
  city: string;
  area: string;
  designation: string;
  designationKey: string;
  requisitionId: string;
  experience: string;
  noticePeriod: string;
  jobPreference: string;
  status: string;
  interviewDate: string;
  message: string;
  interviewComment: string;
  resumeUrl: string;
  extra: Record<string, string>;
  source: ApplicationSource;
  createdAt: string;
  updatedAt: string;
  reappliedAt?: string;
}

export interface OpeningDoc {
  id: string;
  designation: string;
  vacancies: number;
  joiningOn: string;
  qualification: string;
  department: string;
}

export interface RecruitmentSettings {
  companyId: string;
  webhookId: string;
  secretHash: string;
  allowedOrigins: string[];
  employeeIdPrefix: string;
  createdAt: string;
  rotatedAt: string;
  lastReceivedAt?: string;
}

// ------------------------------------------------------------------ small helpers

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

function str(v: unknown, max = 300): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

export function designationKey(d: string): string {
  return d.toLowerCase().replace(/\s+/g, ' ').trim();
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

// ------------------------------------------------------------------ turning messy input into an application

const ALIASES: Record<string, string[]> = {
  name: ['name', 'full_name', 'fullname', 'candidate_name', 'candidatename', 'your_name', 'applicant_name'],
  email: ['email', 'email_address', 'emailaddress', 'e-mail', 'mail', 'your_email'],
  mobile: ['mobile', 'phone', 'phone_number', 'phonenumber', 'mobile_number', 'mobilenumber', 'contact', 'contact_number', 'telephone', 'whatsapp'],
  designation: ['designation', 'position', 'job_title', 'jobtitle', 'role', 'applied_for', 'appliedfor', 'job', 'post', 'opening', 'position_applied'],
  city: ['city', 'location', 'current_city', 'town'],
  area: ['area', 'locality', 'state', 'region'],
  experience: ['experience', 'years_of_experience', 'yearsofexperience', 'exp', 'total_experience', 'work_experience'],
  noticePeriod: ['notice_period', 'noticeperiod', 'notice'],
  jobPreference: ['job_preference', 'jobpreference', 'job_prefrence', 'preference', 'employment_type', 'job_type'],
  message: ['message', 'cover_letter', 'coverletter', 'comments', 'comment', 'note', 'notes', 'about_you', 'description'],
  resumeUrl: ['resume', 'resume_url', 'resumeurl', 'resume_link', 'resumelink', 'cv', 'cv_url', 'cvurl', 'attachment_url', 'attachmenturl', 'resume_file', 'file'],
  requisitionId: ['requisition_id', 'requisitionid', 'job_id', 'jobid', 'opening_id', 'openingid'],
};

const normKey = (k: string) => k.toLowerCase().replace(/[\s-]+/g, '_');

/** Reads one field from a loosely named payload, trying the known spellings first. */
function pick(src: Record<string, any>, field: keyof typeof ALIASES): string {
  const lowered = new Map<string, any>();
  for (const [k, v] of Object.entries(src)) lowered.set(normKey(k), v);
  for (const alias of ALIASES[field]) {
    const v = lowered.get(alias);
    const s = str(v, field === 'message' ? 4000 : 500);
    if (s) return s;
  }
  return '';
}

export interface NormalizedApplication {
  name: string;
  email: string;
  mobile: string;
  city: string;
  area: string;
  designation: string;
  requisitionId: string;
  experience: string;
  noticePeriod: string;
  jobPreference: string;
  message: string;
  resumeUrl: string;
  extra: Record<string, string>;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeApplicationInput(input: unknown): { value?: NormalizedApplication; error?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'The application must be a JSON object.' };
  const src = input as Record<string, any>;

  let name = pick(src, 'name');
  if (!name) {
    const lowered = new Map(Object.entries(src).map(([k, v]) => [normKey(k), v]));
    name = [str(lowered.get('first_name') ?? lowered.get('firstname')), str(lowered.get('last_name') ?? lowered.get('lastname'))].filter(Boolean).join(' ');
  }
  const email = pick(src, 'email');
  if (!name) return { error: 'name is required.' };
  if (!EMAIL_RE.test(email) || email.length > 200) return { error: 'A valid email is required.' };

  let resumeUrl = pick(src, 'resumeUrl');
  if (resumeUrl) {
    try {
      const u = new URL(resumeUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') resumeUrl = '';
    } catch {
      resumeUrl = '';
    }
  }

  const known = new Set(Object.values(ALIASES).flat().concat(['first_name', 'firstname', 'last_name', 'lastname']));
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (Object.keys(extra).length >= 20) break;
    const key = normKey(k);
    if (known.has(key)) continue;
    const s = str(v, 500);
    if (s) extra[k.replace(/[.$#[\]/]/g, '_').slice(0, 60)] = s;
  }

  const designation = titleCase(pick(src, 'designation')) || 'General Application';
  return {
    value: {
      name: titleCase(name).slice(0, 120),
      email: email.slice(0, 200),
      mobile: pick(src, 'mobile').replace(/[^\d+()\-\s.]/g, '').slice(0, 30),
      city: pick(src, 'city'),
      area: pick(src, 'area'),
      designation: designation.slice(0, 120),
      requisitionId: pick(src, 'requisitionId'),
      experience: pick(src, 'experience'),
      noticePeriod: pick(src, 'noticePeriod'),
      jobPreference: pick(src, 'jobPreference'),
      message: pick(src, 'message'),
      resumeUrl: resumeUrl.slice(0, 1000),
      extra,
    },
  };
}

// ------------------------------------------------------------------ applications

export async function createApplication(
  companyId: string,
  n: NormalizedApplication,
  source: ApplicationSource
): Promise<{ id: string; duplicate: boolean }> {
  const emailLower = n.email.toLowerCase();
  const key = designationKey(n.designation);
  const now = nowIso();

  // The same person applying for the same position again updates the earlier application instead of adding a copy.
  const existing = await db().collection('applications').where('companyId', '==', companyId).where('emailLower', '==', emailLower).get();
  const same = existing.docs.find((d) => d.get('designationKey') === key);
  if (same) {
    const patch: Record<string, any> = { reappliedAt: now, updatedAt: now };
    if (n.resumeUrl) patch.resumeUrl = n.resumeUrl;
    if (n.message) patch.message = n.message;
    if (n.mobile) patch.mobile = n.mobile;
    await same.ref.update(patch);
    return { id: same.id, duplicate: true };
  }

  const ref = db().collection('applications').doc();
  const doc: ApplicationDoc = {
    id: ref.id,
    companyId,
    ...n,
    emailLower,
    designationKey: key,
    jobPreference: n.jobPreference,
    status: 'New Applicant',
    interviewDate: '',
    interviewComment: '',
    source,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(clean(doc));
  return { id: ref.id, duplicate: false };
}

export async function importApplications(
  companyId: string,
  rows: unknown[],
  source: ApplicationSource = 'CSV'
): Promise<{ created: number; duplicates: number; errors: { row: number; error: string }[] }> {
  const out = { created: 0, duplicates: 0, errors: [] as { row: number; error: string }[] };
  for (let i = 0; i < rows.length; i++) {
    const { value, error } = normalizeApplicationInput(rows[i]);
    if (!value) {
      out.errors.push({ row: i + 2, error: error || 'Invalid row.' }); // +2: header is row 1
      continue;
    }
    const r = await createApplication(companyId, value, source);
    if (r.duplicate) out.duplicates++;
    else out.created++;
  }
  return out;
}

export async function listApplications(companyId: string): Promise<ApplicationDoc[]> {
  const snap = await db().collection('applications').where('companyId', '==', companyId).get();
  return snap.docs.map((d) => d.data() as ApplicationDoc).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getApplication(companyId: string, id: string): Promise<ApplicationDoc | null> {
  if (!id) return null;
  const snap = await db().collection('applications').doc(id).get();
  const a = snap.exists ? (snap.data() as ApplicationDoc) : null;
  return a && a.companyId === companyId ? a : null;
}

export async function updateApplication(
  companyId: string,
  id: string,
  patch: { status?: string; interviewDate?: string; interviewComment?: string }
): Promise<boolean> {
  const a = await getApplication(companyId, id);
  if (!a) return false;
  const upd: Record<string, any> = { updatedAt: nowIso() };
  if (patch.status !== undefined) upd.status = str(patch.status, 40) || a.status;
  if (patch.interviewDate !== undefined) upd.interviewDate = str(patch.interviewDate, 40);
  if (patch.interviewComment !== undefined) upd.interviewComment = str(patch.interviewComment, 2000);
  await db().collection('applications').doc(id).update(upd);
  return true;
}

export async function deleteApplication(companyId: string, id: string): Promise<boolean> {
  const a = await getApplication(companyId, id);
  if (!a) return false;
  await db().collection('applications').doc(id).delete();
  return true;
}

// ------------------------------------------------------------------ open jobs (the company's published requisitions)

export async function listOpenings(companyId: string): Promise<OpeningDoc[]> {
  const snap = await db().collection('requisitions').where('companyId', '==', companyId).where('status', '==', 'JOB_OPEN').get();
  return snap.docs.map((d) => {
    const r = d.data() as any;
    return {
      id: String(r.id || d.id),
      designation: str(r.positionTitle, 120),
      vacancies: Number(r.vacancies) > 0 ? Number(r.vacancies) : 1,
      joiningOn: str(r.expectedJoiningDate, 40),
      qualification: String(r.jd?.text || '').slice(0, 20000),
      department: str(r.departmentName, 120),
    };
  });
}

// ------------------------------------------------------------------ settings and the webhook

function newSecret(): string {
  return `whk_${randomBytes(24).toString('hex')}`;
}

export function defaultPrefix(companyName: string): string {
  const words = companyName.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join('') : (words[0] || 'EMP').slice(0, 3);
  return letters.toUpperCase();
}

export function cleanPrefix(v: unknown): string {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export async function getSettings(companyId: string): Promise<RecruitmentSettings | null> {
  const snap = await db().collection('recruitmentSettings').doc(companyId).get();
  return snap.exists ? (snap.data() as RecruitmentSettings) : null;
}

/** Creates the company's webhook address and key the first time they are needed. The key is returned only here. */
export async function ensureSettings(companyId: string, companyName: string): Promise<{ settings: RecruitmentSettings; secret?: string }> {
  const existing = await getSettings(companyId);
  if (existing) return { settings: existing };
  const secret = newSecret();
  const now = nowIso();
  const settings: RecruitmentSettings = {
    companyId,
    webhookId: randomBytes(12).toString('hex'),
    secretHash: sha256(secret),
    allowedOrigins: [],
    employeeIdPrefix: defaultPrefix(companyName),
    createdAt: now,
    rotatedAt: now,
  };
  await db().collection('recruitmentSettings').doc(companyId).set(settings);
  return { settings, secret };
}

export async function rotateSecret(companyId: string, companyName: string): Promise<{ settings: RecruitmentSettings; secret: string }> {
  const { settings, secret: created } = await ensureSettings(companyId, companyName);
  if (created) return { settings, secret: created };
  const secret = newSecret();
  const next = { ...settings, secretHash: sha256(secret), rotatedAt: nowIso() };
  await db().collection('recruitmentSettings').doc(companyId).set(next);
  return { settings: next, secret };
}

export function normalizeOrigins(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out = new Set<string>();
  for (const raw of list) {
    try {
      const u = new URL(String(raw).trim());
      if (u.protocol === 'https:' || u.protocol === 'http:') out.add(u.origin);
    } catch {
      /* ignore invalid entries */
    }
  }
  return Array.from(out).slice(0, 10);
}

export async function saveSettings(companyId: string, companyName: string, patch: { allowedOrigins?: unknown; employeeIdPrefix?: unknown }): Promise<RecruitmentSettings> {
  const { settings } = await ensureSettings(companyId, companyName);
  const next = { ...settings };
  if (patch.allowedOrigins !== undefined) next.allowedOrigins = normalizeOrigins(patch.allowedOrigins);
  if (patch.employeeIdPrefix !== undefined) {
    const p = cleanPrefix(patch.employeeIdPrefix);
    if (p) next.employeeIdPrefix = p;
  }
  await db().collection('recruitmentSettings').doc(companyId).set(next);
  return next;
}

export async function settingsByWebhookId(webhookId: string): Promise<RecruitmentSettings | null> {
  if (!/^[a-f0-9]{24}$/.test(webhookId)) return null;
  const snap = await db().collection('recruitmentSettings').where('webhookId', '==', webhookId).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as RecruitmentSettings);
}

export function secretMatches(settings: RecruitmentSettings, supplied: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(sha256(supplied));
  const b = Buffer.from(settings.secretHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function touchReceived(companyId: string): Promise<void> {
  await db().collection('recruitmentSettings').doc(companyId).update({ lastReceivedAt: nowIso() }).catch(() => undefined);
}

// ------------------------------------------------------------------ rate limit (per server instance; a safety net, not a quota)

const hits = new Map<string, number[]>();

export function rateLimited(key: string, max = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return list.length > max;
}

// ------------------------------------------------------------------ company lookup

export async function getCompanyName(companyId: string): Promise<string> {
  const snap = await db().collection('companies').doc(companyId).get();
  return String(snap.data()?.name || 'Your company');
}
