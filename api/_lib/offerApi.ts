/**
 * Offer and joining (reached through hiringRouter.ts as /api/recruitment/<action>):
 *
 *   offer-list / offer-get                  every offer with its status, and one offer with its pack and history
 *   offer-create                            HR starts an offer for a candidate: recommended CTC, joining date, probation
 *   offer-act                               submit | approve | reject | send | accept | decline | negotiate | revise | join | withdraw
 *   offer-pack-save                         HR edits the documents of an approved offer before it is sent
 *   offer-tpl-list / offer-tpl-save         the company's own wording for the letter, checklist, NDA and agreement
 *   hcost-list / hcost-save / hcost-delete  hiring costs per requisition (feeds cost per hire)
 *   offer-public-get / offer-public-respond the candidate's own page, opened with the secret link in the email (no sign-in)
 *   sweepOffers                             daily: reminders, ghosted, expired, joining reminders (called by the hiring-daily action)
 *
 * Approval uses the existing founder permission (req.founder_decide). HR steps use the same permissions as the rest of the hiring pipeline.
 * Everything lives in hiringItems (kind offer / offerTpl / hcost) and carries a companyId.
 */
import { flowAdvanceHook } from './flowApi.js';
import { randomBytes } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { getApplication, getCompanyName, rateLimited, updateApplication } from './recruitmentData.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { startOnboarding } from './onboarding.js';
import { MANAGE_PERMS, getItem, getRequisition, listItems, newId, putItem, whoIs, type Item, type PipeRequest } from './pipelineApi.js';
import { welcomeKitFor } from './joiningApi.js';
import { startProbation } from './talentCycleApi.js';
import { loadPeople } from './leaveCore.js';
import { requisitionMaxCtcLpa } from '../../shared/hiringBudget.js';
import {
  COST_CATEGORIES, DEFAULT_PACK_TEMPLATES, addDay, buildPack, checkRecommendedCtc, dueReminders, isDay, isFinalOffer, offerTransition,
  type OfferAction, type OfferStatus, type PackDoc,
} from '../../shared/offerEngine.js';

type Result = { status: number; json: any };
const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const num = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isHr = (ctx: AuthContext) => ctx.isCompanyAdmin || MANAGE_PERMS.some((p) => ctx.perms.includes(p));
const isFounder = (ctx: AuthContext) => ctx.isCompanyAdmin || ctx.perms.includes('req.founder_decide');

// ------------------------------------------------------------------ small helpers

const baseUrl = (origin?: string) => (origin || process.env.APP_BASE_URL || '').replace(/\/$/, '');
const offerLink = (token: string, origin?: string) => `${baseUrl(origin)}/?offer=${token}`;

async function mail(to: string, name: string, subject: string, body: string, fromName?: string): Promise<boolean> {
  if (!EMAIL_RE.test(to || '')) return false;
  try {
    const r = await dispatchLiveEmail({ to, recipientName: name, subject, body, fromName });
    return !!r.success;
  } catch (e: any) {
    console.warn('[Offer] email failed:', e?.message || e);
    return false;
  }
}

async function companyInfo(cid: string): Promise<{ name: string; address: string }> {
  const ps = await db().collection('payrollSettings').doc(cid).get();
  const co = ((ps.data() as any) || {}).company || {};
  return { name: str(co.legalName, 120) || (await getCompanyName(cid)), address: str(co.address, 300) };
}

async function templatesFor(cid: string): Promise<Partial<Record<Exclude<PackDoc, 'compensation'>, string>>> {
  const out: Partial<Record<Exclude<PackDoc, 'compensation'>, string>> = {};
  for (const t of await listItems(cid, 'offerTpl')) out[t.docKey as Exclude<PackDoc, 'compensation'>] = String(t.body || '');
  return out;
}

const publicView = (o: Item): Item => ({ ...o, token: undefined });
const listView = (o: Item): Item => ({ ...o, token: undefined, pack: undefined });

