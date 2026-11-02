/**
 * Hiring pipeline, part 1 (reached through hiringRouter.ts as /api/recruitment/<action>):
 *
 *   jdlib-list / jdlib-save / jdlib-delete        reusable job description library
 *   post-kit / post-list / post-save / post-delete  paste-ready posts for job boards and a tracker of where each job is posted
 *   ref-jobs / ref-submit / ref-list              employee referrals (any signed-in employee)
 *   cand-save                                     candidate database fields (CTC, notice, portfolio, qualification ...)
 *   resume-extract                                read a resume and keep its text and a few facts for scoring
 *   score-settings / score-settings-save          the six weights (Skills ... Salary fit) per company
 *   score-get / score-rate                        weighted score out of 100 for one candidate, and manual ratings
 *
 * Everything lives in one server-only collection, hiringItems, told apart by `kind`, and every record carries a companyId.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, requirePermission, type AuthContext } from './authContext.js';
import { createApplication, getApplication, normalizeApplicationInput, type ApplicationDoc } from './recruitmentData.js';
import { readResume } from './aiScoring.js';
import {
  DEFAULT_WEIGHTS, cleanWeights, experienceRating, portfolioRating, salaryFitRating, skillsRating, stabilityRating, weightedScore, weightsError,
  type PartRatings, type ScoreWeights,
} from '../../shared/hiringScore.js';
import { requisitionMaxCtcLpa } from '../../shared/hiringBudget.js';

export interface PipeRequest { method: string; action: string; query: Record<string, any>; body?: any; headers: Record<string, any>; origin?: string }
type Result = { status: number; json: any };

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** HR and recruiters: anyone who manages applications or job descriptions. */
export const MANAGE_PERMS = ['app.manage', 'req.manage_jd', 'req.hr_decide'];

// ------------------------------------------------------------------ storage helpers

export interface Item { id: string; companyId: string; kind: string; [k: string]: any }

export async function listItems(cid: string, kind: string): Promise<Item[]> {
  const snap = await db().collection('hiringItems').where('companyId', '==', cid).where('kind', '==', kind).get();
  return snap.docs.map((d) => d.data() as Item);
}

export async function getItem(cid: string, id: string, kind?: string): Promise<Item | null> {
  if (!id) return null;
  const snap = await db().collection('hiringItems').doc(id).get();
  const it = snap.exists ? (snap.data() as Item) : null;
  return it && it.companyId === cid && (!kind || it.kind === kind) ? it : null;
}

export async function putItem(it: Item): Promise<void> {
  await db().collection('hiringItems').doc(it.id).set(clean(it));
}

export function newId(): string {
  return db().collection('hiringItems').doc().id;
}

/** Who is acting: the name stored on their employee record, or their email. */
export async function whoIs(ctx: AuthContext): Promise<string> {
  try {
    const s = await db().collection('employees').where('authUid', '==', ctx.uid).get();
    const d = s.docs.find((x) => x.get('companyId') === ctx.companyId);
    if (d && d.get('name')) return String(d.get('name'));
  } catch { /* fall through */ }
  return ctx.email;
}

export async function getRequisition(cid: string, id: string): Promise<Record<string, any> | null> {
  if (!id) return null;
  const snap = await db().collection('requisitions').doc(id).get();
  const r = snap.exists ? (snap.data() as Record<string, any>) : null;
  return r && r.companyId === cid ? r : null;
}

/** The requisition an application belongs to: by id when it has one, otherwise by matching the designation to an open position. */
export async function requisitionForApplication(cid: string, a: ApplicationDoc): Promise<Record<string, any> | null> {
  const direct = await getRequisition(cid, a.requisitionId);
  if (direct) return direct;
  const snap = await db().collection('requisitions').where('companyId', '==', cid).get();
  const key = a.designationKey;
  const hits = snap.docs.map((d) => d.data() as Record<string, any>).filter((r) => String(r.positionTitle || '').toLowerCase().replace(/\s+/g, ' ').trim() === key);
  hits.sort((x, y) => (x.status === 'JOB_OPEN' ? -1 : 1) - (y.status === 'JOB_OPEN' ? -1 : 1));
  return hits[0] || null;
}

const skillList = (s: unknown): string[] => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 40);

// ------------------------------------------------------------------ JD library

async function jdLibList(cid: string): Promise<Result> {
  const items = (await listItems(cid, 'jdTemplate')).sort((a, b) => String(a.title).localeCompare(String(b.title)));
  return ok({ items });
}

