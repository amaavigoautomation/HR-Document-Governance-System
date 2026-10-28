/**
 * Plain-language comparison of two leave setups. Used for the policy change summary HR approves, the version
 * history, and the impact estimate (which employees are on a policy that changed).
 */
import type { LeaveSettings, LeavePolicy } from './leaveEngine';

export interface PolicyChange {
  area: 'General' | 'Leave type' | 'Policy' | 'Office' | 'Hours';
  text: string;
  /** Policy ids whose entitlement or accrual changed (drives the impact estimate). */
  policyIds?: string[];
}

const yn = (v: unknown) => (v ? 'on' : 'off');
const entryKey = (typeId: string) => typeId;

export function diffSettings(before: LeaveSettings, after: LeaveSettings): PolicyChange[] {
  const out: PolicyChange[] = [];
  const g = (text: string) => out.push({ area: 'General', text });

  if (before.yearStartMonth !== after.yearStartMonth) g(`Leave year starts in month ${after.yearStartMonth} (was ${before.yearStartMonth}).`);
  if ((before.probationDays || 0) !== (after.probationDays || 0)) g(`Probation is ${after.probationDays || 0} day(s) (was ${before.probationDays || 0}).`);
  if ((before.yearEndSignoff === true) !== (after.yearEndSignoff === true)) g(`Year-end sign-off is now ${yn(after.yearEndSignoff)}.`);
  if (before.sandwichRule !== after.sandwichRule) g(`Sandwich rule is now ${yn(after.sandwichRule)}.`);
  if (before.escalateAfterDays !== after.escalateAfterDays) g(`Escalate pending requests after ${after.escalateAfterDays} day(s) (was ${before.escalateAfterDays}).`);
  if (before.hrApprovalAboveDays !== after.hrApprovalAboveDays) g(`HR approval above ${after.hrApprovalAboveDays} day(s) (was ${before.hrApprovalAboveDays}).`);
  if (before.lateMarksPerHalfDay !== after.lateMarksPerHalfDay) g(`Late marks per half day: ${after.lateMarksPerHalfDay} (was ${before.lateMarksPerHalfDay}).`);
  if ((before.cycleStartDay || 1) !== (after.cycleStartDay || 1)) g(`Attendance cycle starts on day ${after.cycleStartDay || 1} (was ${before.cycleStartDay || 1}).`);
  if (before.shift.start !== after.shift.start || before.shift.end !== after.shift.end || before.shift.graceMinutes !== after.shift.graceMinutes
    || before.shift.fullDayMinutes !== after.shift.fullDayMinutes || before.shift.halfDayMinutes !== after.shift.halfDayMinutes) {
    out.push({ area: 'Hours', text: `Shift is now ${after.shift.start}-${after.shift.end}, ${after.shift.graceMinutes} min grace.` });
  }

  const typeName = (s: LeaveSettings, id: string) => s.types.find((t) => t.id === id)?.name || id;
  const bt = new Map(before.types.map((t) => [t.id, t]));
  for (const t of after.types) {
    const o = bt.get(t.id);
    if (!o) { out.push({ area: 'Leave type', text: `New leave type: ${t.name}.` }); continue; }
    const ch: string[] = [];
    if (o.name !== t.name) ch.push(`renamed from ${o.name}`);
    if (o.paid !== t.paid) ch.push(t.paid ? 'now paid' : 'now unpaid');
    if (o.active !== t.active) ch.push(t.active ? 'activated' : 'switched off');
    if (o.minNoticeDays !== t.minNoticeDays) ch.push(`notice ${o.minNoticeDays} → ${t.minNoticeDays} day(s)`);
    if (o.maxDaysPerRequest !== t.maxDaysPerRequest) ch.push(`max per request ${o.maxDaysPerRequest} → ${t.maxDaysPerRequest}`);
    if (o.docRequiredAfterDays !== t.docRequiredAfterDays) ch.push(`document needed after ${o.docRequiredAfterDays} → ${t.docRequiredAfterDays} day(s)`);
    if (o.minServiceDays !== t.minServiceDays) ch.push(`minimum service ${o.minServiceDays} → ${t.minServiceDays} day(s)`);
    if (o.allowNegative !== t.allowNegative) ch.push(`negative balance ${yn(t.allowNegative)}`);
    if ((o.blockInProbation === true) !== (t.blockInProbation === true)) ch.push(`${t.blockInProbation ? 'not allowed' : 'allowed'} during probation`);
    if ((o.blockInNotice === true) !== (t.blockInNotice === true)) ch.push(`${t.blockInNotice ? 'not allowed' : 'allowed'} during notice period`);
    if (o.approval !== t.approval) ch.push(`approval ${o.approval} → ${t.approval}`);
    if (o.halfDay !== t.halfDay) ch.push(`half day ${yn(t.halfDay)}`);
    if (o.dayCounting !== t.dayCounting) ch.push(`counts ${t.dayCounting.toLowerCase()} days`);
    if (o.gender !== t.gender) ch.push(`for ${t.gender === 'ANY' ? 'everyone' : t.gender === 'F' ? 'women' : 'men'}`);
    if (ch.length) out.push({ area: 'Leave type', text: `${t.name}: ${ch.join('; ')}.` });
  }
  for (const o of before.types) if (!after.types.some((t) => t.id === o.id)) out.push({ area: 'Leave type', text: `Leave type removed: ${o.name}.` });

  const bp = new Map<string, LeavePolicy>(before.policies.map((p) => [p.id, p]));
  for (const p of after.policies) {
    const o = bp.get(p.id);
    if (!o) { out.push({ area: 'Policy', text: `New leave policy: ${p.name}.`, policyIds: [p.id] }); continue; }
    const oe = new Map(o.entries.map((e) => [entryKey(e.typeId), e]));
    const ch: string[] = [];
    for (const e of p.entries) {
      const x = oe.get(entryKey(e.typeId));
      const n = typeName(after, e.typeId);
      if (!x) { ch.push(`${n} added (${e.quota} days, ${e.accrual.toLowerCase()})`); continue; }
      if (x.quota !== e.quota) ch.push(`${n} entitlement ${x.quota} → ${e.quota}`);
      if (x.accrual !== e.accrual) ch.push(`${n} accrual ${x.accrual.toLowerCase()} → ${e.accrual.toLowerCase()}`);
      if (x.carryForward !== e.carryForward || x.carryCap !== e.carryCap) ch.push(`${n} carry-forward ${e.carryForward ? (e.carryCap ? `up to ${e.carryCap}` : 'no cap') : 'off'}`);
      if ((x.encashCap || 0) !== (e.encashCap || 0)) ch.push(`${n} year-end encashment up to ${e.encashCap || 0} day(s)`);
    }
    for (const x of o.entries) if (!p.entries.some((e) => e.typeId === x.typeId)) ch.push(`${typeName(before, x.typeId)} removed`);
    if (ch.length) out.push({ area: 'Policy', text: `${p.name}: ${ch.join('; ')}.`, policyIds: [p.id] });
  }
  for (const o of before.policies) if (!after.policies.some((p) => p.id === o.id)) out.push({ area: 'Policy', text: `Leave policy removed: ${o.name}.`, policyIds: [o.id] });

  const bl = new Map(before.locations.map((l) => [l.id, l]));
  for (const l of after.locations) {
    const o = bl.get(l.id);
    if (!o) { out.push({ area: 'Office', text: `New office: ${l.name}.` }); continue; }
    if (JSON.stringify(o.weeklyOff) !== JSON.stringify(l.weeklyOff)) out.push({ area: 'Office', text: `${l.name}: weekly offs changed.` });
    const oh = new Set(o.holidays.map((h) => `${h.date}|${h.name}|${h.optional ? 1 : 0}`));
    const nh = new Set(l.holidays.map((h) => `${h.date}|${h.name}|${h.optional ? 1 : 0}`));
    const added = [...nh].filter((x) => !oh.has(x)).length;
    const gone = [...oh].filter((x) => !nh.has(x)).length;
    if (added || gone) out.push({ area: 'Office', text: `${l.name}: holidays ${added ? `+${added}` : ''}${added && gone ? ' ' : ''}${gone ? `-${gone}` : ''}.` });
  }
  for (const o of before.locations) if (!after.locations.some((l) => l.id === o.id)) out.push({ area: 'Office', text: `Office removed: ${o.name}.` });
  return out;
}
