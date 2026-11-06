import React, { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { pmService } from '../../services/pmService';
import { Loading, useLoad, Pill } from '../common/loadUi';
import { Card, Field, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Empty, Explain, GuardedButton, Intro, Note, ResultNote, StatusChip, Tabs, score, when } from './common';
import type { Go } from './Home';

/** Everyone's targets. Waiting-for-HR first, then on-hold (with the reason), then the rest. */
export const Plans: React.FC<{ go: Go }> = () => {
  const { data, error, loading, reload } = useLoad(() => pmService.get('plans'), []);
  const [tab, setTab] = useState('todo');
  const [open, setOpen] = useState('');
  const [why, setWhy] = useState('');
  const { busy, note, run } = useRunner();
  if (!data) return <Loading error={error} loading={loading} />;
  const items = data.items as any[];
  const groups: Record<string, any[]> = { todo: items.filter((p) => p.status === 'HR_CHECK'), hold: items.filter((p) => p.status === 'ON_HOLD'), targets: items.filter((p) => p.status === 'SET_TARGETS'), active: items.filter((p) => p.status === 'ACTIVE') };
  const rows = groups[tab];
  return (
    <div className="space-y-4">
      <Intro title="Targets (plans)" what="Each person's plan: KPIs with targets, behaviours and SOPs. Plans are created and updated automatically." todo={groups.todo.length ? 'Approve the targets waiting for you, or send them back with a note.' : groups.hold.length ? 'Fix what the on-hold plans are waiting for.' : undefined} />
      <ResultNote note={note} />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs value={tab} onChange={setTab} items={[{ key: 'todo', label: 'Waiting for you', count: groups.todo.length }, { key: 'hold', label: 'On hold', count: groups.hold.length }, { key: 'targets', label: 'With managers', count: groups.targets.length }, { key: 'active', label: 'Active', count: groups.active.length }]} />
        <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('plans-refresh'); await reload(); }, 'Everyone checked.')}><RefreshCw className="w-4 h-4" />Check everyone now</button>
      </div>
      <Card>
        {rows.length === 0 ? <Empty text="Nothing here." /> : rows.map((p) => (
          <div key={p.id} className="border-t border-slate-100 py-2 first:border-t-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm"><b>{p.name}</b> · {p.designation} · {p.department}{p.managerName ? ` · manager ${p.managerName}` : ''}</span>
              <span className="flex items-center gap-2">
                <StatusChip status={p.status} kind="plan" />
                {p.status === 'ACTIVE' && (p.ackAt ? <Pill tone="green">Acknowledged</Pill> : <Pill tone="amber">Not acknowledged</Pill>)}
                {p.status === 'ACTIVE' && p.sopsToAck > 0 && <Pill tone="amber">{p.sopsToAck} SOP(s) to acknowledge</Pill>}
                <button className={btnGhost} onClick={() => setOpen(open === p.id ? '' : p.id)}>{open === p.id ? 'Hide' : p.status === 'HR_CHECK' ? 'Check' : 'View'}</button>
              </span>
            </div>
            {p.status === 'ON_HOLD' && <p className="text-xs text-amber-800 mt-1">Waiting for: {(p.holds || []).join(' ')}</p>}
            {open === p.id && (
              <div className="mt-2 bg-slate-50 rounded-lg p-3 space-y-2">
                <table className="w-full text-sm"><tbody>{p.kpis.map((k: any) => <tr key={k.id} className="border-t border-slate-200 first:border-t-0"><td className="py-1">{k.kpi}</td><td>{k.target || <span className="text-slate-400">no target yet</span>}</td><td className="text-right">{k.weight}%</td></tr>)}</tbody></table>
                <p className="text-xs text-slate-500">{p.competencies.length} behaviours · SOPs: {(p.sops || []).map((x: any) => `${x.title}${x.ackAt ? ' ✓' : ''}`).join(', ') || 'none'}</p>
                {p.status === 'HR_CHECK' && (
                  <div className="space-y-2">
                    <div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('plan-approve', { id: p.id }); setOpen(''); await reload(); }, `Approved. ${p.name} has been asked to acknowledge.`)}>Approve</button></div>
                    <Note label="Or send back to the manager with a note" rows={2} value={why} onChange={setWhy} />
                    <GuardedButton className={btnGhost} busy={busy} missing={why.trim().length < 5 ? ['you write what to change'] : []} onClick={() => run(async () => { await pmService.post('plan-return', { id: p.id, note: why }); setWhy(''); setOpen(''); await reload(); }, 'Sent back.')}>Send back</GuardedButton>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </Card>
      {data.noPlan?.length > 0 && <p className="text-xs text-slate-500">No plan yet (setup not finished or just joined): {data.noPlan.map((x: any) => x.name).join(', ')}.</p>}
    </div>
  );
};

/** Review cycles (one per quarter) and every review, riskiest first. */
export const Reviews: React.FC<{ go: Go; hr: boolean }> = ({ go, hr }) => {
  const cy = useLoad(() => pmService.get('cycles'), []);
  const [cycle, setCycle] = useState('');
  const [tab, setTab] = useState('todo');
  const rv = useLoad(() => pmService.get('reviews', { scope: 'all', cycle: cycle || undefined }), [cycle]);
  const { busy, note, run } = useRunner();
  if (!cy.data) return <Loading error={cy.error} loading={cy.loading} />;
  const items = (rv.data?.items || []) as any[];
  const groups: Record<string, any[]> = {
    todo: items.filter((r) => r.status === 'HR' || r.status === 'DISPUTED'),
    progress: items.filter((r) => ['SELF', 'MANAGER', 'ON_HOLD', 'DEFERRED', 'APPROVED', 'PUBLISHED'].includes(r.status)),
    done: items.filter((r) => ['ACKNOWLEDGED', 'RESOLVED'].includes(r.status)),
  };
  return (
    <div className="space-y-4">
      <Intro title="Reviews" what="One review per person per quarter. They open by themselves on the first day after each quarter ends; you can also open one now." todo={groups.todo.length ? 'Open the reviews waiting for you. Risky ones (critical SOP, unusual ratings, disagreements) are at the top; clean ones sink to the bottom.' : undefined} />
      <ResultNote note={note} />
      {hr && cy.data.canOpen.length > 0 && (
        <Card title="Open a quarter">
          <div className="flex flex-wrap gap-2">{cy.data.canOpen.map((q: any) => <button key={q.key} className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('cycle-open', { key: q.key }); await cy.reload(); await rv.reload(); }, `${q.name} opened.`)}>Open {q.name}</button>)}</div>
          <p className="text-xs text-slate-500 mt-1">Opening is safe: one review per person, never twice. People without approved targets wait (on hold) and start by themselves.</p>
        </Card>
      )}
      {cy.data.items.length > 0 && (
        <div className="flex flex-wrap gap-2 items-end">
          <Field label="Quarter"><select className={input} value={cycle} onChange={(e) => setCycle(e.target.value)}><option value="">All quarters</option>{cy.data.items.map((c: any) => <option key={c.key} value={c.key}>{c.name} · {c.done}/{c.total} done</option>)}</select></Field>
        </div>
      )}
      <Tabs value={tab} onChange={setTab} items={[{ key: 'todo', label: 'Waiting for HR', count: groups.todo.length }, { key: 'progress', label: 'In progress', count: groups.progress.length }, { key: 'done', label: 'Done', count: groups.done.length }]} />
      <Card>
        {rv.loading && !rv.data ? <Loading loading /> : groups[tab].length === 0 ? <Empty text="Nothing here." /> : groups[tab].map((r) => (
          <button key={r.id} onClick={() => go.review(r.id)} className="w-full text-left border-t border-slate-100 first:border-t-0 py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50">
            <span className="text-sm"><b>{r.name}</b> · {r.cycleName}{r.score?.overall ? <span className="text-slate-500"> · {score(r.score.overall)} ({r.score.band})</span> : ''}
              {r.score?.criticalBreach && <span className="ml-2 text-rose-700 text-xs font-bold inline-flex items-center gap-0.5"><AlertTriangle className="w-3.5 h-3.5" />critical SOP</span>}
              {(r.flags || []).filter((f: string) => !f.startsWith('A critical')).map((f: string, i: number) => <span key={i} className="block text-[11px] text-amber-800">{f}</span>)}
            </span>
            <StatusChip status={r.status} kind="review" />
          </button>
        ))}
      </Card>
    </div>
  );
};

