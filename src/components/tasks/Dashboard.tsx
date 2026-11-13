import React, { useState } from 'react';
import { STATUSES } from '../../../shared/taskEngine';
import { taskService } from '../../services/taskService';
import { Loading, useLoad } from '../common/loadUi';
import { Card, EmptyState, Notice, Segmented, input, shortDate } from '../leave/ui';
import { TaskRow } from './TaskRow';
import { Avatar, STATUS_LOOK, useTasks } from './common';
import { CheckCircle2 } from 'lucide-react';

type View = 'me' | 'team' | 'project' | 'company';

const Tile: React.FC<{ label: string; value: number | string; tone?: string; hint?: string }> = ({ label, value, tone = 'text-slate-900', hint }) => (
  <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
    <div className="text-xs font-semibold text-slate-500">{label}</div>
    <div className={`text-2xl font-extrabold mt-0.5 ${tone}`}>{value}</div>
    {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
  </div>
);

/** Numbers about the work, not about people: who has a lot on, what is late, how much gets finished. There is no ranking of who finished the most. */
export const Dashboard: React.FC = () => {
  const { meta, version } = useTasks();
  const [view, setView] = useState<View>('me');
  const [projectId, setProjectId] = useState(meta.projects[0]?.id || '');
  const views = [
    { value: 'me' as const, label: 'Me' },
    ...(meta.flags.manager ? [{ value: 'team' as const, label: 'My team' }] : []),
    ...(meta.projects.length ? [{ value: 'project' as const, label: 'A board' }] : []),
    ...(meta.flags.canManage || meta.flags.canViewAll ? [{ value: 'company' as const, label: 'Company' }] : []),
  ];
  const { data: d, error, loading } = useLoad(() => taskService.get('dashboard', { view, projectId: view === 'project' ? projectId : undefined }), [view, projectId, version]);
  const s = d?.stats;
  const maxWeek = Math.max(1, ...(s?.throughput || []).map((w: any) => w.done));
  const maxOpen = Math.max(1, ...(s?.workload || []).map((w: any) => w.open));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-extrabold text-slate-900 mr-2">Dashboard</h2>
        <Segmented<View> value={view} onChange={setView} options={views} />
        {view === 'project' && <select className={`${input} !w-auto max-w-[14rem]`} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Board">{meta.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        {d && <span className="text-sm text-slate-500">{d.label}</span>}
      </div>
      {!d ? <Loading error={error} loading={loading} /> : s.total === 0 ? (
        <Card><EmptyState icon={CheckCircle2} title="No tasks here yet" text="Numbers appear as soon as tasks are created." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Tile label="Open" value={s.open} /><Tile label="Due this week" value={s.dueThisWeek} hint={s.dueToday ? `${s.dueToday} today` : undefined} />
            <Tile label="Overdue" value={s.overdue} tone={s.overdue ? 'text-rose-600' : 'text-slate-900'} /><Tile label="In review" value={s.inReview} />
            <Tile label="Done" value={s.done} tone="text-emerald-600" hint={s.avgDaysToFinish !== null ? `about ${s.avgDaysToFinish} days each` : undefined} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="By status">
              <div className="flex h-3 rounded-full overflow-hidden bg-slate-100 mb-3">{STATUSES.map((x) => s.byStatus[x.key] ? <div key={x.key} className={STATUS_LOOK[x.key].dot} style={{ width: `${(s.byStatus[x.key] / s.total) * 100}%` }} title={`${x.label}: ${s.byStatus[x.key]}`} /> : null)}</div>
              <ul className="grid grid-cols-2 gap-y-1.5 text-sm">{STATUSES.map((x) => <li key={x.key} className="flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-full ${STATUS_LOOK[x.key].dot}`} /><span className="text-slate-600">{x.label}</span><b className="ml-auto pr-4 text-slate-900">{s.byStatus[x.key] || 0}</b></li>)}</ul>
            </Card>
            <Card title="Finished each week" subtitle="Last six weeks, everyone together">
              <div className="flex items-end gap-2 h-28">
                {s.throughput.map((w: any) => (
                  <div key={w.week} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                    <span className="text-[11px] font-bold text-slate-600">{w.done}</span>
                    <div className="w-full rounded-t-md bg-[#6d4cf0]/80" style={{ height: `${Math.max(4, (w.done / maxWeek) * 76)}%` }} />
                    <span className="text-[10px] text-slate-400">{shortDate(w.week).split(', ')[1]}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {(view !== 'me') && s.workload.length > 0 && (
            <Card title="Open work per person" subtitle="Who has a lot on right now. This is workload, not a score.">
              <ul className="space-y-2">
                {s.workload.map((w: any) => (
                  <li key={w.uid} className="flex items-center gap-3 text-sm">
                    <Avatar name={d.names[w.uid] || '?'} /><span className="w-36 truncate text-slate-800">{d.names[w.uid]}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-sky-400" style={{ width: `${(w.open / maxOpen) * 100}%` }} /></div>
                    <span className="w-8 text-right font-bold text-slate-700">{w.open}</span>
                    <span className={`w-20 text-right text-xs ${w.overdue ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>{w.overdue ? `${w.overdue} overdue` : 'none late'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {d.departments && d.departments.length > 1 && (
            <Card title="Open work by department">
              <table className="w-full text-sm"><tbody>{d.departments.map((x: any) => <tr key={x.name} className="border-t border-slate-100 first:border-0"><td className="py-1.5 text-slate-700">{x.name}</td><td className="py-1.5 text-right font-bold">{x.open}</td><td className={`py-1.5 pl-4 text-right text-xs ${x.overdue ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>{x.overdue ? `${x.overdue} overdue` : '—'}</td></tr>)}</tbody></table>
            </Card>
          )}

          <Card title="Needs attention soon" subtitle="Overdue, or due within a week">
            {d.soon.length === 0 ? <div className="text-sm text-slate-500">Nothing is late or due soon.</div> : <div className="-mx-5 divide-y divide-slate-100">{d.soon.map((t: any) => <TaskRow key={t.id} task={t} showPerson={view !== 'me'} />)}</div>}
          </Card>
          {s.noDueDate > 0 && <Notice>{s.noDueDate} open task{s.noDueDate > 1 ? 's have' : ' has'} no due date, so they cannot show up as late.</Notice>}
        </>
      )}
    </div>
  );
};
