import { generateJobDescription } from '../_lib/jdGenerator.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-user-role'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    if (!body.positionTitle || !body.departmentName) {
      return res.status(400).json({ success: false, error: 'positionTitle and departmentName are required' });
    }
    const result = await generateJobDescription(body);
    return res.status(200).json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/requisitions/generate-jd:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to generate job description' });
  }
}
