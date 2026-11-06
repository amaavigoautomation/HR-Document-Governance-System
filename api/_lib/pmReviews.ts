/**
 * Quarterly reviews.
 *
 *   SELF → MANAGER → HR → APPROVED → PUBLISHED → ACKNOWLEDGED | DISPUTED → RESOLVED
 *   ON_HOLD   no approved plan yet (starts by itself when the plan is approved)
 *   DEFERRED  long approved leave in the quarter (HR resumes it)
 *
 * Each review keeps a frozen copy of the plan, weights and SOP versions it was scored against.
 * Nobody approves a review they are the subject or the manager of. A shared review changes only through an audited amendment.
 */
import {
  REVIEW_WORDS, addDays, daysBetween, isDate, isRating, isSopResult, previousQuarter, quarterByKey, quarterOf, scoreReview,
  type Quarter,
} from '../../shared/pmEngine.js';
import { openPlanOf } from './pmPlans.js';
import { proposeGrowth, feedHrbp } from './pmGrowth.js';
import {
  active, audit, bad, canSee, clear, db, denied, get, hrUids, isManagerOf, list, managerOf, nameOf, notFound, ok, put, raise,
  remindNow, settingsOf, str, tell, today,
  type C, type Doc, type Result, type Route, type Settings,
} from './pmCore.js';

const reviewId = (cid: string, key: string, uid: string) => `${cid}_${key}_${uid}`;
const cycleId = (cid: string, key: string) => `${cid}_${key}`;

function snapshot(plan: Doc, s: Settings) {
  return {
    planId: plan.id, designation: plan.designation, department: plan.department, weights: { ...s.weights },
    kpis: plan.kpis.map((k: any) => ({ id: k.id, kra: k.kra, kpi: k.kpi, measure: k.measure, weight: k.weight, target: k.target })),
    comps: plan.competencies.map((x: any) => ({ id: x.id, name: x.name, standard: x.standard })),
    sops: (plan.sops || []).map((x: any) => ({ id: x.documentId, title: x.title, versionNumber: x.versionNumber, critical: !!x.critical })),
  };
}

const overlap = (a1: string, a2: string, b1: string, b2: string) => { const s = a1 > b1 ? a1 : b1; const e = a2 < b2 ? a2 : b2; return s > e ? 0 : daysBetween(s, e) + 1; };
async function leaveDays(c: C, uid: string, q: Quarter): Promise<number> {
  const snap = await db().collection('leaveRequests').where('companyId', '==', c.cid).where('uid', '==', uid).get();
  return snap.docs.map((d: any) => d.data() as any).filter((r: any) => r.status === 'APPROVED' && isDate(r.from) && isDate(r.to)).reduce((n: number, r: any) => n + overlap(r.from, r.to, q.from, q.to), 0);
}

