import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Download, Info, Pencil, RefreshCw } from 'lucide-react';
import { leaveService, downloadCsv } from '../../services/leaveService';
import { btnGhost, btnPrimary, Drawer, Field, hm, input, Notice, Skeleton, STATUS_LABEL, addDaysIso, todayIst, useRunner } from './ui';
import { FixDayDrawer } from './AttendanceTab';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
const monthOf = (iso: string) => iso.slice(0, 7);
const shiftMonth = (m: string, by: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1)).toISOString().slice(0, 7);

type Preset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'cycle' | 'custom';
const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' }, { value: 'thisMonth', label: 'This Month' }, { value: 'lastMonth', label: 'Last Month' },
  { value: 'cycle', label: 'Attendance Cycle' }, { value: 'custom', label: 'Custom Range' },
];
const MAX_RANGE_DAYS = 93;

/** The from/to dates for a preset. The attendance cycle runs from `startDay` of one month to the day before it next month. */
function rangeFor(preset: Preset, today: string, startDay: number, custom: { from: string; to: string }): { from: string; to: string } {
  const m = monthOf(today);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDaysIso(today, -1); return { from: y, to: y }; }
    case 'last7': return { from: addDaysIso(today, -6), to: today };
    case 'last30': return { from: addDaysIso(today, -29), to: today };
    case 'thisMonth': return { from: `${m}-01`, to: `${m}-${lastDay(m)}` };
    case 'lastMonth': { const p = shiftMonth(m, -1); return { from: `${p}-01`, to: `${p}-${lastDay(p)}` }; }
    case 'cycle': {
      const d = String(Math.min(28, Math.max(1, startDay))).padStart(2, '0');
      const begin = Number(today.slice(8)) >= startDay ? `${m}-${d}` : `${shiftMonth(m, -1)}-${d}`;
      const next = shiftMonth(monthOf(begin), 1);
      return { from: begin, to: addDaysIso(`${next}-${d}`, -1) };
    }
    default: return custom;
  }
}
const fmtLong = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8))}, ${iso.slice(0, 4)}`;
const monthsBetween = (from: string, to: string) => { const out: string[] = []; for (let m = monthOf(from); m <= monthOf(to); m = shiftMonth(m, 1)) out.push(m); return out; };

const rowDate = (iso: string) => `${iso.slice(8)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)} ${DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]}`;
const arDate = (iso: string) => `${iso.slice(8)}-${MON[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}`;
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

type Kind = 'FULL' | 'ABSENT' | 'PARTIAL' | 'LEAVE' | 'HOLIDAY' | 'WEEKOFF' | 'MISSED' | 'NONE';
const KIND: Record<Kind, { label: string; dot: string }> = {
  FULL: { label: 'Fullday', dot: 'bg-emerald-500' },
  ABSENT: { label: 'Absent', dot: 'bg-rose-400' },
  PARTIAL: { label: 'Partial', dot: 'bg-amber-400' },
  LEAVE: { label: 'Leave', dot: 'bg-sky-400' },
  HOLIDAY: { label: 'Holiday', dot: 'bg-violet-400' },
  WEEKOFF: { label: 'Weekoff', dot: 'bg-slate-800' },
  MISSED: { label: 'Missed check-out', dot: 'bg-yellow-400' },
  NONE: { label: '', dot: 'bg-transparent' },
};
const kindOf = (status: string): Kind => {
  switch (status) {
    case 'PRESENT': case 'LATE': return 'FULL';
    case 'HALF_DAY': case 'HALF_LEAVE': return 'PARTIAL';
    case 'ABSENT': return 'ABSENT';
    case 'INCOMPLETE': return 'MISSED';
    case 'LEAVE': return 'LEAVE';
    case 'HOLIDAY': return 'HOLIDAY';
    case 'WEEKLY_OFF': return 'WEEKOFF';
    default: return 'NONE';
  }
};
const LEGEND: Kind[] = ['FULL', 'ABSENT', 'PARTIAL', 'LEAVE', 'HOLIDAY', 'WEEKOFF', 'MISSED'];

/** HR puts in the real times for someone else; they take effect straight away. */
const HrFixDrawer: React.FC<{ open: boolean; onClose: () => void; uid: string; name: string; day: any | null; shift: { start: string; end: string }; onDone: () => void }> = ({ open, onClose, uid, name, day, shift, onDone }) => {
  const [f, setF] = useState({ checkIn: shift.start, checkOut: shift.end, note: '' });
  const { busy, note, setNote, run } = useRunner();
  useEffect(() => { if (open) { setNote(null); setF({ checkIn: day?.checkIn || shift.start, checkOut: day?.checkOut || shift.end, note: '' }); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, day]);
  const bad = !f.checkIn || !f.checkOut || f.checkOut <= f.checkIn || !f.note.trim();
  return (
    <Drawer open={open} onClose={onClose} title="Regularize attendance" subtitle={`${name} · ${day ? arDate(day.date) : ''}`}
      footer={<div className="flex gap-2"><button className={`${btnPrimary} flex-1`} disabled={busy || bad} onClick={() => run(async () => { await leaveService.markAttendance({ uid, date: day.date, checkIn: f.checkIn, checkOut: f.checkOut, note: f.note }); onDone(); onClose(); }, 'Saved')}>{busy ? 'Saving…' : 'Save'}</button><button className={btnGhost} onClick={onClose}>Cancel</button></div>}>
      <div className="space-y-4">
        <p className="text-xs text-slate-500">This replaces all punches for the day with one stretch.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="In"><input type="time" className={input} value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} /></Field>
          <Field label="Out"><input type="time" className={input} value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} /></Field>
        </div>
        <Field label="Reason"><textarea rows={2} className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      </div>
    </Drawer>
  );
};

const DayInfo: React.FC<{ day: any | null; open: boolean; onClose: () => void }> = ({ day, open, onClose }) => (
  <Drawer open={open} onClose={onClose} title={day ? rowDate(day.date) : ''} subtitle={day ? STATUS_LABEL[day.status] || '' : ''}>
    {day && (
      <div className="space-y-3 text-xs text-slate-700">
        <div>
          <div className="font-bold text-slate-500 uppercase text-[10px] mb-1">Punches</div>
          {(day.sessions || []).length === 0 ? <p className="text-slate-400">No punches.</p> : (
            <ul className="space-y-1">{day.sessions.map((x: any, i: number) => <li key={i}>In <b>{x.in}</b> · Out <b>{x.out || 'still working'}</b></li>)}</ul>
          )}
        </div>
        {day.workedMinutes > 0 && <div>Worked <b>{hm(day.workedMinutes)}</b>{(day.sessions || []).length > 1 ? ' (time between punches is not counted)' : ''}</div>}
        {day.late && <div className="text-amber-700">Checked in late.</div>}
        {(day.source && day.source !== 'SELF') || day.note ? (
          <div className="text-slate-500">{day.source === 'REGULARIZED' ? 'Regularized (approved correction)' : day.source === 'HR' ? 'Set by HR' : ''}{day.note ? ` · ${day.note}` : ''}</div>
        ) : null}
      </div>
    )}
  </Drawer>
);

export const RegularizationPage: React.FC<{ me: any; onChanged?: () => void }> = ({ me, onChanged }) => {
  const today = todayIst();
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState({ from: addDaysIso(today, -13), to: today });
  const [menu, setMenu] = useState(false);
  const { from, to } = rangeFor(preset, today, me.settings.cycleStartDay || 1, custom);
  const tooLong = from > to || (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000 + 1 > MAX_RANGE_DAYS;
  const [people, setPeople] = useState<{ uid: string; name: string; empId: string; department: string }[]>([]);
  const myUid: string = me.person?.uid || '';
  const [uid, setUid] = useState(myUid);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<any | null>(null);
  const [selfFix, setSelfFix] = useState<any | null>(null);
  const [hrFix, setHrFix] = useState<any | null>(null);
  const shift = me.settings.shift;

  useEffect(() => { leaveService.attendancePeople().then((r: any) => setPeople(r.items || [])).catch(() => setPeople([])); }, []);

  const load = useCallback(async () => {
    if (tooLong) { setData(null); setError(from > to ? 'The start date must be before the end date.' : `Choose a range of at most ${MAX_RANGE_DAYS} days.`); return; }
    setBusy(true);
    setError(null);
    try {
      const parts = await Promise.all(monthsBetween(from, to).map((m) => leaveService.attendance(m, uid === myUid ? undefined : uid)));
      const days = parts.flatMap((p: any) => p.days || []).filter((d: any) => d.date >= from && d.date <= to);
      setData({ person: parts[0]?.person, days });
    } catch (e: any) { setError(e?.message || 'Could not load attendance.'); }
    finally { setBusy(false); }
  }, [from, to, tooLong, uid, myUid]);
  useEffect(() => { void load(); }, [load]);

  const days: any[] = data?.days || [];
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { FULL: 0, ABSENT: 0, PARTIAL: 0, LEAVE: 0, HOLIDAY: 0, WEEKOFF: 0, MISSED: 0, NONE: 0 };
    days.forEach((d) => { c[kindOf(d.status)]++; });
    return c;
  }, [days]);

  const isMine = uid === myUid;
  const canEdit = (d: any) => d.date <= today && !['NOT_EMPLOYED', 'FUTURE'].includes(d.status) && (isMine || !!me.canManage);
  const range = from === to ? fmtLong(from) : `${fmtLong(from)} - ${fmtLong(to)}`;
  const shiftLabel = `${shift.start}–${shift.end}`;
  const personName = data?.person?.name || people.find((p) => p.uid === uid)?.name || me.person?.name || '';
  const personMeta = people.find((p) => p.uid === uid);

  const exportCsv = () => downloadCsv(`attendance-${personName.replace(/\s+/g, '_')}-${from}_${to}.csv`, [
    ['Date', 'Status', 'Shift', 'Punch in', 'Punch out', 'Total hrs', 'AR in', 'AR out', 'AR hrs'],
    ...days.map((d) => [d.date, STATUS_LABEL[d.status] || '', shiftLabel, d.checkIn || '', d.checkOut || '', d.workedMinutes ? clock(d.workedMinutes) : '',
      d.source === 'REGULARIZED' ? d.checkIn : '', d.source === 'REGULARIZED' ? d.checkOut : '', d.source === 'REGULARIZED' && d.workedMinutes ? clock(d.workedMinutes) : '']),
  ]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200"><h2 className="text-sm font-black tracking-wide text-slate-800 uppercase">Attendance regularization</h2></div>

      <div className="p-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <button type="button" aria-haspopup="listbox" aria-expanded={menu} onClick={() => setMenu(!menu)}
            className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 bg-white text-sm text-slate-700 min-w-[15rem] hover:border-slate-400">
            <CalendarDays className="w-4 h-4 text-slate-400" /><span className="flex-1 text-left">{range}</span><ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} aria-hidden />
              <ul role="listbox" className="absolute z-20 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 text-sm">
                {PRESETS.map((p) => (
                  <li key={p.value} role="option" aria-selected={preset === p.value}>
                    <button type="button" className={`w-full text-left px-4 py-2 ${preset === p.value ? 'bg-blue-500 text-white font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                      onClick={() => { setPreset(p.value); if (p.value !== 'custom') setMenu(false); }}>{p.label}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <input type="date" aria-label="From" className={`${input} !w-auto`} max={today} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            to
            <input type="date" aria-label="To" className={`${input} !w-auto`} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        {people.length > 1 ? (
          <select className={`${input} !w-auto min-w-[16rem]`} aria-label="Employee" value={uid} onChange={(e) => setUid(e.target.value)}>
            {people.map((p) => <option key={p.uid} value={p.uid}>{p.empId ? `${p.empId} - ` : ''}{p.name}{p.uid === myUid ? ' (me)' : ''}</option>)}
          </select>
        ) : <span className="text-sm font-semibold text-slate-700 border border-slate-300 rounded-lg px-3 py-2">{personMeta?.empId ? `${personMeta.empId} - ` : ''}{personName}</span>}
        <button className="p-2 rounded-lg hover:bg-slate-100" aria-label="Refresh" onClick={() => void load()} disabled={busy}><RefreshCw className={`w-4 h-4 text-slate-500 ${busy ? 'animate-spin' : ''}`} /></button>
        <button className="p-2 rounded-lg hover:bg-slate-100" aria-label="Download CSV" onClick={exportCsv} disabled={!days.length}><Download className="w-4 h-4 text-slate-500" /></button>
      </div>

      <div className="mx-4 mb-3 border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 text-xs font-black inline-flex items-center justify-center">{(personName || '?')[0]?.toUpperCase()}</span>
          <span className="text-sm font-bold text-slate-800">{personMeta?.empId ? `${personMeta.empId} - ` : ''}{personName}</span>
        </div>
        <div className="ml-auto grid grid-cols-4 gap-x-6 gap-y-1">
          {LEGEND.map((k) => <span key={k} className="inline-flex items-center gap-1.5 text-xs text-slate-700"><span className={`w-2.5 h-2.5 rounded-full ${KIND[k].dot}`} /><b className="tabular-nums">{counts[k]}</b><span className="text-[10px] text-slate-400">{KIND[k].label}</span></span>)}
        </div>
      </div>

      {error && <div className="px-4 pb-3"><Notice tone="error">{error}</Notice></div>}
      {!data && !error && <div className="px-4 pb-4"><Skeleton rows={6} /></div>}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[56rem]">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase text-slate-600 text-left">
              <tr>
                <th className="px-4 py-2.5">Date</th><th className="px-2 py-2.5" /><th className="px-2 py-2.5">Shift</th>
                <th className="px-2 py-2.5">Punch in</th><th className="px-2 py-2.5">Punch out</th><th className="px-2 py-2.5">Total hrs</th>
                <th className="px-2 py-2.5">AR in</th><th className="px-2 py-2.5">AR date</th><th className="px-2 py-2.5">AR out</th><th className="px-2 py-2.5">AR hrs</th><th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const k = kindOf(d.status);
                const reg = d.source === 'REGULARIZED';
                const short = (d.status === 'HALF_DAY' || d.status === 'HALF_LEAVE') && d.workedMinutes > 0;
                const multi = (d.sessions || []).length > 1;
                const na = d.status === 'NOT_EMPLOYED' || d.status === 'FUTURE';
                return (
                  <tr key={d.date} className={`border-t border-slate-100 align-top ${na ? 'text-slate-300' : ''} ${d.date === today ? 'bg-orange-50/40' : ''}`}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-700">{rowDate(d.date)}</div>
                      {short && <div className="mt-1 text-[11px] text-amber-600 font-medium">Less hours worked</div>}
                      {d.status === 'INCOMPLETE' && <div className="mt-1 text-[11px] text-rose-600 font-medium">Missed check-out</div>}
                      {d.late && d.status === 'LATE' && <div className="mt-1 text-[11px] text-amber-600 font-medium">Late</div>}
                    </td>
                    <td className="px-2 py-3">{k !== 'NONE' && <span title={KIND[k].label} className={`inline-block w-3 h-3 rounded-full ${KIND[k].dot}`} />}</td>
                    <td className="px-2 py-3 whitespace-nowrap text-[11px]"><span className="font-bold text-slate-700">SHIFT :</span> <span className="text-slate-600">General {shiftLabel}</span></td>
                    <td className="px-2 py-3 tabular-nums text-sm">{d.checkIn || ''}</td>
                    <td className="px-2 py-3 tabular-nums text-sm">{d.checkOut || ''}{multi && <span className="ml-1 text-[10px] text-slate-400" title="More than one in/out in the day">+{d.sessions.length - 1}</span>}</td>
                    <td className="px-2 py-3 tabular-nums text-sm">{d.workedMinutes ? clock(d.workedMinutes) : ''}</td>
                    <td className="px-2 py-3 tabular-nums">{reg ? d.checkIn : ''}</td>
                    <td className="px-2 py-3 whitespace-nowrap">{reg ? arDate(d.date) : ''}</td>
                    <td className="px-2 py-3 tabular-nums">{reg ? d.checkOut : ''}</td>
                    <td className="px-2 py-3 tabular-nums">{reg && d.workedMinutes ? clock(d.workedMinutes) : ''}</td>
                    <td className="px-2 py-3 whitespace-nowrap text-right">
                      {!na && <button className="p-1 text-sky-600 hover:bg-sky-50 rounded" aria-label={`Details for ${arDate(d.date)}`} onClick={() => setInfo(d)}><Info className="w-4 h-4" /></button>}
                      {canEdit(d) && <button className="p-1 text-slate-500 hover:bg-slate-100 rounded" aria-label={`Regularize ${arDate(d.date)}`} onClick={() => (isMine ? setSelfFix(d) : setHrFix(d))}><Pencil className="w-4 h-4" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        {LEGEND.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${KIND[k].dot}`} />{KIND[k].label}</span>)}
      </div>

      <DayInfo day={info} open={!!info} onClose={() => setInfo(null)} />
      <FixDayDrawer me={me} day={selfFix} open={!!selfFix} onClose={() => setSelfFix(null)} onSent={() => { void load(); onChanged?.(); }} />
      <HrFixDrawer open={!!hrFix} onClose={() => setHrFix(null)} uid={uid} name={personName} day={hrFix} shift={shift} onDone={() => { void load(); onChanged?.(); }} />
    </div>
  );
};
