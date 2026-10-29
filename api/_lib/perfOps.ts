/**
 * Performance Management: check-ins, development plans, dashboards, AI assistance, governance views and the daily job
 * (HR-PM-007 to HR-PM-009).
 */
import { daysBetween, istToday } from '../../shared/leaveEngine.js';
import {
  DEV_OUTCOME_LABEL, type Checkin, type Cycle, type DevAction, type DevOutcome, type DevPlan, type Evidence, type PerfException, type Review, type SopAssignment,
} from '../../shared/performance.js';
import {
  MIN_COHORT, checkinIdOf, deadlineState, fairnessFlags, filterAiSummary, isFinal, monthOf, ratingDistribution, safeId, selfAverage, suggestedOutcome, visibleToEmployee, type RatingRow,
} from '../../shared/performanceEngine.js';
import { C, PerfError, audit, db, getOne, list, loadDirectory, loadSettings, nowIso, ok, peopleWithPerm, put, raise, str, tell, type Result } from './perfCore.js';
import { needHrOrApprover, needManage, relationTo, type Who } from './perfSetup.js';
import { generatePlan, planContext, syncSops } from './perfPlans.js';
import { createReviews } from './perfReviews.js';
import { checkLowMood } from './perfMood.js';

// ------------------------------------------------------------------ monthly check-ins

export async function getCheckins(w: Who, q: any): Promise<Result> {
  const scope = str(q.scope, 20);
  let rows = await list<Checkin>(C.checkins, w.cid);
  if (scope === 'all') needHrOrApprover(w);
  else if (scope === 'team') rows = rows.filter((c) => c.managerUid === w.uid);
  else rows = rows.filter((c) => c.uid === w.uid);
  return ok({ items: rows.sort((a, b) => b.month.localeCompare(a.month) || a.employeeName.localeCompare(b.employeeName)) });
}

export async function saveCheckin(w: Who, body: any): Promise<Result> {
  const uid = str(body.uid, 128) || w.uid;
  const month = /^\d{4}-\d{2}$/.test(str(body.month, 7)) ? str(body.month, 7) : monthOf(istToday());
  const dir = await loadDirectory(w.cid);
  const rel = relationTo(w, dir, uid);
  const id = checkinIdOf(w.cid, uid, month);
  const now = nowIso();
  const cur = (await getOne<Checkin>(C.checkins, id, w.cid)) || {
    id, companyId: w.cid, uid, employeeName: dir.nameOf(uid), managerUid: dir.managerOf(uid), month, progress: '', roadblocks: '', feedback: '', employeeNote: '',
    status: 'PENDING' as const, doneAt: '', createdAt: now, updatedAt: now,
  };
  let doc: Checkin = { ...cur, updatedAt: now };
  if (rel === 'SELF') {
    doc.employeeNote = str(body.employeeNote, 1500);
  } else if (rel === 'MANAGER' || (rel === 'HR' && w.canManage)) {
    doc = { ...doc, progress: str(body.progress, 1500), roadblocks: str(body.roadblocks, 1500), feedback: str(body.feedback, 1500) };
    if (body.done === true) {
      if (!doc.progress && !doc.feedback) throw new PerfError(400, 'Note progress or feedback before marking the check-in done.');
      doc = { ...doc, status: 'DONE', doneAt: now };
    }
  } else throw new PerfError(403, 'You can only write your own note or your team\'s check-ins.');
  await put(C.checkins, id, doc);
  return ok({ item: doc });
}

// ------------------------------------------------------------------ development and improvement plans

export async function getDevPlans(w: Who, q: any): Promise<Result> {
  const scope = str(q.scope, 20);
  let rows = await list<DevPlan>(C.devPlans, w.cid);
  if (scope === 'all') needHrOrApprover(w);
  else if (scope === 'team') rows = rows.filter((d) => d.managerUid === w.uid);
  else rows = rows.filter((d) => d.uid === w.uid);
  const reviews = new Map((await list<Review>(C.reviews, w.cid)).map((r) => [r.id, r]));
  return ok({
    items: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((d) => ({ ...d, outcomeLabel: DEV_OUTCOME_LABEL[d.outcome], suggested: suggestedOutcome(reviews.get(d.reviewId)?.scores.overall ?? null) })),
  });
}