/** One transaction per status change, so an HR click and the candidate's click at the same time cannot both win. */
async function moveOffer(
  cid: string, id: string, action: OfferAction, who: string, note: string, patch: (o: Item) => Partial<Item> | { error: string; status?: number },
): Promise<{ offer?: Item; error?: string; status?: number }> {
  const ref = db().collection('hiringItems').doc(id);
  return db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() as Item) : null;
    if (!cur || cur.companyId !== cid || cur.kind !== 'offer') return { error: 'Offer not found.', status: 404 };
    const t = offerTransition(cur.status as OfferStatus, action);
    if (t.ok === false) return { error: t.error, status: 409 };
    const p = patch(cur);
    if ('error' in p) return { error: (p as any).error, status: (p as any).status || 400 };
    const next: Item = { ...cur, ...(p as Partial<Item>), status: t.to, updatedAt: nowIso(), history: [...(cur.history || []), { at: nowIso(), by: who, action, from: cur.status, to: t.to, note: note.slice(0, 500) }].slice(-40) };
    tx.set(ref, clean(next));
    return { offer: next };
  });
}

async function activeOfferFor(cid: string, applicationId: string): Promise<Item | undefined> {
  return (await listItems(cid, 'offer')).find((o) => o.applicationId === applicationId && !isFinalOffer(o.status as OfferStatus));
}

// ------------------------------------------------------------------ list and get

async function offerList(cid: string, q: any): Promise<Result> {
  let items = await listItems(cid, 'offer');
  if (q.status) items = items.filter((o) => o.status === str(q.status, 30));
  if (q.requisitionId) items = items.filter((o) => o.requisitionId === str(q.requisitionId, 100));
  return ok({ items: items.map(listView).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) });
}

async function offerGet(cid: string, q: any): Promise<Result> {
  const o = await getItem(cid, str(q.id, 100), 'offer');
  return o ? ok({ item: publicView(o) }) : fail(404, 'Offer not found.');
}

// ------------------------------------------------------------------ create and act

async function offerCreate(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const a = await getApplication(cid, str(b.applicationId, 100));
  if (!a) return fail(404, 'Candidate not found.');
  if (!EMAIL_RE.test(a.email || '')) return fail(400, 'This candidate has no valid email address, so an offer cannot be sent.');
  if (await activeOfferFor(cid, a.id)) return fail(409, 'This candidate already has an offer in progress.');
  const req = a.requisitionId ? await getRequisition(cid, a.requisitionId) : null;
  const joining = str(b.joiningDate, 10);
  if (!isDay(joining) || joining < todayIst()) return fail(400, 'Choose a joining date that is today or later.');
  const probation = num(b.probationMonths) ?? 3;
  if (probation < 0 || probation > 12) return fail(400, 'Probation must be between 0 and 12 months.');
  const bandMax = req ? requisitionMaxCtcLpa(req as any) : null;
  const justification = str(b.justification, 1000);
  const chk = checkRecommendedCtc(b.recommendedCtcLpa, bandMax, justification);
  if (!chk.ok) return fail(400, chk.message, { needsReason: chk.needsReason });
  const who = await whoIs(ctx);
  const it: Item = {
    id: newId(), companyId: cid, kind: 'offer', applicationId: a.id, requisitionId: a.requisitionId || '', candidateName: a.name, email: a.email, mobile: a.mobile || '',
    designation: a.designation, department: str(req?.departmentName, 100), positionId: str(req?.positionId, 40), source: (a as any).source || '',
    recommendedCtcLpa: Number(b.recommendedCtcLpa), approvedCtcLpa: null, bandMaxLpa: bandMax, overBand: chk.overBand, justification,
    joiningDate: joining, probationMonths: probation, validDays: Math.min(30, Math.max(1, num(b.validDays) ?? 7)),
    status: 'DRAFT', createdAt: nowIso(), updatedAt: nowIso(), createdBy: who, createdByEmail: ctx.email, history: [{ at: nowIso(), by: who, action: 'create', from: '', to: 'DRAFT', note: '' }],
  };
  await putItem(it);
  return ok({ item: publicView(it) });
}