/** Opens a quarter: one review per person (never twice). Refused until setup is finished. */
export async function openCycle(c: C, q: Quarter): Promise<{ created: number; onHold: number; deferred: number; cycle: Doc }> {
  const s = await settingsOf(c.cid);
  const t = today();
  const id = cycleId(c.cid, q.key);
  const cycle = (await get(c.cid, 'cycles', id)) || await put('cycles', {
    id, companyId: c.cid, key: q.key, name: q.name, from: q.from, to: q.to, openedOn: t, openedBy: c.who,
    selfDue: addDays(t, s.timing.selfDays), managerDue: addDays(t, s.timing.selfDays + s.timing.managerDays), hrDue: addDays(t, s.timing.selfDays + s.timing.managerDays + s.timing.hrDays),
  });
  const plans = await list(c.cid, 'plans');
  const hr = await hrUids(c);
  let created = 0; let onHold = 0; let deferred = 0;
  for (const p of active(c)) {
    if (p.createdDate > q.to) continue; // joined after the quarter ended
    const rid = reviewId(c.cid, q.key, p.uid);
    if (await get(c.cid, 'reviews', rid)) continue;
    const plan = openPlanOf(plans, p.uid);
    const ld = await leaveDays(c, p.uid, q);
    const base: Doc = {
      id: rid, companyId: c.cid, uid: p.uid, name: p.name, managerUid: managerOf(c, p.uid), managerName: nameOf(c, managerOf(c, p.uid)),
      cycleKey: q.key, cycleName: q.name, from: q.from, to: q.to, selfDue: cycle.selfDue, managerDue: cycle.managerDue, hrDue: cycle.hrDue,
      self: {}, manager: {}, score: null, flags: [], leaveDays: ld, amendments: [], statusOn: t, history: [],
    };
    if (ld >= 30) {
      await put('reviews', { ...base, status: 'DEFERRED', snap: plan?.status === 'ACTIVE' ? snapshot(plan, s) : null, deferReason: `On approved leave for ${ld} days of this quarter.` });
      await raise(c, 'EXTENDED_LEAVE', rid, { subjectUid: p.uid, text: `${p.name} was on approved leave for ${ld} days in ${q.name}. The review is paused; HR can resume it.` });
      deferred++; continue;
    }
    if (!plan || plan.status !== 'ACTIVE') {
      await put('reviews', { ...base, status: 'ON_HOLD', snap: null });
      await raise(c, 'NO_PLAN_FOR_REVIEW', rid, { subjectUid: p.uid, text: `${p.name}'s ${q.name} review is waiting because their targets are not approved yet (${plan ? plan.status.replace(/_/g, ' ').toLowerCase() : 'no plan'}). It starts by itself once they are.`, notify: hr });
      onHold++; continue;
    }
    await put('reviews', { ...base, status: 'SELF', snap: snapshot(plan, s) });
    await tell(c, [p.uid], `Your ${q.name} review is open`, `Please do your self-review by ${cycle.selfDue}. It takes about 10 minutes: your KPIs, targets and recorded work are already filled in.`);
    created++;
  }
  await audit(c, id, 'CYCLE_OPENED', `${q.name}: ${created} started, ${onHold} on hold, ${deferred} paused`);
  return { created, onHold, deferred, cycle };
}

/** The daily job opens the quarter that just ended, on the first days of the next one, if setup was finished before it ended. */
export async function autoOpen(c: C): Promise<string> {
  const s = await settingsOf(c.cid);
  if (!s.setupDone) return 'setup not finished';
  const q = previousQuarter(today());
  if (s.setupDoneAt.slice(0, 10) > q.to) return 'setup finished after this quarter';
  if (daysBetween(q.to, today()) > 30) return 'too late to open automatically';
  if (await get(c.cid, 'cycles', cycleId(c.cid, q.key))) return 'already open';
  const r = await openCycle(c, q);
  return `opened ${q.name}: ${r.created} started`;
}

/** Reviews on hold start as soon as the person's targets are approved. */
export async function releaseHeld(c: C): Promise<{ started: number }> {
  const s = await settingsOf(c.cid);
  const [held, plans] = await Promise.all([list(c.cid, 'reviews', { status: 'ON_HOLD' }), list(c.cid, 'plans')]);
  let started = 0;
  for (const rv of held) {
    const plan = openPlanOf(plans, rv.uid);
    if (!plan || plan.status !== 'ACTIVE') continue;
    const selfDue = addDays(today(), s.timing.selfDays);
    await put('reviews', { ...rv, status: 'SELF', snap: snapshot(plan, s), selfDue, managerDue: addDays(selfDue, s.timing.managerDays), hrDue: addDays(selfDue, s.timing.managerDays + s.timing.hrDays), statusOn: today(), managerUid: plan.managerUid, managerName: plan.managerName });
    await clear(c, 'NO_PLAN_FOR_REVIEW', rv.id, 'Targets approved; the review has started.');
    await tell(c, [rv.uid], `Your ${rv.cycleName} review is open`, `Please do your self-review by ${selfDue}.`);
    started++;
  }
  return { started };
}

// ------------------------------------------------------------------ reading

/** Evidence for the quarter, per KPI. Information for the manager, never a score by itself. */
async function evidenceFor(c: C, rv: Doc) {
  const ev = (await list(c.cid, 'evidence', { uid: rv.uid })).filter((e) => e.date >= rv.from && e.date <= rv.to && e.status !== 'REJECTED');
  const checkins = (await list(c.cid, 'checkins', { uid: rv.uid })).filter((x) => x.month >= rv.from.slice(0, 7) && x.month <= rv.to.slice(0, 7));
  return { evidence: ev.sort((a, b) => a.date.localeCompare(b.date)), checkins: checkins.sort((a, b) => a.month.localeCompare(b.month)) };
}

