/**
 * Employee lifecycle: pure rules shared by the browser and the API (no I/O).
 *  - onboarding task templates and due dates
 *  - exit: notice period arithmetic and no-dues clearance
 *  - letters: merge-field rendering
 *  - org chart: reporting tree with cycle protection
 */

// ------------------------------------------------------------------ dates

const DAY = 86_400_000;
export const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Whole days from a to b (b - a). */
export const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

// ------------------------------------------------------------------ onboarding

export type TaskAssignee = 'EMPLOYEE' | 'HR' | 'MANAGER' | 'IT';
export type TaskKind = 'DOCUMENT' | 'ASSET' | 'BANK' | 'POLICY' | 'GENERAL';

export interface TaskTemplate {
  id: string;
  title: string;
  kind: TaskKind;
  assignee: TaskAssignee;
  /** Days after the joining date the task is due (negative = before joining). */
  dueOffsetDays: number;
  description: string;
}

export const DEFAULT_TASK_TEMPLATES: TaskTemplate[] = [
  { id: 'docs', title: 'Submit joining documents', kind: 'DOCUMENT', assignee: 'EMPLOYEE', dueOffsetDays: 0, description: 'ID proof, address proof, education and previous employment documents.' },
  { id: 'bank', title: 'Share bank details for salary', kind: 'BANK', assignee: 'EMPLOYEE', dueOffsetDays: 3, description: 'Account holder name, account number, IFSC and bank name.' },
  { id: 'policy', title: 'Read and acknowledge company policies', kind: 'POLICY', assignee: 'EMPLOYEE', dueOffsetDays: 7, description: 'Open Policies and acknowledge each published policy.' },
  { id: 'laptop', title: 'Issue laptop and accessories', kind: 'ASSET', assignee: 'IT', dueOffsetDays: 0, description: 'Record the asset tag in the note when done.' },
  { id: 'accounts', title: 'Create email and system accounts', kind: 'GENERAL', assignee: 'IT', dueOffsetDays: -1, description: '' },
  { id: 'welcome', title: 'Welcome meeting and team introduction', kind: 'GENERAL', assignee: 'MANAGER', dueOffsetDays: 1, description: '' },
  { id: 'profile', title: 'Complete employee record (manager, joining date, salary)', kind: 'GENERAL', assignee: 'HR', dueOffsetDays: 0, description: 'Set the reporting manager and joining date in Leave & attendance, and the salary in Payroll.' },
];

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  DOCUMENT: 'Documents', ASSET: 'Laptop / assets', BANK: 'Bank details', POLICY: 'Policy acknowledgement', GENERAL: 'General',
};
export const ASSIGNEE_LABEL: Record<TaskAssignee, string> = { EMPLOYEE: 'New joiner', HR: 'HR', MANAGER: 'Reporting manager', IT: 'IT / assets' };

export function dueDateFor(joinDate: string, offset: number): string {
  return isDate(joinDate) ? addDaysIso(joinDate, offset) : '';
}

// ------------------------------------------------------------------ exit

export interface ClearanceDept {
  id: string;
  label: string;
  /** Person who clears this department. Empty: only HR can clear it. 'MANAGER' means the employee's reporting manager. */
  ownerUid: string;
}

export const DEFAULT_CLEARANCE: ClearanceDept[] = [
  { id: 'manager', label: 'Reporting manager (handover)', ownerUid: 'MANAGER' },
  { id: 'it', label: 'IT (laptop, accounts, access)', ownerUid: '' },
  { id: 'admin', label: 'Admin (ID card, desk, keys)', ownerUid: '' },
  { id: 'finance', label: 'Finance (advances, loans, claims)', ownerUid: '' },
  { id: 'hr', label: 'HR (documents, exit interview)', ownerUid: '' },
];

export type ClearanceStatus = 'PENDING' | 'CLEARED' | 'DUES' | 'WAIVED';

export interface ClearanceItem {
  deptId: string;
  label: string;
  ownerUid: string;
  status: ClearanceStatus;
  /** Money the employee owes this department (only with DUES). */
  dues: number;
  note: string;
  by?: string;
  at?: string;
}

/** Notice served is the days between giving notice and the last working day, counted inclusive of the last day. */
export function noticeServed(resignationDate: string, lastWorkingDay: string): number {
  if (!isDate(resignationDate) || !isDate(lastWorkingDay)) return 0;
  return Math.max(0, diffDays(resignationDate, lastWorkingDay) + 1);
}

export function noticeShortfall(requiredDays: number, served: number): number {
  return Math.max(0, Math.round(requiredDays - served));
}

