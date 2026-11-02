/**
 * Probation, OKRs, promotions and the quarterly review round, reached as /api/hrbp/<action> (routeHrbp hands these over).
 *
 *   prob-list / prob-start / prob-feedback / prob-decide   30/60/90-day reviews, manager feedback, confirm / extend / end
 *   okr-list / okr-save / okr-update / okr-close / okr-delete   objectives and key results per quarter (company, team or individual)
 *   promo-list / promo-propose / promo-act                 promotion proposal -> HR recommends -> founder decides -> applied
 *   qc-list / qc-open / qc-tick / qc-view                  the quarterly review round: checklist plus live numbers
 *   sweepTalentCycle                                       daily: probation and quarterly reminders
 *
 * Records live in hrbpItems (kind prob / okr / promo / qc) and carry a companyId. A manager may act only on their own reports
 * (the reporting line on the leave profile); HR (hrbp.manage, perf.manage or lifecycle.manage) on everyone; the founder
 * (req.founder_decide) approves promotions.
 */
import { adminDb } from './firebaseAdmin.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { loadPeople, loadProfiles, notify, type Person } from './leaveCore.js';
import { PIP_FINAL } from '../../shared/hrbpEngine.js';
import {
  QUARTER_STEPS, addDays, addMonths, cleanKeyResults, diffDays, elapsedFraction, isDay, isQuarter, objectiveProgress, okrStatus, probationMilestones,
  probationReminders, promoTransition, quarterBounds, quarterDueDate, quarterOf, validateFeedback, krProgress, type KeyResult, type Milestone, type PromoAction, type PromoStatus,
} from '../../shared/talentCycle.js';

type Result = { status: number; json: any };
interface Item { id: string; companyId: string; kind: string; [k: string]: any }
export interface CycleRequest { method: string; action: string; query: Record<string, any>; body?: any; headers: Record<string, any> }

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max));
const num = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const ok = (extra: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...extra } });
const fail = (status: number, error: string, extra: Record<string, any> = {}): Result => ({ status, json: { success: false, error, ...extra } });
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const isHr = (ctx: AuthContext) => ctx.isCompanyAdmin || ['hrbp.manage', 'perf.manage', 'lifecycle.manage'].some((p) => ctx.perms.includes(p));
const isFounder = (ctx: AuthContext) => ctx.isCompanyAdmin || ctx.perms.includes('req.founder_decide');

// ------------------------------------------------------------------ storage and people

async function listK(cid: string, kind: string): Promise<Item[]> {
  const s = await db().collection('hrbpItems').where('companyId', '==', cid).where('kind', '==', kind).get();
  return s.docs.map((d: any) => d.data() as Item);
}
async function getK(cid: string, id: string, kind: string): Promise<Item | null> {
  if (!id) return null;
  const s = await db().collection('hrbpItems').doc(id).get();
  const it = s.exists ? (s.data() as Item) : null;
  return it && it.companyId === cid && it.kind === kind ? it : null;
}
const putK = (it: Item) => db().collection('hrbpItems').doc(it.id).set(clean(it));
const newId = () => db().collection('hrbpItems').doc().id;

interface Ctx { ctx: AuthContext; cid: string; people: Person[]; byUid: Map<string, Person>; managerOf: (uid: string) => string; me: Person | undefined; who: string }
async function load(ctx: AuthContext): Promise<Ctx> {
  const cid = ctx.companyId!;
  const [people, profiles] = await Promise.all([loadPeople(cid), loadProfiles(cid)]);
  const byUid = new Map<string, Person>();
  for (const p of people) { byUid.set(p.uid, p); byUid.set(p.docId, p); }
  const me = byUid.get(ctx.uid);
  return { ctx, cid, people, byUid, managerOf: (uid) => profiles.get(byUid.get(uid)?.uid || uid)?.managerUid || '', me, who: me?.name || ctx.email };
}
const activePerson = (c: Ctx, id: unknown): Person | null => { const p = c.byUid.get(str(id, 128)); return p && p.active ? p : null; };
const myUid = (c: Ctx) => c.me?.uid || c.ctx.uid;
/** Is the signed-in person this employee's reporting manager? */
const isManagerOf = (c: Ctx, uid: string) => !!c.managerOf(uid) && c.managerOf(uid) === myUid(c);

