export enum UserRole {
  CREATOR = 'CREATOR',
  REVIEWER = 'REVIEWER',
  EMPLOYEE = 'EMPLOYEE',
}

export enum DocumentCategory {
  POLICY = 'Policy',
  SOP = 'SOP',
  FORM = 'Form',
  TEMPLATE = 'Template',
  MANUAL = 'Manual',
  NOTICE = 'Notice',
  CHECKLIST = 'Checklist',
  OFFER_LETTER = 'Offer Letter',
  APPOINTMENT_LETTER = 'Appointment Letter',
  EMPLOYEE_DOCUMENT = 'Employee Document',
  TRAINING_MATERIAL = 'Training Material',
  OTHER = 'Other',
}

export enum VersionStatus {
  DRAFT = 'DRAFT',
  IN_REVIEW = 'IN_REVIEW',
  REVISION_REQUIRED = 'REVISION_REQUIRED',
  PUBLISHED = 'PUBLISHED',
  SUPERSEDED = 'SUPERSEDED',
  ARCHIVED = 'ARCHIVED',
  WITHDRAWN = 'WITHDRAWN',
  EXPIRED = 'EXPIRED',
}

export enum VersionType {
  INITIAL = 'INITIAL',
  MINOR = 'MINOR',
  MAJOR = 'MAJOR',
}

export enum ConfidentialityLevel {
  PUBLIC = 'Public (All Employees)',
  INTERNAL = 'Internal Company',
}

export enum AuditAction {
  DOCUMENT_CREATED = 'DOCUMENT_CREATED',
  VERSION_CREATED = 'VERSION_CREATED',
  FILE_UPLOADED = 'FILE_UPLOADED',
  SUBMITTED_FOR_REVIEW = 'SUBMITTED_FOR_REVIEW',
  REVIEW_STARTED = 'REVIEW_STARTED',
  REVIEW_APPROVED = 'REVIEW_APPROVED',
  REVIEW_REJECTED = 'REVIEW_REJECTED',
  REVISION_REQUESTED = 'REVISION_REQUESTED',
  VERSION_PUBLISHED = 'VERSION_PUBLISHED',
  VERSION_SUPERSEDED = 'VERSION_SUPERSEDED',
  VERSION_ARCHIVED = 'VERSION_ARCHIVED',
  NOTIFICATION_SENT = 'NOTIFICATION_SENT',
  NOTIFICATION_FAILED = 'NOTIFICATION_FAILED',
  FILE_HASH_VALIDATED = 'FILE_HASH_VALIDATED',
  PUBLICATION_FAILED = 'PUBLICATION_FAILED',
  ACCESS_DENIED = 'ACCESS_DENIED',
  DOCUMENT_ACKNOWLEDGED = 'DOCUMENT_ACKNOWLEDGED',
  USER_UPDATED = 'USER_UPDATED',
}

export interface User {
  id: string;
  loginId?: string;
  empId?: string;
  password?: string;
  name: string;
  email: string;
  role: UserRole;
  companyId: string;
  companyName: string;
  departmentId: string;
  departmentName: string;
  title: string;
  avatar?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentMaster {
  id: string;
  documentId: string; // e.g. AMA-HR-POL-001
  title: string;
  category: DocumentCategory;
  companyId: string;
  companyName: string;
  departmentId: string;
  departmentName: string;
  processOwnerId: string;
  processOwnerName: string;
  documentOwnerId: string;
  documentOwnerName: string;
  confidentiality: ConfidentialityLevel;
  acknowledgementRequired: boolean;
  currentPublishedVersionId?: string;
  currentPublishedVersionNumber?: string;
  currentStatus: VersionStatus;
  description?: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface DocumentVersion {
  id: string;
  documentMasterId: string;
  documentId: string;
  documentTitle: string;
  versionNumber: string; // e.g. "1.0", "1.1", "2.0"
  versionType: VersionType;
  status: VersionStatus;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  storagePath: string; // Deterministic path e.g. /HR Documents/Policies/AMA-HR-POL-001/v1.0/
  fileUrl: string;
  contentHash: string; // SHA-256
  rawContent: string; // Normalized plain text / markdown
  createdById: string;
  createdByName: string;
  createdAt: string;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  reviewerComments?: string;
  publishedById?: string;
  publishedByName?: string;
  publishedAt?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  reviewDueDate: string;
  previousVersionId?: string; // Points to baseline (normally previous published version)
  previousVersionNumber?: string;
  supersededByVersionId?: string;
  changeSummary?: string;
  locked: boolean;
  createdFromVersionId?: string;
}

export interface DiffSegment {
  type: 'added' | 'removed' | 'unchanged' | 'modified';
  value: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  oldValue?: string;
  newValue?: string;
}

export interface DocumentComparisonResult {
  id: string;
  documentMasterId: string;
  oldVersionId: string;
  oldVersionNumber: string;
  newVersionId: string;
  newVersionNumber: string;
  comparisonDate: string;
  addedContent: string[];
  removedContent: string[];
  modifiedContent: { section: string; oldText: string; newText: string }[];
  changeSummary: string;
  comparisonAvailable: boolean;
  statistics: {
    additions: number;
    removals: number;
    modifications: number;
    similarityPercentage: number;
  };
  diffSegments: DiffSegment[];
  sideBySideLines: {
    left?: { lineNumber: number; content: string; type: 'removed' | 'unchanged' | 'modified' | 'empty' };
    right?: { lineNumber: number; content: string; type: 'added' | 'unchanged' | 'modified' | 'empty' };
  }[];
  reviewerValidated?: boolean;
}

export interface DocumentPublicationRecord {
  id: string;
  documentVersionId: string;
  documentId: string;
  versionNumber: string;
  publishedById: string;
  publishedByName: string;
  publishedAt: string;
  effectiveDate: string;
  audience: string;
  notificationStatus: 'PENDING' | 'SENT' | 'FAILED';
  publicationUrl: string;
  contentHash: string;
  createdAt: string;
}

export interface EmailNotification {
  id: string;
  documentVersionId: string;
  documentId: string;
  documentTitle: string;
  versionNumber: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  sentAt: string;
  status: 'SENT' | 'FAILED' | 'QUEUED';
  errorMessage?: string;
  retryCount: number;
  acknowledgementRequired: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  documentMasterId?: string;
  documentId?: string;
  documentVersionId?: string;
  versionNumber?: string;
  action: AuditAction;
  oldValue?: string;
  newValue?: string;
  performedById: string;
  performedByName: string;
  performedByRole: UserRole;
  performedAt: string;
  source: string;
  reason?: string;
  ipAddress: string;
  userAgent: string;
}

export interface AcknowledgementRecord {
  id: string;
  documentId: string;
  documentTitle: string;
  versionNumber: string;
  documentVersionId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  departmentName?: string;
  status: 'PENDING' | 'ACKNOWLEDGED';
  acknowledgedAt?: string;
  notes?: string;
  signatureReference?: string;
  reminderSentAt?: string;
}

export interface EmployeeComplianceStats {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  departmentName: string;
  totalAssigned: number;
  acknowledgedCount: number;
  pendingCount: number;
  complianceRate: number;
  acknowledgements: AcknowledgementRecord[];
}

export interface StorageMetadata {
  storageKey: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  storedAt: string;
}
