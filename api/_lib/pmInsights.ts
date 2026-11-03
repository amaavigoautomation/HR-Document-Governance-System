/**
 * HR-PM-008 (AI insights and dashboards) and HR-PM-009 (audit, exceptions, confidentiality).
 *  - Dashboards are computed from the records. Leadership sees groups of MIN_GROUP people or more, never an individual.
 *  - AI is optional and advisory. Without a key, or when it fails, a plain rule-based summary is shown and the manual review carries on.
 *    Any AI sentence that infers personality, motive, loyalty, health or a protected trait is thrown away and logged (AI_UNSUPPORTED).
 *  - Serious misconduct is never handled here: only a minimal confidential pointer is kept, so the right process can take over.
 */
import { MIN_GROUP, SETUP_SEQUENCE, UAT_CHECKS, WORKFLOWS, EXCEPTION_TYPES, fairnessFlags, isFinal, round, unsupportedInference } from '../../shared/pmEngine.js';
import { aiEnabled, aiJson } from './openaiHelper.js';
import { audit, fail, getK, groupBy, isMyReport, listK, managerOf, nowIso, ok, putK, raise, resolveException, saveSettings, settingsOf, str, today, newId, type C, type Item, type PmSettings, type Route, type Result } from './pmCore.js';
import { computeReview } from './pmReviews.js';
import { evidenceFor } from './pmEvidence.js';

// ------------------------------------------------------------------ "Start here" checklist (the order the specification recommends)

async function setupStatus(c: C): Promise<Result> {
  const [fw, sops, tpl, plans, cycles, reviews, ev, st] = await Promise.all([listK(c.cid, 'framework'), listK(c.cid, 'sop'), listK(c.cid, 'roleTemplate'), listK(c.cid, 'plan'), listK(c.cid, 'cycle'), listK(c.cid, 'review'), listK(c.cid, 'evidence'), settingsOf(c.cid)]);
  const activePlans = plans.filter((p) => p.status === 'ACTIVE').length;
  const live = plans.filter((p) => p.status !== 'SUPERSEDED');
  const pend = live.filter((p) => p.status === 'CONFIGURATION_PENDING').length;
  const step = (key: string, done: boolean, detail: string, go: string, count?: string) => ({ key, ...(SETUP_SEQUENCE.find((s) => s.key === key) as any), done, detail, go, count: count || '' });
  const steps = [
    step('competency', fw.some((f) => f.status === 'APPROVED'), fw.some((f) => f.status === 'APPROVED') ? 'Approved.' : fw.length ? 'A draft exists. Someone with approval rights must approve it.' : 'Press the button and a ready-made draft is created for you.', 'framework'),
    step('sops', sops.some((s) => s.status !== 'RETIRED'), sops.length ? `${sops.filter((s) => s.status !== 'RETIRED').length} SOP(s) defined.` : 'Pull them in from your controlled documents with one button.', 'sops', String(sops.length)),
    step('templates', tpl.some((t) => t.status === 'APPROVED'), tpl.some((t) => t.status === 'APPROVED') ? `${tpl.filter((t) => t.status === 'APPROVED').length} approved.` : 'Write what each role is measured on, then approve it.', 'templates', String(tpl.length)),
    step('assignment', activePlans > 0 && pend === 0, live.length === 0 ? 'Nothing assigned yet.' : `${activePlans} active, ${pend} waiting for setup.`, 'plans', `${activePlans}/${live.length}`),
    step('reviews', cycles.length > 0 && reviews.length > 0, reviews.length ? `${reviews.length} review(s) created.` : 'Create a review cycle, then press "Open reviews".', 'cycles', String(cycles.length)),
    step('tasks', ev.length > 0, ev.length ? `${ev.length} piece(s) of evidence.` : 'Add evidence by hand, upload a file, or connect your task system.', 'evidence', String(ev.length)),
    step('ai', !!st?.aiAcknowledged, aiEnabled() ? (st?.aiAcknowledged ? 'On. Humans still decide.' : 'Available. Turn it on when you are ready.') : 'Optional. Works with simple summaries even without AI.', 'ai'),
  ];
  const next = steps.find((s) => !s.done);
  return ok({ steps, next: next?.key || '', allDone: !next, aiAvailable: aiEnabled(), workflows: WORKFLOWS });
}

