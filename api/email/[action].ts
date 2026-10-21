/**
 * /api/email/send | /api/email/test | /api/email/config
 * One function for all three (Vercel's Hobby plan allows at most 12 serverless functions per deployment).
 * Every route requires a signed-in user from an approved company.
 */
import { guarded, anyActiveUser } from '../_lib/guard.js';
import { dispatchLiveEmail, getEmailConfigStatus } from '../_lib/serverEmail.js';

const readBody = (req: any) => (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {});

async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = String(req.query?.action || '');

  try {
    if (action === 'config') {
      return res.status(200).json(getEmailConfigStatus());
    }

    if (action === 'send') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
      const result = await dispatchLiveEmail(readBody(req));
      return res.status(result.success ? 200 : 500).json(result);
    }

    if (action === 'test') {
      if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });
      const { to = 'parth@amaavigo.in', recipientName = 'Parth' } = readBody(req);
      const result = await dispatchLiveEmail({
        to,
        recipientName,
        subject: `[Live Test Verification] Amaavigo HR Governance Email Dispatcher`,
        body: `Dear ${recipientName},\n\nThis is a live test notification from your Amaavigo HR Document Governance & Version Control System on Vercel.\n\nYour email (${to}) is active in the employee database. Whenever a new company policy or mandatory document is published, you will receive real-time notifications with summary changelogs and compliance acknowledgment links.\n\nBest regards,\nHR Governance & Compliance Automation Team`,
        metadata: {
          documentId: 'TEST-SYSTEM-LIVE',
          documentTitle: 'Live Notification Verification',
          versionNumber: '1.0',
          acknowledgementRequired: true,
        },
      });
      return res.status(result.success ? 200 : 500).json(result);
    }

    return res.status(404).json({ success: false, error: `Unknown email action: ${action}` });
  } catch (err: any) {
    console.error(`[Vercel Serverless API] /api/email/${action} error:`, err);
    return res.status(500).json({ success: false, error: err.message || 'Email request failed' });
  }
}

export default guarded(anyActiveUser, handler);
