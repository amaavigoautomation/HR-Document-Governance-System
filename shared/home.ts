/**
 * Home page rules that the server, the browser and the tests all share. Pure TypeScript (no browser, Node or
 * Firestore imports).
 *
 * What lives here: who a celebration belongs to, which announcements a person may see, which quick links and
 * quick reports a person gets, and how a sign-in is counted. The server still decides what is sent; these
 * functions only make that decision testable.
 */
import { hasAnyPerm, hasPerm } from './permissions.js';
import type { WidgetTarget } from './dashboard.js';

// ------------------------------------------------------------------ dates (YYYY-MM-DD, India calendar)

const DAY_MS = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => fmt(new Date(utc(iso).getTime() + n * DAY_MS));
const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const isIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && fmt(utc(v)) === v;

// ------------------------------------------------------------------ celebrations

export type CelebrationKind = 'BIRTHDAY' | 'WORK' | 'MARRIAGE';
export type CelebrationRange = 'today' | 'week' | 'month';

export interface CelebrationPerson {
  uid: string;
  name: string;
  department?: string;
  title?: string;
  /** Date of birth, YYYY-MM-DD. Only the day and month are ever sent to the browser. */
  dob?: string;
  marriageDate?: string;
  joinDate?: string;
  /** false = this person asked not to be shown in any celebration. */
  showCelebrations?: boolean;
  /** Marriage anniversaries are only shown when this is exactly true (opt-in). */
  showMarriage?: boolean;
  active?: boolean;
}

export interface Celebrant {
  uid: string;
  name: string;
  department: string;
  title: string;
  kind: CelebrationKind;
  /** The day it falls on (this year, or next year when it has already passed). */
  date: string;
  /** Work anniversaries only: completed years. */
  years?: number;
}

