/**
 * Home page API: GET/POST /api/leave/home-<action> (it shares the leave serverless function, like payroll, people and
 * the dashboard do, because Vercel Hobby allows only 12 functions).
 *
 * Every card on Home loads from its own action, so one slow or failing card never blanks the page. Who may see
 * what is decided here from the verified token claims: the browser only draws what it is sent.
 *
 *   layout            which cards to draw, quick links, quick reports and what this person may manage
 *   profile           name, title, reporting manager and who approves their requests today
 *   calendar          one month of attendance, leave, holidays and weekly offs
 *   punches           recent check-ins and check-outs, five at a time
 *   on-leave          who is on leave today / later
 *   wishes            birthdays, work anniversaries, marriage anniversaries (day and month only, never the year)
 *   my-dates          a person's own birth / marriage date and whether to show them; people-dates / save-people-dates are the HR view
 *   files             organisation documents (published policies) and the person's own letters and payslips
 *   acks              policies to acknowledge / already acknowledged
 *   announcements     announcements or the leadership message, for this person
 *   mood              today's mood check-in; mood-summary is aggregated and for people managers only
 *   login-event       counts one sign-in (no names kept); login-summary reads the last days (admins only)
 *   settings          company Home setup (home.manage); announcements-all / save-announcement / delete-announcement
 *
 * Server-only collections: homeSettings, announcements, moodCheckins, loginDaily, personalDates.
 */
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';
import { addDays, istParts, istToday, isIsoDate } from '../../shared/leaveEngine.js';
import {
  ANNOUNCEMENT_LIMITS, DEFAULT_QUICK_LINKS, MAX_QUICK_LINKS, canManageAnnouncements, canManageHome, canSeeLoginSummary, canSeeMoodSummary,
  celebrationsFor, isMood, loginChannel, MOODS, quickReportsFor, sanitizeQuickLinks, visibleAnnouncements, visibleQuickLinks,
  type AnnouncementDoc, type AnnouncementKind, type CelebrationPerson, type CelebrationRange, type QuickLink,
} from '../../shared/home.js';
import {
  LeaveError, companyRequests, db, effectiveProfile, findLocation, loadPeople, loadProfiles, loadSettings, nowIso, personByUid,
  requestsOfUser, str,
} from './leaveCore.js';
import { attendanceOfUser, buildMonth, monthRange } from './leaveApi.js';

export interface HomeRequestIn {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
}

interface Result {
  status: number;
  json: any;
}

const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });

interface Who {
  ctx: AuthContext;
  cid: string;
  isAdmin: boolean;
  perms: string[];
}

async function whoIs(headers: Record<string, any>): Promise<Who> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.companyId) throw new LeaveError(403, 'Open this as a company user.');
  return { ctx, cid: ctx.companyId, isAdmin: ctx.isCompanyAdmin, perms: ctx.perms };
}

/** Keeps reads small: versions carry whole files, and Home only needs a few fields. */
const slim = (q: any, ...fields: string[]) => (typeof q.select === 'function' ? q.select(...fields) : q);

const dayOf = (v: unknown) => String(v || '').slice(0, 10);

// ------------------------------------------------------------------ company set-up (homeSettings/{companyId})

/** Card ids an admin can switch off. Cards a person may not see are never sent, whatever this says. */
export const HOME_CARDS = [
  'mood', 'calendar', 'attendance', 'quick-links', 'quick-reports', 'on-leave', 'celebrations', 'files',
  'ceo-speak', 'announcements', 'login-summary', 'acknowledgements',
] as const;

export type OnLeaveVisibility = 'COMPANY' | 'DEPARTMENT';

interface HomeSettings {
  hiddenCards: string[];
  /** null = the company never set its own: the starter links are used. */
  quickLinks: QuickLink[] | null;
  onLeaveVisibility: OnLeaveVisibility;
}

async function loadHomeSettings(cid: string): Promise<HomeSettings> {
  const snap = await db().collection('homeSettings').doc(cid).get();
  const x: any = snap.exists ? snap.data() : {};
  return {
    hiddenCards: Array.isArray(x.hiddenCards) ? x.hiddenCards.map(String).filter((c: string) => (HOME_CARDS as readonly string[]).includes(c)) : [],
    quickLinks: Array.isArray(x.quickLinks) ? sanitizeQuickLinks(x.quickLinks) : null,
    onLeaveVisibility: x.onLeaveVisibility === 'DEPARTMENT' ? 'DEPARTMENT' : 'COMPANY',
  };
}