/** Everything that needs a person to act: blocking first, then late, then for information. */
export const Exceptions: React.FC = () => {
  const [all, setAll] = useState(false);
  const { data, error, loading, reload } = useLoad(() => pmService.get('exceptions', { all: all ? '1' : undefined }), [all]);
  const [open, setOpen] = useState(''); const [text, setText] = useState('');
  const { busy, note, run } = useRunner();
  if (!data) return <Loading error={error} loading={loading} />;
  const tone: Record<string, 'red' | 'amber' | 'slate'> = { BLOCK: 'red', REMIND: 'amber', LOG: 'slate' };
  const word: Record<string, string> = { BLOCK: 'Blocking', REMIND: 'Late', LOG: 'For information' };
  return (
    <div className="space-y-4">
      <Intro title="Needs attention" what="Situations the system could not settle on its own. Blocking items stop someone's plan or review; most clear by themselves once the cause is fixed." />
      <ResultNote note={note} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show handled items too</label>
      <Card>
        {data.items.length === 0 ? <Empty text="Nothing needs attention." /> : data.items.map((x: any) => (
          <div key={x.id} className="border-t border-slate-100 first:border-t-0 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm"><Pill tone={x.status === 'OPEN' ? tone[x.behaviour] : 'green'}>{x.status === 'OPEN' ? word[x.behaviour] : 'Handled'}</Pill> <b className="ml-1">{x.label}</b>{x.subjectName ? ` · ${x.subjectName}` : ''}<span className="text-xs text-slate-400"> · {when(x.openedAt)}{x.times > 1 ? ` · ${x.times} times` : ''}</span></span>
              {x.status === 'OPEN' && open !== x.id && <button className={btnGhost} onClick={() => { setOpen(x.id); setText(''); }}>Mark handled</button>}
            </div>
            <p className="text-xs text-slate-600 mt-0.5">{x.text}</p>
            {x.resolution && <p className="text-xs text-emerald-700 mt-0.5">Handled: {x.resolution}</p>}
            {open === x.id && <div className="mt-2 flex gap-2 items-start"><input className={input} placeholder="What was done?" value={text} onChange={(e) => setText(e.target.value)} /><GuardedButton busy={busy} missing={text.trim().length < 3 ? ['you write what was done'] : []} onClick={() => run(async () => { await pmService.post('exception-resolve', { id: x.id, note: text }); setOpen(''); await reload(); }, 'Marked as handled.')}>Save</GuardedButton></div>}
          </div>
        ))}
      </Card>
      <Explain title="Which situations are handled how?">
        <p><b>Blocking</b>: no manager, no KRA/KPI template, setup unfinished, review waiting for targets. Fix the cause (for example set the manager in People) and it clears by itself.</p>
        <p><b>Late</b>: targets, acknowledgements, check-ins or review steps past their time. Reminders go out automatically; these appear after the escalation time.</p>
        <p><b>For information</b>: disagreements, critical SOP flags, unusual rating patterns, role or manager changes, new SOP versions, long leave, unmatched imports and discarded AI answers.</p>
      </Explain>
    </div>
  );
};

