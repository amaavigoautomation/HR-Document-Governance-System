/**
 * After the review: a development, improvement or recognition plan (proposed by the system, confirmed by the manager),
 * plus reports for HR and leadership, the exception list, and the AI review draft.
 * AI only drafts text from documented work. It never rates, never decides, and anything about personality, motive or health is thrown away.
 */
import { aiEnabled, aiJson } from './openaiHelper.js';
import { GROWTH_WORDS, addDays, daysBetween, growthFor, isDate, unsupportedInference, type GrowthType } from '../../shared/pmEngine.js';
import {
  EXCEPTIONS, active, audit, bad, canSee, clear, db, denied, get, hrUids, isManagerOf, list, lc, newId, notFound, nowIso, ok, put, raise,
  remindNow, settingsOf, str, tell, today,
  type C, type Doc, type Result, type Route,
} from './pmCore.js';

const lines = (t: string) => (t || '').split(/\r?\n|;|•/).map((x) => str(x, 200)).filter((x) => x.length > 2).slice(0, 8);

/** Called when a review is shared. Once per review. */
export async function proposeGrowth(c: C, rv: Doc): Promise<void> {
  const id = `${rv.id}_growth`;
  if (await get(c.cid, 'growth', id)) return;
  const type: GrowthType = growthFor(rv.score?.overall ?? null);
  const m = rv.manager || {};
  const objective = type === 'IMPROVEMENT' ? m.improve : type === 'RECOGNITION' ? m.strengths : m.training || m.improve;
  await put('growth', {
    id, companyId: c.cid, uid: rv.uid, name: rv.name, managerUid: rv.managerUid, managerName: rv.managerName, reviewId: rv.id, cycleName: rv.cycleName,
    type, status: 'PROPOSED', objective: str(objective, 1000), expected: '', support: '',
    actions: lines(type === 'RECOGNITION' ? '' : `${m.training || ''}\n${rv.self?.training || ''}`).map((text) => ({ text, done: false })),
    reviewDate: addDays(today(), type === 'IMPROVEMENT' ? 45 : 60), outcome: '', proposedOn: today(),
  });
  await audit(c, id, 'GROWTH_PROPOSED', `${GROWTH_WORDS[type]} after ${rv.cycleName} (score ${rv.score?.overall ?? '-'})`, rv.uid);
  await tell(c, [rv.managerUid], `Confirm ${rv.name}'s ${GROWTH_WORDS[type].toLowerCase()}`, `Based on the ${rv.cycleName} review, a ${GROWTH_WORDS[type].toLowerCase()} has been drafted for ${rv.name}. Check it and press "Confirm".`);
}