async function layout(w: Who): Promise<Result> {
  const s = await loadHomeSettings(w.cid);
  const links = visibleQuickLinks(s.quickLinks ?? DEFAULT_QUICK_LINKS, w.perms, w.isAdmin);
  return ok({
    today: istToday(),
    hiddenCards: s.hiddenCards,
    quickLinks: links,
    quickReports: quickReportsFor(w.perms, w.isAdmin),
    can: {
      announce: canManageAnnouncements(w.perms, w.isAdmin),
      manageHome: canManageHome(w.perms, w.isAdmin),
      loginSummary: canSeeLoginSummary(w.perms, w.isAdmin),
      moodSummary: canSeeMoodSummary(w.perms, w.isAdmin),
      people: w.isAdmin || hasPerm(w.perms, 'users.manage'),
      acknowledge: w.isAdmin || hasPerm(w.perms, 'doc.acknowledge'),
    },
  });
}

async function getSettings(w: Who): Promise<Result> {
  if (!canManageHome(w.perms, w.isAdmin)) throw new LeaveError(403, 'You cannot change how Home looks.');
  const s = await loadHomeSettings(w.cid);
  return ok({ settings: { hiddenCards: s.hiddenCards, quickLinks: s.quickLinks ?? DEFAULT_QUICK_LINKS, custom: s.quickLinks !== null, onLeaveVisibility: s.onLeaveVisibility }, cards: HOME_CARDS });
}

async function saveSettings(w: Who, body: any): Promise<Result> {
  if (!canManageHome(w.perms, w.isAdmin)) throw new LeaveError(403, 'You cannot change how Home looks.');
  const hiddenCards = Array.isArray(body?.hiddenCards) ? body.hiddenCards.map(String).filter((c: string) => (HOME_CARDS as readonly string[]).includes(c)) : [];
  const quickLinks = sanitizeQuickLinks(body?.quickLinks).slice(0, MAX_QUICK_LINKS);
  const onLeaveVisibility: OnLeaveVisibility = body?.onLeaveVisibility === 'DEPARTMENT' ? 'DEPARTMENT' : 'COMPANY';
  await db().collection('homeSettings').doc(w.cid).set({ companyId: w.cid, hiddenCards, quickLinks, onLeaveVisibility, updatedAt: nowIso(), updatedBy: w.ctx.uid });
  return ok({ saved: true });
}

// ------------------------------------------------------------------ profile

const onLeaveToday = (requests: { status: string; detail: { date: string; value: number }[] }[], day: string) =>
  requests.some((r) => (r.status === 'APPROVED' || r.status === 'CANCEL_REQUESTED') && r.detail.some((x) => x.date === day && x.value >= 1));

