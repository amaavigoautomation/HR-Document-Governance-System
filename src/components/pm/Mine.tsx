import React, { useState } from 'react';
import { ExternalLink, Plus, Trash2, Check } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { Loading, useLoad } from '../common/loadUi';
import { Card, Drawer, Field, btnGhost, btnPrimary, input, todayIst, useRunner } from '../leave/ui';
import { Empty, GuardedButton, Intro, Note, ResultNote, StatusChip, score, when } from './common';
import { GROWTH_WORDS } from '../../../shared/pmEngine';

/** Everything about me: targets, SOPs, my work, check-ins, reviews and growth plans. */
export const Mine: React.FC<{ openReview: (id: string) => void }> = ({ openReview }) => {
  const { data, error, loading, reload } = useLoad(() => pmService.get('my'), []);
  const { busy, note, run } = useRunner();
  const [reading, setReading] = useState<{ title: string; text: string } | null>(null);
  if (!data) return <Loading error={error} loading={loading} />;
  const plan = data.plan;
  const act = (action: string, body: any, done?: string) => run(async () => { await pmService.post(action, body); await reload(); }, done);
  // A blank tab is opened straight away (so the browser does not block it), then pointed at the file. Inline files show here instead.
  const openSop = (x: any) => {
    const tab = window.open('', '_blank');
    run(async () => {
      const r = await pmService.post('sop-open', { planId: plan.id, documentId: x.documentId });
      if (r.url && tab) tab.location.href = r.url;
      else { tab?.close(); setReading({ title: x.title, text: r.text || 'This document has no readable text here. Open it from Documents.' }); }
      await reload();
    });
  };
  return (
    <div className="space-y-4">
      <Intro title="My performance" what="Your targets, the SOPs you follow, the work you have recorded, your check-ins, reviews and growth plans." />
      <ResultNote note={note} />
      <Drawer open={!!reading} onClose={() => setReading(null)} title={reading?.title || ''} subtitle="Read it to the end, then close this and press &quot;I have read and understood&quot;.">
        <div className="whitespace-pre-wrap text-sm text-slate-700">{reading?.text}</div>
      </Drawer>

      <Card title="My targets" right={plan && <StatusChip status={plan.status} kind="plan" />}>
        {!plan ? <Empty text="You have no targets yet. They are created automatically; HR will tell you if anything is missing." /> : plan.status !== 'ACTIVE' ? (
          <p className="text-sm text-slate-600">{plan.status === 'ON_HOLD' ? 'Your plan is waiting for HR to finish something: ' + (plan.holds || []).join(' ') : plan.status === 'SET_TARGETS' ? 'Your manager is setting your targets.' : 'HR is checking the targets your manager set.'} You will get an email when they are ready.</p>
        ) : (
          <div className="space-y-3">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">KPI</th><th>Target</th><th className="text-right">Weight</th><th className="text-right">Verified work</th></tr></thead>
              <tbody>{plan.kpis.map((k: any) => (
                <tr key={k.id} className="border-t border-slate-100"><td className="py-1.5"><b>{k.kpi}</b><div className="text-xs text-slate-500">{k.kra}{k.measure ? ` · measured by ${k.measure}` : ''}</div></td><td>{k.target}</td><td className="text-right">{k.weight}%</td><td className="text-right">{k.evidence}{k.pending ? <span className="text-slate-400"> (+{k.pending} waiting)</span> : ''}</td></tr>
              ))}</tbody>
            </table>
            {plan.ackAt ? <p className="text-xs text-emerald-700 font-bold flex items-center gap-1"><Check className="w-4 h-4" />You acknowledged these on {when(plan.ackAt)}.</p>
              : <button className={btnPrimary} disabled={busy} onClick={() => act('plan-ack', { id: plan.id }, 'Thank you. Your targets are acknowledged.')}>I have read my targets</button>}
          </div>
        )}
      </Card>

      {plan && (plan.sops || []).length > 0 && (
        <Card title="SOPs I follow" subtitle="First open and read each one, then confirm. Reading and confirming are recorded separately.">
          <div className="space-y-2">
            {plan.sops.map((x: any) => (
              <div key={x.documentId} className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2">
                <div className="text-sm"><b>{x.title}</b> <span className="text-xs text-slate-500">v{x.versionNumber}{x.critical ? ' · critical' : ''}</span></div>
                {x.ackAt ? <span className="text-xs font-bold text-emerald-700 flex items-center gap-1"><Check className="w-4 h-4" />Confirmed {when(x.ackAt)}</span> : (
                  <div className="flex gap-2 items-start">
                    <button className={btnGhost} onClick={() => openSop(x)}><ExternalLink className="w-3.5 h-3.5" />Open and read</button>
                    <GuardedButton busy={busy} missing={x.openedAt ? [] : ['you open and read it']} onClick={() => act('sop-ack', { planId: plan.id, documentId: x.documentId }, `${x.title}: confirmed.`)}>I have read and understood</GuardedButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {plan?.status === 'ACTIVE' && <MyWork plan={plan} items={data.evidence} reload={reload} />}

      <Card title="Monthly check-ins" subtitle="A short conversation with your manager each month. Your notes are optional; your manager writes the summary.">
        {data.checkins.length === 0 ? <Empty text="No check-ins yet. One appears on the 1st of each month once your targets are approved." /> : data.checkins.map((ci: any) => <CheckinRow key={ci.id} ci={ci} reload={reload} />)}
      </Card>

      <Card title="My reviews">
        {data.reviews.length === 0 ? <Empty text="No reviews yet. A review opens at the end of each quarter." /> : (
          <div className="space-y-2">
            {data.reviews.map((r: any) => (
              <button key={r.id} onClick={() => openReview(r.id)} className="w-full flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 text-left">
                <span className="text-sm font-semibold">{r.cycleName}{r.score?.overall ? <span className="text-slate-500 font-normal"> · {score(r.score.overall)} ({r.score.band})</span> : ''}</span>
                <StatusChip status={r.status} kind="review" />
              </button>
            ))}
          </div>
        )}
      </Card>

      {data.growth.length > 0 && (
        <Card title="My growth plans">
          {data.growth.map((g: any) => (
            <div key={g.id} className="border border-slate-200 rounded-lg px-3 py-2 mb-2">
              <div className="flex items-center justify-between gap-2"><b className="text-sm">{GROWTH_WORDS[g.type as keyof typeof GROWTH_WORDS]} · after {g.cycleName}</b><StatusChip status={g.status} kind="growth" /></div>
              <p className="text-sm text-slate-700 mt-1">{g.objective}</p>
              {g.expected && <p className="text-xs text-slate-500 mt-1">Expected: {g.expected}. Support: {g.support}</p>}
              <ul className="mt-2 space-y-1">{g.actions.map((a: any, i: number) => (
                <li key={i}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.done} disabled={g.status !== 'ACTIVE' || busy} onChange={(e) => act('growth-action', { id: g.id, index: i, done: e.target.checked })} />{a.text}</label></li>
              ))}</ul>
              <p className="text-xs text-slate-500 mt-1">Follow-up on {g.reviewDate}{g.outcome ? ` · Outcome: ${g.outcome}` : ''}</p>
            </div>
          ))}
        </Card>
      )}
      {data.pastPlans.length > 0 && <p className="text-xs text-slate-500">Earlier plans kept for your history: {data.pastPlans.map((p: any) => `${p.designation} (${p.department}) until ${p.effectiveTo}`).join('; ')}.</p>}
    </div>
  );
};

/** Record work against a KPI. Your manager verifies it; it is information for the review, not a score by itself. */
const MyWork: React.FC<{ plan: any; items: any[]; reload: () => void }> = ({ plan, items, reload }) => {
  const [f, setF] = useState({ kpiId: '', date: todayIst(), title: '', link: '' });
  const { busy, note, run } = useRunner();
  const missing = [!f.kpiId && 'you pick a KPI', f.title.trim().length < 4 && 'you describe the work', !f.date && 'you pick the date'].filter(Boolean) as string[];
  return (
    <Card title="My work" subtitle="Record what you deliver. Your manager verifies it. It helps at review time; counts are never turned into a rating by themselves.">
      <ResultNote note={note} />
      <div className="grid md:grid-cols-4 gap-2 items-end">
        <Field label="Which KPI?"><select className={input} value={f.kpiId} onChange={(e) => setF({ ...f, kpiId: e.target.value })}><option value="">Pick one…</option>{plan.kpis.map((k: any) => <option key={k.id} value={k.id}>{k.kpi}</option>)}</select></Field>
        <Field label="What did you do?"><input className={input} value={f.title} placeholder="e.g. Diwali campaign launched" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="When?"><input type="date" className={input} max={todayIst()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Link (optional)"><input className={input} value={f.link} placeholder="https://…" onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
      </div>
      <div className="mt-2"><GuardedButton busy={busy} missing={missing} onClick={() => run(async () => { await pmService.post('ev-add', f); setF({ ...f, title: '', link: '' }); reload(); }, 'Added. Your manager will verify it.')}><Plus className="w-4 h-4" />Add work</GuardedButton></div>
      <div className="mt-3 divide-y divide-slate-100">
        {items.length === 0 ? <Empty text="Nothing recorded yet." /> : items.slice(0, 30).map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span><span className="text-slate-400 mr-2">{e.date}</span>{e.link ? <a className="underline" href={e.link} target="_blank" rel="noreferrer">{e.title}</a> : e.title} <span className="text-xs text-slate-500">→ {e.kpiName}</span>{e.note ? <span className="text-xs text-rose-600"> ({e.note})</span> : ''}</span>
            <span className="flex items-center gap-2"><StatusChip status={e.status} />{e.status === 'PENDING' && e.source === 'MANUAL' && <button aria-label="Delete" className="text-slate-400 hover:text-rose-600" onClick={() => run(async () => { await pmService.post('ev-delete', { id: e.id }); reload(); })}><Trash2 className="w-4 h-4" /></button>}</span>
          </div>
        ))}
      </div>
    </Card>
  );
};

const CheckinRow: React.FC<{ ci: any; reload: () => void }> = ({ ci, reload }) => {
  const [f, setF] = useState({ wentWell: ci.wentWell, blockers: ci.blockers, nextFocus: ci.nextFocus });
  const { busy, note, run } = useRunner();
  if (ci.status === 'DONE') return (
    <div className="border border-slate-200 rounded-lg px-3 py-2 mb-2 text-sm"><div className="flex justify-between"><b>{ci.month}</b><StatusChip status="DONE" /></div><p className="text-slate-700 mt-1">{ci.managerComment}</p></div>
  );
  return (
    <div className="border border-slate-200 rounded-lg px-3 py-2 mb-2">
      <div className="flex justify-between mb-2"><b className="text-sm">{ci.month}</b><StatusChip status="DUE" /></div>
      <ResultNote note={note} />
      <div className="grid md:grid-cols-3 gap-2">
        <Note label="What went well?" rows={2} value={f.wentWell} onChange={(v) => setF({ ...f, wentWell: v })} />
        <Note label="What is blocking you?" rows={2} value={f.blockers} onChange={(v) => setF({ ...f, blockers: v })} />
        <Note label="Focus for next month" rows={2} value={f.nextFocus} onChange={(v) => setF({ ...f, nextFocus: v })} />
      </div>
      <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('checkin-save', { id: ci.id, ...f }); reload(); }, 'Saved. Your manager will see it.')}>Save my notes</button>
    </div>
  );
};

