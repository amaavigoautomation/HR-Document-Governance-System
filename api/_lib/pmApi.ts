/**
 * Performance Management, reached as /api/pm/<action>.
 * This file checks who is asking, builds each person's to-do list, and runs the daily job.
 * The work itself lives in pmSetup / pmPlans / pmWork / pmReviews / pmGrowth.
 */
import { authErrorResponse, requireActiveTenant } from './authContext.js';
import { adminDb } from './firebaseAdmin.js';
import { REVIEW_WORDS, istToday, previousQuarter } from '../../shared/pmEngine.js';
import { SETUP_ROUTES } from './pmSetup.js';
import { OPEN_PLAN, PLAN_ROUTES, openPlanOf, planReminders, planView, syncPlans } from './pmPlans.js';
import { WORK_ROUTES, checkinReminders, generateCheckins, runFeed } from './pmWork.js';
import { REVIEW_ROUTES, autoOpen, releaseHeld, reviewDaily, visible } from './pmReviews.js';
import { GROWTH_ROUTES, growthReminders } from './pmGrowth.js';
import {
  active, fail, get, hasReports, isManagerOf, list, load, loadSystem, ok, reportsOf, settingsOf,
  type C, type Result, type Route,
} from './pmCore.js';

export interface PmRequest { method: string; action: string; query: Record<string, any>; body?: any; headers: Record<string, any> }

type Todo = { text: string; go: string; id?: string; who: 'me' | 'team' | 'hr' };

/** One list per person: everything waiting for them, most important first. */
async function home(c: C): Promise<Result> {
  const uid = c.ctx.uid; const t = istToday();
  const [s, plans, reviews, evidence, checkins, growth, logs] = await Promise.all([
    settingsOf(c.cid), list(c.cid, 'plans'), list(c.cid, 'reviews'), list(c.cid, 'evidence', { status: 'PENDING' }), list(c.cid, 'checkins', { status: 'DUE' }), list(c.cid, 'growth'),
    c.isHr ? list(c.cid, 'log', { status: 'OPEN' }) : Promise.resolve([]),
  ]);
  const todo: Todo[] = [];
  const isManager = hasReports(c, uid);

  // ---- me
  for (const r of reviews.filter((x) => x.uid === uid)) {
    if (r.status === 'SELF') todo.push({ who: 'me', go: 'review', id: r.id, text: `Do your ${r.cycleName} self-review (due ${r.selfDue})` });
    if (r.status === 'PUBLISHED') todo.push({ who: 'me', go: 'review', id: r.id, text: `Read your ${r.cycleName} review and respond` });
  }
  const mine = openPlanOf(plans, uid);
  if (mine?.status === 'ACTIVE' && !mine.ackAt) todo.push({ who: 'me', go: 'mine', text: 'Read and acknowledge your targets' });
  const sops = (mine?.sops || []).filter((x: any) => !x.ackAt).length;
  if (mine && sops) todo.push({ who: 'me', go: 'mine', text: `Read and acknowledge ${sops} SOP${sops > 1 ? 's' : ''}` });
  for (const ci of checkins.filter((x) => x.uid === uid && !x.wentWell)) todo.push({ who: 'me', go: 'mine', text: `Add your notes to the ${ci.month} check-in (optional, 2 minutes)` });

  // ---- my team
  const team = new Set(reportsOf(c, uid).map((p) => p.uid));
  for (const p of plans.filter((x) => team.has(x.uid) && x.status === 'SET_TARGETS')) todo.push({ who: 'team', go: 'targets', id: p.id, text: `Set targets for ${p.name}${p.hrNote ? ' (HR asked for a change)' : ''}` });
  for (const r of reviews.filter((x) => x.uid !== uid && (x.managerUid === uid || team.has(x.uid)))) {
    if (r.status === 'MANAGER') todo.push({ who: 'team', go: 'review', id: r.id, text: `Review ${r.name} for ${r.cycleName} (due ${r.managerDue})${r.hrReturnNote ? ' (HR asked for a change)' : ''}` });
    if (r.status === 'SELF' && t > r.selfDue) todo.push({ who: 'team', go: 'review', id: r.id, text: `${r.name}'s self-review is overdue: you can continue without it` });
  }
  const pend = evidence.filter((e) => team.has(e.uid));
  if (pend.length) todo.push({ who: 'team', go: 'team', text: `Verify ${pend.length} work item${pend.length > 1 ? 's' : ''} from your team` });
  for (const ci of checkins.filter((x) => team.has(x.uid))) todo.push({ who: 'team', go: 'team', text: `Monthly check-in with ${ci.name} (${ci.month})` });
  for (const g of growth.filter((x) => team.has(x.uid))) {
    if (g.status === 'PROPOSED') todo.push({ who: 'team', go: 'team', text: `Confirm ${g.name}'s ${g.type === 'IMPROVEMENT' ? 'improvement plan' : g.type === 'RECOGNITION' ? 'recognition' : 'development plan'}` });
    if (g.status === 'ACTIVE' && g.reviewDate <= t) todo.push({ who: 'team', go: 'team', text: `Follow up on ${g.name}'s plan (follow-up date ${g.reviewDate})` });
  }

  // ---- HR
  let canOpen = '';
  if (c.isHr) {
    if (!s.setupDone) todo.push({ who: 'hr', go: 'setup', text: 'Finish Performance setup (about 30 minutes, 5 steps)' });
    const hrCheck = plans.filter((p) => p.status === 'HR_CHECK' && p.uid !== uid);
    if (hrCheck.length) todo.push({ who: 'hr', go: 'plans', text: `Approve targets for ${hrCheck.length} ${hrCheck.length > 1 ? 'people' : 'person'}` });
    const held = plans.filter((p) => p.status === 'ON_HOLD');
    if (s.setupDone && held.length) todo.push({ who: 'hr', go: 'plans', text: `${held.length} plan${held.length > 1 ? 's are' : ' is'} on hold: something is missing (see why)` });
    const prev = previousQuarter(t);
    if (s.setupDone && s.setupDoneAt.slice(0, 10) <= prev.to && !(await get(c.cid, 'cycles', `${c.cid}_${prev.key}`))) { canOpen = prev.key; todo.push({ who: 'hr', go: 'reviews', text: `Open the ${prev.name} reviews` }); }
  }
  if (c.isHr || c.isApprover) {
    const toApprove = reviews.filter((r) => r.status === 'HR' && r.uid !== uid && r.managerUid !== uid);
    if (toApprove.length) todo.push({ who: 'hr', go: 'reviews', text: `Approve ${toApprove.length} review${toApprove.length > 1 ? 's' : ''} (risky ones are at the top)` });
    for (const r of reviews.filter((x) => x.status === 'DISPUTED' && x.uid !== uid)) todo.push({ who: 'hr', go: 'review', id: r.id, text: `${r.name} disagrees with their ${r.cycleName} review` });
  }
  const blocks = logs.filter((x) => x.kind === 'EXCEPTION' && x.behaviour === 'BLOCK').length;
  if (c.isHr && blocks) todo.push({ who: 'hr', go: 'exceptions', text: `${blocks} thing${blocks > 1 ? 's are' : ' is'} blocking someone's plan or review` });

  return ok({ todo, isHr: c.isHr, isApprover: c.isApprover, isManager, canReports: c.canReports, setupDone: s.setupDone, canOpen, openExceptions: logs.filter((x) => x.kind === 'EXCEPTION').length, name: c.me?.name || '' });
}

