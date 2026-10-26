import express from 'express';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';
import { governanceEngine } from './src/services/governance';
import { auditService } from './src/services/audit';
import { defaultStorageProvider } from './src/services/storage';
import { defaultEmailProvider } from './src/services/email';
import { dispatchLiveEmail, getEmailConfigStatus } from './src/services/serverEmail';
import { routeRecruitment } from './api/_lib/recruitmentApi';
import { routeApplications, routeApply } from './api/_lib/applicationsApi';
import { routeLeave } from './api/_lib/leaveApi';
import { routePayroll } from './api/_lib/payrollApi';
import { routeLifecycle } from './api/_lib/lifecycleApi';
import { routeDashboard } from './api/_lib/dashboardApi';
import { UserRole } from './src/types';
import { generateJobDescription } from './api/_lib/jdGenerator';
import { publishForCompany } from './api/_lib/careersPublisher';
import { routeOnboarding } from './api/_lib/onboarding';
import { routeTenant } from './api/_lib/tenantAdmin';
import { authErrorResponse, requireActiveTenant, requirePermission } from './api/_lib/authContext';
import { signStorageToken, verifyStorageToken } from './api/_lib/storageToken';
import { generateCorporatePdfBlob } from './src/utils/pdfGenerator';
import { generateCorporateDocxBlob } from './src/utils/documentStamper';

