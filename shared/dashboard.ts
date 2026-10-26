/**
 * Home dashboard: which widgets a person gets, and what is in them.
 *
 * Pure TypeScript (no browser, Node or Firestore imports) so the server builds the dashboard with it and the
 * tests can check, for every kind of person, exactly which widgets they see. The server is what decides: a
 * widget is only emitted (with its data) when the person's own permissions or relationships allow it, so the
 * browser never receives anything it should hide.
 *
 * "Relationships" are facts that are not permissions: being someone's manager, covering for a manager,
 * having open tasks, or having a leave policy set up.
 */
import { hasAnyPerm, hasPerm } from './permissions.js';

export type WidgetGroup = 'attention' | 'me' | 'team';

export type WidgetId =
  | 'approvals'
  | 'review-queue'
  | 'my-revisions'
  | 'rereview-due'
  | 'acknowledgements'
  | 'my-tasks'
  | 'attendance'
  | 'leave-balance'
  | 'latest-payslip'
  | 'compliance'
  | 'hiring'
  | 'people-tasks'
  | 'payroll-run'
  | 'admin';

/** Where "open" takes the person. `module` matches the app's sidebar modules; `section` is that module's own section. */
export interface WidgetTarget {
  module:
    | 'document-version-control'
    | 'leave-management'
    | 'payroll'
    | 'people'
    | 'talent-acquisition-overview'
    | 'talent-acquisition-requisitions'
    | 'administration';
  section?: string;
  /** Document module only: which of its tabs to open. */
  docTab?: 'creator' | 'reviewer' | 'compliance' | 'employee';
}

export interface DashboardWidget<T = any> {
  id: WidgetId;
  title: string;
  group: WidgetGroup;
  /** Short line that explains why the person is seeing this. */
  reason: string;
  target?: WidgetTarget;
  /** Needs attention (shown with the accent colour). */
  urgent?: boolean;
  data: T;
}

// ------------------------------------------------------------------ input (raw facts the server collected)

export interface LeaveFacts {
  found: boolean;
  configured: boolean;
  canManage: boolean;
  canReport: boolean;
  isManager: boolean;
  isDelegate: boolean;
  /** Leave requests plus attendance corrections waiting for this person's decision. */
  approvals: number;
  balances: { typeId?: string; code: string; name: string; balance: number; pending: number; used: number; eligible?: boolean; isLop?: boolean; requiresBalance?: boolean }[];
  attendanceToday: { checkIn: string | null; checkOut: string | null };
}

export interface PayrollFacts {
  configured: boolean;
  canManage: boolean;
  canView: boolean;
  isManager: boolean;
  latestPayslip: { month: string; gross: number; deductions: number; net: number; status: string } | null;
  latestRun: { month: string; status: string } | null;
}

export interface LifecycleFacts {
  canManage: boolean;
  isManager: boolean;
  hasExit: boolean;
  openTasks: number;
  /** Open onboarding/exit tasks across the company; only collected for people who manage lifecycle. */
  companyOpenTasks: number | null;
}

export interface DocRef {
  documentId: string;
  title: string;
  versionNumber: string;
  date?: string;
}

export interface DocFacts {
  pendingAcks: DocRef[];
  pendingAckCount: number;
  reviewQueue: DocRef[];
  reviewQueueCount: number;
  myRevisions: DocRef[];
  reReviewDue: (DocRef & { overdue: boolean })[];
  compliance: { total: number; acknowledged: number; pending: number } | null;
}

export interface HiringFacts {
  /** Requisitions waiting on this person (assign / HR decision / founder decision / JD). */
  waiting: { status: string; label: string; count: number }[];
  open: number;
}

export interface DashboardInput {
  perms: string[];
  /** Today in IST, YYYY-MM-DD. */
  today: string;
  leave: LeaveFacts | null;
  payroll: PayrollFacts | null;
  lifecycle: LifecycleFacts | null;
  docs: DocFacts | null;
  hiring: HiringFacts | null;
  activeEmployees: number | null;
}

// ------------------------------------------------------------------ rules