async function mailTo(c: { cid: string }, people: (Person | undefined)[], subject: string, body: string) {
  await notify(c.cid, people.filter(Boolean).map((p) => p!.email), subject, body);
}

// ------------------------------------------------------------------ probation

const PROB_ACTIVE = ['ACTIVE'];

async function probList(c: Ctx, q: any): Promise<Result> {
  let items = await listK(c.cid, 'prob');
  const hr = isHr(c.ctx);
  if (!hr) items = items.filter((p) => p.uid === myUid(c) || p.managerUid === myUid(c));
  if (q.status) items = items.filter((p) => p.status === str(q.status, 20));
  const t = today();
  const rows = items.map((p): Item => {
    const own = p.uid === myUid(c) && !hr && p.managerUid !== myUid(c);
    // The employee sees the dates and the final decision, not what the manager wrote about them.
    const milestones: Partial<Milestone>[] = (p.milestones as Milestone[]).map((m): Partial<Milestone> => (own ? { key: m.key, label: m.label, dueOn: m.dueOn, status: m.status, final: m.final } : m));
    const nextDue = (p.milestones as Milestone[]).find((m) => m.status === 'PENDING');
    return { ...p, milestones, remindersSent: undefined, decisionNote: own ? undefined : p.decisionNote, daysLeft: diffDays(t, String(p.endDate)), nextDue: nextDue ? { label: nextDue.label, dueOn: nextDue.dueOn, overdue: nextDue.dueOn < t } : null };
  });
  return ok({ items: rows.sort((a, b) => String(a.endDate).localeCompare(String(b.endDate))), today: t, canManage: hr });
}

export async function startProbation(cid: string, uid: string, opts: { joinDate?: string; months?: number; by?: string; managerUid?: string }): Promise<Result> {
  const people = await loadPeople(cid);
  const person = people.find((p) => p.uid === uid || p.docId === uid);
  if (!person || !person.active) return fail(404, 'Employee not found.');
  const all = await listK(cid, 'prob');
  if (all.some((p) => p.uid === person.uid && PROB_ACTIVE.includes(p.status))) return fail(409, `${person.name} already has a probation running.`);
  const profiles = await loadProfiles(cid);
  const join = opts.joinDate || profiles.get(person.uid)?.joinDate || person.createdDate;
  if (!isDay(join)) return fail(400, 'Enter a valid joining date.');
  const months = opts.months ?? 3;
  if (!Number.isInteger(months) || months < 1 || months > 12) return fail(400, 'Probation must be 1 to 12 months.');
  const managerUid = opts.managerUid || profiles.get(person.uid)?.managerUid || '';
  const { endDate, milestones } = probationMilestones(join, months);
  const it: Item = {
    id: newId(), companyId: cid, kind: 'prob', uid: person.uid, name: person.name, department: person.department, title: person.title, managerUid, managerName: people.find((p) => p.uid === managerUid)?.name || '',
    joinDate: join, months, endDate, milestones, status: 'ACTIVE', remindersSent: [], createdAt: nowIso(), createdBy: opts.by || 'System',
  };
  await putK(it);
  const mgr = people.find((p) => p.uid === managerUid);
  if (mgr) await notify(cid, [mgr.email], `Probation reviews for ${person.name}`, `${person.name} is on probation until ${endDate}. Please submit your review of them at: ${milestones.map((m) => `${m.label} (due ${m.dueOn})`).join(', ')}.\n\nOpen HR Business Partner > Probation to write each review.`);
  return ok({ item: it });
}

async function probStart(c: Ctx, b: any): Promise<Result> {
  const p = activePerson(c, b.uid);
  if (!p) return fail(404, 'Employee not found.');
  const mgr = b.managerUid ? activePerson(c, b.managerUid) : null;
  if (b.managerUid && !mgr) return fail(404, 'Manager not found.');
  return startProbation(c.cid, p.uid, { joinDate: str(b.joinDate, 10) || undefined, months: b.months === undefined || b.months === '' ? undefined : Number(b.months), by: c.who, managerUid: mgr?.uid });
}

