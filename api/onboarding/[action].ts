import { routeOnboarding } from '../_lib/onboarding.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-Requested-With, Accept, Content-Type, Authorization, x-user-role, x-cron-key'
  );
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = String(req.query?.action || '');
    const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
    const origin = req.headers.host ? `${proto}://${req.headers.host}` : undefined;
    const isRaw = Buffer.isBuffer(req.body);
    const { status, json, file } = await routeOnboarding({
      method: req.method,
      action,
      query: req.query || {},
      body: isRaw ? {} : req.body,
      headers: req.headers,
      origin,
      raw: isRaw ? req.body : undefined,
    });
    if (file) {
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Content-Disposition', `inline; filename="${file.name.replace(/[^\w.\- ]/g, '_')}"`);
      return res.status(status).send(file.data);
    }
    return res.status(status).json(json);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/onboarding:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Onboarding request failed' });
  }
}