async function startOnboardingFor(cid: string, o: Item, hrName: string, hrEmail: string, origin?: string): Promise<Partial<Item>> {
  try {
    const r = await startOnboarding(cid, { applicationId: o.applicationId, onboardingDate: o.joiningDate, hrName, hrEmail }, origin);
    const j = r.json || {};
    if (r.status === 200 && j.onboardingId) {
      // Carry the approved offer over so HR sees salary, manager and place of work when setting up payroll and accounts.
      await db().collection('onboardings').doc(j.onboardingId).set({ offerId: o.id, ctcLpa: o.approvedCtcLpa, department: o.department, requisitionId: o.requisitionId, positionId: o.positionId }, { merge: true });
      return { onboardingId: j.onboardingId, employeeId: j.employeeId || '', onboardingError: '' };
    }
    if (r.status === 409 && j.onboardingId) return { onboardingId: j.onboardingId, onboardingError: '' };
    return { onboardingError: String(j.error || 'Onboarding could not be started.') };
  } catch (e: any) {
    return { onboardingError: String(e?.message || 'Onboarding could not be started.') };
  }
}

async function offerAct(ctx: AuthContext, b: any, origin?: string): Promise<Result> {
  const cid = ctx.companyId!;
  const id = str(b.id, 100);
  const action = str(b.action, 20) as OfferAction;
  const note = str(b.note ?? b.comments, 500);
  const who = await whoIs(ctx);
  const cur = await getItem(cid, id, 'offer');
  if (!cur) return fail(404, 'Offer not found.');
  const founderOnly = action === 'approve' || action === 'reject';
  if (founderOnly && !isFounder(ctx)) return fail(403, 'Only the founder can approve or reject an offer.');
  if (!founderOnly && !isHr(ctx)) return fail(403, 'You do not have permission to do this.');

  let res: { offer?: Item; error?: string; status?: number };
  let emailSent: boolean | undefined;
  let link = '';
  let probationNote = '';

  switch (action) {
    case 'submit': {
      const req = cur.requisitionId ? await getRequisition(cid, cur.requisitionId) : null;
      const chk = checkRecommendedCtc(cur.recommendedCtcLpa, req ? requisitionMaxCtcLpa(req as any) : null, str(cur.justification, 1000));
      if (!chk.ok) return fail(400, chk.message);
      res = await moveOffer(cid, id, 'submit', who, note, () => ({ overBand: chk.overBand, bandMaxLpa: chk.bandMaxLpa, founderDecision: null }));
      break;
    }
    case 'approve': {
      const counter = num(b.approvedCtcLpa);
      if (counter !== null && (counter <= 0 || counter > 1000)) return fail(400, 'Enter the approved CTC in lakhs per year.');
      const ctc = counter ?? Number(cur.recommendedCtcLpa);
      const co = await companyInfo(cid);
      const req = cur.requisitionId ? await getRequisition(cid, cur.requisitionId) : null;
      const built = buildPack({
        companyName: co.name, companyAddress: co.address, candidateName: cur.candidateName, designation: cur.designation, department: cur.department,
        managerName: str(req?.reportingManager?.name, 100), location: str(req?.location, 100), workMode: str(req?.workMode, 20) || 'Office', employmentType: str(req?.employmentType, 30) || 'Full-time',
        joinDate: cur.joiningDate, validTill: addDay(todayIst(), cur.validDays || 7), probationMonths: cur.probationMonths ?? 3, ctcLpa: ctc, signatoryName: who, signatoryTitle: 'Founder', today: todayIst(),
      }, await templatesFor(cid));
      res = await moveOffer(cid, id, 'approve', who, note, () => ({
        approvedCtcLpa: ctc, countered: ctc !== Number(cur.recommendedCtcLpa), pack: built.pack, packMissing: built.missing,
        founderDecision: { by: who, at: nowIso(), comments: note },
      }));
      break;
    }
    case 'reject':
      if (!note) return fail(400, 'Give the reason for rejecting, so HR knows what to change.');
      res = await moveOffer(cid, id, 'reject', who, note, () => ({ founderDecision: { by: who, at: nowIso(), comments: note, rejected: true } }));
      break;
    case 'send': {
      const missing = cur.packMissing as string[] | undefined;
      const packText = Object.values(cur.pack || {}).join('\n');
      const unresolved = [...new Set([...packText.matchAll(/\{\{([a-z0-9_]+)\}\}/gi)].map((m) => m[1]))];
      if (!cur.pack || unresolved.length) return fail(400, `Fill these fields in the documents first: ${(unresolved.length ? unresolved : missing || []).join(', ') || 'the pack is empty'}.`);
      const token = randomBytes(24).toString('hex');
      const validTill = addDay(todayIst(), cur.validDays || 7);
      res = await moveOffer(cid, id, 'send', who, note, () => ({ token, sentAt: nowIso(), validTill, remindersSent: [] }));
      if (res.offer) {
        link = offerLink(token, origin);
        const co = await companyInfo(cid);
        emailSent = await mail(cur.email, cur.candidateName, `Your offer from ${co.name}: ${cur.designation}`,
          [`Hello ${cur.candidateName},`, '', `We are delighted to offer you the position of ${cur.designation} at ${co.name}.`, '', 'Please open your offer, read the documents and let us know your answer here:', link || '(link will be sent separately)', '', `The offer is valid till ${validTill}.`, '', 'Best regards', who].join('\n'), co.name);
        await updateApplication(cid, cur.applicationId, { status: 'Selected' });
        if (!emailSent) await putItem({ ...res.offer, emailFailed: true });
      }
      break;
    }
    case 'accept':
    case 'decline':
    case 'negotiate':
      res = await applyResponse(cid, id, action, who, note, num(b.expectedCtcLpa), ctx.email, origin);
      break;
    case 'revise': {
      const req = cur.requisitionId ? await getRequisition(cid, cur.requisitionId) : null;
      const reason = str(b.justification, 1000) || str(cur.justification, 1000);
      const chk = checkRecommendedCtc(b.recommendedCtcLpa, req ? requisitionMaxCtcLpa(req as any) : null, reason);
      if (!chk.ok) return fail(400, chk.message, { needsReason: chk.needsReason });
      res = await moveOffer(cid, id, 'revise', who, note, () => ({
        recommendedCtcLpa: Number(b.recommendedCtcLpa), approvedCtcLpa: null, overBand: chk.overBand, justification: reason, pack: null, packMissing: [], token: null,
        negotiation: null, revisions: [...(cur.revisions || []), { at: nowIso(), by: who, fromCtc: cur.approvedCtcLpa ?? cur.recommendedCtcLpa }],
      }));
      break;
    }
    case 'join': {
      const when = str(b.joinedOn, 10) || todayIst();
      if (!isDay(when)) return fail(400, 'Enter a valid joining date.');
      res = await moveOffer(cid, id, 'join', who, note, () => ({ joinedOn: when }));
      // Best effort: if the person already has a login/employee record (same email), start their probation reviews now.
      if (!res.error && cur.probationMonths > 0) {
        try {
          const person = (await loadPeople(cid)).find((p: any) => String(p.email || '').toLowerCase() === String(cur.email || '').toLowerCase());
          if (person) {
            const pr = await startProbation(cid, person.uid, { joinDate: when, months: Number(cur.probationMonths), by: who });
            probationNote = pr.status === 200 ? 'Probation reviews started.' : pr.status === 409 ? '' : `Probation was not started: ${pr.json?.error || 'unknown reason'}`;
          } else probationNote = 'Create the employee record, then start probation from HR Business Partner > Probation.';
        } catch { probationNote = 'Start probation from HR Business Partner > Probation.'; }
      }
      break;
    }
    case 'withdraw':
      res = await moveOffer(cid, id, 'withdraw', who, note, () => ({ withdrawnReason: note }));
      break;
    default:
      return fail(400, 'Unknown action.');
  }
  if (res.error) return fail(res.status || 400, res.error);
  await flowAdvanceHook(cid, res.offer!.applicationId);
  return ok({ item: publicView(res.offer!), emailSent, link, probationNote });
}

