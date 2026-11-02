/**
 * One router for everything under /api/recruitment/<action>.
 *
 * Vercel's Hobby plan allows 12 serverless functions and the app was at the limit, so the hiring routes now share one
 * function (api/recruitment/[action].ts) and are told apart by the action name:
 *
 *   config, overview, sheet-data, ai-evaluation, jd-save, jd-delete   Talent Acquisition overview and job descriptions
 *   app-<action>                                                       candidate applications (was /api/applications/<action>)
 *   careers-publish                                                    publish an approved requisition (was /api/careers/publish)
 *   generate-jd                                                        AI job description draft (was /api/requisitions/generate-jd)
 *   budget-list, budget-save, budget-check, req-founder-approve        department hiring budgets, budget check, founder approval + Position ID
 *   jdlib-*, post-*, ref-*, cand-*, resume-extract, score-*             JD library, posting tracker, referrals, candidate fields, scoring (pipelineApi.ts)
 *   screen-*, assess-*, int-*, pipe-board                               screening, assessments, interviews, feedback (interviewApi.ts)
 *   joining-board, asset-*, kit-*, it-set                                joiner checklist, asset register, welcome kit (joiningApi.ts)
 *   ai-*, dup-*                                                         recruitment AI: resume reading, duplicates, comparison, recommendation, drafts (aiHiringApi.ts)
 *   hiring-daily, integrations                                          the one daily cron job, and which outside connections are switched on
 *   hdash                                                               founder hiring dashboard (analyticsApi.ts)
 *   offer-*, hcost-*                                                    salary approval, offer pack, acceptance, hiring costs (offerApi.ts)
 *
 * New hiring features (budgets, posting tracker, screening, interviews ...) are added here as further actions, so they never
 * need another serverless function. Shared by server.ts (local) and api/recruitment/[action].ts (Vercel).
 */
import { authErrorResponse, requirePermission } from './authContext.js';
import { routeApplications } from './applicationsApi.js';
import { routeRecruitment } from './recruitmentApi.js';
import { publishForCompany } from './careersPublisher.js';
import { generateJobDescription } from './jdGenerator.js';
import { routeHiringBudget } from './hiringBudgetApi.js';
import { routePipeline } from './pipelineApi.js';
import { routeInterview } from './interviewApi.js';
import { routeOffer } from './offerApi.js';
import { routeJoining } from './joiningApi.js';
import { routeAnalytics } from './analyticsApi.js';
import { routeAiHiring } from './aiHiringApi.js';
import { sweepOffers } from './offerApi.js';
import { sweepProbation, sweepQuarterly } from './talentCycleApi.js';
import { sendDueReminders } from './interviewApi.js';
import { integrationStatus } from './integrations.js';

export interface HiringRequest {
  method: string;
  action: string;
  query: Record<string, any>;
  body?: any;
  headers: Record<string, any>;
  /** Public origin of this deployment (used for links the applications screens hand out). */
  origin?: string;
}

export type HiringResult = { status: number; json: any };

const APP_PREFIX = 'app-';

export async function routeHiring(r: HiringRequest): Promise<HiringResult> {
  const action = String(r.action || '');

  // Candidate applications: app-list, app-add, app-import ...
  if (action.startsWith(APP_PREFIX)) {
    return routeApplications({
      method: r.method,
      action: action.slice(APP_PREFIX.length),
      query: r.query,
      body: r.body,
      headers: r.headers,
      origin: r.origin,
    });
  }

  if (action === 'careers-publish') {
    if (r.method !== 'POST') return { status: 405, json: { success: false, error: 'Method not allowed. Use POST.' } };
    return publishForCompany(r.headers, r.body);
  }

  if (action === 'generate-jd') {
    if (r.method !== 'POST') return { status: 405, json: { success: false, error: 'Method not allowed' } };
    try {
      await requirePermission(r.headers, 'req.manage_jd');
      const body = r.body && typeof r.body === 'object' ? r.body : {};
      if (!body.positionTitle || !body.departmentName) {
        return { status: 400, json: { success: false, error: 'positionTitle and departmentName are required' } };
      }
      const result = await generateJobDescription(body);
      return { status: 200, json: { success: true, ...result } };
    } catch (err: any) {
      const known = authErrorResponse(err);
      if (known) return { status: known.status, json: known.json };
      console.error('[Hiring] generate-jd error:', err);
      return { status: 500, json: { success: false, error: err?.message || 'Failed to generate job description' } };
    }
  }

  // The one daily job (Vercel cron, GET with CRON_SECRET): offer reminders and expiry, probation and quarterly reminders, interview reminders.
  if (action === 'hiring-daily') {
    const secret = (process.env.CRON_SECRET || '').trim();
    const auth = String(r.headers?.authorization || r.headers?.Authorization || '');
    if (!secret || auth !== `Bearer ${secret}`) return { status: 401, json: { success: false, error: 'Not allowed.' } };
    const out: Record<string, any> = {};
    for (const [name, fn] of [['offers', sweepOffers], ['probation', sweepProbation], ['quarterly', sweepQuarterly], ['interviews', () => sendDueReminders()]] as const) {
      try { out[name] = await (fn as () => Promise<any>)(); } catch (e: any) { out[name] = { error: e?.message || 'failed' }; }
    }
    return { status: 200, json: { success: true, ...out } };
  }

  if (action === 'integrations') {
    try {
      await requirePermission(r.headers, 'app.manage');
      return { status: 200, json: { success: true, integrations: integrationStatus() } };
    } catch (err: any) {
      const known = authErrorResponse(err);
      if (known) return { status: known.status, json: known.json };
      return { status: 500, json: { success: false, error: 'Failed.' } };
    }
  }

  // Department hiring budgets, the budget check and the founder's approval (see hiringBudgetApi.ts).
  const budget = await routeHiringBudget({ method: r.method, action, query: r.query, body: r.body, headers: r.headers });
  if (budget) return budget;

  // JD library, posting tracker, referrals, candidate fields, resume reading and scoring (pipelineApi.ts), then screening,
  // assessments, interviews and feedback (interviewApi.ts).
  const pipe = { method: r.method, action, query: r.query, body: r.body, headers: r.headers, origin: r.origin };
  const pipeline = (await routePipeline(pipe)) || (await routeInterview(pipe)) || (await routeOffer(pipe)) || (await routeJoining(pipe)) || (await routeAnalytics(pipe)) || (await routeAiHiring(pipe));
  if (pipeline) return pipeline;

  // Everything else is the Talent Acquisition overview / job description router.
  return routeRecruitment({ method: r.method, action, query: r.query, body: r.body, headers: r.headers });
}
