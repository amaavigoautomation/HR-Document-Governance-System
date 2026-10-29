/**
 * Performance Management: shared types, masters and defaults (HR-PM-001 to HR-PM-009).
 * Pure TypeScript with no browser or Node imports, so the browser, the API and the tests can all use it.
 *
 * Three assessment pillars are scored separately and then combined:
 *   KRA / KPI  (results)     Behaviour (competencies and standards)     SOP (process and quality adherence)
 * The weights below are design recommendations, not approved policy: HR approves a framework before it is used.
 */

// ------------------------------------------------------------------ masters

export type EmployeeCategory = 'INDIVIDUAL' | 'MANAGER' | 'LEADERSHIP' | 'SALES' | 'SPECIALIST';

export const EMPLOYEE_CATEGORIES: { key: EmployeeCategory; label: string }[] = [
  { key: 'INDIVIDUAL', label: 'Individual contributor' },
  { key: 'MANAGER', label: 'Manager' },
  { key: 'LEADERSHIP', label: 'Leadership' },
  { key: 'SALES', label: 'Sales / business development' },
  { key: 'SPECIALIST', label: 'Specialist' },
];

export interface Weights {
  kra: number;
  behaviour: number;
  sop: number;
}

/** Proposed starting weights for individual contributors. */
export const DEFAULT_WEIGHTS: Weights = { kra: 60, behaviour: 25, sop: 15 };

export type Pillar = keyof Weights;
export const PILLAR_LABEL: Record<Pillar, string> = { kra: 'KRA / KPI', behaviour: 'Behaviour', sop: 'SOP compliance' };

export type ReviewFrequency = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL';

export type ReviewType = 'MONTHLY_CHECKIN' | 'PROBATION' | 'QUARTERLY' | 'ANNUAL' | 'IMPROVEMENT';
export const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  MONTHLY_CHECKIN: 'Monthly check-in',
  PROBATION: 'Probation review',
  QUARTERLY: 'Quarterly performance review',
  ANNUAL: 'Annual summary',
  IMPROVEMENT: 'Improvement plan review',
};

/** Recommended operating frequencies (subject to HR and leadership approval). */
export const REVIEW_FREQUENCY_GUIDE: { review: string; frequency: string; purpose: string }[] = [
  { review: 'Manager check-in', frequency: 'Monthly', purpose: 'Progress, roadblocks, feedback' },
  { review: 'Probation review', frequency: 'As per probation milestones', purpose: 'Role fit, learning, performance' },
  { review: 'Formal performance review', frequency: 'Quarterly', purpose: 'Structured KRA/KPI, behaviour and SOP assessment' },
  { review: 'Annual summary', frequency: 'Annually', purpose: 'Consolidated performance and development record' },
  { review: 'Improvement plan review', frequency: 'Based on approved plan', purpose: 'Progress against defined improvement objectives' },
];

/** Five-point scale. "Not observed" is a separate answer and is never treated as 0 or 3. */
export const RATING_SCALE: { value: number; label: string; definition: string }[] = [
  { value: 1, label: 'Below Standard', definition: 'Repeated, evidenced gaps against defined expectations' },
  { value: 2, label: 'Developing', definition: 'Some standards met; improvement required' },
  { value: 3, label: 'Meets Standard', definition: 'Consistently meets expected role standards' },
  { value: 4, label: 'Exceeds Standard', definition: 'Frequently exceeds expectations with supporting evidence' },
  { value: 5, label: 'Exemplary', definition: 'Sustained exceptional contribution with clear evidence' },
];

export const NOT_OBSERVED_LABEL = 'Not observed / insufficient evidence';

export type CompetencyGroup = 'CORE' | 'MANAGER' | 'BUSINESS_DEVELOPMENT' | 'TECHNICAL' | 'CREATIVE';

export interface Competency {
  id: string;
  name: string;
  /** Expected professional standard (observable, work related behaviour only). */
  standard: string;
  /** Example evidence a manager or employee can point to. */
  evidence: string;
  group: CompetencyGroup;
  active: boolean;
}

