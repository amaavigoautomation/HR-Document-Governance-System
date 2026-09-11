import {
  AuditAction,
  AuditLogEntry,
  ConfidentialityLevel,
  DocumentCategory,
  DocumentMaster,
  DocumentVersion,
  User,
  UserRole,
  VersionStatus,
  VersionType,
} from '../types';
import { calculateSha256 } from '../services/storage';

export const SEED_USERS: User[] = [
  {
    id: 'usr-creator-01',
    loginId: 'HR001',
    empId: 'HR001',
    password: 'HR001',
    name: 'Sarah Jenkins',
    email: 'sarah.jenkins@company.com',
    role: UserRole.CREATOR,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-hr',
    departmentName: 'Human Resources',
    title: 'Lead HR Operations & Document Specialist',
    active: true,
    createdAt: '2026-01-10T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
  },
  {
    id: 'usr-creator-02',
    loginId: 'HR002',
    empId: 'HR002',
    password: 'HR002',
    name: 'Bharat Israni',
    email: 'bharat.israni@company.com',
    role: UserRole.CREATOR,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-hr',
    departmentName: 'Human Resources',
    title: 'HR Policy & Governance Lead',
    active: true,
    createdAt: '2026-01-10T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
  },
  {
    id: 'usr-reviewer-01',
    loginId: 'AMA001',
    empId: 'AMA001',
    password: 'AMA001',
    name: 'Marcus Vance',
    email: 'marcus.vance@company.com',
    role: UserRole.REVIEWER,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-gov',
    departmentName: 'Governance & Compliance',
    title: 'Principal HR Governance Officer (Approver)',
    active: true,
    createdAt: '2026-01-10T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
  },
  {
    id: 'usr-reviewer-02',
    loginId: 'AMA002',
    empId: 'AMA002',
    password: 'AMA002',
    name: 'Elena Vance',
    email: 'elena.vance@company.com',
    role: UserRole.REVIEWER,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-gov',
    departmentName: 'Executive Approver Board',
    title: 'Executive Director & Policy Approver',
    active: true,
    createdAt: '2026-01-10T08:00:00Z',
    updatedAt: '2026-08-01T08:00:00Z',
  },
  {
    id: 'AM001',
    loginId: 'AM001',
    empId: 'AM001',
    password: 'Parth!123',
    name: 'Parth',
    email: 'parth@amaavigo.in',
    role: UserRole.EMPLOYEE,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-eng',
    departmentName: 'Engineering & Operations',
    title: 'Senior Software Engineer',
    active: true,
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'AM002',
    loginId: 'AM002',
    empId: 'AM002',
    password: 'Ananya!123',
    name: 'Ananya Sharma',
    email: 'ananya.sharma@amaavigo.com',
    role: UserRole.EMPLOYEE,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-prod',
    departmentName: 'Product & Design',
    title: 'Product Designer',
    active: true,
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'AM003',
    loginId: 'AM003',
    empId: 'AM003',
    password: 'David!123',
    name: 'David Chen',
    email: 'david.chen@amaavigo.com',
    role: UserRole.EMPLOYEE,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-fin',
    departmentName: 'Finance & Accounts',
    title: 'Senior Financial Analyst',
    active: true,
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'AM004',
    loginId: 'AM004',
    empId: 'AM004',
    password: 'Elena!123',
    name: 'Elena Rostova',
    email: 'elena.rostova@amaavigo.com',
    role: UserRole.EMPLOYEE,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-sales',
    departmentName: 'Global Sales & Partnerships',
    title: 'Enterprise Account Executive',
    active: true,
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'AM005',
    loginId: 'AM005',
    empId: 'AM005',
    password: 'Rohit!123',
    name: 'Rohit Verma',
    email: 'rohit.verma@amaavigo.com',
    role: UserRole.EMPLOYEE,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-eng',
    departmentName: 'Engineering & Operations',
    title: 'DevOps Specialist',
    active: true,
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'AM006',
    loginId: 'AM006',
    empId: 'AM006',
    password: 'Maya!123',
    name: 'Maya Patel',
    email: 'maya.patel@amaavigo.com',
    role: UserRole.EMPLOYEE,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-hr',
    departmentName: 'Human Resources',
    title: 'HR Generalist',
    active: true,
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'AM007',
    loginId: 'AM007',
    empId: 'AM007',
    password: 'Vikram!123',
    name: 'Vikram Seth',
    email: 'vikram.seth@amaavigo.com',
    role: UserRole.EMPLOYEE,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-ops',
    departmentName: 'Operations & Strategy',
    title: 'Operations Director',
    active: true,
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'AM008',
    loginId: 'AM008',
    empId: 'AM008',
    password: 'Content!123',
    name: 'Chloe Zhang',
    email: 'chloe.zhang@amaavigo.com',
    role: UserRole.EMPLOYEE,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-content',
    departmentName: 'Content',
    title: 'Content Lead & Editor',
    active: true,
    createdAt: '2026-08-01T09:00:00Z',
    updatedAt: '2026-08-01T09:00:00Z',
  },
];

