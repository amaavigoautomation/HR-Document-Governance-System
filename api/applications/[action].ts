import { routeApplications } from '../_lib/applicationsApi.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = req.headers.host ? `${proto}://${req.headers.host}` : undefined;
    const { status, json } = await routeApplications({
      method: req.method,
      action: String(req.query?.action || ''),
      query: req.query || {},
      body: req.body,
      headers: req.headers,
      origin,
    });
    return res.status(status).json(json);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/applications:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Applications request failed' });
  }
}
