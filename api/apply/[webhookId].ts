import { routeApply } from '../_lib/applicationsApi.js';

/** Public address a company's own website posts applications to. See api/_lib/applicationsApi.ts. */
export default async function handler(req: any, res: any) {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const { status, json, headers } = await routeApply({
      method: req.method,
      webhookId: String(req.query?.webhookId || ''),
      body: req.body,
      headers: req.headers,
      ip,
    });
    for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
    if (json === null) return res.status(status).end();
    return res.status(status).json(json);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/apply:', err);
    return res.status(500).json({ success: false, error: 'Could not save the application.' });
  }
}