export function computeScore(rv: Doc) {
  const snap = rv.snap; if (!snap) return null;
  const m = rv.manager || {};
  return scoreReview({
    kpis: snap.kpis.map((k: any) => ({ id: k.id, weight: k.weight, rating: m.kpis?.[k.id] })),
    comps: snap.comps.map((x: any) => ({ id: x.id, rating: m.comps?.[x.id] })),
    sops: snap.sops.map((x: any) => ({ id: x.id, critical: x.critical, result: m.sops?.[x.id] })),
  }, snap.weights);
}

const SHARED = ['PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED', 'RESOLVED'];
/** What one person may see of a review: the employee sees the manager's part only once it is shared. */
export function visible(c: C, rv: Doc) {
  const isEmp = rv.uid === c.ctx.uid && !c.isHr && !c.isApprover;
  if (isEmp && !SHARED.includes(rv.status)) return { ...rv, manager: {}, score: null, flags: [], hr: undefined };
  if (isEmp) return { ...rv, flags: [] };
  return rv;
}

function can(c: C, rv: Doc) {
  const me = c.ctx.uid; const isEmp = rv.uid === me; const isMgr = rv.managerUid === me || isManagerOf(c, rv.uid);
  const approver = (c.isHr || c.isApprover) && !isEmp && rv.managerUid !== me;
  return {
    self: isEmp && rv.status === 'SELF',
    manager: isMgr && !isEmp && rv.status === 'MANAGER',
    skipSelf: isMgr && !isEmp && rv.status === 'SELF' && today() > rv.selfDue,
    approve: approver && rv.status === 'HR',
    publish: (c.isHr || c.isApprover) && rv.status === 'APPROVED',
    respond: isEmp && rv.status === 'PUBLISHED',
    resolve: c.isHr && !isEmp && rv.status === 'DISPUTED',
    amend: (c.isHr || c.isApprover) && !isEmp && ['APPROVED', ...SHARED].includes(rv.status),
    defer: c.isHr && !isEmp && ['SELF', 'MANAGER', 'HR', 'ON_HOLD'].includes(rv.status),
    resume: c.isHr && !isEmp && rv.status === 'DEFERRED',
    aiDraft: isMgr && !isEmp && rv.status === 'MANAGER',
  };
}

async function reviewGet(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(q.id, 200));
  if (!rv || !canSee(c, rv.uid)) return notFound('The review');
  const mine = rv.uid === c.ctx.uid;
  const own = await evidenceFor(c, rv);
  const history = (await list(c.cid, 'log', { ref: rv.id })).filter((x) => x.kind === 'AUDIT').sort((a, b) => String(a.at).localeCompare(String(b.at))).map((x) => ({ at: x.at, action: x.action, actor: x.actor, detail: mine && !c.isHr && !['DISPUTED', 'DISPUTE_RESOLVED', 'AMENDMENT_STARTED', 'ACKNOWLEDGED'].includes(x.action) ? '' : x.detail }));
  return ok({ review: visible(c, rv), live: rv.status === 'MANAGER' && !mine ? computeScore(rv) : null, ...own, can: can(c, rv), history, statusText: REVIEW_WORDS[rv.status] || rv.status });
}

async function reviewList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const scope = str(q.scope, 10);
  let rows = await list(c.cid, 'reviews');
  if (scope === 'mine') rows = rows.filter((r) => r.uid === c.ctx.uid);
  else if (scope === 'team') rows = rows.filter((r) => r.uid !== c.ctx.uid && (r.managerUid === c.ctx.uid || isManagerOf(c, r.uid)));
  else { if (!c.isHr && !c.isApprover) return denied(); if (q.cycle) rows = rows.filter((r) => r.cycleKey === str(q.cycle, 10)); }
  // HR sees the risky ones first; the clean ones sink to the bottom.
  const risk = (r: Doc) => (r.score?.criticalBreach ? 5 : 0) + (r.status === 'DISPUTED' ? 4 : 0) + (r.flags?.length || 0) + (r.status === 'ON_HOLD' ? 1 : 0);
  rows.sort((a, b) => risk(b) - risk(a) || String(b.cycleKey).localeCompare(String(a.cycleKey)) || String(a.name).localeCompare(String(b.name)));
  return ok({ items: rows.map((r) => ({ ...visible(c, r), risk: risk(r), statusText: REVIEW_WORDS[r.status] || r.status })) });
}