/** Everything about me on one screen. */
async function my(c: C): Promise<Result> {
  const uid = c.ctx.uid;
  const [plans, evidence, checkins, reviews, growth] = await Promise.all([list(c.cid, 'plans', { uid }), list(c.cid, 'evidence', { uid }), list(c.cid, 'checkins', { uid }), list(c.cid, 'reviews', { uid }), list(c.cid, 'growth', { uid })]);
  const plan = openPlanOf(plans, uid);
  return ok({
    plan: plan ? await planView(c, plan) : null,
    pastPlans: plans.filter((p) => p.status === 'CLOSED').map((p) => ({ id: p.id, designation: p.designation, department: p.department, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo })),
    evidence: evidence.filter((e) => !plan || e.planId === plan.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100),
    checkins: checkins.sort((a, b) => b.month.localeCompare(a.month)).slice(0, 6),
    reviews: reviews.sort((a, b) => b.cycleKey.localeCompare(a.cycleKey)).map((r) => ({ ...visible(c, r), statusText: REVIEW_WORDS[r.status] || r.status })),
    growth: growth.filter((g) => g.status !== 'PROPOSED').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  });
}

/** A manager's view of the people who report to them. */
async function team(c: C): Promise<Result> {
  const uid = c.ctx.uid;
  const people = reportsOf(c, uid);
  const ids = new Set(people.map((p) => p.uid));
  if (!ids.size && !c.isHr) return ok({ people: [], evidence: [], checkins: [], growth: [] });
  const [plans, evidence, checkins, reviews, growth] = await Promise.all([list(c.cid, 'plans'), list(c.cid, 'evidence', { status: 'PENDING' }), list(c.cid, 'checkins', { status: 'DUE' }), list(c.cid, 'reviews'), list(c.cid, 'growth')]);
  const rows = people.map((p) => {
    const plan = openPlanOf(plans, p.uid);
    const rv = reviews.filter((r) => r.uid === p.uid).sort((a, b) => b.cycleKey.localeCompare(a.cycleKey))[0];
    return {
      uid: p.uid, name: p.name, designation: p.title, department: p.department,
      plan: plan ? { id: plan.id, status: plan.status, holds: plan.holds || [], hrNote: plan.hrNote || '', ackAt: plan.ackAt, kpis: plan.kpis.map((k: any) => ({ id: k.id, kpi: k.kpi })) } : null,
      review: rv ? { id: rv.id, status: rv.status, statusText: REVIEW_WORDS[rv.status], cycleName: rv.cycleName } : null,
      pending: evidence.filter((e) => e.uid === p.uid).length,
    };
  });
  return ok({
    people: rows,
    evidence: evidence.filter((e) => ids.has(e.uid)).sort((a, b) => a.date.localeCompare(b.date)),
    checkins: checkins.filter((x) => ids.has(x.uid)).sort((a, b) => a.month.localeCompare(b.month)),
    growth: growth.filter((g) => ids.has(g.uid) && ['PROPOSED', 'ACTIVE'].includes(g.status)),
  });
}