// Permanent media & file upload directory on disk
const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');
try {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
} catch (dirErr) {
  console.warn('Notice: Could not create uploads directory at startup:', dirErr);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // The public application webhook takes small JSON or form posts only (parsed before the large-upload parsers below).
  app.use('/api/apply', express.json({ limit: '200kb' }), express.urlencoded({ extended: true, limit: '200kb' }));

  // Support up to 100MB payload for video and high-resolution document uploads
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // ----------------------------------------------------
  // MULTI-TENANT AUTH GATE
  // Every /api route needs a verified Firebase ID token from an ACTIVE company, except the few
  // that are public by design (health, company signup, candidate upload links, cron, signed file URLs).
  // ----------------------------------------------------
  const PUBLIC_API = [
    /^\/api\/health$/,
    /^\/api\/tenant\/signup$/,
    /^\/api\/onboarding\/(public-info|upload|submit|cron)$/,
    /^\/api\/leave\/cron$/,
    /^\/api\/apply\/[a-f0-9]+$/, // each company's own website posts applications here; the router checks the key
    /^\/api\/storage\/(file|download)\//, // protected by an HMAC token in the URL (see storageToken.ts)
  ];
  // These routers do their own, finer-grained authentication.
  const SELF_AUTH_API = [/^\/api\/tenant\//, /^\/api\/onboarding\//, /^\/api\/recruitment\//, /^\/api\/applications\//, /^\/api\/careers\//, /^\/api\/leave\//];

  app.use('/api', async (req, res, next) => {
    const p = req.originalUrl.split('?')[0];
    if (req.method === 'OPTIONS' || PUBLIC_API.some((re) => re.test(p)) || SELF_AUTH_API.some((re) => re.test(p))) {
      return next();
    }
    try {
      (req as any).auth = await requireActiveTenant(req.headers);
      next();
    } catch (err) {
      const known = authErrorResponse(err);
      if (known) return res.status(known.status).json(known.json);
      next(err);
    }
  });

  const guard =
    (check: (headers: any) => Promise<unknown>, skipPrefix?: string) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (skipPrefix && req.path.startsWith(skipPrefix)) return next();
      try {
        await check(req.headers);
        next();
      } catch (err) {
        const known = authErrorResponse(err);
        if (known) return res.status(known.status).json(known.json);
        next(err);
      }
    };
  app.use('/api/requisitions', guard((h) => requirePermission(h, 'req.manage_jd')));

  // Company signup, approval, users, departments and roles
  app.all('/api/tenant/:action', async (req, res) => {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const origin = req.headers.host ? `${proto}://${req.headers.host}` : undefined;
    const { status, json } = await routeTenant({ method: req.method, action: req.params.action, body: req.body, headers: req.headers, origin });
    res.status(status).json(json);
  });

  // The original single-company, in-memory document API is switched off: it had no per-company data
  // separation and nothing in the app uses it any more (the app reads and writes Firestore directly).
  app.all(
    [
      '/api/auth/users', '/api/employees', '/api/employees/*', '/api/database/status',
      '/api/documents', '/api/documents/*', '/api/versions/*', '/api/review/*',
      '/api/audit', '/api/notifications', '/api/acknowledgements', '/api/compliance/*',
      '/api/governance/*', '/api/system/*',
    ],
    (_req, res) => res.status(410).json({ success: false, error: 'This endpoint has been retired.' })
  );

  // Safe sync versions to storage if available dynamically from database
  try {
    governanceEngine.syncVersionsToStorage();
  } catch (syncErr) {
    console.warn('Initial governance storage sync notice:', syncErr);
  }

  // Health Check endpoints for Cloud Run container lifecycle & load balancers
  app.get(['/api/health', '/healthz', '/livez', '/readyz'], (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Live Email Provider Status
  app.get('/api/email/config', (req, res) => {
    res.json(getEmailConfigStatus());
  });

  // Outbound Live Email Dispatch Endpoint
  app.post('/api/email/send', async (req, res) => {
    try {
      const result = await dispatchLiveEmail(req.body);
      res.json(result);
    } catch (err: any) {
      console.error('Email sending error in /api/email/send:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Send Direct Live Test Email
  app.post('/api/email/test', async (req, res) => {
    try {
      const { to = 'parth@amaavigo.in', recipientName = 'Parth' } = req.body;
      const result = await dispatchLiveEmail({
        to,
        recipientName,
        subject: `[Live Test Verification] Amaavigo HR Governance Email Dispatcher`,
        body: `Dear ${recipientName},\n\nThis is a live test notification from your Amaavigo HR Document Governance & Version Control System.\n\nYour email (${to}) is active in the employee database. Whenever a new company policy or mandatory document is published, you will receive real-time notifications with summary changelogs and compliance acknowledgment links.\n\nBest regards,\nHR Governance & Compliance Automation Team`,
        metadata: {
          documentId: 'TEST-SYSTEM-LIVE',
          documentTitle: 'Live Notification Verification',
          versionNumber: '1.0',
          acknowledgementRequired: true,
        },
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ----------------------------------------------------
  // TALENT ACQUISITION: GOOGLE SHEETS OVERVIEW API
  // ----------------------------------------------------

  // Recruitment Overview, built-in data tabs and AI candidate evaluation. Answered from the caller's own company only.
  app.get('/api/recruitment/:action', async (req, res) => {
    try {
      const { status, json } = await routeRecruitment({
        method: req.method,
        action: req.params.action,
        query: req.query as Record<string, any>,
        headers: req.headers as Record<string, any>,
      });
      res.status(status).json(json);
    } catch (err: any) {
      console.error('Error in /api/recruitment:', err);
      res.status(500).json({ success: false, error: err?.message || 'Recruitment request failed' });
    }
  });

  // Leave and attendance (all roles; the router checks identity and permissions)
  app.all('/api/leave/:action', async (req, res) => {
    try {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (req.params.action.startsWith('payroll-')) {
        const out = await routePayroll({
          method: req.method, action: req.params.action.slice('payroll-'.length), query: req.query as Record<string, any>,
          body: req.body, headers: req.headers as Record<string, any>,
        });
        return res.status(out.status).json(out.json);
      }
      if (req.params.action.startsWith('dashboard-')) {
        const out = await routeDashboard({
          method: req.method, action: req.params.action.slice('dashboard-'.length), headers: req.headers as Record<string, any>, ip,
        });
        return res.status(out.status).json(out.json);
      }
      if (req.params.action.startsWith('lifecycle-')) {
        const out = await routeLifecycle({
          method: req.method, action: req.params.action.slice('lifecycle-'.length), query: req.query as Record<string, any>,
          body: req.body, headers: req.headers as Record<string, any>,
        });
        return res.status(out.status).json(out.json);
      }
      const { status, json } = await routeLeave({
        method: req.method,
        action: req.params.action,
        query: req.query as Record<string, any>,
        body: req.body,
        headers: req.headers as Record<string, any>,
        ip,
      });
      res.status(status).json(json);
    } catch (err: any) {
      console.error('Error in /api/leave:', err);
      res.status(500).json({ success: false, error: err?.message || 'Leave request failed' });
    }
  });

  // Candidate applications (HR screens) and the public application webhook / jobs feed of each company
  app.all('/api/applications/:action', async (req, res) => {
    try {
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
      const origin = req.headers.host ? `${proto}://${req.headers.host}` : undefined;
      const { status, json } = await routeApplications({
        method: req.method,
        action: req.params.action,
        query: req.query as Record<string, any>,
        body: req.body,
        headers: req.headers as Record<string, any>,
        origin,
      });
      res.status(status).json(json);
    } catch (err: any) {
      console.error('Error in /api/applications:', err);
      res.status(500).json({ success: false, error: err?.message || 'Applications request failed' });
    }
  });

  app.all('/api/apply/:webhookId', async (req, res) => {
    try {
      const { status, json, headers } = await routeApply({
        method: req.method,
        webhookId: req.params.webhookId,
        body: req.body,
        headers: req.headers as Record<string, any>,
        ip: req.ip,
      });
      for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
      if (json === null) return res.status(status).end();
      res.status(status).json(json);
    } catch (err: any) {
      console.error('Error in /api/apply:', err);
      res.status(500).json({ success: false, error: 'Could not save the application.' });
    }
  });

  // AI Job Description generation for approved hiring requisitions
  app.post('/api/requisitions/generate-jd', async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.positionTitle || !body.departmentName) {
        return res.status(400).json({ success: false, error: 'positionTitle and departmentName are required' });
      }
      const result = await generateJobDescription(body);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('Error in /api/requisitions/generate-jd:', err);
      res.status(500).json({ success: false, error: err.message || 'Failed to generate job description' });
    }
  });

  // Publish an approved requisition (the Amaavigo website company posts to its careers API; others are open inside the portal)
  app.post('/api/careers/publish', async (req, res) => {
    try {
      const { status, json } = await publishForCompany(req.headers as Record<string, any>, req.body);
      res.status(status).json(json);
    } catch (err: any) {
      console.error('Error in /api/careers/publish:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to publish opening' });
    }
  });

  // Candidate onboarding (replaces the n8n onboarding workflow)
  const onboardingHandler = async (req: express.Request, res: express.Response) => {
    try {
      const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
      const origin = req.headers.host ? `${proto}://${req.headers.host}` : undefined;
      const isRaw = Buffer.isBuffer(req.body);
      const { status, json, file } = await routeOnboarding({
        method: req.method,
        action: req.params.action,
        query: req.query as Record<string, any>,
        body: isRaw ? {} : req.body,
        headers: req.headers as Record<string, any>,
        origin,
        raw: isRaw ? (req.body as Buffer) : undefined,
      });
      if (file) {
        res.setHeader('Content-Type', file.mime);
        res.setHeader('Content-Disposition', `inline; filename="${file.name.replace(/[^\w.\- ]/g, '_')}"`);
        return res.status(status).send(file.data);
      }
      res.status(status).json(json);
    } catch (err: any) {
      console.error('Error in /api/onboarding:', err);
      res.status(500).json({ success: false, error: err?.message || 'Onboarding request failed' });
    }
  };
  app.put('/api/onboarding/upload', express.raw({ type: () => true, limit: '6mb' }), onboardingHandler);
  app.all('/api/onboarding/:action', onboardingHandler);

  // Auth Users
  app.get('/api/auth/users', (req, res) => {
    res.json(governanceEngine.getUsers());
  });

  // Employee Directory API
  app.get('/api/employees', (req, res) => {
    res.json(governanceEngine.getEmployees());
  });

  app.get('/api/employees/:id', (req, res) => {
    const emp = governanceEngine.getUserById(req.params.id);
    if (!emp) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(emp);
  });

  // Database collections status endpoint
  app.get('/api/database/status', (req, res) => {
    res.json({
      status: 'online',
      database: 'ai-studio-hrdocumentgovern-f71a32a8-1c50-4d39-bfab-6a034be035cc',
      collections: [
        'employees',
        'documents',
        'versions',
        'acknowledgments',
        'auditLogs',
        'notifications',
      ],
      employeeCount: governanceEngine.getEmployees().length,
      documentCount: governanceEngine.getDocumentMasters().length,
      acknowledgmentCount: governanceEngine.getAcknowledgements().length,
    });
  });

  // Get all documents
  app.get('/api/documents', (req, res) => {
    const { category, search, companyId } = req.query;
    const docs = governanceEngine.getDocumentMasters({
      category: category as any,
      search: search as string,
      companyId: companyId as string,
    });
    res.json(docs);
  });

  // Get specific document by ID
  app.get('/api/documents/:id', (req, res) => {
    const doc = governanceEngine.getDocumentMasterById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const versions = governanceEngine.getDocumentVersions(doc.id);
    res.json({ document: doc, versions });
  });

  // Create new document & Version 1.0
  app.post('/api/documents', async (req, res) => {
    try {
      const { userId, ...data } = req.body;
      const user = governanceEngine.getUserById(userId);
      if (!user) {
        return res.status(401).json({ error: 'Authenticated user required' });
      }
      const result = await governanceEngine.createDocument(user, data);
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create document' });
    }
  });

  // Delete a single document master
  app.delete('/api/documents/:id', async (req, res) => {
    try {
      const user = governanceEngine.getUsers().find((u) => u.role === 'CREATOR');
      await governanceEngine.deleteDocument(req.params.id, user);
      res.json({ success: true, message: `Document ${req.params.id} deleted successfully.` });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete document' });
    }
  });

  // Clear / Purge all documents and versions from database
  app.delete('/api/documents', async (req, res) => {
    try {
      const user = governanceEngine.getUsers().find((u) => u.role === 'CREATOR');
      await governanceEngine.clearAllDocuments(user);
      res.json({ success: true, message: 'All documents, versions, and acknowledgements have been removed from the database.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to clear documents' });
    }
  });

  // Restore seed documents
  app.post('/api/documents/restore-seed', async (req, res) => {
    try {
      await governanceEngine.restoreDefaultSeed();
      res.json({ success: true, message: 'Sample seed documents restored successfully.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to restore seed documents' });
    }
  });

  // Get versions for a document
  app.get('/api/documents/:id/versions', (req, res) => {
    const doc = governanceEngine.getDocumentMasterById(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const versions = governanceEngine.getDocumentVersions(doc.id);
    res.json(versions);
  });

  // Create new version for a document
  app.post('/api/documents/:id/versions', async (req, res) => {
    try {
      const { userId, ...data } = req.body;
      const user = governanceEngine.getUserById(userId);
      if (!user) {
        return res.status(401).json({ error: 'Authenticated user required' });
      }
      const version = await governanceEngine.createNewVersion(user, {
        documentMasterId: req.params.id,
        ...data,
      });
      res.status(201).json(version);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create version' });
    }
  });

  // Review Queue
  app.get('/api/review/queue', (req, res) => {
    const queue = governanceEngine.getReviewQueue();
    res.json(queue);
  });

  // Get specific version
  app.get('/api/versions/:id', (req, res) => {
    const version = governanceEngine.getVersionById(req.params.id);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }
    res.json(version);
  });

  // Get comparison for a version
  app.get('/api/versions/:id/comparison', (req, res) => {
    try {
      const comparison = governanceEngine.getComparison(req.params.id);
      res.json(comparison);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to generate comparison' });
    }
  });

  // Approve a version
  app.post('/api/versions/:id/review/approve', async (req, res) => {
    try {
      const { userId, notes } = req.body;
      const user = governanceEngine.getUserById(userId);
      if (!user) {
        return res.status(401).json({ error: 'Authenticated reviewer required' });
      }
      const result = await governanceEngine.approveVersion(user, req.params.id, notes);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Approval failed' });
    }
  });

  // Reject a version (Mandatory comments)
  app.post('/api/versions/:id/review/reject', async (req, res) => {
    try {
      const { userId, comments } = req.body;
      const user = governanceEngine.getUserById(userId);
      if (!user) {
        return res.status(401).json({ error: 'Authenticated reviewer required' });
      }
      const version = await governanceEngine.rejectVersion(user, req.params.id, comments);
      res.json(version);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Rejection failed' });
    }
  });

  // Audit Logs
  app.get('/api/audit', (req, res) => {
    const { documentId, action, userId } = req.query;
    const logs = auditService.getLogs({
      documentId: documentId as string,
      action: action as any,
      userId: userId as string,
    });
    res.json(logs);
  });

  // Notifications
  app.get('/api/notifications', (req, res) => {
    const notifs = governanceEngine.getNotifications();
    res.json(notifs);
  });

  // Acknowledgements & Compliance
  app.get('/api/acknowledgements', (req, res) => {
    const { employeeId } = req.query;
    const acks = governanceEngine.getAcknowledgements(employeeId as string);
    res.json(acks);
  });

  app.get('/api/compliance/stats', (req, res) => {
    const stats = governanceEngine.getEmployeeComplianceStats();
    res.json(stats);
  });

  app.post('/api/compliance/remind', async (req, res) => {
    try {
      const { ackId, senderId } = req.body;
      const sender = governanceEngine.getUserById(senderId) || governanceEngine.getUsers()[0];
      const result = await governanceEngine.sendComplianceReminder(ackId, sender);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to dispatch reminder' });
    }
  });

  app.post('/api/compliance/batch-remind', async (req, res) => {
    try {
      const { senderId, documentId } = req.body;
      const sender = governanceEngine.getUserById(senderId) || governanceEngine.getUsers()[0];
      const result = await governanceEngine.sendBatchReminders(sender, documentId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to dispatch batch reminders' });
    }
  });

  app.post('/api/compliance/acknowledge-offline', (req, res) => {
    try {
      const { ackId, notes, adminId } = req.body;
      const admin = governanceEngine.getUserById(adminId) || governanceEngine.getUsers()[0];
      const result = governanceEngine.recordManualSignOff(ackId, notes, admin);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to record manual sign-off' });
    }
  });

  app.post('/api/acknowledgements', (req, res) => {
    try {
      const { employeeId, documentId, versionNumber } = req.body;
      const user = governanceEngine.getUserById(employeeId);
      if (!user) {
        return res.status(401).json({ error: 'Authenticated employee required' });
      }
      const result = governanceEngine.acknowledgeDocument(user, documentId, versionNumber);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Acknowledgement failed' });
    }
  });

  // Automated Re-Review Reminder Dispatch API (Manual trigger or external cron webhook)
  app.post('/api/governance/check-re-review-reminders', async (req, res) => {
    try {
      const { force = false, mockDaysNotice = 2, targetDocId } = req.body || {};
      const result = await governanceEngine.checkAndDispatchReReviewReminders({
        force,
        mockDaysNotice,
        targetDocId,
      });
      res.json(result);
    } catch (err: any) {
      console.error('Error in /api/governance/check-re-review-reminders:', err);
      res.status(500).json({ error: err.message || 'Failed checking re-review reminders' });
    }
  });

  // Storage Upload Endpoint (Handles Videos, PDFs, DOCXs & Large Media)
  app.post('/api/storage/upload', async (req, res) => {
    try {
      const { fileName = 'media_asset', mimeType = 'application/octet-stream', dataUrl, base64, documentId = 'doc', versionId } = req.body;

      let buffer: Buffer;
      if (dataUrl && typeof dataUrl === 'string') {
        if (dataUrl.includes('base64,')) {
          const base64Str = dataUrl.split('base64,')[1];
          buffer = Buffer.from(base64Str, 'base64');
        } else {
          buffer = Buffer.from(dataUrl, 'utf-8');
        }
      } else if (base64 && typeof base64 === 'string') {
        buffer = Buffer.from(base64, 'base64');
      } else {
        return res.status(400).json({ error: 'dataUrl or base64 payload is required' });
      }

      const safeDocId = (documentId || 'doc').replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = path.extname(safeFileName) || (mimeType.includes('video') ? '.mp4' : mimeType.includes('pdf') ? '.pdf' : mimeType.includes('wordprocessingml') ? '.docx' : '.bin');
      const fileId = `${safeDocId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
      const targetPath = path.join(UPLOADS_DIR, fileId);

      // Write media binary to persistent disk storage
      fs.writeFileSync(targetPath, buffer);

      // Write metadata file
      const meta = {
        fileId,
        fileName: safeFileName,
        mimeType,
        sizeBytes: buffer.length,
        documentId,
        versionId,
        uploadedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(UPLOADS_DIR, `${fileId}.meta.json`), JSON.stringify(meta, null, 2));

      // Also register in memory storage provider
      defaultStorageProvider.storeFile(fileId, buffer.toString('binary'), {
        fileName: safeFileName,
        mimeType,
        sizeBytes: buffer.length,
      });

      res.status(201).json({
        success: true,
        fileId,
        fileUrl: `/api/storage/file/${fileId}?t=${signStorageToken(fileId)}`,
        fileName: safeFileName,
        mimeType,
        sizeBytes: buffer.length,
      });
    } catch (err: any) {
      console.error('[Server Storage] Upload error:', err);
      res.status(500).json({ error: err.message || 'Failed to upload media file' });
    }
  });

  // Media Streaming & Retrieval Endpoint (Supports HTML5 video range streaming)
  app.get('/api/storage/file/:fileId', (req, res) => {
    try {
      if (!verifyStorageToken(path.basename(req.params.fileId), req.query.t)) return res.status(403).json({ error: 'Invalid or missing file link.' });
      const rawFileId = path.basename(req.params.fileId);
      let fileId = rawFileId;
      let filePath = path.join(UPLOADS_DIR, fileId);

      if (!fs.existsSync(filePath)) {
        // Fallback 1: Scan meta files in UPLOADS_DIR for matching versionId, documentId, or fileName
        try {
          const allUploads = fs.readdirSync(UPLOADS_DIR);
          for (const item of allUploads) {
            if (item.endsWith('.meta.json')) {
              try {
                const meta = JSON.parse(fs.readFileSync(path.join(UPLOADS_DIR, item), 'utf8'));
                if (
                  meta.fileId === rawFileId ||
                  meta.versionId === rawFileId ||
                  meta.documentId === rawFileId ||
                  meta.fileName === rawFileId ||
                  (meta.documentId && rawFileId.includes(meta.documentId)) ||
                  (meta.versionId && rawFileId.includes(meta.versionId))
                ) {
                  const candidatePath = path.join(UPLOADS_DIR, meta.fileId);
                  if (fs.existsSync(candidatePath)) {
                    fileId = meta.fileId;
                    filePath = candidatePath;
                    break;
                  }
                }
              } catch (parseErr) {}
            }
          }
        } catch (e) {}

        // Fallback 2: Search file name prefix / suffix in UPLOADS_DIR
        if (!fs.existsSync(filePath)) {
          try {
            const allUploads = fs.readdirSync(UPLOADS_DIR);
            const match = allUploads.find(
              (f) => !f.endsWith('.meta.json') && (f.includes(rawFileId) || rawFileId.includes(f))
            );
            if (match) {
              fileId = match;
              filePath = path.join(UPLOADS_DIR, match);
            }
          } catch (e) {}
        }

        // Fallback 3: Search governanceEngine document versions in memory for dataUrl
        if (!fs.existsSync(filePath)) {
          try {
            const allVersions = governanceEngine.getDocumentVersions();
            const matchedVer = allVersions.find(
              (v) =>
                v.id === rawFileId ||
                v.fileName === rawFileId ||
                (v.fileUrl && v.fileUrl.includes(rawFileId)) ||
                (v.originalFileUrl && v.originalFileUrl.includes(rawFileId))
            );
            if (matchedVer) {
              const dataUrl =
                (matchedVer.originalFileUrl && matchedVer.originalFileUrl.startsWith('data:'))
                  ? matchedVer.originalFileUrl
                  : (matchedVer.fileUrl && matchedVer.fileUrl.startsWith('data:'))
                  ? matchedVer.fileUrl
                  : null;
              if (dataUrl && dataUrl.includes('base64,')) {
                const b64 = dataUrl.split('base64,')[1];
                const recoveredBuffer = Buffer.from(b64, 'base64');
                fs.writeFileSync(filePath, recoveredBuffer);
              }
            }
          } catch (e) {}
        }
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `File not found: ${rawFileId}` });
      }

      // Read metadata if available
      let mimeType = 'application/octet-stream';
      const metaPath = path.join(UPLOADS_DIR, `${fileId}.meta.json`);
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          mimeType = meta.mimeType || mimeType;
        } catch (e) {}
      } else {
        const ext = path.extname(fileId).toLowerCase();
        if (ext === '.mp4') mimeType = 'video/mp4';
        else if (ext === '.webm') mimeType = 'video/webm';
        else if (ext === '.mov') mimeType = 'video/quicktime';
        else if (ext === '.pdf') mimeType = 'application/pdf';
        else if (ext === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      // Handle HTTP Range Requests (Critical for video scrubbing, playback & seek!)
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize) {
          res.status(416).send(`Requested range not satisfiable\n${start} >= ${fileSize}`);
          return;
        }

        const chunksize = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=86400',
        };
        res.writeHead(206, head);
        fileStream.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=86400',
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
      }
    } catch (err: any) {
      console.error('[Server Storage] File stream error:', err);
      res.status(500).json({ error: 'Error streaming requested file' });
    }
  });

  // Storage Download by fileId
  app.get('/api/storage/download/:fileId', (req, res) => {
    try {
      if (!verifyStorageToken(path.basename(req.params.fileId), req.query.t)) return res.status(403).json({ error: 'Invalid or missing file link.' });
      const rawFileId = path.basename(req.params.fileId);
      let fileId = rawFileId;
      let filePath = path.join(UPLOADS_DIR, fileId);

      if (!fs.existsSync(filePath)) {
        try {
          const allUploads = fs.readdirSync(UPLOADS_DIR);
          for (const item of allUploads) {
            if (item.endsWith('.meta.json')) {
              try {
                const meta = JSON.parse(fs.readFileSync(path.join(UPLOADS_DIR, item), 'utf8'));
                if (
                  meta.fileId === rawFileId ||
                  meta.versionId === rawFileId ||
                  meta.documentId === rawFileId ||
                  meta.fileName === rawFileId ||
                  (meta.documentId && rawFileId.includes(meta.documentId)) ||
                  (meta.versionId && rawFileId.includes(meta.versionId))
                ) {
                  const candidatePath = path.join(UPLOADS_DIR, meta.fileId);
                  if (fs.existsSync(candidatePath)) {
                    fileId = meta.fileId;
                    filePath = candidatePath;
                    break;
                  }
                }
              } catch (parseErr) {}
            }
          }
        } catch (e) {}

        if (!fs.existsSync(filePath)) {
          try {
            const allUploads = fs.readdirSync(UPLOADS_DIR);
            const match = allUploads.find(
              (f) => !f.endsWith('.meta.json') && (f.includes(rawFileId) || rawFileId.includes(f))
            );
            if (match) {
              fileId = match;
              filePath = path.join(UPLOADS_DIR, match);
            }
          } catch (e) {}
        }

        // Fallback: Check governanceEngine document versions in memory for dataUrl
        if (!fs.existsSync(filePath)) {
          try {
            const allVersions = governanceEngine.getDocumentVersions();
            const matchedVer = allVersions.find(
              (v) =>
                v.id === rawFileId ||
                v.fileName === rawFileId ||
                (v.fileUrl && v.fileUrl.includes(rawFileId)) ||
                (v.originalFileUrl && v.originalFileUrl.includes(rawFileId))
            );
            if (matchedVer) {
              const dataUrl =
                (matchedVer.originalFileUrl && matchedVer.originalFileUrl.startsWith('data:'))
                  ? matchedVer.originalFileUrl
                  : (matchedVer.fileUrl && matchedVer.fileUrl.startsWith('data:'))
                  ? matchedVer.fileUrl
                  : null;
              if (dataUrl && dataUrl.includes('base64,')) {
                const b64 = dataUrl.split('base64,')[1];
                const recoveredBuffer = Buffer.from(b64, 'base64');
                fs.writeFileSync(filePath, recoveredBuffer);
              }
            }
          } catch (e) {}
        }
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `File not found: ${rawFileId}` });
      }

      let downloadName = fileId;
      const metaPath = path.join(UPLOADS_DIR, `${fileId}.meta.json`);
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          downloadName = meta.fileName || downloadName;
        } catch (e) {}
      }

      res.download(filePath, downloadName);
    } catch (err: any) {
      res.status(500).json({ error: 'Error downloading file' });
    }
  });

  // Storage Download (Legacy key query)
  app.get('/api/storage/download', async (req, res) => {
    try {
      const key = req.query.key as string;
      if (!key) {
        return res.status(400).json({ error: 'Storage key is required' });
      }

      let file: { data: string; metadata: any } | null = null;
      try {
        file = await defaultStorageProvider.downloadFile(key);
      } catch {
        // Fallback: search version dynamically from governanceEngine
        const allVersions = governanceEngine.getDocumentVersions();
        const ver = allVersions.find(
          v => v.storageKey === key || v.fileName === key || (v.storageKey && key.endsWith(v.storageKey))
        );
        if (ver && ver.rawContent) {
          defaultStorageProvider.storeFile(ver.storageKey || key, ver.rawContent, {
            fileName: ver.fileName,
            mimeType: ver.mimeType,
            sizeBytes: ver.fileSize,
            storagePath: ver.storagePath,
          });
          file = await defaultStorageProvider.downloadFile(ver.storageKey || key);
        }
      }

      if (!file) {
        return res.status(404).json({ error: 'File not found in storage provider' });
      }

      // If requested as DOCX but stored as text/markdown, synthesize authentic corporate DOCX
      if (
        (file.metadata.fileName.endsWith('.docx') || file.metadata.mimeType?.includes('wordprocessingml')) &&
        typeof file.data === 'string' &&
        !file.data.startsWith('PK')
      ) {
        try {
          const docxBlob = await generateCorporateDocxBlob({
            documentTitle: file.metadata.fileName.replace(/\.docx$/i, ''),
            versionNumber: '2.0',
            effectiveDate: new Date().toISOString(),
            createdByName: 'Amee Shah',
            approvedByName: 'Vishal Shah',
            approvedDate: new Date().toISOString(),
            companyName: 'Amaavigo',
            rawContent: file.data,
            fileName: file.metadata.fileName,
          });
          const docxBytes = Buffer.from(await docxBlob.arrayBuffer());
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
          res.setHeader('Content-Disposition', `attachment; filename="${file.metadata.fileName}"`);
          return res.send(docxBytes);
        } catch (docxErr) {
          console.warn('Server-side DOCX generation fallback:', docxErr);
        }
      }

      // If requested as a PDF but stored as non-binary text/markdown, synthesize a valid corporate PDF
      if (
        (file.metadata.fileName.endsWith('.pdf') || file.metadata.mimeType === 'application/pdf') &&
        typeof file.data === 'string' &&
        !file.data.startsWith('%PDF')
      ) {
        try {
          const pdfBlob = generateCorporatePdfBlob({
            documentTitle: file.metadata.fileName.replace(/\.pdf$/i, ''),
            versionNumber: '2.0',
            effectiveDate: new Date().toISOString(),
            createdByName: 'Amee Shah',
            approvedByName: 'Vishal Shah',
            approvedDate: new Date().toISOString(),
            companyName: 'Amaavigo',
            rawContent: file.data,
            fileName: file.metadata.fileName,
          });
          const pdfBytes = Buffer.from(await pdfBlob.arrayBuffer());
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${file.metadata.fileName}"`);
          return res.send(pdfBytes);
        } catch (pdfErr) {
          console.warn('Server-side PDF generation fallback:', pdfErr);
        }
      }

      res.setHeader('Content-Type', file.metadata.mimeType || 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${file.metadata.fileName}"`);
      res.send(file.data);
    } catch (err: any) {
      res.status(404).json({ error: 'File not found in storage provider' });
    }
  });

  // Reset to seed data
  app.post('/api/system/reset', (req, res) => {
    governanceEngine.resetToSeed();
    res.json({ message: 'System state reset to baseline seed data successfully.' });
  });

  // Catch unmatched API routes to ensure they never fall through to Vite SPA index.html
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route ${req.method} ${req.originalUrl} not found` });
  });

  // Environment detection: Check if running from compiled production bundle
  const isCompiledServer = typeof __filename !== 'undefined' && __filename.includes('dist');
  const distPath = path.join(process.cwd(), 'dist');
  const distIndexPath = path.join(distPath, 'index.html');
  const rootIndexPath = path.join(process.cwd(), 'index.html');

  if (isCompiledServer && fs.existsSync(distIndexPath)) {
    // Production compiled server mode: Serve static assets from dist
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (fs.existsSync(distIndexPath)) {
        res.sendFile(distIndexPath);
      } else if (fs.existsSync(rootIndexPath)) {
        res.sendFile(rootIndexPath);
      } else {
        res.status(200).send('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
      }
    });
  } else {
    // Development / Live Preview mode: Always mount Vite middleware
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.warn('Vite middleware initialization warning:', viteErr);
      if (fs.existsSync(distIndexPath)) {
        app.use(express.static(distPath));
        app.get('*', (_req, res) => res.sendFile(distIndexPath));
      } else if (fs.existsSync(rootIndexPath)) {
        app.use(express.static(process.cwd()));
        app.get('*', (_req, res) => res.sendFile(rootIndexPath));
      }
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`HR Document Governance Server running on http://0.0.0.0:${PORT} [mode: ${isCompiledServer ? 'production-bundle' : 'development-vite'}]`);

    // Automated Background Re-Review Checker (runs shortly after server boot)
    setTimeout(async () => {
      try {
        console.log('[Scheduler] Running initial automated policy re-review check...');
        const result = await governanceEngine.checkAndDispatchReReviewReminders();
        console.log(`[Scheduler] Initial re-review check completed: ${result.sentCount} reminder(s) dispatched across ${result.checkedDocs} documents.`);
      } catch (err) {
        console.warn('[Scheduler] Notice during initial re-review check:', err);
      }
    }, 4000);

    // Automated Daily Re-Review Heartbeat (runs every 24 hours)
    setInterval(async () => {
      try {
        console.log('[Scheduler] Daily automated policy re-review heartbeat executing...');
        const result = await governanceEngine.checkAndDispatchReReviewReminders();
        console.log(`[Scheduler] Daily check completed: ${result.sentCount} reminder(s) dispatched.`);
      } catch (err) {
        console.warn('[Scheduler] Daily re-review check error:', err);
      }
    }, 24 * 60 * 60 * 1000);
  });

  const handleShutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down gracefully...`);
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});