/** Training needs from the review go to HRBP's list (once each). */
export async function feedHrbp(c: C, rv: Doc): Promise<void> {
  const seen = new Set<string>(); let i = 0;
  for (const skill of lines(`${rv.manager?.training || ''}\n${rv.self?.training || ''}`)) {
    if (seen.has(lc(skill))) continue; seen.add(lc(skill));
    const id = `pmneed_${rv.id}_${i++}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 150);
    const ref = db().collection('hrbpItems').doc(id);
    if (!(await ref.get()).exists) await ref.set({ id, companyId: c.cid, kind: 'trainingNeed', employeeUid: rv.uid, employeeName: rv.name, skill, source: 'REVIEW', priority: 'MEDIUM', status: 'OPEN', notes: `From the ${rv.cycleName} review`, createdAt: nowIso(), updatedAt: nowIso() });
  }
}

async function growthSave(c: C, b: any): Promise<Result> {
  const g = await get(c.cid, 'growth', str(b.id, 200));
  if (!g) return notFound('The plan');
  if (g.uid === c.ctx.uid) return denied('Your manager confirms this plan.');
  if (!isManagerOf(c, g.uid) && !c.isHr) return denied();
  if (!['PROPOSED', 'ACTIVE'].includes(g.status)) return bad('This plan is closed.');
  const type: GrowthType = ['IMPROVEMENT', 'DEVELOPMENT', 'RECOGNITION'].includes(b.type) ? b.type : g.type;
  const actions = (Array.isArray(b.actions) ? b.actions : []).slice(0, 12).map((a: any) => ({ text: str(a?.text ?? a, 200), done: a?.done === true })).filter((a: any) => a.text);
  const next: Doc = { ...g, type, objective: str(b.objective, 1000), expected: str(b.expected, 1000), support: str(b.support, 1000), actions, reviewDate: str(b.reviewDate, 10) };
  if (b.confirm === true) {
    if (next.objective.length < 5) return bad('Write the objective (what should change or be recognised).');
    if (!isDate(next.reviewDate) || next.reviewDate <= today()) return bad('Pick a follow-up date in the future.');
    if (type !== 'RECOGNITION' && !actions.length) return bad('Add at least one action (training, coaching, a stretch task…).');
    if (type === 'IMPROVEMENT' && (next.expected.length < 5 || next.support.length < 5)) return bad('An improvement plan needs the expected standard and the support you will give. This keeps it fair.');
    next.status = 'ACTIVE'; next.confirmedBy = c.who; next.confirmedAt = nowIso();
  }
  await put('growth', next);
  await audit(c, g.id, b.confirm === true ? 'GROWTH_CONFIRMED' : 'GROWTH_SAVED', `${GROWTH_WORDS[type]}: ${next.objective}`, g.uid);
  if (b.confirm === true) await tell(c, [g.uid], `Your ${GROWTH_WORDS[type].toLowerCase()}`, `${c.who} confirmed your ${GROWTH_WORDS[type].toLowerCase()} after the ${g.cycleName} review. See My performance → Growth.`);
  return ok({ item: next, message: b.confirm === true ? 'Confirmed and shared with the employee.' : 'Saved.' });
}

async function growthAction(c: C, b: any): Promise<Result> {
  const g = await get(c.cid, 'growth', str(b.id, 200));
  if (!g || (g.uid !== c.ctx.uid && !isManagerOf(c, g.uid) && !c.isHr)) return notFound('The plan');
  if (g.status !== 'ACTIVE') return bad('This plan is not in progress.');
  const i = Number(b.index);
  if (!Number.isInteger(i) || !g.actions[i]) return bad('Pick an action.');
  const actions = g.actions.map((a: any, j: number) => (j === i ? { ...a, done: b.done === true, doneOn: b.done === true ? today() : '' } : a));
  const next = await put('growth', { ...g, actions });
  return ok({ item: next });
}

async function growthClose(c: C, b: any): Promise<Result> {
  const g = await get(c.cid, 'growth', str(b.id, 200));
  if (!g) return notFound('The plan');
  if (g.uid === c.ctx.uid || (!isManagerOf(c, g.uid) && !c.isHr)) return denied();
  const cancel = b.cancel === true; const outcome = str(b.outcome, 1500);
  if (outcome.length < 5) return bad(cancel ? 'Write why it is cancelled.' : 'Write the outcome (what happened).');
  const next = await put('growth', { ...g, status: cancel ? 'CANCELLED' : 'DONE', outcome, closedBy: c.who, closedOn: today() });
  await audit(c, g.id, cancel ? 'GROWTH_CANCELLED' : 'GROWTH_DONE', outcome, g.uid);
  return ok({ item: next, message: cancel ? 'Cancelled.' : 'Completed.' });
}

export async function growthReminders(c: C): Promise<{ reminded: number }> {
  const s = await settingsOf(c.cid);
  let reminded = 0;
  for (const g of await list(c.cid, 'growth')) {
    if (g.status === 'PROPOSED' && daysBetween(g.proposedOn, today()) >= s.timing.remindEvery && remindNow(g, 'confirm', s.timing.remindEvery)) {
      await put('growth', g); reminded++;
      await tell(c, [g.managerUid], `Confirm ${g.name}'s ${GROWTH_WORDS[g.type as GrowthType].toLowerCase()}`, 'It is still waiting for you to confirm.');
    } else if (g.status === 'ACTIVE' && g.reviewDate <= today() && remindNow(g, 'follow', s.timing.remindEvery * 2)) {
      await put('growth', g); reminded++;
      await tell(c, [g.managerUid], `Follow up: ${g.name}'s ${GROWTH_WORDS[g.type as GrowthType].toLowerCase()}`, `The follow-up date (${g.reviewDate}) has come. Review progress with ${g.name} and record the outcome.`);
    }
  }
  return { reminded };
}

// ------------------------------------------------------------------ AI review draft (manager only)

