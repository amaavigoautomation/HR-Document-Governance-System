import { routeLeave } from '../_lib/leaveApi.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const { status, json } = await routeLeave({
      method: req.method,
      action: String(req.query?.action || ''),
      query: req.query || {},
      body: req.body,
      headers: req.headers,
      ip,
    });
    return res.status(status).json(json);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/leave:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Leave request failed' });
  }
}
