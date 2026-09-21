import { fetchSheetData } from '../../src/services/serverSheets.js';
import { UserRole } from '../../src/types';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, x-user-role'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const userRole = req.headers['x-user-role'] as string;
    if (userRole === UserRole.EMPLOYEE) {
      return res.status(403).json({
        error: 'Access denied: Employee role is not authorized to access worksheet tables.',
      });
    }

    const tabName = ((req.query.tabName as string) || '').trim();
    if (!tabName) {
      return res.status(400).json({ error: 'Worksheet tab name parameter is required' });
    }

    // Security validation on tabName
    if (tabName.length > 100 || /[<>{}\\]/.test(tabName)) {
      return res.status(400).json({ error: 'Invalid worksheet tab name format' });
    }

    const sheetData = await fetchSheetData(tabName);
    return res.status(200).json(sheetData);
  } catch (err: any) {
    console.error('[Vercel Serverless API] Error in /api/recruitment/sheet-data:', err);
    const isNotFound = err.message?.includes('NOT_FOUND');
    const isPermission = err.message?.includes('PERMISSION_DENIED');
    const isNotConfigured = err.message?.includes('SPREADSHEET_NOT_CONFIGURED');
    const status = isNotFound ? 404 : isPermission ? 403 : isNotConfigured ? 400 : 500;
    return res.status(status).json({ error: err.message || 'Failed to fetch worksheet data' });
  }
}
