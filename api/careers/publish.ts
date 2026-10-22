import { publishForCompany } from '../_lib/careersPublisher.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  try {
    const { status, json } = await publishForCompany(req.headers, req.body);
    return res.status(status).json(json);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/careers/publish:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Failed to publish opening' });
  }
}
