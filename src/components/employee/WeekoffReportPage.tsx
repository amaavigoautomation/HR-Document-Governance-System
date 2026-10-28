import React, { useEffect, useMemo, useState } from 'react';
import { Download, Printer, RotateCcw } from 'lucide-react';
import { leaveService, downloadCsv } from '../../services/leaveService';
import { btnGhost, btnPrimary, Field, input, Notice, Skeleton, todayIst, addDaysIso } from '../leave/ui';
import { MAX_RANGE_DAYS, RangePicker, fmtLong, rangeFor, type Preset } from '../leave/RangePicker';
import { printHtml, longDate, type ReportData } from '../leave/attendanceReports';
import { defaultOptions, groupRows, weekoffRows, weekoffTable, type GroupBy, type WeekoffOptions, type WeekoffRow } from './weekoffReport';

const TYPE_LOOK: Record<WeekoffRow['type'], string> = {
  'Weekly off': 'bg-blue-50 text-blue-700 border-blue-200', Holiday: 'bg-violet-50 text-violet-700 border-violet-200', 'Restricted holiday': 'bg-stone-100 text-stone-700 border-stone-200',
};
const GROUPS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'No grouping' }, { value: 'department', label: 'Department' }, { value: 'employee', label: 'Employee' }, { value: 'month', label: 'Month' },
];

