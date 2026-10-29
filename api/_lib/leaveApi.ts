/**
 * Leave and attendance API (one router, shared by server.ts and api/leave/[action].ts).
 *
 * Everyone signed in to an active company can apply for leave, mark attendance and see their own data.
 * A manager approves the requests of the people who report to them. leave.manage is HR (setup, balances,
 * every request); leave.report can read the company-wide reports.
 */
import { answerPolicyQuestion, coverageGaps, parseLeaveText } from '../../shared/leaveAssist.js';
import { polishWording } from './leaveAi.js';
import { authErrorResponse, requireActiveTenant, type AuthContext } from './authContext.js';
import { hasPerm } from '../../shared/permissions.js';
import { diffSettings } from '../../shared/leavePolicyDiff.js';
import { postCorrections } from './leavePayroll.js';
import { checkAttachment } from '../../shared/employeeIdentity.js';
import {
  DEFAULT_SHIFT, previousCycle, rollover, addDays, computeDayStatus, hasOpenSession, sessionsOf, workedMinutesOf, type PunchSession, cycleOf, daysBetween, isIsoDate, istParts, istToInstant, istToday,
  lastDayOfMonth, nationalHolidays, starterSettings, summarizeMonth, timeToMinutes, typeStartMonth,
  type AttendanceRecord, type LeaveLocation, type LeavePolicy, type LeaveSettings, type LeaveType,
} from '../../shared/leaveEngine.js';
import {
  ACTIVE_STATUSES, RESERVING, LeaveError, audit, raiseException, inApp, companyLabel, balanceOf, companyLedger, companyRequests, db, effectiveProfile, entryData, findLocation, findPolicy,
  findType, ledgerRef, loadPeople, loadProfiles, loadSettings, notify, nowIso, parseApplyInput, personByUid, planRequest, profileId,
  profileOf, requestsOfUser, restoreEntries, runAccrual, str, usageEntries, userLedger,
  type LeaveException, type LeaveNotification, type LeaveRequest, type Person, type Profile,
} from './leaveCore.js';

export interface LeaveRequestIn {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
  ip?: string;
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
  canManage: boolean;
  canReport: boolean;
}

async function whoIs(headers: Record<string, any>): Promise<Who> {
  const ctx = await requireActiveTenant(headers);
  if (!ctx.companyId) throw new LeaveError(403, 'Open this as a company user.');
  const canManage = ctx.isCompanyAdmin || hasPerm(ctx.perms, 'leave.manage');
  return { ctx, cid: ctx.companyId, canManage, canReport: canManage || hasPerm(ctx.perms, 'leave.report') };
}

const needManage = (w: Who) => {
  if (!w.canManage) throw new LeaveError(403, 'Only HR can do this.');
};
const needReport = (w: Who) => {
  if (!w.canReport) throw new LeaveError(403, 'You do not have access to reports.');
};

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

// ------------------------------------------------------------------ settings

function num(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

export function sanitizeSettings(input: any, prev: LeaveSettings): LeaveSettings {
  if (!input || typeof input !== 'object') throw new LeaveError(400, 'Settings are missing.');
  const used = new Set<string>();
  const uniq = (raw: unknown, fallback: string) => {
    let id = slug(str(raw, 40)) || slug(fallback) || 'item';
    let n = 2;
    const base = id;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    return id;
  };

  const locations: LeaveLocation[] = (Array.isArray(input.locations) ? input.locations : []).slice(0, 30).map((l: any, i: number) => {
    const weeklyOff: LeaveLocation['weeklyOff'] = {};
    for (const [k, v] of Object.entries<any>(l?.weeklyOff || {})) {
      if (!/^[0-6]$/.test(k)) continue;
      if (v === 'ALL') weeklyOff[k] = 'ALL';
      else if (Array.isArray(v)) {
        const weeks = Array.from(new Set(v.map(Number).filter((n) => n >= 1 && n <= 5))).sort();
        if (weeks.length) weeklyOff[k] = weeks;
      }
    }
    const seen = new Set<string>();
    const holidays = (Array.isArray(l?.holidays) ? l.holidays : [])
      .filter((h: any) => isIsoDate(h?.date))
      .slice(0, 150)
      .map((h: any) => ({ date: h.date, name: str(h.name, 80) || 'Holiday', optional: h.optional === true }))
      .filter((h: any) => (seen.has(h.date) ? false : (seen.add(h.date), true)))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    return { id: uniq(l?.id, l?.name || `location-${i + 1}`), name: str(l?.name, 80) || `Location ${i + 1}`, weeklyOff, holidays };
  });
  used.clear();

  const types: LeaveType[] = (Array.isArray(input.types) ? input.types : []).slice(0, 40).map((t: any, i: number) => ({
    id: uniq(t?.id, t?.code || t?.name || `type-${i + 1}`),
    code: str(t?.code, 8).toUpperCase() || `T${i + 1}`,
    name: str(t?.name, 60) || `Leave type ${i + 1}`,
    paid: t?.paid !== false,
    active: t?.active !== false,
    isLop: t?.isLop === true,
    requiresBalance: t?.isLop === true ? false : t?.requiresBalance !== false,
    halfDay: t?.halfDay !== false,
    dayCounting: t?.dayCounting === 'CALENDAR' ? 'CALENDAR' : 'WORKING',
    minNoticeDays: num(t?.minNoticeDays, 0, 90, 0),
    maxDaysPerRequest: num(t?.maxDaysPerRequest, 0, 400, 0),
    docRequiredAfterDays: num(t?.docRequiredAfterDays, 0, 400, 0),
    gender: t?.gender === 'F' || t?.gender === 'M' ? t.gender : 'ANY',
    minServiceDays: num(t?.minServiceDays, 0, 3650, 0),
    allowNegative: t?.allowNegative === true,
    blockInProbation: t?.blockInProbation === true,
    blockInNotice: t?.blockInNotice === true,
    approval: t?.approval === 'HR' || t?.approval === 'MANAGER_HR' ? t.approval : 'MANAGER',
    startMonth: t?.startMonth ? num(t.startMonth, 1, 12, 0) || undefined : undefined,
    color: /^#[0-9a-fA-F]{6}$/.test(str(t?.color, 7)) ? str(t.color, 7) : undefined,
  }));
  const typeIds = new Set(types.map((t) => t.id));
  used.clear();

  const policies: LeavePolicy[] = (Array.isArray(input.policies) ? input.policies : []).slice(0, 20).map((p: any, i: number) => ({
    id: uniq(p?.id, p?.name || `policy-${i + 1}`),
    name: str(p?.name, 60) || `Policy ${i + 1}`,
    isDefault: p?.isDefault === true,
    entries: (Array.isArray(p?.entries) ? p.entries : [])
      .filter((e: any) => typeIds.has(str(e?.typeId, 40)))
      .map((e: any) => ({
        typeId: str(e.typeId, 40),
        quota: num(e.quota, 0, 400, 0),
        accrual: ['UPFRONT', 'MONTHLY', 'QUARTERLY'].includes(e.accrual) ? e.accrual : 'NONE',
        carryForward: e.carryForward === true,
        carryCap: num(e.carryCap, 0, 400, 0),
        encashCap: num(e.encashCap, 0, 400, 0),
      })),
  }));
  if (policies.length > 0 && !policies.some((p) => p.isDefault)) policies[0].isDefault = true;
  let seenDefault = false;
  policies.forEach((p) => {
    if (p.isDefault && seenDefault) p.isDefault = false;
    if (p.isDefault) seenDefault = true;
  });

  const shiftIn = input.shift || {};
  const timeOr = (v: unknown, d: string) => (Number.isFinite(timeToMinutes(str(v, 5))) ? str(v, 5) : d);
  const shift = {
    start: timeOr(shiftIn.start, DEFAULT_SHIFT.start),
    end: timeOr(shiftIn.end, DEFAULT_SHIFT.end),
    graceMinutes: num(shiftIn.graceMinutes, 0, 120, DEFAULT_SHIFT.graceMinutes),
    fullDayMinutes: num(shiftIn.fullDayMinutes, 60, 960, DEFAULT_SHIFT.fullDayMinutes),
    halfDayMinutes: num(shiftIn.halfDayMinutes, 30, 960, DEFAULT_SHIFT.halfDayMinutes),
  };
  if (shift.halfDayMinutes > shift.fullDayMinutes) shift.halfDayMinutes = shift.fullDayMinutes;

  return {
    ...prev,
    yearStartMonth: num(input.yearStartMonth, 1, 12, 4),
    sandwichRule: input.sandwichRule === true,
    probationDays: num(input.probationDays, 0, 730, 0),
    yearEndSignoff: input.yearEndSignoff === true,
    locations, types, policies, shift,
    lateMarksPerHalfDay: num(input.lateMarksPerHalfDay, 0, 31, 0),
    cycleStartDay: num(input.cycleStartDay, 1, 28, 1),
    allowedIps: (Array.isArray(input.allowedIps) ? input.allowedIps : []).map((x: any) => str(x, 45)).filter(Boolean).slice(0, 20),
    escalateAfterDays: num(input.escalateAfterDays, 0, 30, 3),
    hrApprovalAboveDays: num(input.hrApprovalAboveDays, 0, 400, 0),
    notifyEmails: (Array.isArray(input.notifyEmails) ? input.notifyEmails : [])
      .map((x: any) => str(x, 160).toLowerCase())
      .filter((x: string) => /^\S+@\S+\.\S+$/.test(x))
      .slice(0, 10),
  };
}

const versionRef = (cid: string, n: number) => db().collection('leavePolicyVersions').doc(`${cid}__${n}`);

/**
 * Saves the live leave setup. When the rules actually changed, the policy version goes up and the new version is
 * archived next to a plain-language list of what changed, so every request and approval can be traced to the
 * rules in force at the time.
 */
async function saveSettings(cid: string, settings: LeaveSettings, by: string, byUid = '', opts: { effectiveFrom?: string; approvedBy?: string; governanceRef?: string } = {}) {
  const prev = await loadSettings(cid);
  const changes = prev.configured ? diffSettings(prev.settings, settings) : [{ area: 'General' as const, text: 'Initial leave setup.' }];
  const at = nowIso();
  let version = prev.settings.policyVersion || (prev.configured ? 1 : 0);
  const next: LeaveSettings = JSON.parse(JSON.stringify(settings)); // also drops undefined fields
  if (changes.length > 0 || !prev.configured) {
    version += 1;
    next.policyVersion = version;
    next.effectiveFrom = opts.effectiveFrom || istToday();
    next.governanceRef = opts.governanceRef ?? prev.settings.governanceRef ?? '';
    next.approvedBy = opts.approvedBy ?? by;
    await versionRef(cid, version).set({
      companyId: cid, version, effectiveFrom: next.effectiveFrom, publishedAt: at, publishedBy: by, approvedBy: next.approvedBy,
      governanceRef: next.governanceRef, changes: changes.map((c) => ({ area: c.area, text: c.text })), settings: JSON.parse(JSON.stringify(next)),
    });
    await audit(cid, 'policy', `v${version}`, prev.configured ? 'POLICY_PUBLISHED' : 'POLICY_CREATED', { name: by, uid: byUid }, prev.configured ? { version: version - 1 } : null,
      { version, changes: changes.slice(0, 40).map((c) => c.text) });
  } else {
    next.policyVersion = version || 1;
  }
  await db().collection('leaveSettings').doc(cid).set({ ...next, companyId: cid, updatedAt: at, updatedBy: by });
  return { version: next.policyVersion || 1, changes };
}

// ------------------------------------------------------------------ shared lookups

interface Ctx {
  who: Who;
  settings: LeaveSettings;
  configured: boolean;
  me: Person;
}

async function loadCtx(who: Who): Promise<Ctx> {
  const [{ settings, configured }, me] = await Promise.all([loadSettings(who.cid), personByUid(who.cid, who.ctx.uid)]);
  if (!me) throw new LeaveError(404, 'Your employee record was not found. Ask your administrator.');
  return { who, settings, configured, me };
}

function needConfigured(c: Ctx) {
  if (!c.configured || c.settings.types.length === 0) throw new LeaveError(409, 'Leave has not been set up for your company yet. Ask HR.');
}

/** The people who receive HR mail (the settings' HR mailboxes), as accounts, for in-app messages. */
const hrUids = (settings: LeaveSettings, people: Person[]) => people.filter((p) => settings.notifyEmails.includes(p.email.toLowerCase())).map((p) => p.uid);

const nameOf = (people: Person[], uid: string) => people.find((p) => p.uid === uid)?.name || '';

// ------------------------------------------------------------------ delegation (someone approves while the manager is away)

interface Delegation { companyId: string; managerUid: string; delegateUid: string; from: string; to: string; createdBy: string; createdAt: string }
const delegationId = (cid: string, managerUid: string) => `${cid}__${managerUid}`;
const covers = (d: Pick<Delegation, 'from' | 'to'>, date: string) => d.from <= date && date <= d.to;

/** The managers whose approvals this person covers on the given day. */
async function coveredManagers(cid: string, uid: string, day: string): Promise<Set<string>> {
  const snap = await db().collection('leaveDelegations').where('companyId', '==', cid).where('delegateUid', '==', uid).get();
  return new Set(snap.docs.map((d) => d.data() as Delegation).filter((d) => covers(d, day)).map((d) => d.managerUid));
}

/** Who is away today (has approved leave that covers the whole day) among these people. */
async function awayOn(cid: string, uids: string[], day: string): Promise<Set<string>> {
  const out = new Set<string>();
  await Promise.all(Array.from(new Set(uids.filter(Boolean))).map(async (uid) => {
    const list = await requestsOfUser(cid, uid);
    if (list.some((r) => (r.status === 'APPROVED' || r.status === 'CANCEL_REQUESTED') && r.detail.some((x) => x.date === day && x.value >= 1))) out.add(uid);
  }));
  return out;
}

const coverLabel = (name: string, managerName: string) => `${name} (covering for ${managerName || 'the manager'})`;

function leaveByDate(requests: LeaveRequest[]): Map<string, number> {
  const m = new Map<string, number>();
  requests.filter((r) => r.status === 'APPROVED' || r.status === 'CANCEL_REQUESTED').forEach((r) => r.detail.forEach((d) => m.set(d.date, Math.min(1, (m.get(d.date) || 0) + d.value))));
  return m;
}

function attendanceId(cid: string, uid: string, date: string) {
  return `${cid}__${uid}__${date}`;
}

export async function attendanceOfUser(cid: string, uid: string, month: string): Promise<Map<string, AttendanceRecord & { source?: string; note?: string }>> {
  const snap = await db().collection('leaveAttendance').where('companyId', '==', cid).where('uid', '==', uid).where('month', '==', month).get();
  const m = new Map<string, any>();
  snap.docs.forEach((d) => m.set(String(d.get('date')), d.data()));
  return m;
}

export function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new LeaveError(400, 'Choose a valid month.');
  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  return { from: `${month}-01`, to: lastDayOfMonth(y, m) };
}

