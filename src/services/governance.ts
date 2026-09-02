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
    this.syncVersionsToStorage();
  }

  public syncVersionsToStorage(versions: DocumentVersion[] = this.documentVersions): void {
    for (const v of versions) {
      if (v.storageKey && v.rawContent) {
        defaultStorageProvider.storeFile(v.storageKey, v.rawContent, {
          storagePath: v.storagePath,
          fileName: v.fileName,
          mimeType: v.mimeType,
          contentHash: v.contentHash || calculateSha256(v.rawContent),
          sizeBytes: v.fileSize,
        });
      }
    }
  }

  private initDefaultAcknowledgements() {
    const employees = this.users.filter((u) => u.role === UserRole.EMPLOYEE);
    
    // Seed acknowledgements for WFH Policy v1.0 and v2.0
    const wfhMaster = this.documentMasters.find((d) => d.documentId === 'AMA-HR-POL-001');
    const ahMaster = this.documentMasters.find((d) => d.documentId === 'AMA-HR-POL-002');
    const codeMaster = this.documentMasters.find((d) => d.documentId === 'AMA-HR-POL-003');

    employees.forEach((emp, index) => {
      // WFH Policy v1.0 (historical baseline - acknowledged by all except newest)
      if (wfhMaster) {
        this.acknowledgements.push({
          id: `ack-seed-wfh1-${emp.id}`,
          documentId: 'AMA-HR-POL-001',
          documentTitle: 'Work From Home (WFH) Policy',
          versionNumber: '1.0',
          documentVersionId: 'ver-001-v10',
          employeeId: emp.id,
          employeeName: emp.name,
          employeeEmail: emp.email,
          departmentName: emp.departmentName,
          status: 'ACKNOWLEDGED',
          acknowledgedAt: '2026-08-02T10:00:00Z',
          signatureReference: `SIG-E-${emp.id}-0802`,
        });

        // WFH Policy v2.0 (current live revision - some acknowledged, some pending)
        const isAckedV2 = index % 2 === 0 && emp.id !== 'AM001'; // Parth is pending v2.0 for live test
        this.acknowledgements.push({
          id: `ack-seed-wfh2-${emp.id}`,
          documentId: 'AMA-HR-POL-001',
          documentTitle: 'Work From Home (WFH) Policy',
          versionNumber: '2.0',
          documentVersionId: 'ver-001-v20',
          employeeId: emp.id,
          employeeName: emp.name,
          employeeEmail: emp.email,
          departmentName: emp.departmentName,
          status: isAckedV2 ? 'ACKNOWLEDGED' : 'PENDING',
          acknowledgedAt: isAckedV2 ? '2026-08-16T14:30:00Z' : undefined,
          signatureReference: isAckedV2 ? `SIG-E-${emp.id}-0816` : undefined,
        });
      }

      // Anti-Harassment Policy v1.0 (Mandatory compliance - mostly acknowledged)
      if (ahMaster && ahMaster.confidentiality === ConfidentialityLevel.PUBLIC) {
        const isAckedAH = index < 4;
        this.acknowledgements.push({
          id: `ack-seed-ah-${emp.id}`,
          documentId: 'AMA-HR-POL-002',
          documentTitle: 'Anti-Harassment & Workplace Conduct Policy',
          versionNumber: '1.0',
          documentVersionId: 'ver-002-v10',
          employeeId: emp.id,
          employeeName: emp.name,
          employeeEmail: emp.email,
          departmentName: emp.departmentName,
          status: isAckedAH ? 'ACKNOWLEDGED' : 'PENDING',
          acknowledgedAt: isAckedAH ? '2026-08-04T09:15:00Z' : undefined,
          signatureReference: isAckedAH ? `SIG-E-${emp.id}-0804` : undefined,
        });
      }
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
  public calculateNextVersionNumber(
    baselineVersionNumber: string,
    revisionType: VersionType,
    existingVersions?: DocumentVersion[]
  ): string {
    const parts = baselineVersionNumber.split('.');
    let major = parseInt(parts[0] || '1', 10);
    let minor = parseInt(parts[1] || '0', 10);

    if (revisionType === VersionType.MAJOR) {
      if (existingVersions && existingVersions.length > 0) {
        const majors = existingVersions.map((v) => parseInt((v.versionNumber || '1.0').split('.')[0] || '0', 10));
        major = Math.max(major, ...majors);
      }
      return `${major + 1}.0`;
    } else {
      if (existingVersions && existingVersions.length > 0) {
        const minors = existingVersions
          .filter((v) => parseInt((v.versionNumber || '1.0').split('.')[0] || '0', 10) === major)
          .map((v) => parseInt((v.versionNumber || '1.0').split('.')[1] || '0', 10));
        if (minors.length > 0) {
          minor = Math.max(minor, ...minors);
        }
      }
      return `${major}.${minor + 1}`;
    }
  }

  // Get all users
  public getUsers(): User[] {
    return this.users;
  }

  // Get all active reviewers / approvers (APPROVER / REVIEWER) with valid emails
  public getReviewers(): User[] {
    const seenEmails = new Set<string>();
    const reviewers: User[] = [];
    for (const u of this.users) {
      if (u.active === false) continue;
      const email = (u.email || '').trim();
      if (!email || !email.includes('@')) continue;

      const r = (u.role || '').toString().toUpperCase().trim();
      const id = (u.id || '').toLowerCase();
      const loginId = (u.loginId || u.empId || '').toUpperCase().trim();
      const title = (u.title || '').toUpperCase();

      const isReviewer =
        r === 'REVIEWER' ||
        r === 'APPROVER' ||
        r.includes('REVIEWER') ||
        r.includes('APPROVER') ||
        id.includes('reviewer') ||
        id.includes('approver') ||
        id.includes('app') ||
        loginId.startsWith('AMA') ||
        loginId.startsWith('APP') ||
        loginId.startsWith('REV') ||
        loginId === 'APPROVER' ||
        loginId === 'REVIEWER' ||
        title.includes('APPROVER') ||
        title.includes('REVIEWER');

      if (!isReviewer) continue;

      const normalizedEmail = email.toLowerCase();
      if (seenEmails.has(normalizedEmail)) continue;
      seenEmails.add(normalizedEmail);
      reviewers.push({
        ...u,
        email,
      });
    }
    return reviewers;
  }

  // Get all active creators / HR authors (HR / CREATOR) with valid emails
  public getCreators(): User[] {
    const seenEmails = new Set<string>();
    const creators: User[] = [];
    for (const u of this.users) {
      if (u.active === false) continue;
      const email = (u.email || '').trim();
      if (!email || !email.includes('@')) continue;

      const r = (u.role || '').toString().toUpperCase().trim();
      const id = (u.id || '').toLowerCase();
      const loginId = (u.loginId || u.empId || '').toUpperCase().trim();
      const dept = (u.departmentName || u.departmentId || '').toUpperCase();
      const title = (u.title || '').toUpperCase();

      const isCreator =
        r === 'CREATOR' ||
        r === 'HR' ||
        r === 'AUTHOR' ||
        r.includes('CREATOR') ||
        r.includes('HR') ||
        id.includes('creator') ||
        id.includes('hr') ||
        loginId.startsWith('HR') ||
        loginId === 'CREATOR' ||
        dept.includes('HUMAN RESOURCES') ||
        dept === 'HR' ||
        title.includes('HR') ||
        title.includes('CREATOR') ||
        title.includes('AUTHOR');

      if (!isCreator) continue;

      const normalizedEmail = email.toLowerCase();
      if (seenEmails.has(normalizedEmail)) continue;
      seenEmails.add(normalizedEmail);
      creators.push({
        ...u,
        email,
      });
    }
    return creators;
  }

  // Get all employees
  public getEmployees(): User[] {
    return this.users.filter((u) => {
      const r = (u.role || '').toString().toUpperCase();
      return r === 'EMPLOYEE' && u.active !== false;
    });
  }

  public setEmployees(employees: User[]): void {
    if (!employees || employees.length === 0) return;

    // Merge cloud user records by id, preserving existing memory state
    const userMap = new Map<string, User>();
    for (const u of this.users) {
      userMap.set(u.id, u);
    }
    for (const emp of employees) {
      const rawRole = (emp.role || '').toString().toUpperCase().trim();
      const rawLoginId = (emp.loginId || emp.empId || emp.id || '').toString().toUpperCase().trim();
      const rawTitle = (emp.title || (emp as any).designation || '').toString().toUpperCase();
      const rawDept = (emp.departmentName || emp.departmentId || (emp as any).department || '').toString().toUpperCase();
      const lowerId = (emp.id || '').toLowerCase();

      let role = UserRole.EMPLOYEE;
      if (
        rawRole === 'CREATOR' ||
        rawRole === 'HR' ||
        rawRole === 'AUTHOR' ||
        rawRole.includes('CREATOR') ||
        rawRole.includes('HR') ||
        lowerId.includes('creator') ||
        lowerId.includes('hr') ||
        rawLoginId.startsWith('HR') ||
        rawLoginId === 'CREATOR' ||
        rawDept.includes('HUMAN RESOURCES') ||
        rawDept === 'HR' ||
        rawTitle.includes('HR') ||
        rawTitle.includes('CREATOR')
      ) {
        role = UserRole.CREATOR;
      } else if (
        rawRole === 'REVIEWER' ||
        rawRole === 'APPROVER' ||
        rawRole.includes('REVIEWER') ||
        rawRole.includes('APPROVER') ||
        lowerId.includes('reviewer') ||
        lowerId.includes('approver') ||
        lowerId.includes('app') ||
        rawLoginId.startsWith('AMA') ||
        rawLoginId.startsWith('APP') ||
        rawLoginId.startsWith('REV') ||
        rawLoginId === 'APPROVER' ||
        rawLoginId === 'REVIEWER' ||
        rawTitle.includes('APPROVER') ||
        rawTitle.includes('REVIEWER')
      ) {
        role = UserRole.REVIEWER;
      }

      const normalized: User = {
        ...emp,
        id: emp.id,
        empId: emp.empId || (emp as any).employeeId || emp.loginId || emp.id,
        loginId: emp.loginId || emp.empId || (emp as any).employeeId || emp.id,
        name: emp.name || (role === UserRole.CREATOR ? 'HR Creator' : role === UserRole.REVIEWER ? 'Approver' : 'Employee'),
        email: (emp.email || '').trim(),
        role,
        title:
          emp.title ||
          (role === UserRole.CREATOR
            ? 'HR Policy & Governance Lead'
            : role === UserRole.REVIEWER
            ? 'VP of Human Resources & Governance'
            : 'Staff Member'),
        departmentName:
          emp.departmentName ||
          (role === UserRole.CREATOR || role === UserRole.REVIEWER ? 'Human Resources' : 'Operations'),
        companyName: emp.companyName || 'Amaavigo Group',
        password:
          emp.password || (role === UserRole.CREATOR ? 'HR001' : role === UserRole.REVIEWER ? 'AMA001' : 'Parth!123'),
        active: emp.active !== false && (emp as any).status !== 'INACTIVE',
        avatar: emp.avatar || (emp as any).avatarUrl,
      };
      userMap.set(emp.id, normalized);
    }
    this.users = Array.from(userMap.values());
    this.syncDocumentAuthorNames();
    this.ensurePendingAcknowledgementsForEmployees();
  }

  public setUsers(users: User[]): void {
    if (!users || users.length === 0) return;
    const userMap = new Map<string, User>();
    for (const u of this.users) {
      userMap.set(u.id, u);
    }
    for (const u of users) {
      userMap.set(u.id, { ...userMap.get(u.id), ...u });
    }
    this.users = Array.from(userMap.values());
    this.syncDocumentAuthorNames();
    this.ensurePendingAcknowledgementsForEmployees();
  }

  private syncDocumentAuthorNames(): void {
    const creatorUser = this.users.find((u) => u.role === UserRole.CREATOR);
    const reviewerUser = this.users.find((u) => u.role === UserRole.REVIEWER);

    if (creatorUser) {
      for (const doc of this.documentMasters) {
        if (doc.processOwnerName === 'Sarah Jenkins' || doc.createdById === 'usr-hr-001' || doc.createdById === creatorUser.id) {
          doc.processOwnerName = creatorUser.name;
          doc.createdByName = creatorUser.name;
        }
      }
      for (const ver of this.documentVersions) {
        if (ver.createdByName === 'Sarah Jenkins' || ver.createdById === 'usr-hr-001' || ver.createdById === creatorUser.id) {
          ver.createdByName = creatorUser.name;
        }
      }
    }

    if (reviewerUser) {
      for (const doc of this.documentMasters) {
        if (doc.documentOwnerName === 'Marcus Vance') {
          doc.documentOwnerName = reviewerUser.name;
        }
      }
      for (const ver of this.documentVersions) {
        if (ver.reviewedByName === 'Marcus Vance' || ver.reviewedById === 'usr-app-001' || ver.reviewedById === reviewerUser.id) {
          ver.reviewedByName = reviewerUser.name;
        }
        if (ver.publishedByName === 'Marcus Vance' || ver.publishedById === 'usr-app-001' || ver.publishedById === reviewerUser.id) {
          ver.publishedByName = reviewerUser.name;
        }
      }
    }
  }

  // Resolve performer information dynamically so name edits in backend reflect everywhere
  public resolvePerformer(
    userId?: string,
    role?: UserRole | string,
    fallbackName?: string
  ): { name: string; role: UserRole; title: string; email: string } {
    // 1. Direct ID match
    if (userId) {
      const match = this.users.find(
        (u) =>
          u.id === userId ||
          (u.empId && u.empId.toLowerCase() === userId.toLowerCase()) ||
          (u.loginId && u.loginId.toLowerCase() === userId.toLowerCase())
      );
      if (match) {
        return {
          name: match.name,
          role: match.role,
          title: match.title,
          email: match.email,
        };
      }
    }

    // 2. Creator / HR role match
    const rawRole = (role || '').toString().toUpperCase();
    if (
      rawRole === 'CREATOR' ||
      rawRole === 'HR' ||
      userId === 'usr-hr-001' ||
      fallbackName === 'Sarah Jenkins' ||
      fallbackName?.toLowerCase().includes('sarah')
    ) {
      const creator = this.users.find(
        (u) => u.role === UserRole.CREATOR || u.id === 'usr-hr-001' || u.loginId === 'HR' || u.loginId === 'HR001'
      );
      if (creator) {
        return {
          name: creator.name,
          role: UserRole.CREATOR,
          title: creator.title,
          email: creator.email,
        };
      }
    }

    // 3. Reviewer / Approver role match
    if (
      rawRole === 'REVIEWER' ||
      rawRole === 'APPROVER' ||
      userId === 'usr-app-001' ||
      fallbackName === 'Marcus Vance' ||
      fallbackName?.toLowerCase().includes('marcus')
    ) {
      const reviewer = this.users.find(
        (u) => u.role === UserRole.REVIEWER || u.id === 'usr-app-001' || u.loginId === 'APPROVER' || u.loginId === 'AMA001'
      );
      if (reviewer) {
        return {
          name: reviewer.name,
          role: UserRole.REVIEWER,
          title: reviewer.title,
          email: reviewer.email,
        };
      }
    }

    // 4. By fallback name if exists in current directory
    if (fallbackName) {
      const byName = this.users.find((u) => u.name.toLowerCase() === fallbackName.toLowerCase());
      if (byName) {
        return {
          name: byName.name,
          role: byName.role,
          title: byName.title,
          email: byName.email,
        };
      }
    }

    let defaultRole = UserRole.EMPLOYEE;
    if (rawRole === 'CREATOR' || rawRole === 'HR') defaultRole = UserRole.CREATOR;
    if (rawRole === 'REVIEWER' || rawRole === 'APPROVER') defaultRole = UserRole.REVIEWER;

    return {
      name: fallbackName || 'System User',
      role: defaultRole,
      title: '',
      email: '',
    };
  }

  // Ensure every active employee has a pending acknowledgement for all active published public policies
  public ensurePendingAcknowledgementsForEmployees(): void {
    const activeEmployees = this.getEmployees();
    const publishedPublicDocs = this.documentMasters.filter(
      (d) => d.active && d.currentStatus === VersionStatus.PUBLISHED && d.confidentiality === ConfidentialityLevel.PUBLIC && d.acknowledgementRequired
    );

    let createdCount = 0;
    for (const emp of activeEmployees) {
      for (const doc of publishedPublicDocs) {
        const empIdentifiers = [emp.id, emp.empId, emp.loginId, emp.email].filter(Boolean).map((s) => s!.toLowerCase());
        const hasAck = this.acknowledgements.some(
          (a) =>
            a.documentId === doc.documentId &&
            (empIdentifiers.includes(a.employeeId?.toLowerCase()) || (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase())))
        );

        if (!hasAck) {
          const activeVer = this.documentVersions.find((v) => v.id === doc.currentPublishedVersionId) ||
            this.documentVersions.filter((v) => v.documentMasterId === doc.id && v.status === VersionStatus.PUBLISHED).pop();

          const pendingAck: AcknowledgementRecord = {
            id: `ack-${Date.now()}-${emp.id.replace(/[^a-zA-Z0-9]/g, '')}-${Math.random().toString(36).substr(2, 4)}`,
            documentId: doc.documentId,
            documentTitle: doc.title,
            versionNumber: activeVer?.versionNumber || doc.currentPublishedVersionNumber || '1.0',
            documentVersionId: activeVer?.id || '',
            employeeId: emp.id,
            employeeName: emp.name,
            employeeEmail: emp.email,
            departmentName: emp.departmentName,
            status: 'PENDING',
          };
          this.acknowledgements.push(pendingAck);
          createdCount++;
          try {
            firestoreService.saveAcknowledgement(pendingAck).catch((e) => console.warn('Sync new employee ack:', e));
          } catch (e) {
            // ignore
          }
        }
      }
    }
    if (createdCount > 0) {
      console.log(`[Governance] Initialized ${createdCount} pending compliance acknowledgements for active employees.`);
    }
  }

  // Update a user (HR, Reviewer, or Employee) and persist to Firestore
  public async updateUser(updatedUser: User): Promise<User> {
    const index = this.users.findIndex((u) => u.id === updatedUser.id);
    if (index >= 0) {
      this.users[index] = { ...this.users[index], ...updatedUser };
    } else {
      this.users.push(updatedUser);
    }

    try {
      await firestoreService.saveEmployee(updatedUser);
    } catch (e) {
      console.warn('[Governance] Cloud Firestore user update note:', e);
    }

    auditService.logEvent(AuditAction.USER_UPDATED, updatedUser, {
      reason: `Profile information for ${updatedUser.name} (${updatedUser.role}) was updated and synced to Firestore.`,
    });

    return updatedUser;
  }

  public setAcknowledgements(acks: AcknowledgementRecord[]): void {
    this.acknowledgements = acks;
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
      acknowledgementRequired: data.confidentiality === ConfidentialityLevel.INTERNAL ? false : (data.acknowledgementRequired ?? true),
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

    // Notify Approver(s) via email that a new document has been created and requires review
    try {
      const reviewers = this.getReviewers();
      const emailSubject = `[Action Required: Review] New Document Created: [${documentId}] ${newMaster.title} (v${versionNumber})`;
      const emailBody = `Dear Approver,\n\nA new document has been created by HR and submitted to the review queue for your authorization:\n\n• Document ID: ${documentId}\n• Title: ${newMaster.title}\n• Version: v${versionNumber} (Initial Baseline)\n• Category: ${newMaster.category}\n• Department: ${newMaster.departmentName}\n• Created By: ${creator.name} (${creator.title})\n\nPlease sign in to the Governance Portal, inspect the document content and security baseline, and perform your decision (Approve & Publish or Request Revisions).\n\nSincerely,\nHR Document Governance Automation System\n${newMaster.companyName}`;

      for (const rev of reviewers) {
        if (rev.email) {
          defaultEmailProvider.sendEmail(rev.email, rev.name, emailSubject, emailBody, {
            documentId: newMaster.documentId,
            documentTitle: newMaster.title,
            versionNumber,
            documentVersionId: versionId,
            acknowledgementRequired: false,
          }).catch((err) => console.warn('[Governance] Reviewer email notification error:', err));
        }
      }
    } catch (e) {
      console.warn('[Governance] Could not trigger reviewer notification email:', e);
    }

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
      previousVersionId?: string;
    }
  ): Promise<DocumentVersion> {
    if (creator.role !== UserRole.CREATOR && creator.role !== UserRole.REVIEWER) {
      throw new Error('Unauthorized: User must have HR Creator or Reviewer role to author revisions.');
    }

    const master = this.getDocumentMasterById(data.documentMasterId);
    if (!master) {
      throw new Error(`Document Master not found: ${data.documentMasterId}`);
    }

    // Guard: Do not allow authoring a new version if a version is currently IN_REVIEW
    const inReviewVersion = this.documentVersions.find(
      (v) => (v.documentMasterId === master.id || v.documentId === master.documentId) && v.status === VersionStatus.IN_REVIEW
    );
    if (inReviewVersion || master.currentStatus === VersionStatus.IN_REVIEW) {
      throw new Error(
        `Cannot create revision: Document [${master.documentId}] currently has version v${inReviewVersion?.versionNumber || ''} in review. Please wait for the reviewer's approval or revision request.`
      );
    }

    // Determine baseline & predecessor:
    // 1. If explicit data.previousVersionId passed, use that.
    // 2. If there is a REVISION_REQUIRED version (the rejected draft being addressed), that is the immediate predecessor!
    // 3. Otherwise, check the newest existing version in allVersions.
    // 4. Otherwise, fallback to master.currentPublishedVersionId.
    const allVersions = this.getDocumentVersions(master.id);
    let predecessorVersion: DocumentVersion | undefined;
    if (data.previousVersionId) {
      predecessorVersion = this.getVersionById(data.previousVersionId);
    }
    if (!predecessorVersion) {
      predecessorVersion = allVersions.find((v) => v.status === VersionStatus.REVISION_REQUIRED);
    }
    if (!predecessorVersion && allVersions.length > 0) {
      predecessorVersion = allVersions[0];
    }
    if (!predecessorVersion && master.currentPublishedVersionId) {
      predecessorVersion = this.getVersionById(master.currentPublishedVersionId);
    }

    const baselineNumber = predecessorVersion
      ? predecessorVersion.versionNumber
      : master.currentPublishedVersionNumber || '1.0';
    const nextVersionNumber = this.calculateNextVersionNumber(baselineNumber, data.revisionType, allVersions);

    // Concurrency / Duplicate version prevention
    const existing = this.documentVersions.find(
      (v) => v.documentMasterId === master.id && v.versionNumber === nextVersionNumber && v.status === VersionStatus.IN_REVIEW
    );
    if (existing) {
      throw new Error(`Version conflict: Version ${nextVersionNumber} is already in review for document ${master.documentId}.`);
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
      previousVersionId: predecessorVersion?.id,
      previousVersionNumber: predecessorVersion?.versionNumber,
      changeSummary: data.changeSummary || `Revision ${nextVersionNumber} created from predecessor ${baselineNumber}.`,
      locked: false,
      createdFromVersionId: predecessorVersion?.id,
    };

    this.documentVersions.unshift(newVersion);

    // Update master status to indicate active version in review
    master.currentStatus = VersionStatus.IN_REVIEW;
    master.updatedAt = new Date().toISOString();

    // Mark any preceding REVISION_REQUIRED versions for this document master as SUPERSEDED now that next version is authored
    const prevRevisionRequired = this.documentVersions.filter(
      (v) => (v.documentMasterId === master.id || v.documentId === master.documentId) && v.id !== versionId && v.status === VersionStatus.REVISION_REQUIRED
    );
    for (const prevVer of prevRevisionRequired) {
      prevVer.status = VersionStatus.SUPERSEDED;
      prevVer.locked = true;
    }

    // Persist to Cloud Firestore
    try {
      await firestoreService.saveDocument(master);
      await firestoreService.saveVersion(newVersion);
      for (const prevVer of prevRevisionRequired) {
        await firestoreService.saveVersion(prevVer);
      }
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

    // Notify Approver(s) via email that a revised document version has been created and requires review
    try {
      const reviewers = this.getReviewers();
      const emailSubject = `[Action Required: Review] Revised Version Created: [${master.documentId}] ${master.title} (v${nextVersionNumber})`;
      const emailBody = `Dear Approver,\n\nA revised version of document [${master.documentId}] has been authored by HR and submitted to your review queue:\n\n• Document ID: ${master.documentId}\n• Title: ${master.title}\n• New Version: v${nextVersionNumber} (${data.revisionType} revision)\n• Baseline Comparison: v${baselineNumber}\n• Change Summary: ${data.changeSummary || 'Revised document version submitted.'}\n• Created By: ${creator.name} (${creator.title})\n\nPlease sign in to the Governance Portal to compare changes against baseline v${baselineNumber} and render your authorization decision.\n\nSincerely,\nHR Document Governance Automation System\n${master.companyName}`;

      for (const rev of reviewers) {
        if (rev.email) {
          defaultEmailProvider.sendEmail(rev.email, rev.name, emailSubject, emailBody, {
            documentId: master.documentId,
            documentTitle: master.title,
            versionNumber: nextVersionNumber,
            documentVersionId: versionId,
            acknowledgementRequired: false,
          }).catch((err) => console.warn('[Governance] Reviewer email notification error:', err));
        }
      }
    } catch (e) {
      console.warn('[Governance] Could not trigger reviewer notification email for revised version:', e);
    }

    return newVersion;
  }

  // Get or compute comparison against baseline
  public getComparison(newVersionId: string, customBaselineVersionId?: string): DocumentComparisonResult {
    const newVersion = this.getVersionById(newVersionId);
    if (!newVersion) {
      throw new Error(`Version not found: ${newVersionId}`);
    }

    const master = this.getDocumentMasterById(newVersion.documentMasterId);
    if (!master) {
      throw new Error(`Document Master not found for version: ${newVersionId}`);
    }

    // Baseline rule: Use custom baseline if explicitly requested, otherwise use previousVersionId, then published baseline, then fallback
    let baselineVersion: DocumentVersion | undefined;
    if (customBaselineVersionId) {
      baselineVersion = this.getVersionById(customBaselineVersionId);
    } else if (newVersion.previousVersionId) {
      baselineVersion = this.getVersionById(newVersion.previousVersionId);
    } else if (master.currentPublishedVersionId) {
      baselineVersion = this.getVersionById(master.currentPublishedVersionId);
    } else {
      const allVersions = this.getDocumentVersions(master.id);
      baselineVersion = allVersions.find((v) => v.id !== newVersion.id);
    }

    const cacheKey = `${newVersionId}_${baselineVersion?.id || 'none'}`;
    if (this.comparisons.has(cacheKey)) {
      return this.comparisons.get(cacheKey)!;
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

    this.comparisons.set(cacheKey, result);
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

    if (version.status !== VersionStatus.IN_REVIEW || version.reviewedAt) {
      throw new Error(
        `Decision already finalized: An approver decision has already been rendered for Document ID ${version.documentId} ("${version.documentTitle}") v${version.versionNumber} with status ${version.status}. Duplicate reviews are prohibited.`
      );
    }

    const master = this.getDocumentMasterById(version.documentMasterId);
    if (!master) throw new Error(`Document Master not found for version ${versionId}`);

    // Verify file hash integrity with storage fallback
    const expectedHash = version.contentHash || (version.rawContent ? calculateSha256(version.rawContent) : '');
    const hashValid = await defaultStorageProvider.verifyFileHash(version.storageKey, expectedHash, version.rawContent);
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

    // Ensure version has contentHash populated
    if (!version.contentHash && expectedHash) {
      version.contentHash = expectedHash;
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
      await firestoreService.saveDocument(master);
      await firestoreService.saveVersion(version);
      if (previousPublishedId && previousPublishedId !== version.id) {
        const prevVersion = this.getVersionById(previousPublishedId);
        if (prevVersion) {
          await firestoreService.saveVersion(prevVersion);
        }
      }
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

    // 6. Automatically dispatch Employee Notifications for PUBLIC policies
    if (master.confidentiality === ConfidentialityLevel.PUBLIC) {
      if (master.acknowledgementRequired) {
        // MANDATORY ACKNOWLEDGEMENT BROADCAST
        const emailSubject = `[Action Required] New HR Document Published — ${master.title}`;
        const emailBody = `Dear Employee,\n\nAn official company document has been approved and published in the Amaavigo HR Governance system, and requires your mandatory compliance review and electronic sign-off:\n\n` +
          `• Document Title: ${master.title}\n` +
          `• Document ID: ${master.documentId}\n` +
          `• Category: ${master.category}\n` +
          `• Department: ${master.departmentName}\n` +
          `• Effective Date: ${version.effectiveFrom || 'Immediate'}\n` +
          `• Compliance Acknowledgement Required: YES (Mandatory within 14 calendar days)\n\n` +
          `HOW TO COMPLY:\n` +
          `1. Log in to your Amaavigo Employee Portal using your Employee ID and credentials.\n` +
          `2. Navigate to the Employee Portal tab.\n` +
          `3. Review the complete document and complete your electronic compliance acknowledgment.\n\n` +
          `Note: To ensure document security, confidentiality, and tamper-proof version control, documents are securely accessed directly inside the authenticated Employee Portal.\n\n` +
          `Sincerely,\nHuman Resources Governance & Compliance Team\n${master.companyName}`;

        const employeeAudience = this.getEmployees();
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
            id: `ack-${Date.now()}-${emp.id.replace(/[^a-zA-Z0-9]/g, '')}-${Math.random().toString(36).substr(2, 4)}`,
            documentId: master.documentId,
            documentTitle: master.title,
            versionNumber: version.versionNumber,
            documentVersionId: version.id,
            employeeId: emp.id,
            employeeName: emp.name,
            employeeEmail: emp.email,
            departmentName: emp.departmentName,
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
          reason: `Dispatched mandatory acknowledgement email notification for Public Document to all active employees.`,
        });
      } else {
        // INFORMATIONAL NOTIFICATION BROADCAST (No acknowledgement required)
        const emailSubject = `[Notice] New HR Document Published — ${master.title}`;
        const emailBody = `Dear Employee,\n\nAn official company document has been published in the Amaavigo HR Governance system for your information and reference:\n\n` +
          `• Document Title: ${master.title}\n` +
          `• Document ID: ${master.documentId}\n` +
          `• Category: ${master.category}\n` +
          `• Department: ${master.departmentName}\n` +
          `• Effective Date: ${version.effectiveFrom || 'Immediate'}\n` +
          `• Compliance Acknowledgement Required: NO (Informational / Reference only)\n\n` +
          `You can view and read the complete document anytime by logging into the Amaavigo Employee Portal.\n\n` +
          `Sincerely,\nHuman Resources Governance & Compliance Team\n${master.companyName}`;

        const employeeAudience = this.getEmployees();
        for (const emp of employeeAudience) {
          await defaultEmailProvider.sendEmail(emp.email, emp.name, emailSubject, emailBody, {
            documentId: master.documentId,
            documentTitle: master.title,
            versionNumber: version.versionNumber,
            documentVersionId: version.id,
            acknowledgementRequired: false,
          });
        }

        auditService.logEvent(AuditAction.NOTIFICATION_SENT, reviewer, {
          documentMasterId: master.id,
          documentId: master.documentId,
          documentVersionId: version.id,
          versionNumber: version.versionNumber,
          reason: `Dispatched informational notification email for Public Document to all active employees (No acknowledgement required).`,
        });
      }
    } else {
      auditService.logEvent(AuditAction.NOTIFICATION_SENT, reviewer, {
        documentMasterId: master.id,
        documentId: master.documentId,
        documentVersionId: version.id,
        versionNumber: version.versionNumber,
        reason: `Published v${version.versionNumber} as Internal Company document (Restricted to HR & Approvers; hidden from Employee Portal with zero employee notifications/acknowledgements).`,
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

    if (version.status !== VersionStatus.IN_REVIEW || version.reviewedAt) {
      throw new Error(
        `Decision already finalized: An approver decision has already been rendered for Document ID ${version.documentId} ("${version.documentTitle}") v${version.versionNumber} with status ${version.status}. Duplicate reviews are prohibited.`
      );
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

    // CRITICAL: Document Master does NOT remove its current published version record,
    // but the master governance status reflects REVISION_REQUIRED so creator dashboards and directories highlight action needed.
    master.currentStatus = VersionStatus.REVISION_REQUIRED;
    master.updatedAt = nowIso;

    // Persist changes to Cloud Firestore
    try {
      await firestoreService.saveDocument(master);
      await firestoreService.saveVersion(version);
    } catch (e) {
      console.warn('Firestore cloud sync error:', e);
    }

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

    // Notify all HR users in the database via email that revision is required along with comments
    try {
      const hrUsers = this.getCreators();
      const emailSubject = `[Revision Required] Changes Requested: [${master.documentId}] ${master.title} (v${version.versionNumber})`;
      const emailBody = `Dear HR,\n\nApprover ${reviewer.name} (${reviewer.title}) has reviewed version v${version.versionNumber} of document [${master.documentId}] "${master.title}" and requested revisions before approval.\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCHANGES REQUIRED / APPROVER FEEDBACK:\n"${comments.trim()}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n• Document ID: ${master.documentId}\n• Title: ${master.title}\n• Reviewed Version: v${version.versionNumber}\n• Reviewed By: ${reviewer.name} (${reviewer.title})\n• Status: Revision Required\n\nPlease navigate to the "Action Required: Revisions" tab in your HR Author Dashboard to revise the document text and submit the next version.\n\nSincerely,\nHR Document Governance Automation System\n${master.companyName}`;

      const sentEmails = new Set<string>();
      for (const hr of hrUsers) {
        if (hr.email && !sentEmails.has(hr.email.toLowerCase())) {
          sentEmails.add(hr.email.toLowerCase());
          defaultEmailProvider.sendEmail(hr.email, hr.name || 'HR Team', emailSubject, emailBody, {
            documentId: master.documentId,
            documentTitle: master.title,
            versionNumber: version.versionNumber,
            documentVersionId: version.id,
            acknowledgementRequired: false,
          }).catch((err) => console.warn('[Governance] HR revision required email notification error:', err));
        }
      }

      // Also ensure the original creator gets it if not already in sent list
      const creatorTarget = this.getUserById(version.createdById);
      if (creatorTarget?.email && !sentEmails.has(creatorTarget.email.toLowerCase())) {
        sentEmails.add(creatorTarget.email.toLowerCase());
        defaultEmailProvider.sendEmail(creatorTarget.email, creatorTarget.name || 'HR Document Author', emailSubject, emailBody, {
          documentId: master.documentId,
          documentTitle: master.title,
          versionNumber: version.versionNumber,
          documentVersionId: version.id,
          acknowledgementRequired: false,
        }).catch((err) => console.warn('[Governance] Creator rejection email notification error:', err));
      }
    } catch (e) {
      console.warn('[Governance] Could not trigger HR notification email for revision required:', e);
    }

    return version;
  }

  // Employee Acknowledgement
  public acknowledgeDocument(
    employee: User,
    documentId: string,
    versionNumber: string
  ): AcknowledgementRecord {
    // Robust employee match by ID, empId, loginId, or email
    const empIdentifiers = [employee.id, employee.empId, employee.loginId, employee.email].filter(Boolean);

    let ack = this.acknowledgements.find(
      (a) =>
        a.documentId === documentId &&
        a.versionNumber === versionNumber &&
        (empIdentifiers.includes(a.employeeId) || (a.employeeEmail && a.employeeEmail.toLowerCase() === employee.email.toLowerCase()))
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
        departmentName: employee.departmentName,
        status: 'ACKNOWLEDGED',
        acknowledgedAt: nowIso,
      };
      this.acknowledgements.push(ack);
    } else {
      ack.status = 'ACKNOWLEDGED';
      ack.acknowledgedAt = nowIso;
      ack.employeeId = employee.id;
      ack.employeeName = employee.name;
      ack.employeeEmail = employee.email;
    }

    try {
      firestoreService.saveAcknowledgement(ack).catch((e) => console.warn('Firestore ack sync:', e));
    } catch (e) {
      console.warn('Firestore ack sync error:', e);
    }

    auditService.logEvent(AuditAction.DOCUMENT_ACKNOWLEDGED, employee, {
      documentId,
      versionNumber,
      reason: `Employee ${employee.name} (${employee.empId || employee.email}) formally acknowledged ${documentId} v${versionNumber}`,
    });

    return ack;
  }

  public getAcknowledgements(employeeIdentifier?: string): AcknowledgementRecord[] {
    const publishedPublicDocs = this.documentMasters.filter(
      (d) =>
        d.active &&
        d.currentStatus === VersionStatus.PUBLISHED &&
        d.acknowledgementRequired &&
        d.confidentiality === ConfidentialityLevel.PUBLIC
    );
    const validDocIds = new Set(publishedPublicDocs.map((d) => d.documentId));

    // Filter stored acknowledgements to only include currently valid published public documents
    const validStoredAcks = this.acknowledgements.filter((a) => validDocIds.has(a.documentId));

    if (employeeIdentifier) {
      const target = employeeIdentifier.toLowerCase();
      return validStoredAcks.filter(
        (a) =>
          a.employeeId?.toLowerCase() === target ||
          a.employeeEmail?.toLowerCase() === target
      );
    }
    return [...validStoredAcks];
  }

  // Get aggregated compliance stats per employee
  public getEmployeeComplianceStats(): any[] {
    const employees = this.users.filter((u) => {
      const r = (u.role || '').toString().toUpperCase();
      return r === 'EMPLOYEE' && u.active !== false;
    });
    const publishedPublicDocs = this.documentMasters.filter(
      (d) =>
        d.active &&
        d.currentStatus === VersionStatus.PUBLISHED &&
        d.acknowledgementRequired &&
        d.confidentiality === ConfidentialityLevel.PUBLIC
    );

    return employees.map((emp) => {
      const empIdentifiers = [emp.id, emp.empId, emp.loginId, emp.email].filter(Boolean).map((s) => s!.toLowerCase());

      const records = publishedPublicDocs.map((doc) => {
        const existing = this.acknowledgements.find(
          (a) =>
            a.documentId === doc.documentId &&
            ((a.employeeId && empIdentifiers.includes(a.employeeId.toLowerCase())) ||
             (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase())))
        );
        if (existing) return existing;

        return {
          id: `ack-synth-${emp.id}-${doc.id}`,
          documentId: doc.documentId,
          documentTitle: doc.title,
          versionNumber: doc.currentPublishedVersionNumber || '1.0',
          documentVersionId: doc.currentPublishedVersionId || '',
          employeeId: emp.id,
          employeeName: emp.name,
          employeeEmail: emp.email,
          departmentName: emp.departmentName,
          status: 'PENDING' as const,
        };
      });

      const totalAssigned = records.length;
      const acknowledgedCount = records.filter((a) => a.status === 'ACKNOWLEDGED').length;
      const pendingCount = totalAssigned - acknowledgedCount;
      const complianceRate = totalAssigned > 0 ? Math.round((acknowledgedCount / totalAssigned) * 100) : 100;

      return {
        employeeId: emp.id,
        employeeLoginId: emp.loginId || emp.empId || emp.id,
        employeeName: emp.name,
        employeeEmail: emp.email,
        departmentName: emp.departmentName || 'General Operations',
        title: emp.title || 'Staff Member',
        active: emp.active,
        totalAssigned,
        acknowledgedCount,
        pendingCount,
        complianceRate,
        acknowledgements: records,
      };
    });
  }

  // Send a targeted compliance reminder email to a single employee
  public async sendComplianceReminder(ackId: string, sender: User): Promise<{ success: boolean; message: string }> {
    const ack = this.acknowledgements.find((a) => a.id === ackId);
    if (!ack) throw new Error('Acknowledgement record not found.');

    if (ack.status === 'ACKNOWLEDGED') {
      return { success: false, message: 'Employee has already acknowledged this document.' };
    }

    const master = this.documentMasters.find((d) => d.documentId === ack.documentId);
    const subject = `[Urgent Reminder] Compliance Acknowledgment Pending: ${ack.documentTitle} v${ack.versionNumber}`;
    const body = `Dear ${ack.employeeName},\n\nThis is an official compliance reminder regarding the mandatory document awaiting your electronic review and sign-off:\n\n` +
      `• Document Title: ${ack.documentTitle}\n` +
      `• Document ID: ${ack.documentId}\n` +
      `• Version: v${ack.versionNumber}\n` +
      `• Department: ${master?.departmentName || ack.departmentName || 'Corporate Governance'}\n` +
      `• Compliance Status: ACTION REQUIRED (PENDING)\n\n` +
      `Please log in to your Amaavigo Employee Portal as soon as possible to review the document and complete your compliance sign-off.\n\n` +
      `Sincerely,\nHuman Resources & Compliance Department\nAmaavigo Global Inc.`;

    const result = await defaultEmailProvider.sendEmail(ack.employeeEmail, ack.employeeName, subject, body, {
      documentId: ack.documentId,
      documentTitle: ack.documentTitle,
      versionNumber: ack.versionNumber,
      documentVersionId: ack.documentVersionId,
      acknowledgementRequired: true,
    });

    ack.reminderSentAt = new Date().toISOString();
    try {
      firestoreService.saveAcknowledgement(ack).catch((e) => console.warn('Firestore reminder update note:', e));
    } catch (e) {
      console.warn('Firestore reminder update:', e);
    }

    auditService.logEvent(AuditAction.NOTIFICATION_SENT, sender, {
      documentId: ack.documentId,
      versionNumber: ack.versionNumber,
      reason: `Sent compliance reminder to ${ack.employeeName} (${ack.employeeEmail}) for ${ack.documentId} v${ack.versionNumber}`,
    });

    return {
      success: result.success,
      message: `Compliance reminder dispatched successfully to ${ack.employeeEmail} via ${result.provider || 'Gmail SMTP'}.`,
    };
  }

  // Record a manual offline sign-off / attestation
  public recordManualSignOff(ackId: string, notes: string, adminUser: User): AcknowledgementRecord {
    const ack = this.acknowledgements.find((a) => a.id === ackId);
    if (!ack) throw new Error('Acknowledgement record not found.');

    const nowIso = new Date().toISOString();
    ack.status = 'ACKNOWLEDGED';
    ack.acknowledgedAt = nowIso;
    ack.notes = notes || `Manually attested by HR Admin (${adminUser.name})`;
    ack.signatureReference = `MANUAL-ATTEST-${adminUser.loginId || adminUser.id}-${Date.now().toString().slice(-4)}`;

    try {
      firestoreService.saveAcknowledgement(ack).catch((e) => console.warn('Firestore manual sign-off sync:', e));
    } catch (e) {
      console.warn('Firestore manual sign-off sync error:', e);
    }

    auditService.logEvent(AuditAction.DOCUMENT_ACKNOWLEDGED, adminUser, {
      documentId: ack.documentId,
      versionNumber: ack.versionNumber,
      reason: `HR Officer ${adminUser.name} recorded manual physical/offline sign-off for ${ack.employeeName}: ${notes || 'Verified paper attestation'}`,
    });

    return ack;
  }

  // Send batch reminders for all pending acknowledgements or specific document
  public async sendBatchReminders(sender: User, documentId?: string): Promise<{ sentCount: number; message: string }> {
    const pendingList = this.acknowledgements.filter(
      (a) => a.status === 'PENDING' && (!documentId || a.documentId === documentId)
    );

    let sent = 0;
    for (const ack of pendingList) {
      await this.sendComplianceReminder(ack.id, sender);
      sent++;
    }

    return {
      sentCount: sent,
      message: `Dispatched ${sent} compliance reminder notification(s) successfully.`,
    };
  }

  public getNotifications(): EmailNotification[] {
    return defaultEmailProvider.getNotifications();
  }

  public getPublicationRecords(): DocumentPublicationRecord[] {
    return [...this.publicationRecords];
  }

  // Delete a single document master and all associated versions & acknowledgements
  public async deleteDocument(documentId: string, currentUser?: User): Promise<void> {
    const docMaster = this.documentMasters.find((d) => d.id === documentId || d.documentId === documentId);
    const targetId = docMaster ? docMaster.id : documentId;
    const docLogicalId = docMaster ? docMaster.documentId : documentId;

    this.documentMasters = this.documentMasters.filter((d) => d.id !== targetId && d.documentId !== docLogicalId);
    this.documentVersions = this.documentVersions.filter(
      (v) => v.documentMasterId !== targetId && v.documentId !== docLogicalId
    );
    this.acknowledgements = this.acknowledgements.filter((a) => a.documentId !== docLogicalId);

    // Sync deletion to Firestore
    try {
      await firestoreService.deleteDocument(targetId);
    } catch (e) {
      console.warn('[Governance] Firestore deleteDocument sync note:', e);
    }

    if (currentUser) {
      auditService.logEvent(AuditAction.VERSION_ARCHIVED, currentUser, {
        documentId: docLogicalId,
        reason: `Document master ${docLogicalId} and all associated revisions were deleted from the system.`,
      });
    }
  }

  // Clear all documents, versions, and acknowledgments across the application & database
  public async clearAllDocuments(currentUser?: User): Promise<void> {
    this.documentMasters = [];
    this.documentVersions = [];
    this.acknowledgements = [];
    this.publicationRecords = [];

    // Mark cleared in localStorage so it does not re-seed automatically on refresh
    try {
      localStorage.setItem('ama_docs_cleared', 'true');
    } catch (e) {
      console.warn('Storage note:', e);
    }

    // Sync clear to Firestore
    try {
      await firestoreService.clearAllDocuments();
    } catch (e) {
      console.warn('[Governance] Firestore clearAllDocuments sync note:', e);
    }

    if (currentUser) {
      auditService.logEvent(AuditAction.VERSION_ARCHIVED, currentUser, {
        documentId: 'ALL-POLICIES',
        reason: `All document masters, revisions, and acknowledgment records were purged by ${currentUser.name} (${currentUser.role}).`,
      });
    }
  }

  // Restore or re-seed sample documents
  public async restoreDefaultSeed(): Promise<void> {
    try {
      localStorage.removeItem('ama_docs_cleared');
    } catch (e) {
      console.warn('Storage note:', e);
    }
    this.resetToSeed();
    await firestoreService.seedFirestoreIfEmpty(
      SEED_DOCUMENTS,
      SEED_VERSIONS,
      SEED_AUDIT_LOGS,
      this.getAcknowledgements(),
      this.getUsers()
    );
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