// ------------------------------------------------------------------ dashboards

async function myHome(c: C): Promise<Result> {
  const [reviews, checks, assigns, plans, devs, kra] = await Promise.all([listK(c.cid, 'review'), listK(c.cid, 'checkin'), listK(c.cid, 'sopAssign'), listK(c.cid, 'plan'), listK(c.cid, 'devPlan'), listK(c.cid, 'kraAck')]);
  const me = c.ctx.uid;
  const myReviews = reviews.filter((r) => r.uid === me);
  const todo: { text: string; go: string; id?: string }[] = [];
  const myPlan = plans.find((p) => p.uid === me && p.status !== 'SUPERSEDED' && ['APPROVED'].includes(p.status));
  if (myPlan && !kra.some((k) => k.planId === myPlan.id)) todo.push({ text: 'Read and acknowledge your KRA/KPI', go: 'mine' });
  for (const a of assigns.filter((x) => x.uid === me && x.status === 'ASSIGNED' && x.acknowledgementRequired)) todo.push({ text: `Read and acknowledge the SOP "${a.title}"`, go: 'mine', id: a.id });
  for (const r of myReviews) {
    if (r.status === 'OPEN') todo.push({ text: `Write your self-assessment for ${r.cycleName}`, go: 'review', id: r.id });
    if (r.status === 'PUBLISHED') todo.push({ text: `Read your ${r.cycleName} review and respond`, go: 'review', id: r.id });
  }
  const team = reviews.filter((r) => isMyReport(c, r.uid) || r.managerUid === me);
  for (const r of team) {
    if (['SELF_ASSESSED', 'MANAGER_EVALUATED'].includes(r.status)) todo.push({ text: `Evaluate ${r.employeeName} (${r.cycleName})`, go: 'review', id: r.id });
    if (r.status === 'MANAGER_EVALUATED') todo.push({ text: `Hold and record the feedback discussion with ${r.employeeName}`, go: 'review', id: r.id });
  }
  for (const ci of checks.filter((x) => x.managerUid === me && x.status === 'DUE')) todo.push({ text: `Monthly check-in with ${ci.employeeName}`, go: 'checkins', id: ci.id });
  if (c.isApprover) for (const r of reviews.filter((x) => x.status === 'HR_REVIEWED' && x.uid !== me)) todo.push({ text: `Approve ${r.employeeName}'s review`, go: 'review', id: r.id });
  if (c.isHr) for (const r of reviews.filter((x) => x.status === 'DISCUSSED' && x.uid !== me)) todo.push({ text: `Check ${r.employeeName}'s review`, go: 'review', id: r.id });
  const exs = c.isHr ? (await listK(c.cid, 'exception')).filter((e) => e.status === 'OPEN').length : 0;
  return ok({
    todo, openExceptions: exs, isManager: team.length > 0 || c.people.some((p) => managerOf(c, p.uid) === me), isHr: c.isHr, isApprover: c.isApprover, canViewAggregate: c.canViewAggregate,
    myReviews: myReviews.map((r) => ({ id: r.id, cycleName: r.cycleName, status: r.status, finalRating: employeeCanSee(r) ? r.final?.finalRating ?? null : null })),
    myCheckins: checks.filter((x) => x.uid === me && x.status === 'DONE').length, myDev: devs.filter((d) => d.uid === me && d.status === 'ACTIVE').length,
  });
}
const employeeCanSee = (r: Item) => ['PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED'].includes(r.status);

