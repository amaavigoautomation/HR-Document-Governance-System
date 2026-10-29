/**
 * Performance Management API router (HR-PM-001 to HR-PM-009). One entry point for the Vercel function and the dev server.
 * Identity and permissions are checked here; every record is scoped to the caller's company.
 */
import { authErrorResponse } from './authContext.js';
import { PerfError, fail, ok, str, type Result } from './perfCore.js';
import * as setup from './perfSetup.js';
import * as plans from './perfPlans.js';
import * as reviews from './perfReviews.js';
import * as ops from './perfOps.js';
import * as mood from './perfMood.js';

export interface PerfRequestIn {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
  ip?: string;
}

export async function routePerf(r: PerfRequestIn): Promise<Result> {
  try {
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    const q = r.query || {};

    // Public by design: each guards itself with a secret key.
    if (r.action === 'cron') {
      const secret = (process.env.CRON_SECRET || '').trim();
      const supplied = str(q.key, 200) || str(r.headers['authorization'], 300).replace(/^Bearer\s+/i, '') || str(r.headers['x-cron-key'], 200);
      if (!secret) return fail(503, 'CRON_SECRET is not configured.');
      if (supplied !== secret) return fail(401, 'Invalid cron key.');
      return await ops.runPerfCron();
    }
    if (r.action === 'evidence-hook') {
      if (r.method !== 'POST') return fail(405, 'Use POST.');
      return await plans.evidenceHook(r.headers, body, q);
    }

    let w: setup.Who;
    try {
      w = await setup.whoIs(r.headers);
    } catch (err) {
      const known = authErrorResponse(err);
      if (known) return { status: known.status, json: known.json };
      throw err;
    }
    const GET = r.method === 'GET';
    const POST = r.method === 'POST';

    switch (r.action) {
      case 'me': if (GET) return await setup.me(w); break;
      // setup
      case 'settings': if (GET) return await setup.getSettings(w); break;
      case 'settings-save': if (POST) return await setup.postSettings(w, body); break;
      case 'webhook-rotate': if (POST) return await setup.rotateWebhook(w); break;
      case 'apply-starter': if (POST) return await setup.applyStarter(w); break;
      case 'frameworks': if (GET) return await setup.getFrameworks(w); break;
      case 'framework-save': if (POST) return await setup.saveFramework(w, body); break;
      case 'framework-clone': if (POST) return await setup.cloneFramework(w, body); break;
      case 'framework-approve': if (POST) return await setup.approveFramework(w, body); break;
      case 'framework-retire': if (POST) return await setup.retireFramework(w, body); break;
      case 'cycles': if (GET) return await setup.getCycles(w); break;
      case 'cycle-save': if (POST) return await setup.saveCycle(w, body); break;
      case 'cycle-open': if (POST) return await reviews.openCycle(w, body); break;
      case 'cycle-lock': if (POST) return await reviews.lockCycle(w, body); break;
      case 'templates': if (GET) return await setup.getTemplates(w); break;
      case 'template-save': if (POST) return await setup.saveTemplate(w, body); break;
      case 'template-approve': if (POST) return await setup.approveTemplate(w, body); break;
      // SOPs
      case 'sops': if (GET) return await plans.getSops(w); break;
      case 'sop-sources': if (GET) return await plans.sopSources(w); break;
      case 'sop-save': if (POST) return await plans.saveSop(w, body); break;
      case 'sop-delete': if (POST) return await plans.deleteSop(w, body); break;
      case 'sop-sync': if (POST) return await plans.runSopSync(w); break;
      case 'sop-assignments': if (GET) return await plans.getAssignments(w, q); break;
      case 'sop-ack': if (POST) return await plans.ackSop(w, body); break;
      case 'sop-verify': if (POST) return await plans.verifySop(w, body); break;
      // plans and evidence
      case 'plan-generate': if (POST) return await plans.runGenerate(w, body); break;
      case 'plans': if (GET) return await plans.getPlans(w, q); break;
      case 'plan': if (GET) return await plans.getPlan(w, q); break;
      case 'plan-save': if (POST) return await plans.savePlan(w, body); break;
      case 'plan-submit': if (POST) return await plans.submitPlan(w, body); break;
      case 'plan-decide': if (POST) return await plans.decidePlan(w, body); break;
      case 'plan-ack': if (POST) return await plans.ackPlan(w, body); break;
      case 'evidence-add': if (POST) return await plans.addEvidence(w, body); break;
      case 'evidence-list': if (GET) return await plans.listEvidence(w, q); break;
      case 'evidence-verify': if (POST) return await plans.verifyEvidence(w, body); break;
      // reviews
      case 'reviews': if (GET) return await reviews.getReviews(w, q); break;
      case 'review': if (GET) return await reviews.getReview(w, q); break;
      case 'review-self-save': if (POST) return await reviews.selfSave(w, body); break;
      case 'review-self-submit': if (POST) return await reviews.selfSubmit(w, body); break;
      case 'review-mgr-save': if (POST) return await reviews.managerSave(w, body); break;
      case 'review-mgr-submit': if (POST) return await reviews.managerSubmit(w, body); break;
      case 'review-discussion': if (POST) return await reviews.discussionDone(w, body); break;
      case 'review-hr-save': if (POST) return await reviews.hrSave(w, body); break;
      case 'review-hr-forward': if (POST) return await reviews.hrForward(w, body); break;
      case 'review-return': if (POST) return await reviews.returnReview(w, body); break;
      case 'review-approve': if (POST) return await reviews.approveReview(w, body); break;
      case 'review-respond': if (POST) return await reviews.respond(w, body); break;
      case 'review-dispute-resolve': if (POST) return await reviews.resolveDispute(w, body); break;
      case 'review-amend': if (POST) return await reviews.amendReview(w, body); break;
      case 'review-defer': if (POST) return await reviews.deferReview(w, body); break;
      case 'review-referral': if (POST) return await reviews.confidentialReferral(w, body); break;
      // check-ins, development
      case 'checkins': if (GET) return await ops.getCheckins(w, q); break;
      case 'checkin-save': if (POST) return await ops.saveCheckin(w, body); break;
      case 'devplans': if (GET) return await ops.getDevPlans(w, q); break;
      case 'devplan-save': if (POST) return await ops.saveDevPlan(w, body); break;
      case 'devplan-update': if (POST) return await ops.updateDevPlan(w, body); break;
      // dashboards, AI, governance
      case 'dashboard': if (GET) return await ops.dashboard(w, q); break;
      case 'ai-review-draft': if (POST) return await ops.aiReviewDraft(w, body); break;
      case 'ai-kpi-wording': if (POST) return await ops.aiKpiWording(w, body); break;
      case 'mood-me': if (GET) return await mood.myMood(w); break;
      case 'mood-save': if (POST) return await mood.saveMood(w, body); break;
      case 'mood-report': if (GET) return await mood.moodReport(w, q); break;
      case 'audit-log': if (GET) return await ops.auditLog(w, q); break;
      case 'exceptions': if (GET) return await ops.getExceptions(w, q); break;
      case 'exception-resolve': if (POST) return await ops.resolveException(w, body); break;
      case 'notifications': if (GET) return await ops.getNotifications(w); break;
      case 'notifications-read': if (POST) return await ops.readNotifications(w, body); break;
      default: return fail(404, `Unknown performance action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  } catch (err: any) {
    if (err instanceof PerfError) return fail(err.status, err.message);
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Performance] error:', err);
    return fail(500, err?.message || 'Performance request failed.');
  }
}

export { ok };