/** Grouped figures only. Individual scores stay in the review screens. */
export const Reports: React.FC<{ hr: boolean }> = ({ hr }) => {
  const [cycle, setCycle] = useState('');
  const { data, error, loading } = useLoad(() => pmService.get('report', { cycle: cycle || undefined }), [cycle]);
  const { busy, note, run } = useRunner();
  if (!data) return <Loading error={error} loading={loading} />;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');
  const Tile: React.FC<{ label: string; value: React.ReactNode; sub?: string }> = ({ label, value, sub }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-3"><div className="text-[11px] text-slate-500 font-bold uppercase">{label}</div><div className="text-xl font-extrabold text-slate-900">{value}</div>{sub && <div className="text-[11px] text-slate-500">{sub}</div>}</div>
  );
  const maxDist = Math.max(1, ...Object.values(data.distribution as Record<string, number>));
  return (
    <div className="space-y-4">
      <Intro title="Reports" what="Company figures in groups. Department averages appear only for groups of 3 or more, so nobody can work out one person's score." />
      <ResultNote note={note} />
      <div className="flex flex-wrap gap-2 items-end">
        {data.cycles.length > 0 && <Field label="Quarter"><select className={input} value={cycle || data.cycle} onChange={(e) => setCycle(e.target.value)}>{data.cycles.map((c: string) => <option key={c} value={c}>{c}</option>)}</select></Field>}
        {hr && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await pmService.post('run-daily'); }, 'Daily checks done.')}><RefreshCw className="w-4 h-4" />Run the daily checks now</button>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile label="Reviews done" value={pct(data.done, data.total)} sub={`${data.done} of ${data.total}`} />
        <Tile label="Disagreements" value={data.disputed} />
        <Tile label="Critical SOP flags" value={data.criticalFlags} />
        <Tile label="Needs attention" value={data.openExceptions} />
        <Tile label="Plans active" value={data.plans.active} sub={`${data.plans.waiting} waiting · ${data.plans.onHold} on hold`} />
        <Tile label="SOPs acknowledged" value={pct(data.sopAck.acknowledged, data.sopAck.total)} sub={`${data.sopAck.acknowledged} of ${data.sopAck.total}`} />
        <Tile label={`Check-ins ${data.checkins.month}`} value={pct(data.checkins.done, data.checkins.total)} sub={`${data.checkins.done} of ${data.checkins.total}`} />
        <Tile label="Growth plans" value={data.growth.active} sub={`${data.growth.improvement} improvement · ${data.growth.proposed} to confirm`} />
      </div>
      <Card title="Rating distribution (shared reviews)">
        <div className="space-y-1.5">{Object.entries(data.distribution as Record<string, number>).map(([band, n]) => (
          <div key={band} className="flex items-center gap-2 text-sm"><span className="w-36 text-slate-600">{band}</span><div className="flex-1 bg-slate-100 rounded h-4"><div className="bg-[#FA7014] h-4 rounded" style={{ width: `${(n / maxDist) * 100}%` }} /></div><span className="w-8 text-right font-bold">{n}</span></div>
        ))}</div>
      </Card>
      <Card title="By department">
        {data.departments.length === 0 ? <Empty text="No shared reviews yet." /> : (
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Department</th><th>People</th><th className="text-right">Average</th></tr></thead>
            <tbody>{data.departments.map((d: any) => <tr key={d.department} className="border-t border-slate-100"><td className="py-1.5">{d.department}</td><td>{d.people}</td><td className="text-right">{d.average === null ? <span className="text-slate-400 text-xs">hidden (under 3 people)</span> : score(d.average)}</td></tr>)}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
};