/** Drafts strengths / areas to improve / training from documented work. Names never leave the app. */
async function aiDraft(c: C, b: any): Promise<Result> {
  const rv = await get(c.cid, 'reviews', str(b.id, 200));
  if (!rv || rv.uid === c.ctx.uid || !isManagerOf(c, rv.uid) || rv.status !== 'MANAGER') return denied('Only the manager can draft this review.');
  const ev = (await list(c.cid, 'evidence', { uid: rv.uid })).filter((e) => e.status === 'VERIFIED' && e.date >= rv.from && e.date <= rv.to);
  const checkins = (await list(c.cid, 'checkins', { uid: rv.uid })).filter((x) => x.status === 'DONE' && x.month >= rv.from.slice(0, 7) && x.month <= rv.to.slice(0, 7));
  const perKpi = rv.snap.kpis.map((k: any) => ({ kpi: k.kpi, target: k.target, work: ev.filter((e) => e.kpiId === k.id).map((e) => e.title).slice(0, 12) }));
  // The plain draft: always available, used when AI is off or fails.
  const withWork = perKpi.filter((k: any) => k.work.length); const without = perKpi.filter((k: any) => !k.work.length);
  const plain = {
    strengths: withWork.length ? withWork.map((k: any) => `${k.kpi}: ${k.work.length} verified item(s), e.g. ${k.work.slice(0, 2).join(', ')}.`).join('\n') : '',
    improve: without.length ? `No verified work recorded this quarter for: ${without.map((k: any) => k.kpi).join('; ')}. Discuss whether this reflects the work or missing records.` : '',
    training: '',
  };
  const s = await settingsOf(c.cid);
  if (!aiEnabled() || !s.aiOn) return ok({ draft: plain, ai: false, note: 'AI is off, so this draft is built from the recorded work only.' });
  const r = await aiJson({
    cid: c.cid, feature: 'pm_review_draft', maxTokens: 900, cacheKey: JSON.stringify({ perKpi, n: checkins.length }),
    system: 'You help a manager draft a factual quarterly performance review. Use ONLY the facts given (KPIs, targets, verified work, check-in notes). Do not rate, do not give a score, do not mention personality, motivation, attitude, loyalty, health, family or any personal trait. Refer to the person as "the employee". Reply as JSON {"strengths":"...","improve":"...","training":"..."}; each a few short lines.',
    user: JSON.stringify({ kpis: perKpi, checkins: checkins.map((x) => ({ month: x.month, wentWell: x.wentWell, blockers: x.blockers, managerComment: x.managerComment })) }),
  });
  if (!r.data) return ok({ draft: plain, ai: false, note: r.error ? `AI could not answer (${r.error}). Draft built from the recorded work instead.` : 'Draft built from the recorded work.' });
  const draft = { strengths: str(r.data.strengths, 2000), improve: str(r.data.improve, 2000), training: str(r.data.training, 1000) };
  const badWord = unsupportedInference(`${draft.strengths} ${draft.improve} ${draft.training}`);
  if (badWord) {
    await raise(c, 'AI_DISCARDED', `${rv.id}_${Date.now().toString(36)}`, { subjectUid: rv.uid, text: `An AI review draft was discarded because it went beyond the documented work ("${badWord}").` });
    return ok({ draft: plain, ai: false, note: 'The AI draft went beyond the facts, so it was thrown away. This draft is built from the recorded work.' });
  }
  return ok({ draft, ai: true, note: 'AI draft from the recorded work. Check every line and change anything that is not right before using it.' });
}

// ------------------------------------------------------------------ exceptions and reports

async function exceptionList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const all = (await list(c.cid, 'log')).filter((x) => x.kind === 'EXCEPTION');
  const showResolved = q.all === '1';
  const order: Record<string, number> = { BLOCK: 0, REMIND: 1, LOG: 2 };
  const items = all.filter((x) => showResolved || x.status === 'OPEN').sort((a, b) => (a.status === b.status ? 0 : a.status === 'OPEN' ? -1 : 1) || order[a.behaviour] - order[b.behaviour] || String(b.openedAt).localeCompare(String(a.openedAt)));
  return ok({ items, labels: EXCEPTIONS });
}

async function exceptionResolve(c: C, b: any): Promise<Result> {
  const x = await get(c.cid, 'log', str(b.id, 160));
  if (!x || x.kind !== 'EXCEPTION') return notFound('That item');
  const note = str(b.note, 400);
  if (note.length < 3) return bad('Write what was done.');
  await clear(c, x.code, x.ref, note);
  return ok({ message: 'Marked as handled.' });
}