export const CORE_COMPETENCIES: Competency[] = [
  { id: 'ownership', name: 'Ownership & Accountability', standard: 'Accepts responsibility and closes commitments', evidence: 'Task follow-through, documented resolution', group: 'CORE', active: true },
  { id: 'communication', name: 'Communication', standard: 'Communicates clearly and in a timely manner', evidence: 'Status updates, handover records', group: 'CORE', active: true },
  { id: 'teamwork', name: 'Teamwork & Collaboration', standard: 'Cooperates respectfully across functions', evidence: 'Cross-team deliverables', group: 'CORE', active: true },
  { id: 'quality', name: 'Quality Orientation', standard: 'Checks accuracy and corrects defects', evidence: 'QA records, rework trends', group: 'CORE', active: true },
  { id: 'time-priority', name: 'Time & Priority Management', standard: 'Plans work and flags deadline risks', evidence: 'Milestones, early escalations', group: 'CORE', active: true },
  { id: 'learning', name: 'Learning & Adaptability', standard: 'Applies feedback and learns relevant skills', evidence: 'Training completion and applied improvements', group: 'CORE', active: true },
  { id: 'problem-solving', name: 'Problem Solving', standard: 'Identifies issues and proposes workable solutions', evidence: 'Issue-resolution records', group: 'CORE', active: true },
  { id: 'conduct', name: 'Professional Conduct', standard: 'Maintains respectful, ethical workplace behaviour', evidence: 'Documented, verified workplace observations', group: 'CORE', active: true },
  { id: 'stakeholder', name: 'Client / Stakeholder Responsibility', standard: 'Handles commitments and information professionally', evidence: 'Client feedback with supporting context', group: 'CORE', active: true },
  { id: 'process', name: 'Process Discipline', standard: 'Follows approved processes and documentation', evidence: 'SOP checklist, audit evidence', group: 'CORE', active: true },
  { id: 'infosec', name: 'Information Security & Confidentiality', standard: 'Uses approved systems and protects information', evidence: 'Training, compliance evidence', group: 'CORE', active: true },
  { id: 'responsible-ai', name: 'Responsible AI & Technology Use', standard: 'Uses authorized AI tools and validates outputs', evidence: 'Workflow/documentation review', group: 'CORE', active: true },
];

/** Role-specific additions from the framework (assigned per role family). */
export const ROLE_COMPETENCIES: Competency[] = [
  { id: 'mgr-people', name: 'People Leadership', standard: 'Coaching, delegation, performance feedback, fair decision-making, workload planning and team development', evidence: 'Check-in records, delegation and development plans', group: 'MANAGER', active: true },
  { id: 'bd-commercial', name: 'Commercial Discipline', standard: 'Commercial professionalism, CRM discipline, proposal accuracy and client handover', evidence: 'CRM records, proposals, handover notes', group: 'BUSINESS_DEVELOPMENT', active: true },
  { id: 'tech-quality', name: 'Technical Quality & Change Control', standard: 'Documentation, code/workflow quality, testing, security, change control and technical collaboration', evidence: 'Reviews, test records, change logs', group: 'TECHNICAL', active: true },
  { id: 'creative-craft', name: 'Creative Craft & Brand Consistency', standard: 'Brief interpretation, originality, brand consistency, review discipline and feedback responsiveness', evidence: 'Brief-to-asset checks, revision records', group: 'CREATIVE', active: true },
];

export const STARTER_COMPETENCIES: Competency[] = [...CORE_COMPETENCIES, ...ROLE_COMPETENCIES];

/** A job family: which people it covers and what applies to them. Resolved by department and designation. */
export interface RoleFamily {
  id: string;
  name: string;
  departmentName: string;
  /** Lower-case fragments of a designation (title). Empty means the whole department. */
  designationKeywords: string[];
  category: EmployeeCategory;
  /** Competencies on top of the core set. */
  competencyIds: string[];
  active: boolean;
}

