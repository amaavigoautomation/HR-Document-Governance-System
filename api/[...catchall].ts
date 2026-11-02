export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-user-role'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // /api/health used to be its own function; it lives here so it does not use up one of the 12 Vercel Hobby slots.
  const path = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  if (path === '/api/health') {
    return res.status(200).json({ status: 'ok', runtime: 'vercel-serverless', timestamp: new Date().toISOString() });
  }

  return res.status(404).json({
    success: false,
    error: `API route not found: ${req.method} ${req.url}`,
  });
}