async function jdLibSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const title = str(b.title, 120);
  const text = str(b.text, 20000);
  if (!title) return fail(400, 'Give the template a title.');
  if (text.length < 20) return fail(400, 'The job description text is too short.');
  const prev = b.id ? await getItem(cid, String(b.id), 'jdTemplate') : null;
  if (b.id && !prev) return fail(404, 'Template not found.');
  const it: Item = {
    id: prev?.id || newId(), companyId: cid, kind: 'jdTemplate',
    title, department: str(b.department, 120), skills: skillList(Array.isArray(b.skills) ? b.skills.join(',') : b.skills), text,
    version: (prev?.version || 0) + 1, createdAt: prev?.createdAt || nowIso(), createdBy: prev?.createdBy || (await whoIs(ctx)), updatedAt: nowIso(), updatedBy: await whoIs(ctx),
  };
  await putItem(it);
  return ok({ item: it });
}

async function deleteOwned(cid: string, id: string, kind: string): Promise<Result> {
  const it = await getItem(cid, id, kind);
  if (!it) return fail(404, 'Not found.');
  await db().collection('hiringItems').doc(id).delete();
  return ok();
}

// ------------------------------------------------------------------ job posting tracker

export const BOARDS = ['Careers site', 'LinkedIn', 'Naukri', 'Indeed', 'Internshala', 'Foundit', 'Other'] as const;
const POSTING_STATUS = ['PLANNED', 'LIVE', 'CLOSED'] as const;

/** Paste-ready text for a job board, built from the requisition. Nothing is sent anywhere. */
export function buildPostKit(r: Record<string, any>, board: string, careersUrl = ''): { title: string; body: string } {
  const exp = r.maxExperienceYears ? `${r.minExperienceYears || 0}-${r.maxExperienceYears} years` : r.minExperienceYears ? `${r.minExperienceYears}+ years` : 'Freshers welcome';
  const ctc = r.budgetRange || (r.ctcMaxLpa ? `Up to INR ${r.ctcMaxLpa} LPA` : 'As per industry standards');
  const skills = skillList(r.keySkills);
  const jd = String(r.jd?.text || '').trim();
  const title = `${r.positionTitle}${r.location ? ` - ${r.location}` : ''}`;
  const short = [
    `We are hiring: ${r.positionTitle}`,
    `Department: ${r.departmentName}`,
    `Location: ${r.location || 'To be shared'}${r.workMode ? ` (${r.workMode})` : ''}`,
    `Experience: ${exp}`,
    `Type: ${r.employmentType || 'Full-time'}`,
    `Compensation: ${ctc}`,
    skills.length ? `Key skills: ${skills.join(', ')}` : '',
    r.positionId ? `Position ID: ${r.positionId}` : '',
  ].filter(Boolean);
  const apply = careersUrl ? `Apply: ${careersUrl}` : 'Apply by replying with your resume.';
  const body =
    board === 'LinkedIn'
      ? [`${short[0]}!`, '', ...short.slice(1), '', jd ? jd.slice(0, 1800) : '', '', apply, '', `#hiring #${String(r.departmentName || 'jobs').replace(/\W+/g, '')}`].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n')
      : [...short, '', jd || 'Details shared on application.', '', apply].join('\n');
  return { title, body };
}

async function postKit(ctx: AuthContext, q: any): Promise<Result> {
  const req = await getRequisition(ctx.companyId!, str(q.requisitionId, 100));
  if (!req) return fail(404, 'Requisition not found.');
  if (!['JD_DRAFT', 'JOB_OPEN'].includes(req.status)) return fail(409, 'Only approved requisitions can be posted.');
  const kits = BOARDS.filter((b) => b !== 'Careers site').map((board) => ({ board, ...buildPostKit(req, board) }));
  return ok({ kits, hint: 'Copy a post into the job board. Then record it with Save posting so the tracker stays current. Only the careers site is published automatically.' });
}

async function postList(cid: string, q: any): Promise<Result> {
  let items = await listItems(cid, 'posting');
  if (q.requisitionId) items = items.filter((i) => i.requisitionId === String(q.requisitionId));
  items.sort((a, b) => String(b.postedOn || b.createdAt).localeCompare(String(a.postedOn || a.createdAt)));
  return ok({ items, boards: BOARDS });
}