/** The next time a day-and-month comes round on or after `from`. 29 Feb falls on 28 Feb in a year without one. */
export function nextOccurrence(monthDay: string, from: string): string {
  const [m, d] = monthDay.split('-').map(Number);
  const at = (year: number) => {
    const day = m === 2 && d === 29 && !isLeapYear(year) ? 28 : d;
    return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  const y = Number(from.slice(0, 4));
  const thisYear = at(y);
  return thisYear >= from ? thisYear : at(y + 1);
}

export function rangeEnd(today: string, range: CelebrationRange): string {
  if (range === 'today') return today;
  if (range === 'week') return addDays(today, 6);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return fmt(new Date(Date.UTC(y, m, 0)));
}

export function celebrationsFor(people: CelebrationPerson[], today: string, range: CelebrationRange): Celebrant[] {
  const end = rangeEnd(today, range);
  const out: Celebrant[] = [];
  const consider = (p: CelebrationPerson, kind: CelebrationKind, source: string | undefined) => {
    if (!isIso(source)) return;
    const date = nextOccurrence(source.slice(5), today);
    if (date > end) return;
    let years: number | undefined;
    if (kind === 'WORK') {
      years = Number(date.slice(0, 4)) - Number(source.slice(0, 4));
      if (years < 1) return; // joined this year: nothing to celebrate yet
    }
    out.push({ uid: p.uid, name: p.name, department: p.department || '', title: p.title || '', kind, date, ...(years !== undefined ? { years } : {}) });
  };
  for (const p of people) {
    if (p.active === false || p.showCelebrations === false) continue;
    consider(p, 'BIRTHDAY', p.dob);
    consider(p, 'WORK', p.joinDate);
    if (p.showMarriage === true) consider(p, 'MARRIAGE', p.marriageDate);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ announcements and the leadership message

export type AnnouncementKind = 'ANNOUNCEMENT' | 'CEO_SPEAK';

export interface AnnouncementDoc {
  id: string;
  companyId: string;
  kind: AnnouncementKind;
  title: string;
  body: string;
  authorName: string;
  authorTitle: string;
  /** Department ids this is for. Empty = everyone in the company. */
  departmentIds: string[];
  pinned: boolean;
  /** First day it shows, YYYY-MM-DD. */
  publishAt: string;
  /** Last day it shows. Empty = until someone takes it down. */
  expireAt: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const ANNOUNCEMENT_LIMITS = { title: 120, body: 4000, name: 80 };

export function isLive(a: Pick<AnnouncementDoc, 'active' | 'publishAt' | 'expireAt'>, today: string): boolean {
  return a.active !== false && a.publishAt <= today && (!a.expireAt || a.expireAt >= today);
}

export function audienceMatches(a: Pick<AnnouncementDoc, 'departmentIds'>, departmentId: string | undefined): boolean {
  const ids = a.departmentIds || [];
  return ids.length === 0 || (!!departmentId && ids.includes(departmentId));
}

/** What a person sees: live, for them, pinned first, then newest. */
export function visibleAnnouncements<T extends AnnouncementDoc>(list: T[], today: string, departmentId: string | undefined, kind: AnnouncementKind): T[] {
  return list
    .filter((a) => a.kind === kind && isLive(a, today) && audienceMatches(a, departmentId))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishAt.localeCompare(a.publishAt) || b.createdAt.localeCompare(a.createdAt));
}

// ------------------------------------------------------------------ mood

export const MOODS = [
  { value: 'UNHAPPY', label: 'Unhappy', emoji: '😔' },
  { value: 'SAD', label: 'Sad', emoji: '🙁' },
  { value: 'OK', label: 'Ok', emoji: '😐' },
  { value: 'EXCITED', label: 'Excited', emoji: '😄' },
  { value: 'SATISFIED', label: 'Satisfied', emoji: '😊' },
] as const;
export type Mood = (typeof MOODS)[number]['value'];
export const isMood = (v: unknown): v is Mood => MOODS.some((m) => m.value === v);

// ------------------------------------------------------------------ sign-in counts

export type LoginChannel = 'web' | 'mobile';
export const loginChannel = (userAgent: string | undefined | null): LoginChannel =>
  /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile/i.test(String(userAgent || '')) ? 'mobile' : 'web';

// ------------------------------------------------------------------ quick links and quick reports

export interface QuickLink {
  id: string;
  label: string;
  /** MODULE opens a screen in this app; URL opens a web page in a new tab. */
  kind: 'MODULE' | 'URL';
  target?: WidgetTarget;
  url?: string;
  /** Only people with this permission get the link. Empty = everyone. */
  perm?: string;
}

const MODULES: WidgetTarget['module'][] = [
  'document-version-control', 'leave-management', 'payroll', 'people', 'talent-acquisition-overview', 'talent-acquisition-requisitions', 'administration',
];
const DOC_TABS = ['creator', 'reviewer', 'compliance', 'employee'];

export const MAX_QUICK_LINKS = 12;

/** Starting links for a company that has not set its own. */
export const DEFAULT_QUICK_LINKS: QuickLink[] = [
  { id: 'q-leave', label: 'My leave', kind: 'MODULE', target: { module: 'leave-management', section: 'my' } },
  { id: 'q-attendance', label: 'My attendance', kind: 'MODULE', target: { module: 'leave-management', section: 'attendance' } },
  { id: 'q-payslips', label: 'My payslips', kind: 'MODULE', target: { module: 'payroll', section: 'payslips' } },
  { id: 'q-policies', label: 'Company policies', kind: 'MODULE', target: { module: 'document-version-control', docTab: 'employee' } },
  { id: 'q-directory', label: 'Employee directory', kind: 'MODULE', target: { module: 'people', section: 'directory' } },
];

/** Cleans links typed by an admin. Web links must be https; nothing else is kept, so a link can never run script. */
export function sanitizeQuickLinks(raw: unknown): QuickLink[] {
  if (!Array.isArray(raw)) return [];
  const out: QuickLink[] = [];
  const seen = new Set<string>();
  for (const x of raw.slice(0, MAX_QUICK_LINKS) as any[]) {
    const label = String(x?.label ?? '').trim().slice(0, 40);
    if (!label) continue;
    let id = String(x?.id ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || `q-${out.length + 1}`;
    while (seen.has(id)) id = `${id}-x`;
    seen.add(id);
    const perm = typeof x?.perm === 'string' && /^[a-z]+\.[a-z_]+$/.test(x.perm) ? x.perm : undefined;
    if (x?.kind === 'URL') {
      let url = '';
      try {
        const u = new URL(String(x?.url ?? '').trim());
        if (u.protocol === 'https:') url = u.toString().slice(0, 500);
      } catch { /* not a web address */ }
      if (url) out.push({ id, label, kind: 'URL', url, ...(perm ? { perm } : {}) });
    } else if (x?.kind === 'MODULE' && MODULES.includes(x?.target?.module)) {
      const t = x.target;
      const target: WidgetTarget = { module: t.module };
      if (typeof t.section === 'string' && /^[a-z]+$/.test(t.section)) target.section = t.section;
      if (DOC_TABS.includes(t.docTab)) target.docTab = t.docTab;
      out.push({ id, label, kind: 'MODULE', target, ...(perm ? { perm } : {}) });
    }
  }
  return out;
}

export function visibleQuickLinks(links: QuickLink[], perms: string[], isAdmin: boolean): QuickLink[] {
  return links.filter((l) => !l.perm || isAdmin || hasPerm(perms, l.perm));
}

export interface QuickReport {
  id: string;
  label: string;
  hint: string;
  target: WidgetTarget;
}

/** Reports a person may open, from what they are allowed to see. Everyone gets their own two. */
export function quickReportsFor(perms: string[], isAdmin: boolean): QuickReport[] {
  const can = (...p: string[]) => isAdmin || hasAnyPerm(perms, p);
  const out: QuickReport[] = [
    { id: 'my-attendance', label: 'My attendance report', hint: 'This month, day by day', target: { module: 'leave-management', section: 'attendance' } },
    { id: 'my-leave', label: 'My leave history', hint: 'Requests and balances', target: { module: 'leave-management', section: 'my' } },
  ];
  if (can('leave.manage', 'leave.report')) {
    out.push({ id: 'company-leave', label: 'Leave and attendance reports', hint: 'Whole company, CSV export', target: { module: 'leave-management', section: 'manage' } });
  }
  if (can('compliance.view')) {
    out.push({ id: 'compliance', label: 'Policy compliance', hint: 'Who has acknowledged what', target: { module: 'document-version-control', docTab: 'compliance' } });
  }
  if (can('audit.view')) {
    out.push({ id: 'audit', label: 'Audit log', hint: 'Every document action', target: { module: 'document-version-control', docTab: 'creator' } });
  }
  if (can('payroll.view', 'payroll.manage')) {
    out.push({ id: 'payroll', label: 'Payroll runs', hint: 'Salaries and payslips', target: { module: 'payroll', section: 'run' } });
  }
  return out;
}

// ------------------------------------------------------------------ who sees what (used by the server and the tests)

export function canManageAnnouncements(perms: string[], isAdmin: boolean) {
  return isAdmin || hasPerm(perms, 'announce.manage');
}
export function canManageHome(perms: string[], isAdmin: boolean) {
  return isAdmin || hasPerm(perms, 'home.manage');
}
/** The sign-in chart and the mood summary are for people who run the company's people data. */
export function canSeeLoginSummary(perms: string[], isAdmin: boolean) {
  return isAdmin || hasPerm(perms, 'users.manage');
}
export function canSeeMoodSummary(perms: string[], isAdmin: boolean) {
  return isAdmin || hasAnyPerm(perms, ['users.manage', 'leave.manage']);
}
