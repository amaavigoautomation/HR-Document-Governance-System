import React, { useState } from 'react';
import { hrbpService } from '../../services/hrbpService';
import { User } from '../../types';
import { Card, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';

/** My HRBP, my improvement plan (if any), my certificates and training needs. */
export const MyHrbp: React.FC = () => {
  const me = useLoad(() => hrbpService.get('me'), []);
  const x = me.data;
  return (
    <div className="space-y-4">
      <Loading error={me.error} loading={me.loading} />
      {x && (
        <>
          <Card title="Your HR business partner">{x.myHrbp ? <div className="text-sm text-slate-700">{x.myHrbp}{x.mapping?.businessUnit ? ` - ${x.mapping.businessUnit}` : ''}</div> : <div className="text-sm text-slate-500">Not assigned yet.</div>}</Card>
          {x.pip && (
            <Card title="Your improvement plan" subtitle={`${x.pip.startOn} to ${x.pip.endOn}`}>
              <p className="text-xs text-slate-600">{x.pip.reason}</p>
              <ul className="mt-2 space-y-1 text-xs">{x.pip.goals.map((g: any, i: number) => <li key={i} className={g.done ? 'text-slate-400 line-through' : 'text-slate-800'}>{g.text}{g.dueOn ? ` (by ${g.dueOn})` : ''}</li>)}</ul>
              {x.pip.checkins.length > 0 && <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">{x.pip.checkins.map((k: any, i: number) => <div key={i}>{new Date(k.at).toLocaleDateString('en-IN')}: {k.note}</div>)}</div>}
            </Card>
          )}
          <Card title="My certificates and compliance">
            {x.certs.length === 0 && <div className="text-xs text-slate-500">None recorded.</div>}
            {x.certs.map((c: any) => <div key={c.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-xs"><span className="font-semibold text-slate-800">{c.name}{c.expiresOn ? ` - expires ${c.expiresOn}` : ''}</span><Pill tone={c.status === 'EXPIRED' ? 'red' : c.status === 'EXPIRING' ? 'amber' : 'green'}>{c.status.replace('_', ' ').toLowerCase()}</Pill></div>)}
          </Card>
          <Card title="My development needs">
            {x.needs.length === 0 && <div className="text-xs text-slate-500">None recorded.</div>}
            {x.needs.map((n: any) => <div key={n.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-xs"><span className="font-semibold text-slate-800">{n.skill}</span><Pill tone={n.status === 'DONE' ? 'green' : 'blue'}>{n.status.toLowerCase()}</Pill></div>)}
          </Card>
        </>
      )}
    </div>
  );
};

/** Learning paths assigned to me, with a tick-box per step. HR sees everyone's. */
export const MyLearning: React.FC = () => {
  const l = useLoad(() => hrbpService.get('assign-list'), []);
  const { run, note } = useRunner();
  const items: any[] = l.data?.items || [];
  return (
    <div className="space-y-3">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Loading error={l.error} loading={l.loading} />
      {!l.loading && items.length === 0 && <EmptyState title="No learning paths assigned" />}
      {items.map((a) => (
        <Card key={a.id} title={a.pathName} subtitle={a.employeeName ? `${a.employeeName}${a.dueOn ? ` - due ${a.dueOn}` : ''}` : a.dueOn ? `Due ${a.dueOn}` : undefined} right={<Pill tone={a.percent === 100 ? 'green' : 'blue'}>{a.percent}%</Pill>}>
          {a.steps.map((s: any, i: number) => (
            <label key={i} className="flex items-center gap-2 py-1 text-xs">
              <input type="checkbox" checked={(a.done || []).includes(i)} onChange={(e) => run(async () => { await hrbpService.post('path-progress', { id: a.id, step: i, done: e.target.checked }); await l.reload(); })} />
              <span className="text-slate-800">{s.title}</span><span className="text-slate-400">{s.type.toLowerCase()}{s.hours ? ` - ${s.hours}h` : ''}</span>
            </label>
          ))}
        </Card>
      ))}
    </div>
  );
};

/** A feed of peer recognition and a form to recognise a colleague. */
export const Recognition: React.FC<{ users: User[]; me: User }> = ({ users, me }) => {
  const feed = useLoad(() => hrbpService.get('recog-list'), []);
  const [f, setF] = useState({ toUid: '', value: 'Teamwork', message: '' });
  const { run, busy, note } = useRunner();
  const staff = users.filter((u) => u.active !== false && u.id !== me.id).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-2 lg:col-span-3">
        <Loading error={feed.error} loading={feed.loading} />
        {!feed.loading && (feed.data?.items || []).length === 0 && <EmptyState title="No recognition yet" text="Be the first to thank a colleague." />}
        {(feed.data?.items || []).map((r: any) => (
          <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <div className="flex items-center justify-between"><span className="font-bold text-slate-800">{r.fromName} recognised {r.toName}</span><Pill tone="blue">{r.value}</Pill></div>
            <p className="mt-1 text-slate-600">{r.message}</p>
          </div>
        ))}
      </div>
      <div className="lg:col-span-2">
        <Card title="Recognise a colleague" subtitle="Up to five a day.">
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
          <div className="space-y-3">
            <Field label="Who?"><select className={input} value={f.toUid} onChange={(e) => setF({ ...f, toUid: e.target.value })}><option value="">Choose a colleague</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
            <Field label="For which value?"><select className={input} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })}>{(feed.data?.values || ['Teamwork']).map((v: string) => <option key={v}>{v}</option>)}</select></Field>
            <Field label="What did they do?"><textarea className={input} rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
            <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await hrbpService.post('recog-give', f); setF({ ...f, message: '' }); await feed.reload(); }, 'Sent. They have been emailed.')}>Send recognition</button>
          </div>
        </Card>
      </div>
    </div>
  );
};

/** Wellness programs: join or leave. HR manages them from the Wellness section. */
export const WellnessList: React.FC = () => {
  const w = useLoad(() => hrbpService.get('well-list'), []);
  const { run } = useRunner();
  const items: any[] = (w.data?.items || []).filter((i: any) => i.active);
  return (
    <div className="space-y-3">
      <Loading error={w.error} loading={w.loading} />
      {!w.loading && items.length === 0 && <EmptyState title="No wellness programs right now" />}
      {items.map((i) => (
        <Card key={i.id} title={i.title} subtitle={`${i.type.toLowerCase()}${i.date ? ` - ${i.date}` : ''} - ${i.participantCount} joined`} right={<button className={i.joined ? btnGhost : btnPrimary} onClick={() => run(async () => { await hrbpService.post('well-join', { id: i.id, leave: i.joined }); await w.reload(); })}>{i.joined ? 'Leave' : 'Join'}</button>}>
          <p className="text-xs text-slate-600">{i.description}</p>
        </Card>
      ))}
    </div>
  );
};
