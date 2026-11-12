import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, CalendarDays, CalendarX, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Hourglass, LogIn, LogOut, Palmtree, Wrench } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { btnViolet, dmy, Kpi, MonthChip, PageHead, Pager, Panel, Pill, shiftMonthStr, t12, Tabs, THead } from './kit';
import {
  btnBig, btnGhost, btnPrimary, Card, DAY_LOOK, dayName, Drawer, EmptyState, Field, hm, input, niceDate, Notice, Segmented, Skeleton,
  STATUS_LABEL, StatusPill, shortDate, thisMonth, todayIst, addDaysIso, useRunner,
} from './ui';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthTitle = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const toMin = (hhmm: string) => { const [h, m] = (hhmm || '0:0').split(':').map(Number); return h * 60 + m; };
/** Corrections can be asked for any day since joining (the server checks the join date). */
const canFix = (d: any) => {
  const today = todayIst();
  return d.date <= today && !['HOLIDAY', 'WEEKLY_OFF', 'NOT_EMPLOYED', 'FUTURE', 'LEAVE'].includes(d.status);
};

/** Minutes since midnight in IST, refreshed every 15 seconds. */
function useIstClock() {
  const calc = () => { const d = new Date(Date.now() + 5.5 * 3600_000); return { mins: d.getUTCHours() * 60 + d.getUTCMinutes(), label: d.toISOString().slice(11, 16) }; };
  const [t, setT] = useState(calc);
  useEffect(() => { const id = setInterval(() => setT(calc()), 15_000); return () => clearInterval(id); }, []);
  return t;
}

// ------------------------------------------------------------------ check-in card (used on Today and Attendance)