/** The candidate's answer, whether given on their page or recorded by HR on their behalf. */
async function applyResponse(
  cid: string, id: string, action: 'accept' | 'decline' | 'negotiate', who: string, note: string, expectedCtc: number | null, hrEmail: string, origin?: string,
): Promise<{ offer?: Item; error?: string; status?: number }> {
  if (action === 'negotiate' && !note && expectedCtc === null) return { error: 'Say what you would like changed, or enter the CTC you expect.', status: 400 };
  const res = await moveOffer(cid, id, action, who, note, (o) => {
    if ((action === 'accept' || action === 'negotiate') && o.validTill && todayIst() > o.validTill) return { error: 'This offer has expired. Please contact HR.', status: 410 };
    return { respondedAt: nowIso(), responseNote: note, ...(action === 'negotiate' ? { negotiation: { at: nowIso(), note, expectedCtcLpa: expectedCtc } } : {}) };
  });
  if (!res.offer) return res;
  if (action === 'accept') {
    const patch = await startOnboardingFor(cid, res.offer, who, hrEmail, origin);
    await putItem({ ...res.offer, ...patch });
    res.offer = { ...res.offer, ...patch };
    await updateApplication(cid, res.offer.applicationId, { status: 'Selected' });
  }
  if (res.offer.createdByEmail) {
    const label = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'wants to negotiate';
    await mail(res.offer.createdByEmail, '', `${res.offer.candidateName} has ${label} the offer`, `${res.offer.candidateName} (${res.offer.designation}) has ${label} the offer.${note ? `\n\nNote: ${note}` : ''}${expectedCtc !== null ? `\nExpected CTC: ${expectedCtc} LPA` : ''}\n\nOpen the Offers tab in the HR portal to continue.`);
  }
  await flowAdvanceHook(cid, res.offer.applicationId);
  return res;
}