// Content for WFH Policy v1.0
const WFH_V1_0_TEXT = `# Work From Home (WFH) Policy
**Document ID:** AMA-HR-POL-001
**Version:** 1.0 (Initial Baseline)
**Effective Date:** 2026-08-01

## 1. Purpose & Scope
This policy establishes guidelines for eligible full-time staff to work remotely from home up to two (2) days per calendar week. It applies to all corporate office employees across Amaavigo Global Inc.

## 2. Eligibility
Employees who have completed their mandatory 90-day probationary period and maintain satisfactory performance ratings are eligible for remote work consideration.

## 3. Work Hours and Availability
Remote employees must adhere to core operating business hours from 9:00 AM to 5:00 PM local time. Employees are expected to remain accessible via Microsoft Teams, Slack, and email during these core hours.

## 4. Equipment and Security
Company-issued laptops must be used exclusively. Connecting through the corporate VPN is mandatory for accessing internal repositories and customer data.

## 5. Termination of Remote Privileges
The company reserves the right to revoke remote working privileges upon two weeks written notice if business obligations or performance standards are not met.`;

// Content for WFH Policy v1.1 (Rejected Draft with minor changes)
const WFH_V1_1_TEXT = `# Work From Home (WFH) Policy
**Document ID:** AMA-HR-POL-001
**Version:** 1.1 (Revision Draft)
**Effective Date:** 2026-08-10

## 1. Purpose & Scope
This policy establishes guidelines for eligible full-time staff to work remotely from home up to three (3) days per calendar week. It applies to all corporate office employees across Amaavigo Global Inc.

## 2. Eligibility
Employees who have completed their mandatory 60-day probationary period are eligible for remote work consideration.

## 3. Work Hours and Availability
Remote employees must adhere to core operating business hours from 9:00 AM to 5:00 PM local time. Employees are expected to remain accessible via Microsoft Teams, Slack, and email during these core hours.

## 4. Equipment and Security
Company-issued laptops must be used exclusively. Connecting through the corporate VPN is mandatory for accessing internal repositories and customer data.

## 5. Termination of Remote Privileges
The company reserves the right to revoke remote working privileges upon two weeks written notice if business obligations or performance standards are not met.`;

// Content for WFH Policy v2.0 (Published Approved Major Revision)
const WFH_V2_0_TEXT = `# Work From Home (WFH) Policy
**Document ID:** AMA-HR-POL-001
**Version:** 2.0 (Published Operational Version)
**Effective Date:** 2026-08-20

## 1. Purpose & Scope
This policy establishes comprehensive guidelines for hybrid remote work arrangements across all departments of Amaavigo Global Inc., supporting a flexible 3-day remote and 2-day in-office cadence.

## 2. Eligibility & Manager Approval
Employees who have completed their mandatory 60-day onboarding period and have received formal Department Head written approval are eligible. Eligibility requires maintaining high performance and compliance standards.

## 3. Work Hours, Availability & Core Overlap
Remote employees must maintain core working availability between 9:00 AM and 5:00 PM local time. A daily calendar status indicating "Working Remotely" must be published in Google/Outlook calendar.

## 4. Cybersecurity & Data Protection
1. Company-issued encrypted laptops with active CrowdStrike endpoint protection must be utilized.
2. Dual-Factor Authentication (MFA) and Corporate VPN are required at all times.
3. No sensitive HR or customer documents may be printed or stored on unmanaged personal devices.

## 5. Expense Reimbursement
A monthly remote broadband stipend of $75.00 will be provided to authorized hybrid employees upon quarterly expense verification.

## 6. Policy Governance & Periodic Review
This policy is governed by the Human Resources Governance Committee and undergoes formal annual review.`;

