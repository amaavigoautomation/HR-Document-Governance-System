/**
 * Candidate-facing screening link (reached through hiringRouter.ts):
 *
 *   scrlink-create    HR sends a candidate a private link (email) for a screening form and their available time slots
 *   scrlink-list      status of every link: PENDING, COMPLETED, RESCHEDULE or NO_RESPONSE
 *   scrlink-public-get / scrlink-public-submit   the candidate's own page (/?screen=<token>, no sign-in)
 *   sweepScreeningLinks   daily: a link nobody answered for 3 days becomes NO_RESPONSE and HR is told
 *
 * The page shows the company profile and the job description, so the candidate knows who is calling before they answer.
 */
import { randomBytes } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { getApplication, getCompanyName, rateLimited } from './recruitmentData.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { MANAGE_PERMS, getItem, listItems, newId, putItem, requisitionForApplication, whoIs, type Item, type PipeRequest } from './pipelineApi.js';

type Result = { status: number; json: any };
const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NO_RESPONSE_DAYS = 3;
const isHr = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));
const link = (origin: string | undefined, token: string) => `${(process.env.APP_BASE_URL || origin || '').replace(/\/$/, '')}/?screen=${token}`;

async function create(ctx: AuthContext, b: any, origin?: string): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  if (!EMAIL_RE.test(a.email || '')) return fail(400, 'This candidate has no valid email address.');
  const open = (await listItems(cid, 'scrlink')).find((l) => l.applicationId === a.id && l.status === 'PENDING');
  if (open && !b.resend) return fail(409, 'A link is already waiting for this candidate. Use resend.');
  const it: Item = open || { id: newId(), companyId: cid, kind: 'scrlink', applicationId: a.id, candidateName: a.name, email: a.email, designation: a.designation, token: randomBytes(24).toString('hex'), status: 'PENDING', createdAt: nowIso(), createdBy: await whoIs(ctx), createdByEmail: ctx.email };
  await putItem({ ...it, sentAt: nowIso() });
  const company = await getCompanyName(cid);
  let sent = false;
  try { sent = !!(await dispatchLiveEmail({ to: a.email, recipientName: a.name, subject: `Quick screening for your ${a.designation} application`, body: `Hello ${a.name},\n\nThank you for applying to ${company}. Please take two minutes to fill in a short form and choose the times that suit you for a call with our HR team:\n\n${link(origin, it.token)}\n\nThank you.`, fromName: company })).success; } catch { sent = false; }
  return ok({ id: it.id, sent, link: link(origin, it.token) });
}

async function list(cid: string): Promise<Result> {
  const items = (await listItems(cid, 'scrlink')).map(({ token, ...rest }) => rest).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ items });
}

async function byToken(token: string): Promise<Item | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const snap = await db().collection('hiringItems').where('token', '==', token).get();
  const d = snap.docs.find((x: any) => x.data().kind === 'scrlink');
  return d ? ({ ...d.data(), id: d.id } as Item) : null;
}

async function publicGet(token: string, ip: string): Promise<Result> {
  if (rateLimited(`scr-get:${ip}`, 40)) return fail(429, 'Too many requests. Please try again in a minute.');
  const l = await byToken(token);
  if (!l) return fail(404, 'This link is not valid.');
  const a = await getApplication(l.companyId, l.applicationId);
  const req = a ? await requisitionForApplication(l.companyId, a) : null;
  const co = await db().collection('companies').doc(l.companyId).get();
  const cd: any = co.exists ? co.data() : {};
  return ok({
    companyName: str(cd.name, 120), companyAbout: str(cd.about || cd.description, 1500), designation: l.designation, candidateName: l.candidateName, status: l.status,
    jobDescription: str((req as any)?.jobDescription || (req as any)?.jd || '', 6000), answered: l.status !== 'PENDING', answers: l.answers || null,
  });
}

async function publicSubmit(b: any, ip: string): Promise<Result> {
  if (rateLimited(`scr-sub:${ip}`, 10)) return fail(429, 'Too many requests. Please try again in a minute.');
  const l = await byToken(str(b.token, 80));
  if (!l) return fail(404, 'This link is not valid.');
  const wantsReschedule = b.reschedule === true;
  const slots = (Array.isArray(b.slots) ? b.slots : []).map((s: unknown) => str(s, 60)).filter(Boolean).slice(0, 6);
  if (!wantsReschedule && !slots.length) return fail(400, 'Choose at least one time that suits you.');
  const answers = { currentCompany: str(b.currentCompany, 120), noticePeriod: str(b.noticePeriod, 60), currentCtc: str(b.currentCtc, 40), expectedCtc: str(b.expectedCtc, 40), relocation: str(b.relocation, 60), note: str(b.note, 800), slots };
  const status = wantsReschedule ? 'RESCHEDULE' : 'COMPLETED';
  await putItem({ ...l, status, answers, answeredAt: nowIso() });
  if (l.createdByEmail) {
    try { await dispatchLiveEmail({ to: l.createdByEmail, recipientName: '', subject: `${l.candidateName} ${wantsReschedule ? 'asked to reschedule' : 'answered the screening form'}`, body: `${l.candidateName} (${l.designation}) ${wantsReschedule ? 'asked for a different time.' : `answered the screening form. Available: ${slots.join('; ')}.`}\nOpen Talent Acquisition > Candidates to continue.`, fromName: 'Hiring' }); } catch { /* HR sees the status on the screen anyway */ }
  }
  return ok({ status });
}

/** Daily: unanswered links older than NO_RESPONSE_DAYS become NO_RESPONSE. */
export async function sweepScreeningLinks(): Promise<{ checked: number; marked: number }> {
  const snap = await db().collection('hiringItems').where('kind', '==', 'scrlink').get();
  let checked = 0, marked = 0;
  const cutoff = Date.now() - NO_RESPONSE_DAYS * 86400_000;
  for (const d of snap.docs) {
    const l = d.data() as Item;
    if (l.status !== 'PENDING') continue;
    checked++;
    if (new Date(l.sentAt || l.createdAt).getTime() > cutoff) continue;
    await d.ref.update({ status: 'NO_RESPONSE', updatedAt: nowIso() });
    marked++;
  }
  return { checked, marked };
}

const ACTIONS: Record<string, { method: 'GET' | 'POST'; who: 'hr' | 'public' }> = {
  'scrlink-create': { method: 'POST', who: 'hr' }, 'scrlink-list': { method: 'GET', who: 'hr' },
  'scrlink-public-get': { method: 'GET', who: 'public' }, 'scrlink-public-submit': { method: 'POST', who: 'public' },
};

export async function routeScreeningLink(r: PipeRequest & { ip?: string }): Promise<Result | null> {
  const spec = ACTIONS[r.action];
  if (!spec) return null;
  try {
    if (r.method !== spec.method) return fail(405, 'Method not allowed.');
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (spec.who === 'public') {
      const ip = str(r.ip || (r.headers?.['x-forwarded-for'] as string) || 'unknown', 80).split(',')[0].trim();
      return r.action === 'scrlink-public-get' ? await publicGet(str(r.query.token, 80), ip) : await publicSubmit(b, ip);
    }
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (!isHr(ctx)) return fail(403, 'You do not have permission to do this.');
    return r.action === 'scrlink-create' ? await create(ctx, b, r.origin) : await list(ctx.companyId);
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[ScreeningLink] error:', err);
    return fail(500, err?.message || 'Request failed.');
  }
}
export { getItem };