export function buildMonth(settings: LeaveSettings, locId: string, joinDate: string, month: string, records: Map<string, any>, requests: LeaveRequest[]) {
  const { from, to } = monthRange(month);
  const loc = findLocation(settings, locId);
  const leave = leaveByDate(requests);
  // Emergency leave that is still waiting: shown as a provisional mark, never as final approved leave.
  const provisional = new Set<string>();
  requests.filter((r) => r.emergency && (r.status === 'PENDING' || r.status === 'INFO_REQUESTED')).forEach((r) => r.detail.forEach((d) => provisional.add(d.date)));
  const today = istToday();
  const days: any[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const rec = records.get(d);
    const r = computeDayStatus({ date: d, today, loc, record: rec, leaveValue: leave.get(d), shift: settings.shift, joinDate });
    const hol = loc?.holidays.find((h) => h.date === d);
    days.push({
      date: d, status: r.status, workedMinutes: r.workedMinutes, late: r.late,
      ...(hol ? { holiday: hol.name, optional: hol.optional === true } : {}),
      ...(provisional.has(d) ? { provisionalLeave: true } : {}),
      checkIn: rec?.checkIn ? istParts(rec.checkIn).time : null,
      checkOut: rec?.checkOut ? istParts(rec.checkOut).time : null,
      sessions: sessionsOf(rec).map((x) => ({ in: istParts(x.in).time, out: x.out ? istParts(x.out).time : null, inNote: x.inNote || '', outNote: x.outNote || '' })),
      source: rec?.source || null, note: rec?.note || '',
    });
  }
  return { days, summary: summarizeMonth(days.map((x) => ({ status: x.status, workedMinutes: x.workedMinutes, late: x.late })), settings.lateMarksPerHalfDay) };
}

// ------------------------------------------------------------------ self service

async function me(who: Who): Promise<Result> {
  const [{ settings, configured }, person] = await Promise.all([loadSettings(who.cid), personByUid(who.cid, who.ctx.uid)]);
  const base = { configured: configured && settings.types.length > 0, canManage: who.canManage, canReport: who.canReport };
  if (!person) return ok({ ...base, found: false });

  // One round of reads, all at the same time (the approvals count only needs the pending lists, not people's names).
  const today = istToday();
  const [profiles, people, ledger, requests, att, inbox] = await Promise.all([
    loadProfiles(who.cid), loadPeople(who.cid), userLedger(who.cid, person.uid), requestsOfUser(who.cid, person.uid),
    db().collection('leaveAttendance').doc(attendanceId(who.cid, person.uid, today)).get(),
    inboxFor(who, [], settings),
  ]);
  const prof = effectiveProfile(settings, person, profiles.get(person.uid));
  const isManager = Array.from(profiles.values()).some((p) => p.managerUid === person.uid && p.uid !== person.uid);
  const loc = findLocation(settings, prof.locationId);
  const policy = findPolicy(settings, prof.policyId);

  const balances = (policy?.entries || []).flatMap((e) => {
    const t = findType(settings, e.typeId);
    if (!t || !t.active) return [];
    const eligible = (t.gender === 'ANY' || t.gender === prof.gender);
    const cy = cycleOf(today, typeStartMonth(t, settings));
    const inCycle = ledger.filter((x) => x.typeId === t.id && x.cycle === cy.key);
    const reserved = requests.filter((r) => r.typeId === t.id && RESERVING.includes(r.status)).reduce((n, r) => n + (r.byCycle[cy.key] || 0), 0);
    const usedDays = requests.filter((r) => r.typeId === t.id && r.status === 'APPROVED').reduce((n, r) => n + (r.byCycle[cy.key] || (t.requiresBalance ? 0 : r.days)), 0);
    return [{
      typeId: t.id, code: t.code, name: t.name, color: t.color || null, paid: t.paid, isLop: !!t.isLop, requiresBalance: t.requiresBalance,
      halfDay: t.halfDay, eligible,
      balance: balanceOf(ledger, t.id, cy.key), pending: reserved, used: usedDays,
      credited: Math.round(inCycle.filter((x) => x.delta > 0).reduce((n, x) => n + x.delta, 0) * 100) / 100,
      cycleLabel: cy.label, cycleEnd: cy.end,
    }];
  });

  const rec: any = att.exists ? att.data() : null;

  return ok({
    ...base, found: true, today,
    person: { uid: person.uid, name: person.name, email: person.email, empId: person.empId },
    profile: {
      location: loc?.name || '', policy: policy?.name || '', joinDate: prof.joinDate,
      manager: nameOf(people, prof.managerUid), gender: prof.gender,
    },
    settings: {
      yearStartMonth: settings.yearStartMonth, sandwichRule: settings.sandwichRule, shift: settings.shift, cycleStartDay: settings.cycleStartDay || 1,
      types: settings.types.filter((t) => t.active).map((t) => ({ id: t.id, code: t.code, name: t.name, halfDay: t.halfDay, docRequiredAfterDays: t.docRequiredAfterDays, minNoticeDays: t.minNoticeDays })),
    },
    balances,
    holidays: (loc?.holidays || []).filter((h) => h.date >= today.slice(0, 4) + '-01-01').slice(0, 40),
    weeklyOff: loc?.weeklyOff || {},
    attendanceToday: {
      checkIn: rec?.checkIn ? istParts(rec.checkIn).time : null,
      checkOut: rec?.checkOut ? istParts(rec.checkOut).time : null,
      open: hasOpenSession(rec),
      openSince: (() => { const o = sessionsOf(rec).find((x) => !x.out); return o ? istParts(o.in).time : null; })(),
      workedMinutes: workedMinutesOf(rec),
      sessions: sessionsOf(rec).map((x) => ({ in: istParts(x.in).time, out: x.out ? istParts(x.out).time : null })),
    },
    isManager, isDelegate: inbox.covered.size > 0, approvals: inbox.leaves.length + inbox.regularizations.length,
  });
}

async function calc(who: Who, body: any): Promise<Result> {
  const c = await loadCtx(who);
  needConfigured(c);
  const prof = effectiveProfile(c.settings, c.me, await profileOf(who.cid, c.me.uid));
  try {
    const plan = await planRequest({ companyId: who.cid, settings: c.settings, person: c.me, profile: prof, input: parseApplyInput(body) });
    return ok({ valid: true, days: plan.days, steps: plan.steps, warnings: plan.warnings, balanceAfter: plan.balanceAfter, detail: plan.detail });
  } catch (e) {
    if (e instanceof LeaveError) return ok({ valid: false, error: e.message });
    throw e;
  }
}

const lockRef = (cid: string, uid: string) => db().collection('leaveLocks').doc(`${cid}__${uid}`);

async function createRequest(who: Who, c: Ctx, person: Person, body: any, opts: { onBehalf?: boolean } = {}): Promise<LeaveRequest> {
  needConfigured(c);
  const prof = effectiveProfile(c.settings, person, await profileOf(who.cid, person.uid));
  const input = parseApplyInput(body);

  if (input.docData) {
    const problem = checkAttachment(input.docData);
    if (problem) throw new LeaveError(400, problem);
  }

  // Idempotency: the same submission key never creates a second request (double click, retry, replayed call).
  const idemKey = str(body?.idempotencyKey, 60).replace(/[^A-Za-z0-9_-]/g, '');
  const id = idemKey ? `${person.uid}_${idemKey}` : db().collection('leaveRequests').doc().id;
  if (idemKey) {
    const dup = await db().collection('leaveRequests').doc(id).get();
    if (dup.exists) {
      const old = dup.data() as LeaveRequest;
      if (old.companyId === who.cid && old.uid === person.uid) return old;
    }
  }

  // Plan and write under a per-person version stamp. If another request for the same person was written while this
  // one was being checked, the stamp moved: plan again against the new state, so two requests can never both
  // spend the same balance or the same day.
  const docId = input.docData ? db().collection('leaveDocs').doc().id : '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const seq = ((await lockRef(who.cid, person.uid).get()).data() as { seq?: number } | undefined)?.seq || 0;
    const plan = await planRequest({ companyId: who.cid, settings: c.settings, person, profile: prof, input, relaxed: opts.onBehalf });
    const now = nowIso();
    const emergency = body?.emergency === true && !opts.onBehalf;
    const req: LeaveRequest = {
      id, companyId: who.cid, uid: person.uid, name: person.name, email: person.email, managerUid: prof.managerUid,
      typeId: plan.type.id, typeName: plan.type.name, typeCode: plan.type.code, requiresBalance: plan.type.requiresBalance,
      from: input.from, to: input.to, halfFrom: input.halfFrom, halfTo: input.halfTo, halfPart: input.halfPart, days: plan.days, detail: plan.detail,
      byCycle: plan.byCycle, reason: input.reason, docUrl: input.docUrl,
      ...(docId ? { privateDocId: docId, privateDocName: input.docName || 'Document' } : {}),
      policyVersion: c.settings.policyVersion || 1,
      ...(plan.warnings.length ? { warnings: plan.warnings } : {}),
      ...(emergency ? { emergency: true } : {}),
      status: opts.onBehalf ? 'APPROVED' : 'PENDING',
      steps: opts.onBehalf
        ? [{ role: 'HR', status: 'APPROVED', by: who.ctx.uid, byName: c.me.name, at: now, comment: 'Recorded by HR' }]
        : plan.steps.map((role) => ({ role, status: 'PENDING' as const })),
      stepIndex: 0, onBehalfOf: !!opts.onBehalf, createdBy: who.ctx.uid, createdAt: now, updatedAt: now,
      events: [{ at: now, by: opts.onBehalf ? c.me.name : person.name, message: opts.onBehalf ? `Recorded by ${c.me.name} (HR).` : emergency ? 'Requested as emergency leave (provisional until approved).' : 'Requested.' }],
    };
    if (opts.onBehalf) req.stepIndex = 1;
    let clash = false;
    await db().runTransaction(async (tx: any) => {
      const cur = ((await tx.get(lockRef(who.cid, person.uid))).data() as { seq?: number } | undefined)?.seq || 0;
      if (cur !== seq) { clash = true; return; }
      tx.set(lockRef(who.cid, person.uid), { companyId: who.cid, uid: person.uid, seq: seq + 1 });
      tx.set(db().collection('leaveRequests').doc(id), req);
      if (docId) {
        tx.set(db().collection('leaveDocData').doc(docId), { companyId: who.cid, uid: person.uid, dataUrl: input.docData });
        tx.set(db().collection('leaveDocs').doc(docId), { companyId: who.cid, uid: person.uid, requestId: id, name: input.docName || 'Document', kb: Math.round((input.docData.length * 3) / 4 / 1024), createdAt: now });
      }
      if (opts.onBehalf) usageEntries(req, c.settings, who.ctx.uid).forEach((e) => tx.set(ledgerRef(e.id), e.data));
    });
    if (!clash) return req;
  }
  throw new LeaveError(409, 'Another change to your leave was saved at the same moment. Please try again.');
}

