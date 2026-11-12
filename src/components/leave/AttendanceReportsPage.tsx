import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarX, Check, Clock, Download, FileText, Printer, BarChart3, CalendarCheck } from 'lucide-react';
import { Avatar } from '../home/parts';
import { leaveService, downloadCsv } from '../../services/leaveService';
import { Notice, Skeleton, todayIst, addDaysIso, input } from './ui';
import { btnViolet, dmy, Kpi, Pager, Panel, Pill, Select, THead } from './kit';
import { MAX_RANGE_DAYS, MONTH_NAMES, RangePicker, fmtLong, lastDay, rangeFor, type Preset } from './RangePicker';
import { REPORTS, buildReport, clock, pendingTable, printHtml, type ReportData, type ReportDef, type ReportTable } from './attendanceReports';

const PER = 5;
const AVG_TONES = ['green', 'amber', 'rose'];
const pctTone = (p: number) => (p >= 95 ? 'green' : p >= 80 ? 'amber' : 'rose');
const hoursText = (m: number) => (m > 0 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : '0h 00m');

/** Totals for one person over the days the server returned. */
const totalsOf = (p: ReportData['people'][number]) => {
  const c = (f: (d: any) => boolean) => p.days.filter(f).length;
  const present = c((d) => d.status === 'PRESENT' || d.status === 'LATE');
  const absent = c((d) => d.status === 'ABSENT');
  const late = c((d) => d.late);
  const worked = p.days.reduce((n, d) => n + (d.workedMinutes || 0), 0);
  const counted = c((d) => ['PRESENT', 'LATE', 'HALF_DAY', 'HALF_LEAVE', 'ABSENT', 'INCOMPLETE'].includes(d.status));
  return { present, absent, late, worked, pct: counted ? Math.round((present / counted) * 100) : 0, workedDays: c((d) => d.workedMinutes > 0) };
};

const CARD_ICON: Record<string, React.FC<{ className?: string }>> = { 'Daily reports': CalendarCheck, 'Summary reports': BarChart3, 'Monitoring reports': Clock };