/** Proposed SOP categories per department. Suggestions only: not a claim that these documents exist or are approved. */
export const SOP_COVERAGE: { department: string; sops: string }[] = [
  { department: 'Growth / Performance Marketing', sops: 'Campaign brief, setup, budget approval, tracking, optimisation, reporting, client escalation' },
  { department: 'SEO / AEO / GEO', sops: 'Audit, keyword/entity research, content brief, technical implementation, QA, reporting' },
  { department: 'Content & Social Media', sops: 'Content planning, approvals, scheduling, publishing, community response, reporting' },
  { department: 'Branding & Creative', sops: 'Brief intake, design development, brand checks, revisions, approvals, asset handover' },
  { department: 'AI Automation', sops: 'Requirements, workflow design, credentials, testing, deployment, monitoring, change control' },
  { department: 'Website & Software Development', sops: 'Requirements, version control, development, QA, deployment, backup, incident management' },
  { department: 'Business Development', sops: 'Lead capture, qualification, CRM updates, proposals, approvals, follow-ups, handover' },
  { department: 'HR & Administration', sops: 'Recruitment, onboarding, documentation, attendance, leave, assets, employee records' },
  { department: 'Finance & Accounts', sops: 'Billing, receivables, expenses, approval, reconciliation, statutory coordination' },
  { department: 'Music / Digital Distribution', sops: 'Metadata intake, artwork validation, release preparation, platform submission, reporting' },
];

// ------------------------------------------------------------------ framework and cycles

export type FrameworkStatus = 'DRAFT' | 'APPROVED' | 'RETIRED';