const OUTCOMES: DevOutcome[] = ['DEVELOPMENT', 'IMPROVEMENT', 'RECOGNITION'];

function cleanActions(v: unknown): DevAction[] {
  return (Array.isArray(v) ? v.slice(0, 20) : []).map((a: any, i: number) => ({
    id: str(a?.id, 40) || `a${i + 1}`, text: str(a?.text, 300), dueDate: /^\d{4}-\d{2}-\d{2}$/.test(str(a?.dueDate, 10)) ? str(a.dueDate, 10) : '', done: a?.done === true,
  })).filter((a) => a.text);
}

/** Only a published review can lead to a plan. A score alone never triggers anything automatically. */
export async function saveDevPlan(w: Who, body: any): Promise<Result> {
  const dir = await loadDirectory(w.cid);
  const existing = body.id ? await getOne<DevPlan>(C.devPlans, str(body.id, 128), w.cid) : null;
  if (body.id && !existing) throw new PerfError(404, 'Plan not found.');
  const reviewId = existing?.reviewId || str(body.reviewId, 200);
  const review = reviewId ? await getOne<Review>(C.reviews, reviewId, w.cid) : null;
  const uid = existing?.uid || review?.uid || str(body.uid, 128);
  if (!uid) throw new PerfError(400, 'Choose the person.');
  const rel = relationTo(w, dir, uid);
  if (rel !== 'MANAGER' && !(rel === 'HR' && w.canManage)) throw new PerfError(403, 'Only the manager or HR can write the plan.');
  if (review && !isFinal(review.status)) throw new PerfError(400, 'A plan follows a published review.');
  const outcome: DevOutcome = OUTCOMES.includes(body.outcome) ? body.outcome : 'DEVELOPMENT';
  const gap = str(body.performanceGap, 1000);
  const standard = str(body.expectedStandard, 1000);
  const actions = cleanActions(body.actions);
  if (outcome === 'IMPROVEMENT' && (!gap || !standard || actions.length === 0 || !str(body.reviewDate, 10) || !str(body.supportProvided, 800))) {
    throw new PerfError(400, 'An improvement plan needs the gap, the expected standard, clear actions, the support provided and a review date.');
  }
  const now = nowIso();
  const id = existing?.id || db().collection(C.devPlans).doc().id;
  const doc: DevPlan = {
    id, companyId: w.cid, uid, employeeName: dir.nameOf(uid), reviewId, outcome, performanceGap: gap, supportingEvidence: str(body.supportingEvidence, 1000), expectedStandard: standard,
    actions, supportProvided: str(body.supportProvided, 800), startDate: str(body.startDate, 10) || istToday(), reviewDate: str(body.reviewDate, 10), managerUid: dir.managerOf(uid) || existing?.managerUid || '',
    hrReviewer: existing?.hrReviewer || (w.canManage ? w.name : ''), status: existing?.status || 'ACTIVE', outcomeNote: existing?.outcomeNote || '', createdAt: existing?.createdAt || now, updatedAt: now,
  };
  await put(C.devPlans, id, doc);
  await audit(w.cid, 'DEVPLAN', id, existing ? 'DEVPLAN_EDITED' : 'DEVPLAN_CREATED', w, null, { outcome });
  if (!existing) await tell(w.cid, [uid], 'A development plan was shared with you', `${DEV_OUTCOME_LABEL[outcome]}. Open Performance to read it.`, 'performance:dev', `dev__${id}`, dir);
  return ok({ item: doc });
}

export async function updateDevPlan(w: Who, body: any): Promise<Result> {
  const p = await getOne<DevPlan>(C.devPlans, str(body.id, 128), w.cid);
  if (!p) throw new PerfError(404, 'Plan not found.');
  const dir = await loadDirectory(w.cid);
  const rel = relationTo(w, dir, p.uid);
  if (rel === 'NONE') throw new PerfError(403, 'You cannot change this plan.');
  const actions = p.actions.map((a) => (a.id === str(body.actionId, 40) && body.done !== undefined ? { ...a, done: body.done === true } : a));
  let doc: DevPlan = { ...p, actions, updatedAt: nowIso() };
  if (body.status && rel !== 'SELF') {
    if (!['COMPLETED', 'CANCELLED'].includes(body.status)) throw new PerfError(400, 'Unknown status.');
    if (!str(body.outcomeNote, 800)) throw new PerfError(400, 'Record how the plan ended.');
    doc = { ...doc, status: body.status, outcomeNote: str(body.outcomeNote, 800) };
  }
  await put(C.devPlans, p.id, doc);
  await audit(w.cid, 'DEVPLAN', p.id, 'DEVPLAN_UPDATED', w);
  return ok({ item: doc });
}