export const AttendanceReportsPage: React.FC<{ me: any }> = ({ me }) => {
  const today = todayIst();
  const myUid: string = me.person?.uid || '';
  const [def, setDef] = useState<ReportDef>(REPORTS.find((r) => r.id === 'employee-attendance')!);
  const [people, setPeople] = useState<{ uid: string; name: string; empId: string; department?: string }[]>([]);
  const [uid, setUid] = useState('ALL');
  const [dept, setDept] = useState('ALL');
  const [period, setPeriod] = useState<'date' | 'month'>('month');
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState({ from: addDaysIso(today, -13), to: today });
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [times, setTimes] = useState({ fromTime: '00:00', tillTime: '23:59' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);
  const [pending, setPending] = useState<ReportTable | null>(null);
  const [asked, setAsked] = useState<{ id: string; from: string; to: string } | null>(null);
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => { leaveService.attendancePeople().then((r: any) => { const items = r.items || []; setPeople(items); if (items.length <= 1) setUid(myUid); }).catch(() => setPeople([])); }, [myUid]);

  const multi = people.length > 1;
  const range = period === 'month'
    ? { from: `${year}-${String(month).padStart(2, '0')}-01`, to: `${year}-${String(month).padStart(2, '0')}-${lastDay(`${year}-${String(month).padStart(2, '0')}`)}` }
    : rangeFor(preset, today, me.settings.cycleStartDay || 1, custom);
  const depts = useMemo(() => Array.from(new Set(people.map((p) => p.department).filter(Boolean))) as string[], [people]);
  const pickable = people.filter((p) => dept === 'ALL' || p.department === dept);

  const generate = async (d: ReportDef = def) => {
    setBusy(true); setError(null); setPage(1);
    try {
      if (d.own) {
        const r: any = await leaveService.pendingApplications();
        const items = r.items.filter((x: any) => (uid === 'ALL' || x.uid === uid) && (dept === 'ALL' || people.find((p) => p.uid === x.uid)?.department === dept));
        setPending(pendingTable(items)); setData(null);
      } else {
        const days = (new Date(`${range.to}T00:00:00Z`).getTime() - new Date(`${range.from}T00:00:00Z`).getTime()) / 86400000 + 1;
        if (range.from > range.to) throw new Error('The start date must be before the end date.');
        if (days > MAX_RANGE_DAYS) throw new Error(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);
        const res: ReportData = await leaveService.attendanceReport({ from: range.from, to: range.to, uid: uid === 'ALL' ? undefined : uid });
        setData(res); setPending(null);
      }
      setAsked({ id: d.id, from: range.from, to: range.to });
    } catch (e: any) { setError(e?.message || 'Could not build the report.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void generate(); /* first load */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (d: ReportDef) => {
    setDef(d); setHidden(new Set()); setPending(null); setData(null);
    if (!d.periods.includes(period) && d.periods.length) setPeriod(d.periods[0]);
    void generate(d);
  };

  // People narrowed to the department (the server already narrowed to one person when one was picked).
  const scoped = useMemo(() => (data ? { ...data, people: data.people.filter((p) => dept === 'ALL' || p.department === dept) } : null), [data, dept]);
  const isEmp = def.id === 'employee-attendance';
  const empRows = useMemo(() => (scoped ? scoped.people.map((p) => ({ p, t: totalsOf(p) })) : []), [scoped]);
  const generic = useMemo<ReportTable | null>(() => (pending || (scoped && !isEmp ? (scoped && buildReport(def.id, scoped, times)) : null)), [pending, scoped, isEmp, def.id, times]);
  const allCols = isEmp ? ['Present / Absent Days', 'Late Check-ins', 'Working Hours', 'Attendance %'] : (generic?.headers || []);
  const show = (c: string) => !hidden.has(c);
  const toggle = (c: string) => setHidden((h) => { const x = new Set(h); if (x.has(c)) x.delete(c); else x.add(c); return x; });

  const totals = empRows.reduce((a, { t }) => ({ present: a.present + t.present, absent: a.absent + t.absent, late: a.late + t.late, worked: a.worked + t.worked, wd: a.wd + t.workedDays }), { present: 0, absent: 0, late: 0, worked: 0, wd: 0 });
  const subtitle = asked ? (def.own ? `As on ${fmtLong(today)}` : `${dmy(asked.from)} – ${dmy(asked.to)}`) : '';

  const exportRows = (): { headers: string[]; rows: (string | number)[][] } | null => {
    if (isEmp) return { headers: ['Employee ID', 'Employee', 'Department', 'Present', 'Absent', 'Late', 'Working Hours', 'Attendance %'], rows: empRows.map(({ p, t }) => [p.empId, p.name, p.department, t.present, t.absent, t.late, clock(t.worked), `${t.pct}%`]) };
    return generic;
  };
  const csv = () => { const t = exportRows(); if (t && asked) downloadCsv(`${def.id}-${asked.from}_${asked.to}.csv`, [t.headers, ...t.rows]); };
  const print = () => {
    const t = exportRows();
    if (!t) return;
    const w = window.open('', '_blank');
    if (!w) { setError('Allow pop-ups to print, or use Export (Excel).'); return; }
    w.document.write(printHtml(def.title, subtitle, t as ReportTable)); w.document.close(); w.focus(); w.print();
  };

  const years = [Number(today.slice(0, 4)), Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4)) - 2];
  const rowCount = isEmp ? empRows.length : generic?.rows.length || 0;
  const cur = Math.min(page, Math.max(1, Math.ceil(rowCount / PER)));
  const colIdx = generic ? generic.headers.map((h, i) => (show(h) ? i : -1)).filter((i) => i >= 0) : [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Attendance Reports</h1>
          <p className="mt-1 text-sm text-slate-600">Generate, view and download attendance and related reports.</p>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm"><CalendarDays className="h-4 w-4 text-violet-600" />{dmy(range.from)} – {dmy(range.to)}</div>
        {depts.length > 0 && <label className="block text-xs font-medium text-slate-700">Department<Select label="Department" className="mt-1 block w-48" value={dept} onChange={(v) => { setDept(v); setUid('ALL'); }} options={[{ value: 'ALL', label: 'All Departments' }, ...depts.map((d) => ({ value: d, label: d }))]} /></label>}
        {multi && <label className="block text-xs font-medium text-slate-700">Employee<Select label="Employee" className="mt-1 block w-52" value={uid} onChange={setUid} options={[{ value: 'ALL', label: 'All Employees' }, ...pickable.map((p) => ({ value: p.uid, label: `${p.empId ? `${p.empId} - ` : ''}${p.name}${p.uid === myUid ? ' (me)' : ''}` }))]} /></label>}
        <button type="button" disabled={busy} onClick={() => void generate()} className={`${btnViolet} ml-auto`}><BarChart3 className="h-4 w-4" />{busy ? 'Generating…' : 'Generate Report'}</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" role="radiogroup" aria-label="Report type">
        {REPORTS.map((r) => {
          const Icon = CARD_ICON[r.group] || FileText; const on = r.id === def.id;
          return (
            <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => pick(r)} className={`relative flex items-center gap-3 rounded-2xl border bg-white px-4 py-3.5 text-left shadow-sm transition-colors cursor-pointer ${on ? 'border-violet-500 bg-violet-50/60 ring-1 ring-violet-300' : 'border-slate-200 hover:border-violet-300'}`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${on ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-600'}`}><Icon className="h-5 w-5" /></span>
              <span className="min-w-0"><span className="block text-sm font-bold leading-tight text-slate-900">{r.title.replace(/ Report$/, '')}</span><span className="block truncate text-[11px] text-slate-600" title={r.hint}>{r.hint}</span></span>
              {on && <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white"><Check className="h-3 w-3" /></span>}
            </button>
          );
        })}
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,0.7fr)]">
        <Panel title={<span>{def.title}<span className="block text-sm font-normal text-slate-600">{subtitle}</span></span>} right={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={csv} disabled={rowCount === 0} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-violet-300 disabled:opacity-50 cursor-pointer"><Download className="h-4 w-4 text-emerald-600" />Export (Excel)</button>
            <button type="button" onClick={print} disabled={rowCount === 0} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-violet-300 disabled:opacity-50 cursor-pointer"><Printer className="h-4 w-4 text-rose-600" />Export (PDF)</button>
          </div>}>
          {busy && <Skeleton rows={4} />}
          {!busy && isEmp && scoped && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Present Days" value={totals.present} tone="green" Icon={CalendarCheck} />
                <Kpi label="Absent Days" value={totals.absent} tone="rose" Icon={CalendarX} />
                <Kpi label="Late Check-ins" value={totals.late} tone="orange" Icon={Clock} />
                <Kpi label="Avg. Working Hours" value={totals.wd ? hoursText(Math.round(totals.worked / totals.wd)).replace(' 00m', '') : '0h'} tone="blue" Icon={BarChart3} />
              </div>
              {empRows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No data available for these criteria.</p> : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <THead cols={['Employee ID', 'Employee', 'Department', ...(show('Present / Absent Days') ? ['Present', 'Absent'] : []), ...(show('Late Check-ins') ? ['Late'] : []), ...(show('Working Hours') ? ['Working Hours'] : []), ...(show('Attendance %') ? ['Attendance %'] : [])]} />
                      <tbody className="divide-y divide-slate-100">
                        {empRows.slice((cur - 1) * PER, cur * PER).map(({ p, t }) => (
                          <tr key={p.uid} className="text-slate-800">
                            <td className="whitespace-nowrap px-3 py-3 font-semibold text-violet-700 underline">{p.empId || '—'}</td>
                            <td className="px-3 py-3"><span className="flex items-center gap-2.5"><Avatar name={p.name} /><b className="text-slate-900">{p.name}</b></span></td>
                            <td className="px-3 py-3">{p.department || '—'}</td>
                            {show('Present / Absent Days') && <><td className="px-3 py-3 tabular-nums">{t.present}</td><td className="px-3 py-3 tabular-nums">{t.absent}</td></>}
                            {show('Late Check-ins') && <td className="px-3 py-3 tabular-nums">{t.late}</td>}
                            {show('Working Hours') && <td className="whitespace-nowrap px-3 py-3 tabular-nums">{hoursText(t.worked)}</td>}
                            {show('Attendance %') && <td className="px-3 py-3"><Pill tone={pctTone(t.pct)}>{t.pct}%</Pill></td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} total={empRows.length} per={PER} noun="employees" onPage={setPage} />
                </>
              )}
            </>
          )}
          {!busy && !isEmp && generic && (
            generic.rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No data available for these criteria.</p> : (
              <>
                <div className="max-h-[30rem] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <THead cols={colIdx.map((i) => generic.headers[i])} />
                    <tbody className="divide-y divide-slate-100">{generic.rows.slice((cur - 1) * 10, cur * 10).map((r, i) => <tr key={i}>{colIdx.map((j) => <td key={j} className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-800">{r[j]}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <Pager page={page} total={generic.rows.length} per={10} noun="rows" onPage={setPage} />
                {generic.note && <p className="mt-2 text-xs text-slate-500">{generic.note}</p>}
              </>
            )
          )}
        </Panel>

        <Panel title="Report Configuration">
          <div className="space-y-4 text-sm">
            {!def.own && def.periods.length > 1 && (
              <label className="block font-semibold text-slate-900">Report Period
                <Select label="Report period" className="mt-1.5 block w-full font-normal" value={period} onChange={(v) => setPeriod(v as 'date' | 'month')} options={def.periods.map((p) => ({ value: p, label: p === 'date' ? 'Date Wise' : 'Monthly' }))} />
              </label>
            )}
            {!def.own && (period === 'month' ? (
              <div className="flex gap-2">
                <select aria-label="Month" className={input} value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTH_NAMES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}</select>
                <select aria-label="Year" className={input} value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
              </div>
            ) : <div className="flex flex-wrap items-center gap-2"><RangePicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} from={range.from} to={range.to} today={today} /></div>)}
            {def.timeFilter && (
              <div className="grid grid-cols-2 gap-2"><label className="text-xs font-semibold text-slate-800">From time<input type="time" className={`${input} mt-1`} value={times.fromTime} onChange={(e) => setTimes({ ...times, fromTime: e.target.value })} /></label><label className="text-xs font-semibold text-slate-800">Till time<input type="time" className={`${input} mt-1`} value={times.tillTime} onChange={(e) => setTimes({ ...times, tillTime: e.target.value })} /></label></div>
            )}
            {allCols.length > 0 && (
              <fieldset>
                <legend className="font-semibold text-slate-900">Include On Report</legend>
                <div className="mt-2 max-h-52 space-y-2 overflow-y-auto">
                  {allCols.map((c) => <label key={c} className="flex items-center gap-2.5 text-slate-800"><input type="checkbox" checked={show(c)} onChange={() => toggle(c)} className="h-4 w-4 accent-violet-600" />{c}</label>)}
                </div>
              </fieldset>
            )}
            <button type="button" disabled={busy} onClick={() => void generate()} className={`${btnViolet} w-full`}>Apply</button>
          </div>
        </Panel>
      </div>
    </div>
  );
};
