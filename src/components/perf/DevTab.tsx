import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, EmptyState, Field, Notice, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';
import { GraduationCap } from 'lucide-react';
import { Loading, Pill, useLoad } from './shared';

const OUTCOMES: Record<string, string> = { DEVELOPMENT: 'Development opportunity', IMPROVEMENT: 'Performance improvement', RECOGNITION: 'Strong performance' };

/** My check-ins (add a note), my development plans, my messages. */
export const DevTab: React.FC = () => {
  const ci = useLoad(() => perfService.checkins('me'), []);
  const dp = useLoad(() => perfService.devPlans('me'), []);
  const nt = useLoad(() => perfService.notifications(), []);
  const { busy, run } = useRunner();
  const [note, setNote] = useState<Record<string, string>>({});
  return (
    <div className="space-y-4">
      <Card title="My monthly check-ins" subtitle="Add your own note before the check-in: what went well, what is blocking you.">
        <Loading error={ci.error} loading={ci.loading} />
        {!ci.loading && (ci.data?.items || []).length === 0 && <EmptyState icon={GraduationCap} title="No check-ins yet" text="Your manager's monthly check-ins will show up here." />}
        <ul className="divide-y divide-slate-100">{(ci.data?.items || []).slice(0, 12).map((c: any) => (
          <li key={c.id} className="py-2.5 text-sm space-y-1.5">
            <div className="flex items-center justify-between"><span className="font-semibold text-slate-800">{c.month}</span><span className={`text-[11px] font-bold ${c.status === 'DONE' ? 'text-emerald-600' : 'text-amber-600'}`}>{c.status === 'DONE' ? 'done' : 'pending'}</span></div>
            {c.status === 'DONE' && <div className="text-slate-600 text-xs space-y-0.5">{c.progress && <p><strong>Progress:</strong> {c.progress}</p>}{c.roadblocks && <p><strong>Roadblocks:</strong> {c.roadblocks}</p>}{c.feedback && <p><strong>Feedback:</strong> {c.feedback}</p>}</div>}
            <div className="flex gap-2"><input className={input} placeholder="My note" value={note[c.id] ?? c.employeeNote} onChange={(e) => setNote({ ...note, [c.id]: e.target.value })} />
              <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await perfService.saveCheckin({ month: c.month, employeeNote: note[c.id] ?? c.employeeNote }); await ci.reload(); }, 'Saved.')}>Save</button></div>
          </li>))}</ul>
      </Card>
      <Card title="My development plans">
        <Loading error={dp.error} loading={dp.loading} />
        {!dp.loading && (dp.data?.items || []).length === 0 && <p className="text-sm text-slate-500">None. Plans appear here after a review if you and your manager agree on support or goals.</p>}
        {(dp.data?.items || []).map((d: any) => (
          <div key={d.id} className="border border-slate-200 rounded-lg p-3 mb-2 space-y-1.5">
            <div className="flex items-center justify-between"><p className="text-sm font-bold text-slate-800">{OUTCOMES[d.outcome]}</p><Pill tone={d.status === 'ACTIVE' ? 'amber' : 'green'}>{d.status.toLowerCase()}</Pill></div>
            {d.performanceGap && <p className="text-xs text-slate-600"><strong>Gap:</strong> {d.performanceGap}</p>}
            {d.expectedStandard && <p className="text-xs text-slate-600"><strong>Expected standard:</strong> {d.expectedStandard}</p>}
            {d.supportProvided && <p className="text-xs text-slate-600"><strong>Support:</strong> {d.supportProvided}</p>}
            <ul className="text-sm">{d.actions.map((a: any) => (
              <li key={a.id} className="flex items-center gap-2"><input type="checkbox" checked={a.done} onChange={(e) => run(async () => { await perfService.updateDevPlan({ id: d.id, actionId: a.id, done: e.target.checked }); await dp.reload(); })} /><span className={a.done ? 'line-through text-slate-400' : ''}>{a.text}</span>{a.dueDate && <span className="text-xs text-slate-400">by {niceDate(a.dueDate)}</span>}</li>))}</ul>
            {d.reviewDate && <p className="text-[11px] text-slate-400">Review date {niceDate(d.reviewDate)}</p>}
          </div>))}
      </Card>
      <Card title="Messages" right={<button className={btnGhost} onClick={() => run(async () => { await perfService.readNotifications(); await nt.reload(); })}>Mark all read</button>}>
        <Loading error={nt.error} loading={nt.loading} />
        <ul className="divide-y divide-slate-100 text-sm">{(nt.data?.items || []).slice(0, 20).map((n: any) => (
          <li key={n.id} className={`py-2 ${n.read ? 'text-slate-500' : 'text-slate-800'}`}><p className="font-semibold">{n.title}</p><p className="text-xs">{n.body}</p></li>))}</ul>
      </Card>
    </div>
  );
};