// ------------------------------------------------------------------ dashboards

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 100) / 100 : null);

export async function dashboard(w: Who, q: any): Promise<Result> {
  const scope = str(q.scope, 20) || 'employee';
  const today = istToday();
  const dir = await loadDirectory(w.cid);
  const [reviews, cycles] = await Promise.all([list<Review>(C.reviews, w.cid), list<Cycle>(C.cycles, w.cid)]);
  const cyc = new Map(cycles.map((c) => [c.id, c]));

  if (scope === 'employee') {
    const mine = reviews.filter((r) => r.uid === w.uid && visibleToEmployee(r.status)).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    return ok({ scope, trend: mine.map((r) => ({ cycle: r.cycleName, periodEnd: r.periodEnd, overall: r.scores.overall, kra: r.scores.kra, behaviour: r.scores.behaviour, sop: r.scores.sop, band: r.scores.band })) });
  }
  if (scope === 'manager') {
    const team = reviews.filter((r) => r.managerUid === w.uid);
    const rows = team.map((r) => {
      const c = cyc.get(r.cycleId);
      return { id: r.id, employeeName: r.employeeName, cycleName: r.cycleName, status: r.status, overall: r.scores.overall, band: r.scores.band, partial: r.scores.partial, critical: r.scores.criticalFindings.length,
        deadline: r?.status === 'MANAGER_PENDING' ? c?.managerDeadline || '' : r.status === 'SELF_PENDING' ? c?.selfDeadline || '' : '', state: deadlineState(today, r.status === 'MANAGER_PENDING' ? c?.managerDeadline || '' : r.status === 'SELF_PENDING' ? c?.selfDeadline || '' : '') };
    });
    return ok({ scope, rows, reportsCount: dir.reportsOf(w.uid).length });
  }
  if (scope === 'hr' || scope === 'leadership') {
    if (scope === 'hr') needHrOrApprover(w);
    else if (!w.canView && !w.canManage && !w.canApprove) throw new PerfError(403, 'You cannot see company-wide results.');
    const cycleId = str(q.cycleId, 128) || [...cycles].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0]?.id || '';
    const rows = reviews.filter((r) => r.cycleId === cycleId);
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const finalRows = rows.filter((r) => isFinal(r.status) && r.scores.overall !== null);
    const depts = [...new Set(finalRows.map((r) => r.department || 'No department'))].sort();
    // Aggregates are only shown for groups big enough that nobody can be picked out.
    const departments = depts.map((d) => {
      const g = finalRows.filter((r) => (r.department || 'No department') === d);
      return g.length >= MIN_COHORT ? { department: d, count: g.length, average: avg(g.map((r) => r.scores.overall as number)), distribution: ratingDistribution(g.map((r) => r.scores.overall)) } : { department: d, count: g.length, hidden: true };
    });
    const out: any = {
      scope, cycleId, total: rows.length, byStatus, completion: rows.length ? Math.round((finalRows.length / rows.length) * 100) : 0,
      distribution: finalRows.length >= MIN_COHORT ? ratingDistribution(finalRows.map((r) => r.scores.overall)) : null,
      average: finalRows.length >= MIN_COHORT ? avg(finalRows.map((r) => r.scores.overall as number)) : null, departments, minCohort: MIN_COHORT,
    };
    if (scope === 'hr') {
      const c = cyc.get(cycleId);
      out.overdue = c ? rows.filter((r) => (r.status === 'SELF_PENDING' && deadlineState(today, c.selfDeadline) === 'OVERDUE') || (r.status === 'MANAGER_PENDING' && deadlineState(today, c.managerDeadline) === 'OVERDUE')
        || ((r.status === 'HR_REVIEW' || r.status === 'APPROVAL_PENDING') && deadlineState(today, c.hrDeadline) === 'OVERDUE')).map((r) => ({ id: r.id, employeeName: r.employeeName, status: r.status, managerName: r.managerName })) : [];
      const fr: RatingRow[] = rows.map((r) => ({ reviewId: r.id, uid: r.uid, managerUid: r.managerUid, overall: isFinal(r.status) || r.status === 'APPROVAL_PENDING' || r.status === 'HR_REVIEW' ? r.scores.overall : null,
        selfAverage: selfAverage(r), kpiCount: r.kpiAssessments.length, insufficientCount: r.kpiAssessments.filter((a) => a.insufficientEvidence).length }));
      out.fairness = fairnessFlags(fr).map((f) => ({ ...f, managerName: dir.nameOf(f.managerUid), employeeName: f.reviewId ? rows.find((r) => r.id === f.reviewId)?.employeeName || '' : '' }));
      out.openExceptions = (await list<PerfException>(C.exceptions, w.cid, { status: 'OPEN' })).length;
      out.pendingSops = (await list<SopAssignment>(C.assignments, w.cid, { status: 'ACTIVE', ackStatus: 'PENDING' })).length;
    }
    return ok(out);
  }
  throw new PerfError(400, 'Unknown dashboard.');
}

