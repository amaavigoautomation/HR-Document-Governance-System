import React, { useCallback, useEffect, useState } from 'react';
import { leaveService } from '../../services/leaveService';
import { Card, Notice, StatusPill, btnDanger, btnGhost, btnPrimary, days, input, niceDate, range, thisMonth, todayIst, useRunner } from './ui';

export const ApprovalsTab: React.FC<{ reload: () => void }> = ({ reload }) => {
  const [data, setData] = useState<{ leaves: any[]; regularizations: any[] } | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const { busy, note, run } = useRunner();

  const load = useCallback(() => leaveService.inbox().then(setData).catch(() => setData({ leaves: [], regularizations: [] })), []);
  useEffect(() => { load(); }, [load]);

  const act = (id: string, decision: 'APPROVE' | 'REJECT', reg = false) =>
    run(async () => {
      const comment = comments[id] || '';
      if (reg) await leaveService.decideRegularization(id, decision, comment);
      else await leaveService.decide(id, decision, comment);
      await Promise.all([load(), reload()]);
    }, decision === 'APPROVE' ? 'Approved.' : 'Rejected.');

  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const empty = data.leaves.length === 0 && data.regularizations.length === 0;

  const Buttons = ({ id, reg, cancel }: { id: string; reg?: boolean; cancel?: boolean }) => (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className={`${input} max-w-xs`} placeholder="Comment (optional)" value={comments[id] || ''} onChange={(e) => setComments({ ...comments, [id]: e.target.value })} />
      <button className={btnPrimary} disabled={busy} onClick={() => act(id, 'APPROVE', reg)}>{cancel ? 'Allow cancellation' : 'Approve'}</button>
      <button className={btnDanger} disabled={busy} onClick={() => act(id, 'REJECT', reg)}>{cancel ? 'Keep leave' : 'Reject'}</button>
    </div>
  );

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {empty && <Card><div className="text-sm text-slate-500">Nothing is waiting for you.</div></Card>}
      {data.leaves.length > 0 && (
        <Card title={`Leave requests (${data.leaves.length})`}>
          <div className="divide-y divide-slate-100">
            {data.leaves.map((r) => (
              <div key={r.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-800">{r.name} · {r.typeName} · {days(r.days)}</div>
                    <div className="text-xs text-slate-500">{range(r.from, r.to)}{r.reason ? ` · “${r.reason}”` : ''}</div>
                    {r.docUrl && <a className="text-xs text-[#FA7014] underline" href={r.docUrl} target="_blank" rel="noopener noreferrer">Supporting document</a>}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    {r.stage === 'CANCEL' && <StatusPill status="CANCEL_REQUESTED" />}
                    {r.stage === 'HR' && <span className="px-2 py-0.5 rounded-full bg-slate-100">HR step</span>}
                    {r.stage === 'MANAGER' && r.managerName && <span>Manager: {r.managerName}</span>}
                    {r.escalated && <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">Waiting {r.waitingDays}d</span>}
                  </div>
                </div>
                <Buttons id={r.id} cancel={r.stage === 'CANCEL'} />
              </div>
            ))}
          </div>
        </Card>
      )}
      {data.regularizations.length > 0 && (
        <Card title={`Attendance corrections (${data.regularizations.length})`}>
          <div className="divide-y divide-slate-100">
            {data.regularizations.map((r) => (
              <div key={r.id} className="py-3">
                <div className="text-sm font-bold text-slate-800">{r.name} · {niceDate(r.date)}</div>
                <div className="text-xs text-slate-500">{r.checkIn} to {r.checkOut} · “{r.reason}”</div>
                <Buttons id={r.id} reg />
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};


// ------------------------------------------------------------------ team calendar (month grid)

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_CHIPS = 3;

const shiftMonth = (m: string, delta: number) =>
  new Date(Date.UTC(parseInt(m.slice(0, 4), 10), parseInt(m.slice(5, 7), 10) - 1 + delta, 1)).toISOString().slice(0, 7);
const monthTitle = (m: string) => `${MONTH_NAMES[parseInt(m.slice(5, 7), 10) - 1]} ${m.slice(0, 4)}`;

const CHIP_STYLE: Record<string, string> = {
  PENDING: 'bg-orange-100 text-orange-800 border-orange-200',
  APPROVED: 'bg-sky-100 text-sky-800 border-sky-200',
};

export const TeamCalendar: React.FC = () => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayIst();

  useEffect(() => {
    const y = parseInt(month.slice(0, 4), 10);
    const m = parseInt(month.slice(5, 7), 10);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    let alive = true;
    setError(null);
    setLoading(true);
    setSelected(null);
    leaveService.teamCalendar(`${month}-01`, last)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [month]);

  const y = parseInt(month.slice(0, 4), 10);
  const m = parseInt(month.slice(5, 7), 10);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
  const totalCells = Math.ceil((offset + daysInMonth) / 7) * 7;
  const iso = (day: number) => `${month}-${String(day).padStart(2, '0')}`;

  const items: any[] = data?.items || [];
  const holidays: any[] = data?.holidays || [];
  const leavesOn = (d: string) => items.filter((i) => i.from <= d && i.to >= d);
  const holidayOn = (d: string) => holidays.find((h) => h.date === d);
  const awayThisMonth = new Set(items.map((i) => i.uid || i.name)).size;

  const selectedLeaves = selected ? leavesOn(selected) : [];
  const selectedHoliday = selected ? holidayOn(selected) : undefined;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <button className={btnGhost} aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
            <h3 className="text-base font-bold text-slate-900 min-w-[9.5rem] text-center">{monthTitle(month)}</h3>
            <button className={btnGhost} aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
            {month !== thisMonth() && <button className={btnGhost} onClick={() => setMonth(thisMonth())}>Today</button>}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400" /> Approved</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-300" /> Pending</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-300" /> Holiday</span>
          </div>
        </div>

        {error && <div className="p-3"><Notice tone="error">{error}</Notice></div>}

        <div className={`overflow-x-auto ${loading ? 'opacity-60' : ''} transition-opacity`}>
          <div className="min-w-[640px]">
            {/* weekday row */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`px-2 py-2 text-[11px] font-bold uppercase tracking-wide ${i === 6 ? 'text-slate-400' : 'text-slate-500'}`}>{w}</div>
              ))}
            </div>

            {/* day cells */}
            <div className="grid grid-cols-7">
              {Array.from({ length: totalCells }, (_, idx) => {
                const day = idx - offset + 1;
                const inMonth = day >= 1 && day <= daysInMonth;
                const borders = `border-b border-slate-100 ${idx % 7 !== 6 ? 'border-r' : ''}`;
                if (!inMonth) return <div key={idx} className={`min-h-[6.5rem] bg-slate-50/60 ${borders}`} />;

                const d = iso(day);
                const leaves = leavesOn(d);
                const hol = holidayOn(d);
                const isToday = d === today;
                const isSel = d === selected;
                const sunday = idx % 7 === 6;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelected(isSel ? null : d)}
                    className={`min-h-[6.5rem] p-1.5 text-left align-top flex flex-col gap-1 transition-colors ${borders} ${
                      isSel ? 'bg-[#FA7014]/5 ring-2 ring-inset ring-[#FA7014]/50' : hol ? 'bg-violet-50/60 hover:bg-violet-50' : sunday ? 'bg-slate-50/60 hover:bg-slate-100/60' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-[#FA7014] text-white' : sunday ? 'text-slate-400' : 'text-slate-700'}`}>{day}</span>
                    {hol && <span className="text-[10px] leading-tight font-semibold text-violet-700 truncate w-full" title={hol.name}>{hol.name}</span>}
                    {leaves.slice(0, MAX_CHIPS).map((l, k) => (
                      <span key={k} title={`${l.name}${l.type ? ' · ' + l.type : ''}${l.status === 'PENDING' ? ' (pending)' : ''}`}
                        className={`text-[10px] leading-tight font-semibold px-1.5 py-0.5 rounded border truncate w-full ${CHIP_STYLE[l.status] || CHIP_STYLE.APPROVED}`}>
                        {l.name}{l.halfDay ? ' ½' : ''}
                      </span>
                    ))}
                    {leaves.length > MAX_CHIPS && <span className="text-[10px] font-semibold text-slate-500 px-1">+{leaves.length - MAX_CHIPS} more</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-4 py-2.5 border-t border-slate-200 text-xs text-slate-500 bg-slate-50/60">
          {items.length === 0 ? 'No one is away this month.' : `${awayThisMonth} ${awayThisMonth === 1 ? 'person is' : 'people are'} away this month.`} Click a day to see details.
        </div>
      </div>

      {/* selected day detail */}
      {selected && (
        <Card title={niceDate(selected)} right={<button className={btnGhost} onClick={() => setSelected(null)}>Close</button>}>
          {selectedHoliday && <div className="text-xs font-semibold text-violet-700 mb-2">Holiday: {selectedHoliday.name}{selectedHoliday.optional ? ' (optional)' : ''}</div>}
          {selectedLeaves.length === 0 ? (
            <div className="text-sm text-slate-500">Nobody is on leave this day.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedLeaves.map((l, k) => (
                <div key={k} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-800">{l.name}{l.halfDay ? ' · half day' : ''}</div>
                    <div className="text-xs text-slate-500">
                      {l.type || 'On leave'} · {range(l.from, l.to)}{l.reason ? ` · “${l.reason}”` : ''}
                    </div>
                  </div>
                  <StatusPill status={l.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
export { btnGhost };