/** Grouped figures. Leadership sees groups only; individual scores stay with HR, approvers and the manager. */
async function report(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const [reviews, plans, checkins, growth, logs] = await Promise.all([list(c.cid, 'reviews'), list(c.cid, 'plans'), list(c.cid, 'checkins'), list(c.cid, 'growth'), list(c.cid, 'log')]);
  const cycles = Array.from(new Set(reviews.map((r) => r.cycleKey))).sort().reverse();
  const cycle = str(q.cycle, 10) || cycles[0] || '';
  const rs = reviews.filter((r) => r.cycleKey === cycle);
  const done = rs.filter((r) => ['PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED', 'RESOLVED'].includes(r.status));
  const scoredRows = done.filter((r) => typeof r.score?.overall === 'number');
  const dist: Record<string, number> = { 'Below Standard': 0, Developing: 0, 'Meets Standard': 0, 'Exceeds Standard': 0, Exemplary: 0 };
  for (const r of scoredRows) dist[r.score.band] = (dist[r.score.band] || 0) + 1;
  const byDept = new Map<string, number[]>();
  for (const r of scoredRows) { const d = r.snap?.department || 'No department'; byDept.set(d, [...(byDept.get(d) || []), r.score.overall]); }
  const status: Record<string, number> = {};
  for (const r of rs) status[r.status] = (status[r.status] || 0) + 1;
  const openPlans = plans.filter((p) => p.status !== 'CLOSED');
  const sopsAll = openPlans.flatMap((p) => p.sops || []);
  const month = today().slice(0, 7);
  const ciMonth = checkins.filter((x) => x.month === month);
  return ok({
    cycle, cycles, total: rs.length, status, done: done.length, disputed: rs.filter((r) => r.status === 'DISPUTED').length,
    distribution: dist, departments: Array.from(byDept.entries()).map(([d, l]) => ({ department: d, people: l.length, average: l.length >= 3 ? Math.round((l.reduce((a, x) => a + x, 0) / l.length) * 100) / 100 : null })).sort((a, b) => a.department.localeCompare(b.department)),
    criticalFlags: rs.filter((r) => r.score?.criticalBreach).length,
    plans: { active: openPlans.filter((p) => p.status === 'ACTIVE').length, waiting: openPlans.filter((p) => p.status !== 'ACTIVE').length, onHold: openPlans.filter((p) => p.status === 'ON_HOLD').length },
    sopAck: { total: sopsAll.length, acknowledged: sopsAll.filter((x: any) => x.ackAt).length },
    checkins: { month, total: ciMonth.length, done: ciMonth.filter((x) => x.status === 'DONE').length },
    growth: { proposed: growth.filter((g) => g.status === 'PROPOSED').length, active: growth.filter((g) => g.status === 'ACTIVE').length, improvement: growth.filter((g) => g.status === 'ACTIVE' && g.type === 'IMPROVEMENT').length },
    openExceptions: logs.filter((x) => x.kind === 'EXCEPTION' && x.status === 'OPEN').length,
    note: 'Department averages appear only for groups of 3 or more, so nobody can work out one person\'s score.',
  });
}

async function growthList(c: C, _b: any, q: Record<string, any>): Promise<Result> {
  const uid = str(q.uid, 120);
  if (uid && !canSee(c, uid)) return denied();
  const items = (await list(c.cid, 'growth')).filter((g) => (uid ? g.uid === uid : g.uid === c.ctx.uid || isManagerOf(c, g.uid) || c.isHr)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return ok({ items });
}

export const GROWTH_ROUTES: Record<string, Route> = {
  growth: { method: 'GET', who: 'any', run: (c, b, q) => growthList(c, b, q) },
  'growth-save': { method: 'POST', who: 'any', run: (c, b) => growthSave(c, b) },
  'growth-action': { method: 'POST', who: 'any', run: (c, b) => growthAction(c, b) },
  'growth-close': { method: 'POST', who: 'any', run: (c, b) => growthClose(c, b) },
  'ai-draft': { method: 'POST', who: 'any', run: (c, b) => aiDraft(c, b) },
  exceptions: { method: 'GET', who: 'hr', run: (c, b, q) => exceptionList(c, b, q) },
  'exception-resolve': { method: 'POST', who: 'hr', run: (c, b) => exceptionResolve(c, b) },
  report: { method: 'GET', who: 'reports', run: (c, b, q) => report(c, b, q) },
};