// ------------------------------------------------------------------ governance views

export async function auditLog(w: Who, q: any): Promise<Result> {
  needHrOrApprover(w);
  let rows = await list<any>(C.audit, w.cid);
  if (q.entity) rows = rows.filter((r) => r.entity === String(q.entity));
  if (q.entityId) rows = rows.filter((r) => r.entityId === String(q.entityId));
  return ok({ items: rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300) });
}

export async function getExceptions(w: Who, q: any): Promise<Result> {
  needHrOrApprover(w);
  let rows = await list<PerfException>(C.exceptions, w.cid);
  if (q.status) rows = rows.filter((r) => r.status === String(q.status));
  const dir = await loadDirectory(w.cid);
  return ok({ items: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 400).map((r) => ({ ...r, employeeName: r.uid ? dir.nameOf(r.uid) : '' })) });
}

export async function resolveException(w: Who, body: any): Promise<Result> {
  needManage(w);
  const e = await getOne<PerfException>(C.exceptions, str(body.id, 200), w.cid);
  if (!e) throw new PerfError(404, 'Item not found.');
  const doc: PerfException = { ...e, status: 'RESOLVED', resolvedAt: nowIso(), resolvedBy: w.name, resolution: str(body.resolution, 400) };
  await put(C.exceptions, e.id, doc);
  await audit(w.cid, 'EXCEPTION', e.id, 'EXCEPTION_RESOLVED', w);
  return ok({ item: doc });
}

export async function getNotifications(w: Who): Promise<Result> {
  const rows = await list<any>(C.notifications, w.cid, { uid: w.uid });
  return ok({ items: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60) });
}

export async function readNotifications(w: Who, body: any): Promise<Result> {
  const rows = await list<any>(C.notifications, w.cid, { uid: w.uid });
  const ids = Array.isArray(body.ids) && body.ids.length ? new Set(body.ids.map(String)) : null;
  await Promise.all(rows.filter((n) => !n.read && (!ids || ids.has(n.id))).map((n) => put(C.notifications, n.id, { ...n, read: true })));
  return ok({});
}

// ------------------------------------------------------------------ AI assistance (never decides, never scores)

const aiKey = () => {
  const k = (process.env.OPENAI_API_KEY || '').trim();
  return !k || k === 'MY_OPENAI_API_KEY' || (process.env.PERF_AI || '').trim().toLowerCase() === 'off' ? '' : k;
};

