import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, Notice, Segmented, input } from '../leave/ui';
import { Loading, Pill, REVIEW_LABEL, fmtScore, useLoad } from './shared';

const Bars: React.FC<{ dist: Record<string, number> }> = ({ dist }) => {
  const max = Math.max(1, ...Object.values(dist));
  return (
    <div className="flex items-end gap-2 h-24">{['1', '2', '3', '4', '5'].map((k) => (
      <div key={k} className="flex-1 flex flex-col items-center justify-end gap-1"><span className="text-[11px] text-slate-500">{dist[k]}</span><div className="w-full bg-[#FA7014]/70 rounded-t" style={{ height: `${(dist[k] / max) * 100}%`, minHeight: dist[k] ? 4 : 1 }} /><span className="text-xs font-bold text-slate-600">{k}</span></div>))}</div>
  );
};

/** HR sees progress and checks; leaders see results only where a group is big enough to stay anonymous. */
export const Dashboard: React.FC<{ me: any }> = ({ me }) => {
  const hr = !!(me.canManage || me.canApprove);
  const [mode, setMode] = useState<'hr' | 'leadership'>(hr ? 'hr' : 'leadership');
  const [cycleId, setCycleId] = useState('');
  const cycles = useLoad(() => perfService.cycles(), []);
  const q = useLoad(() => perfService.dashboard(mode, cycleId || undefined), [mode, cycleId]);
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {hr && <Segmented value={mode} onChange={setMode} options={[{ value: 'hr', label: 'HR view' }, { value: 'leadership', label: 'Leadership view' }]} />}
        <select className={`${input} !w-56`} value={cycleId} onChange={(e) => setCycleId(e.target.value)}><option value="">Latest cycle</option>{(cycles.data?.items || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <Loading error={q.error} loading={q.loading} />
      {d && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card><p className="text-xs text-slate-500">Reviews in cycle</p><p className="text-2xl font-bold">{d.total}</p></Card>
            <Card><p className="text-xs text-slate-500">Completed</p><p className="text-2xl font-bold">{d.completion}%</p></Card>
            <Card><p className="text-xs text-slate-500">Average (finished)</p><p className="text-2xl font-bold">{d.average !== null ? fmtScore(d.average) : '–'}</p></Card>
            {mode === 'hr' && <Card><p className="text-xs text-slate-500">Open exceptions</p><p className="text-2xl font-bold">{d.openExceptions}</p></Card>}
          </div>
          <Card title="Where reviews are"><div className="flex flex-wrap gap-2">{Object.entries(d.byStatus || {}).map(([s, n]) => <Pill key={s} tone={s === 'ACKNOWLEDGED' || s === 'CLOSED' ? 'green' : 'amber'}>{REVIEW_LABEL[s] || s}: {n as number}</Pill>)}{d.total === 0 && <span className="text-sm text-slate-500">No reviews in this cycle.</span>}</div></Card>
          <Card title="Rating distribution" subtitle={`Shown only when at least ${d.minCohort} reviews are finished, so nobody can be picked out.`}>
            {d.distribution ? <Bars dist={d.distribution} /> : <p className="text-sm text-slate-500">Not enough finished reviews yet.</p>}
          </Card>
          <Card title="By department">
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Department</th><th>Finished</th><th>Average</th></tr></thead>
              <tbody>{(d.departments || []).map((x: any) => <tr key={x.department} className="border-t border-slate-100"><td className="py-1.5">{x.department}</td><td>{x.count}</td><td>{x.hidden ? <span className="text-xs text-slate-400">hidden (fewer than {d.minCohort})</span> : fmtScore(x.average)}</td></tr>)}</tbody></table>
          </Card>
          {mode === 'hr' && (
            <>
              <Card title={`Overdue (${(d.overdue || []).length})`}>
                {(d.overdue || []).length === 0 ? <p className="text-sm text-slate-500">Nothing overdue.</p> : <ul className="text-sm divide-y divide-slate-100">{d.overdue.map((r: any) => <li key={r.id} className="py-1.5"><span className="font-semibold">{r.employeeName}</span> · {REVIEW_LABEL[r.status]} · manager {r.managerName || 'not set'}</li>)}</ul>}
              </Card>
              <Card title="Consistency checks" subtitle="Prompts for a person to look. They are not verdicts.">
                {(d.fairness || []).length === 0 ? <p className="text-sm text-slate-500">Nothing to flag.</p> : <ul className="text-sm space-y-1.5">{d.fairness.map((f: any, i: number) => <li key={i}><Pill tone="amber">{f.kind.replace(/_/g, ' ').toLowerCase()}</Pill> {f.managerName && <strong>{f.managerName}</strong>} {f.employeeName && <>· {f.employeeName}</>} <span className="text-slate-600">{f.message}</span></li>)}</ul>}
              </Card>
              <Notice>{d.pendingSops} SOP acknowledgement(s) are still waiting.</Notice>
            </>)}
        </>)}
    </div>
  );
};
