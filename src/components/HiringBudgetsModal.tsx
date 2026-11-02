import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { DepartmentBudgetRow, listBudgets, saveBudget } from '../services/hiringBudgetService';

interface Props {
  onClose: () => void;
}

const field =
  'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FA7014]/30 focus:border-[#FA7014]';

interface Draft {
  headcount: string;
  ctc: string;
}

export const HiringBudgetsModal: React.FC<Props> = ({ onClose }) => {
  const [rows, setRows] = useState<DepartmentBudgetRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    try {
      const items = await listBudgets();
      setRows(items);
      const d: Record<string, Draft> = {};
      for (const r of items) d[r.departmentName] = { headcount: r.approvedHeadcount == null ? '' : String(r.approvedHeadcount), ctc: r.maxCtcLpa == null ? '' : String(r.maxCtcLpa) };
      setDrafts(d);
    } catch (e: any) {
      setError(e?.message || 'Could not load budgets.');
      setRows([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (name: string) => {
    const d = drafts[name];
    setBusy(name);
    setError(null);
    setSaved(null);
    try {
      await saveBudget({ departmentName: name, approvedHeadcount: d.headcount.trim() === '' ? null : d.headcount, maxCtcLpa: d.ctc.trim() === '' ? null : d.ctc });
      setSaved(`Saved ${name}.`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  const dirty = (r: DepartmentBudgetRow) => {
    const d = drafts[r.departmentName];
    if (!d) return false;
    return d.headcount !== (r.approvedHeadcount == null ? '' : String(r.approvedHeadcount)) || d.ctc !== (r.maxCtcLpa == null ? '' : String(r.maxCtcLpa));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-black text-slate-900">Department hiring budgets</h2>
            <p className="text-xs text-slate-500">
              Approved headcount and the highest CTC (LPA) per department. The founder sees a warning, and must give a reason, when a requisition goes beyond these.
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}
          {saved && <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">{saved}</div>}
          {rows === null ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No departments yet. Add departments first.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] font-bold uppercase text-slate-500">
                  <tr>
                    <th className="py-2 pr-3">Department</th>
                    <th className="py-2 pr-3">Now</th>
                    <th className="py-2 pr-3">Open approved</th>
                    <th className="py-2 pr-3 w-28">Approved headcount</th>
                    <th className="py-2 pr-3 w-28">Max CTC (LPA)</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.departmentName} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-bold text-slate-900">{r.departmentName}</td>
                      <td className="py-2 pr-3 text-slate-700">{r.currentHeadcount}</td>
                      <td className="py-2 pr-3 text-slate-700">{r.committedVacancies}</td>
                      <td className="py-2 pr-3">
                        <input className={field} type="number" min={0} value={drafts[r.departmentName]?.headcount ?? ''} onChange={(e) => setDrafts({ ...drafts, [r.departmentName]: { ...drafts[r.departmentName], headcount: e.target.value } })} placeholder="not set" />
                      </td>
                      <td className="py-2 pr-3">
                        <input className={field} type="number" min={0} step="0.1" value={drafts[r.departmentName]?.ctc ?? ''} onChange={(e) => setDrafts({ ...drafts, [r.departmentName]: { ...drafts[r.departmentName], ctc: e.target.value } })} placeholder="not set" />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          className="rounded-lg bg-[#FA7014] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#E65A05] disabled:bg-slate-300"
                          disabled={!dirty(r) || busy !== null}
                          onClick={() => save(r.departmentName)}
                        >
                          {busy === r.departmentName ? 'Saving...' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-[11px] text-slate-500">
            "Now" counts active employees; "Open approved" counts vacancies on requisitions the founder has approved and that are not closed yet. Leave a field empty to remove that limit.
          </p>
        </div>
      </div>
    </div>
  );
};
