/**
 * Performance Management (HR-PM-001 to HR-PM-009): the pure rules, shared by the server and the screens.
 * Everything here comes from the "HR Performance Management Automation" specification (Draft v1.0).
 * No database, no network: easy to test and impossible to "forget" in one place.
 */

// ------------------------------------------------------------------ constants taken from the specification

/** Section 1: proposed starting weights for individual contributors (a design recommendation, HR may change them). */
export const DEFAULT_WEIGHTS = { kra: 60, behaviour: 25, sop: 15 } as const;

export const PILLARS = [
  { key: 'kra', label: 'KRA / KPI', short: 'Results and delivery', help: 'What the employee is expected to deliver, measured through KRAs, KPIs, tasks, quality and outcomes.' },
  { key: 'behaviour', label: 'Behaviour', short: 'Competencies and standards', help: 'How the employee works, collaborates, communicates, shows ownership and follows professional expectations.' },
  { key: 'sop', label: 'SOP', short: 'Process and quality adherence', help: 'Whether the employee follows the approved processes, quality controls, documentation and escalation requirements of their role.' },
] as const;

export const EMPLOYEE_CATEGORIES = ['INDIVIDUAL_CONTRIBUTOR', 'MANAGER', 'LEADERSHIP', 'SALES', 'SPECIALIST'] as const;
export type EmployeeCategory = (typeof EMPLOYEE_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<EmployeeCategory, string> = {
  INDIVIDUAL_CONTRIBUTOR: 'Individual contributor', MANAGER: 'Manager', LEADERSHIP: 'Leadership', SALES: 'Sales', SPECIALIST: 'Specialist',
};

/** Section 4: recommended review frequency. */
export const REVIEW_TYPES = ['MONTHLY_CHECKIN', 'PROBATION', 'QUARTERLY', 'ANNUAL', 'IMPROVEMENT_PLAN'] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];
export const REVIEW_TYPE_INFO: Record<ReviewType, { label: string; frequency: string; purpose: string }> = {
  MONTHLY_CHECKIN: { label: 'Manager check-in', frequency: 'Monthly', purpose: 'Progress, roadblocks, feedback' },
  PROBATION: { label: 'Probation review', frequency: 'As per probation milestones', purpose: 'Role fit, learning, performance' },
  QUARTERLY: { label: 'Formal performance review', frequency: 'Quarterly', purpose: 'Structured KRA/KPI, behaviour and SOP assessment' },
  ANNUAL: { label: 'Annual summary', frequency: 'Annually', purpose: 'Consolidated performance and development record' },
  IMPROVEMENT_PLAN: { label: 'Improvement plan review', frequency: 'Based on approved plan', purpose: 'Progress against defined improvement objectives' },
};

/** Section 6: the recommended five-point rating scale. "Not observed" is separate and is never a 0 or a 3. */
export const RATING_SCALE = [
  { value: 1, label: 'Below Standard', definition: 'Repeated, evidenced gaps against defined expectations' },
  { value: 2, label: 'Developing', definition: 'Some standards met; improvement required' },
  { value: 3, label: 'Meets Standard', definition: 'Consistently meets expected role standards' },
  { value: 4, label: 'Exceeds Standard', definition: 'Frequently exceeds expectations with supporting evidence' },
  { value: 5, label: 'Exemplary', definition: 'Sustained exceptional contribution with clear evidence' },
] as const;
export const NOT_OBSERVED = 'NOT_OBSERVED';
export type Rating = 1 | 2 | 3 | 4 | 5;
export const isRating = (v: unknown): v is Rating => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;

export interface CompetencySeed { name: string; standard: string; evidence: string; category: CompetencyCategory }
export type CompetencyCategory = 'CORE' | 'MANAGER' | 'BUSINESS_DEVELOPMENT' | 'TECHNICAL' | 'CREATIVE';
export const COMPETENCY_CATEGORY_LABEL: Record<CompetencyCategory, string> = {
  CORE: 'Core (everyone)', MANAGER: 'Managers', BUSINESS_DEVELOPMENT: 'Business development', TECHNICAL: 'Technical roles', CREATIVE: 'Creative roles',
};

