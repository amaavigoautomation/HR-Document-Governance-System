import { authErrorResponse, requireActiveTenant, requirePermission } from './authContext.js';

type Handler = (req: any, res: any) => any;

/** Wraps a Vercel handler so the verified-identity check runs first (CORS preflights pass straight through). */
export function guarded(check: (headers: Record<string, any>) => Promise<unknown>, handler: Handler): Handler {
  return async (req, res) => {
    if (req.method === 'OPTIONS') return handler(req, res);
    try {
      await check(req.headers || {});
    } catch (err) {
      const known = authErrorResponse(err);
      if (known) return res.status(known.status).json(known.json);
      console.error('[guard] auth check failed:', err);
      return res.status(500).json({ success: false, error: 'Could not verify your session.' });
    }
    return handler(req, res);
  };
}

export const anyActiveUser = (h: Record<string, any>) => requireActiveTenant(h);
export const withPermission = (...perms: string[]) => (h: Record<string, any>) => requirePermission(h, ...perms);
