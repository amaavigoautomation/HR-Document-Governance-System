import React, { useCallback, useEffect, useState } from 'react';
import { leaveService } from '../../services/leaveService';
import { Card, Field, Notice, STATUS_LABEL, StatusPill, btnGhost, btnPrimary, dayName, input, niceDate, thisMonth, todayIst, useRunner } from './ui';

const CODE: Record<string, { code: string; label: string; cell: string; dot: string }> = {
  PRESENT: { code: 'P', label: 'Present', cell: 'bg-emerald-50 border-emerald-200 text-emerald-800', dot: 'bg-emerald-500' },
  LATE: { code: 'LT', label: 'Present, late', cell: 'bg-amber-50 border-amber-200 text-amber-800', dot: 'bg-amber-500' },
  HALF_DAY: { code: 'HD', label: 'Half day', cell: 'bg-orange-50 border-orange-200 text-orange-800', dot: 'bg-orange-500' },
  INCOMPLETE: { code: 'NO', label: 'No check-out', cell: 'bg-amber-50 border-amber-300 text-amber-800', dot: 'bg-amber-600' },
  ABSENT: { code: 'A', label: 'Absent', cell: 'bg-rose-50 border-rose-200 text-rose-700', dot: 'bg-rose-500' },
  LEAVE: { code: 'L', label: 'Leave', cell: 'bg-sky-50 border-sky-200 text-sky-800', dot: 'bg-sky-500' },
  HALF_LEAVE: { code: 'HL', label: 'Half-day leave', cell: 'bg-sky-50 border-sky-200 text-sky-800', dot: 'bg-sky-400' },
  HOLIDAY: { code: 'H', label: 'Holiday', cell: 'bg-violet-50 border-violet-200 text-violet-800', dot: 'bg-violet-500' },
  WEEKLY_OFF: { code: 'WO', label: 'Weekly off', cell: 'bg-slate-100 border-slate-200 text-slate-500', dot: 'bg-slate-400' },
  TODAY: { code: '·', label: 'Today', cell: 'bg-white border-[#FA7014] text-slate-600', dot: 'bg-[#FA7014]' },
};
const hm = (m: number) => (m ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '');
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const MonthView: React.FC<{ uid?: string; onPickDay?: (d: any) => void }> = ({ uid, onPickDay }) => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [picked, setPicked] = useState<any | null>(null);

  const load = useCallback(() => {
    setError(null);
    leaveService.attendance(month, uid).then((r) => { setData(r); setPicked(null); }).catch((e) => setError(e.message));
  }, [month, uid]);
  useEffect(load, [load]);

  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  const s = data?.summary;
  const days: any[] = (data?.days || []).filter((d: any) => d.status !== 'NOT_EMPLOYED');
  const count = (...st: string[]) => days.filter((d) => st.includes(d.status)).length;
  const worked = days.filter((d) => d.workedMinutes > 0);
  const avg = worked.length ? Math.round(worked.reduce((n, d) => n + d.workedMinutes, 0) / worked.length) : 0;
  const lead = data?.days?.length ? new Date(`${data.days[0].date}T00:00:00Z`).getUTCDay() : 0;
  const today = todayIst();
  const pick = (d: any) => { setPicked(d); onPickDay?.(d); };

  const tiles: [string, string | number, string][] = s ? [
    ['Present', s.present, 'bg-emerald-500'], ['Absent', s.absent, 'bg-rose-500'], ['Leave', s.leave, 'bg-sky-500'], ['Late marks', s.late, 'bg-amber-500'],
    ['Half days', s.halfDay, 'bg-orange-500'], ['Holidays', count('HOLIDAY'), 'bg-violet-500'], ['Weekly offs', count('WEEKLY_OFF'), 'bg-slate-400'],
    ['Avg hours / day', avg ? hm(avg) : '–', 'bg-[#FA7014]'], ['Loss of pay', s.lossOfPayDays, 'bg-rose-400'],
  ] : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnGhost} aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
        <input type="month" className={`${input} max-w-[11rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className={btnGhost} aria-label="Next month" onClick={() => shift(1)}>›</button>
        {data?.person?.name && uid && <span className="text-sm font-bold text-slate-700">{data.person.name}</span>}
        <div className="ml-auto inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-bold">
          {([['calendar', 'Calendar'], ['list', 'List']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 rounded-md ${view === k ? 'bg-[#FA7014] text-white' : 'text-slate-600'}`}>{l}</button>
          ))}
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {s && (
        <div className="grid grid-cols-3 md:grid-cols-5 xl:grid-cols-9 gap-2">
          {tiles.map(([k, v, c]) => (
            <div key={k} className="bg-white border border-slate-200 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className={`w-2 h-2 rounded-full ${c}`} />{k}</div>
              <div className="text-lg font-black text-slate-900 leading-tight">{v}</div>
            </div>
          ))}
        </div>
      )}
      {s?.lateDeductionDays > 0 && <Notice>{s.late} late marks this month: a deduction of {s.lateDeductionDays} day(s) is suggested by your company's late rule.</Notice>}

      {view === 'calendar' ? (
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <div className="grid grid-cols-7 gap-1.5 mb-1.5">{WEEK.map((w) => <div key={w} className="text-[10px] font-bold text-slate-400 text-center uppercase">{w}</div>)}</div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
            {(data?.days || []).map((d: any) => {
              const c = CODE[d.status];
              const na = d.status === 'NOT_EMPLOYED' || d.status === 'FUTURE' || !c;
              return (
                <button key={d.date} type="button" disabled={d.status === 'NOT_EMPLOYED'} onClick={() => pick(d)}
                  className={`min-h-[4.25rem] text-left rounded-lg border p-1.5 transition-shadow hover:shadow-sm ${na ? 'bg-slate-50 border-slate-100 text-slate-300' : c.cell} ${d.date === today ? 'ring-2 ring-[#FA7014]/60' : ''} ${picked?.date === d.date ? 'outline outline-2 outline-slate-700' : ''}`}>
                  <div className="flex items-center justify-between"><span className="text-xs font-bold">{Number(d.date.slice(8))}</span>{!na && <span className="text-[10px] font-black">{c.code}</span>}</div>
                  {d.checkIn && <div className="text-[10px] leading-tight mt-1">{d.checkIn}{d.checkOut ? `–${d.checkOut}` : ''}</div>}
                  {d.workedMinutes > 0 && <div className="text-[10px] opacity-70 leading-tight">{hm(d.workedMinutes)}</div>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[10px] text-slate-500">
            {['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'].map((k) => <span key={k} className="flex items-center gap-1"><span className={`w-2 h-2 rounded-full ${CODE[k].dot}`} />{CODE[k].code} {CODE[k].label}</span>)}
          </div>
          {picked && picked.status !== 'NOT_EMPLOYED' && (
            <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs flex flex-wrap items-center gap-x-6 gap-y-1">
              <b className="text-slate-900">{niceDate(picked.date)}</b>
              <span>{CODE[picked.status]?.label || '–'}</span>
              <span>In <b>{picked.checkIn || '—'}</b></span><span>Out <b>{picked.checkOut || '—'}</b></span>
              {picked.workedMinutes > 0 && <span>Hours <b>{hm(picked.workedMinutes)}</b></span>}
              {(picked.note || (picked.source && picked.source !== 'SELF')) && <span className="text-slate-500">{picked.source && picked.source !== 'SELF' ? picked.source.toLowerCase() : ''}{picked.note ? ` · ${picked.note}` : ''}</span>}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2">Date</th><th className="p-2">Status</th><th className="p-2">In</th><th className="p-2">Out</th><th className="p-2 hidden sm:table-cell">Hours</th><th className="p-2 hidden sm:table-cell">Note</th></tr></thead>
            <tbody>
              {days.map((d: any) => (
                <tr key={d.date} className={`border-t border-slate-100 ${onPickDay ? 'cursor-pointer hover:bg-slate-50' : ''}`} onClick={() => onPickDay?.(d)}>
                  <td className="p-2 whitespace-nowrap">{dayName(d.date)} {d.date.slice(8)}</td>
                  <td className="p-2">{STATUS_LABEL[d.status] === '' ? <span className="text-slate-300">—</span> : <StatusPill status={d.status} />}</td>
                  <td className="p-2">{d.checkIn || '—'}</td><td className="p-2">{d.checkOut || '—'}</td>
                  <td className="p-2 hidden sm:table-cell">{hm(d.workedMinutes)}</td>
                  <td className="p-2 hidden sm:table-cell text-slate-400">{d.source && d.source !== 'SELF' ? d.source.toLowerCase() : ''}{d.note ? ` · ${d.note}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/** Minutes since midnight in IST, refreshed every 30 seconds. */
function useIstClock() {
  const calc = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return { mins: d.getUTCHours() * 60 + d.getUTCMinutes(), label: d.toISOString().slice(11, 16), secs: d.getUTCSeconds() }; };
  const [t, setT] = useState(calc);
  useEffect(() => { const id = setInterval(() => setT(calc()), 15_000); return () => clearInterval(id); }, []);
  return t;
}
const toMin = (hhmm: string) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return h * 60 + m; };

export const AttendanceTab: React.FC<{ me: any; reload: () => void }> = ({ me, reload }) => {
  const { busy, note, run } = useRunner();
  const [regs, setRegs] = useState<any[]>([]);
  const [form, setForm] = useState({ date: '', checkIn: me.settings.shift.start, checkOut: me.settings.shift.end, reason: '' });
  const [tick, setTick] = useState(0);
  const att = me.attendanceToday;
  const clock = useIstClock();
  const shiftMins = Math.max(0, toMin(me.settings.shift.end) - toMin(me.settings.shift.start));
  const workedNow = att.checkIn ? Math.max(0, (att.checkOut ? toMin(att.checkOut) : clock.mins) - toMin(att.checkIn)) : 0;

  const loadRegs = useCallback(() => leaveService.myRegularizations().then((r) => setRegs(r.items)).catch(() => undefined), []);
  useEffect(() => { loadRegs(); }, [loadRegs]);

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card className="!p-0 overflow-hidden">
          <div className="bg-gradient-to-r from-[#FA7014] to-[#f59a4b] text-white px-5 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wide opacity-90">{niceDate(me.today)}</div>
              <div className="text-3xl font-black leading-none mt-1 tabular-nums">{clock.label}</div>
              <div className="text-[11px] opacity-90 mt-1">Shift {me.settings.shift.start} – {me.settings.shift.end}</div>
            </div>
            <div className="flex gap-2">
              <button className="px-5 py-2.5 rounded-lg text-sm font-bold bg-white text-[#FA7014] hover:bg-orange-50 disabled:opacity-50" disabled={busy || !!att.checkIn} onClick={() => run(async () => { await leaveService.checkIn(); await reload(); setTick(tick + 1); }, 'Checked in.')}>Check in</button>
              <button className="px-5 py-2.5 rounded-lg text-sm font-bold bg-white/20 border border-white/60 text-white hover:bg-white/30 disabled:opacity-40" disabled={busy || !att.checkIn || !!att.checkOut} onClick={() => run(async () => { await leaveService.checkOut(); await reload(); setTick(tick + 1); }, 'Checked out.')}>Check out</button>
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-[10px] text-slate-500">Check-in</div><div className="text-base font-black text-slate-900">{att.checkIn || '—'}</div></div>
              <div><div className="text-[10px] text-slate-500">Check-out</div><div className="text-base font-black text-slate-900">{att.checkOut || '—'}</div></div>
              <div><div className="text-[10px] text-slate-500">{att.checkOut ? 'Hours worked' : 'Working so far'}</div><div className="text-base font-black text-slate-900">{att.checkIn ? hm(workedNow) || '0h 00m' : '—'}</div></div>
            </div>
            <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${shiftMins ? Math.min(100, Math.round((workedNow / shiftMins) * 100)) : 0}%` }} /></div>
            <div className="mt-1 text-[10px] text-slate-400 flex justify-between"><span>0h</span><span>Shift {hm(shiftMins)}</span></div>
            {att.checkIn && !att.checkOut && <p className="text-[11px] text-slate-500 mt-2">Remember to check out when you finish. A missed check-out can be corrected from the panel on the right.</p>}
            {note && <div className="mt-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
          </div>
        </Card>
        <MonthView key={tick} onPickDay={(d) => { if (d.date <= todayIst()) setForm((f) => ({ ...f, date: d.date })); }} />
      </div>
      <div className="space-y-4">
        <Card title="Missed a swipe? Ask for a correction">
          <div className="space-y-2">
            <Field label="Date"><input type="date" className={input} max={todayIst()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="In"><input type="time" className={input} value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></Field>
              <Field label="Out"><input type="time" className={input} value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></Field>
            </div>
            <Field label="Reason"><textarea rows={2} className={input} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await leaveService.regularize(form); setForm({ ...form, date: '', reason: '' }); await loadRegs(); }, 'Sent to your manager.')}>Send for approval</button>
          </div>
        </Card>
        <Card title="My corrections">
          {regs.length === 0 ? <div className="text-xs text-slate-500">None yet.</div> : regs.slice(0, 12).map((r) => (
            <div key={r.id} className="py-1.5 flex justify-between items-center text-xs border-b border-slate-100 last:border-0">
              <span>{niceDate(r.date)} · {r.checkIn}–{r.checkOut}</span><StatusPill status={r.status} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
};