async function cycleList(c: C): Promise<Result> {
  const [cycles, reviews] = await Promise.all([list(c.cid, 'cycles'), list(c.cid, 'reviews')]);
  const items = cycles.sort((a, b) => b.key.localeCompare(a.key)).map((cy) => {
    const rs = reviews.filter((r) => r.cycleKey === cy.key);
    const count: Record<string, number> = {};
    for (const r of rs) count[r.status] = (count[r.status] || 0) + 1;
    return { ...cy, total: rs.length, count, done: rs.filter((r) => ['ACKNOWLEDGED', 'RESOLVED'].includes(r.status)).length };
  });
  const cur = quarterOf(today()); const prev = previousQuarter(today());
  return ok({ items, canOpen: [prev, cur].filter((q) => !cycles.some((x) => x.key === q.key)) });
}

async function cycleOpenRoute(c: C, b: any): Promise<Result> {
  const q = quarterByKey(str(b.key, 10));
  if (!q) return bad('Pick a quarter.');
  if (q.from > today()) return bad('That quarter has not started yet.');
  const s = await settingsOf(c.cid);
  if (!s.setupDone) return bad('Finish Performance setup first (Setup → step 5).');
  if (await get(c.cid, 'cycles', cycleId(c.cid, q.key))) return bad(`${q.name} is already open. Opening it again would not change anything.`);
  const r = await openCycle(c, q);
  return ok({ ...r, message: `${q.name} opened: ${r.created} review(s) started${r.onHold ? `, ${r.onHold} waiting for approved targets` : ''}${r.deferred ? `, ${r.deferred} paused for long leave` : ''}.` });
}

// ------------------------------------------------------------------ the steps

const ratingsFrom = (v: any, ids: string[]) => { const out: Record<string, any> = {}; for (const id of ids) if (isRating(v?.[id])) out[id] = v[id]; return out; };

async function reviewSelf(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv || rv.uid !== c.ctx.uid) return notFound('Your review');
  if (rv.status !== 'SELF') return bad('Your self-review is closed for this review.');
  const kIds = rv.snap.kpis.map((k: any) => k.id); const cIds = rv.snap.comps.map((x: any) => x.id);
  const self = { kpis: ratingsFrom(b.kpis, kIds), comps: ratingsFrom(b.comps, cIds), achievements: str(b.achievements, 3000), improve: str(b.improve, 2000), training: str(b.training, 1000) };
  const submit = b.submit === true;
  if (submit) {
    const missing = [...rv.snap.kpis.filter((k: any) => !self.kpis[k.id]).map((k: any) => k.kpi), ...rv.snap.comps.filter((x: any) => !self.comps[x.id]).map((x: any) => x.name)];
    if (missing.length) return bad(`Pick a rating (or "Not observed") for: ${missing.slice(0, 6).join('; ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}.`);
    if (self.achievements.length < 10) return bad('Write a few words about what you achieved this quarter.');
  }
  const next = { ...rv, self: { ...self, submittedAt: submit ? new Date().toISOString() : '' }, ...(submit ? { status: 'MANAGER', statusOn: today() } : {}) };
  await put('reviews', next);
  if (submit) {
    await audit(c, rv.id, 'SELF_SUBMITTED', '', rv.uid);
    await tell(c, [rv.managerUid], `${rv.name}'s self-review is in`, `${rv.name} finished their ${rv.cycleName} self-review. Please do your part by ${rv.managerDue}.`);
  }
  return ok({ review: next, message: submit ? 'Sent to your manager.' : 'Saved. You can finish it later.' });
}

async function skipSelf(c: C, rv: Doc, by: string): Promise<Doc> {
  const next = { ...rv, status: 'MANAGER', statusOn: today(), selfSkipped: true };
  await put('reviews', next);
  await audit(c, rv.id, 'SELF_SKIPPED', `Self-review not done by ${rv.selfDue}; ${by}.`, rv.uid);
  return next;
}

async function reviewSkipSelf(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv || !can(c, rv).skipSelf) return bad('You can continue without the self-review only after its due date has passed.');
  const next = await skipSelf(c, rv, `${c.who} continued without it`);
  await tell(c, [rv.uid], 'Your self-review closed', `Your ${rv.cycleName} self-review was not done by ${rv.selfDue}, so your manager has continued.`);
  return ok({ review: next, message: 'You can now do your part.' });
}

