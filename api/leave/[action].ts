import { routeLeave } from '../_lib/leaveApi.js';
import { routePayroll } from '../_lib/payrollApi.js';
import { routeLifecycle } from '../_lib/lifecycleApi.js';
import { routeDashboard } from '../_lib/dashboardApi.js';
import { routeHome } from '../_lib/homeApi.js';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const action = String(req.query?.action || '');
    // Payroll shares this function (Vercel Hobby allows only 12): /api/leave/payroll-<action>
    if (action.startsWith('payroll-')) {
      const { status, json } = await routePayroll({
        method: req.method, action: action.slice('payroll-'.length), query: req.query || {}, body: req.body, headers: req.headers,
      });
      return res.status(status).json(json);
    }
    // People lifecycle (onboarding tasks, exits, letters, directory) shares it too: /api/leave/lifecycle-<action>
    if (action.startsWith('lifecycle-')) {
      const { status, json } = await routeLifecycle({
        method: req.method, action: action.slice('lifecycle-'.length), query: req.query || {}, body: req.body, headers: req.headers,
      });
      return res.status(status).json(json);
    }
    // The Home dashboard shares it as well: /api/leave/dashboard-<action>
    if (action.startsWith('dashboard-')) {
      const { status, json } = await routeDashboard({
        method: req.method, action: action.slice('dashboard-'.length), headers: req.headers, ip,
      });
      return res.status(status).json(json);
    }
    // The Home page cards share it too: /api/leave/home-<action>
    if (action.startsWith('home-')) {
      const { status, json } = await routeHome({
        method: req.method, action: action.slice('home-'.length), query: req.query || {}, body: req.body, headers: req.headers,
      });
      return res.status(status).json(json);
    }
    const { status, json } = await routeLeave({
      method: req.method,
      action,
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
