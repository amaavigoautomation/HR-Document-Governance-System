import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { governanceEngine } from './src/services/governance';
import { auditService } from './src/services/audit';
import { defaultStorageProvider } from './src/services/storage';
import { defaultEmailProvider } from './src/services/email';
import { dispatchLiveEmail, getEmailConfigStatus } from './src/services/serverEmail';
import { UserRole } from './src/types';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // API Health Check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

  // Auth Users
  app.get('/api/auth/users', (req, res) => {
    res.json(governanceEngine.getUsers());
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

  // Acknowledgements
  app.get('/api/acknowledgements', (req, res) => {
    const { employeeId } = req.query;
    const acks = governanceEngine.getAcknowledgements(employeeId as string);
    res.json(acks);
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

  // Storage Download
  app.get('/api/storage/download', async (req, res) => {
    try {
      const key = req.query.key as string;
      if (!key) {
        return res.status(400).json({ error: 'Storage key is required' });
      }
      const file = await defaultStorageProvider.downloadFile(key);
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

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HR Document Governance Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