/** The manager's part. "Send to HR" checks everything: all rated, all SOPs answered, the discussion date, a comment. */
async function reviewManager(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv) return notFound('The review');
  if (!can(c, rv).manager) return denied(rv.uid === c.ctx.uid ? 'You cannot do the manager part of your own review.' : 'This review is not waiting for you.');
  const kIds = rv.snap.kpis.map((k: any) => k.id); const cIds = rv.snap.comps.map((x: any) => x.id);
  const sops: Record<string, string> = {};
  for (const x of rv.snap.sops) if (isSopResult(b.sops?.[x.id])) sops[x.id] = b.sops[x.id];
  const m = {
    kpis: ratingsFrom(b.kpis, kIds), comps: ratingsFrom(b.comps, cIds), sops,
    strengths: str(b.strengths, 2000), improve: str(b.improve, 2000), training: str(b.training, 1000), comment: str(b.comment, 3000), discussedOn: str(b.discussedOn, 10),
  };
  const draft = { ...rv, manager: m };
  const score = computeScore(draft)!;
  const submit = b.submit === true;
  if (submit) {
    const missing = [...rv.snap.kpis.filter((k: any) => !m.kpis[k.id]).map((k: any) => k.kpi), ...rv.snap.comps.filter((x: any) => !m.comps[x.id]).map((x: any) => x.name), ...rv.snap.sops.filter((x: any) => !m.sops[x.id]).map((x: any) => `SOP: ${x.title}`)];
    if (missing.length) return bad(`Answer every line first. Missing: ${missing.slice(0, 6).join('; ')}${missing.length > 6 ? ` and ${missing.length - 6} more` : ''}.`);
    if (score.blocking.length) return bad(score.blocking.join(' '));
    if (!isDate(m.discussedOn)) return bad('Enter the date you discussed this review with the employee. The review cannot go to HR before that conversation.');
    if (m.discussedOn > today() || m.discussedOn < rv.from) return bad('The discussion date must be between the start of the quarter and today.');
    if (m.comment.length < 10) return bad('Write an overall comment (a sentence or two).');
  }
  // Flags HR should look at. They never change the score.
  const flags: string[] = [];
  const ev = submit ? (await evidenceFor(c, rv)).evidence.filter((e) => e.status === 'VERIFIED') : [];
  if (submit) {
    const unproven = rv.snap.kpis.filter((k: any) => typeof m.kpis[k.id] === 'number' && !ev.some((e) => e.kpiId === k.id));
    if (unproven.length) flags.push(`Rated without verified evidence: ${unproven.map((k: any) => k.kpi).join('; ')}`);
    const all = [...Object.values(m.kpis), ...Object.values(m.comps)].filter((v) => typeof v === 'number');
    if (all.length >= 5 && new Set(all).size === 1) flags.push(`Every item was given the same rating (${all[0]})`);
    if (score.criticalBreach) flags.push('A critical SOP was marked not compliant');
    if (rv.selfSkipped) flags.push('No self-review (not done by the due date)');
    const selfAvg = Object.values(rv.self?.kpis || {}).filter((v) => typeof v === 'number') as number[];
    if (selfAvg.length && score.results !== null && Math.abs(selfAvg.reduce((a, x) => a + x, 0) / selfAvg.length - score.results) >= 2) flags.push('Large gap between self-rating and manager rating on results');
  }
  const next = { ...draft, score, ...(submit ? { status: 'HR', statusOn: today(), flags, managerSubmittedAt: new Date().toISOString(), managerName: c.who } : {}) };
  await put('reviews', next);
  if (submit) {
    await audit(c, rv.id, 'MANAGER_SUBMITTED', `Score ${score.overall} (${score.band})${flags.length ? `; flags: ${flags.join(' | ')}` : ''}`, rv.uid);
    if (score.criticalBreach) await raise(c, 'CRITICAL_SOP', rv.id, { subjectUid: rv.uid, text: `${rv.name}: a critical SOP was marked not compliant in the ${rv.cycleName} review. HR must review it before approving. Misconduct goes through the separate investigation process, not the performance score.`, notify: await hrUids(c) });
    if (flags.some((f) => f.startsWith('Every item'))) await raise(c, 'RATING_PATTERN', rv.id, { subjectUid: rv.uid, text: `${rv.name}'s ${rv.cycleName} review: ${c.who} gave every item the same rating.` });
    if (flags.some((f) => f.startsWith('Rated without'))) await raise(c, 'NO_EVIDENCE', rv.id, { subjectUid: rv.uid, text: `${rv.name}'s ${rv.cycleName} review: ${flags.find((f) => f.startsWith('Rated without'))}.` });
    await clear(c, 'REVIEW_LATE', `${rv.id}_MANAGER`, 'Sent to HR.');
    await tell(c, await hrUids(c), `Review ready for approval: ${rv.name}`, `${c.who} finished ${rv.name}'s ${rv.cycleName} review (score ${score.overall}).`);
  }
  return ok({ review: next, score, message: submit ? 'Sent to HR.' : 'Saved.' });
}