async function packSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const o = await getItem(cid, str(b.id, 100), 'offer');
  if (!o) return fail(404, 'Offer not found.');
  if (o.status !== 'APPROVED') return fail(409, 'The documents can only be edited after approval and before the offer is sent.');
  const pack = { ...(o.pack || {}) } as Record<string, string>;
  for (const k of ['offerLetter', 'compensation', 'checklist', 'nda', 'agreement']) {
    const v = b.docs?.[k];
    if (typeof v === 'string' && v.trim()) pack[k] = v.slice(0, 20000);
  }
  const unresolved = [...new Set([...Object.values(pack).join('\n').matchAll(/\{\{([a-z0-9_]+)\}\}/gi)].map((m) => m[1]))];
  await putItem({ ...o, pack, packMissing: unresolved, updatedAt: nowIso() });
  return ok({ missing: unresolved });
}

// ------------------------------------------------------------------ templates

async function tplList(cid: string): Promise<Result> {
  const mine = await templatesFor(cid);
  return ok({ items: Object.entries(DEFAULT_PACK_TEMPLATES).map(([docKey, dflt]) => ({ docKey, body: mine[docKey as keyof typeof mine] || dflt, custom: !!mine[docKey as keyof typeof mine] })) });
}

async function tplSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const docKey = str(b.docKey, 30);
  if (!(docKey in DEFAULT_PACK_TEMPLATES)) return fail(400, 'Unknown document.');
  const body = typeof b.body === 'string' ? b.body.slice(0, 20000) : '';
  const existing = (await listItems(cid, 'offerTpl')).find((t) => t.docKey === docKey);
  if (!body.trim()) {
    if (existing) await db().collection('hiringItems').doc(existing.id).delete();
    return ok({ reset: true });
  }
  await putItem({ id: existing?.id || newId(), companyId: cid, kind: 'offerTpl', docKey, body, updatedAt: nowIso(), updatedBy: await whoIs(ctx) });
  return ok({});
}

// ------------------------------------------------------------------ hiring costs

async function costList(cid: string, q: any): Promise<Result> {
  let items = await listItems(cid, 'hcost');
  if (q.requisitionId) items = items.filter((c) => c.requisitionId === str(q.requisitionId, 100));
  return ok({ items: items.sort((a, b) => String(b.date).localeCompare(String(a.date))), categories: COST_CATEGORIES });
}

async function costSave(ctx: AuthContext, b: any): Promise<Result> {
  const cid = ctx.companyId!;
  const amount = num(b.amount);
  if (amount === null || amount <= 0 || amount > 100_000_000) return fail(400, 'Enter the amount in rupees.');
  const category = str(b.category, 30);
  if (!(COST_CATEGORIES as readonly string[]).includes(category)) return fail(400, 'Choose a cost type.');
  const date = str(b.date, 10) || todayIst();
  if (!isDay(date)) return fail(400, 'Enter a valid date.');
  const requisitionId = str(b.requisitionId, 100);
  if (requisitionId && !(await getRequisition(cid, requisitionId))) return fail(404, 'Job not found.');
  const prior = b.id ? await getItem(cid, str(b.id, 100), 'hcost') : null;
  if (b.id && !prior) return fail(404, 'Cost entry not found.');
  const it: Item = { id: prior?.id || newId(), companyId: cid, kind: 'hcost', requisitionId, category, amount, date, note: str(b.note, 300), by: await whoIs(ctx), updatedAt: nowIso() };
  await putItem(it);
  return ok({ item: it });
}