async function profile(w: Who): Promise<Result> {
  const today = istToday();
  const [person, { settings }, profiles, people] = await Promise.all([
    personByUid(w.cid, w.ctx.uid), loadSettings(w.cid), loadProfiles(w.cid), loadPeople(w.cid),
  ]);
  if (!person) return ok({ found: false });
  const prof = effectiveProfile(settings, person, profiles.get(person.uid));
  const manager = prof.managerUid && prof.managerUid !== person.uid ? people.find((p) => p.uid === prof.managerUid) : undefined;

  let reporting: { name: string; title: string; status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE' } | null = null;
  let approving: { name: string; title: string; status: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE'; covering: boolean } | null = null;

  if (manager) {
    const away = manager.active ? onLeaveToday(await requestsOfUser(w.cid, manager.uid), today) : false;
    const status = !manager.active ? 'INACTIVE' : away ? 'ON_LEAVE' : 'ACTIVE';
    reporting = { name: manager.name, title: manager.title, status };
    approving = { name: manager.name, title: manager.title, status, covering: false };

    // Someone covering for the manager today approves instead.
    const del = await db().collection('leaveDelegations').doc(`${w.cid}__${manager.uid}`).get();
    const d: any = del.exists ? del.data() : null;
    if (d && d.from <= today && today <= d.to) {
      const cover = people.find((p) => p.uid === d.delegateUid);
      if (cover && cover.active) approving = { name: cover.name, title: cover.title, status: 'ACTIVE', covering: true };
    }
  }

  return ok({
    found: true,
    name: person.name,
    title: person.title,
    department: person.department,
    empId: person.empId,
    joinDate: prof.joinDate,
    reportingManager: reporting,
    approvingManager: approving,
  });
}

// ------------------------------------------------------------------ calendar

async function calendar(w: Who, q: any): Promise<Result> {
  const month = str(q.month, 7) || istToday().slice(0, 7);
  const { from, to } = monthRange(month);
  const [{ settings, configured }, person] = await Promise.all([loadSettings(w.cid), personByUid(w.cid, w.ctx.uid)]);
  if (!person || !configured || settings.types.length === 0) return ok({ configured: false, month });
  const profiles = await loadProfiles(w.cid);
  const prof = effectiveProfile(settings, person, profiles.get(person.uid));
  const [records, requests] = await Promise.all([attendanceOfUser(w.cid, person.uid, month), requestsOfUser(w.cid, person.uid)]);
  const built = buildMonth(settings, prof.locationId, prof.joinDate, month, records, requests);
  const loc = findLocation(settings, prof.locationId);

  // Days with a leave request still waiting for a decision ("unapproved leave").
  const pending = new Set<string>();
  requests.filter((r) => r.status === 'PENDING').forEach((r) => r.detail.forEach((d) => { if (d.date >= from && d.date <= to) pending.add(d.date); }));
  const holidayName = new Map<string, { name: string; optional: boolean }>();
  (loc?.holidays || []).forEach((h) => { if (h.date >= from && h.date <= to) holidayName.set(h.date, { name: h.name, optional: !!h.optional }); });

  const days = built.days.map((d: any) => {
    const h = holidayName.get(d.date);
    return {
      date: d.date, status: d.status,
      ...(pending.has(d.date) ? { pending: true } : {}),
      ...(h ? { holiday: h.name, optional: h.optional } : {}),
    };
  });
  const count = (...s: string[]) => days.filter((d) => s.includes(d.status)).length;
  const legend = {
    absent: count('ABSENT', 'INCOMPLETE'),
    leave: count('LEAVE'),
    holiday: count('HOLIDAY'),
    halfDay: count('HALF_DAY', 'HALF_LEAVE'),
    unapproved: pending.size,
    weekOff: count('WEEKLY_OFF'),
    optional: Array.from(holidayName.values()).filter((h) => h.optional).length,
  };
  return ok({ configured: true, month, today: istToday(), days, legend });
}

// ------------------------------------------------------------------ recent check-ins and check-outs

const PUNCH_PAGE = 5;

async function punches(w: Who, q: any): Promise<Result> {
  const person = await personByUid(w.cid, w.ctx.uid);
  if (!person) return ok({ rows: [], total: 0, page: 1, pages: 1 });
  const snap = await db().collection('leaveAttendance').where('companyId', '==', w.cid).where('uid', '==', person.uid).get();
  const all: { at: string; date: string; time: string; kind: 'IN' | 'OUT'; note: string }[] = [];
  for (const d of snap.docs) {
    const r: any = d.data();
    if (r.checkIn) { const p = istParts(r.checkIn); all.push({ at: r.checkIn, date: p.date, time: p.time, kind: 'IN', note: str(r.inNote, 200) }); }
    if (r.checkOut) { const p = istParts(r.checkOut); all.push({ at: r.checkOut, date: p.date, time: p.time, kind: 'OUT', note: str(r.outNote, 200) }); }
  }
  all.sort((a, b) => b.at.localeCompare(a.at));
  const pages = Math.max(1, Math.ceil(all.length / PUNCH_PAGE));
  const page = Math.min(pages, Math.max(1, parseInt(String(q.page || '1'), 10) || 1));
  const rows = all.slice((page - 1) * PUNCH_PAGE, page * PUNCH_PAGE).map(({ at: _at, ...x }) => x);
  return ok({ rows, total: all.length, page, pages, pageSize: PUNCH_PAGE });
}

// ------------------------------------------------------------------ employees on leave

async function onLeave(w: Who, q: any): Promise<Result> {
  const scope = q.scope === 'future' ? 'future' : 'today';
  const today = istToday();
  const [people, requests, settings, me] = await Promise.all([loadPeople(w.cid), companyRequests(w.cid), loadHomeSettings(w.cid), personByUid(w.cid, w.ctx.uid)]);
  const byUid = new Map(people.map((p) => [p.uid, p]));
  const sameDept = (uid: string) => settings.onLeaveVisibility === 'COMPANY' || uid === me?.uid || (!!me?.department && byUid.get(uid)?.department === me.department);

  const rows: { name: string; department: string; from: string; to: string; half: boolean }[] = [];
  for (const r of requests) {
    if (r.status !== 'APPROVED' && r.status !== 'CANCEL_REQUESTED') continue;
    const p = byUid.get(r.uid);
    if (!p || !p.active || !sameDept(r.uid)) continue;
    const dates = r.detail.filter((x) => x.value > 0);
    if (scope === 'today') {
      const hit = dates.find((x) => x.date === today);
      if (!hit) continue;
      rows.push({ name: p.name, department: p.department, from: r.from, to: r.to, half: hit.value < 1 });
    } else if (r.from > today) {
      rows.push({ name: p.name, department: p.department, from: r.from, to: r.to, half: false });
    }
  }
  rows.sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name));
  return ok({ scope, count: rows.length, rows: rows.slice(0, 30) });
}