async function postSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const req = await getRequisition(cid, str(b.requisitionId, 100));
  if (!req) return fail(404, 'Requisition not found.');
  const board = str(b.board, 40);
  if (!BOARDS.includes(board as any)) return fail(400, 'Choose a job board.');
  const status = str(b.status, 20) || 'LIVE';
  if (!POSTING_STATUS.includes(status as any)) return fail(400, 'Status must be PLANNED, LIVE or CLOSED.');
  const url = str(b.url, 500);
  if (url && !/^https?:\/\//i.test(url)) return fail(400, 'The link must start with http:// or https://.');
  const cost = num(b.cost);
  if (cost !== null && (cost < 0 || cost > 10_000_000)) return fail(400, 'Cost is not valid.');
  const prev = b.id ? await getItem(cid, String(b.id), 'posting') : null;
  if (b.id && !prev) return fail(404, 'Posting not found.');
  const it: Item = {
    id: prev?.id || newId(), companyId: cid, kind: 'posting', requisitionId: req.id, positionTitle: req.positionTitle, positionId: req.positionId || '',
    board, url, status, postedOn: str(b.postedOn, 10) || (status === 'LIVE' ? nowIso().slice(0, 10) : ''), cost: cost ?? 0, notes: str(b.notes, 500),
    createdAt: prev?.createdAt || nowIso(), updatedAt: nowIso(), updatedBy: await whoIs(ctx),
  };
  await putItem(it);
  return ok({ item: it });
}

// ------------------------------------------------------------------ employee referrals

async function refJobs(cid: string): Promise<Result> {
  const snap = await db().collection('requisitions').where('companyId', '==', cid).get();
  const jobs = snap.docs.map((d) => d.data() as Record<string, any>).filter((r) => r.status === 'JOB_OPEN')
    .map((r) => ({ id: r.id, positionTitle: r.positionTitle, departmentName: r.departmentName, location: r.location || '', workMode: r.workMode || '', positionId: r.positionId || '', keySkills: r.keySkills || '', vacancies: r.vacancies || 1 }));
  return ok({ jobs });
}

async function refSubmit(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const req = await getRequisition(cid, str(b.requisitionId, 100));
  if (!req || req.status !== 'JOB_OPEN') return fail(404, 'That job is not open for referrals.');
  const { value, error } = normalizeApplicationInput({ name: b.name, email: b.email, mobile: b.mobile, designation: req.positionTitle, resume_url: b.resumeUrl, message: b.note, requisition_id: req.id });
  if (!value) return fail(400, error || 'Candidate details are not valid.');
  if (value.email.toLowerCase() === ctx.email.toLowerCase()) return fail(400, 'You cannot refer yourself.');
  const res = await createApplication(cid, { ...value, requisitionId: req.id }, 'REFERRAL');
  const who = await whoIs(ctx);
  // Remember who referred: on the application and as its own record so the referrer can follow it.
  await db().collection('applications').doc(res.id).update({ referredByName: who, updatedAt: nowIso() });
  const prior = (await listItems(cid, 'referral')).find((r) => r.applicationId === res.id && r.referrerUid === ctx.uid);
  const it: Item = prior || { id: newId(), companyId: cid, kind: 'referral', applicationId: res.id, requisitionId: req.id, positionTitle: req.positionTitle, candidateName: value.name, referrerUid: ctx.uid, referrerName: who, note: str(b.note, 500), createdAt: nowIso() };
  await putItem(it);
  return ok({ applicationId: res.id, duplicate: res.duplicate });
}

async function refList(ctx: AuthContext): Promise<Result> {
  const cid = ctx.companyId!;
  const all = await listItems(cid, 'referral');
  const canSeeAll = ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));
  const mine = canSeeAll ? all : all.filter((r) => r.referrerUid === ctx.uid);
  const out = [];
  for (const r of mine) {
    const a = await getApplication(cid, r.applicationId);
    // A referrer sees the stage, never the interview notes or scores.
    out.push({ id: r.id, candidateName: r.candidateName, positionTitle: r.positionTitle, referrerName: r.referrerName, createdAt: r.createdAt, stage: a?.status || 'Removed' });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ items: out, all: canSeeAll });
}

// ------------------------------------------------------------------ candidate database fields

async function candSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  const patch: Record<string, any> = { updatedAt: nowIso() };
  for (const [field, max] of [['currentCtcLpa', 1000], ['expectedCtcLpa', 1000], ['totalExperienceYears', 60]] as const) {
    if (b[field] === undefined) continue;
    const n = num(b[field]);
    if (n !== null && (n < 0 || n > max)) return fail(400, `${field} is not valid.`);
    patch[field] = n === null ? 0 : n;
  }
  if (b.employersCount !== undefined) {
    const n = num(b.employersCount);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 50)) return fail(400, 'Number of employers is not valid.');
    patch.employersCount = n ?? 0;
  }
  for (const [field, max] of [['portfolioUrl', 500], ['qualification', 200], ['noticePeriod', 60], ['city', 80]] as const) {
    if (b[field] !== undefined) patch[field] = str(b[field], max);
  }
  if (patch.portfolioUrl && !/^https?:\/\//i.test(patch.portfolioUrl)) return fail(400, 'The portfolio link must start with http:// or https://.');
  await db().collection('applications').doc(a.id).update(patch);
  return ok();
}

