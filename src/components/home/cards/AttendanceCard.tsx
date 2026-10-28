import React, { useEffect, useState } from 'react';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { leaveService } from '../../../services/leaveService';
import { homeService } from '../../../services/homeService';
import { Notice, btnPrimary, input, niceDate, useRunner } from '../../leave/ui';
import { HomeCard, NoData } from '../parts';
import { useLoad } from '../useLoad';

const Clock12: React.FC = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  const day = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
  return (
    <div className="text-center">
      <div className="text-3xl font-black tabular-nums text-slate-800" aria-label="Current time">{time}</div>
      <div className="text-xs text-slate-500">{day}</div>
    </div>
  );
};

export const AttendanceCard: React.FC<{ refreshKey: number; onChanged: () => void }> = ({ refreshKey, onChanged }) => {
  const [page, setPage] = useState(1);
  const [remarks, setRemarks] = useState('');
  const me = useLoad(() => leaveService.me(), [refreshKey]);
  const punches = useLoad(() => homeService.punches(page), [page, refreshKey]);
  const { busy, note, run } = useRunner();
  const att = me.data?.attendanceToday as { checkIn: string | null; checkOut: string | null } | undefined;
  const configured = !me.data || me.data.configured !== false;
  const found = !me.data || me.data.found !== false;
  const state: 'IN' | 'OUT' | 'DONE' = !att?.checkIn ? 'IN' : !att.checkOut ? 'OUT' : 'DONE';

  const punch = () => run(async () => {
    if (state === 'IN') await leaveService.checkIn(remarks.trim());
    else await leaveService.checkOut(remarks.trim());
    setRemarks('');
    setPage(1);
    me.reload();
    punches.reload();
    onChanged();
  }, state === 'IN' ? 'Punched in' : 'Punched out');

  const p = punches.data;
  return (
    <HomeCard title="Online attendance" icon={<Clock className="w-4 h-4 text-[#FA7014]" />} loading={me.loading && !me.data} error={me.error} onRetry={me.reload}>
      {!configured || !found ? (
        <NoData text="Attendance is not available for you yet" hint="HR needs to add you under Leave & Attendance." />
      ) : (
        <>
          <Clock12 />
          <div className="mt-3 flex items-center justify-center gap-6 text-xs text-slate-600">
            <span>In: <b className="tabular-nums">{att?.checkIn || '--'}</b></span>
            <span>Out: <b className="tabular-nums">{att?.checkOut || '--'}</b></span>
          </div>
          {state !== 'DONE' ? (
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input className={input} maxLength={200} placeholder="Remarks (optional)" aria-label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              <button type="button" className={`${btnPrimary} whitespace-nowrap`} disabled={busy} onClick={() => void punch()}>
                {state === 'IN' ? <><LogIn className="w-3.5 h-3.5" />Punch in</> : <><LogOut className="w-3.5 h-3.5" />Punch out</>}
              </button>
            </div>
          ) : <p className="mt-3 text-center text-xs text-emerald-700 font-semibold">You are done for today.</p>}
          {note && <div className="mt-2"><Notice tone={note.tone}>{note.text}</Notice></div>}

          <div className="mt-4 text-[11px] font-bold text-slate-400 uppercase tracking-wide">Recent in / out</div>
          {punches.error ? <p className="text-xs text-rose-700 mt-1">{punches.error}</p> : !p ? <p className="text-xs text-slate-400 mt-1">Loading…</p> : p.rows.length === 0 ? (
            <p className="text-xs text-slate-400 mt-1">No punches yet.</p>
          ) : (
            <>
              <table className="w-full text-xs mt-1">
                <thead><tr className="text-left text-slate-400"><th className="py-1 font-semibold">Date</th><th className="font-semibold">Time</th><th className="font-semibold">Type</th><th className="font-semibold">Remarks</th></tr></thead>
                <tbody>
                  {p.rows.map((r, i) => (
                    <tr key={`${r.date}-${r.kind}-${i}`} className="border-t border-slate-100">
                      <td className="py-1.5">{niceDate(r.date)}</td><td className="tabular-nums">{r.time}</td>
                      <td><span className={`font-bold ${r.kind === 'IN' ? 'text-emerald-700' : 'text-rose-600'}`}>{r.kind}</span></td>
                      <td className="text-slate-500 truncate max-w-[8rem]">{r.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {p.pages > 1 && (
                <div className="mt-2 flex items-center justify-end gap-2 text-xs">
                  <button type="button" className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <span className="text-slate-500">{p.page} / {p.pages}</span>
                  <button type="button" className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40" disabled={page >= p.pages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </HomeCard>
  );
};
