import { computeRecruitmentOverview } from '../_lib/serverSheets.js';

enum UserRole {
  CREATOR = 'CREATOR',
  REVIEWER = 'REVIEWER',
  EMPLOYEE = 'EMPLOYEE',
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-user-role'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const userRole = req.headers['x-user-role'] as string;
    // Protect sensitive recruitment data: allow HR (CREATOR) or Approver (REVIEWER)
    if (userRole === UserRole.EMPLOYEE) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Employee role is not authorized to access recruitment data.',
      });
    }

    const result = await computeRecruitmentOverview();
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/recruitment/overview:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to compute recruitment overview',
    });
  }
}