async function costDelete(cid: string, b: any): Promise<Result> {
  const it = await getItem(cid, str(b.id, 100), 'hcost');
  if (!it) return fail(404, 'Cost entry not found.');
  await db().collection('hiringItems').doc(it.id).delete();
  return ok({});
}

// ------------------------------------------------------------------ the candidate's page (no sign-in)

async function offerByToken(token: string): Promise<Item | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const s = await db().collection('hiringItems').where('token', '==', token).get();
  const d = s.docs.map((x: any) => x.data() as Item).find((x: Item) => x.kind === 'offer');
  return d || null;
}

async function publicGet(token: string, ip: string): Promise<Result> {
  if (rateLimited(`offer-get:${ip}`, 40)) return fail(429, 'Too many requests. Please try again in a minute.');
  const o = await offerByToken(token);
  if (!o || !o.pack) return fail(404, 'This link is not valid.');
  const co = await companyInfo(o.companyId);
  const expired = !!o.validTill && todayIst() > o.validTill && ['SENT', 'NEGOTIATION'].includes(o.status);
  return ok({
    companyName: co.name, candidateName: o.candidateName, designation: o.designation, joiningDate: o.joiningDate, validTill: o.validTill, status: expired ? 'EXPIRED' : o.status,
    ctcLpa: o.approvedCtcLpa, pack: o.pack, canRespond: !expired && o.status === 'SENT', responseNote: o.responseNote || '',
  });
}

async function publicRespond(b: any, ip: string, origin?: string): Promise<Result> {
  if (rateLimited(`offer-resp:${ip}`, 10)) return fail(429, 'Too many requests. Please try again in a minute.');
  const o = await offerByToken(str(b.token, 80));
  if (!o) return fail(404, 'This link is not valid.');
  const response = str(b.response, 12).toUpperCase();
  const action = response === 'ACCEPT' ? 'accept' : response === 'DECLINE' ? 'decline' : response === 'NEGOTIATE' ? 'negotiate' : '';
  if (!action) return fail(400, 'Choose accept, decline or negotiate.');
  if (action === 'accept' && b.confirm !== true) return fail(400, 'Please tick the box to confirm you accept the offer and its documents.');
  const res = await applyResponse(o.companyId, o.id, action, `${o.candidateName} (candidate)`, str(b.note, 1000), num(b.expectedCtcLpa), o.createdByEmail || '', origin);
  if (res.error) return fail(res.status || 400, res.error);
  return ok({ status: res.offer!.status });
}

// ------------------------------------------------------------------ daily sweep