/** Manager / HR: development plans for the team. */
export const TeamDev: React.FC<{ scope: 'team' | 'all'; reviews: any[] }> = ({ scope, reviews }) => {
  const dp = useLoad(() => perfService.devPlans(scope), [scope]);
  const { busy, note, run } = useRunner();
  const [f, setF] = useState<any>({ reviewId: '', outcome: 'DEVELOPMENT', performanceGap: '', expectedStandard: '', supportProvided: '', reviewDate: '', actions: '' });
  const done = reviews.filter((r) => ['PUBLISHED', 'ACKNOWLEDGED', 'CLOSED', 'DISPUTED'].includes(r.status));
  return (
    <Card title="Development & improvement plans" subtitle="Only after a published review. A score never starts a plan by itself, and a plan is not a disciplinary step.">
      <Loading error={dp.error} loading={dp.loading} />
      <ul className="divide-y divide-slate-100 text-sm mb-3">{(dp.data?.items || []).map((d: any) => <li key={d.id} className="py-2"><span className="font-semibold">{d.employeeName}</span> · {OUTCOMES[d.outcome]} · {d.status.toLowerCase()} · {d.actions.filter((a: any) => a.done).length}/{d.actions.length} actions</li>)}</ul>
      <p className="text-xs font-bold text-slate-600 mb-1">New plan</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="Review"><select className={input} value={f.reviewId} onChange={(e) => setF({ ...f, reviewId: e.target.value })}><option value="">Choose…</option>{done.map((r) => <option key={r.id} value={r.id}>{r.employeeName} · {r.cycleName}{r.overall ? ` (${r.overall})` : ''}</option>)}</select></Field>
        <Field label="Type"><select className={input} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })}>{Object.entries(OUTCOMES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 mt-2">
        <Field label="Performance gap / opportunity"><textarea className={input} rows={2} value={f.performanceGap} onChange={(e) => setF({ ...f, performanceGap: e.target.value })} /></Field>
        <Field label="Expected standard"><textarea className={input} rows={2} value={f.expectedStandard} onChange={(e) => setF({ ...f, expectedStandard: e.target.value })} /></Field>
        <Field label="Support provided"><textarea className={input} rows={2} value={f.supportProvided} onChange={(e) => setF({ ...f, supportProvided: e.target.value })} /></Field>
        <Field label="Review date"><input type="date" className={input} value={f.reviewDate} onChange={(e) => setF({ ...f, reviewDate: e.target.value })} /></Field>
      </div>
      <Field label="Actions (one per line)"><textarea className={input} rows={3} value={f.actions} onChange={(e) => setF({ ...f, actions: e.target.value })} /></Field>
      {note && <div className="mt-2"><Notice tone={note.tone}>{note.text}</Notice></div>}
      <div className="mt-2"><button className={btnPrimary} disabled={busy || !f.reviewId} onClick={() => run(async () => { await perfService.saveDevPlan({ ...f, actions: f.actions.split('\n').map((t: string) => ({ text: t })).filter((a: any) => a.text.trim()) }); setF({ ...f, performanceGap: '', expectedStandard: '', supportProvided: '', actions: '' }); await dp.reload(); }, 'Plan saved and shared.')}>Save plan</button></div>
    </Card>
  );
};
