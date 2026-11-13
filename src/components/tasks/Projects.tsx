import React, { useState } from 'react';
import { Archive, FolderKanban, Pencil, Plus, RotateCcw } from 'lucide-react';
import { taskService } from '../../services/taskService';
import { PageHeader } from '../common/pageChrome';
import { Loading, Pill, useLoad } from '../common/loadUi';
import { Card, EmptyState, Field, Notice, Segmented, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Sheet, useTasks } from './common';
import { taskNav } from './taskNav';

const COLORS = ['#6d4cf0', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#14b8a6'];

const ProjectForm: React.FC<{ project?: any; canCompany: boolean; departments: string[]; onClose: () => void; onSaved: () => void }> = ({ project, canCompany, departments, onClose, onSaved }) => {
  const [f, setF] = useState({ name: project?.name || '', description: project?.description || '', scope: project?.scope || (canCompany ? 'COMPANY' : 'DEPARTMENT'), department: project?.department || departments[0] || '', color: project?.color || COLORS[0] });
  const { busy, note, run } = useRunner();
  return (
    <Sheet onClose={onClose} title={project ? 'Edit project' : 'New project'}
      footer={<div className="flex items-center justify-between gap-2">{note ? <Notice tone={note.tone}>{note.text}</Notice> : <span />}<div className="flex gap-2"><button className={btnGhost} onClick={onClose}>Cancel</button><button className={btnPrimary} disabled={busy || f.name.trim().length < 2} onClick={() => run(async () => { await taskService.post('project-save', { id: project?.id, ...f }); onSaved(); })}>Save</button></div></div>}>
      <div className="space-y-4">
        <Field label="Name"><input autoFocus className={input} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="For example: Diwali campaign" /></Field>
        <Field label="Description (optional)"><textarea className={`${input} min-h-[72px]`} maxLength={400} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        {!project && (
          <Field label="Who can use it" hint={f.scope === 'COMPANY' ? 'Everyone in the company can add tasks to it and see its tasks.' : 'Only people in that department (and anyone with full task access).'}>
            <div className="space-y-2">
              <Segmented value={f.scope} onChange={(v) => setF({ ...f, scope: v })} options={[{ value: 'COMPANY', label: 'Whole company', disabled: !canCompany }, { value: 'DEPARTMENT', label: 'One department', disabled: departments.length === 0 }]} />
              {f.scope === 'DEPARTMENT' && <select className={input} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>{departments.map((x) => <option key={x}>{x}</option>)}</select>}
            </div>
          </Field>
        )}
        <Field label="Colour"><div className="flex gap-2">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setF({ ...f, color: c })} className={`w-7 h-7 rounded-full border-2 ${f.color === c ? 'border-slate-900' : 'border-transparent'}`} style={{ background: c }} />)}</div></Field>
      </div>
    </Sheet>
  );
};

/** Boards for a department or the whole company. Anyone who can open a board sees the tasks on it. */
export const Projects: React.FC = () => {
  const { meta, changed, version, newTask } = useTasks();
  const { data, error, loading, reload } = useLoad(() => taskService.get('projects'), [version]);
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const { note, run } = useRunner();
  const depts: string[] = data ? (data.canCreate.departments === 'all' ? meta.departments : data.canCreate.departments) : [];
  const canAny = !!data && (data.canCreate.company || depts.length > 0);
  const openBoard = (id: string) => { try { localStorage.setItem('amaavigo_tasks_board', `p:${id}`); } catch { /* private mode */ } taskNav.setSection('board'); };

  return (
    <div>
      <PageHeader icon={FolderKanban} title="Projects" subtitle="Shared boards for a team or the whole company. Everyone who can open a board sees its tasks."
        actions={canAny ? <button className={btnPrimary} onClick={() => setEditing('new')}><Plus className="w-4 h-4" />New project</button> : undefined} />
      {note && <div className="mb-3"><Notice tone={note.tone}>{note.text}</Notice></div>}
      {!data ? <Loading error={error} loading={loading} /> : data.items.length === 0 ? (
        <Card><EmptyState icon={FolderKanban} title="No projects yet" text={canAny ? 'Create one to plan work together on a board.' : 'Your managers or HR can create boards for your team.'} /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {data.items.map((p: any) => (
            <div key={p.id} className={`bg-white border border-slate-200 rounded-2xl p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${p.status === 'ARCHIVED' ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0" style={{ background: p.color || COLORS[0] }}><FolderKanban className="w-4 h-4" /></span>
                <div className="min-w-0 flex-1">
                  <button className="text-sm font-bold text-slate-900 hover:underline text-left" onClick={() => openBoard(p.id)}>{p.name}</button>
                  <div className="flex items-center gap-1.5 mt-0.5"><Pill tone={p.scope === 'COMPANY' ? 'blue' : 'slate'}>{p.scope === 'COMPANY' ? 'Whole company' : p.department}</Pill>{p.status === 'ARCHIVED' && <Pill>Archived</Pill>}</div>
                  {p.description && <p className="text-xs text-slate-500 mt-1.5 line-clamp-2">{p.description}</p>}
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 text-xs">
                <span className="text-slate-500">{p.open} open · {p.done} done{p.overdue ? <b className="text-rose-600"> · {p.overdue} overdue</b> : ''}</span>
                <span className="flex gap-1.5">
                  {p.status !== 'ARCHIVED' && <button className={btnGhost} onClick={() => newTask({ projectId: p.id })}><Plus className="w-3.5 h-3.5" />Task</button>}
                  {p.canEdit && <button className={btnGhost} aria-label="Edit project" onClick={() => setEditing(p)}><Pencil className="w-3.5 h-3.5" /></button>}
                  {p.canEdit && <button className={btnGhost} aria-label={p.status === 'ARCHIVED' ? 'Restore project' : 'Archive project'} onClick={() => run(async () => { await taskService.post('project-archive', { id: p.id, archived: p.status !== 'ARCHIVED' }); changed(); reload(); })}>{p.status === 'ARCHIVED' ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}</button>}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <ProjectForm project={editing === 'new' ? undefined : editing} canCompany={!!data?.canCreate.company} departments={depts} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); reload(); }} />}
    </div>
  );
};
