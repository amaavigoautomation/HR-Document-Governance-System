import React, { useEffect, useState } from 'react';
import { pmService } from '../../services/pmService';
import { User } from '../../types';
import { Loading, Pill } from '../common/loadUi';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Empty, Intro, Note, ResultNote, Tabs, STATUS_WORDS, money } from './common';

const Stat: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({ label, value, tone }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-3"><div className="text-xs text-slate-500">{label}</div><div className={`text-2xl font-extrabold ${tone || 'text-slate-800'}`}>{value}</div></div>
);

export const Dashboard: React.FC = () => {
  const [cy, setCy] = useState(''); const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setD(null); pmService.get('dashboard', { cycleId: cy }).then(setD).catch((e) => setErr(e.message)); }, [cy]);
  if (!d) return <Loading error={err} loading={!err} />;
  return (
    <div>
      <Intro title="Dashboards" what={`Where reviews, targets and processes stand. Showing: ${d.scope}. Groups smaller than ${d.minGroup} people are hidden so nobody can be picked out.`} />
      <div className="mb-4 max-w-xs"><Field label="Review cycle"><select className={input} value={cy} onChange={(e) => setCy(e.target.value)}><option value="">All cycles</option>{d.cycles.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Reviews finished" value={`${d.completionPct}%`} /><Stat label="Overdue" value={d.overdue} tone={d.overdue ? 'text-rose-600' : undefined} /><Stat label="Waiting for setup" value={d.waiting} tone={d.waiting ? 'text-amber-600' : undefined} /><Stat label="Disagreements" value={d.disputed} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Where reviews are">{Object.keys(d.statusCounts).length === 0 ? <Empty text="No reviews yet." /> : <ul className="text-sm space-y-1">{Object.entries(d.statusCounts).map(([k, v]) => <li key={k} className="flex justify-between"><span>{STATUS_WORDS[k] || k}</span><b>{v as number}</b></li>)}</ul>}</Card>
        <Card title="Final ratings" subtitle="Shown only when at least 3 reviews are finished.">{d.distribution ? <div className="space-y-1.5">{[5, 4, 3, 2, 1].map((n) => { const v = d.distribution[n] || 0; const max = Math.max(1, ...Object.values(d.distribution).map(Number)); return <div key={n} className="flex items-center gap-2 text-sm"><span className="w-6">{n}</span><div className="flex-1 bg-slate-100 rounded h-4"><div className="bg-[#FA7014] h-4 rounded" style={{ width: `${(v / max) * 100}%` }} /></div><span className="w-6 text-right">{v}</span></div>; })}</div> : <Empty text={d.distributionHidden ? 'Not enough finished reviews to show without identifying people.' : 'No finished reviews yet.'} />}</Card>
        <Card title="By department">{d.byDepartment.length === 0 ? <Empty text="Nothing yet." /> : <ul className="text-sm space-y-1">{d.byDepartment.map((x: any) => <li key={x.department} className="flex justify-between"><span>{x.department} <span className="text-slate-400">({x.people})</span></span><b>{x.hidden ? 'hidden (small group)' : x.average === null ? 'not enough finished' : `average ${money(x.average)}`}</b></li>)}</ul>}</Card>
        <Card title="Processes and targets"><ul className="text-sm space-y-1"><li className="flex justify-between"><span>Targets active</span><b>{d.plans.active}</b></li><li className="flex justify-between"><span>Targets waiting for setup</span><b>{d.plans.waiting}</b></li><li className="flex justify-between"><span>People with no targets</span><b>{d.plans.none}</b></li><li className="flex justify-between"><span>SOPs acknowledged</span><b>{d.sop.acknowledged}/{d.sop.assigned}</b></li><li className="flex justify-between"><span>Training pending</span><b>{d.sop.trainingPending}</b></li><li className="flex justify-between"><span>Evidence to check</span><b>{d.evidence.unverified}</b></li></ul></Card>
      </div>
    </div>
  );
};

const aud = (a: any) => `${new Date(a.at).toLocaleString()} - ${a.actor}: ${String(a.action).replace(/_/g, ' ').toLowerCase()} (${a.entity})`;

