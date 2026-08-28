import {
  AcknowledgementRecord,
  AuditAction,
  ConfidentialityLevel,
  DocumentCategory,
  DocumentComparisonResult,
  DocumentMaster,
  DocumentPublicationRecord,
  DocumentVersion,
  EmailNotification,
  User,
  UserRole,
  VersionStatus,
  VersionType,
} from '../types';
import {
  SEED_AUDIT_LOGS,
  SEED_DOCUMENTS,
  SEED_USERS,
  SEED_VERSIONS,
} from '../data/seedData';
import { auditService } from './audit';
import { compareDocumentTexts } from './comparison';
import { defaultEmailProvider } from './email';
import { calculateSha256, defaultStorageProvider } from './storage';
import { firestoreService } from './firestoreService';

export class DocumentGovernanceEngine {
  private users: User[] = [...SEED_USERS];
  private documentMasters: DocumentMaster[] = [...SEED_DOCUMENTS];
  private documentVersions: DocumentVersion[] = [...SEED_VERSIONS];
  private publicationRecords: DocumentPublicationRecord[] = [];
  private acknowledgements: AcknowledgementRecord[] = [];
  private comparisons: Map<string, DocumentComparisonResult> = new Map();

  constructor() {
    auditService.seedLogs(SEED_AUDIT_LOGS);
    this.initDefaultAcknowledgements();
  }

  private initDefaultAcknowledgements() {
    // Seed an initial acknowledgement for the employee Parth (AM001)
    this.acknowledgements.push({
      id: 'ack-001',
      documentId: 'AMA-HR-POL-001',
      documentTitle: 'Work From Home (WFH) Policy',
      versionNumber: '1.0',
      documentVersionId: 'ver-001-v10',
      employeeId: 'AM001',
      employeeName: 'Parth',
      employeeEmail: 'parth@amaavigo.in',
      status: 'ACKNOWLEDGED',
      acknowledgedAt: '2026-08-05T10:00:00Z',
    });
    // Note: v2.0 is pending acknowledgement for Parth!
    this.acknowledgements.push({
      id: 'ack-002',
      documentId: 'AMA-HR-POL-001',
      documentTitle: 'Work From Home (WFH) Policy',
      versionNumber: '2.0',
      documentVersionId: 'ver-001-v20',
      employeeId: 'AM001',
      employeeName: 'Parth',
      employeeEmail: 'parth@amaavigo.in',
      status: 'PENDING',
    });
  }

