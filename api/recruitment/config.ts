import { guarded, withHomePermission } from '../_lib/guard.js';
import { getGoogleSheetsConfigStatus } from '../_lib/serverSheets.js';

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const config = getGoogleSheetsConfigStatus();
    return res.status(200).json(config);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}

export default guarded(withHomePermission('talent.view'), handler);