/** The daily job for one company. Every step is safe to run twice. */
export async function runDaily(cid: string, c0?: C): Promise<Record<string, any>> {
  const c = c0 || await loadSystem(cid);
  const out: Record<string, any> = {};
  const steps: [string, () => Promise<any>][] = [
    ['plans', async () => (await syncPlans(c)).stats],
    ['planReminders', () => planReminders(c)],
    ['feed', () => runFeed(c)],
    ['checkins', () => generateCheckins(c)],
    ['checkinReminders', () => checkinReminders(c)],
    ['openCycle', () => autoOpen(c)],
    ['releaseHeld', () => releaseHeld(c)],
    ['reviews', () => reviewDaily(c)],
    ['growth', () => growthReminders(c)],
  ];
  for (const [name, fn] of steps) { try { out[name] = await fn(); } catch (e: any) { out[name] = { error: e?.message || 'failed' }; } }
  return out;
}

async function runNow(c: C): Promise<Result> {
  const sys = await loadSystem(c.cid);
  const result = await runDaily(c.cid, sys);
  return ok({ result, message: 'Daily checks done: plans, reminders, check-ins, reviews and follow-ups are up to date.' });
}

export const ROUTES: Record<string, Route> = {
  home: { method: 'GET', who: 'any', run: (c) => home(c) },
  my: { method: 'GET', who: 'any', run: (c) => my(c) },
  team: { method: 'GET', who: 'any', run: (c) => team(c) },
  'run-daily': { method: 'POST', who: 'hr', run: (c) => runNow(c) },
  ...SETUP_ROUTES, ...PLAN_ROUTES, ...WORK_ROUTES, ...REVIEW_ROUTES, ...GROWTH_ROUTES,
};

export async function routePm(r: PmRequest): Promise<Result> {
  // The daily job (cron: GET with CRON_SECRET).
  if (r.action === 'daily') {
    const secret = (process.env.CRON_SECRET || '').trim();
    const auth = String(r.headers?.authorization || r.headers?.Authorization || '');
    if (!secret || auth !== `Bearer ${secret}`) return fail(401, 'Not allowed.');
    const snap = await adminDb().collection('companies').where('status', '==', 'ACTIVE').get();
    const results: Record<string, any> = {};
    for (const d of snap.docs) { try { results[d.id] = await runDaily(d.id); } catch (e: any) { results[d.id] = { error: e?.message || 'failed' }; } }
    return ok({ companies: snap.size, results });
  }
  const route = ROUTES[r.action];
  if (!route) return fail(404, 'Unknown Performance action.');
  try {
    if (r.method !== route.method) return fail(405, 'Method not allowed.');
    const ctx = await requireActiveTenant(r.headers);
    if (!ctx.companyId) return fail(403, 'Open this as a company user.');
    const c = await load(ctx);
    if (route.who === 'hr' && !c.isHr) return fail(403, 'Only HR can do this.');
    if (route.who === 'approver' && !c.isHr && !c.isApprover) return fail(403, 'Only HR or an authorized approver can do this.');
    if (route.who === 'reports' && !c.canReports) return fail(403, 'You do not have access to these figures.');
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    return await route.run(c, body, r.query || {});
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    if (err?.status && err.status < 500) return fail(err.status, err.message);
    console.error('[PM] error:', err);
    return fail(500, err?.message || 'Performance request failed.');
  }
}