/** The earliest last working day that serves the full notice. */
export function earliestLastDay(resignationDate: string, requiredDays: number): string {
  return isDate(resignationDate) ? addDaysIso(resignationDate, Math.max(0, requiredDays - 1)) : '';
}

export function clearanceTotals(items: Pick<ClearanceItem, 'status' | 'dues'>[]) {
  const pending = items.filter((i) => i.status === 'PENDING').length;
  const dues = Math.round(items.filter((i) => i.status === 'DUES').reduce((n, i) => n + (i.dues || 0), 0) * 100) / 100;
  const withDues = items.filter((i) => i.status === 'DUES').length;
  return { pending, dues, withDues, total: items.length, complete: pending === 0 };
}

export type ExitStatus = 'SUBMITTED' | 'MANAGER_APPROVED' | 'APPROVED' | 'COMPLETED' | 'REJECTED' | 'WITHDRAWN';
export const EXIT_STATUS_LABEL: Record<ExitStatus, string> = {
  SUBMITTED: 'Waiting for manager', MANAGER_APPROVED: 'Waiting for HR', APPROVED: 'In notice period', COMPLETED: 'Exit completed', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn',
};
export const EXIT_REASONS = ['RESIGNATION', 'TERMINATION', 'END_OF_CONTRACT', 'RETIREMENT', 'ABSCONDING'] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

// ------------------------------------------------------------------ letters

export interface LetterTemplate {
  id: string;
  kind: 'OFFER' | 'APPOINTMENT' | 'EXPERIENCE' | 'RELIEVING' | 'CUSTOM';
  name: string;
  body: string;
}

export const MERGE_FIELDS: { key: string; label: string; source: 'auto' | 'manual' }[] = [
  { key: 'date', label: 'Today (letter date)', source: 'auto' },
  { key: 'company_name', label: 'Company legal name', source: 'auto' },
  { key: 'company_address', label: 'Company address', source: 'auto' },
  { key: 'employee_name', label: 'Employee name', source: 'auto' },
  { key: 'employee_id', label: 'Employee ID', source: 'auto' },
  { key: 'designation', label: 'Designation', source: 'auto' },
  { key: 'department', label: 'Department', source: 'auto' },
  { key: 'manager_name', label: 'Reporting manager', source: 'auto' },
  { key: 'join_date', label: 'Date of joining', source: 'auto' },
  { key: 'last_working_day', label: 'Last working day', source: 'auto' },
  { key: 'resignation_date', label: 'Resignation date', source: 'auto' },
  { key: 'tenure', label: 'Length of service', source: 'auto' },
  { key: 'ctc', label: 'Annual CTC (type it in)', source: 'manual' },
  { key: 'offer_valid_till', label: 'Offer valid till (type it in)', source: 'manual' },
  { key: 'probation', label: 'Probation period (type it in)', source: 'manual' },
  { key: 'signatory_name', label: 'Signatory name (type it in)', source: 'manual' },
  { key: 'signatory_title', label: 'Signatory title (type it in)', source: 'manual' },
];

const SIGN = '\n\nYours sincerely,\n\n{{signatory_name}}\n{{signatory_title}}\n{{company_name}}';

export const DEFAULT_LETTERS: LetterTemplate[] = [
  {
    id: 'offer', kind: 'OFFER', name: 'Offer letter',
    body: `{{company_name}}\n{{company_address}}\n\nDate: {{date}}\n\nDear {{employee_name}},\n\nWe are pleased to offer you the position of {{designation}} in the {{department}} department at {{company_name}}, with an annual cost to company of Rs. {{ctc}}.\n\nYour proposed date of joining is {{join_date}}, and you will report to {{manager_name}}. You will be on probation for {{probation}}.\n\nThis offer is valid till {{offer_valid_till}}. Please sign and return a copy to confirm your acceptance. The offer is subject to satisfactory verification of your documents and references.\n\nWe look forward to welcoming you.${SIGN}`,
  },
  {
    id: 'appointment', kind: 'APPOINTMENT', name: 'Appointment letter',
    body: `{{company_name}}\n{{company_address}}\n\nDate: {{date}}\n\nDear {{employee_name}},\n\nWith reference to your acceptance of our offer, we are pleased to appoint you as {{designation}} in the {{department}} department with effect from {{join_date}}. Your employee ID is {{employee_id}}.\n\nYour annual cost to company is Rs. {{ctc}}. You will report to {{manager_name}} and be on probation for {{probation}}. Your employment is governed by the company's policies as updated from time to time, which you are required to read and acknowledge.\n\nPlease sign the duplicate copy of this letter as acceptance of these terms.${SIGN}`,
  },
  {
    id: 'experience', kind: 'EXPERIENCE', name: 'Experience letter',
    body: `{{company_name}}\n{{company_address}}\n\nDate: {{date}}\n\nTO WHOM IT MAY CONCERN\n\nThis is to certify that {{employee_name}} (Employee ID {{employee_id}}) worked with {{company_name}} as {{designation}} in the {{department}} department from {{join_date}} to {{last_working_day}}, a service of {{tenure}}.\n\nWe wish {{employee_name}} every success in the future.${SIGN}`,
  },
  {
    id: 'relieving', kind: 'RELIEVING', name: 'Relieving letter',
    body: `{{company_name}}\n{{company_address}}\n\nDate: {{date}}\n\nDear {{employee_name}},\n\nThis is with reference to your resignation dated {{resignation_date}}. We confirm that you stand relieved from your duties as {{designation}} at the close of business on {{last_working_day}}, after clearing all dues and handing over your responsibilities.\n\nWe thank you for your contribution and wish you well.${SIGN}`,
  },
];