async function publish(c: C, rv: Doc): Promise<Doc> {
  const next = { ...rv, status: 'PUBLISHED', statusOn: today(), publishedAt: new Date().toISOString() };
  await put('reviews', next);
  await audit(c, rv.id, 'PUBLISHED', '', rv.uid);
  await tell(c, [rv.uid], `Your ${rv.cycleName} review is ready`, 'Your review is ready to read. Open My performance → Reviews. You can acknowledge it or record that you disagree.');
  await proposeGrowth(c, next);
  await feedHrbp(c, next);
  return next;
}

async function reviewApprove(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv) return notFound('The review');
  if (rv.uid === c.ctx.uid) return denied('Nobody approves their own review.');
  if (rv.managerUid === c.ctx.uid) return denied('You were the manager on this review, so another HR person or approver must approve it.');
  if (rv.status !== 'HR') return bad('Only reviews waiting for HR can be approved.');
  const note = str(b.note, 1000);
  if (rv.score?.criticalBreach && note.length < 10) return bad('This review has a critical SOP flag. Write a note saying what you checked before approving.');
  const s = await settingsOf(c.cid);
  let next: Doc = { ...rv, status: 'APPROVED', statusOn: today(), hr: { note, by: c.who, byUid: c.ctx.uid, at: new Date().toISOString() }, publishOn: addDays(today(), s.timing.publishDelayDays) };
  await put('reviews', next);
  await audit(c, rv.id, 'APPROVED', note, rv.uid);
  await clear(c, 'CRITICAL_SOP', rv.id, `Checked by ${c.who}: ${note || 'approved'}`);
  if (s.timing.publishDelayDays === 0) next = await publish(c, next);
  return ok({ review: next, message: next.status === 'PUBLISHED' ? 'Approved and shared with the employee.' : `Approved. It will be shared with ${rv.name} on ${next.publishOn}.` });
}

async function reviewReturn(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv) return notFound('The review');
  if (rv.status !== 'HR') return bad('Only reviews waiting for HR can be sent back.');
  const note = str(b.note, 1000);
  if (note.length < 5) return bad('Write what the manager should change.');
  const next = { ...rv, status: 'MANAGER', statusOn: today(), hrReturnNote: note };
  await put('reviews', next);
  await audit(c, rv.id, 'RETURNED_TO_MANAGER', note, rv.uid);
  await tell(c, [rv.managerUid], `Please update ${rv.name}'s review`, `HR sent the ${rv.cycleName} review back: "${note}"`);
  return ok({ review: next, message: 'Sent back to the manager.' });
}

async function reviewPublish(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv || rv.status !== 'APPROVED') return bad('Only approved reviews can be shared.');
  return ok({ review: await publish(c, rv), message: 'Shared with the employee.' });
}

async function reviewRespond(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv || rv.uid !== c.ctx.uid) return notFound('Your review');
  if (rv.status !== 'PUBLISHED') return bad('This review is not waiting for your response.');
  const agree = b.agree === true; const comment = str(b.comment, 2000);
  if (!agree && comment.length < 10) return bad('Write what you disagree with (a sentence or two). It is kept exactly as you write it.');
  const next = { ...rv, status: agree ? 'ACKNOWLEDGED' : 'DISPUTED', statusOn: today(), response: { agree, comment, at: new Date().toISOString() } };
  await put('reviews', next);
  await audit(c, rv.id, agree ? 'ACKNOWLEDGED' : 'DISPUTED', comment, rv.uid);
  if (!agree) await raise(c, 'REVIEW_DISPUTED', rv.id, { subjectUid: rv.uid, text: `${rv.name} disagrees with their ${rv.cycleName} review: "${comment}"`, notify: [...(await hrUids(c)), rv.managerUid].filter(Boolean) });
  return ok({ review: next, message: agree ? 'Thank you. Your review is complete.' : 'Your comments are recorded and HR has been told.' });
}