/** Department head, HR and leadership views. Small groups are hidden so nobody can be picked out. */
async function dashboard(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  if (!c.canViewAggregate) return fail(403, 'You do not have access to these figures.');
  const cycleId = str(q.cycleId, 80);
  let reviews = await listK(c.cid, 'review');
  const cycles = await listK(c.cid, 'cycle');
  if (cycleId) reviews = reviews.filter((r) => r.cycleId === cycleId);
  const scopeDepts = !c.isHr && !c.isApprover && !c.ctx.perms.includes('pm.view') ? c.headOf : null;
  if (scopeDepts) reviews = reviews.filter((r) => scopeDepts.includes(r.department));
  const done = (r: Item) => isFinal(r.status) && r.final;
  const byDept = [...groupBy(reviews, (r) => r.department || 'No department')].map(([department, list]) => {
    const scored = list.filter(done);
    if (list.length < MIN_GROUP) return { department, people: list.length, hidden: true };
    const avg = scored.length >= MIN_GROUP ? round(scored.reduce((s, r) => s + (r.final.overall ?? 0), 0) / scored.length) : null;
    return { department, people: list.length, completed: scored.length, average: avg, hidden: false };
  });
  const statusCounts: Record<string, number> = {};
  for (const r of reviews) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
  const scored = reviews.filter(done);
  const dist: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  if (scored.length >= MIN_GROUP) for (const r of scored) dist[String(r.final.finalRating)] = (dist[String(r.final.finalRating)] || 0) + 1;
  const [assigns, plans, evidence] = await Promise.all([listK(c.cid, 'sopAssign'), listK(c.cid, 'plan'), listK(c.cid, 'evidence')]);
  const liveAssign = assigns.filter((a) => a.status !== 'ENDED' && a.status !== 'SUPERSEDED');
  const t = today();
  const ds = scopeDepts ? new Set(c.people.filter((p) => scopeDepts.includes(p.department)).map((p) => p.uid)) : null;
  const inScope = <T extends Item>(l: T[]) => (ds ? l.filter((x) => ds.has(x.uid)) : l);
  const sopA = inScope(liveAssign);
  return ok({
    cycles: cycles.map((x) => ({ id: x.id, name: x.name })), reviewsTotal: reviews.length, statusCounts, completionPct: reviews.length ? Math.round((reviews.filter((r) => isFinal(r.status)).length / reviews.length) * 100) : 0,
    overdue: reviews.filter((r) => !isFinal(r.status) && !['DEFERRED', 'CONFIGURATION_PENDING'].includes(r.status) && (r.status === 'OPEN' ? r.selfReviewDeadline : r.managerDeadline) && (r.status === 'OPEN' ? r.selfReviewDeadline : r.managerDeadline) < t).length,
    waiting: reviews.filter((r) => r.status === 'CONFIGURATION_PENDING').length, disputed: reviews.filter((r) => r.status === 'DISPUTED').length,
    byDepartment: byDept, distribution: scored.length >= MIN_GROUP ? dist : null, distributionHidden: scored.length < MIN_GROUP && scored.length > 0, minGroup: MIN_GROUP,
    sop: { assigned: sopA.length, acknowledged: sopA.filter((a) => a.acknowledgementRequired === false || a.status === 'ACKNOWLEDGED').length, trainingPending: sopA.filter((a) => a.training === 'PENDING').length, verificationPending: sopA.filter((a) => a.managerVerification === 'PENDING').length },
    plans: { active: inScope(plans).filter((p) => p.status === 'ACTIVE').length, waiting: inScope(plans).filter((p) => p.status === 'CONFIGURATION_PENDING').length, none: c.people.filter((p) => p.active && (!ds || ds.has(p.uid)) && !plans.some((x) => x.uid === p.uid && x.status !== 'SUPERSEDED')).length },
    evidence: { total: inScope(evidence).length, unverified: inScope(evidence).filter((e) => e.status === 'PENDING_VERIFICATION' || e.status === 'UNMAPPED').length },
    scope: scopeDepts ? scopeDepts.join(', ') : 'Whole company',
  });
}

// ------------------------------------------------------------------ fairness (HR only, aggregated)

