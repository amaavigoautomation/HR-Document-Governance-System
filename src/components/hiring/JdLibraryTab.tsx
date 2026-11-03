import React, { useState } from 'react';
import { pipelineService } from '../../services/pipelineService';
import { Card, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, useLoad } from '../common/loadUi';

const blank = { id: '', title: '', department: '', skills: '', text: '' };

/** Reusable job descriptions. A template can be copied into any new requisition's JD. */
export const JdLibraryTab: React.FC = () => {
  const list = useLoad(() => pipelineService.jdLib(), []);
  const [f, setF] = useState(blank);
  const { run, busy, note } = useRunner();
  const items: any[] = list.data?.items || [];
  const edit = (t: any) => setF({ id: t.id, title: t.title, department: t.department || '', skills: (t.skills || []).join(', '), text: t.text });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Templates" subtitle="Save a good job description once and reuse it.">
        <Loading error={list.error} loading={list.loading} />
        {!list.loading && items.length === 0 && <EmptyState title="No templates yet" text="Write one on the right, or save a JD from a requisition." />}
        <div className="divide-y divide-slate-100">
          {items.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <div className="min-w-0"><div className="font-bold text-slate-800">{t.title}</div><div className="text-slate-500">{t.department || 'Any department'} - version {t.version}</div></div>
              <div className="flex gap-2">
                <button className={btnGhost} onClick={() => navigator.clipboard?.writeText(t.text)}>Copy</button>
                <button className={btnGhost} onClick={() => edit(t)}>Edit</button>
                <button className={btnGhost} onClick={() => run(async () => { await pipelineService.jdLibDelete(t.id); await list.reload(); })}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title={f.id ? 'Edit template' : 'New template'}>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <div className="space-y-3">
          <Field label="Title"><input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Department (optional)"><input className={input} value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
            <Field label="Key skills (comma separated)"><input className={input} value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} /></Field>
          </div>
          <Field label="Job description"><textarea className={input} rows={12} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pipelineService.jdLibSave(f); setF(blank); await list.reload(); }, 'Template saved.')}>Save template</button>
            {f.id && <button className={btnGhost} onClick={() => setF(blank)}>New</button>}
          </div>
        </div>
      </Card>
    </div>
  );
};