async function reviewResolve(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv || rv.status !== 'DISPUTED') return bad('Only a review the employee disagrees with can be resolved.');
  if (rv.uid === c.ctx.uid) return denied();
  const note = str(b.note, 2000);
  if (note.length < 10) return bad('Write what was decided and why. The employee will see it.');
  const next = { ...rv, status: 'RESOLVED', statusOn: today(), resolution: { note, by: c.who, at: new Date().toISOString() } };
  await put('reviews', next);
  await audit(c, rv.id, 'DISPUTE_RESOLVED', note, rv.uid);
  await clear(c, 'REVIEW_DISPUTED', rv.id, note);
  await tell(c, [rv.uid], 'Your review: HR decision', `HR looked at your comments on the ${rv.cycleName} review: "${note}"`);
  return ok({ review: next, message: 'Resolved. The employee has been told.' });
}

/** The only way to change a review after approval: a reason, the old version kept, and the normal steps again. */
async function reviewAmend(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv || !can(c, rv).amend) return denied('This review cannot be amended by you.');
  const reason = str(b.reason, 1000);
  if (reason.length < 10) return bad('Write the reason for the amendment. It is kept on the record.');
  const before = { status: rv.status, manager: rv.manager, score: rv.score, hr: rv.hr || null, response: rv.response || null };
  const next = { ...rv, status: 'MANAGER', statusOn: today(), amended: true, amendments: [...(rv.amendments || []), { at: new Date().toISOString(), by: c.who, reason, before }], response: null, hr: null };
  await put('reviews', next);
  await audit(c, rv.id, 'AMENDMENT_STARTED', reason, rv.uid);
  await tell(c, [rv.managerUid, rv.uid].filter(Boolean), `${rv.cycleName} review reopened for amendment`, `Reason: "${reason}". The previous version is kept on the record. The manager updates it, HR approves it again, and it is shared again.`);
  return ok({ review: next, message: 'Reopened for the manager. The previous version is kept.' });
}

async function reviewDefer(c: C, b: any, resume: boolean): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv) return notFound('The review');
  const k = can(c, rv);
  if (resume ? !k.resume : !k.defer) return bad(resume ? 'Only a paused review can be resumed.' : 'This review cannot be paused now.');
  const s = await settingsOf(c.cid);
  if (resume) {
    const plan = openPlanOf(await list(c.cid, 'plans'), rv.uid);
    const snap = rv.snap || (plan?.status === 'ACTIVE' ? snapshot(plan, s) : null);
    const selfDue = addDays(today(), s.timing.selfDays);
    const next = { ...rv, snap, status: snap ? 'SELF' : 'ON_HOLD', selfDue, managerDue: addDays(selfDue, s.timing.managerDays), hrDue: addDays(selfDue, s.timing.managerDays + s.timing.hrDays), statusOn: today() };
    await put('reviews', next); await audit(c, rv.id, 'RESUMED', '', rv.uid); await clear(c, 'EXTENDED_LEAVE', rv.id, 'Resumed by HR.');
    if (snap) await tell(c, [rv.uid], `Your ${rv.cycleName} review is open`, `Please do your self-review by ${selfDue}.`);
    return ok({ review: next, message: 'Resumed.' });
  }
  const reason = str(b.reason, 500);
  if (reason.length < 5) return bad('Write why the review is paused.');
  const next = { ...rv, status: 'DEFERRED', statusOn: today(), deferReason: reason };
  await put('reviews', next); await audit(c, rv.id, 'DEFERRED', reason, rv.uid);
  return ok({ review: next, message: 'Paused.' });
}

// ------------------------------------------------------------------ daily: deadlines, reminders, sharing