// ------------------------------------------------------------------ celebrations
//
// Birth and marriage dates are kept in the server-only personalDates collection, not on the employee record: every
// colleague can read employee records through Firestore, and a birth date must not be one of the things they can read.

interface PersonalDates {
  dob: string;
  marriageDate: string;
  /** false = this person asked not to be shown in any celebration. */
  showCelebrations: boolean;
  /** Marriage anniversaries are only shown when this is true (the person's own choice). */
  showMarriage: boolean;
}

const datesId = (cid: string, uid: string) => `${cid}__${uid}`;

/** A real calendar date between 1900 and today, or ''. */
function cleanDate(v: unknown): string {
  const d = str(v, 10);
  return isIsoDate(d) && d >= '1900-01-01' && d <= istToday() ? d : '';
}

async function loadDates(cid: string): Promise<Map<string, PersonalDates>> {
  const snap = await db().collection('personalDates').where('companyId', '==', cid).get();
  const m = new Map<string, PersonalDates>();
  snap.docs.forEach((d: any) => {
    const x = d.data() as any;
    m.set(String(x.uid), { dob: cleanDate(x.dob), marriageDate: cleanDate(x.marriageDate), showCelebrations: x.showCelebrations !== false, showMarriage: x.showMarriage === true });
  });
  return m;
}

async function wishes(w: Who, q: any): Promise<Result> {
  const range: CelebrationRange = q.range === 'week' ? 'week' : q.range === 'month' ? 'month' : 'today';
  const today = istToday();
  const [people, profiles, dates] = await Promise.all([loadPeople(w.cid), loadProfiles(w.cid), loadDates(w.cid)]);
  const list = celebrationsFor(people.map((p): CelebrationPerson => {
    const d = dates.get(p.uid);
    const joined = profiles.get(p.uid)?.joinDate; // only a date HR entered: the account's creation day is not a joining day
    return {
      uid: p.uid, name: p.name, department: p.department, title: p.title, active: p.active,
      dob: d?.dob, marriageDate: d?.marriageDate, joinDate: joined && isIsoDate(joined) ? joined : '',
      showCelebrations: d ? d.showCelebrations : true, showMarriage: d ? d.showMarriage : false,
    };
  }), today, range);
  const pick = (kind: string) => list.filter((c) => c.kind === kind).slice(0, 50);
  return ok({ range, today, birthdays: pick('BIRTHDAY'), work: pick('WORK'), marriage: pick('MARRIAGE') });
}

/** A person's own dates and choices. */
async function myDates(w: Who): Promise<Result> {
  const d = (await loadDates(w.cid)).get(w.ctx.uid);
  return ok({ dob: d?.dob || '', marriageDate: d?.marriageDate || '', showCelebrations: d ? d.showCelebrations : true, showMarriage: d ? d.showMarriage : false });
}

async function saveMyDates(w: Who, body: any): Promise<Result> {
  const next: PersonalDates = {
    dob: cleanDate(body?.dob), marriageDate: cleanDate(body?.marriageDate),
    showCelebrations: body?.showCelebrations !== false, showMarriage: body?.showMarriage === true,
  };
  await db().collection('personalDates').doc(datesId(w.cid, w.ctx.uid)).set({ companyId: w.cid, uid: w.ctx.uid, ...next, updatedAt: nowIso(), updatedBy: w.ctx.uid });
  return ok({ saved: true });
}

const needUsers = (w: Who) => {
  if (!(w.isAdmin || hasPerm(w.perms, 'users.manage'))) throw new LeaveError(403, 'Only people who manage users can do this.');
};

/** HR view: everyone's birth and marriage dates, so missing ones can be filled in. */
async function peopleDates(w: Who): Promise<Result> {
  needUsers(w);
  const [people, dates] = await Promise.all([loadPeople(w.cid), loadDates(w.cid)]);
  return ok({
    people: people.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
      const d = dates.get(p.uid);
      return { uid: p.uid, name: p.name, email: p.email, empId: p.empId, department: p.department, dob: d?.dob || '', marriageDate: d?.marriageDate || '', showCelebrations: d ? d.showCelebrations : true, showMarriage: d ? d.showMarriage : false };
    }),
  });
}