async function fairness(c: C): Promise<Result> {
  const reviews = (await listK(c.cid, 'review')).filter((r) => isFinal(r.status) && r.final);
  const rows = reviews.map((r) => ({ managerUid: r.managerUid, managerName: r.managerName, overall: r.final.overall as number | null, insufficient: (r.kpis || []).filter((k: any) => k.insufficientEvidence).length, ratedWithoutEvidence: (r.kpis || []).filter((k: any) => (k.rating ?? 0) >= 4 && !(k.evidenceIds || []).length).length }));
  return ok({ flags: fairnessFlags(rows), reviewed: rows.length, note: 'These are patterns to look at, not conclusions. Nothing here changes any score.' });
}

// ------------------------------------------------------------------ AI insights

const CAPS = ['SELF_SUMMARY', 'MANAGER_SUMMARY', 'EVIDENCE_GAPS', 'CONSISTENCY', 'TRAINING', 'ANNUAL', 'FAIRNESS', 'WORDING'] as const;
const CAP_PROMPT: Record<string, string> = {
  SELF_SUMMARY: 'Summarise the employee\'s self-assessment in three plain sentences.', MANAGER_SUMMARY: 'Summarise the manager\'s evaluation in three plain sentences.',
  EVIDENCE_GAPS: 'List which KPIs or competencies have no evidence attached.', CONSISTENCY: 'Point out places where ratings, comments and evidence disagree.',
  TRAINING: 'Suggest training topics, based only on the written development needs and low ratings.', ANNUAL: 'Summarise the year from the reviews and check-ins.',
  FAIRNESS: 'Suggest neutral wording improvements that remove vague or biased phrasing.', WORDING: 'Rewrite the comments to be specific and behaviour-based.',
};

function ruleBased(cap: string, rv: Item, v: Awaited<ReturnType<typeof computeReview>>): string[] {
  const out: string[] = [];
  if (cap === 'EVIDENCE_GAPS') {
    for (const k of rv.kpis || []) if (!(k.evidenceIds || []).length) out.push(`KPI "${k.kpiName}" has no evidence attached.`);
    for (const x of v.comps) if (x.managerRating && x.managerRating !== 'NOT_OBSERVED' && !x.observedExamples) out.push(`Competency "${x.name}" is rated without an observed example.`);
  } else if (cap === 'CONSISTENCY') for (const f of v.flags) out.push(f.message);
  else if (cap === 'TRAINING') {
    for (const x of v.comps) if (typeof x.managerRating === 'number' && x.managerRating <= 2) out.push(`Consider support on "${x.name}" (rated ${x.managerRating}).`);
    if (rv.self?.trainingNeeds) out.push(`Employee asked for: ${rv.self.trainingNeeds}`);
    if (rv.manager?.trainingNeeds) out.push(`Manager noted: ${rv.manager.trainingNeeds}`);
  } else if (cap === 'SELF_SUMMARY') { if (rv.self?.achievements) out.push(String(rv.self.achievements).slice(0, 400)); }
  else if (cap === 'MANAGER_SUMMARY') { if (rv.manager?.evaluation) out.push(String(rv.manager.evaluation).slice(0, 400)); }
  else out.push('Use specific, observable examples (what happened, when, what the result was). Avoid words like "always", "never" or comments about personality.');
  return out.length ? out : ['Nothing to report.'];
}