async function probFeedback(c: Ctx, b: any): Promise<Result> {
  const p = await getK(c.cid, str(b.id, 100), 'prob');
  if (!p) return fail(404, 'Probation record not found.');
  if (!isHr(c.ctx) && !isManagerOf(c, p.uid) && p.managerUid !== myUid(c)) return fail(403, 'Only the reporting manager or HR can write this review.');
  if (p.status !== 'ACTIVE') return fail(409, 'This probation has already been decided.');
  const err = validateFeedback(b);
  if (err) return fail(400, err);
  const ms = (p.milestones as Milestone[]).map((m) => (m.key === str(b.key, 20)
    ? { ...m, status: 'SUBMITTED' as const, rating: Number(b.rating), kpiPct: num(b.kpiPct), recommendation: b.recommendation, strengths: str(b.strengths, 1000), improvements: str(b.improvements, 1000), by: c.who, at: nowIso() }
    : m));
  if (!ms.some((m) => m.key === str(b.key, 20))) return fail(404, 'That review does not exist.');
  await putK({ ...p, milestones: ms, updatedAt: nowIso() });
  return ok({ item: { ...p, milestones: ms } });
}

async function probDecide(c: Ctx, b: any): Promise<Result> {
  if (!isHr(c.ctx)) return fail(403, 'Only HR can decide a probation.');
  const decision = str(b.decision, 12);
  if (!['CONFIRM', 'EXTEND', 'TERMINATE'].includes(decision)) return fail(400, 'Choose confirm, extend or end probation.');
  const note = str(b.note, 1000);
  if (decision !== 'CONFIRM' && !note) return fail(400, 'Write the reason, so it is on record.');
  const months = decision === 'EXTEND' ? num(b.extendMonths) : null;
  if (decision === 'EXTEND' && (months === null || !Number.isInteger(months) || months < 1 || months > 6)) return fail(400, 'Extend by 1 to 6 months.');
  const ref = db().collection('hrbpItems').doc(str(b.id, 100));
  const res = await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const p = snap.exists ? (snap.data() as Item) : null;
    if (!p || p.companyId !== c.cid || p.kind !== 'prob') return { status: 404 as const, error: 'Probation record not found.' };
    if (p.status !== 'ACTIVE') return { status: 409 as const, error: 'This probation has already been decided.' };
    const submitted = (p.milestones as Milestone[]).filter((m) => m.status === 'SUBMITTED');
    if (decision === 'CONFIRM' && !submitted.length && !b.override) return { status: 400 as const, error: 'No manager review has been submitted yet. Ask the manager first, or confirm with "override" and a reason in the note.' };
    if (decision === 'CONFIRM' && submitted[submitted.length - 1]?.recommendation === 'CONCERN' && !b.override) return { status: 400 as const, error: 'The latest review raised serious concerns. Read it first; confirm with "override" and a reason in the note if you still want to confirm.' };
    if (b.override && !note) return { status: 400 as const, error: 'Write the reason for overriding.' };
    const base = { ...p, decidedAt: nowIso(), decidedBy: c.who, decisionNote: note, decision };
    let next: Item;
    if (decision === 'EXTEND') {
      const newEnd = addMonths(p.endDate, months!);
      const ext: Milestone = { key: `ext${(p.extensions || []).length + 1}`, label: 'Extension review', dueOn: addDays(newEnd, -7), status: 'PENDING', final: true };
      const ms: Milestone[] = (p.milestones as Milestone[]).map((m): Milestone => ({ ...m, final: false })).concat([ext]);
      next = { ...base, status: 'ACTIVE', decision: undefined, decidedAt: undefined, endDate: newEnd, months: p.months + months!, milestones: ms, extensions: [...(p.extensions || []), { at: nowIso(), by: c.who, months, note }], remindersSent: [] };
    } else {
      next = { ...base, status: decision === 'CONFIRM' ? 'CONFIRMED' : 'ENDED' };
    }
    tx.set(ref, clean(next));
    return { item: next };
  });
  if ('error' in res) return fail(res.status, res.error);
  const p = res.item;
  const person = c.byUid.get(p.uid);
  if (decision === 'CONFIRM') {
    // Keep the HR Business Partner mapping in step, when the person has one.
    for (const m of (await listK(c.cid, 'map')).filter((x) => x.employeeUid === p.uid)) await putK({ ...m, employmentStatus: 'CONFIRMED', updatedAt: nowIso() });
    await mailTo(c, [person], 'Your probation is confirmed', `Dear ${p.name},\n\nWe are pleased to confirm that you have successfully completed your probation. Thank you for your work so far.${note ? `\n\n${note}` : ''}\n\nHR will share your confirmation letter.`);
  } else if (decision === 'EXTEND') {
    await mailTo(c, [person, c.byUid.get(p.managerUid)], `Probation extended: ${p.name}`, `${p.name}'s probation has been extended to ${p.endDate}.\n\nReason: ${note}\n\nA further review is due on ${(p.milestones as Milestone[]).slice(-1)[0].dueOn}.`);
  }
  return ok({ item: p, next: decision === 'TERMINATE' ? 'Start the exit from People > Separations when you are ready.' : decision === 'CONFIRM' ? 'Issue the confirmation letter from People > Letters.' : '' });
}