/**
 * HR fills in dates (one by one or from a CSV: rows carry a uid or an email). HR cannot change a person's own choices:
 * a marriage date entered by HR stays hidden until that person chooses to show it.
 */
async function savePeopleDates(w: Who, body: any): Promise<Result> {
  needUsers(w);
  const rows: any[] = Array.isArray(body?.rows) ? body.rows.slice(0, 2000) : [];
  const people = await loadPeople(w.cid);
  const byUid = new Map(people.map((p) => [p.uid, p]));
  const byEmail = new Map(people.map((p) => [p.email, p]));
  const dates = await loadDates(w.cid);
  let saved = 0;
  const skipped: string[] = [];
  for (const [i, r] of rows.entries()) {
    const person = byUid.get(str(r?.uid, 128)) || byEmail.get(str(r?.email, 160).toLowerCase());
    if (!person) { skipped.push(`Row ${i + 1}: person not found`); continue; }
    const dob = r?.dob === undefined ? undefined : cleanDate(r.dob);
    const marriageDate = r?.marriageDate === undefined ? undefined : cleanDate(r.marriageDate);
    if ((r?.dob && !dob) || (r?.marriageDate && !marriageDate)) { skipped.push(`Row ${i + 1}: ${person.name}, use a valid date as YYYY-MM-DD`); continue; }
    const cur = dates.get(person.uid);
    await db().collection('personalDates').doc(datesId(w.cid, person.uid)).set({
      companyId: w.cid, uid: person.uid,
      dob: dob === undefined ? cur?.dob || '' : dob,
      marriageDate: marriageDate === undefined ? cur?.marriageDate || '' : marriageDate,
      showCelebrations: cur ? cur.showCelebrations : true, showMarriage: cur ? cur.showMarriage : false,
      updatedAt: nowIso(), updatedBy: w.ctx.uid,
    });
    saved += 1;
  }
  return ok({ saved, skipped });
}

// ------------------------------------------------------------------ important files

const DEPT_ALL = /^all\s+departments?$/i;
const norm = (v: unknown) => String(v || '').trim().toLowerCase();

async function files(w: Who, q: any): Promise<Result> {
  const tab = q.tab === 'employee' ? 'employee' : 'org';
  if (tab === 'org') return ok({ tab, items: await organisationFiles(w) });
  return ok({ tab, items: await myFiles(w) });
}

async function organisationFiles(w: Who) {
  const person = await personByUid(w.cid, w.ctx.uid);
  const [vers, docs, emp] = await Promise.all([
    slim(db().collection('versions').where('companyId', '==', w.cid).where('status', '==', 'PUBLISHED'),
      'documentMasterId', 'documentId', 'documentTitle', 'versionNumber', 'fileName', 'fileUrl', 'effectiveFrom', 'publishedAt', 'createdAt').get(),
    db().collection('documents').where('companyId', '==', w.cid).get(),
    person ? db().collection('employees').doc(person.docId).get() : Promise.resolve(null),
  ]);
  const deptId = norm((emp && emp.exists ? (emp.data() as any).departmentId : '') || '');
  const deptName = norm(person?.department);
  // People who write or approve documents see all of them; everyone else sees what their department may read.
  const seesAll = w.isAdmin || ['doc.create', 'doc.review', 'doc.publish'].some((p) => hasPerm(w.perms, p));

  const master = new Map<string, any>(docs.docs.map((d: any) => [d.id, d.data()]));
  const items: any[] = [];
  for (const d of vers.docs) {
    const v: any = d.data();
    const m = master.get(String(v.documentMasterId)) || {};
    if (m.active === false) continue;
    const conf = String(m.confidentiality || '');
    if (!seesAll && /specific department/i.test(conf)) {
      const dn = norm(m.departmentName);
      const di = norm(m.departmentId);
      const ok = DEPT_ALL.test(dn) || (!!dn && dn === deptName) || (!!di && di === deptId);
      if (!ok) continue;
    }
    items.push({
      id: d.id, documentId: String(v.documentId || ''), title: String(v.documentTitle || m.title || ''), category: String(m.category || ''),
      versionNumber: String(v.versionNumber || ''), date: dayOf(v.effectiveFrom || v.publishedAt || v.createdAt),
      fileName: String(v.fileName || ''), fileUrl: String(v.fileUrl || ''),
    });
  }
  items.sort((a, b) => a.title.localeCompare(b.title));
  return items.slice(0, 50);
}

