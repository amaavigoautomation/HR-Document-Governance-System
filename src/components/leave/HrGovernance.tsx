import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BellRing, CheckCircle2, ClipboardList, ScrollText } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { Card, EmptyState, Notice, Skeleton, btnGhost, btnPrimary, input, niceDate, useRunner } from './ui';

const CATEGORY: Record<string, string> = {
  NO_MANAGER: 'No manager', NO_POLICY: 'No policy', MANAGER_AWAY: 'Manager away', OVERDUE_APPROVAL: 'Overdue approval', BALANCE_NEGATIVE: 'Balance below zero',
  ATTENDANCE_MISMATCH: 'Attendance mismatch', PAYROLL_LOCKED_CHANGE: 'Payroll already locked', POLICY_CHANGED: 'Policy changed', RETRO_LEAVE: 'Applied after the fact',
  EMERGENCY_REVIEW: 'Emergency leave', UNAUTHORIZED: 'Unauthorised access',
};
const SEVERITY: Record<string, string> = { HIGH: 'bg-rose-50 text-rose-700 border-rose-200', MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200', LOW: 'bg-slate-100 text-slate-600 border-slate-200' };

/** Business-rule problems that need a person: nothing is lost if they are ignored, but each one stays visible until resolved. */
export const HrExceptions: React.FC = () => {
  const [items, setItems] = useState<any[] | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [showDone, setShowDone] = useState(false);
  const { busy, note, run } = useRunner();
  const load = useCallback(() => leaveService.exceptions().then((r) => setItems(r.items)).catch(() => setItems([])), []);
  useEffect(() => { load(); }, [load]);
  if (!items) return <Skeleton rows={4} />;
  const open = items.filter((e) => e.status === 'OPEN');
  const done = items.filter((e) => e.status !== 'OPEN');
  return (
    <div className="space-y-3">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {open.length === 0 ? <Card><EmptyState icon={CheckCircle2} title="Nothing needs attention" text="Problems such as a missing manager, an overdue approval or a mismatch with attendance appear here." /></Card> : open.map((e) => (
        <Card key={e.id}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SEVERITY[e.severity]}`}>{e.severity}</span>
            <span className="text-xs font-bold text-slate-700">{CATEGORY[e.category] || e.category}</span>
            <span className="text-[11px] text-slate-400">{niceDate(e.createdAt.slice(0, 10))}{e.employee ? ` · ${e.employee}` : ''}</span>
          </div>
          <div className="mt-1.5 text-sm text-slate-800">{e.message}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <input className={`${input} max-w-sm`} placeholder="How was it resolved?" value={text[e.id] || ''} onChange={(ev) => setText({ ...text, [e.id]: ev.target.value })} />
            <button className={btnPrimary} disabled={busy || !(text[e.id] || '').trim()} onClick={() => run(async () => { await leaveService.resolveException(e.id, text[e.id].trim()); await load(); }, 'Marked resolved.')}>Resolve</button>
          </div>
        </Card>
      ))}
      {done.length > 0 && (
        <div>
          <button className={btnGhost} onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} resolved ({done.length})</button>
          {showDone && <div className="mt-2 space-y-1.5">{done.map((e) => (
            <div key={e.id} className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2">
              <b className="text-slate-700">{CATEGORY[e.category] || e.category}</b> · {e.message} <span className="text-slate-400">— {e.resolvedBy}: {e.resolution}</span>
            </div>))}</div>}
        </div>
      )}
    </div>
  );
};

const ENTITY: Record<string, string> = {
  '': 'Everything', policy: 'Policy', 'policy-draft': 'Policy drafts', 'leave-balance': 'Balances', 'leave-request': 'Requests', 'leave-profile': 'People',
  'leave-document': 'Documents', 'leave-exception': 'Exceptions', 'payroll-correction': 'Payroll corrections', 'leave-year': 'Year end',
};

const brief = (v: any) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v).slice(0, 220));

/** Company-wide, append-only trail: who changed what, and the old and new values. */
export const HrAudit: React.FC = () => {
  const [entity, setEntity] = useState('');
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { setItems(null); leaveService.auditLog(entity).then((r) => setItems(r.items)).catch(() => setItems([])); }, [entity]);
  return (
    <Card title="Audit trail" subtitle="Policy changes, balance adjustments, HR overrides, document access and payroll corrections. It cannot be edited."
      right={<select className="border border-slate-300 rounded-lg px-2 py-1 text-xs" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter">
        {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}>
      {!items ? <Skeleton rows={4} /> : items.length === 0 ? <EmptyState icon={ScrollText} title="Nothing recorded yet" /> : (
        <div className="divide-y divide-slate-100 max-h-[32rem] overflow-y-auto -mx-1 px-1">
          {items.map((a) => (
            <div key={a.id} className="py-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2"><span className="font-bold text-slate-800">{a.action.replace(/_/g, ' ').toLowerCase()}</span><span className="text-slate-400">{new Date(a.at).toLocaleString()}</span></div>
              <div className="text-slate-500">{a.actor} · {ENTITY[a.entity] || a.entity}</div>
              {(a.oldValue || a.newValue) && <div className="mt-0.5 text-[11px] text-slate-500 break-words">{a.oldValue ? <>from <code>{brief(a.oldValue)}</code> </> : null}{a.newValue ? <>to <code>{brief(a.newValue)}</code></> : null}</div>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

const Tile: React.FC<{ label: string; value: React.ReactNode; tone?: 'warn' | 'bad' }> = ({ label, value, tone }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-3">
    <div className="text-[11px] font-semibold text-slate-500">{label}</div>
    <div className={`text-2xl font-black ${tone === 'bad' ? 'text-rose-600' : tone === 'warn' ? 'text-amber-600' : 'text-slate-900'}`}>{value}</div>
  </div>
);

/** HR view: counts and who is out today. Management view (counts only) is the same call with view=management. */
export const HrDashboard: React.FC = () => {
  const [d, setD] = useState<any | null>(null);
  const [mgmt, setMgmt] = useState(false);
  useEffect(() => { setD(null); leaveService.summary(mgmt ? 'management' : '').then(setD).catch(() => setD({ error: true })); }, [mgmt]);
  if (!d) return <Skeleton rows={4} />;
  if (d.error) return <Notice tone="error">Could not load the overview.</Notice>;
  const peak = Math.max(1, ...d.trend.map((t: any) => t.days));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-slate-500">As of {niceDate(d.today)}</div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="accent-[#FA7014]" checked={mgmt} onChange={(e) => setMgmt(e.target.checked)} />Management view (no names)</label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile label="Pending approvals" value={d.pendingApprovals} tone={d.overdue ? 'warn' : undefined} />
        <Tile label="Overdue" value={d.overdue} tone={d.overdue ? 'bad' : undefined} />
        <Tile label="On leave today" value={d.onLeaveToday} />
        <Tile label="Staff available" value={`${d.availabilityPct}%`} />
        <Tile label="Open exceptions" value={d.openExceptions} tone={d.openExceptions ? 'warn' : undefined} />
        <Tile label="Attendance mismatches" value={d.attendanceMismatches} tone={d.attendanceMismatches ? 'warn' : undefined} />
        <Tile label="Payroll corrections" value={d.payrollPending} tone={d.payrollPending ? 'warn' : undefined} />
        <Tile label="People" value={d.headcount} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Leave taken, last 6 months" subtitle="Approved days by month of leave">
          <div className="flex items-end gap-2 h-32">
            {d.trend.map((t: any) => (
              <div key={t.month} className="flex-1 flex flex-col items-center justify-end gap-1">
                <span className="text-[10px] text-slate-500">{t.days}</span>
                <div className="w-full rounded-t bg-[#FA7014]/80" style={{ height: `${Math.max(3, (t.days / peak) * 100)}%` }} />
                <span className="text-[10px] text-slate-400">{t.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="This month by leave type">
          {d.usageByType.length === 0 ? <div className="text-xs text-slate-400">No approved leave this month.</div> : (
            <ul className="space-y-1.5">{d.usageByType.map((u: any) => (
              <li key={u.type} className="flex justify-between text-xs"><span className="text-slate-700">{u.type}</span><b>{u.days} days</b></li>))}</ul>
          )}
        </Card>
      </div>
      {d.onLeave && (
        <Card title="Out today">
          {d.onLeave.length === 0 ? <div className="text-xs text-slate-400">Everyone is in.</div> : <ul className="space-y-1">{d.onLeave.map((o: any, i: number) => <li key={i} className="text-xs text-slate-700">{o.name} · {o.type} · back after {niceDate(o.to)}</li>)}</ul>}
        </Card>
      )}
    </div>
  );
};

/** Short list of in-app messages for the signed-in person (shown on the Today screen). */
export const Updates: React.FC<{ onOpen?: (link: string) => void; refreshKey?: number }> = ({ onOpen, refreshKey }) => {
  const [data, setData] = useState<{ items: any[]; unread: number } | null>(null);
  const load = useCallback(() => leaveService.notifications().then(setData).catch(() => setData({ items: [], unread: 0 })), []);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!data || data.items.length === 0) return null;
  const list = data.items.slice(0, 5);
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><BellRing className="w-4 h-4 text-[#FA7014]" />Updates{data.unread > 0 && <b className="text-[10px] bg-[#FA7014] text-white rounded-full px-1.5">{data.unread}</b>}</span>}
      right={data.unread > 0 ? <button className="text-xs font-bold text-slate-500 hover:text-slate-800" onClick={() => leaveService.readNotifications('all').then(load)}>Mark all read</button> : undefined}>
      <ul className="divide-y divide-slate-100">
        {list.map((n) => (
          <li key={n.id} className="py-2">
            <button className="text-left w-full" onClick={() => { if (!n.read) leaveService.readNotifications([n.id]).then(load); if (n.link) onOpen?.(n.link); }}>
              <div className={`text-xs ${n.read ? 'text-slate-500' : 'font-bold text-slate-800'}`}>{n.title}</div>
              <div className="text-[11px] text-slate-400">{n.body}</div>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
};
