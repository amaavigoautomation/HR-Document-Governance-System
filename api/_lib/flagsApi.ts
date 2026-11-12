/**
 * Flags: payroll checks, repeated late marks and leave patterns, kept in the same list as the leave exceptions
 * (collection `leaveExceptions`, categories FLAG_PAYROLL / FLAG_LATE / FLAG_LEAVE) so HR works through one screen.
 *
 * The detectors are plain arithmetic in shared/anomalyEngine.ts. This file loads the data, stores the results, and
 * (only when AI is on) asks the model for one short plain-English "what to check" line per new flag, using the same
 * number check as Ask HR. Nothing here changes pay, attendance or leave, and nothing is sent to employees.
 *
 *   flagSettings/{companyId}   thresholds and on/off switches (server only, closed to browsers by firestore.rules)
 */
import { createHash } from 'node:crypto';
import { aiEnabled, aiJson } from './openaiHelper.js';
import { buildMonth } from './leaveApi.js';
import { loadLines, type LineDoc } from './payrollKit.js';
import {
  audit, companyRequests, db, effectiveProfile, findLocation, loadPeople, loadProfiles, loadSettings, nowIso, personByUid, str,
  type LeaveException,
} from './leaveCore.js';
import { dayKind, istToday } from '../../shared/leaveEngine.js';
import { unverifiedNumbers } from '../../shared/assistantEngine.js';
import {
  DEFAULT_FLAG_SETTINGS, SEVERITY_ORDER, lateFlags, leaveFlags, payrollFlags, sanitizeFlagSettings,
  type AttendanceDay, type Flag, type FlagSettings, type PayrollPerson,
} from '../../shared/anomalyEngine.js';
import { canAct, canAnyFlag, canSee, flagAccess, type FlagAccess } from './flagsAccess.js';
import type { AuthContext } from './authContext.js';

type Result = { status: number; json: any };
const ok = (json: Record<string, any> = {}): Result => ({ status: 200, json: { success: true, ...json } });
const fail = (status: number, error: string): Result => ({ status, json: { success: false, error } });

export interface FlagWho { ctx: AuthContext; cid: string }

const CATEGORY = { PAYROLL: 'FLAG_PAYROLL', LATE: 'FLAG_LATE', LEAVE: 'FLAG_LEAVE' } as const;
const docId = (cid: string, key: string) => `${cid}__${key}`.slice(0, 220);
const REOPEN_AFTER_DAYS = 90;

// ------------------------------------------------------------------ settings

export async function loadFlagSettings(cid: string): Promise<FlagSettings> {
  const snap = await db().collection('flagSettings').doc(cid).get();
  return sanitizeFlagSettings(snap.exists ? snap.data() : DEFAULT_FLAG_SETTINGS);
}

// ------------------------------------------------------------------ storing flags

const sumNumbers = (s: string) => ((s.match(/\d+/g) || []) as string[]).reduce((n, x) => n + Number(x), 0);
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/**
 * Writes the findings. The same finding is the same document, so a rerun never duplicates it. A flag marked as fine stays
 * quiet unless it gets worse (payroll: the figures changed; patterns: the count went up) or 90 days have passed.
 * Returns the flags that are new or reopened, which are the ones worth explaining.
 */