async function apply(who: Who, body: any): Promise<Result> {
  const c = await loadCtx(who);
  const req = await createRequest(who, c, c.me, body);
  const people = await loadPeople(who.cid);
  const mgr = people.find((p) => p.uid === req.managerUid);
  const flag = (category: Parameters<typeof raiseException>[1]['category'], message: string, severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM') =>
    raiseException(who.cid, { category, message, severity, requestId: req.id, uid: req.uid }).catch(() => undefined);
  if (!mgr) await flag('NO_MANAGER', `${req.name} has no reporting manager, so the ${req.typeName} request went to HR.`);
  if (req.emergency) await flag('EMERGENCY_REVIEW', `${req.name} applied for emergency ${req.typeName} (${req.from} to ${req.to}). Review and regularise.`);
  if (req.from < istToday()) await flag('RETRO_LEAVE', `${req.name} applied after the fact for ${req.typeName} starting ${req.from}.`, 'LOW');
  if (req.warnings?.length) await flag('BALANCE_NEGATIVE', `${req.name}'s ${req.typeName} request takes the balance below zero.`);
  await inApp(who.cid, mgr ? [mgr.uid] : hrUids(c.settings, people), `${req.name} requested ${req.typeName}`, `${req.from} to ${req.to}, ${req.days} day(s).${req.emergency ? ' Emergency.' : ''}`, 'approvals');
  const first = req.steps[0]?.role;
  let to: string[] = first === 'MANAGER' && mgr ? [mgr.email] : c.settings.notifyEmails;
  if (first === 'MANAGER' && mgr) {
    // A manager who is away (covered by a delegate, or on approved leave) must not leave the request waiting.
    const today = istToday();
    const dsnap = await db().collection('leaveDelegations').doc(delegationId(who.cid, mgr.uid)).get();
    const del = dsnap.exists ? (dsnap.data() as Delegation) : null;
    const delegate = del && (covers(del, today) || covers(del, req.from)) ? people.find((p) => p.uid === del.delegateUid) : undefined;
    let message = '';
    if (delegate) {
      to = [mgr.email, delegate.email];
      message = `${mgr.name} is away. ${delegate.name} is covering approvals.`;
    } else if ((await awayOn(who.cid, [mgr.uid], today)).has(mgr.uid) || (await awayOn(who.cid, [mgr.uid], req.from)).has(mgr.uid)) {
      to = c.settings.notifyEmails;
      message = `${mgr.name} is on leave and has no delegate. Sent to HR.`;
    }
    if (message) {
      await db().collection('leaveRequests').doc(req.id).update({ events: [...req.events, { at: nowIso(), by: 'System', message }] });
      if (!delegate) await raiseException(who.cid, { category: 'MANAGER_AWAY', message: `${message} (${req.name}, ${req.from} to ${req.to})`, requestId: req.id, uid: mgr.uid }).catch(() => undefined);
    }
  }
  await notify(who.cid, to,
    `Leave request: ${req.name}, ${req.typeName}, ${req.from}${req.to !== req.from ? ' to ' + req.to : ''}`,
    `${req.name} has asked for ${req.days} day(s) of ${req.typeName} (${req.from} to ${req.to}).\n${req.reason ? 'Reason: ' + req.reason + '\n' : ''}\nOpen Leave & Attendance > Approvals to approve or reject.`);
  return ok({ id: req.id, status: req.status, days: req.days, steps: req.steps.map((s) => s.role), policyVersion: req.policyVersion, emergency: !!req.emergency });
}

async function myRequests(who: Who): Promise<Result> {
  const list = await requestsOfUser(who.cid, who.ctx.uid);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok({ items: list.slice(0, 200).map(viewRequest) });
}

function viewRequest(r: LeaveRequest) {
  const { detail: _d, byCycle: _b, companyId: _c, privateDocId, privateDocName, ...rest } = r;
  return { ...rest, hasPrivateDoc: !!privateDocId, privateDocName: privateDocName || '' };
}

async function cancel(who: Who, body: any): Promise<Result> {
  const id = str(body?.id, 200);
  const ref = db().collection('leaveRequests').doc(id);
  const snap = await ref.get();
  const r = snap.data() as LeaveRequest | undefined;
  if (!r || r.companyId !== who.cid || r.uid !== who.ctx.uid) return fail(404, 'Request not found.');
  const now = nowIso();
  const name = r.name;
  if (r.status === 'PENDING' || r.status === 'INFO_REQUESTED') {
    await ref.update({ status: 'WITHDRAWN', updatedAt: now, events: [...r.events, { at: now, by: name, message: 'Withdrawn by the employee.' }] });
    return ok({ status: 'WITHDRAWN' });
  }
  if (r.status === 'APPROVED') {
    if (r.from <= istToday()) return fail(409, 'This leave has already started. Ask HR to cancel it.');
    await ref.update({ status: 'CANCEL_REQUESTED', updatedAt: now, events: [...r.events, { at: now, by: name, message: 'Asked to cancel approved leave.' }] });
    const people = await loadPeople(who.cid);
    const mgr = people.find((p) => p.uid === r.managerUid);
    const { settings } = await loadSettings(who.cid);
    await notify(who.cid, mgr ? [mgr.email] : settings.notifyEmails, `Cancellation request: ${r.name}`, `${r.name} has asked to cancel approved ${r.typeName} (${r.from} to ${r.to}). Open Leave & Attendance > Approvals.`);
    return ok({ status: 'CANCEL_REQUESTED' });
  }
  return fail(409, 'This request can no longer be cancelled.');
}

// ------------------------------------------------------------------ approvals

async function inboxFor(who: Who, people: Person[], loaded?: LeaveSettings) {
  const today = istToday();
  const [snap, rs, fetched, covered] = await Promise.all([
    db().collection('leaveRequests').where('companyId', '==', who.cid).where('status', 'in', ['PENDING', 'CANCEL_REQUESTED']).get(),
    db().collection('leaveRegularizations').where('companyId', '==', who.cid).where('status', '==', 'PENDING').get(),
    loaded ? Promise.resolve(null) : loadSettings(who.cid),
    coveredManagers(who.cid, who.ctx.uid, today),
  ]);
  const settings = loaded || fetched!.settings;
  const leaves = snap.docs
    .map((d) => d.data() as LeaveRequest)
    .filter((r) => {
      if (r.uid === who.ctx.uid && !who.ctx.isCompanyAdmin) return false;
      if (who.canManage) return true;
      if (r.managerUid !== who.ctx.uid && !covered.has(r.managerUid)) return false;
      return r.status === 'CANCEL_REQUESTED' || r.steps[r.stepIndex]?.role === 'MANAGER';
    })
    .map((r) => {
      const waitingDays = Math.max(0, daysBetween(r.createdAt.slice(0, 10), today));
      return {
        ...viewRequest(r),
        stage: r.status === 'CANCEL_REQUESTED' ? 'CANCEL' : r.steps[r.stepIndex]?.role || 'HR',
        waitingDays,
        escalated: settings.escalateAfterDays > 0 && waitingDays >= settings.escalateAfterDays,
        managerName: nameOf(people, r.managerUid),
        coveringFor: !who.canManage && r.managerUid !== who.ctx.uid && covered.has(r.managerUid) ? nameOf(people, r.managerUid) : '',
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const regularizations = rs.docs
    .map((d) => d.data() as any)
    .filter((r) => (r.uid !== who.ctx.uid || who.ctx.isCompanyAdmin) && (who.canManage || r.managerUid === who.ctx.uid || covered.has(r.managerUid)))
    .map((r) => ({ ...r, coveringFor: !who.canManage && r.managerUid !== who.ctx.uid && covered.has(r.managerUid) ? nameOf(people, r.managerUid) : '' }));
  return { leaves, regularizations, covered };
}

async function inbox(who: Who): Promise<Result> {
  const people = await loadPeople(who.cid);
  const { leaves, regularizations } = await inboxFor(who, people);
  // Tell HR which requests are waiting on a manager who is on leave.
  const away = await awayOn(who.cid, leaves.map((l) => l.managerUid), istToday());
  return ok({ leaves: leaves.map((l) => ({ ...l, managerAway: away.has(l.managerUid) })), regularizations, canManage: who.canManage });
}

async function decide(who: Who, body: any): Promise<Result> {
  const c = await loadCtx(who);
  const id = str(body?.id, 200);
  const decision = str(body?.decision, 10);
  const comment = str(body?.comment, 400);
  if (decision !== 'APPROVE' && decision !== 'REJECT' && decision !== 'INFO') return fail(400, 'decision must be APPROVE, REJECT or INFO.');
  if (decision === 'INFO' && !comment) return fail(400, 'Say what you need to know.');
  const ref = db().collection('leaveRequests').doc(id);
  let approver = c.me.name;
  let result: LeaveRequest | null = null;
  let wasCancelRequest = false;
  const covered = await coveredManagers(who.cid, who.ctx.uid, istToday());

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const r = snap.data() as LeaveRequest | undefined;
    if (!r || r.companyId !== who.cid) throw new LeaveError(404, 'Request not found.');
    if (r.status !== 'PENDING' && r.status !== 'CANCEL_REQUESTED') throw new LeaveError(409, 'This request was already handled.');
    const viaDelegate = r.managerUid !== who.ctx.uid && covered.has(r.managerUid);
    const isMine = r.managerUid === who.ctx.uid || viaDelegate;
    approver = viaDelegate && !who.canManage ? coverLabel(c.me.name, (await personByUid(who.cid, r.managerUid))?.name || '') : c.me.name;
    if (r.uid === who.ctx.uid && !who.ctx.isCompanyAdmin) throw new LeaveError(403, 'You cannot approve your own request.');
    const step = r.steps[r.stepIndex];
    const allowed = who.canManage || (isMine && (r.status === 'CANCEL_REQUESTED' || step?.role === 'MANAGER'));
    if (!allowed) throw new LeaveError(403, 'This request is not waiting for you.');

    const now = nowIso();
    const events = [...r.events];
    const upd: Partial<LeaveRequest> = { updatedAt: now };
    const note = comment ? `: ${comment}` : '';

    wasCancelRequest = r.status === 'CANCEL_REQUESTED';
    if (r.status === 'CANCEL_REQUESTED') {
      if (decision === 'APPROVE') {
        upd.status = 'CANCELLED';
        events.push({ at: now, by: approver, message: `Cancellation approved${note}` });
        restoreEntries(r, who.ctx.uid).forEach((e) => tx.set(ledgerRef(e.id), e.data));
      } else {
        upd.status = 'APPROVED';
        events.push({ at: now, by: approver, message: `Cancellation declined${note}` });
      }
    } else if (decision === 'INFO') {
      if (r.status !== 'PENDING') throw new LeaveError(409, 'Only a request that is waiting for a decision can be sent back.');
      upd.status = 'INFO_REQUESTED';
      events.push({ at: now, by: approver, message: `More information needed: ${comment}` });
    } else if (decision === 'REJECT') {
      upd.status = 'REJECTED';
      upd.steps = r.steps.map((s, i) => (i === r.stepIndex ? { ...s, status: 'REJECTED' as const, by: who.ctx.uid, byName: approver, at: now, comment } : s));
      events.push({ at: now, by: approver, message: `Rejected${note}` });
    } else {
      const steps = r.steps.map((s, i) => (i === r.stepIndex ? { ...s, status: 'APPROVED' as const, by: who.ctx.uid, byName: approver, at: now, comment } : s));
      upd.steps = steps;
      if (r.stepIndex + 1 >= steps.length) {
        upd.status = 'APPROVED';
        upd.stepIndex = r.stepIndex + 1;
        usageEntries(r, c.settings, who.ctx.uid).forEach((e) => tx.set(ledgerRef(e.id), e.data));
        events.push({ at: now, by: approver, message: `Approved${note}` });
      } else {
        upd.stepIndex = r.stepIndex + 1;
        events.push({ at: now, by: approver, message: `Approved at ${step.role === 'MANAGER' ? 'manager' : 'HR'} level${note}. Waiting for HR.` });
      }
    }
    if (upd.status === 'APPROVED' || upd.status === 'REJECTED') upd.decisionPolicyVersion = c.settings.policyVersion || 1;
    upd.events = events;
    result = { ...r, ...upd } as LeaveRequest;
    tx.update(ref, upd as any);
  });

  const r = result as LeaveRequest | null;
  if (r) {
    await inApp(who.cid, [r.uid], r.status === 'INFO_REQUESTED' ? `More information needed: ${r.typeName}` : `Your ${r.typeName} request: ${r.status.toLowerCase().replace('_', ' ')}`,
      `${r.from} to ${r.to}.${comment ? ' ' + comment : ''}`, 'my').catch(() => undefined);
    if (r.status === 'APPROVED' && r.requiresBalance) await lowBalanceAlert(who.cid, r, c.settings).catch(() => undefined);
    {
      const t = findType(c.settings, r.typeId);
      const unpaid = !!t && (!t.paid || !!t.isLop);
      // Leave approved or cancelled after its payroll month was locked becomes a correction in the next open month.
      if (r.status === 'APPROVED' && !wasCancelRequest) await postCorrections(who.cid, r, unpaid, 'ADD', { name: approver, uid: who.ctx.uid }).catch(() => undefined);
      if (r.status === 'CANCELLED') await postCorrections(who.cid, r, unpaid, 'REFUND', { name: approver, uid: who.ctx.uid }).catch(() => undefined);
    }
    if (r.status === 'INFO_REQUESTED') {
      await notify(who.cid, [r.email], `More information needed for your ${r.typeName} request`,
        `${approver} needs more information about your ${r.typeName} request (${r.from} to ${r.to}): ${comment}\nOpen Leave & Attendance > My leave to reply. The request stays on hold until you do.`);
    } else if (r.status === 'APPROVED' || r.status === 'REJECTED' || r.status === 'CANCELLED') {
      await notify(who.cid, [r.email], `Your ${r.typeName} request was ${r.status.toLowerCase()}`,
        `Your ${r.typeName} request (${r.from} to ${r.to}) was ${r.status.toLowerCase()} by ${approver}.${comment ? '\nComment: ' + comment : ''}`);
    } else if (r.status === 'PENDING') {
      await notify(who.cid, c.settings.notifyEmails, `Leave request needs HR approval: ${r.name}`, `${r.name}'s ${r.typeName} request (${r.from} to ${r.to}) was approved by the manager and now needs HR approval.`);
    }
  }
  return ok({ status: r?.status });
}

/** The employee answers a request for more information; the request goes back to the approver. */
async function respond(who: Who, body: any): Promise<Result> {
  const id = str(body?.id, 200);
  const message = str(body?.message, 600);
  if (!message) return fail(400, 'Write your reply.');
  const ref = db().collection('leaveRequests').doc(id);
  const snap = await ref.get();
  const r = snap.data() as LeaveRequest | undefined;
  if (!r || r.companyId !== who.cid || r.uid !== who.ctx.uid) return fail(404, 'Request not found.');
  if (r.status !== 'INFO_REQUESTED') return fail(409, 'This request is not waiting for your reply.');
  const now = nowIso();
  const docUrl = body?.docUrl === undefined ? r.docUrl : str(body.docUrl, 500);
  await ref.update({ status: 'PENDING', docUrl, updatedAt: now, events: [...r.events, { at: now, by: r.name, message: `Replied: ${message}` }] });
  const people = await loadPeople(who.cid);
  const mgr = people.find((p) => p.uid === r.managerUid);
  const { settings } = await loadSettings(who.cid);
  const role = r.steps[r.stepIndex]?.role;
  await inApp(who.cid, role === 'MANAGER' && mgr ? [mgr.uid] : hrUids(settings, people), `${r.name} replied`, `About their ${r.typeName} request (${r.from} to ${r.to}).`, 'approvals').catch(() => undefined);
  await notify(who.cid, role === 'MANAGER' && mgr ? [mgr.email] : settings.notifyEmails, `${r.name} replied about their ${r.typeName} request`, `${r.name} answered your question: ${message}\nThe request is waiting for your decision again.`);
  return ok({ status: 'PENDING' });
}

// ------------------------------------------------------------------ delegation endpoints

async function isManagerOf(cid: string, uid: string): Promise<boolean> {
  const snap = await db().collection('leaveProfiles').where('companyId', '==', cid).where('managerUid', '==', uid).limit(1).get();
  return !snap.empty;
}

async function getDelegation(who: Who): Promise<Result> {
  const today = istToday();
  const [people, mine, asDelegate, all, manager] = await Promise.all([
    loadPeople(who.cid),
    db().collection('leaveDelegations').doc(delegationId(who.cid, who.ctx.uid)).get(),
    db().collection('leaveDelegations').where('companyId', '==', who.cid).where('delegateUid', '==', who.ctx.uid).get(),
    who.canManage ? db().collection('leaveDelegations').where('companyId', '==', who.cid).get() : Promise.resolve(null),
    isManagerOf(who.cid, who.ctx.uid),
  ]);
  const name = (uid: string) => nameOf(people, uid);
  const live = (d: Delegation) => d.to >= today;
  const view = (d: Delegation) => ({ managerUid: d.managerUid, managerName: name(d.managerUid), delegateUid: d.delegateUid, delegateName: name(d.delegateUid), from: d.from, to: d.to });
  const m = mine.exists ? (mine.data() as Delegation) : null;
  return ok({
    canSet: manager || who.canManage,
    hr: who.canManage,
    mine: m && live(m) ? view(m) : null,
    covering: asDelegate.docs.map((d) => d.data() as Delegation).filter(live).map(view),
    all: all ? all.docs.map((d) => d.data() as Delegation).filter(live).map(view) : [],
    candidates: people.filter((p) => p.active && p.uid !== who.ctx.uid).map((p) => ({ uid: p.uid, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)),
  });
}

async function setDelegation(who: Who, body: any): Promise<Result> {
  const c = await loadCtx(who);
  const managerUid = str(body?.managerUid, 128) || who.ctx.uid;
  if (managerUid !== who.ctx.uid) needManage(who);
  else if (!who.canManage && !(await isManagerOf(who.cid, who.ctx.uid))) return fail(403, 'Only managers can choose someone to approve for them.');
  const delegateUid = str(body?.delegateUid, 128);
  const from = str(body?.from, 10);
  const to = str(body?.to, 10);
  const today = istToday();
  if (!isIsoDate(from) || !isIsoDate(to)) return fail(400, 'Choose the dates.');
  if (from < today) return fail(400, 'The start date cannot be in the past.');
  if (to < from) return fail(400, 'The end date must be on or after the start date.');
  if (daysBetween(from, to) > 90) return fail(400, 'Choose at most 90 days.');
  if (delegateUid === managerUid) return fail(400, 'Choose someone else.');
  const [manager, delegate] = await Promise.all([personByUid(who.cid, managerUid), personByUid(who.cid, delegateUid)]);
  if (!manager) return fail(404, 'Manager not found.');
  if (!delegate || !delegate.active) return fail(404, 'Choose an active colleague.');
  const doc: Delegation = { companyId: who.cid, managerUid, delegateUid, from, to, createdBy: who.ctx.uid, createdAt: nowIso() };
  await db().collection('leaveDelegations').doc(delegationId(who.cid, managerUid)).set(doc);
  const when = from === to ? from : `${from} to ${to}`;
  await notify(who.cid, [delegate.email], `You will approve leave for ${manager.name} (${when})`,
    `${manager.name} is away ${when}. During this time you can approve or reject the leave and attendance requests of their team.\nOpen Leave & Attendance > Approvals.${managerUid !== who.ctx.uid ? `\nSet by ${c.me.name} (HR).` : ''}`);
  if (managerUid !== who.ctx.uid) await notify(who.cid, [manager.email], `${delegate.name} will approve for you (${when})`, `${c.me.name} (HR) chose ${delegate.name} to approve your team's requests while you are away (${when}).`);
  return ok({});
}

async function clearDelegation(who: Who, body: any): Promise<Result> {
  const managerUid = str(body?.managerUid, 128) || who.ctx.uid;
  if (managerUid !== who.ctx.uid) needManage(who);
  await db().collection('leaveDelegations').doc(delegationId(who.cid, managerUid)).delete();
  return ok({});
}

async function hrCancel(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const ref = db().collection('leaveRequests').doc(str(body?.id, 200));
  let cancelled: LeaveRequest | null = null;
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const r = snap.data() as LeaveRequest | undefined;
    if (!r || r.companyId !== who.cid) throw new LeaveError(404, 'Request not found.');
    if (!ACTIVE_STATUSES.includes(r.status)) throw new LeaveError(409, 'This request is already closed.');
    const now = nowIso();
    if (r.status === 'APPROVED' || r.status === 'CANCEL_REQUESTED') restoreEntries(r, who.ctx.uid).forEach((e) => tx.set(ledgerRef(e.id), e.data));
    cancelled = r;
    tx.update(ref, { status: 'CANCELLED', updatedAt: now, events: [...r.events, { at: now, by: c.me.name, message: `Cancelled by HR${body?.note ? ': ' + str(body.note, 300) : ''}` }] });
  });
  const was = cancelled as LeaveRequest | null;
  if (was) {
    if (was.status === 'APPROVED' || was.status === 'CANCEL_REQUESTED') {
      const t = findType(c.settings, was.typeId);
      await postCorrections(who.cid, was, !!t && (!t.paid || !!t.isLop), 'REFUND', { name: c.me.name, uid: who.ctx.uid }).catch(() => undefined);
    }
    await audit(who.cid, 'leave-request', was.id, 'HR_CANCELLED_LEAVE', { name: c.me.name, uid: who.ctx.uid }, { status: was.status }, { status: 'CANCELLED', note: str(body?.note, 300) });
  }
  return ok({});
}

async function hrCreate(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const person = await personByUid(who.cid, str(body?.uid, 128));
  if (!person) return fail(404, 'Employee not found.');
  const req = await createRequest(who, c, person, body, { onBehalf: true });
  {
    const t = findType(c.settings, req.typeId);
    await postCorrections(who.cid, req, !!t && (!t.paid || !!t.isLop), 'ADD', { name: c.me.name, uid: who.ctx.uid }).catch(() => undefined);
  }
  await audit(who.cid, 'leave-request', req.id, 'HR_RECORDED_LEAVE', { name: c.me.name, uid: who.ctx.uid }, null, { employee: person.name, type: req.typeName, from: req.from, to: req.to, days: req.days });
  await notify(who.cid, [person.email], `Leave recorded: ${req.typeName}`, `HR recorded ${req.days} day(s) of ${req.typeName} for you (${req.from} to ${req.to}).`);
  return ok({ id: req.id, days: req.days });
}

// ------------------------------------------------------------------ team calendar

// ------------------------------------------------------------------ helpers that explain and prepare (they never decide)

async function assistAsk(who: Who, body: any): Promise<Result> {
  const c = await loadCtx(who);
  needConfigured(c);
  const question = String(body?.question || '').trim().slice(0, 300);
  if (!question) return fail(400, 'Ask a question about the leave policy.');
  const profiles = await loadProfiles(who.cid);
  const prof = effectiveProfile(c.settings, c.me, profiles.get(c.me.uid));
  const a = answerPolicyQuestion(question, c.settings, prof.policyId);
  const w = a.answered ? await polishWording(a.answer) : { text: a.answer, ai: false };
  return ok({ answer: w.text, policyReference: a.reference, policyVersion: c.settings.policyVersion || 1, answered: a.answered, aiWording: w.ai, requiresHumanDecision: true });
}

/** Turns a sentence into a draft form. The employee checks it and sends it through the normal apply. */
async function assistDraft(who: Who, body: any): Promise<Result> {
  const c = await loadCtx(who);
  needConfigured(c);
  const profiles = await loadProfiles(who.cid);
  const prof = effectiveProfile(c.settings, c.me, profiles.get(c.me.uid));
  const policy = findPolicy(c.settings, prof.policyId);
  const types = (policy?.entries || []).flatMap((e) => { const t = findType(c.settings, e.typeId); return t && t.active && (t.gender === 'ANY' || t.gender === prof.gender) ? [t] : []; });
  const loc = findLocation(c.settings, prof.locationId);
  const parsed = parseLeaveText(String(body?.text || ''), istToday(), types, [0, 1, 2, 3, 4, 5, 6].filter((w) => !loc?.weeklyOff?.[String(w)]));
  return ok({ ...parsed, policyVersion: c.settings.policyVersion || 1, requiresHumanDecision: true, note: 'This is only a draft. Check it, then send it; days and balance are worked out when you apply.' });
}

/** Days when part of a person's team is away at the same time (for a manager or HR). */
async function assistCover(who: Who, q: any): Promise<Result> {
  const c = await loadCtx(who);
  const from = isIsoDate(q.from) ? q.from : istToday();
  const to = isIsoDate(q.to) ? q.to : addDays(from, 30);
  if (daysBetween(from, to) > 100) return fail(400, 'Choose a shorter range.');
  const [profiles, requests] = await Promise.all([loadProfiles(who.cid), companyRequests(who.cid)]);
  const team = Array.from(profiles.values()).filter((p) => p.managerUid === c.me.uid && p.uid !== c.me.uid).map((p) => p.uid);
  if (!who.canReport && team.length === 0) return ok({ from, to, teamSize: 0, gaps: [] });
  const scope = who.canReport && team.length === 0 ? Array.from(profiles.keys()) : team;
  const away = new Map<string, string[]>();
  for (const r of requests) {
    if (!scope.includes(r.uid) || !['PENDING', 'APPROVED', 'CANCEL_REQUESTED', 'INFO_REQUESTED'].includes(r.status) || r.from > to || r.to < from) continue;
    for (let d = r.from < from ? from : r.from; d <= r.to && d <= to; d = addDays(d, 1)) away.set(d, [...(away.get(d) || []), r.name]);
  }
  return ok({ from, to, teamSize: scope.length, gaps: coverageGaps(scope.length, away, from, to) });
}

async function teamCalendar(who: Who, q: any): Promise<Result> {
  const c = await loadCtx(who);
  const from = isIsoDate(q.from) ? q.from : istToday().slice(0, 8) + '01';
  const to = isIsoDate(q.to) ? q.to : addDays(from, 30);
  if (daysBetween(from, to) > 100) return fail(400, 'Choose a shorter range.');
  const [people, profiles, requests] = await Promise.all([loadPeople(who.cid), loadProfiles(who.cid), companyRequests(who.cid)]);
  const mine = profiles.get(c.me.uid);
  const myMgr = mine?.managerUid || '';
  const visible = (uid: string) => {
    if (who.canReport || uid === c.me.uid) return true;
    const p = profiles.get(uid);
    if (myMgr) return p?.managerUid === myMgr || uid === myMgr || p?.managerUid === c.me.uid;
    const them = people.find((x) => x.uid === uid);
    return (them?.department || '-') === (c.me.department || '+') || p?.managerUid === c.me.uid;
  };
  const items = requests
    .filter((r) => ['PENDING', 'APPROVED', 'CANCEL_REQUESTED', 'INFO_REQUESTED'].includes(r.status) && r.from <= to && r.to >= from && visible(r.uid))
    .map((r) => {
      const detailed = who.canReport || r.uid === c.me.uid || profiles.get(r.uid)?.managerUid === c.me.uid;
      return {
        uid: r.uid, name: r.name, from: r.from, to: r.to, days: r.days, status: r.status === 'PENDING' || r.status === 'INFO_REQUESTED' ? 'PENDING' : 'APPROVED',
        halfDay: r.days === 0.5, type: detailed ? r.typeName : null, reason: detailed ? r.reason : null,
      };
    });
  const loc = findLocation(c.settings, effectiveProfile(c.settings, c.me, mine).locationId);
  return ok({ from, to, items, holidays: (loc?.holidays || []).filter((h) => h.date >= from && h.date <= to) });
}

// ------------------------------------------------------------------ attendance

function ipAllowed(settings: LeaveSettings, ip?: string): boolean {
  if (settings.allowedIps.length === 0) return true;
  const v = (ip || '').replace(/^::ffff:/, '');
  return settings.allowedIps.some((a) => v === a || (a.endsWith('.') && v.startsWith(a)));
}

const MAX_SESSIONS = 12;

async function punch(who: Who, kind: 'in' | 'out', ip?: string, body?: any): Promise<Result> {
  const c = await loadCtx(who);
  if (!ipAllowed(c.settings, ip)) return fail(403, 'Check in from your office network.');
  const date = istToday();
  const ref = db().collection('leaveAttendance').doc(attendanceId(who.cid, c.me.uid, date));
  const snap = await ref.get();
  const rec: any = snap.exists ? snap.data() : null;
  const now = nowIso();
  const remarks = str(body?.remarks, 200);
  const sessions: PunchSession[] = sessionsOf(rec).map((x) => ({ ...x }));
  const open = sessions[sessions.length - 1] && !sessions[sessions.length - 1].out ? sessions[sessions.length - 1] : null;
  if (kind === 'in') {
    if (open) return fail(409, `You are already checked in since ${istParts(open.in).time}.`);
    if (sessions.length >= MAX_SESSIONS) return fail(409, `You can check in at most ${MAX_SESSIONS} times a day.`);
    const last = sessions[sessions.length - 1];
    if (last?.out && new Date(now).getTime() - new Date(last.out).getTime() < 60_000) return fail(409, 'Please wait a minute before checking in again.');
    sessions.push({ in: now, out: null, inNote: remarks });
    await ref.set({
      companyId: who.cid, uid: c.me.uid, date, month: date.slice(0, 7), checkIn: sessions[0].in, checkOut: null, sessions,
      source: rec?.source || 'SELF', ip: ip || rec?.ip || '', inNote: sessions[0].inNote || '', outNote: rec?.outNote || '', updatedAt: now,
    });
    return ok({ time: istParts(now).time });
  }
  if (!open) return fail(409, 'Check in first.');
  if (new Date(now).getTime() - new Date(open.in).getTime() < 60_000) return fail(409, 'Please wait a minute before checking out.');
  open.out = now;
  open.outNote = remarks;
  await ref.update({ sessions, checkOut: now, outNote: remarks, updatedAt: now });
  return ok({ time: istParts(now).time });
}

async function canSee(who: Who, c: Ctx, uid: string): Promise<boolean> {
  if (uid === c.me.uid || who.canReport) return true;
  const p = await profileOf(who.cid, uid);
  return p?.managerUid === c.me.uid;
}

async function attendance(who: Who, q: any): Promise<Result> {
  const c = await loadCtx(who);
  const uid = str(q.uid, 128) || c.me.uid;
  if (!(await canSee(who, c, uid))) return fail(403, 'You cannot view this person.');
  const person = uid === c.me.uid ? c.me : await personByUid(who.cid, uid);
  if (!person) return fail(404, 'Employee not found.');
  const month = str(q.month, 7) || istToday().slice(0, 7);
  const prof = effectiveProfile(c.settings, person, await profileOf(who.cid, uid));
  const [records, requests] = await Promise.all([attendanceOfUser(who.cid, uid, month), requestsOfUser(who.cid, uid)]);
  return ok({ month, person: { uid, name: person.name }, ...buildMonth(c.settings, prof.locationId, prof.joinDate, month, records, requests) });
}

/** Who this person may open attendance for: themselves, their direct reports, or everyone when they run reports. */
async function visiblePeople(who: Who, c: Ctx): Promise<Person[]> {
  const [people, profiles] = await Promise.all([loadPeople(who.cid), loadProfiles(who.cid)]);
  const mayOpen = (uid: string) => uid === c.me.uid || who.canReport || profiles.get(uid)?.managerUid === c.me.uid;
  return people
    .filter((p) => p.active && !profiles.get(p.uid)?.hidden && mayOpen(p.uid))
    .sort((a, b) => (a.uid === c.me.uid ? -1 : b.uid === c.me.uid ? 1 : a.name.localeCompare(b.name)));
}

async function attendancePeople(who: Who): Promise<Result> {
  const c = await loadCtx(who);
  const items = (await visiblePeople(who, c)).map((p) => ({ uid: p.uid, name: p.name, empId: p.empId, department: p.department }));
  return ok({ items, me: c.me.uid });
}

const MAX_REPORT_DAYS = 93;

/**
 * Day-by-day attendance for the report pages: one employee, or everyone this person may see.
 * The page builds each report (late, absent, in/out ...) from this one list.
 */
async function attendanceReport(who: Who, q: any): Promise<Result> {
  const c = await loadCtx(who);
  const from = str(q.from, 10);
  const to = str(q.to, 10);
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) return fail(400, 'Choose a valid date range.');
  if (daysBetween(from, to) + 1 > MAX_REPORT_DAYS) return fail(400, `Choose a range of at most ${MAX_REPORT_DAYS} days.`);
  const visible = await visiblePeople(who, c);
  const uid = str(q.uid, 128);
  const chosen = uid ? visible.filter((p) => p.uid === uid) : visible;
  if (uid && chosen.length === 0) return fail(403, 'You cannot view this person.');
  const wanted = new Set(chosen.map((p) => p.uid));

  const months: string[] = [];
  for (let d = from.slice(0, 7); d <= to.slice(0, 7); d = addDays(`${d}-01`, 32).slice(0, 7)) months.push(d);
  const [profiles, reqs, ...snaps] = await Promise.all([
    loadProfiles(who.cid), companyRequests(who.cid),
    ...months.map((m) => db().collection('leaveAttendance').where('companyId', '==', who.cid).where('month', '==', m).get()),
  ]);
  const recs = new Map<string, Map<string, any>>();
  snaps.forEach((snap: any) => snap.docs.forEach((d: any) => {
    const x = d.data();
    if (!wanted.has(x.uid)) return;
    if (!recs.has(x.uid)) recs.set(x.uid, new Map());
    recs.get(x.uid)!.set(x.date, x);
  }));

  const people = chosen.map((p) => {
    const prof = effectiveProfile(c.settings, p, profiles.get(p.uid));
    const mine = reqs.filter((r) => r.uid === p.uid);
    const days: any[] = [];
    months.forEach((m) => {
      buildMonth(c.settings, prof.locationId, prof.joinDate, m, recs.get(p.uid) || new Map(), mine).days.forEach((d: any) => {
        if (d.date >= from && d.date <= to) days.push(d);
      });
    });
    return { uid: p.uid, name: p.name, empId: p.empId, department: p.department, days };
  });
  const sh = c.settings.shift;
  return ok({ from, to, company: await companyLabel(who.cid), shift: { start: sh.start, end: sh.end, graceMinutes: sh.graceMinutes, fullDayMinutes: sh.fullDayMinutes }, today: istToday(), people });
}

