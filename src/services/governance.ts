import {
  AcknowledgementRecord,
  AuditAction,
  ConfidentialityLevel,
  DocumentCategory,
  DocumentComparisonResult,
  DocumentMaster,
  DocumentPublicationRecord,
  DocumentVersion,
  DocumentSuggestion,
  SuggestionCategory,
  SuggestionStatus,
  EmailNotification,
  User,
  UserRole,
  VersionStatus,
  VersionType,
} from '../types';
import { auditService } from './audit';
import { compareDocumentTexts } from './comparison';
import { defaultEmailProvider } from './email';
import { calculateSha256, defaultStorageProvider } from './storage';
import { firestoreService } from './firestoreService';
import { uploadMediaToServer } from './mediaStorage';
import { normalizeAuthorizedModules, getAuthorizationLabel, ModuleAuthorizationCode } from '../utils/authorization';
import { appendApprovedHeaderAndFooter, formatDDMMYYYY, stripPolicyMetadataHeader, extractCleanBody } from '../utils/documentHeaderFooter';
import { stampPdfWithHeaderFooter, stampDocxWithHeaderFooter, cleanDocxDataUrl, HeaderFooterMetadata } from '../utils/documentStamper';

// Helper to verify if an employee belongs to a specific department or audience
export function isEmployeeInDepartment(
  employee: User | { departmentName?: string; departmentId?: string },
  docDeptName?: string,
  docDeptId?: string
): boolean {
  if (!docDeptName) return false;
  const dNorm = docDeptName.trim().toLowerCase();
  if (dNorm === 'all department' || dNorm === 'all departments') return true;

  const empDeptName = (employee.departmentName || '').trim().toLowerCase();
  const empDeptId = (employee.departmentId || '').trim().toLowerCase();
  const dIdNorm = (docDeptId || '').trim().toLowerCase();

  if (dNorm === empDeptName) return true;
  if (dIdNorm && empDeptId && dIdNorm === empDeptId) return true;

  // Department name keywords and partial matches
  if (dNorm === 'content' && empDeptName.includes('content')) return true;
  if (dNorm.includes('human resources') && (empDeptName.includes('human resources') || empDeptName.includes('hr'))) return true;
  if (dNorm.includes('engineering') && empDeptName.includes('engineering')) return true;
  if (dNorm.includes('finance') && empDeptName.includes('finance')) return true;
  if (dNorm.includes('operations') && empDeptName.includes('operations')) return true;
  if (dNorm.includes('compliance') && (empDeptName.includes('compliance') || empDeptName.includes('legal') || empDeptName.includes('governance'))) return true;
  if (dNorm.includes('product') && empDeptName.includes('product')) return true;
  if (dNorm.includes('sales') && empDeptName.includes('sales')) return true;

  return false;
}

export class DocumentGovernanceEngine {
  private users: User[] = [];
  private documentMasters: DocumentMaster[] = [];
  private documentVersions: DocumentVersion[] = [];
  private publicationRecords: DocumentPublicationRecord[] = [];
  private acknowledgements: AcknowledgementRecord[] = [];
  private comparisons: Map<string, DocumentComparisonResult> = new Map();
  private documentSuggestions: DocumentSuggestion[] = [];
  private reReviewRemindersSent: Set<string> = new Set();

  constructor() {
    // Load cached acknowledgements & suggestions if available
    this.loadAcknowledgementsFromStorage();
    this.loadSuggestionsFromStorage();
    this.loadReminderKeysFromStorage();
  }

