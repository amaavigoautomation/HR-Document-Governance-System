import { dispatchLiveEmail } from '../../src/services/serverEmail';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { to = 'parth@amaavigo.in', recipientName = 'Parth' } = body;
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
  } catch (err: any) {
    console.error('[Vercel Serverless API] /api/email/test error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to dispatch test email' });
  }
}