/** Finds every {{field}} in a template. */
export function fieldsIn(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) out.add(m[1].toLowerCase());
  return [...out];
}

/** Fills {{fields}} from values. Fields without a value stay visible as {{field}} and are reported as missing. */
export function renderTemplate(body: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, raw: string) => {
    const key = raw.toLowerCase();
    const v = values[key];
    if (v === undefined || v === null || String(v).trim() === '') {
      missing.add(key);
      return whole.replace(/\s+/g, '');
    }
    return String(v);
  });
  return { text, missing: [...missing] };
}

export function prettyDate(iso: string): string {
  if (!isDate(iso)) return iso || '';
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function tenureText(from: string, to: string): string {
  if (!isDate(from) || !isDate(to) || to < from) return '';
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${addDaysIso(to, 1)}T00:00:00Z`); // the last day counts as worked
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y ? `${y} year${y === 1 ? '' : 's'}` : '', m ? `${m} month${m === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : 'less than a month';
}

// ------------------------------------------------------------------ org chart

export interface OrgPerson {
  uid: string;
  name: string;
  managerUid?: string;
  active?: boolean;
}

export interface OrgNode<T extends OrgPerson = OrgPerson> {
  person: T;
  children: OrgNode<T>[];
  /** everyone below this person, direct and indirect */
  total: number;
}

/**
 * Builds the reporting tree. People with no manager, an unknown manager, or who sit in a reporting loop become roots,
 * so nobody disappears from the chart.
 */
export function buildOrgTree<T extends OrgPerson>(people: T[]): OrgNode<T>[] {
  const byUid = new Map(people.map((p) => [p.uid, p]));
  const managerOf = (p: T) => (p.managerUid && p.managerUid !== p.uid && byUid.has(p.managerUid) ? p.managerUid : '');
  const cmp = (a: T, b: T) => a.name.localeCompare(b.name);
  const kids = new Map<string, T[]>();
  for (const p of people) {
    const m = managerOf(p);
    if (m) {
      if (!kids.has(m)) kids.set(m, []);
      kids.get(m)!.push(p);
    }
  }
  const visited = new Set<string>();
  const build = (p: T): OrgNode<T> => {
    visited.add(p.uid);
    const children = (kids.get(p.uid) || []).filter((c) => !visited.has(c.uid)).sort(cmp).map((c) => build(c));
    return { person: p, children, total: children.reduce((n, c) => n + 1 + c.total, 0) };
  };
  const out: OrgNode<T>[] = people.filter((p) => !managerOf(p)).sort(cmp).map((r) => build(r));
  // anyone left over sits in a reporting loop: start a new root there so nobody disappears
  for (const p of [...people].sort(cmp)) if (!visited.has(p.uid)) out.push(build(p));
  return out;
}

/** Would making `managerUid` the manager of `uid` create a loop? */
export function wouldCycle(people: OrgPerson[], uid: string, managerUid: string): boolean {
  if (!managerUid) return false;
  if (uid === managerUid) return true;
  const byUid = new Map(people.map((p) => [p.uid, p]));
  const seen = new Set<string>();
  let cur: string | undefined = managerUid;
  while (cur && !seen.has(cur)) {
    if (cur === uid) return true;
    seen.add(cur);
    cur = byUid.get(cur)?.managerUid;
  }
  return false;
}

export function flattenOrg<T extends OrgPerson>(nodes: OrgNode<T>[], depth = 0, out: { person: T; depth: number; total: number }[] = []) {
  for (const n of nodes) {
    out.push({ person: n.person, depth, total: n.total });
    flattenOrg(n.children, depth + 1, out);
  }
  return out;
}
