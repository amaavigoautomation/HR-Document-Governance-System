import React, { useEffect, useState } from 'react';
import { CalendarCheck, FileText, Layers, Plus, ShieldCheck } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { Skeleton } from './ui';
import { btnViolet, dmy, Kpi, Panel, Pill, THead } from './kit';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const accrualText = (a: any) => (typeof a === 'string' ? a : a?.kind || a?.type || a?.mode || 'Yearly').toString().replace(/_/g, ' ').toLowerCase().replace(/^./, (c: string) => c.toUpperCase());

/** Leave policies at a glance: the list on the left, the picked policy's allocation on the right. Editing stays in Settings. */
export const HrPolicies: React.FC<{ onEdit: () => void }> = ({ onEdit }) => {
  const [s, setS] = useState<any | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { leaveService.settings().then((r: any) => setS(r.settings)).catch(() => setS({ policies: [], types: [] })); }, []);
  if (!s) return <Skeleton rows={4} />;

  const policies: any[] = s.policies || [];
  const types: any[] = s.types || [];
  const sel = policies.find((p) => p.id === pick) || policies.find((p) => p.isDefault) || policies[0];
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const totalDays = (p: any) => (p.entries || []).reduce((n: number, e: any) => n + (typeOf(e.typeId)?.requiresBalance === false || typeOf(e.typeId)?.isLop ? 0 : Number(e.quota) || 0), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Total Policies" value={policies.length} tone="violet" Icon={FileText} />
        <Kpi label="Leave Types" value={types.filter((t) => t.active !== false).length} sub="Active" tone="green" Icon={Layers} />
        <Kpi label="Policy Version" value={`v${s.policyVersion || 1}`} sub={s.effectiveFrom ? `From ${dmy(s.effectiveFrom)}` : undefined} tone="orange" Icon={ShieldCheck} />
        <Kpi label="Leave Year Starts" value={MONTHS[(s.yearStartMonth || 1) - 1]} tone="blue" Icon={CalendarCheck} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Leave Policies" right={<button type="button" className={btnViolet} onClick={onEdit}><Plus className="h-4 w-4" />Create Policy</button>}>
          {policies.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No policies yet. Set one up in Settings.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <THead cols={['Policy Name', 'Leave Types', 'Days / Year', 'Status']} />
                <tbody className="divide-y divide-slate-100">
                  {policies.map((p) => (
                    <tr key={p.id} onClick={() => setPick(p.id)} className={`cursor-pointer text-slate-800 hover:bg-violet-50/40 ${sel?.id === p.id ? 'bg-violet-50/60' : ''}`}>
                      <td className="px-3 py-3.5 font-semibold text-slate-900">{p.name}</td>
                      <td className="px-3 py-3.5">{(p.entries || []).length}</td>
                      <td className="px-3 py-3.5 tabular-nums">{totalDays(p)}</td>
                      <td className="px-3 py-3.5"><Pill tone={p.isDefault ? 'violet' : 'green'}>{p.isDefault ? 'Default' : 'Active'}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Policy Details" right={<button type="button" onClick={onEdit} className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-violet-300 cursor-pointer">Edit in Settings</button>}>
          {!sel ? <p className="text-sm text-slate-500">Pick a policy.</p> : (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <div><dt className="text-xs text-slate-500">Policy Name</dt><dd className="font-semibold text-slate-900">{sel.name}</dd></div>
                <div><dt className="text-xs text-slate-500">Status</dt><dd><Pill tone={sel.isDefault ? 'violet' : 'green'}>{sel.isDefault ? 'Default' : 'Active'}</Pill></dd></div>
                <div><dt className="text-xs text-slate-500">Leave Year</dt><dd className="font-semibold text-slate-900">{MONTHS[(s.yearStartMonth || 1) - 1]} start</dd></div>
                <div><dt className="text-xs text-slate-500">Effective From</dt><dd className="font-semibold text-slate-900">{s.effectiveFrom ? dmy(s.effectiveFrom) : '—'}</dd></div>
              </dl>
              <div>
                <h4 className="mb-2 text-sm font-bold text-slate-900">Leave Type & Allocation</h4>
                <table className="w-full text-left text-sm">
                  <THead cols={['Leave Type', 'Days', 'Accrual', 'Carry Forward']} />
                  <tbody className="divide-y divide-slate-100">
                    {(sel.entries || []).map((e: any) => {
                      const t = typeOf(e.typeId);
                      return (
                        <tr key={e.typeId} className="text-slate-800">
                          <td className="px-3 py-2.5">{t?.name || e.typeId}</td>
                          <td className="px-3 py-2.5 tabular-nums">{t?.requiresBalance === false ? '—' : e.quota}</td>
                          <td className="px-3 py-2.5">{accrualText(e.accrual)}</td>
                          <td className="px-3 py-2.5">{e.carryForward ? (e.carryCap ? `Up to ${e.carryCap}` : 'Yes') : 'No'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};