export async function sweepProbation(): Promise<{ checked: number; reminded: number }> {
  const snap = await db().collection('hrbpItems').where('kind', '==', 'prob').get();
  const t = today();
  let checked = 0, reminded = 0;
  const peopleCache = new Map<string, Person[]>();
  for (const d of snap.docs) {
    const p = d.data() as Item;
    if (p.status !== 'ACTIVE') continue;
    checked++;
    const due = probationReminders(p.milestones as Milestone[], t, p.remindersSent || []);
    if (!due.length) continue;
    if (!peopleCache.has(p.companyId)) peopleCache.set(p.companyId, await loadPeople(p.companyId));
    const people = peopleCache.get(p.companyId)!;
    const mgr = people.find((x) => x.uid === p.managerUid);
    for (const r of due) {
      const verb = r.type === 'late' ? `is overdue (was due ${r.milestone.dueOn})` : r.type === 'due' ? 'is due today' : `is due on ${r.milestone.dueOn}`;
      await notify(p.companyId, mgr ? [mgr.email] : [], `${r.type === 'late' ? 'Overdue: ' : 'Reminder: '}${r.milestone.label} for ${p.name}`, `The ${r.milestone.label} for ${p.name} ${verb}.\n\nOpen HR Business Partner > Probation to submit your review.`);
      if (mgr) reminded++;
    }
    await putK({ ...p, remindersSent: [...(p.remindersSent || []), ...due.map((r) => r.key)].slice(-80) });
  }
  return { checked, reminded };
}

// ------------------------------------------------------------------ OKRs

const LEVELS = ['COMPANY', 'TEAM', 'INDIVIDUAL'] as const;
const decorate = (o: Item, t: string): Item & { progress: number; status: string } => {
  const krs = o.keyResults as KeyResult[];
  const progress = objectiveProgress(krs);
  const status = okrStatus(progress, elapsedFraction(o.quarter, t));
  return { ...o, progress: Math.round(progress * 100), status: o.state === 'CLOSED' ? o.finalStatus || status : status, keyResults: krs.map((k) => ({ ...k, progress: Math.round(krProgress(k) * 100) })) };
};

async function okrList(c: Ctx, q: any): Promise<Result> {
  const quarter = isQuarter(q.quarter) ? q.quarter : quarterOf(today());
  let items = (await listK(c.cid, 'okr')).filter((o) => o.quarter === quarter);
  const hr = isHr(c.ctx) || c.ctx.perms.includes('hrbp.view');
  if (!hr) items = items.filter((o) => o.level === 'COMPANY' || o.ownerUid === myUid(c) || o.managerUid === myUid(c));
  if (q.uid) items = items.filter((o) => o.ownerUid === str(q.uid, 128));
  const t = today();
  return ok({ quarter, today: t, items: items.map((o) => decorate(o, t)).sort((a, b) => a.level.localeCompare(b.level) || String(a.ownerName).localeCompare(String(b.ownerName))) });
}

