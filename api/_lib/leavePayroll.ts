/**
 * Leave changes that land in a payroll month which is already locked.
 *
 * A locked month is never rewritten. Instead a correction is recorded for the next open month: unpaid leave added
 * after the lock adds loss-of-pay days there, unpaid leave cancelled after the lock gives them back. The correction is
 * picked up by that month's payroll inputs and marked applied when the month is locked.
 */
import { audit, db, nowIso, raiseException, type LeaveRequest } from './leaveCore.js';

export interface PayrollCorrection {
  id: string;
  companyId: string;
  uid: string;
  name: string;
  requestId: string;
  /** The locked month the leave belongs to. */
  sourceMonth: string;
  /** The open month that carries the correction. */
  applyMonth: string;
  /** Loss-of-pay days to add (positive) or give back (negative). */
  lopDelta: number;
  reason: string;
  status: 'PENDING' | 'APPLIED';
  createdAt: string;
  createdBy: string;
  appliedAt?: string;
}

const nextMonth = (m: string) => {
  const y = parseInt(m.slice(0, 4), 10);
  const mo = parseInt(m.slice(5, 7), 10);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/** Months whose payroll is locked or paid. */
export async function lockedMonths(cid: string): Promise<Set<string>> {
  const snap = await db().collection('payrollRuns').where('companyId', '==', cid).get();
  return new Set(snap.docs.map((d) => d.data() as { month: string; status: string }).filter((r) => r.status === 'LOCKED' || r.status === 'PAID').map((r) => r.month));
}

/**
 * Records the payroll effect of an unpaid-leave change. `mode` ADD = leave added or approved late, REFUND = leave
 * cancelled. Safe to call twice for the same request and mode. Returns the corrections it created.
 */
export async function postCorrections(cid: string, req: LeaveRequest, unpaid: boolean, mode: 'ADD' | 'REFUND', actor: { name: string; uid: string }): Promise<PayrollCorrection[]> {
  const locked = await lockedMonths(cid);
  if (locked.size === 0) return [];
  const perMonth = new Map<string, number>();
  for (const d of req.detail) {
    const m = d.date.slice(0, 7);
    if (locked.has(m)) perMonth.set(m, (perMonth.get(m) || 0) + d.value);
  }
  const made: PayrollCorrection[] = [];
  for (const [month, days] of perMonth) {
    if (!unpaid) {
      // Paid leave in a locked month: nothing to recalculate automatically, but HR should look at it.
      await raiseException(cid, { category: 'PAYROLL_LOCKED_CHANGE', message: `${req.name}'s ${req.typeName} in ${month} changed after that payroll was locked. Check the attendance and pay for that month.`, requestId: req.id, uid: req.uid, key: `${req.id}_${month}` });
      continue;
    }
    let apply = nextMonth(month);
    while (locked.has(apply)) apply = nextMonth(apply);
    const id = `${cid}__${req.id}__${month}__${mode}`;
    const ref = db().collection('leavePayrollInputs').doc(id);
    if ((await ref.get()).exists) continue;
    const doc: PayrollCorrection = {
      id, companyId: cid, uid: req.uid, name: req.name, requestId: req.id, sourceMonth: month, applyMonth: apply,
      lopDelta: Math.round((mode === 'ADD' ? days : -days) * 100) / 100,
      reason: mode === 'ADD' ? `${req.typeName} (${days} day(s)) recorded after ${month} payroll was locked.` : `${req.typeName} (${days} day(s)) in ${month} was cancelled after that payroll was locked.`,
      status: 'PENDING', createdAt: nowIso(), createdBy: actor.name,
    };
    await ref.set(doc);
    await raiseException(cid, { category: 'PAYROLL_LOCKED_CHANGE', severity: 'HIGH', message: `${doc.reason} It will be corrected in the ${apply} payroll (${doc.lopDelta > 0 ? '+' : ''}${doc.lopDelta} loss-of-pay day(s)).`, requestId: req.id, uid: req.uid, key: id });
    await audit(cid, 'payroll-correction', id, 'PAYROLL_CORRECTION_CREATED', actor, null, { employee: req.name, sourceMonth: month, applyMonth: apply, lopDelta: doc.lopDelta });
    made.push(doc);
  }
  return made;
}

/** Corrections waiting for the given month, as loss-of-pay days per person. */
export async function pendingCorrections(cid: string, month: string): Promise<PayrollCorrection[]> {
  const snap = await db().collection('leavePayrollInputs').where('companyId', '==', cid).where('applyMonth', '==', month).get();
  return snap.docs.map((d) => d.data() as PayrollCorrection);
}

/** Called when a month is locked: its pending corrections are now part of paid salary. */
export async function markCorrectionsApplied(cid: string, month: string): Promise<number> {
  const list = (await pendingCorrections(cid, month)).filter((c) => c.status === 'PENDING');
  await Promise.all(list.map((c) => db().collection('leavePayrollInputs').doc(c.id).update({ status: 'APPLIED', appliedAt: nowIso() })));
  return list.length;
}
