import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { leaveService, downloadCsv } from '../../services/leaveService';
import { btnGhost, btnPrimary, Field, input, Notice, Skeleton, todayIst, addDaysIso } from './ui';
import { MAX_RANGE_DAYS, MONTH_NAMES, RangePicker, fmtLong, lastDay, rangeFor, type Preset } from './RangePicker';
import { REPORTS, buildReport, pendingTable, printHtml, type ReportData, type ReportDef, type ReportTable } from './attendanceReports';

const GROUPS: ReportDef['group'][] = ['Daily reports', 'Summary reports', 'Monitoring reports'];

const Hub: React.FC<{ onPick: (r: ReportDef) => void }> = ({ onPick }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 grid md:grid-cols-3 gap-x-8 gap-y-6">
    {GROUPS.map((g) => (
      <section key={g} aria-label={g}>
        <h3 className="text-sm font-black uppercase tracking-wide text-slate-800 pb-1.5 border-b border-slate-300">{g}</h3>
        <ul>
          {REPORTS.filter((r) => r.group === g).map((r) => (
            <li key={r.id} className="border-b border-slate-100">
              <button type="button" onClick={() => onPick(r)} className="w-full text-left py-2.5 hover:text-[#FA7014]">
                <div className="text-sm font-semibold text-slate-800">{r.title}</div>
                <div className="text-[11px] text-slate-400">{r.hint}</div>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </div>
);

const Criteria: React.FC<{ def: ReportDef; me: any; onBack: () => void }> = ({ def, me, onBack }) => {
  const today = todayIst();
  const myUid: string = me.person?.uid || '';
  const [people, setPeople] = useState<{ uid: string; name: string; empId: string }[]>([]);
  const [uid, setUid] = useState(myUid);
  const [period, setPeriod] = useState<'date' | 'month'>(def.periods[0] || 'date');
  const [preset, setPreset] = useState<Preset>(def.id === 'in-out-activity' ? 'today' : 'thisMonth');
  const [custom, setCustom] = useState({ from: addDaysIso(today, -13), to: today });
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [times, setTimes] = useState({ fromTime: '00:00', tillTime: '23:59' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ table: ReportTable; subtitle: string } | null>(null);

  useEffect(() => { leaveService.attendancePeople().then((r: any) => setPeople(r.items || [])).catch(() => setPeople([])); }, []);

  const range = period === 'month'
    ? { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-${lastDay(`${year}-${String(month).padStart(2, '0')}`)}` }
    : rangeFor(preset, today, me.settings.cycleStartDay || 1, custom);
  const personLabel = uid === 'ALL' ? 'All employees' : people.find((p) => p.uid === uid)?.name || me.person?.name || '';

  const generate = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      if (def.own) {
        const r: any = await leaveService.pendingApplications();
        const items = uid === 'ALL' ? r.items : r.items.filter((x: any) => x.uid === uid);
        setResult({ table: pendingTable(items), subtitle: `${personLabel} · as on ${fmtLong(today)}` });
      } else {
        const days = (new Date(`${range.to}T00:00:00Z`).getTime() - new Date(`${range.from}T00:00:00Z`).getTime()) / 86400000 + 1;
        if (range.from > range.to) throw new Error('The start date must be before the end date.');
        if (days > MAX_RANGE_DAYS) throw new Error(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);
        const data: ReportData = await leaveService.attendanceReport({ from: range.from, to: range.to, uid: uid === 'ALL' ? undefined : uid });
        const table = buildReport(def.id, data, times);
        setResult({ table, subtitle: `${personLabel} · ${fmtLong(range.from)} - ${fmtLong(range.to)}${def.timeFilter ? ` · ${times.fromTime}–${times.tillTime}` : ''}` });
      }
    } catch (e: any) { setError(e?.message || 'Could not build the report.'); }
    finally { setBusy(false); }
  };

  const years = [Number(today.slice(0, 4)), Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4)) - 2];
  const csv = () => result && downloadCsv(`${def.id}-${range.from}_${range.to}.csv`, [result.table.headers, ...result.table.rows]);
  const print = () => {
    if (!result) return;
    const w = window.open('', '_blank');
    if (!w) { setError('Allow pop-ups to print, or use Download CSV.'); return; }
    w.document.write(printHtml(def.title, result.subtitle, result.table));
    w.document.close();
    w.focus();
    w.print();
  };
  const multi = useMemo(() => people.length > 1, [people]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3">
          <button type="button" className="p-1.5 rounded hover:bg-slate-100" aria-label="Back to all reports" onClick={onBack}><ArrowLeft className="w-4 h-4" /></button>
          <h2 className="text-sm font-black tracking-wide text-slate-800 uppercase">{def.title}</h2>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Particular employee">
              {multi ? (
                <select className={`${input} min-w-[16rem]`} value={uid} onChange={(e) => setUid(e.target.value)}>
                  <option value="ALL">All employees</option>
                  {people.map((p) => <option key={p.uid} value={p.uid}>{p.empId ? `${p.empId} - ` : ''}{p.name}{p.uid === myUid ? ' (me)' : ''}</option>)}
                </select>
              ) : <input className={`${input} bg-slate-50 min-w-[16rem]`} readOnly value={me.person?.name || ''} />}
            </Field>
            {def.periods.length > 1 && (
              <Field label="Report period">
                <select className={input} value={period} onChange={(e) => setPeriod(e.target.value as 'date' | 'month')}>
                  {def.periods.map((p) => <option key={p} value={p}>{p === 'date' ? 'Date Wise' : 'Month Wise'}</option>)}
                </select>
              </Field>
            )}
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void generate()}>{busy ? 'Generating…' : 'Generate'}</button>
          </div>

          {!def.own && (
            <div className="border-t border-slate-100 pt-3 space-y-3">
              <div className="text-[11px] font-bold uppercase text-slate-500">Report criteria</div>
              {period === 'month' ? (
                <div className="flex gap-3">
                  <Field label="Month"><select className={input} value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select></Field>
                  <Field label="Year"><select className={input} value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
                </div>
              ) : (
                <Field label="Date range">
                  <div className="flex flex-wrap items-center gap-2"><RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} from={range.from} to={range.to} today={today} /></div>
                </Field>
              )}
              {def.timeFilter && (
                <div className="flex gap-3">
                  <Field label="From time"><input type="time" className={input} value={times.fromTime} onChange={(e) => setTimes({ ...times, fromTime: e.target.value })} /></Field>
                  <Field label="Till time"><input type="time" className={input} value={times.tillTime} onChange={(e) => setTimes({ ...times, tillTime: e.target.value })} /></Field>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {busy && <Skeleton rows={4} />}
      {result && (
        <div className="bg-white border border-slate-200 rounded-xl">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <div className="text-sm font-bold text-slate-800">{def.title}</div>
              <div className="text-[11px] text-slate-500">{result.subtitle} · {result.table.rows.length} {result.table.rows.length === 1 ? 'row' : 'rows'}</div>
            </div>
            <button type="button" className={btnGhost} onClick={csv} disabled={result.table.rows.length === 0}><Download className="w-3.5 h-3.5" />Download CSV</button>
            <button type="button" className={btnGhost} onClick={print} disabled={result.table.rows.length === 0}><Printer className="w-3.5 h-3.5" />Print / PDF</button>
          </div>
          {result.table.rows.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-400">No data available for these criteria.</p>
          ) : (
            <div className="overflow-x-auto max-h-[32rem]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 text-left sticky top-0"><tr>{result.table.headers.map((h) => <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{result.table.rows.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="px-3 py-2 whitespace-nowrap tabular-nums">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {result.table.note && <p className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">{result.table.note}</p>}
        </div>
      )}
    </div>
  );
};

export const AttendanceReportsPage: React.FC<{ me: any }> = ({ me }) => {
  const [open, setOpen] = useState<ReportDef | null>(null);
  return open ? <Criteria key={open.id} def={open} me={me} onBack={() => setOpen(null)} /> : <Hub onPick={setOpen} />;
};
