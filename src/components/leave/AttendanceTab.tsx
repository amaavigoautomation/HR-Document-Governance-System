import React, { useCallback, useEffect, useState } from 'react';
import { leaveService } from '../../services/leaveService';
import { Card, Field, Notice, STATUS_LABEL, StatusPill, btnGhost, btnPrimary, dayName, input, niceDate, thisMonth, todayIst, useRunner } from './ui';

export const MonthView: React.FC<{ uid?: string; onPickDay?: (d: any) => void }> = ({ uid, onPickDay }) => {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    leaveService.attendance(month, uid).then(setData).catch((e) => setError(e.message));
  }, [month, uid]);
  useEffect(load, [load]);

  const s = data?.summary;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" className={`${input} max-w-[11rem]`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        {data?.person?.name && uid && <span className="text-sm font-bold text-slate-700">{data.person.name}</span>}
        <button className={btnGhost} onClick={load}>Refresh</button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {s && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          {[['Present', s.present], ['Late', s.late], ['Leave', s.leave], ['Absent', s.absent], ['Half days', s.halfDay], ['Loss of pay', s.lossOfPayDays]].map(([k, v]) => (
            <div key={k as string} className="bg-slate-50 rounded-lg py-2"><div className="text-lg font-black text-slate-900">{v}</div><div className="text-[10px] text-slate-500">{k}</div></div>
          ))}
        </div>
      )}
      {s?.lateDeductionDays > 0 && <Notice>{s.late} late marks this month: a deduction of {s.lateDeductionDays} day(s) is suggested by your company's late rule.</Notice>}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2">Date</th><th className="p-2">Status</th><th className="p-2">In</th><th className="p-2">Out</th><th className="p-2 hidden sm:table-cell">Hours</th><th className="p-2 hidden sm:table-cell">Note</th></tr></thead>
          <tbody>
            {data?.days.filter((d: any) => d.status !== 'NOT_EMPLOYED').map((d: any) => (
              <tr key={d.date} className={`border-t border-slate-100 ${onPickDay ? 'cursor-pointer hover:bg-slate-50' : ''}`} onClick={() => onPickDay?.(d)}>
                <td className="p-2 whitespace-nowrap">{dayName(d.date)} {d.date.slice(8)}</td>
                <td className="p-2">{STATUS_LABEL[d.status] === '' ? <span className="text-slate-300">—</span> : <StatusPill status={d.status} />}</td>
                <td className="p-2">{d.checkIn || '—'}</td><td className="p-2">{d.checkOut || '—'}</td>
                <td className="p-2 hidden sm:table-cell">{d.workedMinutes ? `${Math.floor(d.workedMinutes / 60)}h ${d.workedMinutes % 60}m` : ''}</td>
                <td className="p-2 hidden sm:table-cell text-slate-400">{d.source && d.source !== 'SELF' ? d.source.toLowerCase() : ''}{d.note ? ` · ${d.note}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const AttendanceTab: React.FC<{ me: any; reload: () => void }> = ({ me, reload }) => {
  const { busy, note, run } = useRunner();
  const [regs, setRegs] = useState<any[]>([]);
  const [form, setForm] = useState({ date: '', checkIn: me.settings.shift.start, checkOut: me.settings.shift.end, reason: '' });
  const [tick, setTick] = useState(0);
  const att = me.attendanceToday;

  const loadRegs = useCallback(() => leaveService.myRegularizations().then((r) => setRegs(r.items)).catch(() => undefined), []);
  useEffect(() => { loadRegs(); }, [loadRegs]);

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card title="Today">
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-sm text-slate-600">
              {niceDate(me.today)} · Shift {me.settings.shift.start}–{me.settings.shift.end}
              <div className="mt-1 text-xs">In: <b>{att.checkIn || '—'}</b> · Out: <b>{att.checkOut || '—'}</b></div>
            </div>
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={busy || !!att.checkIn} onClick={() => run(async () => { await leaveService.checkIn(); await reload(); setTick(tick + 1); }, 'Checked in.')}>Check in</button>
              <button className={btnGhost} disabled={busy || !att.checkIn} onClick={() => run(async () => { await leaveService.checkOut(); await reload(); setTick(tick + 1); }, 'Checked out.')}>Check out</button>
            </div>
          </div>
          {note && <div className="mt-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
        </Card>
        <MonthView key={tick} />
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
