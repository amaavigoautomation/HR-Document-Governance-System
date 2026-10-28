import React, { useEffect, useState } from 'react';
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { btnGhost, btnPrimary, Card, Field, input, Notice, shortDate, Skeleton, StatusPill, todayIst, addDaysIso, useRunner } from './ui';

interface Row { date: string; inOn: boolean; inTime: string; outOn: boolean; outDate: string; outTime: string; reason: string }
const blankRow = (date: string): Row => ({ date, inOn: false, inTime: '', outOn: false, outDate: date, outTime: '', reason: '' });

/**
 * Ask for attendance to be corrected for one or more days: forgot to punch, wrong time, work from home or a visit.
 * Tick "Update time in" and/or "Update time out" per day; whatever is not ticked stays as recorded.
 */
export const AttendanceApplicationPage: React.FC<{ me: any; onChanged?: () => void }> = ({ me, onChanged }) => {
  const today = todayIst();
  const myUid: string = me.person?.uid || '';
  const [people, setPeople] = useState<{ uid: string; name: string; empId: string }[]>([]);
  const [uid, setUid] = useState(myUid);
  const [remarks, setRemarks] = useState('');
  const [rows, setRows] = useState<Row[]>([blankRow(today)]);
  const [recent, setRecent] = useState<any[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { busy, note, setNote, run } = useRunner();

  useEffect(() => { leaveService.attendancePeople().then((r: any) => setPeople(r.items || [])).catch(() => setPeople([])); }, []);
  const loadRecent = () => leaveService.myRegularizations().then((r: any) => setRecent(r.items)).catch(() => setRecent([]));
  useEffect(() => { void loadRecent(); }, []);

  const mine = uid === myUid;
  const floor: string = (mine ? me.profile.joinDate : '') || addDaysIso(today, -366);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const reset = () => { setRows([blankRow(today)]); setRemarks(''); setNote(null); };

  const problem = rows.map((r) => {
    if (!r.date) return 'Choose a date.';
    if (!r.inOn && !r.outOn) return 'Tick time in, time out, or both.';
    if ((r.inOn && !r.inTime) || (r.outOn && !r.outTime)) return 'Enter the time.';
    if (r.inOn && r.outOn && r.outDate === r.date && r.outTime <= r.inTime) return 'The time out must be after the time in.';
    if (!r.reason.trim()) return 'Give a reason.';
    return '';
  });
  const invalid = problem.some(Boolean) || new Set(rows.map((r) => r.date)).size !== rows.length;

  const save = () => run(async () => {
    const res: any = await leaveService.applyAttendance({
      uid: mine ? undefined : uid, remarks,
      rows: rows.map((r) => ({ date: r.date, checkIn: r.inOn ? r.inTime : '', checkOut: r.outOn ? r.outTime : '', outDate: r.outOn ? r.outDate : '', reason: r.reason })),
    });
    setSaved(res.docNo);
    reset();
    await loadRecent();
    onChanged?.();
  });

  const cell = 'px-2 py-2 border-t border-slate-100 align-top';
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={busy || invalid} onClick={() => void save()}><Save className="w-3.5 h-3.5" />{busy ? 'Saving…' : 'Save'}</button>
          <button className={btnGhost} disabled={busy} onClick={reset}><RotateCcw className="w-3.5 h-3.5" />Cancel</button>
        </div>
        {saved && <Notice tone="ok">Saved as {saved}.</Notice>}
        {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Doc #"><input className={`${input} bg-slate-50`} readOnly value="Given when you save" /></Field>
          <Field label="Date applied"><input className={`${input} bg-slate-50`} readOnly value={today} /></Field>
          <Field label="Employee" hint={people.length > 1 ? 'You can apply for yourself or your team. HR can apply for anyone.' : undefined}>
            {people.length > 1 ? (
              <select className={input} value={uid} onChange={(e) => { setUid(e.target.value); setRows([blankRow(today)]); }}>
                {people.map((p) => <option key={p.uid} value={p.uid}>{p.empId ? `${p.empId} - ` : ''}{p.name}{p.uid === myUid ? ' (me)' : ''}</option>)}
              </select>
            ) : <input className={`${input} bg-slate-50`} readOnly value={me.person?.name || ''} />}
          </Field>
          <Field label="Remarks"><textarea rows={2} className={input} maxLength={400} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <div className="bg-[#1b2252] text-white text-xs font-bold px-3 py-1.5">Attendance application</div>
          <table className="w-full text-xs min-w-[56rem]">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-2 py-2 w-8">#</th><th className="px-2 py-2">Date</th>
                <th className="px-2 py-2" colSpan={2}>Update time in</th><th className="px-2 py-2" colSpan={3}>Update time out</th><th className="px-2 py-2">Reason</th><th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className={cell}>{i + 1}</td>
                  <td className={cell}><input type="date" aria-label="Date" className={`${input} !w-auto`} min={floor} max={today} value={r.date} onChange={(e) => set(i, { date: e.target.value, outDate: e.target.value })} /></td>
                  <td className={cell}><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={r.inOn} onChange={(e) => set(i, { inOn: e.target.checked })} />Update</label></td>
                  <td className={cell}><input type="time" aria-label="Time in" className={`${input} !w-auto`} disabled={!r.inOn} value={r.inTime} onChange={(e) => set(i, { inTime: e.target.value })} /></td>
                  <td className={cell}><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={r.outOn} onChange={(e) => set(i, { outOn: e.target.checked })} />Update</label></td>
                  <td className={cell}><input type="date" aria-label="Time out date" className={`${input} !w-auto`} disabled={!r.outOn} min={r.date} max={r.date ? addDaysIso(r.date, 1) : undefined} value={r.outDate} onChange={(e) => set(i, { outDate: e.target.value })} /></td>
                  <td className={cell}><input type="time" aria-label="Time out" className={`${input} !w-auto`} disabled={!r.outOn} value={r.outTime} onChange={(e) => set(i, { outTime: e.target.value })} /></td>
                  <td className={cell}>
                    <input className={input} aria-label="Reason" maxLength={400} value={r.reason} onChange={(e) => set(i, { reason: e.target.value })} />
                    {problem[i] && r.reason !== '' || (problem[i] && (r.inOn || r.outOn)) ? <div className="mt-1 text-[11px] text-rose-600">{problem[i]}</div> : null}
                  </td>
                  <td className={cell}>{rows.length > 1 && <button type="button" className="p-1 text-slate-400 hover:text-rose-600" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-slate-100 flex items-center gap-3">
            <button type="button" className={btnGhost} disabled={rows.length >= 31} onClick={() => setRows([...rows, blankRow(rows[rows.length - 1]?.date && rows[rows.length - 1].date < today ? addDaysIso(rows[rows.length - 1].date, 1) : today)])}><Plus className="w-3.5 h-3.5" />Add day</button>
            <span className="text-[11px] text-slate-400">Anything you do not tick stays as recorded. Dates go back to the joining date.</span>
          </div>
        </div>
        {!mine && <p className="text-[11px] text-slate-500">{me.canManage ? 'As HR, this is applied straight away.' : 'This goes to HR for approval.'}</p>}
      </div>

      <Card title="My applications" subtitle="Your own requests and what happened to them">
        {!recent ? <Skeleton rows={2} /> : recent.length === 0 ? <p className="text-xs text-slate-400">Nothing applied yet.</p> : (
          <div className="divide-y divide-slate-100">
            {recent.slice(0, 15).map((r) => (
              <div key={r.id} className="py-2 flex justify-between items-center gap-2 text-xs">
                <div>
                  <div className="font-semibold text-slate-700">{shortDate(r.date)} <span className="font-normal text-slate-400">{r.docNo || ''}</span></div>
                  <div className="text-slate-500">In {r.checkIn || 'unchanged'} · Out {r.checkOut || 'unchanged'}{r.reason ? ` · ${r.reason}` : ''}</div>
                </div>
                <StatusPill status={r.status} short />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
