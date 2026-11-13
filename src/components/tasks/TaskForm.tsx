import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { taskService } from '../../services/taskService';
import { Field, Notice, btnGhost, btnPrimary, input, todayIst, useRunner } from '../leave/ui';
import { Sheet, useTasks, type Task } from './common';

/** Create or edit a task. Only the fields the person is allowed to change are enabled by the server; this form asks for the rest. */
export const TaskForm: React.FC<{ task?: Task; defaults?: Partial<Task>; onClose: () => void; onSaved: (t: Task) => void }> = ({ task, defaults, onClose, onSaved }) => {
  const { meta } = useTasks();
  const start = { ...(defaults || {}), ...(task || {}) } as Partial<Task>;
  const [f, setF] = useState({
    title: start.title || '', description: start.description || '', assigneeUid: start.assigneeUid || meta.me.uid, priority: start.priority || 'NORMAL',
    startDate: start.startDate || '', dueDate: start.dueDate || '', projectId: start.projectId || '', tags: (start.tags || []).join(', '),
    requiresReview: !!start.requiresReview, reviewerUid: start.reviewerUid || '', kpiId: start.kpi?.kpiId || '',
  });
  const [items, setItems] = useState<{ id?: string; text: string; done?: boolean }[]>(start.checklist || []);
  const [newItem, setNewItem] = useState('');
  const [kpis, setKpis] = useState<{ id: string; kpi: string; kra: string }[]>([]);
  const { busy, note, run } = useRunner();
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => { taskService.get('kpis', { uid: f.assigneeUid }).then((r) => setKpis(r.items || [])).catch(() => setKpis([])); }, [f.assigneeUid]);
  const kpiOk = !f.kpiId || kpis.some((k) => k.id === f.kpiId);
  useEffect(() => { if (!kpiOk) set({ kpiId: '' }); }, [kpiOk]); // eslint-disable-line react-hooks/exhaustive-deps

  const assignable = useMemo(() => meta.people.filter((p) => meta.assignable.includes(p.uid)), [meta]);
  const reviewers = useMemo(() => meta.people.filter((p) => p.uid !== f.assigneeUid), [meta, f.assigneeUid]);
  const needsReview = f.requiresReview || !!f.kpiId;
  const addItem = () => { const t = newItem.trim(); if (t) { setItems((x) => [...x, { text: t }]); setNewItem(''); } };

  const save = () => run(async () => {
    const r = await taskService.post('save', { id: task?.id, ...f, requiresReview: needsReview, reviewerUid: needsReview ? f.reviewerUid : '', checklist: items });
    onSaved(r.item);
  });

  return (
    <Sheet onClose={onClose} title={task ? 'Edit task' : 'New task'}
      footer={<div className="flex items-center justify-between gap-2">{note ? <Notice tone={note.tone}>{note.text}</Notice> : <span />}<div className="flex gap-2"><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={busy || f.title.trim().length < 3} onClick={save}>{task ? 'Save' : 'Create task'}</button></div></div>}>
      <div className="space-y-4">
        <Field label="What needs to be done?"><input autoFocus className={input} maxLength={200} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="For example: Send the revised brand guidelines" /></Field>
        <Field label="Details (optional)"><textarea className={`${input} min-h-[84px]`} maxLength={4000} value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assigned to">
            <select className={input} value={f.assigneeUid} onChange={(e) => set({ assigneeUid: e.target.value })}>
              {assignable.map((p) => <option key={p.uid} value={p.uid}>{p.uid === meta.me.uid ? 'Me' : p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select className={input} value={f.priority} onChange={(e) => set({ priority: e.target.value })}>{meta.priorities.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
          </Field>
          <Field label="Start date"><input type="date" className={input} value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} /></Field>
          <Field label="Due date"><input type="date" className={input} min={task ? undefined : todayIst()} value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></Field>
        </div>
        <Field label="Board" hint="Everyone who can open a board sees the tasks on it. Leave empty for a task only the people involved and their managers see.">
          <select className={input} value={f.projectId} onChange={(e) => set({ projectId: e.target.value })}>
            <option value="">No board</option>
            {meta.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.scope === 'DEPARTMENT' ? ` · ${p.department}` : ' · company'}</option>)}
          </select>
        </Field>
        <Field label="Tags (comma separated)"><input className={input} value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="design, client" /></Field>

        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">Checklist</div>
          <div className="space-y-1.5">
            {items.map((it, i) => (
              <div key={it.id || i} className="flex items-center gap-2">
                <input className={input} value={it.text} maxLength={200} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
                <button type="button" aria-label="Remove item" className="text-slate-400 hover:text-rose-600" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input className={input} value={newItem} maxLength={200} placeholder="Add a step" onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
              <button type="button" className={btnGhost} onClick={addItem}><Plus className="w-3.5 h-3.5" />Add</button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3 space-y-3 bg-slate-50">
          <div className="text-xs font-bold text-slate-700">Review and Performance</div>
          {kpis.length > 0 && (
            <Field label="Counts towards a KPI" hint="When this task is reviewed and finished, it is added as work evidence for that KPI. It never becomes a rating by itself.">
              <select className={input} value={f.kpiId} onChange={(e) => set({ kpiId: e.target.value })}>
                <option value="">Not linked to a KPI</option>
                {kpis.map((k) => <option key={k.id} value={k.id}>{k.kpi}</option>)}
              </select>
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={needsReview} disabled={!!f.kpiId} onChange={(e) => set({ requiresReview: e.target.checked })} />
            Someone must review this before it counts as done{f.kpiId ? ' (always, for KPI tasks)' : ''}
          </label>
          {needsReview && (
            <Field label="Reviewer" hint="Leave as default: the person who gave the task, or the assignee's manager when they gave it to themselves.">
              <select className={input} value={f.reviewerUid} onChange={(e) => set({ reviewerUid: e.target.value })}>
                <option value="">Default reviewer</option>
                {reviewers.map((p) => <option key={p.uid} value={p.uid}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
              </select>
            </Field>
          )}
        </div>
      </div>
    </Sheet>
  );
};
