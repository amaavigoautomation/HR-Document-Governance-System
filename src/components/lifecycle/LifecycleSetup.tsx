import React, { useEffect, useState } from 'react';
import { lifecycleService } from '../../services/lifecycleService';
import { ASSIGNEE_LABEL, TASK_KIND_LABEL } from '../../../shared/lifecycleEngine';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

/** Onboarding task templates, no-dues departments, notice days and letter wording. */
export const LifecycleSetup: React.FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const [r, setR] = useState<any | null>(null);
  const [s, setS] = useState<any | null>(null);
  const [letterId, setLetterId] = useState('');
  const { busy, note, run } = useRunner();
  useEffect(() => { lifecycleService.settings().then((x) => { setR(x); setS(x.settings); setLetterId(x.settings.letters[0]?.id || ''); }).catch(() => undefined); }, []);
  if (!s) return <div className="text-sm text-slate-500">Loading…</div>;
  const set = (patch: any) => setS({ ...s, ...patch });
  const upd = (key: 'taskTemplates' | 'clearance' | 'letters', i: number, patch: any) => set({ [key]: s[key].map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
  const letter = s.letters.find((l: any) => l.id === letterId) || s.letters[0];
  const li = s.letters.indexOf(letter);

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {!r.saved && <Notice>These are starter settings. Edit what you need and save.</Notice>}
      <Card title="Joining checklist template" right={<button className={btnGhost} onClick={() => set({ taskTemplates: [...s.taskTemplates, { id: '', title: '', kind: 'GENERAL', assignee: 'HR', dueOffsetDays: 0, description: '' }] })}>Add task</button>}>
        <div className="space-y-2">
          {s.taskTemplates.map((t: any, i: number) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className={`${input} col-span-4`} placeholder="Task" value={t.title} onChange={(e) => upd('taskTemplates', i, { title: e.target.value })} />
              <select className={`${input} col-span-2`} value={t.kind} onChange={(e) => upd('taskTemplates', i, { kind: e.target.value })}>{Object.entries(TASK_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <select className={`${input} col-span-2`} value={t.assignee} onChange={(e) => upd('taskTemplates', i, { assignee: e.target.value })}>{Object.entries(ASSIGNEE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input type="number" className={`${input} col-span-2`} title="Days after joining (negative = before)" value={t.dueOffsetDays} onChange={(e) => upd('taskTemplates', i, { dueOffsetDays: Number(e.target.value) })} />
              <button className={`${btnDanger} col-span-1`} onClick={() => set({ taskTemplates: s.taskTemplates.filter((_: any, j: number) => j !== i) })}>×</button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-2">The number is the due date in days after joining (negative means before). The bank details task has to stay with the new joiner.</p>
        <div className="mt-3 max-w-xs"><Field label="Who gets IT / laptop tasks" hint="Empty: any HR lifecycle manager can do them"><select className={input} value={s.itOwnerUid} onChange={(e) => set({ itOwnerUid: e.target.value })}><option value="">Anyone in HR</option>{r.people.map((p: any) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field></div>
      </Card>

      <Card title="Exit: notice period and no-dues departments" right={<button className={btnGhost} onClick={() => set({ clearance: [...s.clearance, { id: '', label: '', ownerUid: '' }] })}>Add department</button>}>
        <div className="max-w-xs mb-3"><Field label="Standard notice period (days)"><input type="number" className={input} value={s.noticeDays} onChange={(e) => set({ noticeDays: Number(e.target.value) })} /></Field></div>
        <div className="space-y-2">
          {s.clearance.map((d: any, i: number) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input className={`${input} col-span-6`} placeholder="Department" value={d.label} onChange={(e) => upd('clearance', i, { label: e.target.value })} />
              <select className={`${input} col-span-5`} value={d.ownerUid} onChange={(e) => upd('clearance', i, { ownerUid: e.target.value })}>
                <option value="">HR clears it</option><option value="MANAGER">The person’s reporting manager</option>{r.people.map((p: any) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
              </select>
              <button className={`${btnDanger} col-span-1`} onClick={() => set({ clearance: s.clearance.filter((_: any, j: number) => j !== i) })}>×</button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Letter templates" right={<button className={btnGhost} onClick={() => { const id = `custom-${s.letters.length + 1}`; set({ letters: [...s.letters, { id, kind: 'CUSTOM', name: 'New letter', body: 'Date: {{date}}\n\nDear {{employee_name}},\n\n' }] }); setLetterId(id); }}>Add letter</button>}>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <Field label="Template"><select className={input} value={letter.id} onChange={(e) => setLetterId(e.target.value)}>{s.letters.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
          <Field label="Name"><input className={input} value={letter.name} onChange={(e) => upd('letters', li, { name: e.target.value })} /></Field>
          {s.letters.length > 1 && <button className={btnDanger} onClick={() => { const rest = s.letters.filter((_: any, j: number) => j !== li); set({ letters: rest }); setLetterId(rest[0].id); }}>Delete</button>}
        </div>
        <textarea className={`${input} font-mono text-xs leading-5`} rows={16} value={letter.body} onChange={(e) => upd('letters', li, { body: e.target.value })} />
        <p className="text-[11px] text-slate-500 mt-2">Merge fields: {r.catalog.map((c: any) => `{{${c.key}}}`).join('  ')}. Any other {'{{name}}'} you type becomes a blank to fill when issuing.</p>
      </Card>

      <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await lifecycleService.saveSettings(s); onSaved(); }, 'Saved.')}>Save settings</button>
    </div>
  );
};