/** Reminders and automatic closing for every company's open offers. Safe to run more than once a day: each reminder is sent once. */
export async function sweepOffers(): Promise<{ checked: number; reminded: number; closed: number }> {
  const snap = await db().collection('hiringItems').where('kind', '==', 'offer').get();
  const today = todayIst();
  let checked = 0, reminded = 0, closed = 0;
  for (const d of snap.docs) {
    const o = d.data() as Item;
    if (isFinalOffer(o.status as OfferStatus) || !['SENT', 'NEGOTIATION', 'ACCEPTED'].includes(o.status)) continue;
    checked++;
    const due = dueReminders(o as any, today);
    if (!due.length) continue;
    const sent = [...(o.remindersSent || [])];
    const co = await companyInfo(o.companyId);
    for (const r of due) {
      if (r.type === 'expire' || r.type === 'ghost') {
        const res = await moveOffer(o.companyId, o.id, r.type, 'System', r.type === 'ghost' ? 'No response from the candidate' : 'Offer date passed', () => ({}));
        if (res.offer) {
          closed++;
          if (o.createdByEmail) await mail(o.createdByEmail, '', `${o.candidateName}: offer ${r.type === 'ghost' ? 'marked as no response' : 'expired'}`, `${o.candidateName} (${o.designation}) did not answer the offer in time. It is now marked "${r.type === 'ghost' ? 'No response (ghosted)' : 'Expired'}". You can raise a fresh offer from the Offers tab.`);
        }
      } else if (r.type === 'respond') {
        if (await mail(o.email, o.candidateName, `Reminder: your offer from ${co.name}`, `Hello ${o.candidateName},\n\nThis is a reminder that your offer for ${o.designation} is waiting for your answer. It is valid till ${o.validTill}.\n\nOpen it here: ${offerLink(o.token || '')}\n`, co.name)) reminded++;
      } else if (r.type === 'joining_7' || r.type === 'joining_1') {
        const kit = r.type === 'joining_1' ? await welcomeKitFor(o.companyId) : null;
        const tail = r.type === 'joining_7'
          ? '\n\nPlease make sure your joining documents are uploaded and reply to us if anything has changed.'
          : `\n\nWe look forward to welcoming you tomorrow.\n\n${kit!.message}\n\nOn your first day we will have ready:\n${kit!.items.map((i) => `- ${i}`).join('\n')}`;
        if (await mail(o.email, o.candidateName, `${r.type === 'joining_7' ? 'One week to go' : 'See you tomorrow'}: joining ${co.name}`, `Hello ${o.candidateName},\n\nYour joining date at ${co.name} is ${o.joiningDate}.${tail}\n`, co.name)) reminded++;
      } else if (r.type === 'joining_overdue') {
        if (o.createdByEmail && await mail(o.createdByEmail, '', `Did ${o.candidateName} join?`, `${o.candidateName}'s joining date (${o.joiningDate}) has passed and the offer is still "Accepted". Open the Offers tab and mark them as joined, or withdraw the offer if they did not join.`)) reminded++;
      }
      sent.push(r.key);
    }
    const latest = await getItem(o.companyId, o.id, 'offer');
    if (latest) await putItem({ ...latest, remindersSent: sent.slice(-60) });
  }
  return { checked, reminded, closed };
}

// ------------------------------------------------------------------ routing

type Who = 'hr' | 'any-hr-or-founder' | 'public';
const ACTIONS: Record<string, { method: 'GET' | 'POST'; who: Who }> = {
  'offer-list': { method: 'GET', who: 'any-hr-or-founder' },
  'offer-get': { method: 'GET', who: 'any-hr-or-founder' },
  'offer-create': { method: 'POST', who: 'hr' },
  'offer-act': { method: 'POST', who: 'any-hr-or-founder' },
  'offer-pack-save': { method: 'POST', who: 'hr' },
  'offer-tpl-list': { method: 'GET', who: 'hr' },
  'offer-tpl-save': { method: 'POST', who: 'hr' },
  'hcost-list': { method: 'GET', who: 'hr' },
  'hcost-save': { method: 'POST', who: 'hr' },
  'hcost-delete': { method: 'POST', who: 'hr' },
  'offer-public-get': { method: 'GET', who: 'public' },
  'offer-public-respond': { method: 'POST', who: 'public' },
};

export async function routeOffer(r: PipeRequest & { ip?: string }): Promise<Result | null> {
  const spec = ACTIONS[r.action];
  if (!spec) return null;
  try {
    if (r.method !== spec.method) return fail(405, 'Method not allowed.');
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    if (spec.who === 'public') {
      const ip = str(r.ip || (r.headers?.['x-forwarded-for'] as string) || 'unknown', 80).split(',')[0].trim();
      return r.action === 'offer-public-get' ? await publicGet(str(r.query.token, 80), ip) : await publicRespond(b, ip, r.origin);
    }
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (spec.who === 'hr' && !isHr(ctx)) return fail(403, 'You do not have permission to do this.');
    if (spec.who === 'any-hr-or-founder' && !isHr(ctx) && !isFounder(ctx)) return fail(403, 'You do not have permission to do this.');
    const cid = ctx.companyId;
    switch (r.action) {
      case 'offer-list': return await offerList(cid, r.query);
      case 'offer-get': return await offerGet(cid, r.query);
      case 'offer-create': return await offerCreate(ctx, b);
      case 'offer-act': return await offerAct(ctx, b, r.origin);
      case 'offer-pack-save': return await packSave(ctx, b);
      case 'offer-tpl-list': return await tplList(cid);
      case 'offer-tpl-save': return await tplSave(ctx, b);
      case 'hcost-list': return await costList(cid, r.query);
      case 'hcost-save': return await costSave(ctx, b);
      default: return await costDelete(cid, b);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Offer] error:', err);
    return fail(500, err?.message || 'Offer request failed.');
  }
}
