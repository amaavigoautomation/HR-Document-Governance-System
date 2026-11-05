import { routeHiring } from '../_lib/hiringRouter.js';

/**
 * The single serverless function for all hiring routes (see api/_lib/hiringRouter.ts for the action list).
 * Keeping them in one function is what stays under the Vercel Hobby limit of 12 functions.
 */
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = req.headers.host ? `${proto}://${req.headers.host}` : undefined;
    const { status, json } = await routeHiring({
      method: req.method,
      action: String(req.query?.action || ''),
      query: req.query || {},
      body: req.body,
      headers: req.headers,
      origin,
    });
    if (json && typeof json === 'object' && json.__redirect) return res.redirect(302, String(json.__redirect));
    return res.status(status).json(json);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/recruitment:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Recruitment request failed' });
  }
}