// Content for Leave Policy v1.0
const LEAVE_V1_0_TEXT = `# Employee Paid Leave and PTO Policy
**Document ID:** AMA-HR-POL-002
**Version:** 1.0 (Published Baseline)
**Effective Date:** 2026-08-01

## 1. Policy Overview
Amaavigo Global Inc. provides eligible full-time employees with comprehensive Paid Time Off (PTO) to support work-life balance, health recovery, and personal well-being.

## 2. Annual PTO Accrual
Full-time regular employees accrue 18 days of paid vacation leave per calendar year, accruing on the 1st day of each month at a rate of 1.5 days per month.

## 3. Sick & Medical Leave
Employees receive 10 paid sick days annually. For absences exceeding three (3) consecutive working days, a formal medical practitioner certificate is required upon return.

## 4. Request and Approval Procedure
All planned vacation requests exceeding two consecutive days must be submitted through the HR Portal at least two weeks prior to the requested departure date.`;

// Content for Leave Policy v1.1 (Under Review)
const LEAVE_V1_1_TEXT = `# Employee Paid Leave and PTO Policy
**Document ID:** AMA-HR-POL-002
**Version:** 1.1 (Revision Under Review)
**Effective Date:** 2026-09-01

## 1. Policy Overview
Amaavigo Global Inc. provides eligible full-time employees with comprehensive Paid Time Off (PTO) to support work-life balance, health recovery, parental care, and personal well-being.

## 2. Annual PTO Accrual
Full-time regular employees accrue 22 days of paid vacation leave per calendar year, accruing on the 1st day of each month at an updated rate of 1.83 days per month.

## 3. Sick, Medical & Mental Health Days
Employees receive 12 paid wellness & sick days annually, including two designated Mental Health Days with no medical note requirement. For medical absences exceeding three (3) consecutive working days, a medical practitioner certificate is required.

## 4. Request and Approval Procedure
All planned vacation requests exceeding two consecutive days must be submitted through the HR Portal at least one week prior to the requested departure date.

## 5. Parental & Bereavement Leave Expansion
New parents receive 16 weeks of fully paid parental bonding leave. Bereavement leave is expanded to 5 consecutive paid business days for immediate family members.`;

// Attendance SOP v1.0
const ATTENDANCE_SOP_TEXT = `# Standard Operating Procedure: Time & Attendance Tracking
**Document ID:** AMA-HR-SOP-001
**Version:** 1.0 (Published Operational Version)
**Effective Date:** 2026-07-15

## 1. Objective
To standardise time logging, clock-in procedures, and shift attendance verification across all corporate and field units.

## 2. Automated Badge & Portal Logging
Employees must check in daily via the biometric badge scanner or the verified Single Sign-On HR attendance web widget before 9:15 AM local time.

## 3. Grace Periods & Overtime Authorization
A 15-minute grace period applies to morning shifts. Any overtime exceeding 30 minutes must be pre-approved in writing by the designated Shift Supervisor.`;