export const Governance: React.FC<{ users: User[] }> = ({ users }) => {
  const [tab, setTab] = useState('exceptions'); const [tick, setTick] = useState(0); const { busy, note, run } = useRunner();
  const [ex, setEx] = useState<any>(null); const [au, setAu] = useState<any[] | null>(null); const [fair, setFair] = useState<any>(null); const [ai, setAi] = useState<any>(null); const [chk, setChk] = useState<any>(null); const [res, setRes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState('OPEN'); const [who, setWho] = useState('');
  useEffect(() => {
    if (tab === 'exceptions') pmService.get('exception-list').then(setEx);
    if (tab === 'audit') pmService.get('audit-list', { subjectUid: who || undefined }).then((r) => setAu(r.items));
    if (tab === 'fairness') pmService.get('fairness').then(setFair);
    if (tab === 'ai') pmService.get('setup-status').then(setAi);
    if (tab === 'launch') pmService.get('launch-checks').then(setChk);
  }, [tab, tick, who]);
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  useEffect(() => { if (tab === 'ai') pmService.post('ai-settings', {}).then((r) => setAiOn(!!r.aiAcknowledged)); }, [tab, tick]);
  const [refer, setRefer] = useState<string>('');
  return (
    <div>
      <Intro title="Audit, exceptions & AI" what="A record of every change, a list of unusual situations the system found, fairness checks, and the optional AI helper." />
      <Tabs value={tab} onChange={setTab} items={[{ key: 'exceptions', label: 'Exceptions', count: ex?.items?.filter((x: any) => x.status === 'OPEN').length }, { key: 'audit', label: 'Audit trail' }, { key: 'fairness', label: 'Fairness checks' }, { key: 'ai', label: 'AI helper' }, { key: 'confidential', label: 'Serious misconduct' }, { key: 'launch', label: 'Launch checklist' }]} />
      <ResultNote note={note} />
      {tab === 'exceptions' && (!ex ? <Loading loading /> : (<div>
        <div className="flex gap-2 mb-3"><button className={filter === 'OPEN' ? btnPrimary : btnGhost} onClick={() => setFilter('OPEN')}>Open</button><button className={filter === 'RESOLVED' ? btnPrimary : btnGhost} onClick={() => setFilter('RESOLVED')}>Resolved</button></div>
        {ex.items.filter((x: any) => x.status === filter).length === 0 ? <Empty text="Nothing here." /> : ex.items.filter((x: any) => x.status === filter).map((x: any) => (
          <Card key={x.id} className="mb-2" title={<span>{x.label} {x.subjectName && <span className="text-slate-400 font-medium">- {x.subjectName}</span>}</span>} right={<Pill tone={x.status === 'OPEN' ? 'amber' : 'green'}>{x.status.toLowerCase()}</Pill>}>
            <p className="text-sm text-slate-700">{x.detail}</p><p className="text-xs text-slate-500 mt-1"><b>What the system does:</b> {x.requiredBehaviour}</p>
            {x.status === 'OPEN' ? <div className="flex gap-2 mt-2 items-end"><div className="flex-1"><input className={input} placeholder="How was it handled?" value={res[x.id] || ''} onChange={(e) => setRes({ ...res, [x.id]: e.target.value })} /></div><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('exception-resolve', { id: x.id, note: res[x.id] }); setTick((t) => t + 1); }, 'Marked as handled.')}>Mark handled</button></div> : <p className="text-xs text-slate-500 mt-1">Handled by {x.resolvedBy}: {x.resolution}</p>}
          </Card>))}
      </div>))}
      {tab === 'audit' && (<div>
        <div className="max-w-xs mb-3"><Field label="Show changes about one person"><select className={input} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Everyone</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field></div>
        {!au ? <Loading loading /> : au.length === 0 ? <Empty text="No records." /> : <Card><ul className="text-xs text-slate-600 space-y-1.5">{au.map((a) => <li key={a.id}>{aud(a)}</li>)}</ul><p className="text-xs text-slate-400 mt-3">This record can only grow. Nothing in it can be edited or deleted.</p></Card>}
      </div>)}
      {tab === 'fairness' && (!fair ? <Loading loading /> : <Card title="Patterns worth a look" subtitle={fair.note}>{fair.flags.length === 0 ? <Empty text={`Nothing unusual found in ${fair.reviewed} finished reviews.`} /> : <ul className="list-disc pl-5 text-sm space-y-1">{fair.flags.map((f: any, i: number) => <li key={i}>{f.message}</li>)}</ul>}</Card>)}
      {tab === 'ai' && (<Card title="AI helper" subtitle="Optional. It summarises, points out missing evidence and suggests training. It never decides anything and never comments on personality, motives or personal traits.">
        {aiOn === null || !ai ? <Loading loading /> : (<div className="space-y-3 text-sm">
          <p>Status: <b>{aiOn ? 'On' : 'Off'}</b>. {ai.aiAvailable ? '' : 'The system has no AI key, so simple rule-based checks are used instead. That works fine.'}</p>
          <p className="text-slate-600">Even when it is on, a person makes every decision. If the AI fails or says something it cannot support, that is thrown away and logged, and the review carries on.</p>
          <button className={aiOn ? btnGhost : btnPrimary} disabled={busy} onClick={() => run(async () => { await pmService.post('ai-settings', { aiAcknowledged: !aiOn }); setTick((t) => t + 1); }, aiOn ? 'Turned off.' : 'Turned on.')}>{aiOn ? 'Turn off' : 'Turn on'}</button></div>)}
      </Card>)}
      {tab === 'confidential' && (<Card title="Serious misconduct" subtitle="Performance reviews are not the place for serious allegations (harassment, fraud, safety). Those go through your separate confidential investigation process.">
        <p className="text-sm text-slate-700 mb-3">Using this form records only that a matter was referred. <b>Do not write details here.</b> Then follow your company's investigation process.</p>
        <div className="flex gap-2 items-end max-w-md"><div className="flex-1"><Field label="Person concerned"><select className={input} value={refer} onChange={(e) => setRefer(e.target.value)}><option value="">Choose...</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field></div><button className={btnPrimary} disabled={busy || !refer} onClick={() => run(async () => { const r = await pmService.post('misconduct-refer', { uid: refer }); setRefer(''); alert(r.message); }, undefined)}>Record a referral</button></div>
      </Card>)}
      {tab === 'launch' && (!chk ? <Loading loading /> : <Card title="Before you go live" subtitle={chk.note}><ol className="list-decimal pl-5 text-sm space-y-1.5">{chk.checks.map((c: any) => <li key={c.n}>{c.text}</li>)}</ol></Card>)}
    </div>
  );
};
