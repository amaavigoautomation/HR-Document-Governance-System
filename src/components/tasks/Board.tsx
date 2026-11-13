import React, { useMemo, useState } from 'react';
import { Columns3, Plus, Search, Target } from 'lucide-react';
import { PageHeader } from '../common/pageChrome';
import { STATUSES } from '../../../shared/taskEngine';
import { taskService } from '../../services/taskService';
import { Loading, useLoad } from '../common/loadUi';
import { Notice, btnPrimary, input, useRunner } from '../leave/ui';
import { Avatar, DueLabel, PriorityFlag, STATUS_LOOK, TaskMeta, useTasks, type Task } from './common';

/** Columns by status. Drag a card to another column to move it; the server decides whether that move is allowed. */
export const Board: React.FC = () => {
  const { meta, version, changed, openTask, newTask } = useTasks();
  const options = useMemo(() => [
    { value: 'mine', label: 'My tasks' },
    ...(meta.flags.manager ? [{ value: 'team', label: 'My team' }] : []),
    ...meta.projects.map((p) => ({ value: `p:${p.id}`, label: `${p.name}${p.scope === 'DEPARTMENT' ? ` (${p.department})` : ''}` })),
    ...(meta.flags.canManage || meta.flags.canViewAll ? [{ value: 'all', label: 'Everyone' }] : []),
  ], [meta]);
  const [scopeKey, setScopeKey] = useState(() => { try { return localStorage.getItem('amaavigo_tasks_board') || 'mine'; } catch { return 'mine'; } });
  const scope = options.some((o) => o.value === scopeKey) ? scopeKey : 'mine';
  const pick = (v: string) => { setScopeKey(v); try { localStorage.setItem('amaavigo_tasks_board', v); } catch { /* private mode */ } };
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const projectId = scope.startsWith('p:') ? scope.slice(2) : '';
  const { data, error, loading } = useLoad(() => taskService.get('list', { scope: projectId ? 'project' : scope, projectId }), [scope, version]);
  const { note, setNote, run } = useRunner();
  const [drag, setDrag] = useState<string>('');
  const [over, setOver] = useState<string>('');

  const all: Task[] = data?.items || [];
  const people = useMemo(() => Array.from(new Map(all.map((t) => [t.assigneeUid, t.assigneeName])).entries()), [all]);
  const rows = all.filter((t) => (!who || t.assigneeUid === who) && (!q || `${t.title} ${t.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const col = (key: string) => rows.filter((t) => t.status === key).sort((a, b) => a.order - b.order);

  const drop = (status: string, before?: Task) => {
    const id = drag; setDrag(''); setOver('');
    const t = all.find((x) => x.id === id);
    if (!t) return;
    if (status === 'REWORK' && t.status !== 'REWORK') { openTask(id); setNote({ tone: 'ok', text: 'Open the task and use "Move to → Needs changes" to say what needs to change.' }); return; }
    const list = col(status).filter((x) => x.id !== id);
    let order = Date.now();
    if (before) { const i = list.findIndex((x) => x.id === before.id); order = i <= 0 ? before.order - 1000 : (list[i - 1].order + before.order) / 2; }
    run(async () => { const r = await taskService.post('move', { id, status, order }); if (r.message) setNote({ tone: 'ok', text: r.message }); changed(); });
  };

  return (
    <div>
      <PageHeader icon={Columns3} title="Boards" subtitle="Drag cards between columns to change their status." />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className={`${input} !w-auto max-w-[14rem]`} value={scope} onChange={(e) => { pick(e.target.value); setWho(''); }} aria-label="Board">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {scope !== 'mine' && people.length > 1 && (
          <select className={`${input} !w-auto max-w-[12rem]`} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>{people.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
          </select>
        )}
        <div className="relative flex-1 min-w-[9rem] max-w-xs"><Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" /><input className={`${input} pl-8`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className={`${btnPrimary} ml-auto`} onClick={() => newTask(projectId ? { projectId } : undefined)}><Plus className="w-4 h-4" />New task</button>
      </div>
      {note && <div className="mb-3"><Notice tone={note.tone}>{note.text}</Notice></div>}
      {!data ? <Loading error={error} loading={loading} /> : (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1">
          {STATUSES.map((s) => {
            const cards = col(s.key); const look = STATUS_LOOK[s.key];
            return (
              <div key={s.key} onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(s.key); } }} onDragLeave={() => setOver((o) => (o === s.key ? '' : o))} onDrop={(e) => { e.preventDefault(); drop(s.key); }}
                className={`w-64 shrink-0 rounded-2xl border p-2 transition-colors ${over === s.key ? 'border-[#6d4cf0] bg-violet-50/60' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex items-center gap-2 px-1.5 py-1 mb-1.5"><span className={`w-2.5 h-2.5 rounded-full ${look.dot}`} /><span className="text-xs font-bold text-slate-700">{s.label}</span><span className="text-xs text-slate-400 font-semibold">{cards.length}</span></div>
                <div className="space-y-2 min-h-[3rem]">
                  {cards.map((t) => (
                    <div key={t.id} draggable onDragStart={(e) => { setDrag(t.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDrag(''); setOver(''); }}
                      onDragOver={(e) => { if (drag && drag !== t.id) { e.preventDefault(); e.stopPropagation(); setOver(s.key); } }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); drop(s.key, t); }}
                      onClick={() => openTask(t.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTask(t.id)}
                      className={`bg-white rounded-xl border border-slate-200 p-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] cursor-grab active:cursor-grabbing hover:border-slate-300 ${drag === t.id ? 'opacity-40' : ''}`}>
                      <div className="flex items-start gap-1.5"><span className={`text-sm font-semibold leading-snug flex-1 ${t.status === 'DONE' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{t.title}</span>{t.priority !== 'NORMAL' && <PriorityFlag priority={t.priority} />}</div>
                      {t.tags.length > 0 && <div className="flex flex-wrap gap-1 mt-1.5">{t.tags.slice(0, 3).map((x) => <span key={x} className="px-1.5 py-px rounded bg-slate-100 text-slate-500 text-[10px] font-semibold">#{x}</span>)}</div>}
                      <div className="flex items-center justify-between mt-2 gap-2">
                        <span className="flex items-center gap-2 min-w-0 flex-wrap"><DueLabel task={t} /><TaskMeta task={t} />{t.kpi && <Target className="w-3.5 h-3.5 text-violet-500" aria-label="Counts towards a KPI" />}</span>
                        <Avatar name={t.assigneeName} size={22} />
                      </div>
                    </div>
                  ))}
                  {cards.length === 0 && <div className="text-[11px] text-slate-400 text-center py-3">{drag ? 'Drop here' : 'Nothing here'}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-slate-400 mt-1">Done tasks stay for 30 days. Drag a card to change its status. Tasks that need a review can only be finished by their reviewer.</p>
    </div>
  );
};