async function okrSave(c: Ctx, b: any): Promise<Result> {
  const prior = b.id ? await getK(c.cid, str(b.id, 100), 'okr') : null;
  if (b.id && !prior) return fail(404, 'Objective not found.');
  const level = prior?.level || (LEVELS as readonly string[]).includes(str(b.level, 12)) ? (prior?.level || str(b.level, 12)) : 'INDIVIDUAL';
  const hr = isHr(c.ctx);
  if (level !== 'INDIVIDUAL' && !hr) return fail(403, 'Only HR can set company and team objectives.');
  let owner: Person | null = null;
  if (level === 'INDIVIDUAL') {
    owner = prior ? c.byUid.get(prior.ownerUid) || null : activePerson(c, b.ownerUid || myUid(c));
    if (!owner) return fail(404, 'Employee not found.');
    if (!hr && owner.uid !== myUid(c) && !isManagerOf(c, owner.uid)) return fail(403, 'You can set objectives for yourself and your own team.');
  }
  if (prior && !hr && prior.ownerUid !== myUid(c) && prior.managerUid !== myUid(c)) return fail(403, 'You cannot change this objective.');
  if (prior?.state === 'CLOSED') return fail(409, 'This objective is closed.');
  const quarter = prior?.quarter || str(b.quarter, 7) || quarterOf(today());
  if (!isQuarter(quarter)) return fail(400, 'Choose a quarter like 2026-Q4.');
  const title = str(b.title, 160);
  if (!title) return fail(400, 'Give the objective a title.');
  const krs = cleanKeyResults(b.keyResults, (prior?.keyResults as KeyResult[]) || []);
  if (!krs.krs) return fail(400, krs.error!);
  let parentId = str(b.parentId, 100);
  if (parentId) {
    const parent = await getK(c.cid, parentId, 'okr');
    if (!parent || parent.level !== 'COMPANY' || parent.quarter !== quarter) parentId = '';
  }
  const it: Item = {
    ...(prior || {}), id: prior?.id || newId(), companyId: c.cid, kind: 'okr', level, quarter, title, description: str(b.description, 500), keyResults: krs.krs, parentId,
    ownerUid: owner?.uid || '', ownerName: owner?.name || (level === 'COMPANY' ? 'Company' : str(b.teamName, 80) || 'Team'), ownerDept: owner?.department || str(b.teamName, 80),
    managerUid: owner ? c.managerOf(owner.uid) : '', state: prior?.state || 'ACTIVE', updates: prior?.updates || [], createdBy: prior?.createdBy || c.who, updatedAt: nowIso(),
  };
  await putK(it);
  return ok({ item: decorate(it, today()) });
}

async function okrUpdate(c: Ctx, b: any): Promise<Result> {
  const o = await getK(c.cid, str(b.id, 100), 'okr');
  if (!o) return fail(404, 'Objective not found.');
  if (!isHr(c.ctx) && o.ownerUid !== myUid(c) && o.managerUid !== myUid(c)) return fail(403, 'You cannot update this objective.');
  if (o.state === 'CLOSED') return fail(409, 'This objective is closed.');
  const krs = o.keyResults as KeyResult[];
  const kr = krs.find((k) => k.id === str(b.krId, 40));
  if (!kr) return fail(404, 'Key result not found.');
  const current = num(b.current);
  if (current === null) return fail(400, 'Enter the current value as a number.');
  const next = krs.map((k) => (k.id === kr.id ? { ...k, current } : k));
  await putK({ ...o, keyResults: next, updates: [...(o.updates || []), { at: nowIso(), by: c.who, krId: kr.id, from: kr.current, to: current, note: str(b.note, 300) }].slice(-60), updatedAt: nowIso() });
  return ok({ item: decorate({ ...o, keyResults: next }, today()) });
}