/** Section 6: core competency master. */
export const CORE_COMPETENCIES: CompetencySeed[] = [
  { category: 'CORE', name: 'Ownership & Accountability', standard: 'Accepts responsibility and closes commitments', evidence: 'Task follow-through, documented resolution' },
  { category: 'CORE', name: 'Communication', standard: 'Communicates clearly and in a timely manner', evidence: 'Status updates, handover records' },
  { category: 'CORE', name: 'Teamwork & Collaboration', standard: 'Cooperates respectfully across functions', evidence: 'Cross-team deliverables' },
  { category: 'CORE', name: 'Quality Orientation', standard: 'Checks accuracy and corrects defects', evidence: 'QA records, rework trends' },
  { category: 'CORE', name: 'Time & Priority Management', standard: 'Plans work and flags deadline risks', evidence: 'Milestones, early escalations' },
  { category: 'CORE', name: 'Learning & Adaptability', standard: 'Applies feedback and learns relevant skills', evidence: 'Training completion and applied improvements' },
  { category: 'CORE', name: 'Problem Solving', standard: 'Identifies issues and proposes workable solutions', evidence: 'Issue-resolution records' },
  { category: 'CORE', name: 'Professional Conduct', standard: 'Maintains respectful, ethical workplace behaviour', evidence: 'Documented, verified workplace observations' },
  { category: 'CORE', name: 'Client / Stakeholder Responsibility', standard: 'Handles commitments and information professionally', evidence: 'Client feedback with supporting context' },
  { category: 'CORE', name: 'Process Discipline', standard: 'Follows approved processes and documentation', evidence: 'SOP checklist, audit evidence' },
  { category: 'CORE', name: 'Information Security & Confidentiality', standard: 'Uses approved systems and protects information', evidence: 'Training, compliance evidence' },
  { category: 'CORE', name: 'Responsible AI & Technology Use', standard: 'Uses authorized AI tools and validates outputs', evidence: 'Workflow/documentation review' },
];

/** Section 6: role-specific additions. The specification names them but does not define a standard, so HR writes that. */
export const ROLE_SPECIFIC_COMPETENCIES: { category: Exclude<CompetencyCategory, 'CORE'>; names: string[] }[] = [
  { category: 'MANAGER', names: ['Coaching', 'Delegation', 'Performance Feedback', 'Fair Decision-Making', 'Workload Planning', 'Team Development'] },
  { category: 'BUSINESS_DEVELOPMENT', names: ['Commercial Professionalism', 'CRM Discipline', 'Proposal Accuracy', 'Client Handover'] },
  { category: 'TECHNICAL', names: ['Documentation', 'Code / Workflow Quality', 'Testing', 'Security', 'Change Control', 'Technical Collaboration'] },
  { category: 'CREATIVE', names: ['Brief Interpretation', 'Originality', 'Brand Consistency', 'Review Discipline', 'Feedback Responsiveness'] },
];

