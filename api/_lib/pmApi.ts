/**
 * Performance Management (HR-PM-001 to HR-PM-009), reached as /api/pm/<action>.
 * One server-only collection, pmItems, told apart by `kind`; every record carries a companyId.
 * The route tables live in pmMasters / pmPlans / pmEvidence / pmReviews / pmGrowth / pmInsights; this file only checks who is asking.
 */
import { authErrorResponse, requireActiveTenant } from './authContext.js';
import { adminDb } from './firebaseAdmin.js';
import { fail, load, loadSystem, ok, type Result, type Route } from './pmCore.js';
import { MASTER_ROUTES, sopSync } from './pmMasters.js';
import { PLAN_ROUTES, sopReminders, syncPlans } from './pmPlans.js';
import { EVIDENCE_ROUTES, evHook } from './pmEvidence.js';
import { REVIEW_ROUTES, refreshBlockedReviews, reviewReminders } from './pmReviews.js';
import { GROWTH_ROUTES, generateCheckins } from './pmGrowth.js';
import { INSIGHT_ROUTES } from './pmInsights.js';

export interface PmRequest { method: string; action: string; query: Record<string, any>; body?: any; headers: Record<string, any> }

export const ROUTES: Record<string, Route> = { ...MASTER_ROUTES, ...PLAN_ROUTES, ...EVIDENCE_ROUTES, ...REVIEW_ROUTES, ...GROWTH_ROUTES, ...INSIGHT_ROUTES };

/** The daily job for one company. Every step is safe to run twice. */
export async function runDaily(cid: string): Promise<Record<string, any>> {
  const c = await loadSystem(cid, 'Daily job');
  const out: Record<string, any> = {};
  const steps: [string, () => Promise<any>][] = [
    ['plans', async () => (await syncPlans(c)).json.stats || 'ok'],
    ['sops', async () => (await sopSync(c)).json.message || 'ok'],
    ['blockedReviews', () => refreshBlockedReviews(c)],
    ['checkins', () => generateCheckins(c)],
    ['sopReminders', () => sopReminders(c)],
    ['reviewReminders', () => reviewReminders(c)],
  ];
  for (const [name, fn] of steps) { try { out[name] = await fn(); } catch (e: any) { out[name] = { error: e?.message || 'failed' }; } }
  return out;
}

export async function routePm(r: PmRequest): Promise<Result> {
  // The task webhook has no login: the company key is the credential.
  if (r.action === 'ev-hook') return evHook({ method: r.method, query: r.query, body: r.body });

  // The daily job (Vercel cron: GET with CRON_SECRET).
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
    if (route.who === 'approver' && !c.isApprover) return fail(403, 'Only an authorized approver can do this.');
    if (route.who === 'aggregate' && !c.canViewAggregate) return fail(403, 'You do not have access to these figures.');
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
