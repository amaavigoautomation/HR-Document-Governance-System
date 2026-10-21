import { guarded, withHomePermission } from '../_lib/guard.js';
import { runCandidateEvaluation, clearEvaluationCache } from '../_lib/serverAiEvaluation.js';

enum UserRole {
  CREATOR = 'CREATOR',
  REVIEWER = 'REVIEWER',
  EMPLOYEE = 'EMPLOYEE',
}

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const userRole = req.headers['x-user-role'] as string;
    if (userRole === UserRole.EMPLOYEE) {
      return res.status(403).json({
        error: 'Access denied: Employee role is not authorized to access candidate evaluations.',
      });
    }

    const designation = ((req.query.designation as string) || 'Performance Marketing Expert').trim();
    const forceRefresh = req.query.refresh === 'true' || req.query.force === 'true';
    if (forceRefresh) {
      clearEvaluationCache();
    }

    const evaluateWithAi = req.query.evaluate === 'true';
    const evaluation = await runCandidateEvaluation(designation, forceRefresh, evaluateWithAi);
    return res.status(200).json(evaluation);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/recruitment/ai-evaluation:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to generate AI candidate evaluation',
    });
  }
}

export default guarded(withHomePermission('candidate.evaluate'), handler);