async function aiInsight(c: C, b: any): Promise<Result> {
  const cap = str(b.capability, 20).toUpperCase();
  if (!(CAPS as readonly string[]).includes(cap)) return fail(400, 'Unknown insight.');
  const rv = await getK(c.cid, str(b.reviewId, 160), 'review');
  if (!rv) return fail(404, 'That review was not found.');
  if (rv.uid === c.ctx.uid) return fail(403, 'Insights are for the people who evaluate a review.');
  if (!(isMyReport(c, rv.uid) || c.isHr || c.isApprover)) return fail(403, 'You do not have access to this review.');
  const v = await computeReview(c, rv);
  const set = await settingsOf(c.cid);
  const plain = ruleBased(cap, rv, v);
  let lines = plain; let source: 'AI' | 'RULES' = 'RULES'; let note = '';
  if (aiEnabled() && set?.aiAcknowledged) {
    const facts = JSON.stringify({ self: rv.self, manager: rv.manager, kpis: (rv.kpis || []).map((k: any) => ({ name: k.kpiName, rating: k.rating, note: k.managerNote, evidence: (k.evidenceIds || []).length })), competencies: v.comps.map((x) => ({ name: x.name, rating: x.managerRating, example: x.observedExamples })) }).slice(0, 6000);
    const r = await aiJson({ cid: c.cid, feature: 'pm-insight', system: `You help a manager review work performance. Use ONLY the facts given. Never infer personality, motivation, loyalty, health, age, gender, religion or any protected trait. Never recommend discipline or dismissal. Answer as JSON: {"points": ["..."]} with at most 6 short points. Task: ${CAP_PROMPT[cap]}`, user: facts, cacheKey: `${rv.id}|${cap}|${facts.length}|${rv.updatedAt || ''}`, maxTokens: 600 });
    if (r.data && Array.isArray(r.data.points)) {
      const pts: string[] = r.data.points.map((x: any) => str(x, 400)).filter(Boolean);
      const bad = pts.find((p) => unsupportedInference(p));
      if (bad) { await raise(c, 'AI_UNSUPPORTED', { refId: `${rv.id}_${cap}_${Date.now().toString(36)}`, subjectUid: rv.uid, refLabel: rv.employeeName, detail: `An AI answer was discarded because it made a claim the facts do not support ("${unsupportedInference(bad)}"). The plain summary is shown instead.`, ownerUid: c.ctx.uid }); note = 'The AI answer was discarded because it went beyond the facts. A plain summary is shown.'; }
      else if (pts.length) { lines = pts; source = 'AI'; }
    } else if (r.error) note = 'AI is not available right now. You can carry on without it.';
  } else if (!aiEnabled()) note = 'AI is not switched on for this system. This is a simple rule-based summary.';
  else note = 'AI is off until HR turns it on. This is a simple rule-based summary.';
  await audit(c, 'review', rv.id, `INSIGHT_${cap}`, null, { source }, rv.uid);
  return ok({ capability: cap, source, points: lines, note, disclaimer: 'Suggestions only. A person makes every decision.' });
}

async function aiSettings(c: C, b: any): Promise<Result> {
  const cur = (await settingsOf(c.cid)) || ({ id: `pmset_${c.cid}`, companyId: c.cid, kind: 'setting', webhookKey: '', aiAcknowledged: false } as PmSettings);
  if (b.aiAcknowledged !== undefined) {
    const next = { ...cur, aiAcknowledged: b.aiAcknowledged === true }; await saveSettings(next);
    await audit(c, 'setting', cur.id, next.aiAcknowledged ? 'AI_ON' : 'AI_OFF', { on: cur.aiAcknowledged }, { on: next.aiAcknowledged });
    return ok({ aiAcknowledged: next.aiAcknowledged });
  }
  return ok({ aiAcknowledged: !!cur.aiAcknowledged, aiAvailable: aiEnabled() });
}

// ------------------------------------------------------------------ annual summary (employee, one person)

async function annual(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const uid = str(q.uid, 120) || c.ctx.uid;
  if (uid !== c.ctx.uid && !(isMyReport(c, uid) || c.isHr || c.isApprover)) return fail(403, 'You do not have access to this person\'s summary.');
  const year = str(q.year, 4) || today().slice(0, 4);
  const [reviews, checks, devs] = await Promise.all([listK(c.cid, 'review'), listK(c.cid, 'checkin'), listK(c.cid, 'devPlan')]);
  const mineOnly = uid === c.ctx.uid && !c.isHr && !c.isApprover;
  const rs = reviews.filter((r) => r.uid === uid && String(r.periodEnd).startsWith(year) && (!mineOnly || employeeCanSee(r)));
  return ok({
    year, reviews: rs.map((r) => ({ id: r.id, cycleName: r.cycleName, reviewType: r.reviewType, status: r.status, overall: r.final?.overall ?? null, finalRating: r.final?.finalRating ?? null, band: r.final?.band || '' })),
    checkins: checks.filter((x) => x.uid === uid && x.month.startsWith(year) && x.status === 'DONE').length, devPlans: devs.filter((d) => d.uid === uid && String(d.createdAt).startsWith(year) && !(mineOnly && d.status === 'PROPOSED')).length,
  });
}