/** Attendance applications still waiting for a decision, for the people this person may see. */
async function pendingApplications(who: Who): Promise<Result> {
  const c = await loadCtx(who);
  const visible = new Set((await visiblePeople(who, c)).map((p) => p.uid));
  const snap = await db().collection('leaveRegularizations').where('companyId', '==', who.cid).where('status', '==', 'PENDING').get();
  const today = istToday();
  const items = snap.docs.map((d: any) => d.data()).filter((r: any) => visible.has(r.uid))
    .map((r: any) => ({
      id: r.id, docNo: r.docNo || '', uid: r.uid, name: r.name, date: r.date, checkIn: r.checkIn || '', checkOut: r.checkOut || '', reason: r.reason || '',
      appliedByName: r.appliedByName || r.name, appliedOn: String(r.createdAt || '').slice(0, 10), waitingDays: Math.max(0, daysBetween(String(r.createdAt || '').slice(0, 10) || today, today)),
    }))
    .sort((a: any, b: any) => a.appliedOn.localeCompare(b.appliedOn));
  return ok({ items });
}

const docNo = () => `AA-${istToday().slice(2).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

/**
 * Puts a correction on top of what is recorded. Both times = the day becomes one stretch. Only an in time or only an out
 * time changes the first in or the last out and keeps the rest. Returns the new record fields, or the reason it cannot be done.
 */
function mergeCorrection(date: string, ci: string, co: string, outDate: string, existing: any): { checkIn: string; checkOut: string; sessions: PunchSession[] } | { error: string } {
  const newIn = ci ? istToInstant(date, ci) : '';
  const newOut = co ? istToInstant(outDate || date, co) : '';
  let ss: PunchSession[] = sessionsOf(existing).map((x) => ({ ...x }));
  if (newIn && newOut) ss = [{ in: newIn, out: newOut }];
  else {
    if (ss.length === 0) return { error: 'There are no punches for that day, so give both the time in and the time out.' };
    if (newIn) ss[0].in = newIn;
    if (newOut) ss[ss.length - 1].out = newOut;
  }
  for (const x of ss) if (x.out && new Date(x.out).getTime() <= new Date(x.in).getTime()) return { error: 'The time out must be after the time in.' };
  return { checkIn: ss[0].in, checkOut: ss[ss.length - 1].out || null as any, sessions: ss };
}

/**
 * Attendance application: one form, one or more days. Anyone can apply for themselves, a manager for their reports
 * (HR approves), and HR for anyone (applied straight away). Back to the joining date.
 */
async function applyAttendance(who: Who, body: any): Promise<Result> {
  const c = await loadCtx(who);
  const forUid = str(body?.uid, 128) || c.me.uid;
  const mine = forUid === c.me.uid;
  const target: Person | undefined = mine ? c.me : await personByUid(who.cid, forUid);
  if (!target) return fail(404, 'Employee not found.');
  const targetProf = effectiveProfile(c.settings, target, await profileOf(who.cid, forUid));
  if (!mine && !who.canManage && targetProf.managerUid !== c.me.uid) return fail(403, 'You can only apply for your own team.');

  const rawRows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  if (rawRows.length === 0) return fail(400, 'Add at least one day.');
  if (rawRows.length > 31) return fail(400, 'Apply for at most 31 days in one form.');
  const today = istToday();
  const floor = targetProf.joinDate && isIsoDate(targetProf.joinDate) ? targetProf.joinDate : addDays(today, -366);
  const remarks = str(body?.remarks, 400);

  const pending = await db().collection('leaveRegularizations').where('companyId', '==', who.cid).where('uid', '==', forUid).get();
  const pendingDates = new Set(pending.docs.map((d: any) => d.data()).filter((r: any) => r.status === 'PENDING').map((r: any) => r.date));
  const seen = new Set<string>();
  const rows: { date: string; checkIn: string; checkOut: string; outDate: string; reason: string }[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const x = rawRows[i];
    const n = `Row ${i + 1}: `;
    const date = str(x?.date, 10);
    if (!isIsoDate(date) || date > today) return fail(400, `${n}choose a date that is not in the future.`);
    if (date < floor) return fail(400, `${n}that is before the joining date (${floor}).`);
    if (seen.has(date)) return fail(400, `${n}${date} is listed twice.`);
    if (pendingDates.has(date)) return fail(400, `${n}${date} already has a request waiting for approval.`);
    seen.add(date);
    const ci = str(x?.checkIn, 5);
    const co = str(x?.checkOut, 5);
    if ((ci && !Number.isFinite(timeToMinutes(ci))) || (co && !Number.isFinite(timeToMinutes(co)))) return fail(400, `${n}enter valid times.`);
    if (!ci && !co) return fail(400, `${n}give a time in, a time out, or both.`);
    const outDate = str(x?.outDate, 10) || date;
    if (!isIsoDate(outDate) || outDate < date || outDate > addDays(date, 1)) return fail(400, `${n}the out date must be the same day or the next day.`);
    const reason = str(x?.reason, 400);
    if (!reason) return fail(400, `${n}give a reason.`);
    const existing = await db().collection('leaveAttendance').doc(attendanceId(who.cid, forUid, date)).get();
    const merged = mergeCorrection(date, ci, co, outDate, existing.exists ? existing.data() : null);
    if ('error' in merged) return fail(400, `${n}${merged.error}`);
    rows.push({ date, checkIn: ci, checkOut: co, outDate, reason });
  }

  const no = docNo();
  const now = nowIso();
  const direct = !mine && who.canManage; // HR applying for someone: applied straight away
  const approverUid = mine ? targetProf.managerUid : ''; // a manager applying for a report: HR approves
  const batch = db().batch();
  const ids: string[] = [];
  rows.forEach((r, i) => {
    const id = db().collection('leaveRegularizations').doc().id;
    ids.push(id);
    batch.set(db().collection('leaveRegularizations').doc(id), {
      id, docNo: no, rowNo: i + 1, remarks, companyId: who.cid, uid: forUid, name: target.name, email: target.email, managerUid: approverUid,
      date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, outDate: r.outDate, reason: r.reason,
      appliedBy: c.me.uid, appliedByName: c.me.name, onBehalf: !mine,
      status: direct ? 'APPROVED' : 'PENDING', createdAt: now, ...(direct ? { decidedBy: c.me.name, decidedAt: now } : {}),
    });
  });
  await batch.commit();
  if (direct) {
    for (const r of rows) {
      const ref = db().collection('leaveAttendance').doc(attendanceId(who.cid, forUid, r.date));
      const snap = await ref.get();
      const m = mergeCorrection(r.date, r.checkIn, r.checkOut, r.outDate, snap.exists ? snap.data() : null);
      if ('error' in m) continue;
      await ref.set({ companyId: who.cid, uid: forUid, date: r.date, month: r.date.slice(0, 7), ...m, source: 'REGULARIZED', note: r.reason, updatedAt: now, updatedBy: c.me.name });
    }
    await notify(who.cid, [target.email], `Attendance updated (${no})`, `${c.me.name} (HR) updated your attendance for ${rows.map((r) => r.date).join(', ')}.`);
  } else {
    const people = await loadPeople(who.cid);
    const mgr = approverUid ? people.find((p) => p.uid === approverUid) : undefined;
    await notify(who.cid, mgr ? [mgr.email] : c.settings.notifyEmails, `Attendance application ${no}: ${target.name}`,
      `${c.me.name} applied to correct attendance${mine ? '' : ` for ${target.name}`}: ${rows.map((r) => `${r.date} (${r.checkIn || 'in unchanged'} to ${r.checkOut || 'out unchanged'})`).join('; ')}.\n${remarks ? `Remarks: ${remarks}\n` : ''}Open Leave & Attendance > Approvals.`);
  }
  return ok({ id: ids[0], ids, docNo: no, count: rows.length, applied: direct });
}

async function regularize(who: Who, body: any): Promise<Result> {
  return applyAttendance(who, { remarks: '', rows: [{ date: body?.date, checkIn: body?.checkIn, checkOut: body?.checkOut, reason: body?.reason }] });
}

async function myRegularizations(who: Who): Promise<Result> {
  const snap = await db().collection('leaveRegularizations').where('companyId', '==', who.cid).where('uid', '==', who.ctx.uid).get();
  const items = snap.docs.map((d) => d.data()).sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 60);
  return ok({ items });
}

async function decideRegularization(who: Who, body: any): Promise<Result> {
  const c = await loadCtx(who);
  const ref = db().collection('leaveRegularizations').doc(str(body?.id, 60));
  const snap = await ref.get();
  const r: any = snap.data();
  if (!r || r.companyId !== who.cid) return fail(404, 'Request not found.');
  if (r.status !== 'PENDING') return fail(409, 'This was already handled.');
  if (r.uid === who.ctx.uid && !who.ctx.isCompanyAdmin) return fail(403, 'You cannot approve your own request.');
  const covered = await coveredManagers(who.cid, who.ctx.uid, istToday());
  const viaDelegate = r.managerUid !== who.ctx.uid && covered.has(r.managerUid);
  if (!who.canManage && r.managerUid !== who.ctx.uid && !viaDelegate) return fail(403, 'This request is not waiting for you.');
  const decider = viaDelegate && !who.canManage ? coverLabel(c.me.name, (await personByUid(who.cid, r.managerUid))?.name || '') : c.me.name;
  const approve = str(body?.decision, 10) === 'APPROVE';
  const now = nowIso();
  const batch = db().batch();
  batch.update(ref, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: decider, decidedAt: now, comment: str(body?.comment, 300) });
  if (approve) {
    const attRef = db().collection('leaveAttendance').doc(attendanceId(who.cid, r.uid, r.date));
    const cur = await attRef.get();
    const m = mergeCorrection(r.date, r.checkIn || '', r.checkOut || '', r.outDate || r.date, cur.exists ? cur.data() : null);
    if ('error' in m) return fail(409, m.error);
    batch.set(attRef, {
      companyId: who.cid, uid: r.uid, date: r.date, month: r.date.slice(0, 7), ...m,
      source: 'REGULARIZED', note: r.reason, updatedAt: now, updatedBy: c.me.name,
    });
  }
  await batch.commit();
  await notify(who.cid, [r.email], `Attendance correction ${approve ? 'approved' : 'rejected'} (${r.date})`, `Your attendance correction for ${r.date} was ${approve ? 'approved' : 'rejected'} by ${decider}.`);
  return ok({});
}

async function markAttendance(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const uid = str(body?.uid, 128);
  const date = str(body?.date, 10);
  const person = await personByUid(who.cid, uid);
  if (!person || !isIsoDate(date)) return fail(400, 'Choose an employee and a date.');
  const ref = db().collection('leaveAttendance').doc(attendanceId(who.cid, uid, date));
  if (body?.clear === true) {
    await ref.delete();
    return ok({});
  }
  const ci = str(body?.checkIn, 5);
  const co = str(body?.checkOut, 5);
  if (!Number.isFinite(timeToMinutes(ci)) || !Number.isFinite(timeToMinutes(co)) || timeToMinutes(co) <= timeToMinutes(ci)) return fail(400, 'Enter valid in and out times.');
  await ref.set({
    companyId: who.cid, uid, date, month: date.slice(0, 7), checkIn: istToInstant(date, ci), checkOut: istToInstant(date, co),
    sessions: [{ in: istToInstant(date, ci), out: istToInstant(date, co) }],
    source: 'HR', note: str(body?.note, 200), updatedAt: nowIso(), updatedBy: c.me.name,
  });
  return ok({});
}

// ------------------------------------------------------------------ HR: setup, people, balances

async function getSettings(who: Who): Promise<Result> {
  needManage(who);
  const { settings, configured } = await loadSettings(who.cid);
  return ok({ settings, configured });
}

async function postSettings(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const { settings } = await loadSettings(who.cid);
  if (c.configured && settings.requireApproval) return fail(409, 'Policy changes need approval. Save a draft, submit it, and an administrator publishes it.');
  const clean = sanitizeSettings(body?.settings, settings);
  const saved = await saveSettings(who.cid, clean, c.me.name, who.ctx.uid);
  // Post any credits that are now due under the new rules (months already credited are left as they are).
  const accrual = await runAccrual(who.cid).catch(() => null);
  return ok({ settings: { ...clean, policyVersion: saved.version }, accrual, version: saved.version, changes: saved.changes.map((x) => x.text) });
}

async function applyStarter(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const { settings, configured } = await loadSettings(who.cid);
  if (configured && settings.types.length > 0 && body?.replace !== true) return fail(409, 'Leave is already set up. Confirm to replace it.');
  const year = Math.min(2100, Math.max(2020, parseInt(str(body?.year, 4), 10) || new Date().getUTCFullYear()));
  const start = starterSettings(year);
  const fy = body?.yearStartMonth === 1 ? 1 : 4;
  start.yearStartMonth = fy;
  start.locations[0].holidays = [...nationalHolidays(year), ...nationalHolidays(year + 1)];
  await saveSettings(who.cid, start, c.me.name, who.ctx.uid);
  return ok({ settings: start });
}

async function people(who: Who): Promise<Result> {
  needManage(who);
  const [{ settings }, list, profiles] = await Promise.all([loadSettings(who.cid), loadPeople(who.cid), loadProfiles(who.cid)]);
  return ok({
    items: list.filter((p) => !profiles.get(p.uid)?.hidden).map((p) => {
      const prof = effectiveProfile(settings, p, profiles.get(p.uid));
      return { uid: p.uid, name: p.name, email: p.email, empId: p.empId, department: p.department, title: p.title, active: p.active, ...prof, explicit: profiles.has(p.uid) };
    }),
  });
}

function cleanProfile(settings: LeaveSettings, list: Person[], x: any): Profile {
  const uid = str(x?.uid, 128);
  if (!list.some((p) => p.uid === uid)) throw new LeaveError(400, 'Employee not found.');
  const locationId = str(x?.locationId, 40);
  const policyId = str(x?.policyId, 40);
  const managerUid = str(x?.managerUid, 128);
  if (locationId && !findLocation(settings, locationId)) throw new LeaveError(400, 'Unknown location.');
  if (policyId && !findPolicy(settings, policyId)) throw new LeaveError(400, 'Unknown policy.');
  if (managerUid && (managerUid === uid || !list.some((p) => p.uid === managerUid))) throw new LeaveError(400, 'Choose a different manager.');
  const joinDate = str(x?.joinDate, 10);
  if (joinDate && !isIsoDate(joinDate)) throw new LeaveError(400, 'Invalid join date.');
  const gender = ['F', 'M', 'O'].includes(str(x?.gender, 1)) ? (str(x.gender, 1) as 'F' | 'M' | 'O') : '';
  return { uid, locationId, policyId, managerUid, joinDate, gender };
}

async function saveProfiles(who: Who, body: any): Promise<Result> {
  needManage(who);
  const [{ settings }, list, existing] = await Promise.all([loadSettings(who.cid), loadPeople(who.cid), loadProfiles(who.cid)]);
  const items = Array.isArray(body?.profiles) ? body.profiles.slice(0, 500) : [body];
  const batch = db().batch();
  const changes: { uid: string; before: any; after: any }[] = [];
  for (const x of items) {
    const p = cleanProfile(settings, list, x);
    const was = existing.get(p.uid);
    const pick = (q: any) => ({ managerUid: q?.managerUid || '', policyId: q?.policyId || '', locationId: q?.locationId || '', joinDate: q?.joinDate || '' });
    if (JSON.stringify(pick(was)) !== JSON.stringify(pick(p))) changes.push({ uid: p.uid, before: pick(was), after: pick(p) });
    batch.set(db().collection('leaveProfiles').doc(profileId(who.cid, p.uid)), { ...p, ...(existing.get(p.uid)?.hidden ? { hidden: true } : {}), companyId: who.cid, updatedAt: nowIso() });
  }
  await batch.commit();
  if (changes.length) {
    const me = await personByUid(who.cid, who.ctx.uid);
    for (const ch of changes.slice(0, 50)) await audit(who.cid, 'leave-profile', ch.uid, 'PROFILE_CHANGED', { name: me?.name || who.ctx.uid, uid: who.ctx.uid }, ch.before, ch.after);
  }
  return ok({ saved: items.length });
}

/**
 * Removes a person from the People list. Admin only. This only hides them in this screen: the account, leave history,
 * balances and every other record stay exactly as they were, so nothing is lost.
 */
async function hidePerson(who: Who, body: any): Promise<Result> {
  needManage(who);
  if (!who.ctx.isCompanyAdmin) return fail(403, 'Only a Company Admin can remove people from this list.');
  const uid = String(body?.uid || '').slice(0, 128);
  if (uid === who.ctx.uid) return fail(400, 'You cannot remove yourself.');
  const [list, existing] = await Promise.all([loadPeople(who.cid), loadProfiles(who.cid)]);
  if (!list.some((p) => p.uid === uid)) return fail(404, 'Employee not found.');
  await db().collection('leaveProfiles').doc(profileId(who.cid, uid)).set({ ...(existing.get(uid) || {}), uid, hidden: true, companyId: who.cid, updatedAt: nowIso() });
  return ok({ hidden: true });
}

async function importProfiles(who: Who, body: any): Promise<Result> {
  needManage(who);
  const rows: Record<string, string>[] = Array.isArray(body?.rows) ? body.rows.slice(0, 1000) : [];
  const [{ settings }, list, existing] = await Promise.all([loadSettings(who.cid), loadPeople(who.cid), loadProfiles(who.cid)]);
  const errors: { row: number; error: string }[] = [];
  const batch = db().batch();
  let saved = 0;
  rows.forEach((raw, i) => {
    const r: Record<string, string> = {};
    Object.entries(raw || {}).forEach(([k, v]) => (r[k.toLowerCase().replace(/[^a-z]/g, '')] = String(v ?? '').trim()));
    const person = list.find((p) => p.email === (r.email || '').toLowerCase());
    if (!person) return errors.push({ row: i + 2, error: `No employee with email ${r.email || '(empty)'}` });
    const loc = r.location ? settings.locations.find((l) => l.name.toLowerCase() === r.location.toLowerCase() || l.id === r.location.toLowerCase()) : undefined;
    const pol = r.policy ? settings.policies.find((l) => l.name.toLowerCase() === r.policy.toLowerCase() || l.id === r.policy.toLowerCase()) : undefined;
    const mgrEmail = (r.manageremail || r.manager || '').toLowerCase();
    const mgr = mgrEmail ? list.find((p) => p.email === mgrEmail) : undefined;
    if (r.location && !loc) return errors.push({ row: i + 2, error: `Unknown location ${r.location}` });
    if (r.policy && !pol) return errors.push({ row: i + 2, error: `Unknown policy ${r.policy}` });
    if (mgrEmail && !mgr) return errors.push({ row: i + 2, error: `No manager with email ${mgrEmail}` });
    if (mgr && mgr.uid === person.uid) return errors.push({ row: i + 2, error: 'A person cannot be their own manager' });
    const join = r.joindate || '';
    if (join && !isIsoDate(join)) return errors.push({ row: i + 2, error: `Join date must be YYYY-MM-DD (${join})` });
    const prev = existing.get(person.uid) || { uid: person.uid };
    const next: Profile = {
      ...prev, uid: person.uid,
      locationId: loc?.id ?? prev.locationId ?? '', policyId: pol?.id ?? prev.policyId ?? '',
      managerUid: mgr?.uid ?? prev.managerUid ?? '', joinDate: join || prev.joinDate || '',
      gender: (['F', 'M', 'O'].includes((r.gender || '').toUpperCase().slice(0, 1)) ? (r.gender.toUpperCase().slice(0, 1) as 'F' | 'M' | 'O') : prev.gender) || '',
    };
    batch.set(db().collection('leaveProfiles').doc(profileId(who.cid, person.uid)), { ...next, ...(prev.hidden ? { hidden: true } : {}), companyId: who.cid, updatedAt: nowIso() });
    saved++;
  });
  if (saved) await batch.commit();
  return ok({ saved, errors });
}

async function balancesOf(who: Who, q: any): Promise<Result> {
  const uid = str(q.uid, 128);
  needManage(who);
  const [{ settings }, ledger] = await Promise.all([loadSettings(who.cid), userLedger(who.cid, uid)]);
  const rows = ledger.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300).map((e) => ({
    id: e.id, typeId: e.typeId, typeName: findType(settings, e.typeId)?.name || e.typeId, cycle: e.cycle, delta: e.delta, kind: e.kind, date: e.date, note: e.note || '', by: e.by || '',
  }));
  return ok({ items: rows });
}

async function myLedger(who: Who): Promise<Result> {
  const [{ settings }, ledger] = await Promise.all([loadSettings(who.cid), userLedger(who.cid, who.ctx.uid)]);
  const rows = ledger.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map((e) => ({
    id: e.id, typeName: findType(settings, e.typeId)?.name || e.typeId, delta: e.delta, kind: e.kind, date: e.date, note: e.note || '',
  }));
  return ok({ items: rows });
}

async function adjust(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const uid = str(body?.uid, 128);
  const person = await personByUid(who.cid, uid);
  const type = findType(c.settings, str(body?.typeId, 40));
  const delta = Number(body?.delta);
  const note = str(body?.note, 300);
  if (!person || !type) return fail(400, 'Choose an employee and a leave type.');
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 400) return fail(400, 'Enter a non-zero number of days.');
  if (!note) return fail(400, 'A note is required for every adjustment.');
  const kind = body?.kind === 'ENCASH' ? 'ENCASH' : 'ADJUST';
  const date = isIsoDate(body?.date) ? body.date : istToday();
  const cycle = cycleOf(date, typeStartMonth(type, c.settings)).key;
  if ((await db().collection('leaveYearClose').doc(`${who.cid}__${cycle}`).get()).exists) return fail(409, 'That leave year is closed. Post the correction in the current year.');
  const id = db().collection('leaveLedger').doc().id;
  await ledgerRef(id).set(entryData({
    companyId: who.cid, uid, typeId: type.id, cycle, delta: kind === 'ENCASH' ? -Math.abs(delta) : delta, kind, date, note, by: c.me.name,
  }));
  await audit(who.cid, 'leave-balance', uid, kind === 'ENCASH' ? 'BALANCE_ENCASHED' : 'BALANCE_ADJUSTED', { name: c.me.name, uid: who.ctx.uid }, null, { type: type.name, days: kind === 'ENCASH' ? -Math.abs(delta) : delta, note });
  return ok({});
}

async function importBalances(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const rows: Record<string, string>[] = Array.isArray(body?.rows) ? body.rows.slice(0, 2000) : [];
  const list = await loadPeople(who.cid);
  const errors: { row: number; error: string }[] = [];
  const batch = db().batch();
  let saved = 0;
  const date = istToday();
  rows.forEach((raw, i) => {
    const r: Record<string, string> = {};
    Object.entries(raw || {}).forEach(([k, v]) => (r[k.toLowerCase().replace(/[^a-z]/g, '')] = String(v ?? '').trim()));
    const person = list.find((p) => p.email === (r.email || '').toLowerCase());
    const code = (r.type || r.code || r.leavetype || '').toLowerCase();
    const type = c.settings.types.find((t) => t.code.toLowerCase() === code || t.id === code || t.name.toLowerCase() === code);
    const bal = Number(r.balance);
    if (!person) return errors.push({ row: i + 2, error: `No employee with email ${r.email || '(empty)'}` });
    if (!type) return errors.push({ row: i + 2, error: `Unknown leave type ${code || '(empty)'}` });
    if (!Number.isFinite(bal)) return errors.push({ row: i + 2, error: 'Balance must be a number' });
    const cycle = cycleOf(date, typeStartMonth(type, c.settings)).key;
    batch.set(ledgerRef(`OPEN_${person.uid}_${type.id}_${cycle}`), entryData({
      companyId: who.cid, uid: person.uid, typeId: type.id, cycle, delta: bal, kind: 'OPENING', date, note: 'Opening balance', by: c.me.name,
    }));
    saved++;
  });
  if (saved) await batch.commit();
  return ok({ saved, errors });
}

async function allRequests(who: Who, q: any): Promise<Result> {
  needReport(who);
  let list = await companyRequests(who.cid);
  const status = str(q.status, 20);
  const uid = str(q.uid, 128);
  const from = str(q.from, 10);
  const to = str(q.to, 10);
  if (status) list = list.filter((r) => r.status === status);
  if (uid) list = list.filter((r) => r.uid === uid);
  if (isIsoDate(from)) list = list.filter((r) => r.to >= from);
  if (isIsoDate(to)) list = list.filter((r) => r.from <= to);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const ppl = await loadPeople(who.cid);
  return ok({ items: list.slice(0, 500).map((r) => ({ ...viewRequest(r), managerName: nameOf(ppl, r.managerUid) })) });
}

async function runAccrualNow(who: Who): Promise<Result> {
  needManage(who);
  return ok(await runAccrual(who.cid));
}

// ------------------------------------------------------------------ reports

async function reportAttendance(who: Who, q: any): Promise<Result> {
  needReport(who);
  const month = str(q.month, 7) || istToday().slice(0, 7);
  monthRange(month);
  const [{ settings }, list, profiles, reqs, snap] = await Promise.all([
    loadSettings(who.cid), loadPeople(who.cid), loadProfiles(who.cid), companyRequests(who.cid),
    db().collection('leaveAttendance').where('companyId', '==', who.cid).where('month', '==', month).get(),
  ]);
  const recs = new Map<string, Map<string, any>>();
  snap.docs.forEach((d) => {
    const x = d.data() as any;
    if (!recs.has(x.uid)) recs.set(x.uid, new Map());
    recs.get(x.uid)!.set(x.date, x);
  });
  const rows = list.filter((p) => p.active).map((p) => {
    const prof = effectiveProfile(settings, p, profiles.get(p.uid));
    const m = buildMonth(settings, prof.locationId, prof.joinDate, month, recs.get(p.uid) || new Map(), reqs.filter((r) => r.uid === p.uid));
    return { uid: p.uid, name: p.name, empId: p.empId, department: p.department, ...m.summary };
  });
  return ok({ month, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) });
}

async function reportBalances(who: Who): Promise<Result> {
  needReport(who);
  const [{ settings }, list, profiles, ledger] = await Promise.all([loadSettings(who.cid), loadPeople(who.cid), loadProfiles(who.cid), companyLedger(who.cid)]);
  const today = istToday();
  const types = settings.types.filter((t) => t.active && t.requiresBalance && !t.isLop);
  const rows = list.filter((p) => p.active).map((p) => {
    const prof = effectiveProfile(settings, p, profiles.get(p.uid));
    const policy = findPolicy(settings, prof.policyId);
    const bal: Record<string, number | null> = {};
    types.forEach((t) => {
      if (!policy?.entries.some((e) => e.typeId === t.id)) return (bal[t.id] = null);
      const cy = cycleOf(today, typeStartMonth(t, settings));
      bal[t.id] = balanceOf(ledger.filter((e) => e.uid === p.uid), t.id, cy.key);
    });
    return { uid: p.uid, name: p.name, empId: p.empId, department: p.department, balances: bal };
  });
  return ok({ types: types.map((t) => ({ id: t.id, code: t.code, name: t.name })), rows: rows.sort((a, b) => a.name.localeCompare(b.name)) });
}

const LOW_BALANCE_DAYS = 2;

/** One informational alert per leave type and year when the balance runs low after an approval. */
async function lowBalanceAlert(cid: string, r: LeaveRequest, settings: LeaveSettings) {
  const type = findType(settings, r.typeId);
  if (!type || type.isLop || !type.requiresBalance) return;
  const ledger = await userLedger(cid, r.uid);
  for (const key of Object.keys(r.byCycle)) {
    const left = balanceOf(ledger, type.id, key);
    if (left > LOW_BALANCE_DAYS) continue;
    const title = `Low ${type.name} balance`;
    const text = `You have ${Math.max(0, Math.round(left * 100) / 100)} day(s) of ${type.name} left.`;
    await inApp(cid, [r.uid], title, text, 'my', `LOW_${type.id}_${key}`);
    await notify(cid, [r.email], title, text);
  }
}

// ------------------------------------------------------------------ private supporting documents

/** Attach or replace the document of a request that is still open. Only the employee can do this. */
async function docSet(who: Who, body: any): Promise<Result> {
  const id = str(body?.id, 200);
  const problem = checkAttachment(body?.dataUrl);
  if (problem) return fail(400, problem);
  const ref = db().collection('leaveRequests').doc(id);
  const r = (await ref.get()).data() as LeaveRequest | undefined;
  if (!r || r.companyId !== who.cid || r.uid !== who.ctx.uid) return fail(404, 'Request not found.');
  if (!['PENDING', 'INFO_REQUESTED'].includes(r.status)) return fail(409, 'A document can only be added while the request is open.');
  const docId = r.privateDocId || db().collection('leaveDocs').doc().id;
  const dataUrl = body.dataUrl as string;
  const now = nowIso();
  const name = str(body?.name, 120) || 'Document';
  await db().collection('leaveDocData').doc(docId).set({ companyId: who.cid, uid: r.uid, dataUrl });
  await db().collection('leaveDocs').doc(docId).set({ companyId: who.cid, uid: r.uid, requestId: id, name, kb: Math.round((dataUrl.length * 3) / 4 / 1024), createdAt: now });
  await ref.update({ privateDocId: docId, privateDocName: name, updatedAt: now, events: [...r.events, { at: now, by: r.name, message: 'Added a supporting document.' }] });
  return ok({ hasPrivateDoc: true });
}

/** The employee and HR can open a document. Managers only see that one is attached (medical papers stay with HR). */
async function docGet(who: Who, q: any): Promise<Result> {
  const id = str(q?.id, 200);
  const r = (await db().collection('leaveRequests').doc(id).get()).data() as LeaveRequest | undefined;
  if (!r || r.companyId !== who.cid || !r.privateDocId) return fail(404, 'Document not found.');
  if (r.uid !== who.ctx.uid && !who.canManage) {
    await audit(who.cid, 'leave-document', id, 'DOCUMENT_ACCESS_DENIED', { name: who.ctx.uid, uid: who.ctx.uid });
    return fail(403, 'Only the employee and HR can open this document.');
  }
  const data = (await db().collection('leaveDocData').doc(r.privateDocId).get()).data() as any;
  if (!data || data.companyId !== who.cid) return fail(404, 'Document not found.');
  if (r.uid !== who.ctx.uid) await audit(who.cid, 'leave-document', id, 'DOCUMENT_OPENED', { name: who.ctx.uid, uid: who.ctx.uid });
  return ok({ dataUrl: data.dataUrl, name: r.privateDocName || 'Document' });
}

// ------------------------------------------------------------------ policy versions: draft -> approve -> publish

const draftRef = (cid: string) => db().collection('leavePolicyDrafts').doc(cid);

interface PolicyDraft {
  companyId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED';
  settings: LeaveSettings;
  baseVersion: number;
  note: string;
  governanceRef: string;
  effectiveFrom: string;
  savedBy: string;
  savedByUid: string;
  savedAt: string;
  submittedBy?: string;
  submittedByUid?: string;
  approvedBy?: string;
  returnedNote?: string;
}

async function impactOf(cid: string, live: LeaveSettings, changes: ReturnType<typeof diffSettings>) {
  const changed = new Set(changes.flatMap((c) => c.policyIds || []));
  if (changed.size === 0) return { policies: [] as { id: string; name: string; people: number }[], people: 0 };
  const [people, profiles] = await Promise.all([loadPeople(cid), loadProfiles(cid)]);
  const count = new Map<string, number>();
  for (const p of people) {
    if (!p.active) continue;
    const prof = effectiveProfile(live, p, profiles.get(p.uid));
    if (changed.has(prof.policyId)) count.set(prof.policyId, (count.get(prof.policyId) || 0) + 1);
  }
  const policies = [...changed].map((id) => ({ id, name: findPolicy(live, id)?.name || id, people: count.get(id) || 0 }));
  return { policies, people: policies.reduce((n, p) => n + p.people, 0) };
}

/** Publishes any approved draft whose effective date has arrived. */
async function activateDue(cid: string, by = 'System'): Promise<boolean> {
  const snap = await draftRef(cid).get();
  const d = snap.data() as PolicyDraft | undefined;
  if (!d || d.status !== 'APPROVED' || d.effectiveFrom > istToday()) return false;
  const { settings: live } = await loadSettings(cid);
  const merged: LeaveSettings = { ...d.settings, requireApproval: live.requireApproval };
  await saveSettings(cid, merged, by, '', { effectiveFrom: d.effectiveFrom, approvedBy: d.approvedBy, governanceRef: d.governanceRef });
  await draftRef(cid).delete();
  await runAccrual(cid).catch(() => null);
  return true;
}

async function policyState(who: Who): Promise<Result> {
  needManage(who);
  await activateDue(who.cid);
  const { settings: live, configured } = await loadSettings(who.cid);
  const [dsnap, vs] = await Promise.all([draftRef(who.cid).get(), db().collection('leavePolicyVersions').where('companyId', '==', who.cid).get()]);
  const d = dsnap.data() as PolicyDraft | undefined;
  const versions = vs.docs.map((x) => x.data() as any).sort((a, b) => b.version - a.version).slice(0, 30)
    .map((v) => ({ version: v.version, effectiveFrom: v.effectiveFrom, publishedAt: v.publishedAt, publishedBy: v.publishedBy, approvedBy: v.approvedBy, governanceRef: v.governanceRef, changes: v.changes }));
  let draft: any = null;
  if (d) {
    const changes = diffSettings(live, d.settings);
    draft = { ...d, settings: d.settings, changes: changes.map((c) => ({ area: c.area, text: c.text })), impact: await impactOf(who.cid, live, changes),
      stale: d.baseVersion !== (live.policyVersion || 1) };
  }
  return ok({
    configured, version: live.policyVersion || (configured ? 1 : 0), effectiveFrom: live.effectiveFrom || '', governanceRef: live.governanceRef || '',
    approvedBy: live.approvedBy || '', requireApproval: live.requireApproval === true, canApprove: who.ctx.isCompanyAdmin, draft, versions,
  });
}

async function policyDraftSave(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const { settings: live, configured } = await loadSettings(who.cid);
  if (!configured) return fail(409, 'Set up leave first, then changes can go through approval.');
  const cur = (await draftRef(who.cid).get()).data() as PolicyDraft | undefined;
  if (cur?.status === 'APPROVED') return fail(409, 'An approved change is waiting for its effective date. Discard it first to start another.');
  const settings: LeaveSettings = JSON.parse(JSON.stringify(sanitizeSettings(body?.settings ?? cur?.settings ?? live, live)));
  const effectiveFrom = isIsoDate(str(body?.effectiveFrom, 10)) ? str(body.effectiveFrom, 10) : (cur?.effectiveFrom || istToday());
  const changes = diffSettings(live, settings);
  if (changes.length === 0) return fail(400, 'Nothing is different from the live policy.');
  const doc: PolicyDraft = {
    companyId: who.cid, status: 'DRAFT', settings, baseVersion: live.policyVersion || 1, note: str(body?.note, 500) || cur?.note || '',
    governanceRef: str(body?.governanceRef, 200) || cur?.governanceRef || '', effectiveFrom, savedBy: c.me.name, savedByUid: who.ctx.uid, savedAt: nowIso(),
  };
  await draftRef(who.cid).set(doc);
  await audit(who.cid, 'policy-draft', who.cid, 'DRAFT_SAVED', { name: c.me.name, uid: who.ctx.uid }, null, { changes: changes.slice(0, 20).map((x) => x.text) });
  return ok({ changes: changes.map((x) => ({ area: x.area, text: x.text })), impact: await impactOf(who.cid, live, changes) });
}

async function policySubmit(who: Who): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const d = (await draftRef(who.cid).get()).data() as PolicyDraft | undefined;
  if (!d || d.status !== 'DRAFT') return fail(409, 'There is no draft to send for approval.');
  if (!d.governanceRef) return fail(400, 'Add the reference of the policy document (Document Governance) before sending for approval.');
  await draftRef(who.cid).update({ status: 'SUBMITTED', submittedBy: c.me.name, submittedByUid: who.ctx.uid, returnedNote: '' });
  await audit(who.cid, 'policy-draft', who.cid, 'SUBMITTED', { name: c.me.name, uid: who.ctx.uid });
  const { settings } = await loadSettings(who.cid);
  await notify(who.cid, settings.notifyEmails, 'Leave policy change waiting for approval', `${c.me.name} sent a leave policy change for approval (effective ${d.effectiveFrom}, document ${d.governanceRef}). Open Leave & Attendance > Setup > Policy changes.`);
  return ok({});
}

async function policyDecide(who: Who, body: any): Promise<Result> {
  if (!who.ctx.isCompanyAdmin) return fail(403, 'Only an administrator can approve a policy change.');
  const c = await loadCtx(who);
  const d = (await draftRef(who.cid).get()).data() as PolicyDraft | undefined;
  if (!d || d.status !== 'SUBMITTED') return fail(409, 'No policy change is waiting for approval.');
  const { settings: live } = await loadSettings(who.cid);
  if (d.baseVersion !== (live.policyVersion || 1)) return fail(409, 'The live policy changed after this draft was made. Discard it and make the change again on the current version.');
  if (body?.decision === 'REJECT') {
    const note = str(body?.comment, 400);
    if (!note) return fail(400, 'Say what needs to change.');
    await draftRef(who.cid).update({ status: 'DRAFT', returnedNote: note });
    await audit(who.cid, 'policy-draft', who.cid, 'RETURNED', { name: c.me.name, uid: who.ctx.uid }, null, { note });
    return ok({ status: 'DRAFT' });
  }
  const self = d.submittedByUid === who.ctx.uid;
  await draftRef(who.cid).update({ status: 'APPROVED', approvedBy: c.me.name + (self ? ' (self-approved)' : '') });
  await audit(who.cid, 'policy-draft', who.cid, self ? 'APPROVED_BY_SUBMITTER' : 'APPROVED', { name: c.me.name, uid: who.ctx.uid });
  const published = await activateDue(who.cid, c.me.name);
  return ok({ status: published ? 'PUBLISHED' : 'SCHEDULED', effectiveFrom: d.effectiveFrom });
}

async function policyDiscard(who: Who): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  await draftRef(who.cid).delete();
  await audit(who.cid, 'policy-draft', who.cid, 'DISCARDED', { name: c.me.name, uid: who.ctx.uid });
  return ok({});
}

async function policySetRequire(who: Who, body: any): Promise<Result> {
  if (!who.ctx.isCompanyAdmin) return fail(403, 'Only an administrator can change this.');
  const c = await loadCtx(who);
  const { settings, configured } = await loadSettings(who.cid);
  if (!configured) return fail(409, 'Set up leave first.');
  const value = body?.value === true;
  await db().collection('leaveSettings').doc(who.cid).update({ requireApproval: value });
  await audit(who.cid, 'policy', 'approval-rule', value ? 'APPROVAL_REQUIRED_ON' : 'APPROVAL_REQUIRED_OFF', { name: c.me.name, uid: who.ctx.uid }, { requireApproval: settings.requireApproval === true }, { requireApproval: value });
  return ok({ requireApproval: value });
}

async function policyVersionView(who: Who, query: any): Promise<Result> {
  needManage(who);
  const n = parseInt(str(query?.v, 6), 10);
  const snap = Number.isFinite(n) ? await versionRef(who.cid, n).get() : null;
  const v = snap?.data() as any;
  if (!v || v.companyId !== who.cid) return fail(404, 'Version not found.');
  return ok({ version: v });
}

// ------------------------------------------------------------------ exceptions, audit trail, notifications, dashboard

async function exceptionsList(who: Who): Promise<Result> {
  needManage(who);
  const [snap, people] = await Promise.all([db().collection('leaveExceptions').where('companyId', '==', who.cid).get(), loadPeople(who.cid)]);
  const items = snap.docs.map((d) => d.data() as LeaveException)
    .map((e) => ({ ...e, employee: nameOf(people, e.uid) }))
    .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'OPEN' ? -1 : 1))
    .slice(0, 200);
  return ok({ items, open: items.filter((e) => e.status === 'OPEN').length });
}

async function exceptionResolve(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const id = str(body?.id, 200);
  const resolution = str(body?.resolution, 300);
  if (!resolution) return fail(400, 'Say how it was resolved.');
  const ref = db().collection('leaveExceptions').doc(id);
  const e = (await ref.get()).data() as LeaveException | undefined;
  if (!e || e.companyId !== who.cid) return fail(404, 'Not found.');
  if (e.status === 'RESOLVED') return fail(409, 'Already resolved.');
  await ref.update({ status: 'RESOLVED', resolvedAt: nowIso(), resolvedBy: c.me.name, resolution });
  await audit(who.cid, 'leave-exception', id, 'EXCEPTION_RESOLVED', { name: c.me.name, uid: who.ctx.uid }, { category: e.category }, { resolution });
  return ok({});
}

async function auditLog(who: Who, q: any): Promise<Result> {
  needManage(who);
  const entity = str(q?.entity, 40);
  const snap = await db().collection('leaveAudit').where('companyId', '==', who.cid).get();
  const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((a) => !entity || a.entity === entity)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 200);
  return ok({ items });
}

async function notificationsList(who: Who): Promise<Result> {
  const snap = await db().collection('leaveNotifications').where('companyId', '==', who.cid).where('uid', '==', who.ctx.uid).get();
  const all = snap.docs.map((d) => d.data() as LeaveNotification).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return ok({ items: all.slice(0, 30), unread: all.filter((n) => !n.read).length });
}

async function notificationsRead(who: Who, body: any): Promise<Result> {
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.slice(0, 50).map((x: any) => str(x, 200)) : [];
  const snap = await db().collection('leaveNotifications').where('companyId', '==', who.cid).where('uid', '==', who.ctx.uid).get();
  const mine = snap.docs.filter((d) => !(d.data() as LeaveNotification).read && (body?.all === true || ids.includes(d.id)));
  await Promise.all(mine.map((d) => db().collection('leaveNotifications').doc(d.id).update({ read: true })));
  return ok({ marked: mine.length });
}

/** The numbers behind the HR and management views. Management gets counts only, never names or reasons. */
async function leaveDashboard(who: Who, q: any): Promise<Result> {
  needReport(who);
  const today = istToday();
  const [{ settings }, people, requests, ex, profiles] = await Promise.all([
    loadSettings(who.cid), loadPeople(who.cid), companyRequests(who.cid),
    db().collection('leaveExceptions').where('companyId', '==', who.cid).get(), loadProfiles(who.cid),
  ]);
  const active = people.filter((p) => p.active && !profiles.get(p.uid)?.hidden);
  const pending = requests.filter((r) => r.status === 'PENDING' || r.status === 'CANCEL_REQUESTED');
  const onLeave = requests.filter((r) => (r.status === 'APPROVED' || r.status === 'CANCEL_REQUESTED') && r.from <= today && r.to >= today && r.detail.some((d) => d.date === today && d.value >= 1));
  const approved = requests.filter((r) => r.status === 'APPROVED');
  const monthKey = today.slice(0, 7);
  const byType = new Map<string, number>();
  approved.filter((r) => r.from.slice(0, 7) === monthKey).forEach((r) => byType.set(r.typeName, (byType.get(r.typeName) || 0) + r.days));
  const trend: { month: string; days: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(`${monthKey}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    const key = d.toISOString().slice(0, 7);
    trend.push({ month: key, days: Math.round(approved.filter((r) => r.from.slice(0, 7) === key).reduce((n, r) => n + r.days, 0) * 10) / 10 });
  }
  const openEx = ex.docs.map((d) => d.data() as LeaveException).filter((e) => e.status === 'OPEN');
  const detail = who.canManage && q?.view !== 'management';
  return ok({
    today, headcount: active.length, pendingApprovals: pending.length,
    overdue: pending.filter((r) => settings.escalateAfterDays > 0 && daysBetween(r.createdAt.slice(0, 10), today) >= settings.escalateAfterDays).length,
    onLeaveToday: onLeave.length, availabilityPct: active.length ? Math.round(((active.length - onLeave.length) / active.length) * 100) : 100,
    openExceptions: openEx.length, attendanceMismatches: openEx.filter((e) => e.category === 'ATTENDANCE_MISMATCH').length,
    payrollPending: openEx.filter((e) => e.category === 'PAYROLL_LOCKED_CHANGE').length,
    usageByType: [...byType.entries()].map(([type, days]) => ({ type, days: Math.round(days * 10) / 10 })).sort((a, b) => b.days - a.days),
    trend,
    ...(detail ? { onLeave: onLeave.map((r) => ({ name: r.name, type: r.typeName, to: r.to })).slice(0, 50) } : {}),
  });
}