/** Section 7: recommended SOP coverage. These are proposed categories, not a claim that the documents already exist. */
export const DEPARTMENT_SOP_COVERAGE: { department: string; sops: string }[] = [
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

export const KPI_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY'] as const;
export type KpiFrequency = (typeof KPI_FREQUENCIES)[number];
export const EVIDENCE_SOURCES = ['TASK_SYSTEM', 'DASHBOARD', 'QA_REVIEW', 'CRM', 'REPORT', 'OTHER'] as const;
export const EVIDENCE_SOURCE_LABEL: Record<string, string> = { TASK_SYSTEM: 'Task system', DASHBOARD: 'Dashboard', QA_REVIEW: 'QA review', CRM: 'CRM records', REPORT: 'Report submission', OTHER: 'Other approved source' };

/** Section 12: exception handling. Every row is a situation the system must handle on purpose and never silently. */
export const EXCEPTION_TYPES = [
  { key: 'NO_KRA_KPI', label: 'Employee has no KRA/KPI', behaviour: 'Alert manager and HR; block final review' },
  { key: 'INVALID_WEIGHTS', label: 'KRA/KPI weights invalid', behaviour: 'Reject configuration' },
  { key: 'SOP_MISSING', label: 'Department SOP missing', behaviour: 'Create SOP assignment gap' },
  { key: 'SOP_NOT_ACKNOWLEDGED', label: 'Employee has not acknowledged SOP', behaviour: 'Reminder and manager escalation' },
  { key: 'MANAGER_CHANGED', label: 'Manager changes during cycle', behaviour: 'Apply effective-dated reassignment' },
  { key: 'DEPARTMENT_TRANSFER', label: 'Employee transfers department', behaviour: 'Preserve old plan; assign new applicable plan' },
  { key: 'EVIDENCE_UNAVAILABLE', label: 'KPI evidence unavailable', behaviour: 'Mark insufficient evidence' },
  { key: 'REVIEW_DISPUTED', label: 'Employee disputes review', behaviour: 'Record comments and route formal review' },
  { key: 'REVIEW_OVERDUE', label: 'Manager misses review deadline', behaviour: 'Reminder and escalation' },
  { key: 'AI_UNSUPPORTED', label: 'AI produces unsupported conclusion', behaviour: 'Exclude output and flag for review' },
  { key: 'SOP_VERSION_CHANGED', label: 'SOP version changes', behaviour: 'Assess whether retraining or acknowledgement is needed' },
  { key: 'EXTENDED_LEAVE', label: 'Employee on approved extended leave', behaviour: 'Apply approved review adjustment/deferral' },
  { key: 'DUPLICATE_EVENT', label: 'Duplicate workflow execution', behaviour: 'Idempotency control; prevent duplicate reviews' },
  { key: 'REVIEW_AMENDED', label: 'Review already finalized', behaviour: 'Require authorized amendment with audit trail' },
  { key: 'MISCONDUCT_REFERRAL', label: 'Serious misconduct allegation', behaviour: 'Separate confidential investigation process' },
  { key: 'CONFIGURATION_PENDING', label: 'No approved framework or missing manager', behaviour: 'Assessment stays in CONFIGURATION_PENDING; no silent default score or approver' },
  { key: 'TASK_EVENT_PROBLEM', label: 'Unassigned, deleted or disputed task event, or scope change', behaviour: 'Logged for the manager; it never silently changes a score' },
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number]['key'];
export const exceptionLabel = (k: string) => EXCEPTION_TYPES.find((e) => e.key === k)?.label || k;

/** Section 12: the n8n workflow inventory. Here each one runs inside the app. */
export const WORKFLOWS = [
  { id: 'PM-001', name: 'Framework Sync', trigger: 'Approved framework published', output: 'Active framework' },
  { id: 'PM-002', name: 'KRA/KPI Assignment', trigger: 'Joining, role change, new cycle', output: 'Employee performance plan' },
  { id: 'PM-003', name: 'Competency Assignment', trigger: 'Role mapping', output: 'Competency assessment template' },
  { id: 'PM-004', name: 'SOP Assignment', trigger: 'Joining, transfer, SOP publication', output: 'SOP training and acknowledgement' },
  { id: 'PM-005', name: 'Task Evidence Sync', trigger: 'Task event / schedule', output: 'KPI evidence' },
  { id: 'PM-006', name: 'Monthly Check-in', trigger: 'Schedule', output: 'Manager feedback record' },
  { id: 'PM-007', name: 'Formal Review', trigger: 'Review cycle', output: 'Assessment and approval' },
  { id: 'PM-008', name: 'Development Plan', trigger: 'Approved review', output: 'Training / improvement actions' },
  { id: 'PM-009', name: 'Dashboard & MIS', trigger: 'Event / schedule', output: 'Updated reports' },
  { id: 'PM-010', name: 'Exception & Audit Handler', trigger: 'Error / policy exception', output: 'Controlled resolution' },
] as const;

/** Section 14: what must be true before launch. The tests check each one. */
export const UAT_CHECKS = [
  'New employee receives the correct KRA/KPI, competencies and department SOPs.',
  'Different roles in the same department receive different SOP assignments where applicable.',
  'An updated SOP triggers only the required retraining or acknowledgement.',
  'An employee changing department retains historical performance records.',
  'Managers cannot approve their own reviews without authorized routing.',
  'Missing evidence does not automatically produce a negative score.',
  'KPI weights, competency weights and overall weights are validated.',
  'Employee disagreement is preserved and routed appropriately.',
  'Sensitive performance records are visible only to authorized users.',
  'Duplicate executions do not create duplicate assessments.',
  'AI failure does not prevent manual performance review.',
  'Finalized reviews remain auditable and cannot be silently overwritten.',
] as const;

/** The order the specification recommends for getting started. */
export const SETUP_SEQUENCE = [
  { key: 'competency', title: 'Approve the Competency Framework', plain: 'Decide how people are expected to behave at work, and how much each of the three parts counts.' },
  { key: 'sops', title: 'Define Department SOP Masters', plain: 'List the approved processes each department must follow, linked to your controlled documents.' },
  { key: 'templates', title: 'Define Role-Specific KRA/KPI Templates', plain: 'For each role, write what results are expected and how they are measured.' },
  { key: 'assignment', title: 'Assign to employees and collect acknowledgements', plain: 'Give every employee their plan; managers set the targets; employees acknowledge.' },
  { key: 'reviews', title: 'Build Performance Reviews', plain: 'Open a review cycle. Everyone gets a review to complete.' },
  { key: 'tasks', title: 'Connect Task Management', plain: 'Bring in task and deliverable evidence so reviews rest on facts.' },
  { key: 'ai', title: 'Add AI Insights', plain: 'Optional summaries and fairness checks. Humans always make the decision.' },
] as const;

// ------------------------------------------------------------------ validation

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const n = (v: unknown): number | null => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** Framework weights: three non-negative numbers that add up to exactly 100. */
export function validateWeights(kra: unknown, behaviour: unknown, sop: unknown): { ok: boolean; error?: string; weights?: { kra: number; behaviour: number; sop: number } } {
  const w = { kra: n(kra), behaviour: n(behaviour), sop: n(sop) };
  if (w.kra === null || w.behaviour === null || w.sop === null) return { ok: false, error: 'Give a weight for KRA/KPI, Behaviour and SOP.' };
  if (w.kra < 0 || w.behaviour < 0 || w.sop < 0) return { ok: false, error: 'Weights cannot be negative.' };
  const total = w.kra + w.behaviour + w.sop;
  if (!near(total, 100)) return { ok: false, error: `The three weights add up to ${round(total)}, not 100. Change them so they total exactly 100.` };
  return { ok: true, weights: { kra: w.kra, behaviour: w.behaviour, sop: w.sop } };
}

/** KPI weightage across one person's plan (or one template) must total 100. */
export function validateKpiWeights(items: { weightage: unknown }[]): { ok: boolean; total: number; error?: string } {
  if (items.length === 0) return { ok: false, total: 0, error: 'Add at least one KRA/KPI.' };
  let total = 0;
  for (const it of items) {
    const w = n(it.weightage);
    if (w === null || w <= 0) return { ok: false, total, error: 'Every KPI needs a weightage above 0.' };
    total += w;
  }
  return near(total, 100) ? { ok: true, total } : { ok: false, total, error: `The KPI weights add up to ${round(total)}, not 100.` };
}

export const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ------------------------------------------------------------------ scoring

/** Weighted average of the rated items. Items with no rating (insufficient evidence, not observed) are left out, never counted as 0. */
export function pillarScore(items: { value: number | null | undefined; weight: number }[]): { score: number | null; rated: number; skipped: number; coveredWeight: number; totalWeight: number } {
  let sum = 0; let w = 0; let rated = 0; let skipped = 0; let totalWeight = 0;
  for (const it of items) {
    const weight = it.weight > 0 ? it.weight : 0;
    totalWeight += weight;
    if (it.value !== null && it.value !== undefined && isRating(it.value)) { sum += it.value * weight; w += weight; rated++; } else skipped++;
  }
  return { score: w > 0 ? round(sum / w) : null, rated, skipped, coveredWeight: w, totalWeight };
}

export type SopResult = 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_APPLICABLE' | 'NOT_VERIFIED';
export const SOP_RESULTS: SopResult[] = ['COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE', 'NOT_VERIFIED'];
export const SOP_RESULT_LABEL: Record<SopResult, string> = { COMPLIANT: 'Compliant', NON_COMPLIANT: 'Non-compliant', NOT_APPLICABLE: 'Not applicable', NOT_VERIFIED: 'Not verified' };

/**
 * SOP compliance on the same 1-5 scale: only checkpoints that apply AND were verified count.
 * 100% compliant = 5, 0% = 1. Critical (security, legal, financial) failures are listed on their own and never averaged away.
 */
export function sopScore(rows: { result: SopResult; critical?: boolean; weight?: number }[]): {
  score: number | null; applicable: number; verified: number; compliant: number; nonCompliant: number; notVerified: number; criticalFailures: number;
} {
  let verified = 0; let compliant = 0; let nonCompliant = 0; let notVerified = 0; let applicable = 0; let criticalFailures = 0;
  let wCompliant = 0; let wVerified = 0;
  for (const r of rows) {
    if (r.result === 'NOT_APPLICABLE') continue;
    applicable++;
    const w = r.weight && r.weight > 0 ? r.weight : 1;
    if (r.result === 'NOT_VERIFIED') { notVerified++; continue; }
    verified++; wVerified += w;
    if (r.result === 'COMPLIANT') { compliant++; wCompliant += w; } else { nonCompliant++; if (r.critical) criticalFailures++; }
  }
  return { score: wVerified > 0 ? round(1 + 4 * (wCompliant / wVerified)) : null, applicable, verified, compliant, nonCompliant, notVerified, criticalFailures };
}

export interface Weights { kra: number; behaviour: number; sop: number }
export interface OverallResult {
  score: number | null;
  /** True when a part had nothing to score; the others were re-weighted and HR must accept the gap. */
  partial: boolean;
  missing: ('kra' | 'behaviour' | 'sop')[];
  parts: { kra: number | null; behaviour: number | null; sop: number | null };
  formula: string;
}

/** Section 9: Overall = K x 0.60 + B x 0.25 + S x 0.15 (with the approved weights). A part with no evidence is left out, not scored as zero. */
export function overallScore(parts: { kra: number | null; behaviour: number | null; sop: number | null }, weights: Weights): OverallResult {
  const keys = ['kra', 'behaviour', 'sop'] as const;
  const missing = keys.filter((k) => parts[k] === null || parts[k] === undefined);
  const present = keys.filter((k) => !missing.includes(k) && weights[k] > 0);
  if (present.length === 0) return { score: null, partial: missing.length > 0, missing: [...missing], parts, formula: 'Nothing could be scored yet.' };
  const totalW = present.reduce((s, k) => s + weights[k], 0);
  const score = round(present.reduce((s, k) => s + (parts[k] as number) * (weights[k] / totalW), 0));
  const name = { kra: 'K', behaviour: 'B', sop: 'S' } as const;
  const formula = `Overall = ${present.map((k) => `${name[k]} x ${round(weights[k] / totalW, 4)}`).join(' + ')}`;
  return { score, partial: missing.length > 0, missing: [...missing], parts, formula };
}

/** A suggestion only: the authorized reviewer chooses the final rating. */
export function ratingBand(score: number | null): { value: Rating; label: string } | null {
  if (score === null || !Number.isFinite(score)) return null;
  const v = Math.min(5, Math.max(1, Math.round(score))) as Rating;
  return { value: v, label: RATING_SCALE[v - 1].label };
}

// ------------------------------------------------------------------ the review workflow (section 9)

export const REVIEW_STATUSES = [
  'CONFIGURATION_PENDING', 'OPEN', 'SELF_ASSESSED', 'MANAGER_EVALUATED', 'DISCUSSED', 'HR_REVIEWED', 'APPROVED', 'PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED', 'DEFERRED',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STEPS: { status: ReviewStatus; label: string; who: string; plain: string }[] = [
  { status: 'OPEN', label: 'Review cycle opened', who: 'System', plain: 'The review has been created. The employee writes their self-assessment.' },
  { status: 'SELF_ASSESSED', label: 'Employee self-assessment', who: 'Employee', plain: 'The manager now looks at the evidence and rates performance and behaviour.' },
  { status: 'MANAGER_EVALUATED', label: 'Manager evaluates performance and behaviour', who: 'Reporting manager', plain: 'The manager and employee hold a feedback discussion.' },
  { status: 'DISCUSSED', label: 'Employee-manager feedback discussion', who: 'Reporting manager', plain: 'HR checks the review is complete and the ratings are consistent.' },
  { status: 'HR_REVIEWED', label: 'HR reviews completeness and rating consistency', who: 'HR', plain: 'An authorized approver calibrates and approves the final rating.' },
  { status: 'APPROVED', label: 'Authorized calibration / approval', who: 'Authorized approver', plain: 'HR publishes the final review to the employee.' },
  { status: 'PUBLISHED', label: 'Final review published to employee', who: 'HR', plain: 'The employee reads it and either acknowledges it or records disagreement.' },
  { status: 'ACKNOWLEDGED', label: 'Employee acknowledgement or recorded disagreement', who: 'Employee', plain: 'Next: a development plan and goals for the next cycle.' },
];

/** The statuses after which the review is final: content can only change through an authorized, audited amendment. */
export const FINAL_STATUSES: ReviewStatus[] = ['APPROVED', 'PUBLISHED', 'ACKNOWLEDGED', 'DISPUTED'];
export const isFinal = (s: string) => (FINAL_STATUSES as string[]).includes(s);

const FLOW: Record<string, ReviewStatus[]> = {
  OPEN: ['SELF_ASSESSED', 'DEFERRED'],
  SELF_ASSESSED: ['MANAGER_EVALUATED', 'DEFERRED'],
  MANAGER_EVALUATED: ['DISCUSSED', 'SELF_ASSESSED', 'DEFERRED'],
  DISCUSSED: ['HR_REVIEWED', 'SELF_ASSESSED', 'DEFERRED'],
  HR_REVIEWED: ['APPROVED', 'SELF_ASSESSED', 'DEFERRED'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['ACKNOWLEDGED', 'DISPUTED'],
  DISPUTED: ['PUBLISHED', 'ACKNOWLEDGED'],
  ACKNOWLEDGED: [],
  DEFERRED: ['OPEN', 'SELF_ASSESSED', 'MANAGER_EVALUATED', 'DISCUSSED', 'HR_REVIEWED'],
  CONFIGURATION_PENDING: ['OPEN'],
};
export const canMove = (from: string, to: string) => (FLOW[from] || []).includes(to as ReviewStatus);

export function stepIndex(status: string): number {
  const i = REVIEW_STEPS.findIndex((s) => s.status === status);
  return i >= 0 ? i : status === 'DISPUTED' ? 7 : -1;
}

// ------------------------------------------------------------------ review data shapes shared by server and screens

export interface KpiResult { targetId: string; kpiName: string; kraName: string; weightage: number; target: string; rating: number | null; insufficientEvidence: boolean; employeeNote: string; managerNote: string; evidenceIds: string[]; finalRating?: number | null; calibrationReason?: string }
export interface CompetencyResult { assessmentId: string; competencyId: string; name: string; weight: number; expectedBehaviour: string; selfRating: number | null; selfEvidence: string; managerRating: number | 'NOT_OBSERVED' | null; observedExamples: string; evidenceRefs: string; managerComment: string; finalRating: number | 'NOT_OBSERVED' | null; calibrationReason: string }

export function kraPillar(kpis: KpiResult[], useFinal = false) {
  return pillarScore(kpis.map((k) => ({ value: k.insufficientEvidence ? null : useFinal ? (k.finalRating ?? k.rating) : k.rating, weight: k.weightage })));
}
export function behaviourPillar(comps: CompetencyResult[], useFinal: boolean) {
  return pillarScore(comps.map((c) => {
    const r = useFinal ? c.finalRating ?? c.managerRating : c.managerRating;
    return { value: typeof r === 'number' ? r : null, weight: c.weight > 0 ? c.weight : 1 };
  }));
}

export interface CompletenessInput {
  selfDone: boolean; kpis: KpiResult[]; comps: CompetencyResult[]; sopRows: number; sopRequired: number; sopConfirmedNone: boolean;
  managerEvaluation: string; discussionHeld: boolean; hasKra: boolean;
}
/** What is still missing before the review can move on. Each message is plain English. */
export function completenessProblems(i: CompletenessInput, stage: 'MANAGER' | 'DISCUSSION' | 'HR'): string[] {
  const out: string[] = [];
  if (!i.hasKra) out.push('This employee has no approved KRA/KPI, so the final review is blocked. Ask the manager and HR to finish the plan first.');
  if (stage === 'MANAGER' || stage === 'HR') {
    const unrated = i.kpis.filter((k) => !k.insufficientEvidence && !isRating(k.rating));
    if (unrated.length) out.push(`${unrated.length} KPI${unrated.length > 1 ? 's' : ''} still need a rating, or "insufficient evidence" ticked: ${unrated.slice(0, 3).map((k) => k.kpiName).join(', ')}${unrated.length > 3 ? '...' : ''}.`);
    const unassessed = i.comps.filter((c) => c.managerRating === null || c.managerRating === undefined);
    if (unassessed.length) out.push(`${unassessed.length} competenc${unassessed.length > 1 ? 'ies' : 'y'} still need a rating (or "Not observed"): ${unassessed.slice(0, 3).map((c) => c.name).join(', ')}${unassessed.length > 3 ? '...' : ''}.`);
    if (i.sopRequired > 0 && i.sopRows === 0 && !i.sopConfirmedNone) out.push('Department SOP compliance has not been assessed. Fill in the SOP checklist, or mark checkpoints "Not verified".');
    if (!i.managerEvaluation.trim()) out.push('The manager evaluation comment is empty.');
  }
  if (stage === 'HR' && !i.discussionHeld) out.push('The feedback discussion with the employee has not been recorded.');
  if (stage === 'HR' && !i.selfDone) out.push('The employee self-assessment is missing (it can be waived with a reason).');
  return out;
}

export interface ConsistencyFlag { code: string; message: string; severity: 'INFO' | 'WARN' }
/** Section 9: HR checks "rating consistency". These are prompts for a human, not verdicts. */
export function consistencyFlags(kpis: KpiResult[], comps: CompetencyResult[], sop: { criticalFailures: number }): ConsistencyFlag[] {
  const out: ConsistencyFlag[] = [];
  const noEvidenceHigh = kpis.filter((k) => !k.insufficientEvidence && isRating(k.rating) && k.rating >= 4 && k.evidenceIds.length === 0);
  if (noEvidenceHigh.length) out.push({ code: 'HIGH_NO_EVIDENCE', severity: 'WARN', message: `${noEvidenceHigh.length} KPI${noEvidenceHigh.length > 1 ? 's are' : ' is'} rated 4 or 5 with no evidence attached: ${noEvidenceHigh.map((k) => k.kpiName).slice(0, 3).join(', ')}.` });
  const compHigh = comps.filter((c) => typeof c.managerRating === 'number' && (c.managerRating >= 4 || c.managerRating <= 1) && !c.observedExamples.trim() && !c.evidenceRefs.trim());
  if (compHigh.length) out.push({ code: 'COMP_NO_EXAMPLE', severity: 'WARN', message: `${compHigh.length} competenc${compHigh.length > 1 ? 'ies have' : 'y has'} a very high or very low rating without an observed example: ${compHigh.map((c) => c.name).slice(0, 3).join(', ')}.` });
  const all = [...kpis.map((k) => (k.insufficientEvidence ? null : k.rating)), ...comps.map((c) => (typeof c.managerRating === 'number' ? c.managerRating : null))].filter(isRating) as number[];
  if (all.length >= 5 && all.every((v) => v === all[0])) out.push({ code: 'ALL_SAME', severity: 'WARN', message: `Every rating is ${all[0]}. Check the ratings were considered one by one.` });
  const gap = comps.filter((c) => typeof c.selfRating === 'number' && typeof c.managerRating === 'number' && Math.abs(c.selfRating - c.managerRating) >= 2);
  if (gap.length) out.push({ code: 'SELF_GAP', severity: 'INFO', message: `The employee and manager differ by 2 or more points on: ${gap.map((c) => c.name).slice(0, 3).join(', ')}.` });
  const ins = kpis.filter((k) => k.insufficientEvidence);
  if (ins.length) out.push({ code: 'INSUFFICIENT', severity: 'INFO', message: `${ins.length} KPI${ins.length > 1 ? 's are' : ' is'} marked insufficient evidence. They are left out of the score, not counted as zero.` });
  if (sop.criticalFailures > 0) out.push({ code: 'CRITICAL_SOP', severity: 'WARN', message: `${sop.criticalFailures} critical SOP control${sop.criticalFailures > 1 ? 's were' : ' was'} not followed. This needs review on its own and is not averaged into the score.` });
  return out;
}

/** Section 11 "Fairness Checks": unusual patterns across many reviews. Aggregated; it flags, it never decides. */
export function fairnessFlags(rows: { managerUid: string; managerName: string; overall: number | null; insufficient: number; ratedWithoutEvidence: number }[]): { message: string; managerName: string }[] {
  const scored = rows.filter((r) => r.overall !== null) as (typeof rows[number] & { overall: number })[];
  const out: { message: string; managerName: string }[] = [];
  if (scored.length < 3) return out;
  const mean = scored.reduce((s, r) => s + r.overall, 0) / scored.length;
  const by = new Map<string, typeof scored>();
  for (const r of scored) by.set(r.managerUid, [...(by.get(r.managerUid) || []), r]);
  for (const [uid, list] of by) {
    if (!uid || list.length < 3) continue;
    const m = list.reduce((s, r) => s + r.overall, 0) / list.length;
    const name = list[0].managerName || uid;
    if (m - mean >= 0.8) out.push({ managerName: name, message: `${name} rates noticeably higher than the company average (${round(m)} against ${round(mean)}).` });
    if (mean - m >= 0.8) out.push({ managerName: name, message: `${name} rates noticeably lower than the company average (${round(m)} against ${round(mean)}).` });
    if (list.every((r) => r.overall === list[0].overall)) out.push({ managerName: name, message: `${name} gave the same overall score (${list[0].overall}) to all ${list.length} people.` });
  }
  for (const r of rows) {
    if (r.ratedWithoutEvidence >= 2) out.push({ managerName: r.managerName, message: `${r.managerName || 'A manager'} has a review with ${r.ratedWithoutEvidence} high ratings and no evidence.` });
  }
  return out;
}

// ------------------------------------------------------------------ AI guard (section 6 and 11)

const FORBIDDEN_INFERENCE = /\b(personalit\w*|introver\w*|extrover\w*|emotional(?:ly)?\s+(?:stab\w*|unstab\w*|fragile)|loyal\w*|disloyal\w*|motivat\w*|demotivat\w*|attitude problem|mental health|depress\w*|anxi\w*|health|illness|sick\w*|pregnan\w*|religio\w*|caste|gender|marital|married|ethnic\w*|race|racial|disabilit\w*|sexual\w*|political\w*|dating|affair|biometric|login (?:hours|duration)|private (?:chat|message)\w*)\b/i;
/** AI output must stay on documented work. Anything that infers personality, motivation, loyalty, health or protected traits is rejected. */
export function unsupportedInference(text: string): string | null {
  const m = FORBIDDEN_INFERENCE.exec(text || '');
  return m ? m[0] : null;
}

// ------------------------------------------------------------------ dates (India time, like the rest of the app)

export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const addDays = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
export const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
export const overlapDays = (aFrom: string, aTo: string, bFrom: string, bTo: string) => {
  const from = aFrom > bFrom ? aFrom : bFrom; const to = aTo < bTo ? aTo : bTo;
  return to < from ? 0 : daysBetween(from, to) + 1;
};
export const monthOf = (d: string) => d.slice(0, 7);

/** The group size below which leadership views will not show a breakdown, so no individual can be picked out. */
export const MIN_GROUP = 3;