async function okrClose(c: Ctx, b: any): Promise<Result> {
  const o = await getK(c.cid, str(b.id, 100), 'okr');
  if (!o) return fail(404, 'Objective not found.');
  if (!isHr(c.ctx) && o.ownerUid !== myUid(c) && o.managerUid !== myUid(c)) return fail(403, 'You cannot close this objective.');
  if (o.state === 'CLOSED') return fail(409, 'This objective is already closed.');
  const d = decorate(o, today());
  const next = { ...o, state: 'CLOSED', finalProgress: d.progress, finalStatus: d.progress >= 100 ? 'DONE' : d.progress >= 70 ? 'ON_TRACK' : d.progress >= 40 ? 'AT_RISK' : 'OFF_TRACK', closedAt: nowIso(), closedBy: c.who, reflection: str(b.reflection, 1000) };
  await putK(next);
  return ok({ item: decorate(next, today()) });
}

async function okrDelete(c: Ctx, b: any): Promise<Result> {
  const o = await getK(c.cid, str(b.id, 100), 'okr');
  if (!o) return fail(404, 'Objective not found.');
  if (!isHr(c.ctx) && !(o.ownerUid === myUid(c) && (o.updates || []).length === 0)) return fail(403, 'You can delete your own objective only before you have recorded progress.');
  await db().collection('hrbpItems').doc(o.id).delete();
  return ok({});
}

// ------------------------------------------------------------------ promotions

async function promoList(c: Ctx): Promise<Result> {
  let items = await listK(c.cid, 'promo');
  const hr = isHr(c.ctx) || isFounder(c.ctx);
  if (!hr) items = items.filter((p) => p.proposedByUid === myUid(c));
  return ok({ items: items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), canRecommend: isHr(c.ctx), canDecide: isFounder(c.ctx) });
}

async function promoPropose(c: Ctx, b: any): Promise<Result> {
  const p = activePerson(c, b.uid);
  if (!p) return fail(404, 'Employee not found.');
  if (p.uid === myUid(c)) return fail(400, 'You cannot propose your own promotion.');
  if (!isHr(c.ctx) && !isManagerOf(c, p.uid)) return fail(403, 'You can propose a promotion for your own reports.');
  const toTitle = str(b.toTitle, 80);
  const justification = str(b.justification, 2000);
  if (!toTitle) return fail(400, 'Enter the new designation.');
  if (justification.length < 30) return fail(400, 'Explain why, in at least a couple of sentences.');
  const eff = str(b.effectiveDate, 10);
  if (!isDay(eff)) return fail(400, 'Choose the effective date.');
  const ctc = b.newCtcLpa === '' || b.newCtcLpa === undefined || b.newCtcLpa === null ? null : num(b.newCtcLpa);
  if (b.newCtcLpa !== '' && b.newCtcLpa !== undefined && b.newCtcLpa !== null && (ctc === null || ctc <= 0 || ctc > 1000)) return fail(400, 'Enter the new CTC in lakhs per year, or leave it empty.');
  if ((await listK(c.cid, 'promo')).some((x) => x.uid === p.uid && ['PROPOSED', 'HR_RECOMMENDED', 'APPROVED'].includes(x.status))) return fail(409, `${p.name} already has a promotion in progress.`);
  const it: Item = {
    id: newId(), companyId: c.cid, kind: 'promo', uid: p.uid, name: p.name, department: p.department, fromTitle: p.title, toTitle, newCtcLpa: ctc, effectiveDate: eff, justification, evidence: str(b.evidence, 500),
    status: 'PROPOSED', proposedBy: c.who, proposedByUid: myUid(c), createdAt: nowIso(), updatedAt: nowIso(), history: [{ at: nowIso(), by: c.who, action: 'propose', to: 'PROPOSED', note: '' }],
  };
  await putK(it);
  return ok({ item: it });
}