async function ask(system: string, user: string, maxTokens: number): Promise<string | null> {
  const key = aiKey();
  if (!key) return null;
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal: controller.signal,
      body: JSON.stringify({ model: (process.env.OPENAI_PERF_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(), temperature: 0, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!res.ok) return null;
    return String((await res.json())?.choices?.[0]?.message?.content || '').trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const AI_RULES = 'Use only the numbered evidence items given. Cite each sentence with its number like [2]. Do not rate, score, rank or recommend pay, promotion, discipline or termination. Do not comment on personality, attitude, emotions, health, family, age, gender, religion or any private matter. If the evidence is thin, say that plainly.';

/** A draft summary of the evidence for the manager to edit. Every sentence must cite real evidence or it is dropped. */
export async function aiReviewDraft(w: Who, body: any): Promise<Result> {
  const r = await getOne<Review>(C.reviews, str(body.id, 200), w.cid);
  if (!r) throw new PerfError(404, 'Review not found.');
  if (r.managerUid !== w.uid && !w.canManage) throw new PerfError(403, 'Only the reporting manager or HR can use this.');
  if (!aiKey()) return ok({ ai: false, message: 'AI drafting is not switched on. Write the summary yourself from the evidence list.' });
  const ev = (await list<Evidence>(C.evidence, w.cid, { uid: r.uid })).filter((e) => e.occurredAt >= r.periodStart && e.occurredAt <= r.periodEnd && e.status !== 'REJECTED').slice(0, 60);
  if (ev.length === 0) return ok({ ai: true, draft: '', message: 'There is no evidence in this period to summarise.' });
  const kpiName = (id: string) => r.kras.flatMap((k) => k.kpis).find((p) => p.id === id)?.code || 'KPI';
  const lines = ev.map((e, i) => `[${i + 1}] ${e.occurredAt} ${kpiName(e.kpiId)} (${e.status.toLowerCase()}): ${e.description || e.reference}${e.value !== null ? ` value ${e.value}` : ''}`).join('\n');
  const out = await ask(`You help a manager draft a factual summary of work evidence for a performance review. ${AI_RULES}`, `Evidence for ${r.employeeName} (${r.periodStart} to ${r.periodEnd}):\n${lines}`, 500);
  if (out === null) return ok({ ai: false, message: 'The AI service did not answer. Write the summary yourself from the evidence list.' });
  const f = filterAiSummary(out, ev.map((_, i) => i + 1));
  if (f.dropped > 0) await raise(w.cid, { category: 'AI_UNSUPPORTED', severity: 'LOW', message: `${f.dropped} AI sentence(s) were left out of a draft for ${r.employeeName} (${f.reasons[0]}).`, uid: r.uid, refId: r.id, key: `${r.id}__${Date.now()}` });
  await audit(w.cid, 'REVIEW', r.id, 'AI_DRAFT', w, null, { kept: f.kept.length, dropped: f.dropped });
  return ok({ ai: true, draft: f.kept, dropped: f.dropped, evidence: ev.map((e, i) => ({ n: i + 1, id: e.id })) });
}

const nums = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) || []).sort().join('|');

/** Suggests clearer wording for a KPI. It may not add or change any number: targets are agreed by people. */
export async function aiKpiWording(w: Who, body: any): Promise<Result> {
  if (!w.canManage && !(await loadDirectory(w.cid)).reportsOf(w.uid).length) throw new PerfError(403, 'Only managers and HR can use this.');
  const text = str(body.text, 400);
  if (!text) throw new PerfError(400, 'Type the KPI wording first.');
  const out = await ask('Rewrite this KPI description so it is specific and measurable. Do not add, remove or change any number, date or name. Do not invent targets. Reply with the rewritten text only.', text, 150);
  if (!out || out.length > text.length * 3 + 80 || nums(out) !== nums(text)) return ok({ ai: false, text });
  return ok({ ai: true, text: out });
}

// ------------------------------------------------------------------ daily job

export async function runPerfCron(): Promise<Result> {
  const snap = await db().collection(C.settings).get();
  const today = istToday();
  const month = monthOf(today);
  const out: any[] = [];
  const by = { name: 'System', uid: '' };
  for (const d of snap.docs) {
    const cid = d.id;
    try {
      const settings = await loadSettings(cid);
      if (settings.competencies.length === 0) continue;
      const dir = await loadDirectory(cid);
      const sync = await syncSops(cid, dir);
      const ctx = await planContext(cid, dir);
      let plans = 0;
      for (const p of dir.active) if ((await generatePlan(cid, p.uid, ctx, by)).created) plans++;

      let checkins = 0;
      for (const p of dir.active) {
        const mgr = dir.managerOf(p.uid);
        if (!mgr) continue;
        const id = checkinIdOf(cid, p.uid, month);
        if ((await db().collection(C.checkins).doc(id).get()).exists) continue;
        const now = nowIso();
        await put(C.checkins, id, { id, companyId: cid, uid: p.uid, employeeName: p.name, managerUid: mgr, month, progress: '', roadblocks: '', feedback: '', employeeNote: '', status: 'PENDING', doneAt: '', createdAt: now, updatedAt: now } as Checkin);
        checkins++;
        await tell(cid, [mgr], 'Monthly check-in', `Time for this month's check-in with ${p.name}.`, 'performance:team', `checkin__${id}`, dir);
      }

      // Cycles: retry reviews waiting on configuration, remind, and escalate what is overdue.
      const cycles = (await list<Cycle>(C.cycles, cid, { status: 'OPEN' }));
      let reminded = 0;
      let overdue = 0;
      for (const c of cycles) {
        await createReviews(cid, c, by);
        const reviews = await list<Review>(C.reviews, cid, { cycleId: c.id });
        for (const r of reviews) {
          const key = `${r.id}__${r.status}`;
          if (r.status === 'SELF_PENDING') {
            const st = deadlineState(today, c.selfDeadline);
            if (st === 'DUE_SOON') { await tell(cid, [r.uid], 'Self-assessment due soon', `Due ${c.selfDeadline}.`, 'performance:me', `soon__${key}`, dir); reminded++; }
            if (st === 'OVERDUE') { await tell(cid, [r.uid, r.managerUid], `Self-assessment overdue: ${r.employeeName}`, `It was due ${c.selfDeadline}.`, 'performance:me', `late__${key}`, dir); await raise(cid, { category: 'REVIEW_OVERDUE', severity: 'MEDIUM', message: `${r.employeeName}'s self-assessment is overdue.`, uid: r.uid, refId: r.id, key: `${key}__self` }); overdue++; }
          } else if (r.status === 'MANAGER_PENDING' || r.status === 'DISCUSSION_PENDING') {
            const st = deadlineState(today, c.managerDeadline);
            if (st === 'DUE_SOON') { await tell(cid, [r.managerUid], 'Review due soon', `${r.employeeName}'s review is due ${c.managerDeadline}.`, 'performance:team', `soon__${key}`, dir); reminded++; }
            if (st === 'OVERDUE') { await tell(cid, [r.managerUid, ...(await peopleWithPerm(cid, 'perf.manage'))], `Review overdue: ${r.employeeName}`, `It was due ${c.managerDeadline}.`, 'performance:team', `late__${key}`, dir); await raise(cid, { category: 'REVIEW_OVERDUE', severity: 'HIGH', message: `${r.employeeName}'s manager review is overdue (${dir.nameOf(r.managerUid) || 'no manager'}).`, uid: r.uid, refId: r.id, key: `${key}__mgr` }); overdue++; }
          } else if (r.status === 'HR_REVIEW' || r.status === 'APPROVAL_PENDING') {
            if (deadlineState(today, c.hrDeadline) === 'OVERDUE') { await raise(cid, { category: 'REVIEW_OVERDUE', severity: 'MEDIUM', message: `${r.employeeName}'s review is past the HR deadline.`, uid: r.uid, refId: r.id, key: `${key}__hr` }); overdue++; }
          }
        }
      }

      // SOPs: remind after a week, raise after two.
      let sopReminded = 0;
      for (const a of await list<SopAssignment>(C.assignments, cid, { status: 'ACTIVE', ackStatus: 'PENDING' })) {
        const age = daysBetween(a.assignedAt.slice(0, 10), today);
        if (age >= 7) { await tell(cid, [a.uid], 'SOP waiting for your acknowledgement', `${a.sopTitle} has been waiting ${age} days.`, 'performance:sops', `sopr__${a.id}`, dir); sopReminded++; }
        if (age >= 14) await raise(cid, { category: 'SOP_NOT_ACKNOWLEDGED', severity: 'LOW', message: `${dir.nameOf(a.uid)} has not acknowledged ${a.sopTitle}.`, uid: a.uid, refId: a.id, key: a.id });
      }
      const lowMood = await checkLowMood(cid, dir, () => peopleWithPerm(cid, 'perf.manage'));
      out.push({ companyId: cid, sync, plans, checkins, reminded, overdue, sopReminded, lowMood });
    } catch (err: any) {
      out.push({ companyId: cid, error: err?.message || String(err) });
    }
  }
  return ok({ today, companies: out });
}