  // Generate permanent Document ID safely (e.g. AMA-HR-POL-001, AMA-HR-SOP-002)
  public generateNextDocumentId(category: DocumentCategory, prefix: string = 'AMA'): string {
    const categoryCodes: Record<DocumentCategory, string> = {
      [DocumentCategory.POLICY]: 'POL',
      [DocumentCategory.SOP]: 'SOP',
      [DocumentCategory.FORM]: 'FRM',
      [DocumentCategory.TEMPLATE]: 'TMP',
      [DocumentCategory.MANUAL]: 'MAN',
      [DocumentCategory.NOTICE]: 'NOT',
      [DocumentCategory.CHECKLIST]: 'CHK',
      [DocumentCategory.OFFER_LETTER]: 'OFF',
      [DocumentCategory.APPOINTMENT_LETTER]: 'APP',
      [DocumentCategory.EMPLOYEE_DOCUMENT]: 'EMP',
      [DocumentCategory.TRAINING_MATERIAL]: 'TRN',
      [DocumentCategory.OTHER]: 'DOC',
    };

    const catCode = categoryCodes[category] || 'DOC';
    const pattern = new RegExp(`^${prefix}-HR-${catCode}-(\\d+)$`);
    let maxSequence = 0;

    for (const doc of this.documentMasters) {
      const match = doc.documentId.match(pattern);
      if (match && match[1]) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSequence) {
          maxSequence = seq;
        }
      }
    }

    const nextSeq = (maxSequence + 1).toString().padStart(3, '0');
    return `${prefix}-HR-${catCode}-${nextSeq}`;
  }

  // Calculate next version number based on baseline and revision type
  public calculateNextVersionNumber(baselineVersionNumber: string, revisionType: VersionType): string {
    const parts = baselineVersionNumber.split('.');
    const major = parseInt(parts[0] || '1', 10);
    const minor = parseInt(parts[1] || '0', 10);

    if (revisionType === VersionType.MAJOR) {
      return `${major + 1}.0`;
    } else {
      return `${major}.${minor + 1}`;
    }
  }

  // Get all users
  public getUsers(): User[] {
    return this.users;
  }

  public getUserById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  // Get all Document Masters
  public getDocumentMasters(filter?: { category?: DocumentCategory; companyId?: string; search?: string }): DocumentMaster[] {
    let result = [...this.documentMasters];
    if (filter?.category) {
      result = result.filter((d) => d.category === filter.category);
    }
    if (filter?.companyId) {
      result = result.filter((d) => d.companyId === filter.companyId);
    }
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.documentId.toLowerCase().includes(q) ||
          d.category.toLowerCase().includes(q) ||
          d.departmentName.toLowerCase().includes(q)
      );
    }
    return result;
  }

  public getDocumentMasterById(id: string): DocumentMaster | undefined {
    return this.documentMasters.find((d) => d.id === id || d.documentId === id);
  }

  // Get all Versions for a Document Master
  public getDocumentVersions(documentMasterId: string): DocumentVersion[] {
    return this.documentVersions
      .filter((v) => v.documentMasterId === documentMasterId)
      .sort((a, b) => {
        // Sort newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  public getVersionById(id: string): DocumentVersion | undefined {
    return this.documentVersions.find((v) => v.id === id);
  }

  public getReviewQueue(): DocumentVersion[] {
    return this.documentVersions
      .filter((v) => v.status === VersionStatus.IN_REVIEW)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  // Create New Document Master and initial Version 1.0 (IN_REVIEW)
  public async createDocument(
    creator: User,
    data: {
      title: string;
      category: DocumentCategory;
      companyId: string;
      companyName: string;
      departmentId: string;
      departmentName: string;
      processOwnerId?: string;
      processOwnerName?: string;
      documentOwnerId?: string;
      documentOwnerName?: string;
      confidentiality: ConfidentialityLevel;
      acknowledgementRequired: boolean;
      effectiveFrom: string;
      reviewDueDate: string;
      description?: string;
      fileName: string;
      rawContent: string;
      mimeType?: string;
      fileDataUrl?: string;
    }
  ): Promise<{ master: DocumentMaster; version: DocumentVersion }> {
    if (creator.role !== UserRole.CREATOR && creator.role !== UserRole.REVIEWER) {
      throw new Error('Unauthorized: User must have HR Creator or Reviewer role to author documents.');
    }

    if (!data.title?.trim()) throw new Error('Validation error: Document title is required.');
    if (!data.rawContent?.trim()) throw new Error('Validation error: Document content or file upload is required.');

    const documentId = this.generateNextDocumentId(data.category);
    const masterId = `doc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const versionId = `ver-${Date.now()}-v10`;
    const versionNumber = '1.0';

    // Store file in Storage Provider
    const storageMeta = await defaultStorageProvider.uploadFile(
      documentId,
      data.category,
      versionNumber,
      data.fileName || `${data.title.replace(/[^a-zA-Z0-9]/g, '_')}_v1.0.txt`,
      data.rawContent,
      data.mimeType || 'text/markdown'
    );

    const newMaster: DocumentMaster = {
      id: masterId,
      documentId,
      title: data.title.trim(),
      category: data.category,
      companyId: data.companyId || creator.companyId,
      companyName: data.companyName || creator.companyName,
      departmentId: data.departmentId || creator.departmentId,
      departmentName: data.departmentName || creator.departmentName,
      processOwnerId: data.processOwnerId || creator.id,
      processOwnerName: data.processOwnerName || creator.name,
      documentOwnerId: data.documentOwnerId || creator.id,
      documentOwnerName: data.documentOwnerName || creator.name,
      confidentiality: data.confidentiality,
      acknowledgementRequired: data.acknowledgementRequired,
      currentStatus: VersionStatus.IN_REVIEW,
      description: data.description || '',
      createdById: creator.id,
      createdByName: creator.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      active: true,
    };

    const newVersion: DocumentVersion = {
      id: versionId,
      documentMasterId: masterId,
      documentId,
      documentTitle: data.title.trim(),
      versionNumber,
      versionType: VersionType.INITIAL,
      status: VersionStatus.IN_REVIEW,
      fileName: storageMeta.fileName,
      fileSize: storageMeta.sizeBytes,
      mimeType: storageMeta.mimeType,
      storageKey: storageMeta.storageKey,
      storagePath: storageMeta.storagePath,
      fileUrl: data.fileDataUrl || defaultStorageProvider.getFileUrl(storageMeta.storageKey),
      contentHash: storageMeta.contentHash,
      rawContent: data.rawContent,
      createdById: creator.id,
      createdByName: creator.name,
      createdAt: new Date().toISOString(),
      effectiveFrom: data.effectiveFrom || new Date().toISOString().split('T')[0],
      reviewDueDate: data.reviewDueDate || new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
      changeSummary: 'Initial document baseline submission.',
      locked: false,
    };

    this.documentMasters.unshift(newMaster);
    this.documentVersions.unshift(newVersion);

    // Persist to Cloud Firestore (non-blocking)
    try {
      firestoreService.saveDocument(newMaster).catch((e) => console.warn('Firestore doc sync:', e));
      firestoreService.saveVersion(newVersion).catch((e) => console.warn('Firestore ver sync:', e));
    } catch (e) {
      console.warn('Firestore cloud sync error:', e);
    }

    // Audit logs
    auditService.logEvent(AuditAction.DOCUMENT_CREATED, creator, {
      documentMasterId: masterId,
      documentId,
      documentVersionId: versionId,
      versionNumber,
      reason: `Created Document Master [${documentId}] "${newMaster.title}"`,
    });

    auditService.logEvent(AuditAction.FILE_UPLOADED, creator, {
      documentMasterId: masterId,
      documentId,
      documentVersionId: versionId,
      versionNumber,
      newValue: storageMeta.storageKey,
      reason: `Uploaded initial file with SHA-256 hash: ${storageMeta.contentHash}`,
    });

    auditService.logEvent(AuditAction.SUBMITTED_FOR_REVIEW, creator, {
      documentMasterId: masterId,
      documentId,
      documentVersionId: versionId,
      versionNumber,
      reason: `Submitted version 1.0 for Reviewer authorization queue`,
    });

    return { master: newMaster, version: newVersion };
  }

  // Create New Version for an existing Document Master
  public async createNewVersion(
    creator: User,
    data: {
      documentMasterId: string;
      revisionType: VersionType;
      rawContent: string;
      fileName: string;
      changeSummary: string;
      effectiveFrom?: string;
      reviewDueDate?: string;
      mimeType?: string;
      fileDataUrl?: string;
    }
  ): Promise<DocumentVersion> {
    if (creator.role !== UserRole.CREATOR && creator.role !== UserRole.REVIEWER) {
      throw new Error('Unauthorized: User must have HR Creator or Reviewer role to author revisions.');
    }

    const master = this.getDocumentMasterById(data.documentMasterId);
    if (!master) {
      throw new Error(`Document Master not found: ${data.documentMasterId}`);
    }

    // Determine baseline: Current published version, or latest version if none published
    let baselineVersion: DocumentVersion | undefined;
    if (master.currentPublishedVersionId) {
      baselineVersion = this.getVersionById(master.currentPublishedVersionId);
    }
    if (!baselineVersion) {
      const allVersions = this.getDocumentVersions(master.id);
      baselineVersion = allVersions[0];
    }

    const baselineNumber = baselineVersion ? baselineVersion.versionNumber : '1.0';
    const nextVersionNumber = this.calculateNextVersionNumber(baselineNumber, data.revisionType);

    // Concurrency / Duplicate version prevention
    const existing = this.documentVersions.find(
      (v) => v.documentMasterId === master.id && v.versionNumber === nextVersionNumber
    );
    if (existing) {
      throw new Error(`Version conflict: Version ${nextVersionNumber} already exists for document ${master.documentId}.`);
    }

    const versionId = `ver-${Date.now()}-v${nextVersionNumber.replace('.', '')}`;

    // Store revised file in Storage Provider
    const storageMeta = await defaultStorageProvider.uploadFile(
      master.documentId,
      master.category,
      nextVersionNumber,
      data.fileName || `${master.title.replace(/[^a-zA-Z0-9]/g, '_')}_v${nextVersionNumber}.txt`,
      data.rawContent,
      data.mimeType || 'text/markdown'
    );

    const newVersion: DocumentVersion = {
      id: versionId,
      documentMasterId: master.id,
      documentId: master.documentId,
      documentTitle: master.title,
      versionNumber: nextVersionNumber,
      versionType: data.revisionType,
      status: VersionStatus.IN_REVIEW,
      fileName: storageMeta.fileName,
      fileSize: storageMeta.sizeBytes,
      mimeType: storageMeta.mimeType,
      storageKey: storageMeta.storageKey,
      storagePath: storageMeta.storagePath,
      fileUrl: data.fileDataUrl || defaultStorageProvider.getFileUrl(storageMeta.storageKey),
      contentHash: storageMeta.contentHash,
      rawContent: data.rawContent,
      createdById: creator.id,
      createdByName: creator.name,
      createdAt: new Date().toISOString(),
      effectiveFrom: data.effectiveFrom || new Date().toISOString().split('T')[0],
      reviewDueDate: data.reviewDueDate || master.updatedAt.split('T')[0],
      previousVersionId: baselineVersion?.id,
      previousVersionNumber: baselineVersion?.versionNumber,
      changeSummary: data.changeSummary || `Revision ${nextVersionNumber} created from baseline ${baselineNumber}.`,
      locked: false,
      createdFromVersionId: baselineVersion?.id,
    };

    this.documentVersions.unshift(newVersion);

    // Update master status to indicate active version in review
    master.currentStatus = VersionStatus.IN_REVIEW;
    master.updatedAt = new Date().toISOString();

    // Persist to Cloud Firestore (non-blocking)
    try {
      firestoreService.saveDocument(master).catch((e) => console.warn('Firestore doc sync:', e));
      firestoreService.saveVersion(newVersion).catch((e) => console.warn('Firestore ver sync:', e));
    } catch (e) {
      console.warn('Firestore cloud sync error:', e);
    }

    // Audit logs
    auditService.logEvent(AuditAction.VERSION_CREATED, creator, {
      documentMasterId: master.id,
      documentId: master.documentId,
      documentVersionId: versionId,
      versionNumber: nextVersionNumber,
      reason: `Created revision v${nextVersionNumber} (${data.revisionType}) against baseline v${baselineNumber}`,
    });

    auditService.logEvent(AuditAction.FILE_UPLOADED, creator, {
      documentMasterId: master.id,
      documentId: master.documentId,
      documentVersionId: versionId,
      versionNumber: nextVersionNumber,
      newValue: storageMeta.storageKey,
      reason: `Uploaded revised file with SHA-256 hash: ${storageMeta.contentHash}`,
    });

    auditService.logEvent(AuditAction.SUBMITTED_FOR_REVIEW, creator, {
      documentMasterId: master.id,
      documentId: master.documentId,
      documentVersionId: versionId,
      versionNumber: nextVersionNumber,
      reason: `Submitted v${nextVersionNumber} for Reviewer queue`,
    });

    return newVersion;
  }

  // Get or compute comparison against baseline
  public getComparison(newVersionId: string): DocumentComparisonResult {
    if (this.comparisons.has(newVersionId)) {
      return this.comparisons.get(newVersionId)!;
    }

    const newVersion = this.getVersionById(newVersionId);
    if (!newVersion) {
      throw new Error(`Version not found: ${newVersionId}`);
    }

    const master = this.getDocumentMasterById(newVersion.documentMasterId);
    if (!master) {
      throw new Error(`Document Master not found for version: ${newVersionId}`);
    }

    // Baseline rule: Always compare against the baseline version (e.g. current published version or previousVersionId)
    let baselineVersion: DocumentVersion | undefined;
    if (newVersion.previousVersionId) {
      baselineVersion = this.getVersionById(newVersion.previousVersionId);
    }
    if (!baselineVersion && master.currentPublishedVersionId) {
      baselineVersion = this.getVersionById(master.currentPublishedVersionId);
    }
    if (!baselineVersion) {
      const allVersions = this.getDocumentVersions(master.id);
      baselineVersion = allVersions.find((v) => v.id !== newVersion.id);
    }

    const oldText = baselineVersion ? baselineVersion.rawContent : '';
    const oldVersionId = baselineVersion ? baselineVersion.id : '';
    const oldVersionNumber = baselineVersion ? baselineVersion.versionNumber : '0.0 (None)';

    const result = compareDocumentTexts(
      master.id,
      oldVersionId,
      oldVersionNumber,
      oldText,
      newVersion.id,
      newVersion.versionNumber,
      newVersion.rawContent,
      newVersion.changeSummary
    );

    this.comparisons.set(newVersionId, result);
    return result;
  }

  // REVIEWER APPROVAL & AUTOMATIC PUBLISHING
  public async approveVersion(
    reviewer: User,
    versionId: string,
    notes?: string
  ): Promise<{ version: DocumentVersion; publication: DocumentPublicationRecord }> {
    if (reviewer.role !== UserRole.REVIEWER) {
      throw new Error('Forbidden: Only an authorized HR Reviewer can approve and publish documents.');
    }

    const version = this.getVersionById(versionId);
    if (!version) throw new Error(`Version not found: ${versionId}`);

    if (version.status !== VersionStatus.IN_REVIEW) {
      throw new Error(`Invalid status transition: Cannot approve a version in ${version.status} status.`);
    }

    const master = this.getDocumentMasterById(version.documentMasterId);
    if (!master) throw new Error(`Document Master not found for version ${versionId}`);

    // Verify file hash integrity
    const hashValid = await defaultStorageProvider.verifyFileHash(version.storageKey, version.contentHash);
    if (!hashValid) {
      auditService.logEvent(AuditAction.FILE_HASH_VALIDATED, reviewer, {
        documentMasterId: master.id,
        documentId: master.documentId,
        documentVersionId: version.id,
        versionNumber: version.versionNumber,
        reason: 'CRITICAL: File hash mismatch detected prior to approval. Publication blocked.',
      });
      throw new Error('Security check failed: Document file hash does not match original upload hash.');
    }

    const nowIso = new Date().toISOString();

    // 1. Lock the version & set status APPROVED/PUBLISHED
    version.locked = true;
    version.status = VersionStatus.PUBLISHED;
    version.reviewedById = reviewer.id;
    version.reviewedByName = reviewer.name;
    version.reviewedAt = nowIso;
    version.publishedById = reviewer.id;
    version.publishedByName = reviewer.name;
    version.publishedAt = nowIso;
    if (notes) version.reviewerComments = notes;

    // 2. Identify previous published version and mark SUPERSEDED
    const previousPublishedId = master.currentPublishedVersionId;
    if (previousPublishedId && previousPublishedId !== version.id) {
      const prevVersion = this.getVersionById(previousPublishedId);
      if (prevVersion && prevVersion.status === VersionStatus.PUBLISHED) {
        prevVersion.status = VersionStatus.SUPERSEDED;
        prevVersion.supersededByVersionId = version.id;

        auditService.logEvent(AuditAction.VERSION_SUPERSEDED, reviewer, {
          documentMasterId: master.id,
          documentId: master.documentId,
          documentVersionId: prevVersion.id,
          versionNumber: prevVersion.versionNumber,
          oldValue: 'PUBLISHED',
          newValue: 'SUPERSEDED',
          reason: `Automatically superseded upon approved publication of version ${version.versionNumber}`,
        });
      }
    }

    // 3. Update Document Master pointer
    master.currentPublishedVersionId = version.id;
    master.currentPublishedVersionNumber = version.versionNumber;
    master.currentStatus = VersionStatus.PUBLISHED;
    master.updatedAt = nowIso;

    // Persist changes to Cloud Firestore
    try {
      firestoreService.saveDocument(master).catch((e) => console.warn('Firestore doc sync:', e));
      firestoreService.saveVersion(version).catch((e) => console.warn('Firestore ver sync:', e));
    } catch (e) {
      console.warn('Firestore cloud sync error:', e);
    }

    // 4. Create Publication Record
    const publication: DocumentPublicationRecord = {
      id: `pub-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      documentVersionId: version.id,
      documentId: master.documentId,
      versionNumber: version.versionNumber,
      publishedById: reviewer.id,
      publishedByName: reviewer.name,
      publishedAt: nowIso,
      effectiveDate: version.effectiveFrom,
      audience: master.confidentiality,
      notificationStatus: 'SENT',
      publicationUrl: version.fileUrl,
      contentHash: version.contentHash,
      createdAt: nowIso,
    };
    this.publicationRecords.unshift(publication);

    // 5. Audit logs
    auditService.logEvent(AuditAction.REVIEW_APPROVED, reviewer, {
      documentMasterId: master.id,
      documentId: master.documentId,
      documentVersionId: version.id,
      versionNumber: version.versionNumber,
      reason: notes || 'Reviewer approved content for publication.',
    });

    auditService.logEvent(AuditAction.VERSION_PUBLISHED, reviewer, {
      documentMasterId: master.id,
      documentId: master.documentId,
      documentVersionId: version.id,
      versionNumber: version.versionNumber,
      oldValue: 'IN_REVIEW',
      newValue: 'PUBLISHED',
      reason: `Version ${version.versionNumber} is now the operational live version for ${master.title}`,
    });

    // 6. Automatically dispatch Employee Notifications (Sent when acknowledgement is required)
    if (master.acknowledgementRequired) {
      const emailSubject = `[Action Required] New HR Policy Published — ${master.title} v${version.versionNumber}`;
      const emailBody = `Dear Employee,\n\nA new official HR document has been published and requires your mandatory compliance review and electronic sign-off:\n\n` +
        `• Document Title: ${master.title}\n` +
        `• Document ID: ${master.documentId}\n` +
        `• Category: ${master.category}\n` +
        `• Department: ${master.departmentName}\n` +
        `• Version Number: v${version.versionNumber} (${version.versionType} Release)\n` +
        `• Effective Date: ${version.effectiveFrom || 'Immediate'}\n` +
        `• Summary of Changes: ${version.changeSummary || 'New document baseline release.'}\n` +
        `• Compliance Acknowledgement Required: YES (Mandatory within 14 days)\n\n` +
        `Please log in to the Employee Portal using your Employee ID and Password to read and acknowledge this version:\n` +
        `${version.fileUrl}\n\n` +
        `Sincerely,\nHuman Resources Governance & Compliance Team\n${master.companyName}`;

      // Send only to active employees
      const employeeAudience = this.users.filter((u) => u.active && u.role === UserRole.EMPLOYEE);
      for (const emp of employeeAudience) {
        await defaultEmailProvider.sendEmail(emp.email, emp.name, emailSubject, emailBody, {
          documentId: master.documentId,
          documentTitle: master.title,
          versionNumber: version.versionNumber,
          documentVersionId: version.id,
          acknowledgementRequired: true,
        });

        // Create pending acknowledgement entry
        const pendingAck: AcknowledgementRecord = {
          id: `ack-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          documentId: master.documentId,
          documentTitle: master.title,
          versionNumber: version.versionNumber,
          documentVersionId: version.id,
          employeeId: emp.id,
          employeeName: emp.name,
          employeeEmail: emp.email,
          status: 'PENDING',
        };
        this.acknowledgements.push(pendingAck);

        try {
          firestoreService.saveAcknowledgement(pendingAck).catch((e) => console.warn('Firestore ack save error:', e));
        } catch (e) {
          console.warn('Firestore ack save note:', e);
        }
      }

      auditService.logEvent(AuditAction.NOTIFICATION_SENT, reviewer, {
        documentMasterId: master.id,
        documentId: master.documentId,
        documentVersionId: version.id,
        versionNumber: version.versionNumber,
        reason: `Dispatched mandatory acknowledgement email notification for v${version.versionNumber} to all employees.`,
      });
    } else {
      auditService.logEvent(AuditAction.NOTIFICATION_SENT, reviewer, {
        documentMasterId: master.id,
        documentId: master.documentId,
        documentVersionId: version.id,
        versionNumber: version.versionNumber,
        reason: `Published v${version.versionNumber} without email broadcast (No employee acknowledgement required).`,
      });
    }

    return { version, publication };
  }

  // REVIEWER REJECTION (Mandatory comments required)
  public async rejectVersion(
    reviewer: User,
    versionId: string,
    comments: string
  ): Promise<DocumentVersion> {
    if (reviewer.role !== UserRole.REVIEWER) {
      throw new Error('Forbidden: Only an authorized HR Reviewer can reject documents.');
    }

    if (!comments?.trim()) {
      throw new Error('Validation error: Rejection comments are mandatory. You must state the specific reason for requesting revisions.');
    }

    const version = this.getVersionById(versionId);
    if (!version) throw new Error(`Version not found: ${versionId}`);

    if (version.status !== VersionStatus.IN_REVIEW) {
      throw new Error(`Invalid status transition: Cannot reject a version in ${version.status} status.`);
    }

    const master = this.getDocumentMasterById(version.documentMasterId);
    if (!master) throw new Error(`Document Master not found for version ${versionId}`);

    const nowIso = new Date().toISOString();

    // Mark REVISION_REQUIRED
    version.status = VersionStatus.REVISION_REQUIRED;
    version.reviewedById = reviewer.id;
    version.reviewedByName = reviewer.name;
    version.reviewedAt = nowIso;
    version.reviewerComments = comments.trim();
    version.locked = false; // Remains unlocked or editable/viewable

    // CRITICAL: Document Master does NOT change its current published version.
    // If master has a published version, master status stays PUBLISHED or reflects revisions pending.
    master.currentStatus = master.currentPublishedVersionId ? VersionStatus.PUBLISHED : VersionStatus.REVISION_REQUIRED;
    master.updatedAt = nowIso;

    // Audit logs
    auditService.logEvent(AuditAction.REVIEW_REJECTED, reviewer, {
      documentMasterId: master.id,
      documentId: master.documentId,
      documentVersionId: version.id,
      versionNumber: version.versionNumber,
      oldValue: 'IN_REVIEW',
      newValue: 'REVISION_REQUIRED',
      reason: comments.trim(),
    });

    auditService.logEvent(AuditAction.REVISION_REQUESTED, reviewer, {
      documentMasterId: master.id,
      documentId: master.documentId,
      documentVersionId: version.id,
      versionNumber: version.versionNumber,
      reason: `Returned version ${version.versionNumber} to Creator (${version.createdByName}) with feedback: "${comments.trim()}"`,
    });

    return version;
  }

  // Employee Acknowledgement
  public acknowledgeDocument(
    employee: User,
    documentId: string,
    versionNumber: string
  ): AcknowledgementRecord {
    let ack = this.acknowledgements.find(
      (a) => a.documentId === documentId && a.versionNumber === versionNumber && a.employeeId === employee.id
    );

    const nowIso = new Date().toISOString();

    if (!ack) {
      const master = this.getDocumentMasterById(documentId);
      const version = this.documentVersions.find(
        (v) => v.documentId === documentId && v.versionNumber === versionNumber
      );

      ack = {
        id: `ack-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        documentId,
        documentTitle: master?.title || documentId,
        versionNumber,
        documentVersionId: version?.id || '',
        employeeId: employee.id,
        employeeName: employee.name,
        employeeEmail: employee.email,
        status: 'ACKNOWLEDGED',
        acknowledgedAt: nowIso,
      };
      this.acknowledgements.push(ack);
    } else {
      ack.status = 'ACKNOWLEDGED';
      ack.acknowledgedAt = nowIso;
    }

    try {
      firestoreService.saveAcknowledgement(ack).catch((e) => console.warn('Firestore ack sync:', e));
    } catch (e) {
      console.warn('Firestore ack sync error:', e);
    }

    auditService.logEvent(AuditAction.DOCUMENT_ACKNOWLEDGED, employee, {
      documentId,
      versionNumber,
      reason: `Employee ${employee.name} formally acknowledged ${documentId} v${versionNumber}`,
    });

    return ack;
  }

  public getAcknowledgements(employeeId?: string): AcknowledgementRecord[] {
    if (employeeId) {
      return this.acknowledgements.filter((a) => a.employeeId === employeeId);
    }
    return [...this.acknowledgements];
  }

  public getNotifications(): EmailNotification[] {
    return defaultEmailProvider.getNotifications();
  }

  public getPublicationRecords(): DocumentPublicationRecord[] {
    return [...this.publicationRecords];
  }

  // Reset/Re-seed for testing
  public resetToSeed(): void {
    this.users = [...SEED_USERS];
    this.documentMasters = JSON.parse(JSON.stringify(SEED_DOCUMENTS));
    this.documentVersions = JSON.parse(JSON.stringify(SEED_VERSIONS));
    this.publicationRecords = [];
    this.acknowledgements = [];
    this.comparisons.clear();
    auditService.seedLogs(SEED_AUDIT_LOGS);
    this.initDefaultAcknowledgements();
  }
}

export const governanceEngine = new DocumentGovernanceEngine();
