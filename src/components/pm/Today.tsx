import React, { useState } from 'react';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { pmNav } from './pmNav';
import { Loading, Pill } from '../common/loadUi';
import { Card, Notice, btnBig, btnGhost, btnPrimary, input, useRunner, Field } from '../leave/ui';
import { Empty, Explain, Intro, ResultNote, StatusChip, Note } from './common';

/** The first screen: a plain to-do list. If it is empty, there is nothing to do. */
export const Today: React.FC<{ open: (reviewId?: string) => void }> = ({ open }) => {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  React.useEffect(() => { pmService.get('home').then(setD).catch((e) => setErr(e.message)).finally(() => setLoading(false)); }, []);
  if (!d) return <Loading error={err} loading={loading} />;
  const go = (t: any) => { if (t.go === 'review') open(t.id); else pmNav.setSection(t.go === 'mine' ? 'mine' : t.go); };
  return (
    <div>
      <Intro title="Today" what="Everything waiting for you in Performance, in one list." todo={d.todo.length ? 'Press the button next to the first item.' : 'Nothing. You are all caught up.'} />
      {d.todo.length === 0 ? (
        <Card><div className="flex items-center gap-2 text-emerald-700 text-sm font-bold"><CheckCircle2 className="w-5 h-5" />You are all caught up.</div></Card>
      ) : (
        <div className="space-y-2">
          {d.todo.map((t: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-slate-800"><span className="text-slate-400 mr-2">{i + 1}.</span>{t.text}</span>
              <button className={i === 0 ? btnBig : btnGhost} onClick={() => go(t)}>Open <ArrowRight className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
      {d.isHr && d.openExceptions > 0 && (
        <div className="mt-4"><Notice tone="warn">{d.openExceptions} situation{d.openExceptions > 1 ? 's' : ''} need{d.openExceptions > 1 ? '' : 's'} HR attention. <button className="underline font-bold" onClick={() => pmNav.setSection('governance')}>See them</button></Notice></div>
      )}
      <Explain title="What is Performance in one minute?">
        <p>You have <b>targets</b> (KRA/KPI), you follow the company's <b>processes</b> (SOPs), and you show good <b>behaviour</b>. Your review looks at these three parts. Nobody is scored on missing information: if there is no evidence, it is left out, not counted as zero.</p>
        <p>You write a self-assessment, your manager evaluates, you talk together, HR checks it, an approver signs it off, and then you read it and can agree or disagree.</p>
      </Explain>
    </div>
  );
};

/** Everything about me: my targets, my processes, my reviews. */
export const MyPerformance: React.FC<{ open: (reviewId?: string) => void }> = ({ open }) => {
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  React.useEffect(() => { Promise.all([pmService.get('plan-list', { scope: 'mine' }), pmService.get('sopassign-list'), pmService.get('review-list', { scope: 'mine' })]).then(([p, s, r]) => setData({ plans: p.items, sops: s.items, reviews: r.items })).catch((e) => setErr(e.message)); }, [tick]);
  const { busy, note, run } = useRunner(); const [ackNote, setAckNote] = useState(''); const reload = () => setTick((t) => t + 1);
  if (!data) return <Loading error={err} loading={!err} />;
  const plan = data.plans.find((p: any) => p.status === 'APPROVED') || data.plans.find((p: any) => p.status === 'ACTIVE') || data.plans[0];
  return (
    <div className="space-y-4">
      <Intro title="My performance" what="Your targets, the processes you follow, and your reviews." />
      <ResultNote note={note} />
      <Card title="My targets (KRA/KPI)">
        {!plan ? <Empty text="You do not have targets yet. Your manager and HR will set them." /> : <PlanView id={plan.id} onAcknowledge={() => run(async () => { await pmService.post('plan-act', { id: plan.id, action: 'acknowledge', note: ackNote }); reload(); }, 'Thank you. Your targets are now active.')} busy={busy} ackNote={ackNote} setAckNote={setAckNote} />}
      </Card>
      <Card title="Processes I follow (SOPs)" subtitle="First open and read it. Then confirm that you have read it. These are recorded separately on purpose.">
        {data.sops.length === 0 ? <Empty text="No processes assigned to you." /> : (
          <div className="space-y-2">
            {data.sops.map((a: any) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">
                <div className="min-w-0"><div className="text-sm font-semibold text-slate-800">{a.title} <span className="text-xs text-slate-400">v{a.versionNumber}</span> {a.criticality === 'CRITICAL' && <Pill tone="red">critical</Pill>}</div>
                  <div className="text-xs text-slate-500">{a.acknowledgedAt ? 'You confirmed you have read it.' : a.readAt ? 'You opened it. Now confirm.' : 'Not opened yet.'}{a.training === 'PENDING' ? ' Training pending.' : ''}</div></div>
                <div className="flex gap-2">
                  {a.documentUrl && <a className={btnGhost} href={a.documentUrl} target="_blank" rel="noreferrer" onClick={() => pmService.post('sop-read', { id: a.id }).then(reload).catch(() => {})}>Open document</a>}
                  {!a.readAt && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('sop-read', { id: a.id }); reload(); }, 'Marked as read.')}>I have read it</button>}
                  {a.readAt && !a.acknowledgedAt && a.acknowledgementRequired && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('sop-ack', { id: a.id }); reload(); }, 'Acknowledged.')}>I acknowledge</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="My reviews">
        {data.reviews.length === 0 ? <Empty text="No reviews yet." /> : data.reviews.map((r: any) => (
          <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
            <div><div className="text-sm font-semibold text-slate-800">{r.cycleName}</div><div className="mt-0.5"><StatusChip status={r.status} /></div></div>
            <button className={btnGhost} onClick={() => open(r.id)}>Open</button>
          </div>
        ))}
      </Card>
    </div>
  );
};

export const PlanView: React.FC<{ id: string; onAcknowledge?: () => void; busy?: boolean; ackNote?: string; setAckNote?: (v: string) => void }> = ({ id, onAcknowledge, busy, ackNote, setAckNote }) => {
  const [p, setP] = useState<any>(null);
  React.useEffect(() => { pmService.get('plan-get', { id }).then((r) => setP(r.item)).catch(() => {}); }, [id]);
  if (!p) return <Loading loading />;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2"><span className="text-sm font-bold text-slate-800">{p.roleName}</span><StatusChip status={p.status} />{p.frameworkName && <span className="text-xs text-slate-500">Rules: {p.frameworkName}</span>}</div>
      <div className="text-xs text-slate-600 mb-3">The three parts of your review count: <b>Results {p.weights?.kra ?? 60}%</b>, <b>Behaviour {p.weights?.behaviour ?? 25}%</b>, <b>Processes {p.weights?.sop ?? 15}%</b>.</div>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3">Responsibility (KRA)</th><th className="pr-3">Measure (KPI)</th><th className="pr-3">Target</th><th>Weight</th></tr></thead>
        <tbody>{(p.kpis || []).map((k: any) => <tr key={k.id} className="border-t border-slate-100"><td className="py-1.5 pr-3 font-semibold text-slate-700">{k.kraName}</td><td className="pr-3">{k.kpiName}<div className="text-xs text-slate-400">{k.measurement}</div></td><td className="pr-3">{k.target || <span className="text-slate-400">to be set</span>}</td><td>{k.weightage}%</td></tr>)}</tbody>
      </table></div>
      {p.status === 'APPROVED' && onAcknowledge && (
        <div className="mt-3 border-t border-slate-200 pt-3 space-y-2">
          <Notice tone="info">Please read the targets above. When you are happy, confirm. If something looks wrong, use "Ask for a change" instead.</Notice>
          <Field label="Comment (optional)"><input className={input} value={ackNote || ''} onChange={(e) => setAckNote?.(e.target.value)} /></Field>
          <div className="flex gap-2"><button className={btnBig} disabled={busy} onClick={onAcknowledge}>I have read and accept my targets</button><AskChange id={p.id} /></div>
        </div>
      )}
    </div>
  );
};

const AskChange: React.FC<{ id: string }> = ({ id }) => {
  const [open, setOpen] = useState(false); const [t, setT] = useState(''); const { busy, note, run } = useRunner();
  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}>Ask for a change</button>;
  return <div className="flex-1 space-y-2"><Note label="What should change?" value={t} onChange={setT} /><ResultNote note={note} /><div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('plan-act', { id, action: 'return', note: t }); window.location.reload(); }, 'Sent back to your manager.')}>Send</button><button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button></div></div>;
};

