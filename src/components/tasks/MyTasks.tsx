import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, ListChecks, Plus, Search } from 'lucide-react';
import { PageHeader } from '../common/pageChrome';
import { sortForList } from '../../../shared/taskEngine';
import { taskService } from '../../services/taskService';
import { Loading, useLoad } from '../common/loadUi';
import { Card, EmptyState, Notice, Segmented, addDaysIso, btnPrimary, input, todayIst, useRunner } from '../leave/ui';
import { TaskRow } from './TaskRow';
import { useTasks, type Task } from './common';

type Tab = 'mine' | 'created' | 'review';

/** The first screen: everything on my plate, grouped by when it is due. */
export const MyTasks: React.FC = () => {
  const { meta, version, changed, newTask } = useTasks();
  const [tab, setTab] = useState<Tab>('mine');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [showDone, setShowDone] = useState(false);
  const { data, error, loading } = useLoad(() => taskService.get('list', { scope: tab, q }), [tab, q, version]);
  const { busy, note, run } = useRunner();

  const today = todayIst(); const week = addDaysIso(today, 7);
  const groups = useMemo(() => {
    const rows: Task[] = sortForList(data?.items || [], today);
    const open = rows.filter((t) => t.status !== 'DONE');
    const g = (f: (t: Task) => boolean) => open.filter(f);
    return [
      { key: 'late', title: 'Overdue', tone: 'text-rose-600', rows: g((t) => !!t.dueDate && t.dueDate < today) },
      { key: 'today', title: 'Today', tone: 'text-amber-600', rows: g((t) => t.dueDate === today) },
      { key: 'week', title: 'This week', tone: 'text-slate-600', rows: g((t) => t.dueDate > today && t.dueDate <= week) },
      { key: 'later', title: 'Later', tone: 'text-slate-600', rows: g((t) => t.dueDate > week) },
      { key: 'none', title: 'No due date', tone: 'text-slate-600', rows: g((t) => !t.dueDate) },
    ].filter((x) => x.rows.length);
  }, [data, today, week]);
  const finished: Task[] = (data?.items || []).filter((t: Task) => t.status === 'DONE');

  const quickMove = (t: Task, to: string) => run(async () => { await taskService.post('move', { id: t.id, status: to }); changed(); });
  const add = () => { const title = quick.trim(); if (title.length >= 3) run(async () => { await taskService.post('save', { title }); setQuick(''); changed(); }); };

  return (
    <div>
      <PageHeader icon={ListChecks} title="My Tasks"
        subtitle={`${meta.counts.open} open${meta.counts.overdue ? ` · ${meta.counts.overdue} overdue` : ''}${meta.counts.review ? ` · ${meta.counts.review} waiting for your review` : ''}`}
        actions={<button className={btnPrimary} onClick={() => newTask()}><Plus className="w-4 h-4" />New task</button>} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'mine', label: 'Assigned to me' }, { value: 'created', label: 'I gave' }, { value: 'review', label: <>To review{meta.counts.review ? ` (${meta.counts.review})` : ''}</> }]} />
        <div className="relative flex-1 min-w-[10rem] max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input className={`${input} pl-8`} placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {note && <div className="mb-3"><Notice tone={note.tone}>{note.text}</Notice></div>}
      {tab === 'mine' && (
        <div className="mb-4 flex gap-2">
          <input className={input} value={quick} maxLength={200} placeholder="Add a task for yourself and press Enter" onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className={btnPrimary} disabled={busy || quick.trim().length < 3} onClick={add}>Add</button>
        </div>
      )}
      {!data ? <Loading error={error} loading={loading} /> : groups.length === 0 && finished.length === 0 ? (
        <Card><EmptyState icon={CheckCircle2} title={tab === 'review' ? 'Nothing is waiting for your review' : tab === 'created' ? 'You have not given anyone a task' : 'You are all caught up'} text={tab === 'mine' ? 'Add a task above, or ask your manager.' : undefined} /></Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key}>
              <h3 className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${g.tone}`}>{g.title} <span className="text-slate-400 font-semibold">{g.rows.length}</span></h3>
              <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">{g.rows.map((t) => <TaskRow key={t.id} task={t} onQuick={quickMove} showPerson={tab !== 'mine'} />)}</div>
            </section>
          ))}
          {finished.length > 0 && (
            <section>
              <button className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5" onClick={() => setShowDone((v) => !v)}>
                {showDone ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}Done in the last 30 days <span className="text-slate-400 font-semibold">{finished.length}</span>
              </button>
              {showDone && <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">{finished.map((t) => <TaskRow key={t.id} task={t} showPerson={tab !== 'mine'} />)}</div>}
            </section>
          )}
        </div>
      )}
    </div>
  );
};