async function myFiles(w: Who) {
  const items: any[] = [];
  const [letters, lines, runs] = await Promise.all([
    db().collection('lifecycleLetters').where('companyId', '==', w.cid).where('uid', '==', w.ctx.uid).get().catch(() => ({ docs: [] as any[] })),
    db().collection('payrollRunLines').where('companyId', '==', w.cid).where('uid', '==', w.ctx.uid).get().catch(() => ({ docs: [] as any[] })),
    db().collection('payrollRuns').where('companyId', '==', w.cid).get().catch(() => ({ docs: [] as any[] })),
  ]);
  for (const d of letters.docs) {
    const l: any = d.data();
    items.push({ id: d.id, kind: 'LETTER', title: String(l.title || 'Letter'), date: dayOf(l.issuedAt), target: { module: 'people', section: 'myletters' } });
  }
  const status = new Map<string, string>(runs.docs.map((d: any): [string, string] => [String(d.get('month')), String(d.get('status'))]));
  for (const d of lines.docs) {
    const l: any = d.data();
    if (!['LOCKED', 'PAID'].includes(status.get(l.month) || '')) continue;
    items.push({ id: d.id, kind: 'PAYSLIP', title: `Payslip ${l.month}`, date: `${l.month}-01`, month: l.month, target: { module: 'payroll', section: 'payslips' } });
  }
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items.slice(0, 20);
}

// ------------------------------------------------------------------ acknowledgements (active / completed)

async function acks(w: Who): Promise<Result> {
  if (!(w.isAdmin || hasPerm(w.perms, 'doc.acknowledge'))) return ok({ allowed: false });
  const person = await personByUid(w.cid, w.ctx.uid);
  const ids = Array.from(new Set([w.ctx.uid, person?.docId].filter(Boolean) as string[]));
  const [pub, ...mine] = await Promise.all([
    slim(db().collection('versions').where('companyId', '==', w.cid).where('status', '==', 'PUBLISHED'), 'documentId').get(),
    ...ids.map((id) => db().collection('acknowledgments').where('companyId', '==', w.cid).where('employeeId', '==', id).get()),
  ]);
  const live = new Set<string>(pub.docs.map((d: any) => d.id));
  const seen = new Set<string>();
  const active: any[] = [];
  const completed: any[] = [];
  for (const snap of mine) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const a: any = d.data();
      const row = { documentId: String(a.documentId || ''), title: String(a.documentTitle || ''), versionNumber: String(a.versionNumber || ''), at: dayOf(a.acknowledgedAt || a.createdAt) };
      if (a.status === 'PENDING') {
        if (a.documentVersionId && !live.has(String(a.documentVersionId))) continue; // an older version's record is stale
        active.push(row);
      } else if (a.status === 'ACKNOWLEDGED') completed.push(row);
    }
  }
  completed.sort((a, b) => b.at.localeCompare(a.at));
  return ok({ allowed: true, active: { count: active.length, items: active.slice(0, 8) }, completed: { count: completed.length, items: completed.slice(0, 8) } });
}

// ------------------------------------------------------------------ announcements and the leadership message

const kindOf = (v: unknown): AnnouncementKind => (v === 'CEO_SPEAK' ? 'CEO_SPEAK' : 'ANNOUNCEMENT');

async function loadAnnouncements(cid: string): Promise<AnnouncementDoc[]> {
  const snap = await db().collection('announcements').where('companyId', '==', cid).get();
  return snap.docs.map((d: any) => ({ ...(d.data() as AnnouncementDoc), id: d.id }));
}

async function announcements(w: Who, q: any): Promise<Result> {
  const kind = kindOf(q.kind);
  const [list, person] = await Promise.all([loadAnnouncements(w.cid), personByUid(w.cid, w.ctx.uid)]);
  let deptId = '';
  if (person) {
    const e = await db().collection('employees').doc(person.docId).get();
    deptId = e.exists ? String((e.data() as any).departmentId || '') : '';
  }
  const items = visibleAnnouncements(list, istToday(), deptId, kind).slice(0, kind === 'CEO_SPEAK' ? 1 : 10)
    .map((a) => ({ id: a.id, title: a.title, body: a.body, authorName: a.authorName, authorTitle: a.authorTitle, pinned: a.pinned, publishAt: a.publishAt }));
  return ok({ kind, items });
}