// ------------------------------------------------------------------ resume extraction

export interface ResumeFacts { years: number | null; email: string; phone: string; skillsFound: string[]; skillsMissing: string[] }

/** Pulls a few facts out of resume text. Pure so it can be tested. */
export function extractResumeFacts(text: string, requiredSkills: string[]): ResumeFacts {
  const t = text || '';
  const yearsMatches = [...t.matchAll(/(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)\b/gi)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 50);
  const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || '';
  const phone = t.match(/(\+?\d[\d\s\-().]{8,}\d)/)?.[0]?.trim() || '';
  const lower = t.toLowerCase();
  const found = requiredSkills.filter((s) => lower.includes(s.toLowerCase()));
  return { years: yearsMatches.length ? Math.max(...yearsMatches) : null, email, phone, skillsFound: found, skillsMissing: requiredSkills.filter((s) => !found.includes(s)) };
}

async function resumeExtract(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  if (!a.resumeUrl) return fail(400, 'This candidate has no resume link.');
  const read = await readResume(a.resumeUrl);
  const prior = (await listItems(cid, 'resume')).find((r) => r.applicationId === a.id);
  if (!read.text) {
    // Scanned images / unreadable files: say so plainly instead of scoring on nothing. OCR is a later addition.
    return fail(422, read.error || 'The resume text could not be read (a scanned image needs OCR, which is not set up yet).', { kept: !!prior });
  }
  const req = await requisitionForApplication(cid, a);
  const facts = extractResumeFacts(read.text, skillList(req?.keySkills));
  const it: Item = { id: prior?.id || newId(), companyId: cid, kind: 'resume', applicationId: a.id, text: read.text.slice(0, 20000), facts, extractedAt: nowIso() };
  await putItem(it);
  return ok({ facts, characters: read.text.length });
}

// ------------------------------------------------------------------ weighted score

async function loadWeights(cid: string): Promise<ScoreWeights> {
  const s = (await listItems(cid, 'scoreSettings'))[0];
  return s ? cleanWeights(s.weights) : { ...DEFAULT_WEIGHTS };
}

async function scoreSettings(cid: string): Promise<Result> {
  return ok({ weights: await loadWeights(cid), defaults: DEFAULT_WEIGHTS });
}

async function scoreSettingsSave(ctx: AuthContext, b: any): Promise<Result> {
  const err = weightsError(b.weights);
  if (err) return fail(400, err);
  const cid = ctx.companyId!;
  const prior = (await listItems(cid, 'scoreSettings'))[0];
  await putItem({ id: prior?.id || newId(), companyId: cid, kind: 'scoreSettings', weights: cleanWeights(b.weights), updatedAt: nowIso(), updatedBy: await whoIs(ctx) });
  return ok({ weights: cleanWeights(b.weights) });
}

