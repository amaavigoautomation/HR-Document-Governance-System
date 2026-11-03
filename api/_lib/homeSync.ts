/**
 * Home company only: copies candidates from the Amaavigo website feed into the stored `applications` records.
 *
 * The home company (HOME_COMPANY_ID) still receives candidates through the website APIs, while the newer hiring tabs
 * (pipeline board, screening, interviews, offers, joining, AI) work on stored applications. This one-way copy gives those tabs
 * something to work on. It never runs for any other company, never overwrites work already done on a copied candidate
 * (stage, interview notes), and never writes anything back to the website.
 */
import { adminDb } from './firebaseAdmin.js';
import { loadLegacyApplications } from './serverSheets.js';
import { designationKey, legacyCompanyId, usesLegacySource, type ApplicationDoc } from './recruitmentData.js';

export interface WebsiteSyncResult { skipped?: boolean; reason?: string; seen: number; created: number; existing: number; invalid: number }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const text = (v: unknown, max = 500) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));

export async function syncWebsiteApplications(companyId: string): Promise<WebsiteSyncResult> {
  const none = { seen: 0, created: 0, existing: 0, invalid: 0 };
  if (!usesLegacySource(companyId) || companyId !== legacyCompanyId()) return { ...none, skipped: true, reason: 'This company does not use the website feed.' };

  const feed = await loadLegacyApplications(true);
  const db = adminDb();
  const stored = await db.collection('applications').where('companyId', '==', companyId).get();
  const ids = new Set<string>(stored.docs.map((d: any) => d.id));
  const pairs = new Set<string>(stored.docs.map((d: any) => `${d.get('emailLower')}|${d.get('designationKey')}`));

  const out: WebsiteSyncResult = { ...none, seen: feed.length };
  for (const a of feed) {
    const raw: any = a.raw || {};
    const email = text(raw.email, 200);
    const name = text(raw.name, 200);
    if (!EMAIL_RE.test(email) || !name) { out.invalid++; continue; }
    const id = `web_${companyId}_${text(a.id, 80).replace(/[^A-Za-z0-9_-]/g, '_')}`;
    const key = designationKey(a.designation);
    const pair = `${email.toLowerCase()}|${key}`;
    if (ids.has(id) || pairs.has(pair)) { out.existing++; continue; }
    const now = new Date().toISOString();
    const row = a.row as string[];
    const doc: ApplicationDoc = {
      id, companyId, name, email, emailLower: email.toLowerCase(),
      mobile: text(row[3], 40), city: text(row[4], 100), area: text(row[5], 100),
      designation: a.designation, designationKey: key, requisitionId: '',
      experience: text(row[7], 100), noticePeriod: text(row[8], 100), jobPreference: text(row[9], 100),
      status: a.status || 'New Applicant', interviewDate: text(row[11], 60), message: text(row[12], 4000),
      interviewComment: text(row[13], 2000), resumeUrl: text(row[14], 500), extra: {}, source: 'WEBHOOK',
      createdAt: a.appliedOn || now, updatedAt: now,
    };
    await db.collection('applications').doc(id).set(JSON.parse(JSON.stringify(doc)));
    ids.add(id); pairs.add(pair); out.created++;
  }
  return out;
}

/** For the daily job: does nothing unless a home company is configured. */
export async function sweepWebsiteApplications(): Promise<WebsiteSyncResult | { skipped: true }> {
  const home = legacyCompanyId();
  if (!home) return { skipped: true };
  return syncWebsiteApplications(home);
}