export const PunchCard: React.FC<{ me: any; reload: () => void; onChanged?: () => void }> = ({ me, reload, onChanged }) => {
  const { busy, note, run } = useRunner();
  const att = me.attendanceToday;
  const clock = useIstClock();
  const shift = me.settings.shift;
  const shiftMins = Math.max(0, toMin(shift.end) - toMin(shift.start));
  // Finished sessions plus the one running now; time between sessions (washroom, lunch) is not counted.
  const worked = (att.workedMinutes || 0) + (att.open && att.openSince ? Math.max(0, clock.mins - toMin(att.openSince)) : 0);
  const pct = shiftMins ? Math.min(100, Math.round((worked / shiftMins) * 100)) : 0;
  const state: 'out' | 'in' | 'back' = !att.checkIn ? 'out' : att.open ? 'in' : 'back';
  const late = att.checkIn && toMin(att.checkIn) > toMin(shift.start) + (shift.graceMinutes || 0);

  const punch = (kind: 'in' | 'out') => run(async () => {
    if (kind === 'in') await leaveService.checkIn(); else await leaveService.checkOut();
    await reload();
    onChanged?.();
  }, kind === 'in' ? 'Checked in. Have a good day!' : 'Checked out.');

  return (
    <Card className="!p-0 overflow-hidden">
      <div className="p-5 flex flex-wrap items-center gap-5">
        <div className="flex-1 min-w-[12rem]">
          <div className="text-xs font-semibold text-slate-500">{shortDate(me.today)} · Shift {shift.start}–{shift.end}</div>
          <div className="text-4xl font-black text-slate-900 tabular-nums leading-tight mt-0.5">{clock.label}</div>
          <div className="text-sm mt-1">
            {state === 'out' && <span className="text-slate-600">You have not checked in yet.</span>}
            {state === 'in' && <span className="text-emerald-700 font-semibold">Working since {att.openSince}{late ? <span className="text-amber-700"> (late)</span> : ''} · {hm(worked) || '0h 00m'} today</span>}
            {state === 'back' && <span className="text-slate-700 font-semibold">Checked out at {att.checkOut} · {hm(worked) || '0h 00m'} worked today</span>}
          </div>
        </div>
        <div className="w-full sm:w-auto">
          {(state === 'out' || state === 'back') && <button className={`${btnBig} w-full sm:w-44`} disabled={busy} onClick={() => punch('in')}><LogIn className="w-5 h-5" />{state === 'back' ? 'Check in again' : 'Check in'}</button>}
          {state === 'in' && <button className={`${btnBig} w-full sm:w-44 !bg-slate-900 hover:!bg-slate-800`} disabled={busy} onClick={() => punch('out')}><LogOut className="w-5 h-5" />Check out</button>}
        </div>
      </div>
      {state !== 'out' && (
        <div className="px-5 pb-4">
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="mt-1 text-[11px] text-slate-400 flex justify-between"><span>{pct}% of your {hm(shiftMins)} shift</span>{state === 'in' && <span>Check out when you step away</span>}</div>
        </div>
      )}
      {att.sessions?.length > 1 && (
        <div className="px-5 pb-4 text-[11px] text-slate-500">Today: {att.sessions.map((x: any) => `${x.in}–${x.out || 'now'}`).join(' · ')}</div>
      )}
      {note && <div className="px-5 pb-4"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
    </Card>
  );
};

// ------------------------------------------------------------------ month calendar (also used by HR reports)

export const MonthView: React.FC<{ uid?: string; onPickDay?: (d: any) => void; onFixDay?: (d: any) => void }> = ({ uid, onPickDay, onFixDay }) => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [picked, setPicked] = useState<any | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(() => {
    setError(null);
    leaveService.attendance(month, uid).then((r) => { setData(r); setPicked(null); }).catch((e) => setError(e.message));
  }, [month, uid]);
  useEffect(load, [load]);

  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)); };
  const s = data?.summary;
  const all: any[] = data?.days || [];
  const shown = all.filter((d: any) => d.status !== 'NOT_EMPLOYED');
  const count = (...st: string[]) => shown.filter((d) => st.includes(d.status)).length;
  const worked = shown.filter((d) => d.workedMinutes > 0);
  const avg = worked.length ? Math.round(worked.reduce((n, d) => n + d.workedMinutes, 0) / worked.length) : 0;
  const lead = all.length ? new Date(`${all[0].date}T00:00:00Z`).getUTCDay() : 0;
  const today = todayIst();
  const pick = (d: any) => { setPicked(picked?.date === d.date ? null : d); onPickDay?.(d); };
  const isNow = month === thisMonth();

  const tiles: { label: string; value: string | number; tone: string; show: boolean }[] = s ? [
    { label: 'Days present', value: s.present, tone: 'text-emerald-700', show: true },
    { label: 'On leave', value: s.leave, tone: 'text-sky-700', show: true },
    { label: 'Late', value: s.late, tone: s.late ? 'text-amber-700' : 'text-slate-900', show: true },
    { label: 'Absent', value: s.absent, tone: s.absent ? 'text-rose-700' : 'text-slate-900', show: true },
    { label: 'Missed check-out', value: s.incomplete, tone: 'text-rose-700', show: s.incomplete > 0 },
    { label: 'Half days', value: s.halfDay, tone: 'text-orange-700', show: more },
    { label: 'Holidays', value: count('HOLIDAY'), tone: 'text-violet-700', show: more },
    { label: 'Weekly offs', value: count('WEEKLY_OFF'), tone: 'text-slate-600', show: more },
    { label: 'Avg hours a day', value: avg ? hm(avg) : '–', tone: 'text-slate-900', show: more },
    { label: 'Unpaid days', value: s.lossOfPayDays, tone: s.lossOfPayDays ? 'text-rose-700' : 'text-slate-900', show: more || s.lossOfPayDays > 0 },
  ] : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className={`${btnGhost} !px-2`} aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="w-4 h-4" /></button>
          <h3 className="text-base font-bold text-slate-900 min-w-[9.5rem] text-center">{monthTitle(month)}</h3>
          <button className={`${btnGhost} !px-2`} aria-label="Next month" disabled={isNow && !uid} onClick={() => shift(1)}><ChevronRight className="w-4 h-4" /></button>
          {!isNow && <button className={btnGhost} onClick={() => setMonth(thisMonth())}>This month</button>}
        </div>
        {data?.person?.name && uid && <span className="text-sm font-bold text-slate-700">{data.person.name}</span>}
        <div className="ml-auto"><Segmented size="sm" value={view} onChange={setView} options={[{ value: 'calendar', label: 'Calendar' }, { value: 'list', label: 'List' }]} /></div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Skeleton rows={4} />}

      {s && (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {tiles.filter((t) => t.show).map((t) => (
              <div key={t.label} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                <div className={`text-2xl font-black leading-none ${t.tone}`}>{t.value}</div>
                <div className="text-[11px] font-semibold text-slate-500 mt-1">{t.label}</div>
              </div>
            ))}
          </div>
          <button className="mt-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-800" onClick={() => setMore(!more)}>{more ? 'Show less' : 'Show more numbers'}</button>
        </div>
      )}
      {s?.lateDeductionDays > 0 && <Notice tone="warn">You were late {s.late} times this month. Your company's rule may cut {s.lateDeductionDays} day(s) of pay for that.</Notice>}

      {data && view === 'calendar' && (
        <div className="bg-white border border-slate-200 rounded-xl p-2 sm:p-3">
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1.5">{WEEK.map((w) => <div key={w} className="text-[10px] font-bold text-slate-400 text-center uppercase">{w}</div>)}</div>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
            {all.map((d: any) => {
              const look = DAY_LOOK[d.status];
              const na = d.status === 'NOT_EMPLOYED' || d.status === 'FUTURE' || !look;
              const Icon = look?.icon;
              const sel = picked?.date === d.date;
              return (
                <button key={d.date} type="button" disabled={d.status === 'NOT_EMPLOYED'} onClick={() => pick(d)}
                  aria-label={`${niceDate(d.date)}: ${STATUS_LABEL[d.status] || 'no record'}`}
                  className={`min-h-[3.25rem] sm:min-h-[4.5rem] text-left rounded-lg border p-1 sm:p-1.5 transition-shadow hover:shadow-sm ${na ? 'bg-slate-50 border-slate-100 text-slate-300' : look.cell} ${d.date === today ? 'ring-2 ring-[#6d4cf0]/70' : ''} ${sel ? 'outline outline-2 outline-slate-800' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{Number(d.date.slice(8))}</span>
                    {!na && Icon && <Icon className="w-3.5 h-3.5" />}
                  </div>
                  {!na && <div className="hidden sm:block text-[10px] font-semibold leading-tight mt-1 truncate">{STATUS_LABEL[d.status]}</div>}
                  {d.provisionalLeave && <div className="text-[9px] sm:text-[10px] font-bold leading-tight mt-0.5 text-amber-700">Emergency leave (provisional)</div>}
                  {d.checkIn && <div className="hidden sm:block text-[10px] leading-tight opacity-75">{d.checkIn}{d.checkOut ? `–${d.checkOut}` : ''}</div>}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[11px] text-slate-500">
            {['PRESENT', 'LATE', 'INCOMPLETE', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'].map((k) => {
              const Icon = DAY_LOOK[k].icon;
              return <span key={k} className="flex items-center gap-1"><Icon className="w-3 h-3" />{STATUS_LABEL[k]}</span>;
            })}
          </div>
          {picked && picked.status !== 'NOT_EMPLOYED' && (
            <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <div>
                <div className="text-sm font-bold text-slate-900">{shortDate(picked.date)}</div>
                <div className="mt-0.5">{STATUS_LABEL[picked.status] ? <StatusPill status={picked.status} /> : <span className="text-slate-400">Nothing recorded yet</span>}</div>
              </div>
              <span>In <b>{picked.checkIn || '—'}</b></span>
              <span>Out <b>{picked.checkOut || '—'}</b></span>
              {picked.workedMinutes > 0 && <span>Worked <b>{hm(picked.workedMinutes)}</b></span>}
              {(picked.note || (picked.source && picked.source !== 'SELF')) && <span className="text-slate-500">{picked.source && picked.source !== 'SELF' ? `Changed by ${picked.source.toLowerCase()}` : ''}{picked.note ? ` · ${picked.note}` : ''}</span>}
              {onFixDay && canFix(picked) && (
                <button className={`${btnPrimary} ml-auto`} onClick={() => onFixDay(picked)}><Wrench className="w-3.5 h-3.5" />Fix this day</button>
              )}
            </div>
          )}
          {!picked && onFixDay && <p className="mt-2 text-[11px] text-slate-400">Tap a day to see its times. Wrong or missing? Tap it and choose “Fix this day”.</p>}
        </div>
      )}

      {data && view === 'list' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2">Date</th><th className="p-2">Status</th><th className="p-2">In</th><th className="p-2">Out</th><th className="p-2 hidden sm:table-cell">Worked</th><th className="p-2" /></tr></thead>
            <tbody>
              {shown.map((d: any) => (
                <tr key={d.date} className={`border-t border-slate-100 ${d.date === today ? 'bg-orange-50/50' : ''}`}>
                  <td className="p-2 whitespace-nowrap font-semibold text-slate-700">{dayName(d.date)} {Number(d.date.slice(8))}</td>
                  <td className="p-2">{STATUS_LABEL[d.status] ? <StatusPill status={d.status} /> : <span className="text-slate-300">—</span>}</td>
                  <td className="p-2">{d.checkIn || '—'}</td><td className="p-2">{d.checkOut || '—'}</td>
                  <td className="p-2 hidden sm:table-cell">{hm(d.workedMinutes)}</td>
                  <td className="p-2 text-right">{onFixDay && canFix(d) && <button className="text-[#6d4cf0] font-bold" onClick={() => onFixDay(d)}>Fix</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ correction drawer

export const FixDayDrawer: React.FC<{ me: any; day: any | null; open: boolean; onClose: () => void; onSent: () => void }> = ({ me, day, open, onClose, onSent }) => {
  const shift = me.settings.shift;
  const [form, setForm] = useState({ date: '', checkIn: shift.start, checkOut: shift.end, reason: '' });
  const { busy, note, setNote, run } = useRunner();
  useEffect(() => {
    if (!open) return;
    setNote(null);
    setForm({ date: day?.date || '', checkIn: day?.checkIn || shift.start, checkOut: day?.checkOut || shift.end, reason: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day]);
  const today = todayIst();
  const bad = !form.date || !form.checkIn || !form.checkOut || form.checkOut <= form.checkIn || !form.reason.trim();
  const approver = me.profile.manager || 'HR';

  return (
    <Drawer open={open} onClose={onClose} title="Fix a day" subtitle={`Forgot to check in or out? Tell us the real times. ${approver} will approve it.`}
      footer={<div className="flex gap-2"><button className={`${btnBig} flex-1`} disabled={busy || bad} onClick={() => run(async () => { await leaveService.regularize(form); onSent(); onClose(); }, `Sent to ${approver} for approval.`)}>{busy ? 'Sending…' : 'Send for approval'}</button><button className={btnGhost} onClick={onClose}>Cancel</button></div>}>
      <div className="space-y-4">
        <Field label="Which day?" hint="Any day since you joined">
          <input type="date" className={input} min={me.profile.joinDate || addDaysIso(today, -366)} max={today} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        {day && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
            Recorded now: {STATUS_LABEL[day.status] || 'nothing'} · in {day.checkIn || '—'} · out {day.checkOut || '—'}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Real check-in"><input type="time" className={input} value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></Field>
          <Field label="Real check-out"><input type="time" className={input} value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></Field>
        </div>
        {form.checkIn && form.checkOut && form.checkOut <= form.checkIn && <Notice tone="error">Check-out must be after check-in.</Notice>}
        <Field label="What happened?"><textarea rows={2} className={input} placeholder="e.g. Forgot to check out, left at 6:30 pm" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      </div>
    </Drawer>
  );
};

// ------------------------------------------------------------------ attendance screen

const PER = 5;
const statusTone: Record<string, string> = { PRESENT: 'green', LATE: 'amber', HALF_DAY: 'orange', INCOMPLETE: 'rose', ABSENT: 'rose', LEAVE: 'violet', HALF_LEAVE: 'violet', HOLIDAY: 'blue', WEEKLY_OFF: 'slate', TODAY: 'violet' };
const dayCircle: Record<string, string> = {
  PRESENT: 'bg-emerald-100 text-emerald-800', LATE: 'bg-amber-100 text-amber-800', HALF_DAY: 'bg-amber-100 text-amber-800', INCOMPLETE: 'bg-violet-100 text-violet-800',
  ABSENT: 'bg-rose-100 text-rose-700', LEAVE: 'bg-sky-100 text-sky-800', HALF_LEAVE: 'bg-sky-100 text-sky-800', HOLIDAY: 'bg-slate-200 text-slate-600', WEEKLY_OFF: 'text-slate-800',
};
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/^(\w+) /, '$1, ');
/** Time between check-in and check-out that was not worked (lunch, breaks). */
const breakOf = (d: any) => (d.checkIn && d.checkOut && d.workedMinutes > 0 ? Math.max(0, toMin(d.checkOut) - toMin(d.checkIn) - d.workedMinutes) : 0);
const shortMin = (m: number) => (m >= 60 ? hm(m) : `${m}m`);

export const AttendanceTab: React.FC<{ me: any; reload: () => void }> = ({ me }) => {
  const [fix, setFix] = useState<{ open: boolean; day: any | null }>({ open: false, day: null });
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('logs');
  const [mode, setMode] = useState<'hours' | 'days'>('hours');
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  const loadMonth = useCallback(() => { setError(null); leaveService.attendance(month).then(setData).catch((e) => setError(e.message)); }, [month]);
  useEffect(() => { loadMonth(); setPage(1); setSel(null); }, [loadMonth]);

  const isNow = month === thisMonth();
  const today = todayIst();
  const s = data?.summary;
  const all: any[] = data?.days || [];
  const inMonth = all.filter((d) => d.status !== 'NOT_EMPLOYED');
  const count = (...st: string[]) => inMonth.filter((d) => st.includes(d.status)).length;
  const workingDays = inMonth.filter((d) => !['HOLIDAY', 'WEEKLY_OFF'].includes(d.status)).length;
  const records = inMonth.filter((d) => d.date <= today && !['FUTURE', 'WEEKLY_OFF', 'HOLIDAY'].includes(d.status)).sort((a, b) => b.date.localeCompare(a.date));
  const workedDays = inMonth.filter((d) => d.workedMinutes > 0);
  const totalWorked = workedDays.reduce((n, d) => n + d.workedMinutes, 0);
  const avgWorked = workedDays.length ? Math.round(totalWorked / workedDays.length) : 0;
  const totalBreak = workedDays.reduce((n, d) => n + breakOf(d), 0);
  const breakDays = workedDays.filter((d) => breakOf(d) > 0).length;
  const avgBreak = breakDays ? Math.round(totalBreak / breakDays) : 0;
  const elapsed = inMonth.filter((d) => d.date <= today && !['WEEKLY_OFF', 'HOLIDAY'].includes(d.status)).length;
  const presentPct = elapsed ? Math.round(((s?.present || 0) / elapsed) * 100) : 0;
  const lead = all.length ? new Date(`${all[0].date}T00:00:00Z`).getUTCDay() : 0;
  const shift = me.settings.shift;
  const target = Math.max(1, toMin(shift.end) - toMin(shift.start));
  const rows = records.slice((Math.min(page, Math.max(1, Math.ceil(records.length / PER))) - 1) * PER).slice(0, PER);

  const exportCsv = () => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Date', 'Check-in', 'Check-out', 'Work hours', 'Break', 'Status'].join(',')].concat(
      records.map((d) => [d.date, d.checkIn, d.checkOut, hm(d.workedMinutes), breakOf(d) ? `${breakOf(d)}m` : '', STATUS_LABEL[d.status] || d.status].map(q).join(','))
    );
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `attendance-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // Chart: one bar per day with recorded hours (hours mode) or per week with days present (days mode).
  const bars = mode === 'hours'
    ? workedDays.map((d) => ({ key: d.date, label: `${Number(d.date.slice(8))} ${new Date(`${d.date}T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`, value: d.workedMinutes, text: hm(d.workedMinutes), title: dmy(d.date) }))
    : [1, 2, 3, 4, 5, 6].map((w) => {
        const wk = inMonth.filter((d) => Math.ceil((Number(d.date.slice(8)) + lead) / 7) === w && ['PRESENT', 'LATE', 'HALF_DAY'].includes(d.status));
        return { key: `w${w}`, label: `Week ${w}`, value: wk.length, text: `${wk.length} day${wk.length === 1 ? '' : 's'}`, title: `Week ${w}` };
      }).filter((b) => b.value > 0);
  const top = mode === 'hours' ? Math.max(Math.ceil((Math.max(0, ...bars.map((b) => b.value)) || target) / 120) * 120, Math.ceil((target * 1.25) / 120) * 120) : Math.max(5, ...bars.map((b) => b.value));
  const ticks = mode === 'hours' ? Array.from({ length: Math.floor(top / 120) + 1 }, (_, i) => i * 120) : Array.from({ length: top + 1 }, (_, i) => i);
  const maxTicks = ticks.length > 7 ? ticks.filter((_, i) => i % 2 === 0) : ticks;
  const shownBar = bars.find((b) => b.key === hover);

  const pickedDay = sel ? all.find((d) => d.date === sel) : null;

  return (
    <div className="space-y-5">
      <PageHead title="Attendance" subtitle="View and track your attendance, working hours and daily logs.">
        <MonthChip month={month} onShift={(n) => setMonth(shiftMonthStr(month, n))} disableNext={isNow} />
        <button type="button" disabled={records.length === 0} onClick={exportCsv} className={btnViolet}><Download className="h-4 w-4" />Download Report</button>
      </PageHead>
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Skeleton rows={4} />}

      {s && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi label="Present Days" value={s.present} sub={<span className="font-semibold text-emerald-600">↑ {presentPct}%</span>} tone="green" Icon={CalendarCheck} />
          <Kpi label="Working Hours" value={hm(totalWorked) || '0h'} sub={avgWorked ? `Avg. ${hm(avgWorked)} / day` : undefined} tone="violet" Icon={Clock} />
          <Kpi label="Break Time" value={totalBreak ? hm(totalBreak) : '0m'} sub={avgBreak ? `Avg. ${avgBreak}m / day` : undefined} tone="orange" Icon={Hourglass} />
          <Kpi label="Absent Days" value={s.absent} tone="rose" Icon={CalendarX} />
          <Kpi label="Late Check-ins" value={s.late} tone="blue" Icon={CalendarDays} />
        </div>
      )}
      {s?.lateDeductionDays > 0 && <Notice tone="warn">You were late {s.late} times this month. Your company's rule may cut {s.lateDeductionDays} day(s) of pay for that.</Notice>}

      {data && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Panel title="Attendance Overview" right={
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 text-sm font-semibold" role="group" aria-label="Chart units">
              {(['hours', 'days'] as const).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded-full px-4 py-1 cursor-pointer ${mode === m ? 'bg-violet-100 text-violet-700 ring-1 ring-violet-300' : 'text-slate-700'}`}>{m === 'hours' ? 'Hours' : 'Days'}</button>)}
            </div>}>
            {bars.length === 0 ? <p className="py-12 text-center text-sm text-slate-500">No hours recorded this month yet.</p> : (
              <div className="relative">
                <div className="flex h-56">
                  <div className="flex w-10 shrink-0 flex-col-reverse justify-between pb-6 text-xs text-slate-600" aria-hidden>{maxTicks.map((t) => <span key={t}>{mode === 'hours' ? `${t / 60}h` : t}</span>)}</div>
                  <div className="relative flex-1">
                    <div className="absolute inset-x-0 top-0 bottom-6">
                      {mode === 'hours' && <div className="absolute inset-x-0 border-t-2 border-dashed border-violet-400" style={{ bottom: `${(target / top) * 100}%` }} />}
                      <div className="absolute inset-0 flex items-end justify-around gap-1.5">
                        {bars.map((b) => (
                          <div key={b.key} className="relative flex h-full flex-1 items-end justify-center" onMouseEnter={() => setHover(b.key)} onMouseLeave={() => setHover(null)}>
                            <div className={`w-full max-w-[3rem] rounded-t-md transition-colors ${hover === b.key ? 'bg-violet-600' : 'bg-violet-200'}`} style={{ height: `${Math.max(2, (b.value / top) * 100)}%` }} role="img" aria-label={`${b.title}: ${b.text}`} />
                            {hover === b.key && <div className="absolute z-10 -translate-y-1 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-lg" style={{ bottom: `${Math.min(92, (b.value / top) * 100 + 4)}%` }}><div className="font-semibold text-slate-800">{b.title}</div><div className="flex items-center gap-1.5 font-bold text-slate-950"><span className="h-2 w-2 rounded-full bg-violet-600" />{b.text}</div></div>}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 flex justify-around gap-1.5 text-[11px] text-slate-600">{bars.map((b) => <span key={b.key} className="flex-1 truncate text-center">{b.label}</span>)}</div>
                  </div>
                </div>
                {mode === 'hours' && <div className="mt-2 flex items-center gap-2 text-sm text-slate-700"><span className="inline-block w-6 border-t-2 border-dashed border-violet-400" />Target: {Math.round(target / 6) / 10}h / day</div>}
                <span className="sr-only">{shownBar ? `${shownBar.title}: ${shownBar.text}` : ''}</span>
              </div>
            )}
          </Panel>

          <Panel title="Attendance Calendar" right={
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonthStr(month, -1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
              <span className="min-w-[5.5rem] text-center text-sm font-semibold text-slate-800">{monthTitle(month).replace(/^(\w{3})\w* /, '$1 ')}</span>
              <button type="button" aria-label="Next month" disabled={isNow} onClick={() => setMonth(shiftMonthStr(month, 1))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
            </div>}>
            <div className="flex flex-wrap gap-4">
              <div className="min-w-[16rem] flex-1">
                <div className="mb-1.5 grid grid-cols-7 gap-1">{WEEK.map((w) => <div key={w} className="text-center text-xs font-semibold text-slate-800">{w}</div>)}</div>
                <div className="grid grid-cols-7 gap-y-1.5">
                  {Array.from({ length: lead }).map((_, i) => <div key={`b${i}`} />)}
                  {all.map((d) => {
                    const na = d.status === 'NOT_EMPLOYED' || d.status === 'FUTURE';
                    const cls = na ? 'text-slate-400' : dayCircle[d.status] || 'text-slate-800';
                    return (
                      <button key={d.date} type="button" disabled={na} onClick={() => setSel(sel === d.date ? null : d.date)} title={`${dmy(d.date)}: ${STATUS_LABEL[d.status] || ''}`}
                        className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${cls} ${d.date === today || sel === d.date ? 'ring-2 ring-violet-500 ring-offset-1' : ''}`}>{Number(d.date.slice(8))}</button>
                    );
                  })}
                </div>
              </div>
              <ul className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm text-slate-800" aria-label="Legend">
                {[['bg-emerald-500', 'Present'], ['bg-rose-500', 'Absent'], ['bg-amber-400', 'Late'], ['border-2 border-violet-500 bg-white', 'Selected'], ['bg-slate-300', 'Holiday']].map(([c, l]) => <li key={l} className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${c}`} />{l}</li>)}
              </ul>
            </div>
            {pickedDay && (
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <b className="text-sm text-slate-900">{dmy(pickedDay.date)}</b>
                <Pill tone={statusTone[pickedDay.status] || 'slate'}>{STATUS_LABEL[pickedDay.status] || 'No record'}</Pill>
                <span>In <b>{t12(pickedDay.checkIn)}</b></span><span>Out <b>{t12(pickedDay.checkOut)}</b></span>
                {canFix(pickedDay) && <button type="button" className="ml-auto font-bold text-violet-700 hover:underline cursor-pointer" onClick={() => setFix({ open: true, day: pickedDay })}>Fix this day</button>}
              </div>
            )}
          </Panel>
        </div>
      )}

      {data && (
        <div>
          <Tabs tabs={[{ key: 'logs', label: 'Daily Logs' }, { key: 'summary', label: 'Summary' }]} value={tab} onChange={setTab} />
          <Panel className="mt-4">
            {tab === 'logs' ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <THead cols={['Date', 'Check In', 'Check Out', 'Working Hours', 'Break Time', 'Status', 'Remarks']} />
                    <tbody className="divide-y divide-slate-100">
                      {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No records for this month yet.</td></tr>}
                      {rows.map((d) => (
                        <tr key={d.date} className={d.date === today ? 'bg-violet-50/40' : ''}>
                          <td className="whitespace-nowrap px-3 py-3 font-medium text-slate-900">{longDay(d.date)}</td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-800">{t12(d.checkIn)}</td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-800">{t12(d.checkOut)}</td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-800">{hm(d.workedMinutes) || '--'}</td>
                          <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-800">{breakOf(d) ? `${breakOf(d)}m` : '--'}</td>
                          <td className="px-3 py-3"><Pill tone={statusTone[d.status] || 'slate'}>{STATUS_LABEL[d.status] || '—'}</Pill></td>
                          <td className="px-3 py-3 text-slate-700">{d.note ? d.note : canFix(d) ? <button type="button" className="text-xs font-semibold text-violet-700 hover:underline cursor-pointer" onClick={() => setFix({ open: true, day: d })}>Fix</button> : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={page} total={records.length} per={PER} noun="records" onPage={setPage} />
              </>
            ) : (
              <ul className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {[['Present', count('PRESENT')], ['Late', count('LATE')], ['On leave', count('LEAVE', 'HALF_LEAVE')], ['Absent', count('ABSENT')], ['Missed check-out', count('INCOMPLETE')], ['Holidays / weekly offs', count('HOLIDAY', 'WEEKLY_OFF')], ['Working days', workingDays], ['Avg. hours a day', avgWorked ? hm(avgWorked) : '–']].map(([l, v]) => (
                  <li key={String(l)} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"><span className="text-slate-700">{l}</span><b className="text-slate-950">{v}</b></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
      <FixDayDrawer me={me} day={fix.day} open={fix.open} onClose={() => setFix({ open: false, day: null })} onSent={() => { loadMonth(); }} />
    </div>
  );
};
