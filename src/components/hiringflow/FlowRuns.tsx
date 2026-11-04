import React, { useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, UserPlus } from 'lucide-react';
import { Card, Drawer, Notice, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';
import { flowService, type FlowRunRow, type FlowState } from '../../services/flowService';
import { applicationsService } from '../../services/applicationsService';
import { RUN_STATUS_WORDS } from '../../../shared/flowEngine';

const TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = { RUNNING: 'blue', WAITING: 'blue', STUCK: 'red', HIRED: 'green', REJECTED: 'slate', STOPPED: 'slate' };
const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'Everyone' }, { key: 'STUCK', label: 'Needs HR attention' }, { key: 'WAITING', label: 'Waiting for someone' }, { key: 'HIRED', label: 'Hired' }, { key: 'REJECTED', label: 'Rejected' },
];

const History: React.FC<{ runId: string }> = ({ runId }) => {
  const { data, error, loading } = useLoad(() => flowService.run(runId), [runId]);
  if (loading) return <Loading loading />;
  if (error) return <Loading error={error} />;
  const hist: { at: string; text: string; by: string }[] = [...(data?.run?.history || [])].reverse();
  return (
    <ol className="space-y-2">
      {hist.map((h, i) => (
        <li key={i} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><p className="text-slate-800">{h.text}</p><p className="text-[11px] text-slate-500 mt-0.5">{niceDate(h.at.slice(0, 10))} {h.at.slice(11, 16)} UTC · {h.by}</p></li>
      ))}
    </ol>
  );
};

const FixIt: React.FC<{ r: FlowRunRow; people: FlowState['people']; onDone: () => void }> = ({ r, people, onDone }) => {
  const { busy, note, run } = useRunner();
  const [mode, setMode] = useState<'' | 'skip' | 'reject' | 'stop' | 'reassign'>('');
  const [why, setWhy] = useState('');
  const [who, setWho] = useState('');
  const go = (action: 'retry' | 'skip' | 'reject' | 'stop' | 'reassign', extra = {}) => run(async () => { await flowService.runAction(r.id, action, extra); setMode(''); setWhy(''); onDone(); }, 'Done.');
  return (
    <div className="mt-2 space-y-2">
      <Notice tone="error"><b>Why it is stuck:</b> {r.stuckReason || 'It needs a decision from HR.'}</Notice>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {!mode && (
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={busy} onClick={() => go('retry')}><RefreshCw className="w-3.5 h-3.5" />Try again</button>
          <button className={btnGhost} onClick={() => setMode('skip')}>Skip this step</button>
          <button className={btnGhost} onClick={() => setMode('reassign')}>Choose someone else</button>
          <button className={btnGhost} onClick={() => setMode('reject')}>Reject the candidate</button>
          <button className={btnGhost} onClick={() => setMode('stop')}>Take out of the flow</button>
        </div>
      )}
      {mode === 'reassign' && (
        <div className="flex flex-wrap gap-2 items-center">
          <select className={`${input} !w-64`} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose a person...</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select>
          <button className={btnPrimary} disabled={busy || !who} onClick={() => go('reassign', { ownerUid: who })}>Give it to them</button>
          <button className={btnGhost} onClick={() => setMode('')}>Cancel</button>
        </div>
      )}
      {(mode === 'skip' || mode === 'reject' || mode === 'stop') && (
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700" htmlFor={`why-${r.id}`}>{mode === 'skip' ? 'Why are you skipping this step?' : mode === 'reject' ? 'Why are you rejecting this candidate?' : 'Why are you taking them out of the flow?'} (kept on record)</label>
          <textarea id={`why-${r.id}`} className={input} rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
          <div className="flex gap-2"><button className={btnPrimary} disabled={busy || !why.trim()} onClick={() => go(mode, { note: why })}>Confirm</button><button className={btnGhost} onClick={() => setMode('')}>Cancel</button></div>
        </div>
      )}
    </div>
  );
};

const Enroll: React.FC<{ open: boolean; onClose: () => void; inFlow: Set<string>; onDone: () => void }> = ({ open, onClose, inFlow, onDone }) => {
  const { data, loading, error } = useLoad(() => (open ? applicationsService.list() : Promise.resolve(null)), [open]);
  const { busy, note, run } = useRunner();
  const [pick, setPick] = useState<Set<string>>(new Set());
  const list = (data?.items || []).filter((a: any) => !inFlow.has(a.id) && a.status !== 'Rejected');
  return (
    <Drawer open={open} onClose={onClose} title="Add people who applied earlier" subtitle="They are not in the flow yet because they applied before it was published."
      footer={<div className="flex justify-between items-center"><span className="text-xs text-slate-500">{pick.size} chosen</span><button className={btnPrimary} disabled={busy || pick.size === 0} onClick={() => run(async () => { await flowService.enroll([...pick]); setPick(new Set()); onDone(); onClose(); }, 'Added to the flow.')}>Add to the flow</button></div>}>
      {loading && <Loading loading />}{error && <Loading error={error} />}
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {!loading && list.length === 0 && <p className="text-sm text-slate-500 text-center py-6">Everyone is already in the flow.</p>}
      <ul className="divide-y divide-slate-100">
        {list.map((a: any) => (
          <li key={a.id}><label className="flex items-center gap-3 py-2 cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={pick.has(a.id)} onChange={(e) => setPick((p) => { const n = new Set(p); e.target.checked ? n.add(a.id) : n.delete(a.id); return n; })} /><span className="text-sm"><b>{a.name}</b> <span className="text-slate-500">{a.designation} · {a.status}</span></span></label></li>
        ))}
      </ul>
    </Drawer>
  );
};