export async function reviewDaily(c: C): Promise<Record<string, number>> {
  const s = await settingsOf(c.cid);
  const t = today(); const hr = await hrUids(c); const every = s.timing.remindEvery;
  const out = { remindedSelf: 0, selfClosed: 0, remindedManager: 0, remindedHr: 0, shared: 0, remindedResponse: 0 };
  for (const rv0 of await list(c.cid, 'reviews')) {
    let rv = rv0;
    if (rv.status === 'SELF') {
      if (t > rv.selfDue) { rv = await skipSelf(c, rv, 'closed automatically at the due date'); out.selfClosed++; await tell(c, [rv.managerUid], `${rv.name}'s review is ready for you`, `${rv.name} did not do the self-review by ${rv.selfDue}. Please do your part by ${rv.managerDue}.`); continue; }
      if (daysBetween(t, rv.selfDue) <= 2 && remindNow(rv, 'self', every)) { await put('reviews', rv); out.remindedSelf++; await tell(c, [rv.uid], 'Reminder: your self-review', `Your ${rv.cycleName} self-review is due on ${rv.selfDue}.`); }
    } else if (rv.status === 'MANAGER') {
      const late = t > rv.managerDue;
      if ((late || daysBetween(t, rv.managerDue) <= 2) && remindNow(rv, 'mgr', every)) {
        await put('reviews', rv); out.remindedManager++;
        await tell(c, [rv.managerUid], `Reminder: ${rv.name}'s review`, `${rv.name}'s ${rv.cycleName} review is ${late ? 'late' : `due on ${rv.managerDue}`}.`);
        if (late && daysBetween(rv.managerDue, t) >= s.timing.escalateAfter) await raise(c, 'REVIEW_LATE', `${rv.id}_MANAGER`, { subjectUid: rv.uid, text: `${rv.managerName}'s part of ${rv.name}'s ${rv.cycleName} review is ${daysBetween(rv.managerDue, t)} days late.`, notify: hr });
      }
    } else if (rv.status === 'HR') {
      if (t > rv.hrDue && remindNow(rv, 'hr', every)) { await put('reviews', rv); out.remindedHr++; await tell(c, hr, `Reminder: approve ${rv.name}'s review`, `${rv.name}'s ${rv.cycleName} review has been waiting for HR since ${rv.statusOn}.`); }
    } else if (rv.status === 'APPROVED') {
      if (rv.publishOn && rv.publishOn <= t) { await publish(c, rv); out.shared++; }
    } else if (rv.status === 'PUBLISHED') {
      if (daysBetween(rv.statusOn, t) >= every && remindNow(rv, 'resp', every * 2)) { await put('reviews', rv); out.remindedResponse++; await tell(c, [rv.uid], 'Please read your review', `Your ${rv.cycleName} review is waiting for you to acknowledge it (or record that you disagree).`); }
    }
  }
  return out;
}

export const REVIEW_ROUTES: Record<string, Route> = {
  review: { method: 'GET', who: 'any', run: (c, b, q) => reviewGet(c, b, q) },
  reviews: { method: 'GET', who: 'any', run: (c, b, q) => reviewList(c, b, q) },
  cycles: { method: 'GET', who: 'approver', run: (c) => cycleList(c) },
  'cycle-open': { method: 'POST', who: 'hr', run: (c, b) => cycleOpenRoute(c, b) },
  'review-self': { method: 'POST', who: 'any', run: (c, b) => reviewSelf(c, b) },
  'review-skip-self': { method: 'POST', who: 'any', run: (c, b) => reviewSkipSelf(c, b) },
  'review-manager': { method: 'POST', who: 'any', run: (c, b) => reviewManager(c, b) },
  'review-approve': { method: 'POST', who: 'approver', run: (c, b) => reviewApprove(c, b) },
  'review-return': { method: 'POST', who: 'approver', run: (c, b) => reviewReturn(c, b) },
  'review-publish': { method: 'POST', who: 'approver', run: (c, b) => reviewPublish(c, b) },
  'review-respond': { method: 'POST', who: 'any', run: (c, b) => reviewRespond(c, b) },
  'review-resolve': { method: 'POST', who: 'hr', run: (c, b) => reviewResolve(c, b) },
  'review-amend': { method: 'POST', who: 'approver', run: (c, b) => reviewAmend(c, b) },
  'review-defer': { method: 'POST', who: 'hr', run: (c, b) => reviewDefer(c, b, false) },
  'review-resume': { method: 'POST', who: 'hr', run: (c, b) => reviewDefer(c, b, true) },
};