// ------------------------------------------------------------------ governance (HR-PM-009)

async function auditList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  let items = await listK(c.cid, 'audit');
  if (q.entity) items = items.filter((x) => x.entity === str(q.entity, 40));
  if (q.entityId) items = items.filter((x) => x.entityId === str(q.entityId, 160));
  if (q.subjectUid) items = items.filter((x) => x.subjectUid === str(q.subjectUid, 120));
  return ok({ items: items.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 300) });
}

async function exceptionList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  let items = await listK(c.cid, 'exception');
  if (q.status) items = items.filter((x) => x.status === str(q.status, 10));
  return ok({ items: items.sort((a, b) => String(b.raisedAt).localeCompare(String(a.raisedAt))).slice(0, 300), types: EXCEPTION_TYPES });
}

async function exceptionResolve(c: C, b: any): Promise<Result> {
  const note = str(b.note, 600);
  if (note.length < 3) return fail(400, 'Write how this was handled.');
  const it = await resolveException(c, str(b.id, 160), note);
  return it ? ok({ item: it }) : fail(404, 'That item was not found.');
}

/** Section 12: serious misconduct is not a performance matter. Only a minimal, restricted pointer is stored. */
async function misconduct(c: C, b: any): Promise<Result> {
  const subject = c.byKey.get(str(b.uid, 120));
  if (!subject) return fail(400, 'Choose the person this concerns.');
  if (!(c.isHr || isMyReport(c, subject.uid))) return fail(403, 'Raise this with HR directly.');
  const id = newId();
  await putK({ id, companyId: c.cid, kind: 'exception', type: 'MISCONDUCT_REFERRAL', label: 'Serious misconduct allegation', requiredBehaviour: 'Separate confidential investigation process', ownerUid: '', ownerName: '', refId: id, refLabel: 'Confidential', subjectUid: '', subjectName: '', detail: 'A confidential matter was referred out of Performance. Details are deliberately not kept here.', status: 'OPEN', occurrences: 1, raisedAt: nowIso(), restricted: true, referredByUid: c.ctx.uid });
  await audit(c, 'referral', id, 'MISCONDUCT_REFERRED', null, { note: 'referred' });
  return ok({ message: 'Referred. This was recorded only as a confidential pointer. Please now follow your company\'s separate investigation process; do not put details in Performance.' });
}

async function launchChecks(c: C): Promise<Result> {
  return ok({ checks: UAT_CHECKS.map((t, i) => ({ n: i + 1, text: t })), note: 'Each of these is verified by the automated tests that ship with this module.' });
}

export const INSIGHT_ROUTES: Record<string, Route> = {
  'setup-status': { method: 'GET', who: 'hr', run: (c) => setupStatus(c) },
  home: { method: 'GET', who: 'any', run: (c) => myHome(c) },
  dashboard: { method: 'GET', who: 'aggregate', run: (c, b, q) => dashboard(c, b, q) },
  fairness: { method: 'GET', who: 'hr', run: (c) => fairness(c) },
  'ai-insight': { method: 'POST', who: 'any', run: (c, b) => aiInsight(c, b) },
  'ai-settings': { method: 'POST', who: 'hr', run: (c, b) => aiSettings(c, b) },
  annual: { method: 'GET', who: 'any', run: (c, b, q) => annual(c, b, q) },
  'audit-list': { method: 'GET', who: 'hr', run: (c, b, q) => auditList(c, b, q) },
  'exception-list': { method: 'GET', who: 'hr', run: (c, b, q) => exceptionList(c, b, q) },
  'exception-resolve': { method: 'POST', who: 'hr', run: (c, b) => exceptionResolve(c, b) },
  'misconduct-refer': { method: 'POST', who: 'any', run: (c, b) => misconduct(c, b) },
  'launch-checks': { method: 'GET', who: 'hr', run: (c) => launchChecks(c) },
};
export { evidenceFor };
