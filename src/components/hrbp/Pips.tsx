import React, { useState } from 'react';
import { hrbpService } from '../../services/hrbpService';
import { User } from '../../types';
import { Card, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';

const tone = (s: string) => (s === 'COMPLETED' ? 'green' : s === 'FAILED' ? 'red' : s === 'CANCELLED' ? 'slate' : s === 'DRAFT' ? 'blue' : 'amber') as 'green' | 'red' | 'slate' | 'blue' | 'amber';

/** Performance improvement plans: draft, start, check in, extend, close. */
export const Pips: React.FC<{ users: User[] }> = ({ users }) => {
  const list = useLoad(() => hrbpService.get('pip-list'), []);
  const { run, busy, note, setNote } = useRunner();
  const [f, setF] = useState({ employeeUid: '', startOn: '', endOn: '', reason: '', goals: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [act, setAct] = useState({ note: '', rating: '', endOn: '', done: [] as number[] });
  const items: any[] = list.data?.items || [];
  const staff = users.filter((u) => u.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const doAct = (id: string, action: string, extra: Record<string, unknown> = {}) => run(async () => {
    try {
      await hrbpService.post('pip-act', { id, action, note: act.note, rating: act.rating, endOn: act.endOn, goalsDone: act.done, ...extra });
      setAct({ note: '', rating: '', endOn: '', done: [] });
      await list.reload();
    } catch (e: any) {
      if (/Confirm to complete/i.test(e?.message || '')) { setNote({ tone: 'error', text: 'Some goals are not marked done. Press "Complete anyway" to confirm.' }); return; }
      throw e;
    }
  }, 'Done.');

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-3 lg:col-span-3">
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <Loading error={list.error} loading={list.loading} />
        {!list.loading && items.length === 0 && <EmptyState title="No improvement plans" text="Plans are a structured, supportive way to help someone get back on track." />}
        {items.map((p) => (
          <Card key={p.id} title={p.employeeName} subtitle={`${p.startOn} to ${p.endOn} - ${p.goals.filter((g: any) => g.done).length}/${p.goals.length} goals done`} right={<Pill tone={tone(p.status)}>{p.status.toLowerCase()}</Pill>}>
            <p className="text-xs text-slate-600">{p.reason}</p>
            <button className={`${btnGhost} mt-2`} onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Hide' : 'Open'}</button>
            {open === p.id && (
              <div className="mt-3 space-y-3 text-xs">
                <div>{p.goals.map((g: any, i: number) => (
                  <label key={i} className="flex items-center gap-2 py-0.5">
                    {['ACTIVE', 'EXTENDED'].includes(p.status) ? <input type="checkbox" checked={g.done || act.done.includes(i)} disabled={g.done} onChange={(e) => setAct({ ...act, done: e.target.checked ? [...act.done, i] : act.done.filter((x) => x !== i) })} /> : <span>{g.done ? 'Done' : 'Open'}</span>}
                    <span className={g.done ? 'text-slate-400 line-through' : 'text-slate-800'}>{g.text}{g.dueOn ? ` (by ${g.dueOn})` : ''}</span>
                  </label>
                ))}</div>
                {p.checkins.length > 0 && <div className="rounded-lg bg-slate-50 p-2">{p.checkins.map((k: any, i: number) => <div key={i} className="py-0.5"><strong>{new Date(k.at).toLocaleDateString('en-IN')}</strong> ({k.by}){k.rating ? ` - ${k.rating}/5` : ''}: {k.note}</div>)}</div>}
                {!['COMPLETED', 'FAILED', 'CANCELLED'].includes(p.status) && (
                  <div className="space-y-2">
                    <Field label="Note (needed for every action except start)"><textarea className={input} rows={2} value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} /></Field>
                    <div className="grid gap-2 md:grid-cols-2">
                      <Field label="Check-in rating (1-5)"><input className={input} type="number" min={1} max={5} value={act.rating} onChange={(e) => setAct({ ...act, rating: e.target.value })} /></Field>
                      <Field label="New end date (to extend)"><input className={input} type="date" value={act.endOn} onChange={(e) => setAct({ ...act, endOn: e.target.value })} /></Field>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {p.status === 'DRAFT' ? <button className={btnPrimary} disabled={busy} onClick={() => doAct(p.id, 'start')}>Start plan and notify</button> : (
                        <>
                          <button className={btnPrimary} disabled={busy} onClick={() => doAct(p.id, 'checkin')}>Record check-in</button>
                          <button className={btnGhost} disabled={busy} onClick={() => doAct(p.id, 'extend')}>Extend</button>
                          <button className={btnGhost} disabled={busy} onClick={() => doAct(p.id, 'complete')}>Complete</button>
                          <button className={btnGhost} disabled={busy} onClick={() => doAct(p.id, 'complete', { confirmIncomplete: true })}>Complete anyway</button>
                          <button className={btnGhost} disabled={busy} onClick={() => doAct(p.id, 'fail')}>Not successful</button>
                        </>
                      )}
                      <button className={btnGhost} disabled={busy} onClick={() => doAct(p.id, 'cancel')}>Cancel plan</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
      <div className="lg:col-span-2">
        <Card title="New plan (saved as a draft)">
          <div className="space-y-3">
            <Field label="Employee"><select className={input} value={f.employeeUid} onChange={(e) => setF({ ...f, employeeUid: e.target.value })}><option value="">Choose</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <div className="grid gap-3 md:grid-cols-2"><Field label="Start"><input className={input} type="date" value={f.startOn} onChange={(e) => setF({ ...f, startOn: e.target.value })} /></Field><Field label="End"><input className={input} type="date" value={f.endOn} onChange={(e) => setF({ ...f, endOn: e.target.value })} /></Field></div>
            <Field label="What is the performance gap?"><textarea className={input} rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <Field label="Goals" hint="One measurable goal per line. Add a due date after a | sign, like: Close 10 tickets a week | 2026-12-01"><textarea className={input} rows={4} value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await hrbpService.post('pip-save', { ...f, goals: f.goals.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [text, dueOn] = l.split('|').map((x) => x.trim()); return { text, dueOn }; }) }); setF({ employeeUid: '', startOn: '', endOn: '', reason: '', goals: '' }); await list.reload(); }, 'Draft saved. Open it to start the plan.')}>Save draft</button>
          </div>
        </Card>
      </div>
    </div>
  );
};