  private loadSuggestionsFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('ama_governance_suggestions');
        if (stored !== null) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            // Filter out any legacy dummy seed suggestions
            this.documentSuggestions = parsed.filter(
              (s: any) => !s.id?.startsWith('sug-seed-') && !s.documentId?.includes('doc-seed')
            );
            return;
          }
        }
      }
    } catch (e) {
      console.warn('Could not load cached suggestions from storage', e);
    }

    // Default to clean empty list - no dummy suggestions
    this.documentSuggestions = [];
  }

  public saveSuggestionsToStorage(): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem('ama_governance_suggestions', JSON.stringify(this.documentSuggestions));
      }
    } catch (e) {
      console.warn('Could not save suggestions to storage', e);
    }
  }

  private loadReminderKeysFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('ama_rereview_reminders_sent');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            this.reReviewRemindersSent = new Set(parsed);
          }
        }
      }
    } catch (e) {
      console.warn('Could not load reminder keys from storage', e);
    }
  }

  public saveReminderKeysToStorage(): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem('ama_rereview_reminders_sent', JSON.stringify(Array.from(this.reReviewRemindersSent)));
      }
    } catch (e) {
      console.warn('Could not save reminder keys to storage', e);
    }
  }

  private loadAcknowledgementsFromStorage(): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('ama_governance_acks');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.setAcknowledgements(parsed);
          }
        }
      }
    } catch (e) {
      console.warn('Could not load cached acks from storage', e);
    }
  }

  public saveAcknowledgementsToStorage(): void {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem('ama_governance_acks', JSON.stringify(this.acknowledgements));
      }
    } catch (e) {
      console.warn('Could not save acks to storage', e);
    }
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
    const seen = new Set<string>();
    const res: User[] = [];
    for (const u of this.users) {
      const key = (u.empId || u.loginId || u.email || u.id || '').toUpperCase().trim();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      res.push(u);
    }
    return res;
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
    const seen = new Set<string>();
    const emps: User[] = [];
    for (const u of this.users) {
      const r = (u.role || '').toString().toUpperCase();
      if (r === 'EMPLOYEE' && u.active !== false) {
        const key = (u.empId || u.loginId || u.email || u.id || '').toUpperCase().trim();
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        emps.push(u);
      }
    }
    return emps;
  }

  public setEmployees(employees: User[]): void {
    if (!employees || employees.length === 0) return;

    // Merge cloud user records by canonical key (empId/loginId/email/id), preserving existing memory state
    const userMap = new Map<string, User>();
    for (const u of this.users) {
      const key = (u.empId || u.loginId || u.email || u.id || '').toUpperCase().trim();
      if (key) userMap.set(key, u);
    }
    for (const emp of employees) {
      const rawRole = (emp.role || '').toString().toUpperCase().trim();
      const rawLoginId = (emp.loginId || emp.empId || emp.id || '').toString().toUpperCase().trim();
      const rawTitle = (emp.title || (emp as any).designation || '').toString().toUpperCase();
      const rawDept = (emp.departmentName || emp.departmentId || (emp as any).department || '').toString().toUpperCase();
      const lowerId = (emp.id || '').toLowerCase();

      // Explicit database role is respected with highest priority
      let role = UserRole.EMPLOYEE;
      if (rawRole === 'EMPLOYEE') {
        role = UserRole.EMPLOYEE;
      } else if (rawRole === 'CREATOR' || rawRole === 'HR' || rawRole === 'AUTHOR') {
        role = UserRole.CREATOR;
      } else if (rawRole === 'REVIEWER' || rawRole === 'APPROVER') {
        role = UserRole.REVIEWER;
      } else if (
        rawRole.includes('CREATOR') ||
        rawRole.includes('HR') ||
        lowerId.includes('creator') ||
        rawLoginId.startsWith('HR') ||
        rawLoginId === 'CREATOR' ||
        rawDept.includes('HUMAN RESOURCES') ||
        rawTitle.includes('HR POLICY') ||
        rawTitle.includes('CREATOR')
      ) {
        role = UserRole.CREATOR;
      } else if (
        rawRole.includes('REVIEWER') ||
        rawRole.includes('APPROVER') ||
        lowerId.includes('reviewer') ||
        rawLoginId.startsWith('REV') ||
        rawLoginId === 'APPROVER' ||
        rawLoginId === 'REVIEWER' ||
        rawTitle.includes('GOVERNANCE APPROVER')
      ) {
        role = UserRole.REVIEWER;
      }

      const isActive =
        emp.active !== false &&
        String(emp.active).toLowerCase() !== 'false' &&
        (emp as any).status !== 'INACTIVE' &&
        (emp as any).status !== 'inactive';

      const rawAuth =
        emp.authorizedModules ||
        (emp as any).allowedModules ||
        (emp as any).moduleAccess ||
        (emp as any).modules ||
        (emp as any).moduleAuthorization;
      const authorizedModules = normalizeAuthorizedModules(rawAuth);

      const normalized: User = {
        ...emp,
        id: emp.id || emp.empId || emp.loginId || rawLoginId,
        empId: String(emp.empId || (emp as any).employeeId || emp.loginId || emp.id),
        loginId: String(emp.loginId || emp.empId || (emp as any).employeeId || emp.id),
        name: emp.name || (role === UserRole.CREATOR ? 'HR Creator' : role === UserRole.REVIEWER ? 'Approver' : 'Employee'),
        email: (emp.email || '').trim(),
        role,
        authorizedModules,
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
        password: emp.password !== undefined && emp.password !== null ? String(emp.password) : '',
        active: isActive,
        avatar: emp.avatar || (emp as any).avatarUrl,
      };

      const key = (normalized.id || normalized.empId || normalized.loginId).toUpperCase().trim();
      userMap.set(key, normalized);
    }
    this.users = Array.from(userMap.values());
    this.syncDocumentAuthorNames();
    if (this.documentMasters.length > 0 && this.acknowledgements.length > 0) {
      this.ensurePendingAcknowledgementsForEmployees();
    }
  }

  public setUsers(users: User[]): void {
    if (!users || users.length === 0) return;
    const userMap = new Map<string, User>();
    for (const u of this.users) {
      const key = (u.id || u.empId || u.loginId || '').toUpperCase().trim();
      if (key) userMap.set(key, u);
    }
    for (const u of users) {
      const key = (u.id || u.empId || u.loginId || '').toUpperCase().trim();
      if (key) {
        userMap.set(key, { ...userMap.get(key), ...u });
      }
    }
    this.users = Array.from(userMap.values());
    this.syncDocumentAuthorNames();
    if (this.documentMasters.length > 0 && this.acknowledgements.length > 0) {
      this.ensurePendingAcknowledgementsForEmployees();
    }
  }

  private syncDocumentAuthorNames(): void {
    for (const doc of this.documentMasters) {
      if (doc.createdById) {
        const u = this.users.find(
          (user) =>
            user.id === doc.createdById ||
            (user.empId && user.empId.toUpperCase() === doc.createdById.toUpperCase()) ||
            (user.loginId && user.loginId.toUpperCase() === doc.createdById.toUpperCase())
        );
        if (u) {
          doc.createdByName = u.name;
          doc.createdByTitle = u.title;
        }
      }
    }
    for (const ver of this.documentVersions) {
      if (ver.createdById) {
        const u = this.users.find(
          (user) =>
            user.id === ver.createdById ||
            (user.empId && user.empId.toUpperCase() === ver.createdById.toUpperCase()) ||
            (user.loginId && user.loginId.toUpperCase() === ver.createdById.toUpperCase())
        );
        if (u) {
          ver.createdByName = u.name;
          ver.createdByTitle = u.title;
        }
      }
      if (ver.reviewedById) {
        const u = this.users.find(
          (user) =>
            user.id === ver.reviewedById ||
            (user.empId && user.empId.toUpperCase() === ver.reviewedById.toUpperCase()) ||
            (user.loginId && user.loginId.toUpperCase() === ver.reviewedById.toUpperCase())
        );
        if (u) {
          ver.reviewedByName = u.name;
        }
      }
      if (ver.publishedById) {
        const u = this.users.find(
          (user) =>
            user.id === ver.publishedById ||
            (user.empId && user.empId.toUpperCase() === ver.publishedById.toUpperCase()) ||
            (user.loginId && user.loginId.toUpperCase() === ver.publishedById.toUpperCase())
        );
        if (u) {
          ver.publishedByName = u.name;
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
    // 1. Direct ID / empId / loginId match (strictly by unique identifier, never by shared email)
    if (userId) {
      const match = this.users.find(
        (u) =>
          u.id === userId ||
          (u.empId && u.empId.toUpperCase() === userId.toUpperCase()) ||
          (u.loginId && u.loginId.toUpperCase() === userId.toUpperCase())
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

    // 2. Fallback exact name match in user roster
    if (fallbackName) {
      const byName = this.users.find(
        (u) => u.name.trim().toLowerCase() === fallbackName.trim().toLowerCase()
      );
      if (byName) {
        return {
          name: byName.name,
          role: byName.role,
          title: byName.title,
          email: byName.email,
        };
      }
    }

    // 3. Fallback to fallbackName or role-appropriate default (do NOT pick first creator/reviewer blindly)
    const rawRole = (role || '').toString().toUpperCase();
    let defaultRole = UserRole.EMPLOYEE;
    if (rawRole === 'CREATOR' || rawRole === 'HR') defaultRole = UserRole.CREATOR;
    if (rawRole === 'REVIEWER' || rawRole === 'APPROVER') defaultRole = UserRole.REVIEWER;

    return {
      name: fallbackName || (defaultRole === UserRole.CREATOR ? 'HR Author' : defaultRole === UserRole.REVIEWER ? 'Approver' : 'Employee'),
      role: defaultRole,
      title:
        defaultRole === UserRole.CREATOR
          ? 'HR Policy & Governance Lead'
          : defaultRole === UserRole.REVIEWER
          ? 'VP of Human Resources & Governance'
          : 'Staff Member',
      email: defaultRole === UserRole.CREATOR ? 'hr-governance@amaavigo.in' : 'approver@amaavigo.in',
    };
  }

  // Ensure every active employee has a pending acknowledgement for all active published public & specific-department policies
  public ensurePendingAcknowledgementsForEmployees(): void {
    const activeEmployees = this.getEmployees();
    const publishedDocs = this.documentMasters.filter(
      (d) =>
        d.active &&
        d.currentStatus === VersionStatus.PUBLISHED &&
        d.acknowledgementRequired &&
        (d.confidentiality === ConfidentialityLevel.PUBLIC || d.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT)
    );

    let createdCount = 0;
    for (const emp of activeEmployees) {
      const primaryEmpId = emp.empId || emp.id || emp.loginId || emp.email;
      if (!primaryEmpId) continue;

      const empIdentifiers = [emp.id, emp.empId, emp.loginId, emp.email]
        .filter(Boolean)
        .map((s) => s!.toLowerCase());

      for (const doc of publishedDocs) {
        // If Specific Department, verify employee belongs to this department
        if (doc.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
          if (!isEmployeeInDepartment(emp, doc.departmentName, doc.departmentId)) {
            continue;
          }
        }

        const activeVer = this.documentVersions.find((v) => v.id === doc.currentPublishedVersionId) ||
          this.documentVersions.filter((v) => v.documentMasterId === doc.id && v.status === VersionStatus.PUBLISHED).pop();
        const verNumber = activeVer?.versionNumber || doc.currentPublishedVersionNumber || '1.0';

        const hasAck = this.acknowledgements.some(
          (a) =>
            a.documentId === doc.documentId &&
            a.versionNumber === verNumber &&
            (empIdentifiers.includes(a.employeeId?.toLowerCase()) || (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase())))
        );

        if (!hasAck) {
          const cleanEmpId = primaryEmpId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const cleanDocId = doc.documentId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const cleanVer = verNumber.replace(/\./g, '_');
          const deterministicId = `ack_${cleanDocId}_v${cleanVer}_${cleanEmpId}`;

          const pendingAck: AcknowledgementRecord = {
            id: deterministicId,
            documentId: doc.documentId,
            documentTitle: doc.title,
            versionNumber: verNumber,
            documentVersionId: activeVer?.id || '',
            employeeId: emp.empId || emp.id,
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

    // Prune any pending (unacknowledged) records for employees that are not in the document's specific department
    this.acknowledgements = this.acknowledgements.filter((ack) => {
      if (ack.status === 'ACKNOWLEDGED') return true;
      const doc = this.documentMasters.find((d) => d.documentId === ack.documentId);
      if (!doc) return true;
      if (doc.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
        const emp = this.findUserByIdentifiers(ack.employeeId) || this.findUserByIdentifiers(ack.employeeEmail);
        if (emp && !isEmployeeInDepartment(emp, doc.departmentName, doc.departmentId)) {
          return false;
        }
      }
      return true;
    });

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

  // Update module authorization for HR or Founder/Reviewer user and persist to Firestore
  public async updateUserModuleAuthorization(
    userId: string,
    authorizedModules: ModuleAuthorizationCode | string,
    performer?: User
  ): Promise<User> {
    const normalized = normalizeAuthorizedModules(authorizedModules);
    const user = this.users.find(
      (u) =>
        u.id === userId ||
        (u.empId && u.empId.toUpperCase() === userId.toUpperCase()) ||
        (u.loginId && u.loginId.toUpperCase() === userId.toUpperCase())
    );

    if (!user) {
      throw new Error(`User with ID "${userId}" not found.`);
    }

    const previousAuth = getAuthorizationLabel(user.authorizedModules);
    const newAuth = getAuthorizationLabel(normalized);

    user.authorizedModules = normalized;
    user.updatedAt = new Date().toISOString();

    try {
      await firestoreService.updateUserModuleAuthorization(user.id, normalized);
    } catch (e) {
      console.warn('[Governance] Firestore module authorization update note:', e);
    }

    const adminPerformer = performer || user;
    auditService.logEvent(AuditAction.AUTHORIZATION_UPDATED, adminPerformer, {
      reason: `Module access authorization for ${user.name} (${user.role} - ${user.loginId || user.empId}) was updated from "${previousAuth}" to "${newAuth}" in database.`,
    });

    return user;
  }

  public setAcknowledgements(acks: AcknowledgementRecord[]): void {
    const canonicalMap = new Map<string, AcknowledgementRecord>();
    // First preserve any existing ACKNOWLEDGED records
    for (const item of this.acknowledgements) {
      if (item.status === 'ACKNOWLEDGED') {
        const emp = (item.employeeId || item.employeeEmail || '').toLowerCase().trim();
        const ver = (item.versionNumber || '1.0').trim();
        const key = `${item.documentId.toLowerCase()}_${ver}_${emp}`;
        canonicalMap.set(key, item);
      }
    }
    for (const item of acks) {
      if (!item.documentId) continue;
      const emp = (item.employeeId || item.employeeEmail || '').toLowerCase().trim();
      const ver = (item.versionNumber || '1.0').trim();
      const key = `${item.documentId.toLowerCase()}_${ver}_${emp}`;
      const existing = canonicalMap.get(key);
      if (!existing || (item.status === 'ACKNOWLEDGED' && existing.status !== 'ACKNOWLEDGED')) {
        canonicalMap.set(key, item);
      }
    }
    this.acknowledgements = Array.from(canonicalMap.values());
    this.saveAcknowledgementsToStorage();
  }

  public getUserById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  // Get all Document Masters (sorted so newly created entries or newly versioned documents come above older ones)
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
    return result.sort((a, b) => {
      const aVersions = this.documentVersions.filter(
        (v) => v.documentMasterId === a.id || v.documentId === a.documentId
      );
      const aVersionTimes = aVersions.map((v) => new Date(v.createdAt).getTime()).filter((t) => !isNaN(t));
      const aDocUpdate = new Date(a.updatedAt || a.createdAt).getTime();
      const aDocCreate = new Date(a.createdAt).getTime();
      const aLatest = Math.max(aDocUpdate || 0, aDocCreate || 0, ...aVersionTimes);

      const bVersions = this.documentVersions.filter(
        (v) => v.documentMasterId === b.id || v.documentId === b.documentId
      );
      const bVersionTimes = bVersions.map((v) => new Date(v.createdAt).getTime()).filter((t) => !isNaN(t));
      const bDocUpdate = new Date(b.updatedAt || b.createdAt).getTime();
      const bDocCreate = new Date(b.createdAt).getTime();
      const bLatest = Math.max(bDocUpdate || 0, bDocCreate || 0, ...bVersionTimes);

      return bLatest - aLatest;
    });
  }

  public getDocumentMasterById(id: string): DocumentMaster | undefined {
    return this.documentMasters.find((d) => d.id === id || d.documentId === id);
  }

  // Get all Versions for a Document Master, or all versions across system if omitted (sorted newest first)
  public getDocumentVersions(documentMasterId?: string): DocumentVersion[] {
    if (!documentMasterId) {
      return [...this.documentVersions].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    }
    return this.documentVersions
      .filter((v) => v.documentMasterId === documentMasterId || v.documentId === documentMasterId)
      .sort((a, b) => {
        // Sort newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }

  public getAllVersions(): DocumentVersion[] {
    return [...this.documentVersions];
  }

  public getVersionById(id: string): DocumentVersion | undefined {
    return this.documentVersions.find((v) => v.id === id);
  }

  public getPublishedVersion(masterId: string): DocumentVersion | undefined {
    const master = this.documentMasters.find((d) => d.id === masterId || d.documentId === masterId);
    if (master?.currentPublishedVersionId) {
      const ver = this.getVersionById(master.currentPublishedVersionId);
      if (ver) return ver;
    }
    return this.documentVersions.find(
      (v) =>
        (v.documentMasterId === masterId || (master && v.documentMasterId === master.id)) &&
        v.status === VersionStatus.PUBLISHED
    );
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
    if (!data.confidentiality) throw new Error('Validation error: Confidentiality level is required.');
    if (!data.effectiveFrom?.trim()) throw new Error('Validation error: Effective from Date is required.');
    if (!data.rawContent?.trim()) throw new Error('Validation error: Document content or file upload is required.');

    const documentId = this.generateNextDocumentId(data.category);
    const masterId = `doc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const versionId = `ver-${Date.now()}-v10`;
    const versionNumber = '1.0';

    // Clean redundant policy metadata lines from rawContent
    const sanitizedRawContent = stripPolicyMetadataHeader(data.rawContent || '');

    // If a DOCX or PDF file was uploaded, stamp it with the initial Header & Footer
    // while keeping the document structure, fonts, sizes, colors, and layout 100% intact!
    let sanitizedFileUrl = data.fileDataUrl;
    const isDocxUpload =
      Boolean(sanitizedFileUrl) &&
      (sanitizedFileUrl.includes('wordprocessingml') || data.fileName?.toLowerCase().endsWith('.docx'));
    const isPdfUpload =
      Boolean(sanitizedFileUrl) &&
      (sanitizedFileUrl.startsWith('data:application/pdf') || data.fileName?.toLowerCase().endsWith('.pdf'));
    const isVideoUpload =
      Boolean(sanitizedFileUrl && sanitizedFileUrl.startsWith('data:video/')) ||
      Boolean(data.mimeType?.startsWith('video/')) ||
      Boolean(data.fileName?.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/));

    const initialHeaderFooter: HeaderFooterMetadata = {
      documentTitle: data.title.trim(),
      versionNumber: '1.0',
      effectiveDate: data.effectiveFrom || new Date().toISOString().split('T')[0],
      createdByName: creator.name,
      approvedByName: 'Not yet approved',
      approvedDate: 'Not yet approved',
      companyName: data.companyName || creator.companyName || 'Amaavigo',
    };

    if (isDocxUpload && sanitizedFileUrl) {
      try {
        const stampedDocx = await stampDocxWithHeaderFooter(sanitizedFileUrl, initialHeaderFooter);
        sanitizedFileUrl = stampedDocx.dataUrl;
      } catch (cleanErr) {
        console.warn('Could not stamp initial DOCX data URL on createDocument:', cleanErr);
      }
    } else if (isPdfUpload && sanitizedFileUrl) {
      try {
        const stampedPdf = await stampPdfWithHeaderFooter(sanitizedFileUrl, initialHeaderFooter);
        sanitizedFileUrl = stampedPdf.dataUrl;
      } catch (pdfErr) {
        console.warn('Could not stamp initial PDF on createDocument:', pdfErr);
      }
    }
    // Note: Video files do NOT append header and footer, keeping video bytes intact

    // Persist large binary media (e.g. video/pdf/docx) to persistent server storage and IndexedDB
    if (sanitizedFileUrl && (isVideoUpload || sanitizedFileUrl.startsWith('data:'))) {
      try {
        const uploadRes = await uploadMediaToServer({
          fileName: data.fileName || `${documentId}_v1.0.${isVideoUpload ? 'mp4' : 'bin'}`,
          mimeType: data.mimeType || (isVideoUpload ? 'video/mp4' : 'application/octet-stream'),
          dataUrl: sanitizedFileUrl,
          documentId,
          versionId,
        });
        sanitizedFileUrl = uploadRes.fileUrl;
      } catch (uploadErr) {
        console.warn('[Governance] Media upload to server storage error:', uploadErr);
      }
    }

    // Store file in Storage Provider
    const storageMeta = await defaultStorageProvider.uploadFile(
      documentId,
      data.category,
      versionNumber,
      data.fileName || `${data.title.replace(/[^a-zA-Z0-9]/g, '_')}_v1.0.${isVideoUpload ? 'mp4' : 'txt'}`,
      sanitizedRawContent,
      data.mimeType || (isVideoUpload ? 'video/mp4' : 'text/markdown')
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
      createdByTitle: creator.title,
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
      fileUrl: sanitizedFileUrl || defaultStorageProvider.getFileUrl(storageMeta.storageKey),
      originalFileUrl: sanitizedFileUrl || (isPdfUpload || isDocxUpload || isVideoUpload ? data.fileDataUrl : undefined),
      contentHash: storageMeta.contentHash,
      rawContent: sanitizedRawContent,
      createdById: creator.id,
      createdByName: creator.name,
      createdByTitle: creator.title,
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
      await firestoreService.saveDocument(newMaster);
      await firestoreService.saveVersion(newVersion);
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
      const creatorDisplay = `${creator.name} (${creator.loginId || creator.empId || 'HR'})`;
      const emailSubject = `[Action Required: Review] New Document Created by ${creatorDisplay}: [${documentId}] ${newMaster.title} (v${versionNumber})`;
      const emailBody = `Dear Approver,\n\nA new document has been created by HR Author ${creatorDisplay} (${creator.title}) and submitted to the review queue for your authorization:\n\n• Document ID: ${documentId}\n• Title: ${newMaster.title}\n• Version: v${versionNumber} (Initial Baseline)\n• Category: ${newMaster.category}\n• Department: ${newMaster.departmentName}\n• Created By HR Author: ${creatorDisplay} (${creator.title})\n\nPlease sign in to the Governance Portal, inspect the document content and security baseline, and perform your decision (Approve & Publish or Request Revisions).\n\nSincerely,\nHR Document Governance Automation System\n${newMaster.companyName}`;

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

    // 1. Take effective date first for this revision and build updated header/footer data
    const revisionEffectiveDate = data.effectiveFrom || new Date().toISOString().split('T')[0];
    const formattedEffectiveDate = formatDDMMYYYY(revisionEffectiveDate);

    const revisionHeaderFooterData = {
      companyName: master.companyName || 'Amaavigo',
      documentTitle: master.title,
      versionNumber: nextVersionNumber,
      effectiveDate: formattedEffectiveDate,
      createdByName: creator.name || 'Amee Shah',
      approvedByName: 'Not yet approved',
      approvedDate: 'Not yet approved',
    };

    const isPdf =
      data.fileName?.toLowerCase().endsWith('.pdf') ||
      data.mimeType === 'application/pdf' ||
      (data.fileDataUrl && data.fileDataUrl.startsWith('data:application/pdf')) ||
      (data.rawContent && data.rawContent.startsWith('%PDF'));

    const isDocx =
      data.fileName?.toLowerCase().endsWith('.docx') ||
      data.mimeType?.includes('wordprocessingml') ||
      (data.fileDataUrl && data.fileDataUrl.includes('wordprocessingml'));

    const isVideo =
      Boolean(data.fileName?.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)) ||
      Boolean(data.mimeType?.startsWith('video/')) ||
      Boolean(data.fileDataUrl && data.fileDataUrl.startsWith('data:video/'));

    // 2. Clean previous header/footer and duplicate metadata from body
    let sanitizedRawContent = extractCleanBody(data.rawContent || '');

    // 3. Update document header and footer when it is being revised
    let sanitizedFileUrl = data.fileDataUrl;
    if (isDocx && sanitizedFileUrl) {
      try {
        sanitizedFileUrl = await cleanDocxDataUrl(sanitizedFileUrl);
        const stampedDocx = await stampDocxWithHeaderFooter(sanitizedFileUrl, revisionHeaderFooterData);
        sanitizedFileUrl = stampedDocx.dataUrl;
      } catch (cleanErr) {
        console.warn('Could not clean or stamp DOCX data URL on createNewVersion:', cleanErr);
      }
    } else if (isPdf && sanitizedFileUrl) {
      try {
        const stampedPdf = await stampPdfWithHeaderFooter(sanitizedFileUrl, revisionHeaderFooterData);
        sanitizedFileUrl = stampedPdf.dataUrl;
      } catch (pdfErr) {
        console.warn('Could not stamp PDF on createNewVersion:', pdfErr);
      }
    }
    // Video revisions keep original file data intact without appending header or footer

    // Persist large binary media (e.g. video/pdf/docx) to persistent server storage and IndexedDB
    if (sanitizedFileUrl && (isVideo || sanitizedFileUrl.startsWith('data:'))) {
      try {
        const uploadRes = await uploadMediaToServer({
          fileName: data.fileName || `${master.documentId}_v${nextVersionNumber}.${isVideo ? 'mp4' : 'bin'}`,
          mimeType: data.mimeType || (isVideo ? 'video/mp4' : 'application/octet-stream'),
          dataUrl: sanitizedFileUrl,
          documentId: master.documentId,
          versionId,
        });
        sanitizedFileUrl = uploadRes.fileUrl;
      } catch (uploadErr) {
        console.warn('[Governance] Media upload on revision error:', uploadErr);
      }
    }

    // If text/markdown, embed the newly updated header and footer
    if (!isPdf && !isDocx && !isVideo && sanitizedRawContent) {
      sanitizedRawContent = appendApprovedHeaderAndFooter(sanitizedRawContent, revisionHeaderFooterData);
    }

    // Store revised file in Storage Provider with updated header & footer
    const storageMeta = await defaultStorageProvider.uploadFile(
      master.documentId,
      master.category,
      nextVersionNumber,
      data.fileName || `${master.title.replace(/[^a-zA-Z0-9]/g, '_')}_v${nextVersionNumber}.${isVideo ? 'mp4' : 'txt'}`,
      sanitizedRawContent,
      data.mimeType || (isVideo ? 'video/mp4' : 'text/markdown')
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
      fileUrl: sanitizedFileUrl || defaultStorageProvider.getFileUrl(storageMeta.storageKey),
      originalFileUrl: sanitizedFileUrl || ((isPdf || isDocx || isVideo) && data.fileDataUrl ? data.fileDataUrl : undefined),
      contentHash: storageMeta.contentHash,
      rawContent: sanitizedRawContent,
      createdById: creator.id,
      createdByName: creator.name,
      createdByTitle: creator.title,
      createdAt: new Date().toISOString(),
      effectiveFrom: data.effectiveFrom || new Date().toISOString().split('T')[0],
      reviewDueDate:
        data.reviewDueDate ||
        (() => {
          const d = new Date(data.effectiveFrom || Date.now());
          d.setFullYear(d.getFullYear() + 1);
          return d.toISOString().split('T')[0];
        })(),
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

    // Ensure master is placed at index 0 so it comes above previous entries
    this.documentMasters = [master, ...this.documentMasters.filter((m) => m.id !== master.id)];

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
      const creatorDisplay = `${creator.name} (${creator.loginId || creator.empId || 'HR'})`;
      const emailSubject = `[Action Required: Review] Revised Version Created by ${creatorDisplay}: [${master.documentId}] ${master.title} (v${nextVersionNumber})`;
      const emailBody = `Dear Approver,\n\nA revised version of document [${master.documentId}] has been authored by HR Author ${creatorDisplay} (${creator.title}) and submitted to your review queue:\n\n• Document ID: ${master.documentId}\n• Title: ${master.title}\n• New Version: v${nextVersionNumber} (${data.revisionType} revision)\n• Baseline Comparison: v${baselineNumber}\n• Change Summary: ${data.changeSummary || 'Revised document version submitted.'}\n• Created By HR Author: ${creatorDisplay} (${creator.title})\n\nPlease sign in to the Governance Portal to compare changes against baseline v${baselineNumber} and render your authorization decision.\n\nSincerely,\nHR Document Governance Automation System\n${master.companyName}`;

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

    // 0. Append dynamic Corporate Header & Footer to the approved document BEFORE saving and dispatching emails
    const headerFooterData = {
      companyName: master.companyName || 'Amaavigo',
      documentTitle: master.title || version.documentTitle,
      versionNumber: version.versionNumber,
      effectiveDate: formatDDMMYYYY(version.effectiveFrom || nowIso),
      createdByName: version.createdByName || master.createdByName || 'Amee Shah',
      approvedByName: reviewer.name,
      approvedDate: formatDDMMYYYY(nowIso),
    };

    const isPdf =
      version.fileName?.toLowerCase().endsWith('.pdf') ||
      version.mimeType === 'application/pdf' ||
      (version.fileUrl && version.fileUrl.startsWith('data:application/pdf')) ||
      (version.rawContent && version.rawContent.startsWith('%PDF'));

    const isDocx =
      version.fileName?.toLowerCase().endsWith('.docx') ||
      version.mimeType?.includes('wordprocessingml') ||
      (version.fileUrl && version.fileUrl.includes('wordprocessingml'));

    const isVideo =
      Boolean(version.fileName?.toLowerCase().match(/\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/)) ||
      Boolean(version.mimeType?.startsWith('video/')) ||
      Boolean(version.fileUrl && version.fileUrl.startsWith('data:video/'));

    // Clean redundant policy metadata lines from rawContent before stamping/approving
    if (version.rawContent) {
      version.rawContent = stripPolicyMetadataHeader(version.rawContent);
    }

    if (isPdf) {
      try {
        const sourcePdf =
          version.originalFileUrl && (version.originalFileUrl.startsWith('data:application/pdf') || version.originalFileUrl.startsWith('blob:'))
            ? version.originalFileUrl
            : version.fileUrl && (version.fileUrl.startsWith('data:application/pdf') || version.fileUrl.startsWith('blob:'))
            ? version.fileUrl
            : version.rawContent && version.rawContent.startsWith('%PDF')
            ? version.rawContent
            : null;
        if (sourcePdf) {
          const stamped = await stampPdfWithHeaderFooter(sourcePdf, headerFooterData);
          version.fileUrl = stamped.dataUrl;
        }
      } catch (e) {
        console.warn('Could not stamp PDF binary on approval:', e);
      }
    } else if (isDocx) {
      try {
        const sourceDocx =
          version.originalFileUrl && (version.originalFileUrl.startsWith('data:') || version.originalFileUrl.startsWith('blob:'))
            ? version.originalFileUrl
            : version.fileUrl && (version.fileUrl.startsWith('data:') || version.fileUrl.startsWith('blob:'))
            ? version.fileUrl
            : null;
        if (sourceDocx) {
          const stamped = await stampDocxWithHeaderFooter(sourceDocx, headerFooterData);
          version.fileUrl = stamped.dataUrl;
        }
      } catch (e) {
        console.warn('Could not stamp DOCX binary on approval:', e);
      }
    } else if (isVideo) {
      // For video files, we do NOT append header and footer.
      // The video binary, preview, and content remain completely intact without stamping.
    } else {
      // Inject official dynamic Header & Footer into rawContent for text/markdown
      version.rawContent = appendApprovedHeaderAndFooter(version.rawContent || '', headerFooterData);
    }

    version.contentHash = calculateSha256(version.rawContent || version.fileUrl || '');
    try {
      version.fileSize = new Blob([version.rawContent || '']).size;
    } catch {
      version.fileSize = (version.rawContent || '').length;
    }

    // Update physical/simulated storage with the approved document containing the header and footer
    try {
      await defaultStorageProvider.uploadFile(
        master.documentId,
        master.category,
        version.versionNumber,
        version.fileName || `${master.title.replace(/[^a-zA-Z0-9]/g, '_')}_v${version.versionNumber}.${isVideo ? 'mp4' : 'txt'}`,
        version.rawContent || '',
        version.mimeType || (isVideo ? 'video/mp4' : 'text/markdown')
      );
      // For videos or pre-existing server media endpoints, preserve fileUrl intact!
      if (!isVideo) {
        if (!version.fileUrl || (!version.fileUrl.startsWith('data:') && !version.fileUrl.startsWith('/api/storage/file/'))) {
          version.fileUrl = defaultStorageProvider.getFileUrl(version.storageKey);
        }
      }
    } catch (err) {
      console.warn('Storage sync error with header/footer:', err);
    }

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
    this.documentMasters = [master, ...this.documentMasters.filter((m) => m.id !== master.id)];

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

    // 6. Automatically dispatch Employee Notifications based on Confidentiality Level
    if (master.confidentiality === ConfidentialityLevel.PUBLIC || master.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
      const isSpecificDept = master.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT;
      const employeeAudience = isSpecificDept
        ? this.getEmployees().filter((emp) => isEmployeeInDepartment(emp, master.departmentName, master.departmentId))
        : this.getEmployees();

      const deptPrefix = isSpecificDept ? `[${master.departmentName}] ` : '';

      if (master.acknowledgementRequired) {
        // MANDATORY ACKNOWLEDGEMENT BROADCAST
        const emailSubject = `[Action Required] ${deptPrefix}New Document Published — ${master.title}`;
        const recipientSalutation = isSpecificDept ? `Dear ${master.departmentName} Team Member` : `Dear Employee`;
        const scopeDesc = isSpecificDept
          ? `An official company document specific to the ${master.departmentName} department has been approved and published in the Amaavigo HR Governance system, and requires your mandatory compliance review and electronic sign-off:`
          : `An official company document has been approved and published in the Amaavigo HR Governance system, and requires your mandatory compliance review and electronic sign-off:`;

        const emailBody = `${recipientSalutation},\n\n${scopeDesc}\n\n` +
          `• Document Title: ${master.title}\n` +
          `• Document ID: ${master.documentId}\n` +
          `• Category: ${master.category}\n` +
          `• Department: ${master.departmentName}\n` +
          `• Confidentiality: ${master.confidentiality}\n` +
          `• Version: ${version.versionNumber}\n` +
          `• Effective Date: ${formatDDMMYYYY(version.effectiveFrom || nowIso)}\n` +
          `• Created By: ${version.createdByName || master.createdByName || 'HR Creator'}\n` +
          `• Approved By: ${reviewer.name}\n` +
          `• Approved Date: ${formatDDMMYYYY(nowIso)}\n` +
          `• Compliance Acknowledgement Required: YES (Mandatory within 14 calendar days)\n\n` +
          `HOW TO COMPLY:\n` +
          `1. Log in to your Amaavigo Employee Portal using your Employee ID and credentials.\n` +
          `2. Navigate to the Employee Portal tab.\n` +
          `3. Review the complete document with official corporate Header & Footer, and complete your electronic compliance acknowledgment.\n\n` +
          `Note: To ensure document security, confidentiality, and tamper-proof version control, documents are securely accessed directly inside the authenticated Employee Portal.\n\n` +
          `Sincerely,\nHuman Resources Governance & Compliance Team\n${master.companyName}`;

        for (const emp of employeeAudience) {
          await defaultEmailProvider.sendEmail(emp.email, emp.name, emailSubject, emailBody, {
            documentId: master.documentId,
            documentTitle: master.title,
            versionNumber: version.versionNumber,
            documentVersionId: version.id,
            acknowledgementRequired: true,
          });

          // Create pending acknowledgement entry with deterministic ID
          const cleanEmpId = (emp.empId || emp.id || emp.loginId || emp.email || 'emp').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const cleanDocId = master.documentId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
          const cleanVer = (version.versionNumber || '1.0').replace(/\./g, '_');
          const deterministicId = `ack_${cleanDocId}_v${cleanVer}_${cleanEmpId}`;

          const pendingAck: AcknowledgementRecord = {
            id: deterministicId,
            documentId: master.documentId,
            documentTitle: master.title,
            versionNumber: version.versionNumber,
            documentVersionId: version.id,
            employeeId: emp.empId || emp.id,
            employeeName: emp.name,
            employeeEmail: emp.email,
            departmentName: emp.departmentName,
            status: 'PENDING',
          };
          const existingIdx = this.acknowledgements.findIndex((a) => a.id === deterministicId);
          if (existingIdx >= 0) {
            this.acknowledgements[existingIdx] = pendingAck;
          } else {
            this.acknowledgements.push(pendingAck);
          }

          try {
            firestoreService.saveAcknowledgement(pendingAck).catch((e) => console.warn('Firestore ack save error:', e));
          } catch (e) {
            console.warn('Firestore ack save note:', e);
          }
        }

        // Ensure any active employees with various ID structures also have their pending records
        this.ensurePendingAcknowledgementsForEmployees();

        auditService.logEvent(AuditAction.NOTIFICATION_SENT, reviewer, {
          documentMasterId: master.id,
          documentId: master.documentId,
          documentVersionId: version.id,
          versionNumber: version.versionNumber,
          reason: isSpecificDept
            ? `Dispatched mandatory acknowledgement email notification for Specific Department (${master.departmentName}) to ${employeeAudience.length} active department employees.`
            : `Dispatched mandatory acknowledgement email notification for Public Document to all ${employeeAudience.length} active employees.`,
        });
      } else {
        // INFORMATIONAL NOTIFICATION BROADCAST (No acknowledgement required)
        const emailSubject = `[Notice] ${deptPrefix}New Document Published — ${master.title}`;
        const recipientSalutation = isSpecificDept ? `Dear ${master.departmentName} Team Member` : `Dear Employee`;
        const scopeDesc = isSpecificDept
          ? `An official company document specific to the ${master.departmentName} department has been published in the Amaavigo HR Governance system for your information and reference:`
          : `An official company document has been published in the Amaavigo HR Governance system for your information and reference:`;

        const emailBody = `${recipientSalutation},\n\n${scopeDesc}\n\n` +
          `• Document Title: ${master.title}\n` +
          `• Document ID: ${master.documentId}\n` +
          `• Category: ${master.category}\n` +
          `• Department: ${master.departmentName}\n` +
          `• Confidentiality: ${master.confidentiality}\n` +
          `• Version: ${version.versionNumber}\n` +
          `• Effective Date: ${formatDDMMYYYY(version.effectiveFrom || nowIso)}\n` +
          `• Created By: ${version.createdByName || master.createdByName || 'HR Creator'}\n` +
          `• Approved By: ${reviewer.name}\n` +
          `• Approved Date: ${formatDDMMYYYY(nowIso)}\n` +
          `• Compliance Acknowledgement Required: NO (Informational / Reference only)\n\n` +
          `You can view and read the complete document with official corporate Header & Footer anytime by logging into the Amaavigo Employee Portal.\n\n` +
          `Sincerely,\nHuman Resources Governance & Compliance Team\n${master.companyName}`;

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
          reason: isSpecificDept
            ? `Dispatched informational notification email for Specific Department (${master.departmentName}) to ${employeeAudience.length} active department employees (No acknowledgement required).`
            : `Dispatched informational notification email for Public Document to all ${employeeAudience.length} active employees (No acknowledgement required).`,
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
      const reviewerDisplay = `${reviewer.name} (${reviewer.loginId || reviewer.empId || 'Approver'})`;
      const emailSubject = `[Revision Required] Rejected by Approver ${reviewerDisplay}: [${master.documentId}] ${master.title} (v${version.versionNumber})`;
      const emailBody = `Dear HR Team,\n\nApprover ${reviewerDisplay} (${reviewer.title}) has reviewed and rejected / requested revisions for version v${version.versionNumber} of document [${master.documentId}] "${master.title}".\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCHANGES REQUIRED / FEEDBACK FROM APPROVER ${reviewer.name}:\n"${comments.trim()}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n• Document ID: ${master.documentId}\n• Title: ${master.title}\n• Reviewed Version: v${version.versionNumber}\n• Rejected / Reviewed By Approver: ${reviewerDisplay} (${reviewer.title})\n• Document Author: ${version.createdByName || 'HR Author'}\n• Decision: Revision Required\n\nPlease navigate to the Creator Studio in your HR Author Dashboard to review the feedback and submit the revised version.\n\nSincerely,\nHR Document Governance Automation System\n${master.companyName}`;

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
    const primaryEmpId = employee.empId || employee.id || employee.loginId || employee.email;
    const empIdentifiers = [employee.id, employee.empId, employee.loginId, employee.email]
      .filter(Boolean)
      .map((s) => s!.toLowerCase());

    const cleanEmpId = (primaryEmpId || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const cleanDocId = documentId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const cleanVer = (versionNumber || '1.0').replace(/\./g, '_');
    const deterministicId = `ack_${cleanDocId}_v${cleanVer}_${cleanEmpId}`;

    const nowIso = new Date().toISOString();
    const master = this.getDocumentMasterById(documentId);
    const version = this.documentVersions.find(
      (v) => v.documentId === documentId && v.versionNumber === versionNumber
    );

    const ackIndex = this.acknowledgements.findIndex(
      (a) =>
        a.id === deterministicId ||
        (a.documentId === documentId &&
          a.versionNumber === versionNumber &&
          (empIdentifiers.includes(a.employeeId?.toLowerCase()) || (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase()))))
    );

    let ack: AcknowledgementRecord;
    if (ackIndex >= 0) {
      ack = {
        ...this.acknowledgements[ackIndex],
        id: deterministicId,
        status: 'ACKNOWLEDGED',
        acknowledgedAt: nowIso,
        employeeId: employee.empId || employee.id,
        employeeName: employee.name,
        employeeEmail: employee.email,
        departmentName: employee.departmentName,
      };
      this.acknowledgements[ackIndex] = ack;
    } else {
      ack = {
        id: deterministicId,
        documentId,
        documentTitle: master?.title || documentId,
        versionNumber,
        documentVersionId: version?.id || '',
        employeeId: employee.empId || employee.id,
        employeeName: employee.name,
        employeeEmail: employee.email,
        departmentName: employee.departmentName,
        status: 'ACKNOWLEDGED',
        acknowledgedAt: nowIso,
      };
      this.acknowledgements.push(ack);
    }

    this.saveAcknowledgementsToStorage();

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
    // Ensure all active employees have pending acknowledgements for active published policies
    this.ensurePendingAcknowledgementsForEmployees();

    const publishedDocs = this.documentMasters.filter(
      (d) =>
        d.active &&
        d.currentStatus === VersionStatus.PUBLISHED &&
        d.acknowledgementRequired &&
        (d.confidentiality === ConfidentialityLevel.PUBLIC || d.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT)
    );
    const validDocIds = new Set(publishedDocs.map((d) => d.documentId));

    // Filter stored acknowledgements to only include currently valid published documents
    const validStoredAcks = this.acknowledgements.filter((a) => validDocIds.has(a.documentId));

    // Deduplicate so ACKNOWLEDGED always takes precedence per document version & employee
    const canonicalMap = new Map<string, AcknowledgementRecord>();
    for (const item of validStoredAcks) {
      const matchedUser = this.findUserByIdentifiers(item.employeeId) || this.findUserByIdentifiers(item.employeeEmail);
      const emp = (matchedUser?.empId || matchedUser?.id || item.employeeId || item.employeeEmail || '').toLowerCase().trim();
      const ver = (item.versionNumber || '1.0').trim();
      const key = `${item.documentId.toLowerCase()}_${ver}_${emp}`;
      const existing = canonicalMap.get(key);
      if (!existing || (item.status === 'ACKNOWLEDGED' && existing.status !== 'ACKNOWLEDGED')) {
        canonicalMap.set(key, item);
      }
    }
    const deduplicated = Array.from(canonicalMap.values());

    if (employeeIdentifier) {
      const target = employeeIdentifier.toLowerCase();
      const targetUser = this.findUserByIdentifiers(employeeIdentifier);

      return deduplicated.filter((a) => {
        const matchesEmployee =
          a.employeeId?.toLowerCase() === target ||
          a.employeeEmail?.toLowerCase() === target;
        if (!matchesEmployee) return false;

        const doc = publishedDocs.find((d) => d.documentId === a.documentId);
        if (doc && doc.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT && targetUser) {
          return isEmployeeInDepartment(targetUser, doc.departmentName, doc.departmentId);
        }
        return true;
      });
    }
    return deduplicated;
  }

  // Get aggregated compliance stats per employee
  public getEmployeeComplianceStats(): any[] {
    this.ensurePendingAcknowledgementsForEmployees();
    const employees = this.users.filter((u) => {
      const r = (u.role || '').toString().toUpperCase();
      return r === 'EMPLOYEE' && u.active !== false;
    });
    const publishedDocs = this.documentMasters.filter(
      (d) =>
        d.active &&
        d.currentStatus === VersionStatus.PUBLISHED &&
        d.acknowledgementRequired &&
        (d.confidentiality === ConfidentialityLevel.PUBLIC || d.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT)
    );

    return employees.map((emp) => {
      const empIdentifiers = [emp.id, emp.empId, emp.loginId, emp.email].filter(Boolean).map((s) => s!.toLowerCase());

      // Only assign documents that are Public OR belong specifically to this employee's department
      const relevantDocs = publishedDocs.filter((doc) => {
        if (doc.confidentiality === ConfidentialityLevel.PUBLIC) return true;
        if (doc.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
          return isEmployeeInDepartment(emp, doc.departmentName, doc.departmentId);
        }
        return false;
      });

      const records = relevantDocs.map((doc) => {
        const activeVer = this.documentVersions.find((v) => v.id === doc.currentPublishedVersionId) ||
          this.documentVersions.filter((v) => v.documentMasterId === doc.id && v.status === VersionStatus.PUBLISHED).pop();
        const activeVerNum = activeVer?.versionNumber || doc.currentPublishedVersionNumber || '1.0';

        const existing = this.acknowledgements.find(
          (a) =>
            a.documentId === doc.documentId &&
            (a.versionNumber === activeVerNum || (activeVer && a.documentVersionId === activeVer.id)) &&
            ((a.employeeId && empIdentifiers.includes(a.employeeId.toLowerCase())) ||
             (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase())))
        );
        if (existing) return existing;

        return {
          id: `ack-synth-${emp.id}-${doc.id}`,
          documentId: doc.documentId,
          documentTitle: doc.title,
          versionNumber: activeVerNum,
          documentVersionId: activeVer?.id || doc.currentPublishedVersionId || '',
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
  public async sendComplianceReminder(
    ackOrId: string | AcknowledgementRecord,
    sender: User
  ): Promise<{ success: boolean; message: string }> {
    let ack: AcknowledgementRecord | undefined;

    if (typeof ackOrId === 'object' && ackOrId) {
      const empTarget = (ackOrId.employeeId || ackOrId.employeeEmail || '').toLowerCase().trim();
      ack = this.acknowledgements.find((a) => a.id === ackOrId.id) ||
            this.acknowledgements.find((a) =>
              a.documentId === ackOrId.documentId &&
              a.versionNumber === ackOrId.versionNumber &&
              ((a.employeeId && a.employeeId.toLowerCase() === empTarget) ||
               (a.employeeEmail && a.employeeEmail.toLowerCase() === empTarget))
            );

      if (!ack) {
        ack = {
          id: ackOrId.id,
          documentId: ackOrId.documentId,
          documentTitle: ackOrId.documentTitle,
          versionNumber: ackOrId.versionNumber,
          documentVersionId: ackOrId.documentVersionId || '',
          employeeId: ackOrId.employeeId,
          employeeName: ackOrId.employeeName,
          employeeEmail: ackOrId.employeeEmail,
          departmentName: ackOrId.departmentName,
          status: 'PENDING',
        };
        this.acknowledgements.push(ack);
        try {
          firestoreService.saveAcknowledgement(ack).catch((e) => console.warn('Firestore ack save error:', e));
        } catch (e) {}
      }
    } else if (typeof ackOrId === 'string') {
      const ackId = ackOrId;
      ack = this.acknowledgements.find((a) => a.id === ackId);
      if (!ack) {
        // Try fallback match
        ack = this.acknowledgements.find((a) =>
          a.status === 'PENDING' &&
          ((a.employeeId && ackId.toLowerCase().includes(a.employeeId.toLowerCase())) ||
           (a.employeeEmail && ackId.toLowerCase().includes(a.employeeEmail.toLowerCase())))
        );
      }
    }

    if (!ack) throw new Error('Acknowledgement record not found.');

    if (ack.status === 'ACKNOWLEDGED') {
      return { success: false, message: 'Employee has already acknowledged this document version.' };
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

  public findUserByIdentifiers(identifier?: string): User | undefined {
    if (!identifier) return undefined;
    const target = identifier.toLowerCase().trim();
    return this.users.find(
      (u) =>
        (u.id && u.id.toLowerCase() === target) ||
        (u.empId && u.empId.toLowerCase() === target) ||
        (u.loginId && u.loginId.toLowerCase() === target) ||
        (u.email && u.email.toLowerCase() === target)
    );
  }

  // Record a manual offline sign-off / attestation
  public async recordManualSignOff(
    ackOrId: string | AcknowledgementRecord,
    notes: string,
    adminUser: User
  ): Promise<AcknowledgementRecord> {
    let ack: AcknowledgementRecord | undefined;
    const nowIso = new Date().toISOString();
    const recorderTitle = adminUser.title || (adminUser.role === UserRole.REVIEWER ? 'Compliance Approver' : 'HR Policy & Governance Lead');
    const recorderLabel = `${adminUser.name} (${recorderTitle})`;

    if (typeof ackOrId === 'object' && ackOrId) {
      const empTarget = (ackOrId.employeeId || ackOrId.employeeEmail || '').toLowerCase().trim();
      const matchedUser = this.findUserByIdentifiers(empTarget) || this.findUserByIdentifiers(ackOrId.employeeEmail);
      const empIdentifiers = [
        matchedUser?.id,
        matchedUser?.empId,
        matchedUser?.loginId,
        matchedUser?.email,
        ackOrId.employeeId,
        ackOrId.employeeEmail,
      ]
        .filter(Boolean)
        .map((s) => s!.toLowerCase());

      const primaryEmpId = matchedUser?.empId || matchedUser?.id || ackOrId.employeeId || ackOrId.employeeEmail || 'unknown';
      const cleanEmpId = primaryEmpId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const cleanDocId = (ackOrId.documentId || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const cleanVer = (ackOrId.versionNumber || '1.0').replace(/\./g, '_');
      const deterministicId = `ack_${cleanDocId}_v${cleanVer}_${cleanEmpId}`;

      ack = this.acknowledgements.find(
        (a) =>
          a.id === deterministicId ||
          (a.documentId.toLowerCase() === (ackOrId.documentId || '').toLowerCase() &&
            a.versionNumber === (ackOrId.versionNumber || '1.0') &&
            (empIdentifiers.includes(a.employeeId?.toLowerCase()) || (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase()))))
      );

      if (!ack) {
        ack = {
          ...ackOrId,
          id: deterministicId,
          documentId: ackOrId.documentId,
          documentTitle: ackOrId.documentTitle,
          versionNumber: ackOrId.versionNumber || '1.0',
          documentVersionId: ackOrId.documentVersionId || '',
          employeeId: matchedUser?.empId || matchedUser?.id || ackOrId.employeeId,
          employeeName: matchedUser?.name || ackOrId.employeeName,
          employeeEmail: matchedUser?.email || ackOrId.employeeEmail,
          departmentName: matchedUser?.departmentName || ackOrId.departmentName,
          status: 'PENDING',
        };
        this.acknowledgements.push(ack);
      }

      // Ensure duplicate pending records for this doc & user are removed
      this.acknowledgements = this.acknowledgements.filter(
        (a) =>
          a === ack ||
          !(
            a.documentId.toLowerCase() === (ackOrId.documentId || '').toLowerCase() &&
            a.versionNumber === (ackOrId.versionNumber || '1.0') &&
            (empIdentifiers.includes(a.employeeId?.toLowerCase()) || (a.employeeEmail && empIdentifiers.includes(a.employeeEmail.toLowerCase())))
          )
      );

      ack.id = deterministicId;
      ack.employeeId = matchedUser?.empId || matchedUser?.id || ack.employeeId;
      ack.employeeName = matchedUser?.name || ack.employeeName;
      ack.employeeEmail = matchedUser?.email || ack.employeeEmail;
      ack.departmentName = matchedUser?.departmentName || ack.departmentName;
    } else {
      ack = this.acknowledgements.find((a) => a.id === ackOrId);
    }

    if (!ack) throw new Error('Acknowledgement record not found.');

    ack.status = 'ACKNOWLEDGED';
    ack.acknowledgedAt = nowIso;
    ack.offlineSignOff = true;
    ack.signOffType = 'OFFLINE';
    ack.recordedBy = recorderLabel;
    ack.recordedByUserId = adminUser.id;
    ack.notes = notes ? `${notes} (Attested by ${recorderLabel})` : `Manually attested by ${recorderLabel}`;
    ack.signatureReference = `MANUAL-ATTEST-${adminUser.loginId || adminUser.id}-${Date.now().toString().slice(-4)}`;

    // Save locally immediately so state is preserved across reloads and tab switches
    this.saveAcknowledgementsToStorage();

    // Persist to Cloud Firestore
    try {
      await firestoreService.saveAcknowledgement(ack);
    } catch (e) {
      console.warn('Firestore manual sign-off sync error:', e);
    }

    auditService.logEvent(AuditAction.DOCUMENT_ACKNOWLEDGED, adminUser, {
      documentId: ack.documentId,
      versionNumber: ack.versionNumber,
      reason: `${recorderLabel} recorded manual physical/offline sign-off for ${ack.employeeName}: ${notes || 'Verified paper attestation'}`,
    });

    return ack;
  }

  // Send batch reminders for all pending acknowledgements or specific document
  public async sendBatchReminders(sender: User, documentId?: string): Promise<{ sentCount: number; message: string }> {
    this.ensurePendingAcknowledgementsForEmployees();

    const pendingList = this.acknowledgements.filter(
      (a) => a.status === 'PENDING' && (!documentId || a.documentId === documentId)
    );

    let sent = 0;
    for (const ack of pendingList) {
      await this.sendComplianceReminder(ack, sender);
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
    const docTitle = docMaster ? docMaster.title : documentId;

    this.documentMasters = this.documentMasters.filter((d) => d.id !== targetId && d.documentId !== docLogicalId);
    this.documentVersions = this.documentVersions.filter(
      (v) => v.documentMasterId !== targetId && v.documentId !== docLogicalId
    );
    this.acknowledgements = this.acknowledgements.filter((a) => a.documentId !== docLogicalId);
    this.saveAcknowledgementsToStorage();

    // If document itself is deleted, delete all suggestions for that document as well
    const targetLower = targetId.toLowerCase().trim();
    const docLogicalLower = docLogicalId.toLowerCase().trim();
    this.documentSuggestions = this.documentSuggestions.filter((s) => {
      const sDocId = (s.documentId || '').toLowerCase().trim();
      const sMasterId = (s.documentMasterId || '').toLowerCase().trim();
      return (
        sMasterId !== targetLower &&
        sMasterId !== docLogicalLower &&
        sDocId !== targetLower &&
        sDocId !== docLogicalLower
      );
    });
    this.saveSuggestionsToStorage();

    // Clean up any re-review reminder tracking keys for this document
    const keysToRemove: string[] = [];
    this.reReviewRemindersSent.forEach((k) => {
      if (k.toLowerCase().includes(docLogicalLower) || k.toLowerCase().includes(targetLower)) {
        keysToRemove.push(k);
      }
    });
    keysToRemove.forEach((k) => this.reReviewRemindersSent.delete(k));
    this.saveReminderKeysToStorage();

    // Sync deletion to Firestore (documents, versions, acks, suggestions - audit logs are NEVER deleted)
    try {
      await firestoreService.deleteDocument(targetId);
    } catch (e) {
      console.warn('[Governance] Firestore deleteDocument sync note:', e);
    }

    // Always generate an immutable audit log for the deletion event
    const effectiveUser = currentUser || {
      id: 'hr-admin',
      name: 'HR Compliance Officer',
      role: UserRole.CREATOR,
      companyId: 'ama-corp',
      companyName: 'Amaavigo Group',
      departmentId: 'hr-dept',
      departmentName: 'Human Resources',
      title: 'HR Compliance Officer',
      email: 'hr@amaavigo.com',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    auditService.logEvent(AuditAction.DOCUMENT_DELETED, effectiveUser, {
      documentId: docLogicalId,
      documentMasterId: targetId,
      oldValue: docTitle,
      newValue: 'DELETED',
      reason: `Document Master [${docLogicalId}] "${docTitle}" and all version revisions were deleted by ${effectiveUser.name} (${effectiveUser.role}). All historical compliance audit records remain permanently preserved.`,
    });
  }

  // Clear all documents, versions, and acknowledgments across the application & database
  public async clearAllDocuments(currentUser?: User): Promise<void> {
    this.documentMasters = [];
    this.documentVersions = [];
    this.acknowledgements = [];
    this.publicationRecords = [];
    this.documentSuggestions = [];
    this.saveSuggestionsToStorage();
    this.reReviewRemindersSent.clear();
    this.saveReminderKeysToStorage();

    // Mark cleared in localStorage so it does not re-seed automatically on refresh
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem('ama_docs_cleared', 'true');
      }
    } catch (e) {
      console.warn('Storage note:', e);
    }

    // Sync clear to Firestore (documents, versions, acks only - audit trail is strictly preserved)
    try {
      await firestoreService.clearAllDocuments();
    } catch (e) {
      console.warn('[Governance] Firestore clearAllDocuments sync note:', e);
    }

    const effectiveUser = currentUser || {
      id: 'hr-admin',
      name: 'HR Compliance Officer',
      role: UserRole.CREATOR,
      companyId: 'ama-corp',
      companyName: 'Amaavigo Group',
      departmentId: 'hr-dept',
      departmentName: 'Human Resources',
      title: 'HR Compliance Officer',
      email: 'hr@amaavigo.com',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    auditService.logEvent(AuditAction.ALL_DOCUMENTS_CLEARED, effectiveUser, {
      documentId: 'ALL-DOCUMENTS',
      oldValue: 'ACTIVE_POLICIES',
      newValue: 'PURGED',
      reason: `All active document masters, revisions, and acknowledgment records were purged by ${effectiveUser.name} (${effectiveUser.role}). Immutable audit logs remain intact.`,
    });
  }

  // ==========================================
  // EMPLOYEE DOCUMENT SUGGESTIONS & REVIEWS
  // ==========================================

  public getDocumentSuggestions(documentId?: string): DocumentSuggestion[] {
    if (!documentId) return [...this.documentSuggestions];
    const clean = documentId.toLowerCase().trim();
    return this.documentSuggestions.filter(
      (s) =>
        s.documentId.toLowerCase() === clean ||
        s.documentMasterId.toLowerCase() === clean ||
        s.documentTitle.toLowerCase().includes(clean)
    );
  }

  public setDocumentSuggestions(suggestions: DocumentSuggestion[]): void {
    if (!Array.isArray(suggestions)) return;
    const cleanList = suggestions.filter(
      (s) => !s.id?.startsWith('sug-seed-') && !s.documentId?.includes('doc-seed')
    );
    this.documentSuggestions = cleanList.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    this.saveSuggestionsToStorage();
  }

  public async submitDocumentSuggestion(
    employee: User,
    data: {
      documentId: string;
      category: SuggestionCategory;
      subject: string;
      content: string;
    }
  ): Promise<DocumentSuggestion> {
    const master = this.documentMasters.find(
      (d) => d.documentId.toLowerCase() === data.documentId.toLowerCase() || d.id === data.documentId
    );
    if (!master || master.currentStatus !== VersionStatus.PUBLISHED || !master.active) {
      throw new Error('Suggestions can only be submitted for authorized and published policy documents.');
    }
    const pubVer = this.getPublishedVersion(master.id);
    if (!pubVer || pubVer.status !== VersionStatus.PUBLISHED) {
      throw new Error('Suggestions can only be submitted for authorized and published policy documents.');
    }

    const newSuggestion: DocumentSuggestion = {
      id: `sug-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      documentId: master?.documentId || data.documentId,
      documentMasterId: master?.id || data.documentId,
      documentTitle: master?.title || 'Governance Policy',
      versionNumber: pubVer?.versionNumber || master?.currentPublishedVersionNumber || '1.0',
      employeeId: employee.empId || employee.loginId || employee.id || 'EMP',
      employeeName: employee.name || 'Employee',
      employeeEmail: employee.email || '',
      employeeDepartment: employee.departmentName || (employee as any).department || 'General',
      employeeRole: employee.role,
      category: data.category,
      subject: data.subject.trim(),
      content: data.content.trim(),
      status: 'PENDING_REVIEW',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.documentSuggestions.unshift(newSuggestion);
    this.saveSuggestionsToStorage();

    // Persist to Cloud Firestore
    try {
      await firestoreService.saveSuggestion(newSuggestion);
    } catch (e) {
      console.warn('Firestore suggestion cloud sync note:', e);
    }

    auditService.logEvent(AuditAction.SUGGESTION_SUBMITTED, employee, {
      documentId: newSuggestion.documentId,
      documentMasterId: newSuggestion.documentMasterId,
      reason: `Employee ${employee.name} submitted a ${data.category} suggestion for ${newSuggestion.documentId}: "${data.subject}"`,
    });

    return newSuggestion;
  }

  public async updateSuggestionStatus(
    suggestionId: string,
    status: SuggestionStatus,
    reviewNotes?: string,
    reviewer?: User
  ): Promise<DocumentSuggestion> {
    const index = this.documentSuggestions.findIndex((s) => s.id === suggestionId);
    if (index === -1) {
      throw new Error(`Suggestion not found: ${suggestionId}`);
    }

    const updated: DocumentSuggestion = {
      ...this.documentSuggestions[index],
      status,
      reviewNotes: reviewNotes !== undefined ? reviewNotes : this.documentSuggestions[index].reviewNotes,
      reviewedById: reviewer?.id,
      reviewedByName: reviewer?.name,
      reviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.documentSuggestions[index] = updated;
    this.saveSuggestionsToStorage();

    try {
      await firestoreService.updateSuggestion(suggestionId, {
        status,
        reviewNotes: updated.reviewNotes,
        reviewedById: updated.reviewedById,
        reviewedByName: updated.reviewedByName,
        reviewedAt: updated.reviewedAt,
        updatedAt: updated.updatedAt,
      });
    } catch (e) {
      console.warn('Firestore suggestion status update note:', e);
    }

    if (reviewer) {
      auditService.logEvent(AuditAction.SUGGESTION_REVIEWED, reviewer, {
        documentId: updated.documentId,
        documentMasterId: updated.documentMasterId,
        newValue: status,
        reason: `${reviewer.name} marked suggestion "${updated.subject}" as ${status}. ${reviewNotes ? `Notes: ${reviewNotes}` : ''}`,
      });
    }

    return updated;
  }

  // ==========================================
  // AUTOMATED 2-DAY RE-REVIEW REMINDERS ENGINE
  // ==========================================
  public async checkAndDispatchReReviewReminders(
    options: { force?: boolean; mockDaysNotice?: number; targetDocId?: string } = {}
  ): Promise<{ sentCount: number; checkedDocs: number; details: string[] }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const creators = this.getCreators();
    if (creators.length === 0) {
      return { sentCount: 0, checkedDocs: 0, details: ['No HR Creator recipients found to notify.'] };
    }

    const details: string[] = [];
    let sentCount = 0;
    let checkedDocs = 0;

    const docsToCheck = options.targetDocId
      ? this.documentMasters.filter((d) => d.id === options.targetDocId || d.documentId === options.targetDocId)
      : this.documentMasters;

    for (const master of docsToCheck) {
      if (!master.active || master.currentStatus !== VersionStatus.PUBLISHED) continue;
      checkedDocs++;

      const pubVer = this.getPublishedVersion(master.id) || this.documentVersions.find((v) => v.documentMasterId === master.id);
      if (!pubVer || !pubVer.reviewDueDate) continue;

      const reviewDueDate = new Date(pubVer.reviewDueDate);
      reviewDueDate.setHours(0, 0, 0, 0);

      const diffTime = reviewDueDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Trigger condition: within 2 days prior to re-review date (or force)
      const isTargetDueWindow = options.force ? true : (diffDays <= (options.mockDaysNotice ?? 2) && diffDays >= 0);

      if (!isTargetDueWindow) continue;

      // Unique deduplication key: docId_reviewDueDate_reminder
      const reminderKey = `reminder_${master.documentId}_${pubVer.reviewDueDate}_2days`;
      if (!options.force && this.reReviewRemindersSent.has(reminderKey)) {
        continue;
      }

      // Collect all suggestions for this document
      const docSuggestions = this.getDocumentSuggestions(master.documentId);

      let suggestionsSection = '';
      if (docSuggestions.length > 0) {
        suggestionsSection =
          `EMPLOYEE SUGGESTIONS RECEIVED (${docSuggestions.length}):\n` +
          docSuggestions
            .map(
              (s, idx) =>
                `  ${idx + 1}. [${s.category}] "${s.subject}"\n` +
                `     Submitted by: ${s.employeeName} (${s.employeeDepartment || 'Employee'})\n` +
                `     Feedback: "${s.content}"\n` +
                `     Status: ${s.status}${s.reviewNotes ? ` (HR Note: ${s.reviewNotes})` : ''}`
            )
            .join('\n\n');
      } else {
        suggestionsSection =
          `EMPLOYEE SUGGESTIONS:\nNo suggestions from employees have been submitted for this document.`;
      }

      const urgencyNotice =
        diffDays === 0
          ? `TODAY is the scheduled Re-review Due Date`
          : diffDays === 1
          ? `Re-review Due Date is TOMORROW (${formatDDMMYYYY(pubVer.reviewDueDate)})`
          : diffDays === 2
          ? `Re-review Due Date is in 2 DAYS (${formatDDMMYYYY(pubVer.reviewDueDate)})`
          : `Re-review Due Date is ${formatDDMMYYYY(pubVer.reviewDueDate)} (in ${diffDays} days)`;

      const subject = `[Action Required] Upcoming Policy Re-Review in 2 Days: ${master.title} (${master.documentId})`;

      const body =
        `Dear HR Governance Team,\n\n` +
        `This is an automated 2-day reminder that the corporate policy "${master.title}" is reaching its scheduled re-review date.\n\n` +
        `POLICY DETAILS:\n` +
        `• Document Title: ${master.title}\n` +
        `• Document ID: ${master.documentId}\n` +
        `• Live Version: v${pubVer.versionNumber}\n` +
        `• Category: ${master.category}\n` +
        `• Department: ${master.departmentName}\n` +
        `• Effective From: ${formatDDMMYYYY(pubVer.effectiveFrom)}\n` +
        `• Re-review Due Date: ${formatDDMMYYYY(pubVer.reviewDueDate)} (${urgencyNotice})\n\n` +
        `--------------------------------------------------\n` +
        `${suggestionsSection}\n` +
        `--------------------------------------------------\n\n` +
        `REQUIRED ACTIONS FOR HR & LEADERSHIP:\n` +
        `1. Open the "Policy Suggestions" tab to review employee feedback for ${master.documentId}.\n` +
        `2. Go to "Creator Studio" and click "Revise Document" to draft the revised Version ${pubVer.versionNumber ? (parseFloat(pubVer.versionNumber) + 0.1).toFixed(1) : '1.1'}.\n` +
        `3. Submit the revision for Approver review.\n\n` +
        `Best regards,\n` +
        `Amaavigo HR Compliance Automation Engine`;

      // Dispatch notification email to each HR Creator
      for (const creator of creators) {
        await defaultEmailProvider.sendEmail(
          creator.email,
          creator.name,
          subject,
          body,
          {
            documentId: master.documentId,
            documentTitle: master.title,
            versionNumber: pubVer.versionNumber,
            documentVersionId: pubVer.id,
            acknowledgementRequired: false,
          }
        );
        sentCount++;
      }

      this.reReviewRemindersSent.add(reminderKey);
      this.saveReminderKeysToStorage();

      auditService.logEvent(
        AuditAction.RE_REVIEW_REMINDER_SENT,
        creators[0] || ({ id: 'SYSTEM', name: 'Automation Engine', role: UserRole.CREATOR } as any),
        {
          documentId: master.documentId,
          documentMasterId: master.id,
          versionNumber: pubVer.versionNumber,
          reason: `Dispatched 2-day re-review reminder for ${master.documentId} (${docSuggestions.length} employee suggestions attached) to ${creators.length} HR members.`,
        }
      );

      details.push(
        `Dispatched 2-day reminder for ${master.documentId} to ${creators.length} HR recipients (${docSuggestions.length} suggestions attached).`
      );
    }

    return { sentCount, checkedDocs, details };
  }

  // Reload data from Firestore
  public async restoreDefaultSeed(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.removeItem('ama_docs_cleared');
      }
    } catch (e) {
      console.warn('Storage note:', e);
    }
    const [docs, versions, logs, acks, emps] = await Promise.all([
      firestoreService.getDocuments(),
      firestoreService.getVersions(),
      firestoreService.getAuditLogs(),
      firestoreService.getAcknowledgements(),
      firestoreService.getEmployees(),
    ]);
    this.documentMasters = docs;
    this.documentVersions = versions;
    this.setAcknowledgements(acks);
    this.setEmployees(emps);
    auditService.seedLogs(logs);
  }

  // Reset in-memory cache to clean state
  public resetToSeed(): void {
    this.documentMasters = [];
    this.documentVersions = [];
    this.publicationRecords = [];
    this.acknowledgements = [];
    this.comparisons.clear();
  }
}

export const governanceEngine = new DocumentGovernanceEngine();