export const SEED_DOCUMENTS: DocumentMaster[] = [
  {
    id: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    title: 'Work From Home (WFH) Policy',
    category: DocumentCategory.POLICY,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-hr',
    departmentName: 'Human Resources',
    processOwnerId: 'usr-creator-01',
    processOwnerName: 'Sarah Jenkins',
    documentOwnerId: 'usr-reviewer-01',
    documentOwnerName: 'Marcus Vance',
    confidentiality: ConfidentialityLevel.PUBLIC,
    acknowledgementRequired: true,
    currentPublishedVersionId: 'ver-001-v20',
    currentPublishedVersionNumber: '2.0',
    currentStatus: VersionStatus.PUBLISHED,
    description: 'Corporate policy defining hybrid remote working guidelines, cybersecurity rules, eligibility, and expense stipends.',
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdAt: '2026-07-28T09:00:00Z',
    updatedAt: '2026-08-20T14:30:00Z',
    active: true,
  },
  {
    id: 'doc-002',
    documentId: 'AMA-HR-POL-002',
    title: 'Employee Paid Leave & PTO Policy',
    category: DocumentCategory.POLICY,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-hr',
    departmentName: 'Human Resources',
    processOwnerId: 'usr-creator-01',
    processOwnerName: 'Sarah Jenkins',
    documentOwnerId: 'usr-reviewer-01',
    documentOwnerName: 'Marcus Vance',
    confidentiality: ConfidentialityLevel.PUBLIC,
    acknowledgementRequired: true,
    currentPublishedVersionId: 'ver-002-v10',
    currentPublishedVersionNumber: '1.0',
    currentStatus: VersionStatus.IN_REVIEW, // Has a version in review!
    description: 'Guidelines governing annual vacation accrual, wellness days, parental leave, and medical leave requests.',
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-25T11:00:00Z',
    active: true,
  },
  {
    id: 'doc-003',
    documentId: 'AMA-HR-SOP-001',
    title: 'Attendance & Punctuality Standard Operating Procedure',
    category: DocumentCategory.SOP,
    companyId: 'comp-01',
    companyName: 'Amaavigo Global Inc.',
    departmentId: 'dept-ops',
    departmentName: 'Operations',
    processOwnerId: 'usr-creator-01',
    processOwnerName: 'Sarah Jenkins',
    documentOwnerId: 'usr-reviewer-01',
    documentOwnerName: 'Marcus Vance',
    confidentiality: ConfidentialityLevel.INTERNAL,
    acknowledgementRequired: false,
    currentPublishedVersionId: 'ver-003-v10',
    currentPublishedVersionNumber: '1.0',
    currentStatus: VersionStatus.PUBLISHED,
    description: 'Standard operational protocol for shift clocking, attendance grace periods, and shift handover logging.',
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdAt: '2026-07-15T08:00:00Z',
    updatedAt: '2026-07-15T10:00:00Z',
    active: true,
  },
];

