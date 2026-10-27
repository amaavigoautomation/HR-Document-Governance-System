import { routeRecruitment } from '../_lib/recruitmentApi.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { status, json } = await routeRecruitment({
      method: req.method,
      action: String(req.query?.action || ''),
      query: req.query || {},
      body: req.body,
      headers: req.headers,
    });
    return res.status(status).json(json);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/recruitment:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Recruitment request failed' });
  }
}
