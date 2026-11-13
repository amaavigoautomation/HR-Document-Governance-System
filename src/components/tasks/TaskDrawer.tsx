import React, { useRef, useState } from 'react';
import { Download, Paperclip, Pencil, Send, Target, Trash2, X } from 'lucide-react';
import { STATUSES, progressOf } from '../../../shared/taskEngine';
import { taskService } from '../../services/taskService';
import { Loading, useLoad } from '../common/loadUi';
import { ConfirmButton, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Avatar, DueLabel, PriorityFlag, Sheet, StatusChip, fileSize, useTasks, when, STATUS_LOOK, type Task } from './common';
import { TaskForm } from './TaskForm';

const EVIDENCE: Record<string, string> = { VERIFIED: 'Counted in Performance (verified)', PENDING: 'Added to Performance, waiting for the manager to verify', REJECTED: 'Not counted in Performance' };

export const TaskDrawer: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const { meta, changed, version } = useTasks();
  const { data: d, error, loading, reload } = useLoad(() => taskService.get('get', { id }), [id, version]);
  const { busy, note, setNote, run } = useRunner();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState<string>('');
  const [why, setWhy] = useState('');
  const [text, setText] = useState('');
  const file = useRef<HTMLInputElement>(null);

  if (!d) return <Sheet onClose={onClose} title="Task" wide><Loading error={error} loading={loading} /></Sheet>;
  const t: Task = d.item; const can = d.can; const p = progressOf(t);
  const done = () => { changed(); return reload(); };

  const move = (status: string, needsNote: boolean) => {
    if (needsNote && asking !== status) { setAsking(status); return; }
    run(async () => { const r = await taskService.post('move', { id, status, note: why }); setAsking(''); setWhy(''); if (r.message) setNote({ tone: 'ok', text: r.message }); await done(); });
  };
  const open = (attId: string) => run(async () => { const r = await taskService.get('attach-link', { id, attId }); window.open(r.url, '_blank', 'noopener'); });

  const moves = STATUSES.filter((s) => s.key !== t.status && can.moves[s.key]?.ok);
  const blocked = STATUSES.find((s) => s.key !== t.status && !can.moves[s.key]?.ok && s.key === 'DONE' && t.requiresReview);

  return (
    <>
      <Sheet onClose={onClose} wide title={<span className="flex items-center gap-2"><StatusChip status={t.status} /><span className="truncate">{t.title}</span></span>}
        right={<>
          {can.edit && <button className={btnGhost} onClick={() => setEditing(true)}><Pencil className="w-3.5 h-3.5" />Edit</button>}
          {can.delete && <ConfirmButton question="Delete this task?" yes="Delete" onConfirm={() => run(async () => { await taskService.post('delete', { id }); changed(); onClose(); })}><Trash2 className="w-3.5 h-3.5" />Delete</ConfirmButton>}
        </>}>
        <div className="space-y-5">
          {note && <Notice tone={note.tone}>{note.text}</Notice>}

          {(moves.length > 0 || blocked) && (
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500 mr-1">Move to</span>
                {moves.map((s) => (
                  <button key={s.key} disabled={busy} onClick={() => move(s.key, !!can.moves[s.key].needsNote)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold hover:bg-slate-50 disabled:opacity-50 ${asking === s.key ? 'border-[#6d4cf0] bg-violet-50' : 'border-slate-300 bg-white'}`}>
                    <span className={`w-2 h-2 rounded-full ${STATUS_LOOK[s.key].dot}`} />{s.key === 'DONE' && t.requiresReview && t.status === 'IN_REVIEW' ? 'Approve and finish' : s.label}
                  </button>
                ))}
              </div>
              {asking && (
                <div className="mt-2 space-y-2">
                  <Field label="What needs to change?"><textarea autoFocus className={`${input} min-h-[64px]`} maxLength={1000} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="So the person knows what to fix" /></Field>
                  <div className="flex gap-2"><button className={btnPrimary} disabled={busy || why.trim().length < 3} onClick={() => move(asking, true)}>Send back</button><button className={btnGhost} onClick={() => { setAsking(''); setWhy(''); }}>Cancel</button></div>
                </div>
              )}
              {t.requiresReview && t.status !== 'IN_REVIEW' && t.status !== 'DONE' && <p className="text-xs text-slate-500 mt-1.5">This task is reviewed by {t.reviewerName || 'its reviewer'} before it counts as done.</p>}
              {t.status === 'IN_REVIEW' && t.reviewerUid !== meta.me.uid && <p className="text-xs text-slate-500 mt-1.5">Waiting for {t.reviewerName || 'the reviewer'}.</p>}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-xs font-semibold text-slate-500">Assigned to</dt><dd className="flex items-center gap-2 mt-0.5"><Avatar name={t.assigneeName} />{t.assigneeName}</dd></div>
            <div><dt className="text-xs font-semibold text-slate-500">Given by</dt><dd className="flex items-center gap-2 mt-0.5"><Avatar name={t.creatorName} />{t.creatorName}</dd></div>
            <div><dt className="text-xs font-semibold text-slate-500">Due</dt><dd className="mt-0.5"><DueLabel task={t} />{t.startDate && <span className="text-[11px] text-slate-400 ml-2">from {t.startDate}</span>}</dd></div>
            <div><dt className="text-xs font-semibold text-slate-500">Priority</dt><dd className="mt-0.5"><PriorityFlag priority={t.priority} label /></dd></div>
            {t.requiresReview && <div><dt className="text-xs font-semibold text-slate-500">Reviewer</dt><dd className="flex items-center gap-2 mt-0.5"><Avatar name={t.reviewerName || '?'} />{t.reviewerName}</dd></div>}
            {t.projectName && <div><dt className="text-xs font-semibold text-slate-500">Board</dt><dd className="mt-0.5">{t.projectName}</dd></div>}
          </dl>

          {t.kpi && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900 flex items-start gap-2">
              <Target className="w-4 h-4 mt-0.5 shrink-0" />
              <span><b>Counts towards KPI:</b> {t.kpi.kpiName}.{' '}{t.evidenceStatus ? EVIDENCE[t.evidenceStatus] : 'Once it is reviewed and finished, it is added as work evidence for this KPI.'}</span>
            </div>
          )}
          {t.tags.length > 0 && <div className="flex flex-wrap gap-1">{t.tags.map((x) => <span key={x} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">#{x}</span>)}</div>}
          {t.description && <p className="text-sm text-slate-700 whitespace-pre-wrap">{t.description}</p>}

          {t.checklist.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-1.5"><h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Checklist</h3><span className="text-xs text-slate-500">{p.done} of {p.total}</span></div>
              <div className="h-1.5 rounded-full bg-slate-100 mb-2 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></div>
              <ul className="space-y-1">
                {t.checklist.map((c) => (
                  <li key={c.id}><label className={`flex items-start gap-2 text-sm ${can.check ? 'cursor-pointer' : ''}`}>
                    <input type="checkbox" className="mt-1" checked={c.done} disabled={!can.check || busy} onChange={(e) => run(async () => { await taskService.post('check', { id, itemId: c.id, done: e.target.checked }); await done(); })} />
                    <span className={c.done ? 'line-through text-slate-400' : 'text-slate-700'}>{c.text}</span>
                  </label></li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Files</h3>
              {can.attach && (
                <>
                  <input ref={file} type="file" hidden accept={meta.storage.allowed.map((x) => `.${x}`).join(',')}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(async () => { await taskService.attach(id, f); await done(); }, 'File attached.'); }} />
                  <button className={btnGhost} disabled={busy || !meta.storage.enabled} onClick={() => file.current?.click()}><Paperclip className="w-3.5 h-3.5" />Attach a file</button>
                </>
              )}
            </div>
            {!meta.storage.enabled && can.attach && <p className="text-xs text-slate-500 mb-1.5">File attachments are not set up yet. Ask your admin to add the Cloudinary keys.</p>}
            {t.attachments.length === 0 ? <p className="text-xs text-slate-400">No files.</p> : (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {t.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="flex-1 min-w-0"><span className="block truncate font-medium text-slate-800">{a.name}</span><span className="text-[11px] text-slate-400">{fileSize(a.bytes)} · {a.byName} · {when(a.at)}</span></span>
                    <button className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" aria-label={`Download ${a.name}`} onClick={() => open(a.id)}><Download className="w-4 h-4" /></button>
                    {can.attach && <button className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600" aria-label={`Remove ${a.name}`} onClick={() => run(async () => { await taskService.post('attach-remove', { id, attId: a.id }); await done(); })}><X className="w-4 h-4" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Comments and activity</h3>
            <ul className="space-y-2.5">
              {d.log.map((l: any) => l.kind === 'COMMENT' ? (
                <li key={l.id} className="flex gap-2.5"><Avatar name={l.byName} /><div className="flex-1 min-w-0 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2"><div className="text-[11px] text-slate-500"><b className="text-slate-700">{l.byName}</b> · {when(l.at)}</div><p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{l.detail}</p></div></li>
              ) : (
                <li key={l.id} className="text-[11px] text-slate-400 pl-8"><b className="font-semibold text-slate-500">{l.byName}</b> {activity(l)} · {when(l.at)}</li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <input className={input} value={text} maxLength={2000} placeholder="Write a comment" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) run(async () => { await taskService.post('comment', { id, text }); setText(''); await reload(); }); }} />
              <button className={btnPrimary} disabled={busy || !text.trim()} aria-label="Send comment" onClick={() => run(async () => { await taskService.post('comment', { id, text }); setText(''); await reload(); })}><Send className="w-3.5 h-3.5" /></button>
            </div>
          </section>
        </div>
      </Sheet>
      {editing && <TaskForm task={t} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); changed(); reload(); }} />}
    </>
  );
};

const activity = (l: any) => ({ CREATED: l.detail.toLowerCase(), MOVED: `moved it: ${l.detail}`, EDITED: `changed ${l.detail}`, ATTACHED: `attached ${l.detail}`, DETACHED: `removed ${l.detail}` } as Record<string, string>)[l.action] || l.action.toLowerCase();
