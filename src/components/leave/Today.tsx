import React, { useEffect, useState } from 'react';
import { CalendarPlus, Inbox, Palmtree, Sun, Users, Wrench } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { PunchCard } from './AttendanceTab';
import { btnBig, btnGhost, Card, days, EmptyState, halfNote, relDay, shortDate, shortRange, Skeleton, StatusPill } from './ui';

const greeting = () => {
  const h = new Date(Date.now() + 5.5 * 3600_000).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Balance tiles: big number left, small bar showing used vs total. */
export const BalanceStrip: React.FC<{ me: any; onApply?: (typeId: string) => void }> = ({ me, onApply }) => {
  const list = me.balances.filter((b: any) => !b.isLop && b.eligible);
  if (list.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
      {list.map((b: any) => {
        const total = Math.max(b.credited, b.balance + b.used + (b.pending || 0));
        const leftPct = b.requiresBalance && total > 0 ? Math.max(0, Math.min(100, Math.round((b.balance / total) * 100))) : 0;
        return (
          <button key={b.typeId} type="button" onClick={() => onApply?.(b.typeId)} title={onApply ? `Apply for ${b.name}` : undefined}
            className="text-left bg-white border border-slate-200 rounded-xl p-3 hover:border-[#FA7014]/60 transition-colors">
            <div className="text-xs font-bold text-slate-600 truncate">{b.name}</div>
            {b.requiresBalance ? (
              <>
                <div className="mt-1 flex items-baseline gap-1"><span className="text-2xl font-black text-slate-900">{b.balance}</span><span className="text-xs text-slate-400">days left</span></div>
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden" title={`${b.balance} of ${total} days left`}><div className="h-full bg-emerald-500" style={{ width: `${leftPct}%` }} /></div>
                <div className="mt-1 text-[10px] text-slate-400">Used {b.used}{b.pending ? ` · ${b.pending} waiting` : ''} · {b.cycleLabel}</div>
              </>
            ) : (
              <>
                <div className="mt-1 text-sm font-bold text-slate-700">No limit</div>
                <div className="mt-1 text-[10px] text-slate-400">Taken {b.used} day(s) · {b.cycleLabel}</div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
};

export const Today: React.FC<{ me: any; reload: () => void; onApply: (typeId?: string) => void; onFix: () => void; onOpen: (tab: string) => void; refreshKey: number }> = ({ me, reload, onApply, onFix, onOpen, refreshKey }) => {
  const [mine, setMine] = useState<any[] | null>(null);
  const [away, setAway] = useState<any[] | null>(null);

  useEffect(() => {
    leaveService.myRequests().then((r) => setMine(r.items)).catch(() => setMine([]));
    leaveService.teamCalendar(me.today, me.today).then((r) => setAway(r.items.filter((i: any) => i.uid !== me.person.uid && i.status === 'APPROVED'))).catch(() => setAway([]));
  }, [me.today, me.person.uid, refreshKey]);

  const coming = (mine || []).filter((r) => ['PENDING', 'APPROVED', 'CANCEL_REQUESTED', 'INFO_REQUESTED'].includes(r.status) && r.to >= me.today).sort((a, b) => a.from.localeCompare(b.from)).slice(0, 4);
  const holidays = (me.holidays || []).filter((h: any) => h.date >= me.today).slice(0, 3);
  const first = (me.person.name || '').split(' ')[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">{greeting()}{first ? `, ${first}` : ''}</h2>
          <p className="text-sm text-slate-500">{shortDate(me.today)}</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button className={`${btnBig} flex-1 sm:flex-none`} onClick={() => onApply()}><CalendarPlus className="w-5 h-5" />Apply for leave</button>
          <button className={`${btnGhost} !py-3 !px-4 !text-sm`} onClick={onFix}><Wrench className="w-4 h-4" />Fix a day</button>
        </div>
      </div>

      {me.approvals > 0 && (
        <button onClick={() => onOpen('approvals')} className="w-full flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-left hover:bg-orange-100/70">
          <Inbox className="w-5 h-5 text-[#FA7014]" />
          <span className="flex-1 text-sm font-bold text-slate-800">{me.approvals} {me.approvals === 1 ? 'request is' : 'requests are'} waiting for your approval</span>
          <span className="text-xs font-bold text-[#FA7014]">Review →</span>
        </button>
      )}

      <PunchCard me={me} reload={reload} />

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-bold text-slate-800">Your leave balance</h3>
          <button className="text-xs font-bold text-slate-500 hover:text-slate-800" onClick={() => onOpen('my')}>History →</button>
        </div>
        <BalanceStrip me={me} onApply={(id) => onApply(id)} />
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card title="Your upcoming leave" className="md:col-span-2" right={<button className="text-xs font-bold text-slate-500 hover:text-slate-800" onClick={() => onOpen('my')}>All requests →</button>}>
          {!mine ? <Skeleton rows={2} /> : coming.length === 0 ? (
            <EmptyState title="No leave planned" text="Need a break? It takes under a minute." action={<button className={btnGhost} onClick={() => onApply()}>Apply for leave</button>} />
          ) : (
            <div className="divide-y divide-slate-100">
              {coming.map((r) => (
                <div key={r.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-800">{shortRange(r.from, r.to)} <span className="font-normal text-slate-400">· {relDay(r.from, me.today)}</span></div>
                    <div className="text-xs text-slate-500 truncate">{r.typeName} · {days(r.days)}{halfNote(r)}</div>
                  </div>
                  <StatusPill status={r.status} short />
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Away today">
            {!away ? <Skeleton rows={1} /> : away.length === 0 ? <div className="flex items-center gap-2 text-xs text-slate-500"><Users className="w-4 h-4" />Everyone in your team is in.</div> : (
              <div className="space-y-1.5">
                {away.slice(0, 6).map((a, i) => <div key={i} className="flex items-center gap-2 text-xs"><Palmtree className="w-3.5 h-3.5 text-sky-500" /><span className="font-semibold text-slate-700">{a.name}</span>{a.halfDay && <span className="text-slate-400">½ day</span>}</div>)}
                {away.length > 6 && <button className="text-xs font-bold text-slate-500" onClick={() => onOpen('team')}>+{away.length - 6} more</button>}
              </div>
            )}
          </Card>
          <Card title="Next holidays">
            {holidays.length === 0 ? <div className="text-xs text-slate-500">No holidays added yet.</div> : holidays.map((h: any) => (
              <div key={h.date} className="flex items-center gap-2 py-1 text-xs">
                <Sun className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                <span className="flex-1 text-slate-700 font-semibold truncate">{h.name}{h.optional ? <span className="font-normal text-slate-400"> (optional)</span> : ''}</span>
                <span className="text-slate-500 whitespace-nowrap">{shortDate(h.date)}</span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
};