async function promoAct(c: Ctx, b: any): Promise<Result> {
  const action = str(b.action, 12) as PromoAction;
  const note = str(b.note, 500);
  const id = str(b.id, 100);
  const cur = await getK(c.cid, id, 'promo');
  if (!cur) return fail(404, 'Promotion not found.');
  const needsFounder = action === 'approve' || (action === 'reject' && cur.status === 'HR_RECOMMENDED');
  if (needsFounder && !isFounder(c.ctx)) return fail(403, 'Only the founder decides at this step.');
  if (!needsFounder && action !== 'withdraw' && !isHr(c.ctx)) return fail(403, 'Only HR can do this step.');
  if (action === 'withdraw' && !isHr(c.ctx) && cur.proposedByUid !== myUid(c)) return fail(403, 'Only the proposer or HR can withdraw this.');
  if (action === 'reject' && !note) return fail(400, 'Give the reason for rejecting.');
  const ref = db().collection('hrbpItems').doc(id);
  const res = await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const p = snap.exists ? (snap.data() as Item) : null;
    if (!p) return { error: 'Promotion not found.', status: 404 };
    const t = promoTransition(p.status as PromoStatus, action);
    if (t.ok === false) return { error: t.error, status: 409 };
    const next: Item = { ...p, status: t.to, updatedAt: nowIso(), history: [...(p.history || []), { at: nowIso(), by: c.who, action, from: p.status, to: t.to, note }].slice(-30) };
    if (action === 'apply') { next.appliedAt = nowIso(); next.salaryRevisionNeeded = p.newCtcLpa !== null; }
    tx.set(ref, clean(next));
    return { item: next };
  });
  if ('error' in res) return fail((res as any).status, (res as any).error);
  const p = res.item as Item;
  if (action === 'apply') {
    const person = c.byUid.get(p.uid);
    if (person) await db().collection('employees').doc(person.docId).update({ title: p.toTitle });
    await mailTo(c, [person], `Congratulations on your promotion`, `Dear ${p.name},\n\nWe are delighted to confirm your promotion to ${p.toTitle}, effective ${p.effectiveDate}.${p.newCtcLpa ? '\n\nHR will share your revised compensation.' : ''}`);
  }
  return ok({ item: p, next: action === 'apply' && p.salaryRevisionNeeded ? `Create the ${p.newCtcLpa} LPA salary revision in Payroll > Revisions.` : '' });
}

// ------------------------------------------------------------------ the quarterly review round

async function qcList(c: Ctx): Promise<Result> {
  return ok({ items: (await listK(c.cid, 'qc')).sort((a, b) => b.quarter.localeCompare(a.quarter)), steps: QUARTER_STEPS });
}

async function qcOpen(c: Ctx, b: any): Promise<Result> {
  const quarter = str(b.quarter, 7);
  if (!isQuarter(quarter)) return fail(400, 'Choose a quarter like 2026-Q4.');
  if ((await listK(c.cid, 'qc')).some((x) => x.quarter === quarter)) return fail(409, `The ${quarter} review round is already open.`);
  const it: Item = {
    id: newId(), companyId: c.cid, kind: 'qc', quarter, dueOn: quarterDueDate(quarter), openedBy: c.who, openedByEmail: c.ctx.email, createdAt: nowIso(), remindersSent: [],
    steps: QUARTER_STEPS.map((s) => ({ key: s.key, label: s.label, hint: s.hint, done: false, note: '', by: '', at: '' })),
  };
  await putK(it);
  return ok({ item: it });
}

async function qcTick(c: Ctx, b: any): Promise<Result> {
  const it = await getK(c.cid, str(b.id, 100), 'qc');
  if (!it) return fail(404, 'Review round not found.');
  if (!(it.steps as any[]).some((s) => s.key === str(b.key, 20))) return fail(404, 'Step not found.');
  const steps = (it.steps as any[]).map((s) => (s.key === str(b.key, 20) ? { ...s, done: b.done !== false, note: str(b.note, 300), by: c.who, at: nowIso() } : s));
  const next = { ...it, steps, closedAt: steps.every((s) => s.done) ? nowIso() : '' };
  await putK(next);
  return ok({ item: next });
}