export const SEED_VERSIONS: DocumentVersion[] = [
  // WFH Policy v1.0 (SUPERSEDED)
  {
    id: 'ver-001-v10',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentTitle: 'Work From Home (WFH) Policy',
    versionNumber: '1.0',
    versionType: VersionType.INITIAL,
    status: VersionStatus.SUPERSEDED,
    fileName: 'AMA-HR-POL-001_WFH-Policy_v1.0.pdf',
    fileSize: 48200,
    mimeType: 'application/pdf',
    storageKey: '/HR Documents/Policy/AMA-HR-POL-001/v1.0/AMA-HR-POL-001_WFH-Policy_v1.0.pdf',
    storagePath: '/HR Documents/Policy/AMA-HR-POL-001/v1.0/',
    fileUrl: '/api/storage/download?key=/HR Documents/Policy/AMA-HR-POL-001/v1.0/AMA-HR-POL-001_WFH-Policy_v1.0.pdf',
    contentHash: calculateSha256(WFH_V1_0_TEXT),
    rawContent: WFH_V1_0_TEXT,
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdAt: '2026-07-28T09:00:00Z',
    reviewedById: 'usr-reviewer-01',
    reviewedByName: 'Marcus Vance',
    reviewedAt: '2026-08-01T10:30:00Z',
    publishedById: 'usr-reviewer-01',
    publishedByName: 'Marcus Vance',
    publishedAt: '2026-08-01T10:30:00Z',
    effectiveFrom: '2026-08-01',
    reviewDueDate: '2027-08-01',
    supersededByVersionId: 'ver-001-v20',
    changeSummary: 'Initial policy baseline publication.',
    locked: true,
  },
  // WFH Policy v1.1 (REVISION_REQUIRED)
  {
    id: 'ver-001-v11',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentTitle: 'Work From Home (WFH) Policy',
    versionNumber: '1.1',
    versionType: VersionType.MINOR,
    status: VersionStatus.REVISION_REQUIRED,
    fileName: 'AMA-HR-POL-001_WFH-Policy_v1.1.pdf',
    fileSize: 49100,
    mimeType: 'application/pdf',
    storageKey: '/HR Documents/Policy/AMA-HR-POL-001/v1.1/AMA-HR-POL-001_WFH-Policy_v1.1.pdf',
    storagePath: '/HR Documents/Policy/AMA-HR-POL-001/v1.1/',
    fileUrl: '/api/storage/download?key=/HR Documents/Policy/AMA-HR-POL-001/v1.1/AMA-HR-POL-001_WFH-Policy_v1.1.pdf',
    contentHash: calculateSha256(WFH_V1_1_TEXT),
    rawContent: WFH_V1_1_TEXT,
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdAt: '2026-08-10T11:00:00Z',
    reviewedById: 'usr-reviewer-01',
    reviewedByName: 'Marcus Vance',
    reviewedAt: '2026-08-12T14:15:00Z',
    reviewerComments: 'Please update the eligibility section and clarify manager approval requirements. Also add cybersecurity guidelines for CrowdStrike & MFA.',
    effectiveFrom: '2026-08-15',
    reviewDueDate: '2027-08-15',
    previousVersionId: 'ver-001-v10',
    previousVersionNumber: '1.0',
    changeSummary: 'Attempted minor revision to increase remote days to 3.',
    locked: false,
    createdFromVersionId: 'ver-001-v10',
  },
  // WFH Policy v2.0 (PUBLISHED)
  {
    id: 'ver-001-v20',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentTitle: 'Work From Home (WFH) Policy',
    versionNumber: '2.0',
    versionType: VersionType.MAJOR,
    status: VersionStatus.PUBLISHED,
    fileName: 'AMA-HR-POL-001_WFH-Policy_v2.0.pdf',
    fileSize: 56400,
    mimeType: 'application/pdf',
    storageKey: '/HR Documents/Policy/AMA-HR-POL-001/v2.0/AMA-HR-POL-001_WFH-Policy_v2.0.pdf',
    storagePath: '/HR Documents/Policy/AMA-HR-POL-001/v2.0/',
    fileUrl: '/api/storage/download?key=/HR Documents/Policy/AMA-HR-POL-001/v2.0/AMA-HR-POL-001_WFH-Policy_v2.0.pdf',
    contentHash: calculateSha256(WFH_V2_0_TEXT),
    rawContent: WFH_V2_0_TEXT,
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdAt: '2026-08-18T13:00:00Z',
    reviewedById: 'usr-reviewer-01',
    reviewedByName: 'Marcus Vance',
    reviewedAt: '2026-08-20T14:30:00Z',
    publishedById: 'usr-reviewer-01',
    publishedByName: 'Marcus Vance',
    publishedAt: '2026-08-20T14:30:00Z',
    effectiveFrom: '2026-08-20',
    reviewDueDate: '2027-08-20',
    previousVersionId: 'ver-001-v10', // Points to baseline v1.0
    previousVersionNumber: '1.0',
    changeSummary: 'Major restructuring with manager authorization workflow, $75 monthly broadband stipend, and cybersecurity mandates.',
    locked: true,
    createdFromVersionId: 'ver-001-v10',
  },
  // Leave Policy v1.0 (PUBLISHED)
  {
    id: 'ver-002-v10',
    documentMasterId: 'doc-002',
    documentId: 'AMA-HR-POL-002',
    documentTitle: 'Employee Paid Leave & PTO Policy',
    versionNumber: '1.0',
    versionType: VersionType.INITIAL,
    status: VersionStatus.PUBLISHED,
    fileName: 'AMA-HR-POL-002_Leave-Policy_v1.0.pdf',
    fileSize: 42300,
    mimeType: 'application/pdf',
    storageKey: '/HR Documents/Policy/AMA-HR-POL-002/v1.0/AMA-HR-POL-002_Leave-Policy_v1.0.pdf',
    storagePath: '/HR Documents/Policy/AMA-HR-POL-002/v1.0/',
    fileUrl: '/api/storage/download?key=/HR Documents/Policy/AMA-HR-POL-002/v1.0/AMA-HR-POL-002_Leave-Policy_v1.0.pdf',
    contentHash: calculateSha256(LEAVE_V1_0_TEXT),
    rawContent: LEAVE_V1_0_TEXT,
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdAt: '2026-08-01T10:00:00Z',
    reviewedById: 'usr-reviewer-01',
    reviewedByName: 'Marcus Vance',
    reviewedAt: '2026-08-03T16:00:00Z',
    publishedById: 'usr-reviewer-01',
    publishedByName: 'Marcus Vance',
    publishedAt: '2026-08-03T16:00:00Z',
    effectiveFrom: '2026-08-01',
    reviewDueDate: '2027-08-01',
    changeSummary: 'Initial policy baseline publication.',
    locked: true,
  },
  // Leave Policy v1.1 (IN_REVIEW - Waiting for Reviewer!)
  {
    id: 'ver-002-v11',
    documentMasterId: 'doc-002',
    documentId: 'AMA-HR-POL-002',
    documentTitle: 'Employee Paid Leave & PTO Policy',
    versionNumber: '1.1',
    versionType: VersionType.MINOR,
    status: VersionStatus.IN_REVIEW,
    fileName: 'AMA-HR-POL-002_Leave-Policy_v1.1.pdf',
    fileSize: 45600,
    mimeType: 'application/pdf',
    storageKey: '/HR Documents/Policy/AMA-HR-POL-002/v1.1/AMA-HR-POL-002_Leave-Policy_v1.1.pdf',
    storagePath: '/HR Documents/Policy/AMA-HR-POL-002/v1.1/',
    fileUrl: '/api/storage/download?key=/HR Documents/Policy/AMA-HR-POL-002/v1.1/AMA-HR-POL-002_Leave-Policy_v1.1.pdf',
    contentHash: calculateSha256(LEAVE_V1_1_TEXT),
    rawContent: LEAVE_V1_1_TEXT,
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdByTitle: 'Lead HR Operations & Document Specialist',
    createdAt: '2026-08-25T11:00:00Z',
    effectiveFrom: '2026-09-01',
    reviewDueDate: '2027-09-01',
    previousVersionId: 'ver-002-v10',
    previousVersionNumber: '1.0',
    changeSummary: 'Increased PTO accrual from 18 to 22 days, added 2 Mental Health Days, expanded Parental Leave to 16 weeks.',
    locked: false,
    createdFromVersionId: 'ver-002-v10',
  },
  // Attendance SOP v1.0 (PUBLISHED)
  {
    id: 'ver-003-v10',
    documentMasterId: 'doc-003',
    documentId: 'AMA-HR-SOP-001',
    documentTitle: 'Attendance & Punctuality Standard Operating Procedure',
    versionNumber: '1.0',
    versionType: VersionType.INITIAL,
    status: VersionStatus.PUBLISHED,
    fileName: 'AMA-HR-SOP-001_Attendance-SOP_v1.0.pdf',
    fileSize: 31000,
    mimeType: 'application/pdf',
    storageKey: '/HR Documents/SOP/AMA-HR-SOP-001/v1.0/AMA-HR-SOP-001_Attendance-SOP_v1.0.pdf',
    storagePath: '/HR Documents/SOP/AMA-HR-SOP-001/v1.0/',
    fileUrl: '/api/storage/download?key=/HR Documents/SOP/AMA-HR-SOP-001/v1.0/AMA-HR-SOP-001_Attendance-SOP_v1.0.pdf',
    contentHash: calculateSha256(ATTENDANCE_SOP_TEXT),
    rawContent: ATTENDANCE_SOP_TEXT,
    createdById: 'usr-creator-01',
    createdByName: 'Sarah Jenkins',
    createdAt: '2026-07-15T08:00:00Z',
    reviewedById: 'usr-reviewer-01',
    reviewedByName: 'Marcus Vance',
    reviewedAt: '2026-07-15T10:00:00Z',
    publishedById: 'usr-reviewer-01',
    publishedByName: 'Marcus Vance',
    publishedAt: '2026-07-15T10:00:00Z',
    effectiveFrom: '2026-07-15',
    reviewDueDate: '2027-07-15',
    changeSummary: 'Initial SOP baseline publication.',
    locked: true,
  },
];

