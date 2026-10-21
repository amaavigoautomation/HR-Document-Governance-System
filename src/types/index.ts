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
  REJECTED = 'REJECTED',
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
  SPECIFIC_DEPARTMENT = 'Specific Department',
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
  DOCUMENT_DELETED = 'DOCUMENT_DELETED',
  ALL_DOCUMENTS_CLEARED = 'ALL_DOCUMENTS_CLEARED',
  NOTIFICATION_SENT = 'NOTIFICATION_SENT',
  NOTIFICATION_FAILED = 'NOTIFICATION_FAILED',
  FILE_HASH_VALIDATED = 'FILE_HASH_VALIDATED',
  PUBLICATION_FAILED = 'PUBLICATION_FAILED',
  ACCESS_DENIED = 'ACCESS_DENIED',
  DOCUMENT_ACKNOWLEDGED = 'DOCUMENT_ACKNOWLEDGED',
  USER_UPDATED = 'USER_UPDATED',
  AUTHORIZATION_UPDATED = 'AUTHORIZATION_UPDATED',
  SUGGESTION_SUBMITTED = 'SUGGESTION_SUBMITTED',
  SUGGESTION_REVIEWED = 'SUGGESTION_REVIEWED',
  RE_REVIEW_REMINDER_SENT = 'RE_REVIEW_REMINDER_SENT',
  REQUISITION_CREATED = 'REQUISITION_CREATED',
  REQUISITION_ASSIGNED = 'REQUISITION_ASSIGNED',
  REQUISITION_HR_APPROVED = 'REQUISITION_HR_APPROVED',
  REQUISITION_HR_REJECTED = 'REQUISITION_HR_REJECTED',
  REQUISITION_FOUNDER_APPROVED = 'REQUISITION_FOUNDER_APPROVED',
  REQUISITION_FOUNDER_REJECTED = 'REQUISITION_FOUNDER_REJECTED',
  JD_GENERATED = 'JD_GENERATED',
  JD_UPDATED = 'JD_UPDATED',
  JOB_PUBLISHED = 'JOB_PUBLISHED',
  REQUISITION_CLOSED = 'REQUISITION_CLOSED',
  ROLE_CHANGED = 'ROLE_CHANGED',
}

// HR seniority: HEAD can assign requisitions to STANDARD HRs
export type HrLevel = 'HEAD' | 'STANDARD';