// ------------------------------------------------------------------ year-end review and sign-off

/** The leave year that just ended, unless HR names another that has finished. */
function yearEndCycle(settings: LeaveSettings, requested: string) {
  const today = istToday();
  const sm = settings.yearStartMonth || 1;
  const last = previousCycle(cycleOf(today, sm), sm);
  if (requested && /^\d{4}$/.test(requested) && requested <= last.key) {
    const c = cycleOf(`${requested}-${String(sm).padStart(2, '0')}-01`, sm);
    return c;
  }
  return last;
}

async function yearEndRows(cid: string, settings: LeaveSettings, cycleKey: string) {
  const [people, profiles, ledger] = await Promise.all([loadPeople(cid), loadProfiles(cid), companyLedger(cid)]);
  const rows: { uid: string; name: string; typeId: string; type: string; closing: number; carry: number; lapse: number; encash: number; done: boolean }[] = [];
  for (const p of people) {
    if (!p.active || profiles.get(p.uid)?.hidden) continue;
    const prof = effectiveProfile(settings, p, profiles.get(p.uid));
    const policy = findPolicy(settings, prof.policyId);
    for (const entry of policy?.entries || []) {
      const t = findType(settings, entry.typeId);
      if (!t || !t.active || !t.requiresBalance || t.isLop) continue;
      const mine = ledger.filter((e) => e.uid === p.uid && e.typeId === t.id && e.cycle === cycleKey);
      if (mine.length === 0) continue;
      const done = mine.some((e) => e.kind === 'CARRY_OUT' || e.kind === 'LAPSE' || (e.kind === 'ENCASH' && /Year-end/.test(e.note || '')));
      // Before the year is processed the closing balance is the sum of everything posted in it; afterwards it is shown as it was.
      const closing = Math.round(mine.filter((e) => !['CARRY_OUT', 'LAPSE'].includes(e.kind) && !(e.kind === 'ENCASH' && /Year-end/.test(e.note || ''))).reduce((n, e) => n + e.delta, 0) * 100) / 100;
      const { carry, lapse, encash } = rollover(closing, entry);
      rows.push({ uid: p.uid, name: p.name, typeId: t.id, type: t.name, closing, carry, lapse, encash, done });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

async function yearEndPreview(who: Who, q: any): Promise<Result> {
  needManage(who);
  const { settings, configured } = await loadSettings(who.cid);
  if (!configured) return fail(409, 'Set up leave first.');
  const cycle = yearEndCycle(settings, str(q?.cycle, 4));
  const [rows, closed] = await Promise.all([yearEndRows(who.cid, settings, cycle.key), db().collection('leaveYearClose').doc(`${who.cid}__${cycle.key}`).get()]);
  const total = (k: 'carry' | 'lapse' | 'encash') => Math.round(rows.reduce((n, r) => n + r[k], 0) * 100) / 100;
  return ok({
    cycle: { key: cycle.key, label: cycle.label, start: cycle.start, end: cycle.end }, signoffRequired: settings.yearEndSignoff === true,
    closed: closed.exists ? closed.data() : null, rows, totals: { carry: total('carry'), lapse: total('lapse'), encash: total('encash') },
  });
}

async function yearEndClose(who: Who, body: any): Promise<Result> {
  needManage(who);
  const c = await loadCtx(who);
  const { settings } = await loadSettings(who.cid);
  const cycle = yearEndCycle(settings, str(body?.cycle, 4));
  if (cycle.end >= istToday()) return fail(409, 'That leave year has not finished yet.');
  const ref = db().collection('leaveYearClose').doc(`${who.cid}__${cycle.key}`);
  if ((await ref.get()).exists) return fail(409, 'This year is already closed. Prior-year balances can no longer be changed.');
  const rows = await yearEndRows(who.cid, settings, cycle.key);
  const sum = (k: 'carry' | 'lapse' | 'encash') => Math.round(rows.reduce((n, r) => n + r[k], 0) * 100) / 100;
  const summary = { carry: sum('carry'), lapse: sum('lapse'), encash: sum('encash'), people: new Set(rows.map((r) => r.uid)).size };
  await ref.set({ companyId: who.cid, cycle: cycle.key, label: cycle.label, closedBy: c.me.name, closedByUid: who.ctx.uid, closedAt: nowIso(), note: str(body?.note, 300), summary, policyVersion: settings.policyVersion || 1 });
  await audit(who.cid, 'leave-year', cycle.key, 'YEAR_CLOSED', { name: c.me.name, uid: who.ctx.uid }, null, summary);
  // Now that the year is signed off, carry-forward, lapse and encashment are posted (each entry once).
  const accrual = await runAccrual(who.cid).catch(() => null);
  return ok({ summary, rollovers: accrual?.rollovers ?? 0 });
}

// ------------------------------------------------------------------ cron

export async function runLeaveCron(): Promise<Result> {
  const snap = await db().collection('leaveSettings').get();
  const out: any[] = [];
  const today = istToday();
  for (const d of snap.docs) {
    const cid = d.id;
    try {
      await activateDue(cid).catch(() => false);
      const acc = await runAccrual(cid, today);
      for (const key of acc.awaitingSignoff) await raiseException(cid, { category: 'YEAR_END_PENDING', severity: 'HIGH', message: `The ${key} leave year has finished. Review and sign off the year end so carry-forward, lapse and encashment can be posted.`, key });
      const { settings } = await loadSettings(cid);
      const [people, profiles, allReq] = await Promise.all([loadPeople(cid), loadProfiles(cid), companyRequests(cid)]);
      let escalated = 0;
      let reminded = 0;
      // Waiting requests: remind the approver first, then tell HR, and keep a record HR can work through.
      if (settings.escalateAfterDays > 0) {
        const pend = allReq.filter((r) => r.status === 'PENDING');
        const remindAfter = settings.escalateAfterDays >= 2 ? Math.floor(settings.escalateAfterDays / 2) : 0;
        for (const r of pend) {
          const waiting = daysBetween(r.createdAt.slice(0, 10), today);
          const mgr = people.find((p) => p.uid === r.managerUid);
          if (remindAfter > 0 && waiting >= remindAfter && waiting < settings.escalateAfterDays && !(r as any).remindedOn && mgr && r.steps[r.stepIndex]?.role === 'MANAGER') {
            await notify(cid, [mgr.email], `Reminder: ${r.name}'s ${r.typeName} request is waiting`, `${r.name} asked for ${r.typeName} (${r.from} to ${r.to}) ${waiting} day(s) ago. Open Leave & Attendance > Approvals.`);
            await inApp(cid, [mgr.uid], `Reminder: ${r.name}'s request is waiting`, `${r.typeName}, ${r.from} to ${r.to}.`, 'approvals', `REMIND_${r.id}`);
            await db().collection('leaveRequests').doc(r.id).update({ remindedOn: today });
            reminded++;
          }
        }
        const stale = pend.filter((r) => daysBetween(r.createdAt.slice(0, 10), today) >= settings.escalateAfterDays && r.escalatedOn !== today && !r.escalatedOn);
        if (stale.length > 0) {
          if (settings.notifyEmails.length > 0) {
            await notify(cid, settings.notifyEmails, `${stale.length} leave request(s) waiting for a decision`,
              stale.map((r) => `- ${r.name}: ${r.typeName}, ${r.from} to ${r.to} (waiting ${daysBetween(r.createdAt.slice(0, 10), today)} days)`).join('\n'));
          }
          await inApp(cid, hrUids(settings, people), `${stale.length} leave request(s) overdue`, 'Nobody has acted on them. Open Approvals.', 'approvals', `OVERDUE_${today}`);
          for (const r of stale) {
            await db().collection('leaveRequests').doc(r.id).update({ escalatedOn: today });
            await raiseException(cid, { category: 'OVERDUE_APPROVAL', severity: 'HIGH', message: `${r.name}'s ${r.typeName} request (${r.from} to ${r.to}) has waited ${daysBetween(r.createdAt.slice(0, 10), today)} days.`, requestId: r.id, uid: r.uid });
          }
          escalated = stale.length;
        }
      }
      // People who cannot get leave because they have no usable policy.
      let noPolicy = 0;
      for (const p of people) {
        if (!p.active || profiles.get(p.uid)?.hidden) continue;
        const prof = effectiveProfile(settings, p, profiles.get(p.uid));
        if (!findPolicy(settings, prof.policyId)) {
          await raiseException(cid, { category: 'NO_POLICY', severity: 'HIGH', message: `${p.name} has no valid leave policy, so no leave is credited.`, uid: p.uid });
          noPolicy++;
        }
      }
      // Approved leave on a day the person also checked in: attendance and leave disagree.
      let mismatches = 0;
      const recent = allReq.filter((r) => r.status === 'APPROVED' && r.to >= addDays(today, -7) && r.from <= today);
      for (const r of recent) {
        for (const d of r.detail) {
          if (d.value < 1 || d.date > today || d.date < addDays(today, -7)) continue;
          const rec = (await db().collection('leaveAttendance').doc(attendanceId(cid, r.uid, d.date)).get()).data() as any;
          if (rec && (rec.checkIn || (rec.sessions && rec.sessions.length))) {
            await raiseException(cid, { category: 'ATTENDANCE_MISMATCH', message: `${r.name} has approved ${r.typeName} on ${d.date} but also checked in that day.`, requestId: r.id, uid: r.uid, key: `${r.uid}_${d.date}` });
            mismatches++;
          }
        }
      }
      out.push({ companyId: cid, ...acc, escalated, reminded, noPolicy, mismatches });
    } catch (err: any) {
      out.push({ companyId: cid, error: err?.message || String(err) });
    }
  }
  return ok({ today, companies: out });
}

// ------------------------------------------------------------------ router

export async function routeLeave(r: LeaveRequestIn): Promise<Result> {
  try {
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    if (r.action === 'cron') {
      const secret = (process.env.CRON_SECRET || '').trim();
      const supplied = str(r.query.key, 200) || str(r.headers['authorization'], 300).replace(/^Bearer\s+/i, '') || str(r.headers['x-cron-key'], 200);
      if (!secret) return fail(503, 'CRON_SECRET is not configured.');
      if (supplied !== secret) return fail(401, 'Invalid cron key.');
      return await runLeaveCron();
    }

    let who: Who;
    try {
      who = await whoIs(r.headers);
    } catch (err) {
      const known = authErrorResponse(err);
      if (known) return { status: known.status, json: known.json };
      throw err;
    }

    const GET = r.method === 'GET';
    const POST = r.method === 'POST';
    switch (r.action) {
      case 'me': if (GET) return await me(who); break;
      case 'calc': if (POST) return await calc(who, body); break;
      case 'apply': if (POST) return await apply(who, body); break;
      case 'my-requests': if (GET) return await myRequests(who); break;
      case 'my-ledger': if (GET) return await myLedger(who); break;
      case 'cancel': if (POST) return await cancel(who, body); break;
      case 'inbox': if (GET) return await inbox(who); break;
      case 'delegation': if (GET) return await getDelegation(who); break;
      case 'set-delegation': if (POST) return await setDelegation(who, body); break;
      case 'clear-delegation': if (POST) return await clearDelegation(who, body); break;
      case 'decide': if (POST) return await decide(who, body); break;
      case 'respond': if (POST) return await respond(who, body); break;
      case 'doc-set': if (POST) return await docSet(who, body); break;
      case 'doc-get': if (GET) return await docGet(who, r.query); break;
      case 'team-calendar': if (GET) return await teamCalendar(who, r.query); break;
      case 'check-in': if (POST) return await punch(who, 'in', r.ip, body); break;
      case 'check-out': if (POST) return await punch(who, 'out', r.ip, body); break;
      case 'attendance': if (GET) return await attendance(who, r.query); break;
      case 'apply-attendance': if (POST) return await applyAttendance(who, body); break;
      case 'attendance-report': if (GET) return await attendanceReport(who, r.query); break;
      case 'pending-applications': if (GET) return await pendingApplications(who); break;
      case 'attendance-people': if (GET) return await attendancePeople(who); break;
      case 'regularize': if (POST) return await regularize(who, body); break;
      case 'my-regularizations': if (GET) return await myRegularizations(who); break;
      case 'decide-regularization': if (POST) return await decideRegularization(who, body); break;
      // HR
      case 'settings': if (GET) return await getSettings(who); break;
      case 'save-settings': if (POST) return await postSettings(who, body); break;
      case 'exceptions': if (GET) return await exceptionsList(who); break;
      case 'exception-resolve': if (POST) return await exceptionResolve(who, body); break;
      case 'audit-log': if (GET) return await auditLog(who, r.query); break;
      case 'notifications': if (GET) return await notificationsList(who); break;
      case 'notifications-read': if (POST) return await notificationsRead(who, body); break;
      case 'assist-ask': if (POST) return await assistAsk(who, body); break;
      case 'assist-draft': if (POST) return await assistDraft(who, body); break;
      case 'assist-cover': if (GET) return await assistCover(who, r.query); break;
      case 'leave-summary': if (GET) return await leaveDashboard(who, r.query); break;
      case 'year-end': if (GET) return await yearEndPreview(who, r.query); break;
      case 'year-end-close': if (POST) return await yearEndClose(who, body); break;
      case 'policy-state': if (GET) return await policyState(who); break;
      case 'policy-draft-save': if (POST) return await policyDraftSave(who, body); break;
      case 'policy-submit': if (POST) return await policySubmit(who); break;
      case 'policy-decide': if (POST) return await policyDecide(who, body); break;
      case 'policy-discard': if (POST) return await policyDiscard(who); break;
      case 'policy-require': if (POST) return await policySetRequire(who, body); break;
      case 'policy-version': if (GET) return await policyVersionView(who, r.query); break;
      case 'apply-starter': if (POST) return await applyStarter(who, body); break;
      case 'people': if (GET) return await people(who); break;
      case 'save-profiles': if (POST) return await saveProfiles(who, body); break;
      case 'import-profiles': if (POST) return await importProfiles(who, body); break;
      case 'hide-person': if (POST) return await hidePerson(who, body); break;
      case 'balances-of': if (GET) return await balancesOf(who, r.query); break;
      case 'adjust': if (POST) return await adjust(who, body); break;
      case 'import-balances': if (POST) return await importBalances(who, body); break;
      case 'all-requests': if (GET) return await allRequests(who, r.query); break;
      case 'hr-create': if (POST) return await hrCreate(who, body); break;
      case 'hr-cancel': if (POST) return await hrCancel(who, body); break;
      case 'mark-attendance': if (POST) return await markAttendance(who, body); break;
      case 'run-accrual': if (POST) return await runAccrualNow(who); break;
      case 'report-attendance': if (GET) return await reportAttendance(who, r.query); break;
      case 'report-balances': if (GET) return await reportBalances(who); break;
      default: return fail(404, `Unknown leave action '${r.action}'.`);
    }
    return fail(405, 'Method not allowed.');
  } catch (err: any) {
    if (err instanceof LeaveError) return fail(err.status, err.message);
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Leave] error:', err);
    return fail(500, err?.message || 'Leave request failed.');
  }
}

