import React, { useEffect, useMemo, useState } from 'react';
import { Download, Printer, RotateCcw } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { downloadCsv } from '../../services/leaveService';
import { EXIT_STATUS_LABEL } from '../../../shared/lifecycleEngine';
import { btnGhost, btnPrimary, Field, input, Notice, Skeleton, addDaysIso, todayIst } from '../leave/ui';
import { fmtLong } from '../leave/RangePicker';
import { printHtml, longDate } from '../leave/attendanceReports';
import { TASK_STATUS_LABEL, clearanceRows, clearanceTable, clearanceTotals, groupClearance, type ClearanceOptions, type ExitView, type TaskStatus } from './exitClearanceReport';

const STATUS_LOOK: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200', CLEARED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  DUES: 'bg-rose-50 text-rose-700 border-rose-200', WAIVED: 'bg-slate-100 text-slate-600 border-slate-200', NOT_STARTED: 'bg-slate-100 text-slate-500 border-slate-200',
};
const inr = (n: number) => `Rs. ${n.toLocaleString('en-IN')}`;

/** Exit Clearance Report: who is leaving, which departments have signed off, and what is still owed. */
export const ExitClearanceReportPage: React.FC = () => {
  const today = todayIst();
  const fresh = (): ClearanceOptions => ({ leavingFrom: addDaysIso(today, -90), leavingTill: addDaysIso(today, 90), statusFrom: '', statusTill: '', taskStatus: 'ALL', taskRole: '', uid: 'ALL', exitStatus: '' });
  const [o, setO] = useState<ClearanceOptions>(fresh);
  const [exits, setExits] = useState<ExitView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onePage, setOnePage] = useState(false);
  const [shown, setShown] = useState<ClearanceOptions | null>(null);
  const [busy, setBusy] = useState(false);

  // HR sees every exit, managers their team's. Anyone also sees their own.
  const load = async () => {
    const [all, mine] = await Promise.all([lifecycleService.exits().catch(() => ({ exits: [] })), lifecycleService.exitMy().catch(() => ({ exit: null }))]);
    const list: ExitView[] = all.exits || [];
    if (mine.exit && !list.some((e) => e.uid === mine.exit.uid)) list.push(mine.exit);
    return list;
  };
  useEffect(() => { void load().then(setExits).catch((e) => setError(e.message)); }, []);

  const people = useMemo(() => (exits || []).map((e) => ({ uid: e.uid, label: `${e.employee.empId ? e.employee.empId + ' - ' : ''}${e.employee.name}` })).sort((a, b) => a.label.localeCompare(b.label)), [exits]);
  const roles = useMemo(() => {
    const m = new Map<string, string>();
    (exits || []).forEach((e) => e.clearance.forEach((c) => m.set(c.deptId, c.label)));
    return Array.from(m, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [exits]);
  const set = <K extends keyof ClearanceOptions>(k: K, v: ClearanceOptions[K]) => setO((x) => ({ ...x, [k]: v }));

  const generate = async () => {
    setError(null);
    if (o.leavingFrom && o.leavingTill && o.leavingFrom > o.leavingTill) { setError('The leaving "from" date must be before the "till" date.'); return; }
    if (o.statusFrom && o.statusTill && o.statusFrom > o.statusTill) { setError('The status "from" date must be before the "till" date.'); return; }
    setBusy(true);
    try { setExits(await load()); setShown(o); } catch (e: any) { setError(e?.message || 'Could not build the report.'); } finally { setBusy(false); }
  };
  const reset = () => { setO(fresh()); setShown(null); setError(null); setOnePage(false); };

  const rows = useMemo(() => (exits && shown ? clearanceRows(exits, shown) : []), [exits, shown]);
  const groups = useMemo(() => groupClearance(rows), [rows]);
  const totals = clearanceTotals(rows);
  const subtitle = shown ? `Leaving ${shown.leavingFrom ? fmtLong(shown.leavingFrom) : 'any time'} - ${shown.leavingTill ? fmtLong(shown.leavingTill) : 'any time'}` : '';
  const csv = () => { const t = clearanceTable(rows); downloadCsv(`exit-clearance-${today}.csv`, [t.headers, ...t.rows]); };
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) { setError('Allow pop-ups to print, or use Download CSV.'); return; }
    w.document.write(printHtml('Exit Clearance Report', subtitle, clearanceTable(rows), '', onePage));
    w.document.close(); w.focus(); w.print();
  };
  const dateField = (k: keyof ClearanceOptions, label: string) => (
    <Field label={label}><input type="date" className={input} value={String(o[k])} onChange={(e) => set(k, e.target.value as never)} /></Field>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {dateField('leavingFrom', 'Leaving from')}{dateField('leavingTill', 'Leaving till')}
          {dateField('statusFrom', 'Last updated from')}{dateField('statusTill', 'Last updated till')}
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Employee">
            <select className={input} value={o.uid} onChange={(e) => set('uid', e.target.value)}>{people.length !== 1 && <option value="ALL">All employees</option>}{people.map((p) => <option key={p.uid} value={p.uid}>{p.label}</option>)}</select>
          </Field>
          <Field label="Exit status">
            <select className={input} value={o.exitStatus} onChange={(e) => set('exitStatus', e.target.value)}><option value="">All</option>{Object.entries(EXIT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="Clearance status">
            <select className={input} value={o.taskStatus} onChange={(e) => set('taskStatus', e.target.value as TaskStatus)}><option value="ALL">All</option>{(['PENDING', 'CLEARED', 'DUES', 'WAIVED'] as const).map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}</select>
          </Field>
          <Field label="Department">
            <select className={input} value={o.taskRole} onChange={(e) => set('taskRole', e.target.value)} disabled={roles.length === 0}><option value="">All departments</option>{roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={onePage} onChange={(e) => setOnePage(e.target.checked)} />Fit the printed report on one page</label>
          <span className="ml-auto flex gap-2">
            <button type="button" className={btnGhost} onClick={reset}><RotateCcw className="w-3.5 h-3.5" />Reset</button>
            <button type="button" className={btnPrimary} disabled={busy || exits === null} onClick={() => void generate()}>{busy ? 'Generating…' : 'Generate'}</button>
          </span>
        </div>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {(busy || (exits === null && !error)) && <Skeleton rows={3} />}
      {shown && !busy && (
        <section className="bg-white border border-slate-200 rounded-xl">
          <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <div className="text-sm font-bold text-slate-800">Exit Clearance Report</div>
              <div className="text-[11px] text-slate-500">{subtitle}</div>
            </div>
            <button type="button" className={btnGhost} onClick={csv} disabled={rows.length === 0}><Download className="w-3.5 h-3.5" />Download CSV</button>
            <button type="button" className={btnGhost} onClick={print} disabled={rows.length === 0}><Printer className="w-3.5 h-3.5" />Print / PDF</button>
          </div>
          {rows.length === 0 ? <p className="p-8 text-center text-xs text-slate-400">No exits match these criteria.</p> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-100 border-b border-slate-100">
                {([['Employees leaving', totals.employees], ['Items pending', totals.pending], ['Departments with dues', totals.withDues], ['Total owed', inr(totals.dues)]] as const).map(([k, v]) => (
                  <div key={k} className="bg-white px-4 py-3"><div className="text-[11px] text-slate-500">{k}</div><div className="text-sm font-black text-slate-800">{v}</div></div>
                ))}
              </div>
              <div className="divide-y divide-slate-100">
                {groups.map((g) => (
                  <div key={g.uid} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="text-sm font-bold text-slate-800">{g.title}</span>
                      <span className="text-[11px] text-slate-500">{g.exitStatus}{g.lastWorkingDay ? ` · last day ${longDate(g.lastWorkingDay)}` : ''}{g.docNo ? ` · ${g.docNo}` : ''}</span>
                      {g.total > 0 && (
                        <span className="ml-auto inline-flex items-center gap-2 text-[11px] text-slate-600">
                          <span className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden><span className="block h-full bg-emerald-500" style={{ width: `${Math.round((g.done / g.total) * 100)}%` }} /></span>
                          {g.done} of {g.total} done{g.dues ? ` · ${inr(g.dues)} owed` : ''}
                        </span>
                      )}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {g.rows.map((r, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border w-20 text-center ${STATUS_LOOK[r.status] || STATUS_LOOK.WAIVED}`}>{TASK_STATUS_LABEL[r.status] || r.status}</span>
                          <span className="font-semibold text-slate-800">{r.item}</span>
                          {r.owner && <span className="text-slate-500">· {r.owner}</span>}
                          {r.dues > 0 && <span className="text-rose-600 font-bold">{inr(r.dues)}</span>}
                          {r.note && <span className="text-slate-500">· {r.note}</span>}
                          {r.doneBy && <span className="ml-auto text-[11px] text-slate-400">{r.doneBy}{r.doneOn ? `, ${longDate(r.doneOn)}` : ''}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
};