export interface User {
  id: string;
  /** Firebase Auth uid. Set for every user created through the multi-company system. */
  authUid?: string;
  loginId?: string;
  empId?: string;
  name: string;
  email: string;
  /** Portal the user lands in (HR / Approver / Employee). Derived from their roles on the server. */
  role: UserRole;
  /** Ids and names of the company roles assigned to this user. */
  roleIds?: string[];
  roleNames?: string[];
  /** Effective permission keys (see shared/permissions.ts). The token claims are the source of truth. */
  perms?: string[];
  /** True when the user holds the Company Admin role (full access, from the sign-in token). */
  isCompanyAdmin?: boolean;
  authorizedModules?: string | string[]; // 'ALL' | 'TALENT_ACQUISITION' | 'DOCUMENT_VERSION_CONTROL'
  /** @deprecated replaced by permissions; kept so old records still type-check */
  hrLevel?: HrLevel;
  /** @deprecated replaced by permissions; kept so old records still type-check */
  isDepartmentHead?: boolean;
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

export type CompanyStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';

export interface Company {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  modules: string[];
  plan: string;
  adminEmail: string;
  employeeIdPrefix: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface Department {
  id: string;
  companyId: string;
  name: string;
  headUserId?: string;
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
  createdByTitle?: string;
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
  originalFileUrl?: string;
  contentHash: string; // SHA-256
  rawContent: string; // Normalized plain text / markdown
  createdById: string;
  createdByName: string;
  createdByTitle?: string;
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
  inlineComments?: InlineRevisionComment[];
}

export interface InlineRevisionComment {
  id: string;
  selectedText: string;
  comment: string;
  createdById: string;
  createdByName: string;
  createdByTitle?: string;
  createdAt: string;
  resolved?: boolean;
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
  offlineSignOff?: boolean;
  signOffType?: 'ONLINE' | 'OFFLINE';
  recordedBy?: string;
  recordedByUserId?: string;
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

export type SuggestionCategory =
  | 'IMPROVEMENT'
  | 'CLARITY'
  | 'OPERATIONAL'
  | 'TYPO_CORRECTION'
  | 'POLICY_CHANGE'
  | 'GENERAL';

export type SuggestionStatus =
  | 'PENDING_REVIEW'
  | 'REVIEWED'
  | 'ACCEPTED'
  | 'INCORPORATED_IN_REVISION'
  | 'DISMISSED';

export interface DocumentSuggestion {
  id: string;
  documentId: string;
  documentMasterId: string;
  documentTitle: string;
  versionNumber?: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  employeeDepartment?: string;
  employeeRole?: string;
  category: SuggestionCategory;
  subject: string;
  content: string;
  status: SuggestionStatus;
  reviewNotes?: string;
  reviewedById?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt?: string;
}


// ---------------------------------------------------------------------------
// Hiring Requisitions (Talent Acquisition)
// ---------------------------------------------------------------------------

export type RequisitionStatus =
  | 'PENDING_ASSIGNMENT' // Raised, waiting for Head HR to assign an HR owner
  | 'PENDING_HR' // Assigned HR must approve / reject
  | 'PENDING_FOUNDER' // HR approved + attached document, founder must decide
  | 'JD_DRAFT' // Founder approved; HR prepares the JD
  | 'JOB_OPEN' // JD published as a job
  | 'REJECTED' // Rejected by HR or founder
  | 'CLOSED'; // Hiring finished / cancelled

export type RequisitionUrgency = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RequisitionPerson {
  id: string;
  name: string;
  email: string;
  title?: string;
}

export interface RequisitionDecision {
  decision: 'APPROVED' | 'REJECTED';
  byId: string;
  byName: string;
  at: string;
  comments: string;
}

export interface RequisitionAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  fileUrl: string; // server URL or inline data URL
}

export interface RequisitionEvent {
  at: string;
  action: string; // human readable e.g. "Assigned to Priya"
  byId: string;
  byName: string;
  note?: string;
}

export interface RequisitionJD {
  text: string; // Full editable JD (markdown-ish plain text)
  generatedBy: 'AI' | 'TEMPLATE' | 'MANUAL';
  updatedAt: string;
  updatedByName: string;
}

export interface Requisition {
  id: string;
  reqNo: string; // e.g. REQ-2026-001
  positionTitle: string;
  departmentName: string;
  vacancies: number;
  employmentType: 'Full-time' | 'Part-time' | 'Contract' | 'Internship';
  location: string;
  minExperienceYears: number;
  maxExperienceYears: number;
  urgency: RequisitionUrgency;
  expectedJoiningDate?: string;
  budgetRange?: string;
  justification: string;
  keySkills: string; // free text, comma separated; seeds the JD
  status: RequisitionStatus;
  requestedBy: RequisitionPerson; // department head / manager the request is for
  raisedBy: RequisitionPerson; // who actually submitted it (may be HR on behalf)
  ownerHr?: RequisitionPerson;
  assignedById?: string;
  assignedByName?: string;
  assignedAt?: string;
  hrDecision?: RequisitionDecision;
  hrAttachment?: RequisitionAttachment;
  founderDecision?: RequisitionDecision;
  jd?: RequisitionJD;
  jobId?: string;
  careersPostingId?: string; // id returned by the public careers API when the job was posted
  publishedAt?: string;
  closedReason?: string;
  events: RequisitionEvent[];
  createdAt: string;
  updatedAt: string;
}