async function store(cid: string, flags: Flag[]): Promise<Flag[]> {
  const fresh: Flag[] = [];
  for (const f of flags) {
    const ref = db().collection('leaveExceptions').doc(docId(cid, f.key));
    const cur = await ref.get();
    const data = cur.exists ? (cur.data() as LeaveException) : null;
    const flag: NonNullable<LeaveException['flag']> = { code: f.code, name: f.name, month: f.month, evidence: f.evidence, facts: f.facts, sig: f.sig };
    const base = { category: CATEGORY[f.type], severity: f.severity, message: f.message.slice(0, 400), uid: f.uid };
    if (!data) {
      const doc: LeaveException = { id: ref.id, companyId: cid, requestId: '', assignedTo: 'HR', status: 'OPEN', createdAt: nowIso(), ...base, flag };
      await ref.set(doc);
      fresh.push(f);
      continue;
    }
    if (data.status === 'OPEN') {
      // Same finding, maybe new figures: refresh it and keep any explanation already written.
      await ref.set({ ...data, ...base, flag: data.flag?.explanation ? { ...flag, explanation: data.flag.explanation } : flag });
      continue;
    }
    const old = data.flag?.sig || '';
    const worse = f.type === 'PAYROLL' ? old !== f.sig : sumNumbers(f.sig) > sumNumbers(old);
    const stale = f.type !== 'PAYROLL' && !!data.resolvedAt && daysSince(data.resolvedAt) >= REOPEN_AFTER_DAYS;
    if (worse || stale) {
      // Reopen: written as a fresh document so the old review (who, when, note) is not carried over.
      const doc: LeaveException = { id: ref.id, companyId: cid, requestId: '', assignedTo: 'HR', status: 'OPEN', createdAt: nowIso(), ...base, flag };
      await ref.set(doc);
      fresh.push(f);
    }
  }
  return fresh;
}

/** Closes open flags of this kind that the latest check no longer finds (for example after HR fixed an input). */
async function closeGone(cid: string, category: string, keep: Set<string>, onlyMonth?: string): Promise<void> {
  const snap = await db().collection('leaveExceptions').where('companyId', '==', cid).where('category', '==', category).get();
  for (const d of snap.docs) {
    const e = d.data() as LeaveException;
    if (e.status !== 'OPEN' || keep.has(d.id)) continue;
    if (onlyMonth && e.flag?.month !== onlyMonth) continue;
    await d.ref.update({ status: 'RESOLVED', resolvedAt: nowIso(), resolvedBy: 'System', resolution: 'No longer found by the latest check.' });
  }
}

// ------------------------------------------------------------------ plain-English line (optional, needs AI)

