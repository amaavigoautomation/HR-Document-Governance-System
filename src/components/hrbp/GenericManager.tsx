import React, { useState } from 'react';
import { hrbpService } from '../../services/hrbpService';
import { User } from '../../types';
import { Card, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';

export type FieldSpec =
  | { key: string; label: string; type: 'text' | 'number' | 'date' | 'textarea' | 'checkbox'; hint?: string; wide?: boolean }
  | { key: string; label: string; type: 'select'; options: string[] | { value: string; label: string }[]; wide?: boolean }
  | { key: string; label: string; type: 'person'; wide?: boolean }
  /** One item per line. `parse` turns the text into what the server expects; `format` does the reverse. */
  | { key: string; label: string; type: 'lines'; hint?: string; parse: (t: string) => unknown; format: (v: any) => string; wide?: boolean };

interface Props {
  title: string;
  subtitle?: string;
  prefix: string;
  users: User[];
  fields: FieldSpec[];
  /** How a stored record is shown in the list. */
  row: (it: any) => { title: string; sub?: string; pill?: { text: string; tone?: 'green' | 'amber' | 'red' | 'blue' | 'slate' } };
  /** Starting values for a new record. */
  blank?: Record<string, any>;
  /** The record key that holds the employee, used to open "edit" with the right person. */
  listParams?: Record<string, string>;
  allowDelete?: boolean;
}

const personValue = (users: User[], it: any, key: string) => users.find((u) => u.authUid === it[key] || u.id === it[key])?.id || it[key] || '';

/** A list plus a form, driven by a field list. Used for the simple HRBP records (mapping, KPIs, certificates, training needs ...). */
export const GenericManager: React.FC<Props> = ({ title, subtitle, prefix, users, fields, row, blank = {}, listParams, allowDelete = true }) => {
  const list = useLoad(() => hrbpService.get(`${prefix}-list`, listParams), [prefix]);
  const [f, setF] = useState<Record<string, any>>(blank);
  const [editing, setEditing] = useState<string>('');
  const { run, busy, note } = useRunner();
  const items: any[] = list.data?.items || [];
  const staff = users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));

  const edit = (it: any) => {
    const v: Record<string, any> = {};
    for (const fl of fields) v[fl.key] = fl.type === 'person' ? personValue(users, it, fl.key) : fl.type === 'lines' ? fl.format(it[fl.key]) : it[fl.key] ?? '';
    setF(v);
    setEditing(it.id);
  };
  const reset = () => { setF(blank); setEditing(''); };
  const save = () => run(async () => {
    const body: Record<string, any> = { ...f, id: editing || undefined };
    for (const fl of fields) if (fl.type === 'lines') body[fl.key] = fl.parse(String(f[fl.key] || ''));
    await hrbpService.post(`${prefix}-save`, body);
    reset();
    await list.reload();
  }, 'Saved.');

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <Card title={title} subtitle={subtitle}>
          <Loading error={list.error} loading={list.loading} />
          {!list.loading && items.length === 0 && <EmptyState title="Nothing here yet" text="Add the first one using the form." />}
          <div className="divide-y divide-slate-100">
            {items.map((it) => {
              const r = row(it);
              return (
                <div key={it.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                  <div className="min-w-0"><div className="font-bold text-slate-800">{r.title}</div>{r.sub && <div className="text-slate-500">{r.sub}</div>}</div>
                  <div className="flex items-center gap-2">
                    {r.pill && <Pill tone={r.pill.tone}>{r.pill.text}</Pill>}
                    <button className={btnGhost} onClick={() => edit(it)}>Edit</button>
                    {allowDelete && <button className={btnGhost} onClick={() => run(async () => { await hrbpService.post(`${prefix}-delete`, { id: it.id }); await list.reload(); })}>Delete</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div className="lg:col-span-2">
        <Card title={editing ? 'Edit' : 'Add'}>
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
          <div className="space-y-3">
            {fields.map((fl) => (
              <Field key={fl.key} label={fl.label} hint={'hint' in fl ? fl.hint : undefined}>
                {fl.type === 'textarea' ? <textarea className={input} rows={3} value={f[fl.key] ?? ''} onChange={(e) => setF({ ...f, [fl.key]: e.target.value })} />
                  : fl.type === 'lines' ? <textarea className={input} rows={4} value={f[fl.key] ?? ''} onChange={(e) => setF({ ...f, [fl.key]: e.target.value })} />
                  : fl.type === 'checkbox' ? <input type="checkbox" checked={!!f[fl.key]} onChange={(e) => setF({ ...f, [fl.key]: e.target.checked })} />
                  : fl.type === 'select' ? (
                    <select className={input} value={f[fl.key] ?? ''} onChange={(e) => setF({ ...f, [fl.key]: e.target.value })}>
                      <option value="">Choose</option>
                      {fl.options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : fl.type === 'person' ? (
                    <select className={input} value={f[fl.key] ?? ''} onChange={(e) => setF({ ...f, [fl.key]: e.target.value })}>
                      <option value="">Choose a person</option>
                      {staff.map((u) => <option key={u.id} value={u.id}>{u.name}{u.departmentName ? ` - ${u.departmentName}` : ''}</option>)}
                    </select>
                  ) : <input className={input} type={fl.type} value={f[fl.key] ?? ''} onChange={(e) => setF({ ...f, [fl.key]: e.target.value })} />}
              </Field>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button className={btnPrimary} disabled={busy} onClick={save}>Save</button>
            {editing && <button className={btnGhost} onClick={reset}>Cancel edit</button>}
          </div>
        </Card>
      </div>
    </div>
  );
};