export const SEED_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: 'audit-001',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v10',
    versionNumber: '1.0',
    action: AuditAction.DOCUMENT_CREATED,
    performedById: 'usr-creator-01',
    performedByName: 'Sarah Jenkins',
    performedByRole: UserRole.CREATOR,
    performedAt: '2026-07-28T09:00:00Z',
    source: 'WEB_APP',
    reason: 'Initial creation of Document Master and Baseline Version 1.0',
    ipAddress: '10.0.4.12',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  {
    id: 'audit-002',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v10',
    versionNumber: '1.0',
    action: AuditAction.SUBMITTED_FOR_REVIEW,
    performedById: 'usr-creator-01',
    performedByName: 'Sarah Jenkins',
    performedByRole: UserRole.CREATOR,
    performedAt: '2026-07-28T09:05:00Z',
    source: 'WEB_APP',
    ipAddress: '10.0.4.12',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  {
    id: 'audit-003',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v10',
    versionNumber: '1.0',
    action: AuditAction.REVIEW_APPROVED,
    performedById: 'usr-reviewer-01',
    performedByName: 'Marcus Vance',
    performedByRole: UserRole.REVIEWER,
    performedAt: '2026-08-01T10:30:00Z',
    source: 'WEB_APP',
    reason: 'Reviewed and verified compliance standards.',
    ipAddress: '10.0.2.88',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'audit-004',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v10',
    versionNumber: '1.0',
    action: AuditAction.VERSION_PUBLISHED,
    performedById: 'usr-reviewer-01',
    performedByName: 'Marcus Vance',
    performedByRole: UserRole.REVIEWER,
    performedAt: '2026-08-01T10:30:01Z',
    source: 'WEB_APP',
    newValue: 'PUBLISHED',
    ipAddress: '10.0.2.88',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'audit-005',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v11',
    versionNumber: '1.1',
    action: AuditAction.VERSION_CREATED,
    performedById: 'usr-creator-01',
    performedByName: 'Sarah Jenkins',
    performedByRole: UserRole.CREATOR,
    performedAt: '2026-08-10T11:00:00Z',
    source: 'WEB_APP',
    ipAddress: '10.0.4.12',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  {
    id: 'audit-006',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v11',
    versionNumber: '1.1',
    action: AuditAction.REVIEW_REJECTED,
    performedById: 'usr-reviewer-01',
    performedByName: 'Marcus Vance',
    performedByRole: UserRole.REVIEWER,
    performedAt: '2026-08-12T14:15:00Z',
    source: 'WEB_APP',
    reason: 'Please update the eligibility section and clarify manager approval requirements. Also add cybersecurity guidelines for CrowdStrike & MFA.',
    oldValue: 'IN_REVIEW',
    newValue: 'REVISION_REQUIRED',
    ipAddress: '10.0.2.88',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'audit-007',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v20',
    versionNumber: '2.0',
    action: AuditAction.VERSION_CREATED,
    performedById: 'usr-creator-01',
    performedByName: 'Sarah Jenkins',
    performedByRole: UserRole.CREATOR,
    performedAt: '2026-08-18T13:00:00Z',
    source: 'WEB_APP',
    reason: 'Major revision incorporating reviewer governance feedback.',
    ipAddress: '10.0.4.12',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  },
  {
    id: 'audit-008',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v20',
    versionNumber: '2.0',
    action: AuditAction.REVIEW_APPROVED,
    performedById: 'usr-reviewer-01',
    performedByName: 'Marcus Vance',
    performedByRole: UserRole.REVIEWER,
    performedAt: '2026-08-20T14:30:00Z',
    source: 'WEB_APP',
    reason: 'All governance feedback addressed with pristine clarity.',
    ipAddress: '10.0.2.88',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  {
    id: 'audit-009',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v10',
    versionNumber: '1.0',
    action: AuditAction.VERSION_SUPERSEDED,
    performedById: 'usr-reviewer-01',
    performedByName: 'Marcus Vance',
    performedByRole: UserRole.REVIEWER,
    performedAt: '2026-08-20T14:30:01Z',
    source: 'GOVERNANCE_ENGINE',
    oldValue: 'PUBLISHED',
    newValue: 'SUPERSEDED',
    reason: 'Automatically superseded upon publication of v2.0',
    ipAddress: '127.0.0.1',
    userAgent: 'Node-Express-Governance-Daemon',
  },
  {
    id: 'audit-010',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v20',
    versionNumber: '2.0',
    action: AuditAction.VERSION_PUBLISHED,
    performedById: 'usr-reviewer-01',
    performedByName: 'Marcus Vance',
    performedByRole: UserRole.REVIEWER,
    performedAt: '2026-08-20T14:30:02Z',
    source: 'GOVERNANCE_ENGINE',
    oldValue: 'IN_REVIEW',
    newValue: 'PUBLISHED',
    reason: 'Published as live operational version.',
    ipAddress: '127.0.0.1',
    userAgent: 'Node-Express-Governance-Daemon',
  },
  {
    id: 'audit-011',
    documentMasterId: 'doc-001',
    documentId: 'AMA-HR-POL-001',
    documentVersionId: 'ver-001-v20',
    versionNumber: '2.0',
    action: AuditAction.NOTIFICATION_SENT,
    performedById: 'usr-reviewer-01',
    performedByName: 'Marcus Vance',
    performedByRole: UserRole.REVIEWER,
    performedAt: '2026-08-20T14:30:05Z',
    source: 'EMAIL_SERVICE',
    reason: 'Dispatched mandatory acknowledgement email notification to Parth (AM001 - parth@amaavigo.in).',
    ipAddress: '127.0.0.1',
    userAgent: 'Node-Express-Governance-Daemon',
  },
];