async function explain(cid: string, flags: Flag[]): Promise<void> {
  if (!aiEnabled() || flags.length === 0) return;
  const batch = flags.slice(0, 20);
  const input = batch.map((f) => ({ key: f.key, finding: f.message, evidence: f.evidence, facts: f.facts }));
  const res = await aiJson({
    cid, feature: 'flag-explain', maxTokens: 900,
    system: [
      'You help an HR team check unusual items before they cost money or cause mistakes.',
      'For each finding write ONE short sentence (under 30 words) saying what to check or why it may matter.',
      'Use only numbers that appear in the finding, evidence or facts. Never calculate or estimate.',
      'Be neutral. Never suggest wrongdoing, never guess reasons for a person\'s behaviour, never mention health.',
      'Reply as JSON: {"items":[{"key":"...","text":"..."}]}',
    ].join('\n'),
    user: JSON.stringify({ findings: input }),
  });
  const items: any[] = Array.isArray(res.data?.items) ? res.data.items : [];
  for (const it of items) {
    const f = batch.find((x) => x.key === it?.key);
    const text = str(it?.text, 240);
    if (!f || !text) continue;
    if (unverifiedNumbers(text, [JSON.stringify(f.facts), f.message, f.evidence.join(' ')]).length) continue;
    await db().collection('leaveExceptions').doc(docId(cid, f.key)).update({ 'flag.explanation': text }).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ payroll

function toPerson(cid: string, l: LineDoc): PayrollPerson {
  const adj = (l.line.adjustments || []).map((a) => Number(a.amount) || 0);
  const acct = String(l.bank?.account || '').replace(/\s+/g, '').toLowerCase();
  return {
    uid: l.uid, name: l.employee.name, gross: l.line.gross, net: l.line.net, deductions: l.line.totalDeductions, lopDays: l.inputs.lopDays || 0,
    adjustments: adj.reduce((n, x) => n + x, 0), largestAdjustment: adj.length ? Math.max(...adj) : 0,
    // Compared as a hash: the account number itself is never stored on a flag or shown.
    accountKey: acct.length >= 6 ? createHash('sha256').update(`${cid}|${acct}`).digest('hex') : '',
  };
}

const prevMonthOf = (month: string) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/** Runs the payroll checks for a month against the month before. Called after a run is calculated, and by "Scan now". */
export async function payrollChecks(cid: string, month: string, lines?: LineDoc[], skipped: { uid: string }[] = []): Promise<number> {
  const s = await loadFlagSettings(cid);
  if (!s.payroll) return 0;
  const cur = (lines || await loadLines(cid, month)).map((l) => toPerson(cid, l));
  const prevLines = await loadLines(cid, prevMonthOf(month));
  const prev = prevLines.length ? prevLines.map((l) => toPerson(cid, l)) : null;
  const flags = payrollFlags(month, cur, prev, skipped.map((x) => x.uid), s);
  const fresh = await store(cid, flags);
  await closeGone(cid, CATEGORY.PAYROLL, new Set(flags.map((f) => docId(cid, f.key))), month);
  await explain(cid, fresh);
  return flags.length;
}

// ------------------------------------------------------------------ late marks and leave patterns

export async function runFlagScan(cid: string): Promise<{ late: number; leave: number }> {
  const s = await loadFlagSettings(cid);
  const today = istToday();
  const [{ settings }, people, profiles, requests] = await Promise.all([loadSettings(cid), loadPeople(cid), loadProfiles(cid), companyRequests(cid)]);
  const active = people.filter((p) => p.active && !profiles.get(p.uid)?.hidden);
  const months = [prevMonthOf(today.slice(0, 7)), today.slice(0, 7)];
  const recs = new Map<string, Map<string, any>>();
  if (s.late) {
    for (const m of months) {
      const snap = await db().collection('leaveAttendance').where('companyId', '==', cid).where('month', '==', m).get();
      snap.docs.forEach((d) => {
        const x = d.data() as any;
        const k = `${x.uid}|${m}`;
        if (!recs.has(k)) recs.set(k, new Map());
        recs.get(k)!.set(String(x.date), x);
      });
    }
  }
  const lateIn = active.map((p) => {
    const prof = effectiveProfile(settings, p, profiles.get(p.uid));
    const days: AttendanceDay[] = [];
    for (const m of months) {
      buildMonth(settings, prof.locationId, prof.joinDate, m, recs.get(`${p.uid}|${m}`) || new Map(), requests.filter((r) => r.uid === p.uid))
        .days.forEach((d: any) => days.push({ date: d.date, status: d.status, late: !!d.late }));
    }
    return { uid: p.uid, name: p.name, days };
  });
  const leaveIn = active.map((p) => {
    const prof = effectiveProfile(settings, p, profiles.get(p.uid));
    const loc = findLocation(settings, prof.locationId);
    return {
      uid: p.uid, name: p.name, isOff: (d: string) => dayKind(d, loc) !== 'WORK',
      requests: requests.filter((r) => r.uid === p.uid).map((r) => ({ from: r.from, to: r.to, days: r.days, typeName: r.typeName, status: r.status, createdOn: String(r.createdAt || '').slice(0, 10) })),
    };
  });
  const late = lateFlags(today, lateIn, s);
  const leave = leaveFlags(today, leaveIn, s);
  const fresh = [...(await store(cid, late)), ...(await store(cid, leave))];
  await closeGone(cid, CATEGORY.LATE, new Set(late.map((f) => docId(cid, f.key))));
  await closeGone(cid, CATEGORY.LEAVE, new Set(leave.map((f) => docId(cid, f.key))));
  await explain(cid, fresh);
  return { late: late.length, leave: leave.length };
}

// ------------------------------------------------------------------ screen actions (called from the leave router)

const accessOf = (w: FlagWho): FlagAccess => flagAccess(w.ctx);

export async function listAll(w: FlagWho): Promise<Result> {
  const a = accessOf(w);
  if (!canAnyFlag(a) && !a.leaveManage) return fail(403, 'You do not have access to this.');
  const [snap, people] = await Promise.all([db().collection('leaveExceptions').where('companyId', '==', w.cid).get(), loadPeople(w.cid)]);
  const name = (uid: string) => people.find((p) => p.uid === uid)?.name || '';
  const items = snap.docs.map((d) => d.data() as LeaveException)
    .filter((e) => canSee(a, e.category))
    .map((e) => ({ ...e, employee: e.flag?.name || name(e.uid), canAct: canAct(a, e.category) }))
    .sort((x, y) => (x.status === y.status
      ? (SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]) || y.createdAt.localeCompare(x.createdAt)
      : x.status === 'OPEN' ? -1 : 1))
    .slice(0, 300);
  return ok({ items, open: items.filter((e) => e.status === 'OPEN').length, canSettings: a.leaveManage || a.payrollManage, access: { leave: a.leaveReport, payroll: a.payrollView } });
}

export async function resolveAny(w: FlagWho, body: any): Promise<Result> {
  const a = accessOf(w);
  const id = str(body?.id, 220);
  const ref = db().collection('leaveExceptions').doc(id);
  const e = (await ref.get()).data() as LeaveException | undefined;
  if (!e || e.companyId !== w.cid || !canSee(a, e.category)) return fail(404, 'Not found.');
  if (!canAct(a, e.category)) return fail(403, e.category === 'FLAG_PAYROLL' ? 'Only payroll managers can review payroll flags.' : 'Only HR can do this.');
  if (e.status === 'RESOLVED') return fail(409, 'Already resolved.');
  const isFlag = e.category.startsWith('FLAG_');
  const resolution = str(body?.resolution, 300) || (isFlag ? 'Looks right' : '');
  if (!resolution) return fail(400, 'Say how it was resolved.');
  const me = await personByUid(w.cid, w.ctx.uid);
  const by = me?.name || w.ctx.email;
  await ref.update({ status: 'RESOLVED', resolvedAt: nowIso(), resolvedBy: by, resolution });
  await audit(w.cid, 'leave-exception', id, isFlag ? 'FLAG_REVIEWED' : 'EXCEPTION_RESOLVED', { name: by, uid: w.ctx.uid }, { category: e.category }, { resolution });
  return ok({});
}

export async function scanNow(w: FlagWho): Promise<Result> {
  const a = accessOf(w);
  if (!a.leaveManage && !a.payrollManage) return fail(403, 'Only HR can do this.');
  let late = 0;
  let leave = 0;
  let payroll = 0;
  if (a.leaveManage) ({ late, leave } = await runFlagScan(w.cid));
  if (a.payrollManage) {
    const runs = await db().collection('payrollRuns').where('companyId', '==', w.cid).get();
    const latest = runs.docs.map((d) => d.data() as any).sort((x, y) => String(y.month).localeCompare(String(x.month)))[0];
    if (latest) payroll = await payrollChecks(w.cid, latest.month, undefined, latest.skipped || []);
  }
  return ok({ late, leave, payroll });
}

export async function getSettings(w: FlagWho): Promise<Result> {
  const a = accessOf(w);
  if (!canAnyFlag(a)) return fail(403, 'You do not have access to this.');
  return ok({ settings: await loadFlagSettings(w.cid), aiExplanations: aiEnabled() });
}

export async function saveSettings(w: FlagWho, body: any): Promise<Result> {
  const a = accessOf(w);
  if (!a.leaveManage && !a.payrollManage) return fail(403, 'Only HR can do this.');
  const next = sanitizeFlagSettings(body?.settings);
  await db().collection('flagSettings').doc(w.cid).set({ companyId: w.cid, ...next, updatedAt: nowIso(), updatedBy: w.ctx.uid });
  const me = await personByUid(w.cid, w.ctx.uid);
  await audit(w.cid, 'leave-exception', 'flag-settings', 'FLAG_SETTINGS_CHANGED', { name: me?.name || w.ctx.email, uid: w.ctx.uid }, null, next);
  return ok({ settings: next });
}
