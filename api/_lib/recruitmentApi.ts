/**
 * Recruitment Overview endpoints (/api/recruitment/*): config, overview, sheet-data, ai-evaluation.
 * Every call is answered from the signed-in user's own company only. Shared by server.ts and api/recruitment/[action].ts.
 */
import { authErrorResponse, requirePermission } from './authContext.js';
import { computeRecruitmentOverview, fetchSheetData, getGoogleSheetsConfigStatus } from './serverSheets.js';
import { clearEvaluationCache, runCandidateEvaluation } from './serverAiEvaluation.js';

export interface RecruitmentRequest {
  method: string;
  action: string;
  query: Record<string, any>;
  headers: Record<string, any>;
}

type Result = { status: number; json: any };

export async function routeRecruitment(r: RecruitmentRequest): Promise<Result> {
  try {
    if (r.method !== 'GET') return { status: 405, json: { success: false, error: 'Method not allowed.' } };
    const permission = r.action === 'ai-evaluation' ? 'candidate.evaluate' : 'talent.view';
    const ctx = await requirePermission(r.headers, permission);
    const companyId = ctx.companyId;
    if (!companyId) return { status: 403, json: { success: false, error: 'Open this as a company user.' } };

    if (r.action === 'config') return { status: 200, json: getGoogleSheetsConfigStatus(companyId) };

    if (r.action === 'overview') return { status: 200, json: await computeRecruitmentOverview(companyId) };

    if (r.action === 'sheet-data') {
      const tabName = String(r.query.tabName || '').trim();
      if (!tabName) return { status: 400, json: { error: 'Worksheet tab name parameter is required' } };
      if (tabName.length > 100 || /[<>{}\\]/.test(tabName)) return { status: 400, json: { error: 'Invalid worksheet tab name format' } };
      try {
        return { status: 200, json: await fetchSheetData(companyId, tabName) };
      } catch (err: any) {
        const msg = String(err?.message || '');
        const status = msg.includes('NOT_FOUND') ? 404 : msg.includes('PERMISSION_DENIED') ? 403 : 500;
        return { status, json: { error: msg || 'Failed to fetch worksheet data' } };
      }
    }

    if (r.action === 'ai-evaluation') {
      const designation = String(r.query.designation || '').trim();
      if (!designation) return { status: 400, json: { success: false, error: 'designation is required.' } };
      const force = r.query.refresh === 'true' || r.query.force === 'true';
      if (force) clearEvaluationCache(companyId);
      const evaluation = await runCandidateEvaluation(companyId, designation, force, r.query.evaluate === 'true');
      return { status: 200, json: evaluation };
    }

    return { status: 404, json: { success: false, error: `Unknown recruitment action '${r.action}'.` } };
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Recruitment] error:', err);
    return { status: 500, json: { success: false, error: err?.message || 'Recruitment request failed.' } };
  }
}