/** Where every applicant is in the flow, who they are waiting for, and what to do about the stuck ones. */
export const FlowRuns: React.FC<{ people: FlowState['people']; onChanged?: () => void }> = ({ people, onChanged }) => {
  const [filter, setFilter] = useState('');
  const [flowF, setFlowF] = useState('');
  const { data, error, loading, reload } = useLoad(() => flowService.runs(), []);
  const { busy, note, setNote, run } = useRunner();
  const [view, setView] = useState<FlowRunRow | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = data?.items || [];
  const counts = useMemo(() => rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {}), [rows]);
  const flowNames = [...new Set(rows.map((r) => r.flowName))].sort();
  const shown = rows.filter((r) => (!filter || r.status === filter) && (!flowF || r.flowName === flowF));
  const refresh = () => { onChanged?.(); reload(); };
  if (loading && !data) return <Loading loading />;
  if (error && !data) return <Loading error={error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-extrabold text-slate-900">Who is where</h2><p className="text-sm text-slate-600">Every applicant in your hiring flow. The app moves them on by itself when the work is done.</p></div>
        <div className="flex gap-2">
          <button className={btnGhost} onClick={() => setAdding(true)}><UserPlus className="w-4 h-4" />Add earlier applicants</button>
          <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { const r = await flowService.checkNow(); refresh(); setNote({ tone: 'ok', text: r.enrolled ? `Checked everyone. ${r.enrolled} new applicant${r.enrolled === 1 ? ' was' : 's were'} added to the flow.` : 'Checked everyone. No new applicants were waiting.' }); })}><RefreshCw className="w-4 h-4" />Check everyone now</button>
        </div>
      </div>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      {(counts.STUCK || 0) > 0 && <Notice tone="error"><b>{counts.STUCK} applicant{counts.STUCK === 1 ? ' needs' : 's need'} you.</b> They are at the top. Open one to see what to do.</Notice>}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`px-3 py-1.5 rounded-full text-xs font-bold border ${filter === f.key ? 'bg-[#FA7014] border-[#FA7014] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
            {f.label} {f.key ? `(${counts[f.key] || 0})` : `(${rows.length})`}
          </button>
        ))}
      </div>
      {flowNames.length > 1 && (
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">Show applicants of
          <select className={`${input} !w-auto`} value={flowF} onChange={(e) => setFlowF(e.target.value)}><option value="">All flows</option>{flowNames.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
      )}
      {shown.length === 0 ? (
        <Card><p className="text-sm text-slate-500 text-center py-6">{rows.length === 0 ? 'Nobody is in the flow yet. New applicants join it automatically once you publish a flow.' : 'Nobody here.'}</p></Card>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id} className={`rounded-xl border bg-white p-3 shadow-sm ${r.status === 'STUCK' ? 'border-rose-300' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button className="text-sm font-extrabold text-slate-900 hover:underline text-left" onClick={() => setView(r)}>{r.candidateName}</button>
                <span className="text-xs text-slate-500">{r.designation}</span>
                <Pill tone={TONE[r.status] || 'slate'}>{RUN_STATUS_WORDS[r.status] || r.status}</Pill>
                {r.late && <Pill tone="red"><AlertTriangle className="w-3 h-3 mr-1" />Late</Pill>}
                <span className="ml-auto text-[11px] text-slate-400">{r.flowName} · version {r.flowVersion}</span>
              </div>
              {!['HIRED', 'REJECTED', 'STOPPED'].includes(r.status) && (
                <p className="text-xs text-slate-600 mt-1">Step {r.stepNumber}: <b>{r.stepTitle}</b>{r.owner ? ` · waiting for ${r.owner}` : ''}{r.dueOn ? ` · due ${niceDate(r.dueOn)}` : ''}{r.waitUntil ? ` · carries on ${niceDate(r.waitUntil.slice(0, 10))}` : ''}</p>
              )}
              {r.status === 'STUCK' && <FixIt r={r} people={people} onDone={refresh} />}
            </li>
          ))}
        </ul>
      )}
      <Drawer open={!!view} onClose={() => setView(null)} title={view?.candidateName || ''} subtitle={view ? `${view.designation} · everything that happened, newest first` : ''}>
        {view && <History runId={view.id} />}
      </Drawer>
      <Enroll open={adding} onClose={() => setAdding(false)} inFlow={new Set(rows.map((r) => r.applicationId))} onDone={refresh} />
    </div>
  );
};