async function qcView(c: Ctx, q: any): Promise<Result> {
  const it = await getK(c.cid, str(q.id, 100), 'qc');
  if (!it) return fail(404, 'Review round not found.');
  const t = today();
  const [okrs, probs, promos, pips] = await Promise.all([listK(c.cid, 'okr'), listK(c.cid, 'prob'), listK(c.cid, 'promo'), listK(c.cid, 'pip')]);
  const mine = okrs.filter((o) => o.quarter === it.quarter).map((o) => decorate(o, t));
  const overdueMs = probs.filter((p) => p.status === 'ACTIVE').flatMap((p) => (p.milestones as Milestone[]).filter((m) => m.status === 'PENDING' && m.dueOn < t));
  return ok({
    item: it, today: t, bounds: quarterBounds(it.quarter),
    live: {
      okrs: { total: mine.length, closed: mine.filter((o) => o.state === 'CLOSED').length, atRisk: mine.filter((o) => o.status === 'AT_RISK' || o.status === 'OFF_TRACK').length, averageProgress: mine.length ? Math.round(mine.reduce((a, o) => a + o.progress, 0) / mine.length) : null },
      probation: { running: probs.filter((p) => p.status === 'ACTIVE').length, overdueReviews: overdueMs.length },
      promotions: { open: promos.filter((p) => ['PROPOSED', 'HR_RECOMMENDED', 'APPROVED'].includes(p.status)).length },
      improvementPlans: { active: pips.filter((p) => !(PIP_FINAL as readonly string[]).includes(p.status)).length },
    },
  });
}

export async function sweepQuarterly(): Promise<{ reminded: number }> {
  const snap = await db().collection('hrbpItems').where('kind', '==', 'qc').get();
  const t = today();
  let reminded = 0;
  for (const d of snap.docs) {
    const it = d.data() as Item;
    const open = (it.steps as any[]).filter((s) => !s.done);
    if (!open.length || !it.openedByEmail) continue;
    const left = diffDays(t, it.dueOn);
    const key = left < 0 ? `late:${t}` : left <= 3 ? `soon:${it.dueOn}` : '';
    if (!key || (it.remindersSent || []).includes(key)) continue;
    await notify(it.companyId, [it.openedByEmail], `${left < 0 ? 'Overdue: ' : ''}${it.quarter} review round`, `The ${it.quarter} review round ${left < 0 ? `was due on ${it.dueOn}` : `is due on ${it.dueOn}`}. Still open: ${open.map((s) => s.label).join(', ')}.`);
    reminded++;
    await putK({ ...it, remindersSent: [...(it.remindersSent || []), key].slice(-60) });
  }
  return { reminded };
}

// ------------------------------------------------------------------ routing

const ROUTES: Record<string, 'GET' | 'POST'> = {
  'prob-list': 'GET', 'prob-start': 'POST', 'prob-feedback': 'POST', 'prob-decide': 'POST',
  'okr-list': 'GET', 'okr-save': 'POST', 'okr-update': 'POST', 'okr-close': 'POST', 'okr-delete': 'POST',
  'promo-list': 'GET', 'promo-propose': 'POST', 'promo-act': 'POST',
  'qc-list': 'GET', 'qc-open': 'POST', 'qc-tick': 'POST', 'qc-view': 'GET',
};
const HR_ONLY = new Set(['prob-start', 'qc-open', 'qc-tick', 'qc-list', 'qc-view']);

export async function routeCycle(r: CycleRequest): Promise<Result | null> {
  const method = ROUTES[r.action];
  if (!method) return null;
  try {
    if (r.method !== method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    if (HR_ONLY.has(r.action) && !isHr(ctx) && !(r.action === 'qc-list' || r.action === 'qc-view' ? ctx.perms.includes('hrbp.view') : false)) return fail(403, 'You do not have permission to do this.');
    const c = await load(ctx);
    const b = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'prob-list': return await probList(c, r.query);
      case 'prob-start': return await probStart(c, b);
      case 'prob-feedback': return await probFeedback(c, b);
      case 'prob-decide': return await probDecide(c, b);
      case 'okr-list': return await okrList(c, r.query);
      case 'okr-save': return await okrSave(c, b);
      case 'okr-update': return await okrUpdate(c, b);
      case 'okr-close': return await okrClose(c, b);
      case 'okr-delete': return await okrDelete(c, b);
      case 'promo-list': return await promoList(c);
      case 'promo-propose': return await promoPropose(c, b);
      case 'promo-act': return await promoAct(c, b);
      case 'qc-list': return await qcList(c);
      case 'qc-open': return await qcOpen(c, b);
      case 'qc-tick': return await qcTick(c, b);
      default: return await qcView(c, r.query);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[TalentCycle] error:', err);
    return fail(500, err?.message || 'Request failed.');
  }
}