/** Performance_Framework_Master. Effective dated; only APPROVED frameworks are used. */
export interface Framework {
  id: string;
  companyId: string;
  name: string;
  employeeCategory: EmployeeCategory;
  /** Empty: applies to every role family of the category. A role family id makes it specific to that family. */
  roleFamilyId: string;
  weights: Weights;
  reviewFrequency: ReviewFrequency;
  effectiveFrom: string;
  effectiveTo: string;
  status: FrameworkStatus;
  version: number;
  approvedBy: string;
  approvedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CycleScope {
  /** Empty and no department: every active person. */
  uids: string[];
  departmentName: string;
}

/** Performance_Cycle. */
export interface Cycle {
  id: string;
  companyId: string;
  name: string;
  reviewType: ReviewType;
  periodStart: string;
  periodEnd: string;
  selfDeadline: string;
  managerDeadline: string;
  hrDeadline: string;
  scope: CycleScope;
  status: 'DRAFT' | 'OPEN' | 'LOCKED';
  openedAt: string;
  lockedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ SOP library

export type Criticality = 'NORMAL' | 'CRITICAL';

export interface SopCheckpoint {
  id: string;
  text: string;
  /** Security, legal or financial controls: a miss is reported as an exception, never averaged away. */
  critical: boolean;
}

/** Department_SOP_Master + Role_SOP_Map. Links to a controlled document in Document Governance. */
export interface Sop {
  id: string;
  companyId: string;
  title: string;
  departmentName: string;
  /** Empty: the whole department. */
  roleFamilyIds: string[];
  /** Controlled document in Document Governance (documents/{id}); empty for an SOP kept only here. */
  documentMasterId: string;
  documentId: string;
  versionId: string;
  versionNumber: string;
  processOwnerUid: string;
  processOwnerName: string;
  criticality: Criticality;
  mandatory: boolean;
  trainingRequired: boolean;
  acknowledgementRequired: boolean;
  checkpoints: SopCheckpoint[];
  effectiveFrom: string;
  reviewDate: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AckStatus = 'PENDING' | 'ACKNOWLEDGED';

/** Employee_SOP_Assignment. Reading, acknowledging and following an SOP are tracked as three separate things. */
export interface SopAssignment {
  id: string;
  companyId: string;
  uid: string;
  sopId: string;
  sopTitle: string;
  versionId: string;
  versionNumber: string;
  assignedAt: string;
  ackStatus: AckStatus;
  ackAt: string;
  /** True when a major revision means the person has to acknowledge again. */
  retrainRequired: boolean;
  trainingStatus: 'NOT_REQUIRED' | 'PENDING' | 'DONE';
  verifiedBy: string;
  verifiedAt: string;
  status: 'ACTIVE' | 'SUPERSEDED';
  reminderAt: string;
  createdAt: string;
  updatedAt: string;
}

export type SopResult = 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_APPLICABLE' | 'NOT_VERIFIED';
export const SOP_RESULT_LABEL: Record<SopResult, string> = {
  COMPLIANT: 'Compliant', NON_COMPLIANT: 'Non-compliant', NOT_APPLICABLE: 'Not applicable', NOT_VERIFIED: 'Not verified',
};

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SopCheck {
  sopId: string;
  sopTitle: string;
  versionNumber: string;
  checkpointId: string;
  checkpoint: string;
  critical: boolean;
  result: SopResult;
  evidence: string;
  severity: Severity;
  correctiveAction: string;
  reviewerUid: string;
  reviewedAt: string;
}

// ------------------------------------------------------------------ KRA / KPI

export type KpiFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';

export interface KpiDef {
  id: string;
  /** Short unique code used by task tools pushing evidence (for example CAMP-01). */
  code: string;
  description: string;
  /** How performance will be evaluated. */
  measurement: string;
  /** Approved measurable expectation. Left blank in templates: numbers are agreed per role, client, budget and period. */
  target: string;
  weightage: number;
  frequency: KpiFrequency;
  /** Task system, dashboard, QA review or another approved source. */
  evidenceSource: string;
  sopRef: string;
}

export interface KraDef {
  id: string;
  name: string;
  description: string;
  kpis: KpiDef[];
}

/** Role_KRA_Template: the starting point for everyone in a role family. */
export interface KraTemplate {
  id: string;
  companyId: string;
  roleFamilyId: string;
  name: string;
  kras: KraDef[];
  version: number;
  status: 'DRAFT' | 'APPROVED';
  approvedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type PlanStatus = 'CONFIGURATION_PENDING' | 'DRAFT' | 'SUBMITTED' | 'PENDING_ACK' | 'ACTIVE' | 'SUPERSEDED';
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  CONFIGURATION_PENDING: 'Needs configuration', DRAFT: 'Manager customising', SUBMITTED: 'Waiting for HR approval',
  PENDING_ACK: 'Waiting for employee', ACTIVE: 'Active', SUPERSEDED: 'Superseded',
};

export interface PlanApproval {
  by: string;
  byUid: string;
  at: string;
  decision: 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'ACKNOWLEDGED';
  note: string;
}

/** Employee_Performance_Plan with its KRA assignments and KPI targets. Effective dated: changes never rewrite history. */
export interface Plan {
  id: string;
  companyId: string;
  uid: string;
  employeeName: string;
  department: string;
  designation: string;
  roleFamilyId: string;
  roleFamilyName: string;
  managerUid: string;
  frameworkId: string;
  frameworkVersion: number;
  templateId: string;
  templateVersion: number;
  kras: KraDef[];
  /** Behavioural competencies assigned for this role (copied, so later edits do not change past reviews). */
  competencies: { competencyId: string; name: string; standard: string; weight: number }[];
  competencyVersion: number;
  effectiveFrom: string;
  effectiveTo: string;
  status: PlanStatus;
  /** Why the plan could not be built (no template, no framework, no manager). */
  pendingReason: string;
  approvals: PlanApproval[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ evidence

export type EvidenceSource = 'MANUAL' | 'WEBHOOK' | 'TASK' | 'QA' | 'DASHBOARD';

/** KPI_Evidence. Task counts, login hours and activity levels never become ratings by themselves. */
export interface Evidence {
  id: string;
  companyId: string;
  uid: string;
  planId: string;
  kpiId: string;
  source: EvidenceSource;
  reference: string;
  description: string;
  value: number | null;
  occurredAt: string;
  externalId: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  verifiedBy: string;
  verifiedAt: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

// ------------------------------------------------------------------ reviews

export type ReviewStatus =
  | 'CONFIGURATION_PENDING'
  | 'DEFERRED'
  | 'SELF_PENDING'
  | 'MANAGER_PENDING'
  | 'DISCUSSION_PENDING'
  | 'HR_REVIEW'
  | 'APPROVAL_PENDING'
  | 'PUBLISHED'
  | 'ACKNOWLEDGED'
  | 'DISPUTED'
  | 'CLOSED';

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  CONFIGURATION_PENDING: 'Needs configuration',
  DEFERRED: 'Deferred (approved leave)',
  SELF_PENDING: 'Self-assessment due',
  MANAGER_PENDING: 'Manager review due',
  DISCUSSION_PENDING: 'Feedback discussion due',
  HR_REVIEW: 'HR review',
  APPROVAL_PENDING: 'Waiting for approval',
  PUBLISHED: 'Published to employee',
  ACKNOWLEDGED: 'Acknowledged',
  DISPUTED: 'Disputed',
  CLOSED: 'Closed',
};

export interface KpiAssessment {
  kpiId: string;
  selfNote: string;
  selfScore: number | null;
  managerNote: string;
  /** Manager's rating of achievement (1 to 5). Null with insufficientEvidence true: left out, never counted as 0. */
  managerScore: number | null;
  insufficientEvidence: boolean;
  /** Calibration override by HR or the approver (needs a reason in adjustments). */
  finalScore: number | null;
  evidenceIds: string[];
}

export interface CompetencyAssessment {
  competencyId: string;
  selfRating: number | null;
  selfNotObserved: boolean;
  selfExamples: string;
  managerRating: number | null;
  managerNotObserved: boolean;
  managerExamples: string;
  evidenceRefs: string;
  finalRating: number | null;
  finalNotObserved: boolean;
}

export interface Adjustment {
  target: string;
  from: number | null;
  to: number | null;
  reason: string;
  by: string;
  byUid: string;
  at: string;
}

export interface Scores {
  kra: number | null;
  behaviour: number | null;
  sop: number | null;
  overall: number | null;
  band: string;
  /** Pillars with nothing scorable. The overall score is then built from the rest and flagged. */
  missing: Pillar[];
  partial: boolean;
  /** Critical SOP findings: shown separately and must be acknowledged by HR before publishing. */
  criticalFindings: { sopTitle: string; checkpoint: string; severity: Severity }[];
}

export interface ReviewHistory {
  at: string;
  by: string;
  byUid: string;
  action: string;
  note: string;
}

/** Performance_Review. The id is built from company, cycle and person, so a repeated run never creates a second review. */
export interface Review {
  id: string;
  companyId: string;
  cycleId: string;
  cycleName: string;
  reviewType: ReviewType;
  periodStart: string;
  periodEnd: string;
  uid: string;
  employeeName: string;
  department: string;
  designation: string;
  managerUid: string;
  managerName: string;
  planId: string;
  planVersion: number;
  frameworkId: string;
  frameworkVersion: number;
  competencyVersion: number;
  weights: Weights;
  kras: KraDef[];
  competencies: { competencyId: string; name: string; standard: string; weight: number }[];
  sopVersions: { sopId: string; title: string; versionNumber: string; criticality: Criticality }[];
  status: ReviewStatus;
  pendingReason: string;
  kpiAssessments: KpiAssessment[];
  competencyAssessments: CompetencyAssessment[];
  sopChecks: SopCheck[];
  achievements: string;
  strengths: string;
  improvements: string;
  trainingNeeds: string;
  managerComments: string;
  selfSubmittedAt: string;
  managerSubmittedAt: string;
  discussionAt: string;
  hrNote: string;
  hrCriticalAcknowledged: boolean;
  hrPartialAcknowledged: boolean;
  hrReviewedBy: string;
  hrReviewedAt: string;
  adjustments: Adjustment[];
  approvedBy: string;
  approvedByUid: string;
  approvedAt: string;
  finalComments: string;
  scores: Scores;
  employeeResponse: { decision: '' | 'ACKNOWLEDGED' | 'DISAGREED'; comment: string; at: string };
  dispute: { status: '' | 'OPEN' | 'UPHELD' | 'AMENDED'; resolution: string; resolvedBy: string; resolvedAt: string };
  history: ReviewHistory[];
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ check-ins, development, governance

export interface Checkin {
  id: string;
  companyId: string;
  uid: string;
  employeeName: string;
  managerUid: string;
  month: string;
  progress: string;
  roadblocks: string;
  feedback: string;
  employeeNote: string;
  status: 'PENDING' | 'DONE';
  doneAt: string;
  createdAt: string;
  updatedAt: string;
}

export type DevOutcome = 'DEVELOPMENT' | 'IMPROVEMENT' | 'RECOGNITION';
export const DEV_OUTCOME_LABEL: Record<DevOutcome, string> = {
  DEVELOPMENT: 'Development opportunity',
  IMPROVEMENT: 'Performance improvement required',
  RECOGNITION: 'Strong performance',
};
export const DEV_OUTCOME_PROCESS: Record<DevOutcome, string> = {
  DEVELOPMENT: 'Skill training, mentoring, certification or stretch assignment',
  IMPROVEMENT: 'Structured improvement plan with clear targets, reasonable support and review dates',
  RECOGNITION: 'Recognition, expanded responsibilities or consideration for future opportunities',
};

export interface DevAction {
  id: string;
  text: string;
  dueDate: string;
  done: boolean;
}

/** Employee_Development_Plan / improvement plan. */
export interface DevPlan {
  id: string;
  companyId: string;
  uid: string;
  employeeName: string;
  reviewId: string;
  outcome: DevOutcome;
  performanceGap: string;
  supportingEvidence: string;
  expectedStandard: string;
  actions: DevAction[];
  supportProvided: string;
  startDate: string;
  reviewDate: string;
  managerUid: string;
  hrReviewer: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  outcomeNote: string;
  createdAt: string;
  updatedAt: string;
}

export type ExceptionCategory =
  | 'NO_KRA' | 'NO_MANAGER' | 'NO_FRAMEWORK' | 'NO_ROLE_FAMILY' | 'SOP_GAP' | 'SOP_NOT_ACKNOWLEDGED' | 'SOP_VERSION_CHANGED'
  | 'MANAGER_CHANGED' | 'DEPARTMENT_TRANSFER' | 'EVIDENCE_MISSING' | 'EVIDENCE_UNMAPPED' | 'REVIEW_DISPUTED' | 'REVIEW_OVERDUE'
  | 'AI_UNSUPPORTED' | 'EXTENDED_LEAVE' | 'DUPLICATE_EXECUTION' | 'REVIEW_AMENDED' | 'CONFIDENTIAL_REFERRAL' | 'FAIRNESS' | 'MOOD_LOW';

export const EXCEPTION_LABEL: Record<ExceptionCategory, string> = {
  NO_KRA: 'No KRA/KPI', NO_MANAGER: 'No reporting manager', NO_FRAMEWORK: 'No approved framework', NO_ROLE_FAMILY: 'No role family',
  SOP_GAP: 'SOP assignment gap', SOP_NOT_ACKNOWLEDGED: 'SOP not acknowledged', SOP_VERSION_CHANGED: 'SOP version changed',
  MANAGER_CHANGED: 'Manager changed', DEPARTMENT_TRANSFER: 'Department transfer', EVIDENCE_MISSING: 'Evidence unavailable',
  EVIDENCE_UNMAPPED: 'Unmapped task evidence', REVIEW_DISPUTED: 'Review disputed', REVIEW_OVERDUE: 'Review overdue',
  AI_UNSUPPORTED: 'AI output excluded', EXTENDED_LEAVE: 'Extended approved leave', DUPLICATE_EXECUTION: 'Duplicate event ignored',
  REVIEW_AMENDED: 'Finalised review amended', CONFIDENTIAL_REFERRAL: 'Referred to confidential process', FAIRNESS: 'Fairness check', MOOD_LOW: 'Low team mood',
};

export interface PerfException {
  id: string;
  companyId: string;
  category: ExceptionCategory;
  severity: Severity;
  message: string;
  uid: string;
  refId: string;
  owner: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt: string;
  resolvedBy: string;
  resolution: string;
}

export interface PerfSettings {
  companyId: string;
  competencies: Competency[];
  roleFamilies: RoleFamily[];
  competencyVersion: number;
  /** Secret that lets a company's task tool push KPI evidence (see /api/perf/evidence-hook). */
  webhookKey: string;
  updatedAt: string;
  updatedBy: string;
}

export const emptyPerfSettings = (companyId: string): PerfSettings => ({
  companyId, competencies: [], roleFamilies: [], competencyVersion: 0, webhookKey: '', updatedAt: '', updatedBy: '',
});