/** My monthly check-ins (read them, add a comment). */
export const MyCheckins: React.FC = () => {
  const [items, setItems] = useState<any[] | null>(null); const [tick, setTick] = useState(0); const [text, setText] = useState<Record<string, string>>({}); const { busy, note, run } = useRunner();
  React.useEffect(() => { pmService.get('checkin-list', { scope: 'mine' }).then((r) => setItems(r.items)); }, [tick]);
  if (!items) return <Loading loading />;
  return (
    <div className="space-y-3">
      <Intro title="My check-ins" what="A short monthly chat with your manager. Your manager writes it down, and you can add your own comment." />
      <ResultNote note={note} />
      {items.length === 0 && <Empty text="No check-ins yet." />}
      {items.map((c) => (
        <Card key={c.id} title={c.month} right={<StatusChip status={c.status} />}>
          {c.status !== 'DONE' ? <p className="text-sm text-slate-500">Your manager has not recorded this one yet.</p> : (
            <div className="text-sm space-y-1.5"><p><b>Good things:</b> {c.wins || '-'}</p><p><b>Focus next:</b> {c.focus || '-'}</p><p><b>Concerns:</b> {c.concerns || '-'}</p><p><b>Support from the company:</b> {c.support || '-'}</p>
              <Note label="Your comment" value={text[c.id] ?? c.employeeComment ?? ''} onChange={(v) => setText({ ...text, [c.id]: v })} rows={2} />
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('checkin-comment', { id: c.id, comment: text[c.id] ?? c.employeeComment }); setTick((t) => t + 1); }, 'Saved.')}>Save my comment</button></div>
          )}
        </Card>
      ))}
    </div>
  );
};