/** Weekoff Holiday Report: who has which weekly offs and holidays in a period. Choose what to include, group it, then view, print or download. */
export const WeekoffReportPage: React.FC = () => {
  const today = todayIst();
  const [people, setPeople] = useState<{ uid: string; name: string; empId: string; department: string }[]>([]);
  const [cycleStart, setCycleStart] = useState(1);
  const [uid, setUid] = useState('ALL');
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState({ from: addDaysIso(today, -13), to: today });
  const [opt, setOpt] = useState<WeekoffOptions>(defaultOptions);
  const [showName, setShowName] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ report: ReportData; company: string; range: { from: string; to: string } } | null>(null);

  useEffect(() => {
    leaveService.attendancePeople().then((r: any) => setPeople(r.items || [])).catch(() => setPeople([]));
    leaveService.me().then((m: any) => setCycleStart(m?.settings?.cycleStartDay || 1)).catch(() => undefined);
  }, []);

  const range = rangeFor(preset, today, cycleStart, custom);
  const departments = useMemo(() => Array.from(new Set(people.map((p) => p.department).filter(Boolean))).sort(), [people]);
  const set = <K extends keyof WeekoffOptions>(k: K, v: WeekoffOptions[K]) => setOpt((o) => ({ ...o, [k]: v }));

  const generate = async () => {
    setError(null); setData(null);
    if (range.from > range.to) { setError('The start date must be before the end date.'); return; }
    if ((Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1 > MAX_RANGE_DAYS) { setError(`Choose a range of at most ${MAX_RANGE_DAYS} days.`); return; }
    if (!opt.includeWeekoff && !opt.includeHoliday && !opt.includeRestricted) { setError('Include at least one of week-off, holiday or restricted holiday.'); return; }
    setBusy(true);
    try {
      const report: ReportData & { company?: string } = await leaveService.attendanceReport({ from: range.from, to: range.to, uid: uid === 'ALL' ? undefined : uid });
      setData({ report, company: report.company || '', range });
    } catch (e: any) { setError(e?.message || 'Could not build the report.'); }
    finally { setBusy(false); }
  };
  const reset = () => { setUid('ALL'); setPreset('thisMonth'); setOpt(defaultOptions); setShowName(true); setData(null); setError(null); };

  const rows = useMemo(() => (data ? weekoffRows(data.report, opt) : []), [data, opt]);
  const groups = useMemo(() => groupRows(rows, opt.groupBy), [rows, opt.groupBy]);
  const subtitle = data ? `${fmtLong(data.range.from)} - ${fmtLong(data.range.to)} · ${uid === 'ALL' ? 'All employees' : people.find((p) => p.uid === uid)?.name || ''}` : '';
  const csv = () => { const t = weekoffTable(rows, opt.groupBy); downloadCsv(`weekoff-holiday-${data!.range.from}_${data!.range.to}.csv`, [t.headers, ...t.rows]); };
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) { setError('Allow pop-ups to print, or use Download CSV.'); return; }
    w.document.write(printHtml('Weekoff Holiday Report', subtitle, weekoffTable(rows, opt.groupBy), showName ? data!.company : ''));
    w.document.close(); w.focus(); w.print();
  };
  const check = (k: 'includeWeekoff' | 'includeHoliday' | 'includeRestricted', label: string) => (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 border border-slate-200 rounded-full px-3 py-1.5 bg-white cursor-pointer">
      <input type="checkbox" checked={opt[k]} onChange={(e) => set(k, e.target.checked)} />{label}
    </label>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Employee">
            <select className={input} value={uid} onChange={(e) => setUid(e.target.value)}>
              {people.length !== 1 && <option value="ALL">All employees</option>}
              {people.map((p) => <option key={p.uid} value={p.uid}>{p.empId ? `${p.empId} - ` : ''}{p.name}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select className={input} value={opt.department} onChange={(e) => set('department', e.target.value)} disabled={departments.length === 0}>
              <option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Group by">
            <select className={input} value={opt.groupBy} onChange={(e) => set('groupBy', e.target.value as GroupBy)}>{GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select>
          </Field>
        </div>
        <Field label="Period"><div className="flex flex-wrap items-center gap-2"><RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} from={range.from} to={range.to} today={today} /></div></Field>
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1.5">Include</div>
          <div className="flex flex-wrap gap-2">{check('includeWeekoff', 'Week-offs')}{check('includeHoliday', 'Holidays')}{check('includeRestricted', 'Restricted holidays')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />Show company name on the printed report</label>
          <span className="ml-auto flex gap-2">
            <button type="button" className={btnGhost} onClick={reset}><RotateCcw className="w-3.5 h-3.5" />Reset</button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => void generate()}>{busy ? 'Generating…' : 'Generate'}</button>
          </span>
        </div>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {busy && <Skeleton rows={4} />}
      {data && !busy && (
        <section className="bg-white border border-slate-200 rounded-xl">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <div className="text-sm font-bold text-slate-800">Weekoff Holiday Report</div>
              <div className="text-[11px] text-slate-500">{subtitle} · {rows.length} {rows.length === 1 ? 'day' : 'days'}</div>
            </div>
            <button type="button" className={btnGhost} onClick={csv} disabled={rows.length === 0}><Download className="w-3.5 h-3.5" />Download CSV</button>
            <button type="button" className={btnGhost} onClick={print} disabled={rows.length === 0}><Printer className="w-3.5 h-3.5" />Print / PDF</button>
          </div>
          {rows.length === 0 ? <p className="p-8 text-center text-xs text-slate-400">No week-offs or holidays match these criteria.</p> : (
            <div className="divide-y divide-slate-100">
              {groups.map((g) => (
                <div key={g.key}>
                  {opt.groupBy !== 'none' && (
                    <div className="px-4 py-2 bg-slate-50 flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-black text-slate-800">{g.title}</span>
                      <span className="text-slate-500">{g.weekoffs} week-off · {g.holidays} holiday{g.restricted ? ` · ${g.restricted} restricted` : ''}</span>
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-slate-500 text-left"><tr>
                        {opt.groupBy !== 'employee' && <th className="px-4 py-2 font-bold">Employee</th>}<th className="px-4 py-2 font-bold">Date</th><th className="px-4 py-2 font-bold">Day</th><th className="px-4 py-2 font-bold">Type</th><th className="px-4 py-2 font-bold">Holiday</th>
                      </tr></thead>
                      <tbody>{g.rows.map((r, i) => (
                        <tr key={`${r.uid}-${r.date}-${i}`} className="border-t border-slate-100">
                          {opt.groupBy !== 'employee' && <td className="px-4 py-2 whitespace-nowrap">{r.empId ? `${r.empId} - ` : ''}{r.name}</td>}
                          <td className="px-4 py-2 whitespace-nowrap tabular-nums">{longDate(r.date)}</td><td className="px-4 py-2">{r.day}</td>
                          <td className="px-4 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${TYPE_LOOK[r.type]}`}>{r.type}</span></td>
                          <td className="px-4 py-2 text-slate-600">{r.holiday}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