const firstNumber = (s: string): number | null => {
  const m = String(s || '').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

export async function scoreFor(cid: string, a: ApplicationDoc) {
  const [weights, req, resume, rating] = await Promise.all([
    loadWeights(cid),
    requisitionForApplication(cid, a),
    listItems(cid, 'resume').then((l) => l.find((r) => r.applicationId === a.id) || null),
    listItems(cid, 'rating').then((l) => l.find((r) => r.applicationId === a.id) || null),
  ]);
  const years = a.totalExperienceYears ?? resume?.facts?.years ?? firstNumber(a.experience);
  const ratings: PartRatings = {
    skills: skillsRating(skillList(req?.keySkills), resume?.text || ''),
    experience: req ? experienceRating(years, Number(req.minExperienceYears) || 0, Number(req.maxExperienceYears) || 0) : null,
    portfolio: portfolioRating(a.portfolioUrl, rating?.portfolio),
    communication: typeof rating?.communication === 'number' ? rating.communication : null,
    stability: stabilityRating(years, a.employersCount),
    salaryFit: salaryFitRating(a.expectedCtcLpa, req ? requisitionMaxCtcLpa({ ctcMaxLpa: req.ctcMaxLpa, budgetRange: req.budgetRange }) : null),
  };
  return { score: weightedScore(ratings, weights), requisition: req ? { id: req.id, positionTitle: req.positionTitle, positionId: req.positionId || '' } : null, resumeRead: !!resume, years };
}

async function scoreGet(cid: string, q: any): Promise<Result> {
  const a = await getApplication(cid, str(q.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  return ok(await scoreFor(cid, a));
}

/** Manual ratings (0-100) for the parts only a person can judge. Screening also writes the communication rating. */
export async function saveRating(ctx: AuthContext, applicationId: string, patch: { communication?: number | null; portfolio?: number | null }): Promise<void> {
  const cid = ctx.companyId!;
  const prior = (await listItems(cid, 'rating')).find((r) => r.applicationId === applicationId);
  const it: Item = { ...(prior || {}), id: prior?.id || newId(), companyId: cid, kind: 'rating', applicationId, updatedAt: nowIso(), updatedBy: await whoIs(ctx) };
  if (patch.communication !== undefined) it.communication = patch.communication;
  if (patch.portfolio !== undefined) it.portfolio = patch.portfolio;
  await putItem(it);
}

async function scoreRate(ctx: AuthContext, b: any): Promise<Result> {
  const a = await getApplication(ctx.companyId!, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  const patch: { communication?: number | null; portfolio?: number | null } = {};
  for (const f of ['communication', 'portfolio'] as const) {
    if (b[f] === undefined) continue;
    const n = num(b[f]);
    if (n !== null && (n < 0 || n > 100)) return fail(400, `${f} must be between 0 and 100.`);
    patch[f] = n;
  }
  if (!Object.keys(patch).length) return fail(400, 'Nothing to rate.');
  await saveRating(ctx, a.id, patch);
  return ok(await scoreFor(ctx.companyId!, a));
}

// ------------------------------------------------------------------ router

const ACTIONS: Record<string, { method: 'GET' | 'POST'; who: 'manage' | 'any' | 'admin' }> = {
  'jdlib-list': { method: 'GET', who: 'manage' }, 'jdlib-save': { method: 'POST', who: 'manage' }, 'jdlib-delete': { method: 'POST', who: 'manage' },
  'post-kit': { method: 'GET', who: 'manage' }, 'post-list': { method: 'GET', who: 'manage' }, 'post-save': { method: 'POST', who: 'manage' }, 'post-delete': { method: 'POST', who: 'manage' },
  'ref-jobs': { method: 'GET', who: 'any' }, 'ref-submit': { method: 'POST', who: 'any' }, 'ref-list': { method: 'GET', who: 'any' },
  'cand-save': { method: 'POST', who: 'manage' }, 'resume-extract': { method: 'POST', who: 'manage' },
  'score-settings': { method: 'GET', who: 'manage' }, 'score-settings-save': { method: 'POST', who: 'manage' },
  'score-get': { method: 'GET', who: 'manage' }, 'score-rate': { method: 'POST', who: 'manage' },
};

export async function routePipeline(r: PipeRequest): Promise<Result | null> {
  const spec = ACTIONS[r.action];
  if (!spec) return null;
  try {
    if (r.method !== spec.method) return fail(405, 'Method not allowed.');
    const ctx = spec.who === 'any' ? await requireActiveTenant(r.headers) : await requirePermission(r.headers, ...MANAGE_PERMS);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    const cid = ctx.companyId;
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'jdlib-list': return await jdLibList(cid);
      case 'jdlib-save': return await jdLibSave(ctx, b);
      case 'jdlib-delete': return await deleteOwned(cid, str(b.id, 100), 'jdTemplate');
      case 'post-kit': return await postKit(ctx, r.query);
      case 'post-list': return await postList(cid, r.query);
      case 'post-save': return await postSave(ctx, b);
      case 'post-delete': return await deleteOwned(cid, str(b.id, 100), 'posting');
      case 'ref-jobs': return await refJobs(cid);
      case 'ref-submit': return await refSubmit(ctx, b);
      case 'ref-list': return await refList(ctx);
      case 'cand-save': return await candSave(ctx, b);
      case 'resume-extract': return await resumeExtract(ctx, b);
      case 'score-settings': return await scoreSettings(cid);
      case 'score-settings-save': return await scoreSettingsSave(ctx, b);
      case 'score-get': return await scoreGet(cid, r.query);
      default: return await scoreRate(ctx, b);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Pipeline] error:', err);
    return fail(500, err?.message || 'Hiring pipeline request failed.');
  }
}