async function announcementsAll(w: Who, q: any): Promise<Result> {
  if (!canManageAnnouncements(w.perms, w.isAdmin)) throw new LeaveError(403, 'You cannot manage announcements.');
  const kind = kindOf(q.kind);
  const today = istToday();
  const list = (await loadAnnouncements(w.cid)).filter((a) => a.kind === kind)
    .sort((a, b) => b.publishAt.localeCompare(a.publishAt) || b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  const depts = await db().collection('departments').where('companyId', '==', w.cid).get();
  return ok({
    kind, today,
    items: list.map((a) => ({ ...a, live: a.active !== false && a.publishAt <= today && (!a.expireAt || a.expireAt >= today) })),
    departments: depts.docs.map((d: any) => ({ id: d.id, name: String((d.data() as any).name || '') })).sort((a: any, b: any) => a.name.localeCompare(b.name)),
  });
}

async function saveAnnouncement(w: Who, body: any): Promise<Result> {
  if (!canManageAnnouncements(w.perms, w.isAdmin)) throw new LeaveError(403, 'You cannot manage announcements.');
  const kind = kindOf(body?.kind);
  const title = str(body?.title, ANNOUNCEMENT_LIMITS.title);
  const text = str(body?.body, ANNOUNCEMENT_LIMITS.body);
  if (!title) return fail(400, 'Give it a title.');
  if (!text) return fail(400, 'Write the message.');
  const today = istToday();
  const publishAt = str(body?.publishAt, 10) || today;
  const expireAt = str(body?.expireAt, 10);
  if (!isIsoDate(publishAt) || (expireAt && !isIsoDate(expireAt))) return fail(400, 'Use valid dates.');
  if (expireAt && expireAt < publishAt) return fail(400, 'The end date cannot be before the start date.');

  // Only departments of this company can be targeted.
  const depts = await db().collection('departments').where('companyId', '==', w.cid).get();
  const known = new Set<string>(depts.docs.map((d: any) => d.id));
  const departmentIds = Array.isArray(body?.departmentIds) ? Array.from(new Set<string>(body.departmentIds.map(String).filter((id: string) => known.has(id)))).slice(0, 50) : [];

  const person = await personByUid(w.cid, w.ctx.uid);
  const now = nowIso();
  const id = str(body?.id, 128);
  let createdAt = now;
  let createdBy = w.ctx.uid;
  if (id) {
    const prev = await db().collection('announcements').doc(id).get();
    const p: any = prev.exists ? prev.data() : null;
    if (!p || p.companyId !== w.cid) return fail(404, 'That announcement no longer exists.');
    createdAt = p.createdAt || now;
    createdBy = p.createdBy || w.ctx.uid;
  }
  const ref = id ? db().collection('announcements').doc(id) : db().collection('announcements').doc();
  const doc: AnnouncementDoc = {
    id: ref.id, companyId: w.cid, kind, title, body: text,
    authorName: str(body?.authorName, ANNOUNCEMENT_LIMITS.name) || person?.name || '',
    authorTitle: str(body?.authorTitle, ANNOUNCEMENT_LIMITS.name) || person?.title || '',
    departmentIds, pinned: body?.pinned === true, publishAt, expireAt, active: body?.active !== false,
    createdBy, createdAt, updatedAt: now,
  };
  await ref.set(doc);
  return ok({ id: ref.id });
}

async function deleteAnnouncement(w: Who, body: any): Promise<Result> {
  if (!canManageAnnouncements(w.perms, w.isAdmin)) throw new LeaveError(403, 'You cannot manage announcements.');
  const id = str(body?.id, 128);
  const ref = db().collection('announcements').doc(id);
  const snap = await ref.get();
  if (!id || !snap.exists || (snap.data() as any).companyId !== w.cid) return fail(404, 'That announcement no longer exists.');
  await ref.delete();
  return ok({ deleted: true });
}

// ------------------------------------------------------------------ mood

const moodId = (cid: string, uid: string, date: string) => `${cid}__${uid}__${date}`;

async function myMood(w: Who): Promise<Result> {
  const snap = await db().collection('moodCheckins').doc(moodId(w.cid, w.ctx.uid, istToday())).get();
  return ok({ today: snap.exists ? String((snap.data() as any).mood) : null });
}

async function saveMood(w: Who, body: any): Promise<Result> {
  if (!isMood(body?.mood)) return fail(400, 'Choose how you feel.');
  const date = istToday();
  await db().collection('moodCheckins').doc(moodId(w.cid, w.ctx.uid, date)).set({ companyId: w.cid, uid: w.ctx.uid, date, mood: body.mood, at: nowIso() });
  return ok({ today: body.mood });
}

/** Counts only: never names, so a manager cannot see how one person felt. */
async function moodSummary(w: Who, q: any): Promise<Result> {
  if (!canSeeMoodSummary(w.perms, w.isAdmin)) throw new LeaveError(403, 'You cannot see this.');
  const n = Math.min(30, Math.max(1, parseInt(String(q.days || '7'), 10) || 7));
  const today = istToday();
  const from = addDays(today, -(n - 1));
  const snap = await db().collection('moodCheckins').where('companyId', '==', w.cid).get();
  const totals: Record<string, number> = Object.fromEntries(MOODS.map((m) => [m.value, 0]));
  let responses = 0;
  for (const d of snap.docs) {
    const x: any = d.data();
    if (x.date < from || x.date > today || !(x.mood in totals)) continue;
    totals[x.mood] += 1;
    responses += 1;
  }
  return ok({ days: n, from, to: today, responses, totals });
}

// ------------------------------------------------------------------ sign-in counts

const loginDocId = (cid: string, date: string) => `${cid}__${date}`;

async function loginEvent(w: Who, headers: Record<string, any>): Promise<Result> {
  const date = istToday();
  const channel = loginChannel(String(headers['user-agent'] || headers['User-Agent'] || ''));
  const ref = db().collection('loginDaily').doc(loginDocId(w.cid, date));
  const snap = await ref.get();
  const cur: any = snap.exists ? snap.data() : { web: 0, mobile: 0 };
  // Counts only. Two sign-ins at the same instant can count as one, which is fine for a trend chart.
  await ref.set({ companyId: w.cid, date, web: Number(cur.web) || 0, mobile: Number(cur.mobile) || 0, [channel]: (Number(cur[channel]) || 0) + 1, updatedAt: nowIso() });
  return ok({ counted: true });
}

async function loginSummary(w: Who, q: any): Promise<Result> {
  if (!canSeeLoginSummary(w.perms, w.isAdmin)) throw new LeaveError(403, 'You cannot see this.');
  const n = Math.min(30, Math.max(2, parseInt(String(q.days || '5'), 10) || 5));
  const today = istToday();
  const snaps = await Promise.all(Array.from({ length: n }, (_, i) => db().collection('loginDaily').doc(loginDocId(w.cid, addDays(today, -(n - 1 - i)))).get()));
  const series = snaps.map((s, i) => {
    const x: any = s.exists ? s.data() : {};
    return { date: addDays(today, -(n - 1 - i)), web: Number(x.web) || 0, mobile: Number(x.mobile) || 0 };
  });
  return ok({ days: n, series });
}

// ------------------------------------------------------------------ router

export async function routeHome(r: HomeRequestIn): Promise<Result> {
  try {
    const w = await whoIs(r.headers);
    const GET = r.method === 'GET';
    const POST = r.method === 'POST';
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    switch (r.action) {
      case 'layout': if (GET) return await layout(w); break;
      case 'profile': if (GET) return await profile(w); break;
      case 'calendar': if (GET) return await calendar(w, r.query); break;
      case 'punches': if (GET) return await punches(w, r.query); break;
      case 'on-leave': if (GET) return await onLeave(w, r.query); break;
      case 'wishes': if (GET) return await wishes(w, r.query); break;
      case 'my-dates': if (GET) return await myDates(w); if (POST) return await saveMyDates(w, body); break;
      case 'people-dates': if (GET) return await peopleDates(w); break;
      case 'save-people-dates': if (POST) return await savePeopleDates(w, body); break;
      case 'files': if (GET) return await files(w, r.query); break;
      case 'acks': if (GET) return await acks(w); break;
      case 'announcements': if (GET) return await announcements(w, r.query); break;
      case 'announcements-all': if (GET) return await announcementsAll(w, r.query); break;
      case 'save-announcement': if (POST) return await saveAnnouncement(w, body); break;
      case 'delete-announcement': if (POST) return await deleteAnnouncement(w, body); break;
      case 'mood': if (GET) return await myMood(w); if (POST) return await saveMood(w, body); break;
      case 'mood-summary': if (GET) return await moodSummary(w, r.query); break;
      case 'login-event': if (POST) return await loginEvent(w, r.headers); break;
      case 'login-summary': if (GET) return await loginSummary(w, r.query); break;
      case 'settings': if (GET) return await getSettings(w); break;
      case 'save-settings': if (POST) return await saveSettings(w, body); break;
    }
    return fail(404, `Unknown home action: ${r.action}`);
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return known;
    if (err instanceof LeaveError) return fail(err.status, err.message);
    console.error('[home] failed:', err);
    return fail(500, 'Could not load this part of Home.');
  }
}

