import { guarded, anyActiveUser } from '../_lib/guard.js';
import { dispatchLiveEmail } from '../_lib/serverEmail.js';

async function handler(req: any, res: any) {
  // CORS configuration for Vercel Serverless Function
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await dispatchLiveEmail(payload);
    return res.status(result.success ? 200 : 500).json(result);
  } catch (err: any) {
    console.error('[Vercel Serverless API] /api/email/send error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to dispatch email' });
  }
}

export default guarded(anyActiveUser, handler);