export const HIRING_PERMS = ['req.view_all', 'req.assign', 'req.hr_decide', 'req.founder_decide', 'req.manage_jd', 'req.create'];
export const ADMIN_PERMS = ['users.manage', 'departments.manage', 'roles.manage'];
export const DOC_AUTHOR_PERMS = ['doc.create', 'doc.review', 'doc.publish'];

export const GROUP_ORDER: WidgetGroup[] = ['attention', 'me', 'team'];
export const GROUP_TITLE: Record<WidgetGroup, string> = {
  attention: 'Needs your attention',
  me: 'My work',
  team: 'Team and company',
};

const ORDER: WidgetId[] = [
  'approvals', 'review-queue', 'my-revisions', 'rereview-due', 'acknowledgements', 'my-tasks',
  'attendance', 'leave-balance', 'latest-payslip',
  'compliance', 'hiring', 'people-tasks', 'payroll-run', 'admin',
];

const clip = <T,>(list: T[], n: number): T[] => list.slice(0, n);

/**
 * Builds the dashboard for one person. Anything the person may not see is simply not in the result.
 * Callers pass only facts they were allowed to collect; this function checks again, so a widget never appears
 * because a caller passed too much.
 */
export function buildWidgets(input: DashboardInput): DashboardWidget[] {
  const { perms, leave, payroll, lifecycle, docs, hiring } = input;
  const out: DashboardWidget[] = [];
  const push = <T,>(w: DashboardWidget<T>) => { out.push(w); };

  // ---- Needs your attention -------------------------------------------------------------------------
  // Managers, people covering for a manager, and HR see what is waiting for their decision.
  if (leave?.found && leave.configured && (leave.isManager || leave.isDelegate || leave.canManage)) {
    const claims = !!(payroll && (payroll.isManager || payroll.canView));
    push({
      id: 'approvals', title: 'Waiting for your approval', group: 'attention',
      reason: leave.isDelegate && !leave.isManager ? 'You are covering for a manager' : 'People who report to you',
      target: { module: 'leave-management', section: 'approvals' }, urgent: leave.approvals > 0,
      data: { leave: leave.approvals, claims },
    });
  }

  if (docs && hasAnyPerm(perms, ['doc.review', 'doc.publish']) && docs.reviewQueueCount > 0) {
    push({
      id: 'review-queue', title: 'Documents to review', group: 'attention', reason: 'You can approve or reject documents',
      target: { module: 'document-version-control', docTab: 'reviewer' }, urgent: true,
      data: { count: docs.reviewQueueCount, items: clip(docs.reviewQueue, 5) },
    });
  }

  if (docs && hasPerm(perms, 'doc.create') && docs.myRevisions.length > 0) {
    push({
      id: 'my-revisions', title: 'Revisions requested on your documents', group: 'attention', reason: 'An approver sent these back to you',
      target: { module: 'document-version-control', docTab: 'creator' }, urgent: true,
      data: { count: docs.myRevisions.length, items: clip(docs.myRevisions, 5) },
    });
  }

  if (docs && hasAnyPerm(perms, DOC_AUTHOR_PERMS) && docs.reReviewDue.length > 0) {
    const overdue = docs.reReviewDue.filter((d) => d.overdue).length;
    push({
      id: 'rereview-due', title: 'Policies due for re-review', group: 'attention', reason: 'Review date is within 30 days',
      target: { module: 'document-version-control', docTab: hasPerm(perms, 'doc.create') ? 'creator' : 'reviewer' }, urgent: overdue > 0,
      data: { count: docs.reReviewDue.length, overdue, items: clip(docs.reReviewDue, 5) },
    });
  }

  if (docs && hasPerm(perms, 'doc.acknowledge') && docs.pendingAckCount > 0) {
    push({
      id: 'acknowledgements', title: 'Policies to acknowledge', group: 'attention', reason: 'Read and sign off these policies',
      target: { module: 'document-version-control', docTab: 'employee' }, urgent: true,
      data: { count: docs.pendingAckCount, items: clip(docs.pendingAcks, 5) },
    });
  }

  if (lifecycle && (lifecycle.openTasks > 0 || lifecycle.hasExit)) {
    push({
      id: 'my-tasks', title: lifecycle.hasExit && lifecycle.openTasks === 0 ? 'Your exit' : 'Your open tasks', group: 'attention',
      reason: lifecycle.hasExit ? 'Exit clearance in progress' : 'Assigned to you',
      target: { module: 'people', section: lifecycle.openTasks > 0 ? 'tasks' : 'exit' }, urgent: lifecycle.openTasks > 0,
      data: { openTasks: lifecycle.openTasks, hasExit: lifecycle.hasExit },
    });
  }

  // ---- My work (everyone, when the module is set up for them) -----------------------------------------
  if (leave?.found && leave.configured) {
    push({
      id: 'attendance', title: 'Today', group: 'me', reason: 'Your attendance today',
      target: { module: 'leave-management', section: 'attendance' },
      data: { checkIn: leave.attendanceToday.checkIn, checkOut: leave.attendanceToday.checkOut, today: input.today },
    });
    const balances = leave.balances
      .filter((b) => b.eligible !== false && !b.isLop && b.requiresBalance !== false)
      .slice(0, 4)
      .map((b) => ({ code: b.code, name: b.name, balance: b.balance, pending: b.pending, used: b.used }));
    push({
      id: 'leave-balance', title: 'My leave balance', group: 'me', reason: 'Apply from here',
      target: { module: 'leave-management', section: 'my' },
      data: { balances },
    });
  }

  if (payroll?.configured && payroll.latestPayslip) {
    push({
      id: 'latest-payslip', title: 'Latest payslip', group: 'me', reason: 'Visible only to you',
      target: { module: 'payroll', section: 'payslips' },
      data: payroll.latestPayslip,
    });
  }

  // ---- Team and company (only with the permission or relationship) ------------------------------------
  if (docs?.compliance && hasPerm(perms, 'compliance.view')) {
    const { total, acknowledged, pending } = docs.compliance;
    push({
      id: 'compliance', title: 'Policy compliance', group: 'team', reason: 'Acknowledgements across the company',
      target: { module: 'document-version-control', docTab: 'compliance' },
      data: { total, acknowledged, pending, rate: total > 0 ? Math.round((acknowledged / total) * 100) : null },
    });
  }

  if (hiring && hasAnyPerm(perms, HIRING_PERMS)) {
    const waiting = hiring.waiting.filter((w) => w.count > 0);
    if (waiting.length > 0 || hiring.open > 0) {
      push({
        id: 'hiring', title: 'Hiring', group: 'team', reason: 'Requisitions that involve you',
        target: { module: 'talent-acquisition-requisitions' }, urgent: waiting.length > 0,
        data: { waiting, open: hiring.open },
      });
    }
  }

  if (lifecycle?.canManage && lifecycle.companyOpenTasks !== null && hasPerm(perms, 'lifecycle.manage')) {
    push({
      id: 'people-tasks', title: 'Onboarding and exit tasks', group: 'team', reason: 'Open across the company',
      target: { module: 'people', section: 'onboarding' },
      data: { open: lifecycle.companyOpenTasks },
    });
  }

  if (payroll?.canView && payroll.configured && hasAnyPerm(perms, ['payroll.view', 'payroll.manage'])) {
    push({
      id: 'payroll-run', title: 'Payroll', group: 'team', reason: 'Latest payroll run',
      target: { module: 'payroll', section: 'run' }, urgent: !!payroll.latestRun && ['DRAFT', 'APPROVED'].includes(payroll.latestRun.status),
      data: { run: payroll.latestRun },
    });
  }

  if (hasAnyPerm(perms, ADMIN_PERMS)) {
    push({
      id: 'admin', title: 'Administration', group: 'team', reason: 'People, departments and roles',
      target: { module: 'administration' },
      data: { activeEmployees: input.activeEmployees, canUsers: hasPerm(perms, 'users.manage'), canDepartments: hasPerm(perms, 'departments.manage'), canRoles: hasPerm(perms, 'roles.manage') },
    });
  }

  return out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

/** Widgets grouped for display, keeping group and widget order. Empty groups are left out. */
export function groupWidgets<T extends { group: WidgetGroup }>(widgets: T[]): { group: WidgetGroup; title: string; widgets: T[] }[] {
  return GROUP_ORDER.map((g) => ({ group: g, title: GROUP_TITLE[g], widgets: widgets.filter((w) => w.group === g) })).filter((g) => g.widgets.length > 0);
}
