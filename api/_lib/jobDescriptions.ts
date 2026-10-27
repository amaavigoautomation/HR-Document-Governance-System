/**
 * Job descriptions written or edited in the portal, per company.
 *
 * The company's own source (the website careers API, or a published requisition) may have no description for a
 * role, or an old one. HR can write one here; it takes priority over the source for that designation.
 *
 * Collection `jobDescriptions` (Admin SDK only, see firestore.rules): one document per company + designation.
 */
import { createHash } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';

export const MAX_JD_CHARS = 20000;
export const MAX_DESIGNATION_CHARS = 120;

const COLLECTION = 'jobDescriptions';
const CACHE_TTL_MS = 30 * 1000;

export interface JobDescriptionDoc {
  companyId: string;
  designation: string;
  designationKey: string;
  text: string;
  updatedAt: string;
  updatedBy: string;
}

/** Roles are matched ignoring case, spacing and punctuation: "Inside  Sales Manager" = "inside sales manager". */
export function designationKey(designation: string): string {
  return String(designation || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function docId(companyId: string, key: string): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `${companyId}_${hash}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

const cache = new Map<string, { at: number; byKey: Map<string, JobDescriptionDoc> }>();

export function clearJobDescriptionCache(companyId?: string) {
  if (companyId) cache.delete(companyId);
  else cache.clear();
}

/** Every portal-written JD of the company, by designation key. */
export async function listJobDescriptions(companyId: string): Promise<Map<string, JobDescriptionDoc>> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.byKey;
  const snap = await adminDb().collection(COLLECTION).where('companyId', '==', companyId).get();
  const byKey = new Map<string, JobDescriptionDoc>();
  for (const d of snap.docs) {
    const data = d.data() as JobDescriptionDoc;
    if (data?.designationKey && data.text) byKey.set(data.designationKey, data);
  }
  cache.set(companyId, { at: Date.now(), byKey });
  return byKey;
}

export function validateJobDescription(designation: unknown, text?: unknown): string | null {
  const d = String(designation ?? '').trim();
  if (!d) return 'designation is required.';
  if (d.length > MAX_DESIGNATION_CHARS) return `designation must be at most ${MAX_DESIGNATION_CHARS} characters.`;
  if (!designationKey(d)) return 'designation is not valid.';
  if (text !== undefined) {
    const t = String(text ?? '').trim();
    if (!t) return 'The job description cannot be empty. Use "Revert" to go back to the website version.';
    if (t.length > MAX_JD_CHARS) return `The job description must be at most ${MAX_JD_CHARS} characters.`;
  }
  return null;
}

export async function saveJobDescription(companyId: string, designation: string, text: string, updatedBy: string): Promise<void> {
  const key = designationKey(designation);
  const doc: JobDescriptionDoc = {
    companyId,
    designation: designation.trim(),
    designationKey: key,
    text: text.trim(),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await adminDb().collection(COLLECTION).doc(docId(companyId, key)).set(doc);
  clearJobDescriptionCache(companyId);
}

export async function deleteJobDescription(companyId: string, designation: string): Promise<void> {
  await adminDb().collection(COLLECTION).doc(docId(companyId, designationKey(designation))).delete();
  clearJobDescriptionCache(companyId);
}
