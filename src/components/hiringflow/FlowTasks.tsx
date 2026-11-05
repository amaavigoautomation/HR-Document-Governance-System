import React, { useState } from 'react';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { Card, Notice, btnGhost, btnPrimary, input, niceDate, todayIst, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';
import { flowService, type FlowTask } from '../../services/flowService';

const OPEN_WORDS: Record<string, string> = { candidates: 'Open Candidates', interviews: 'Open Interviews', offers: 'Open Offers', joining: 'Open Joining' };

const dueWords = (t: FlowTask) => {
  const today = todayIst();
  if (t.dueOn < today) { const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${t.dueOn}T00:00:00Z`)) / 86400000); return { text: `${n} day${n === 1 ? '' : 's'} late`, tone: 'red' as const }; }
  if (t.dueOn === today) return { text: 'Due today', tone: 'amber' as const };
  return { text: `Due ${niceDate(t.dueOn)}`, tone: 'slate' as const };
};

const TaskCard: React.FC<{ t: FlowTask; onDone: () => void; onOpen?: (tab: string) => void }> = ({ t, onDone, onOpen }) => {
  const { busy, note, run } = useRunner();
  const [no, setNo] = useState(false);
  const [why, setWhy] = useState('');
  const due = dueWords(t);
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${t.late ? 'border-rose-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-base font-extrabold text-slate-900">{t.candidateName}</p>
          <p className="text-xs text-slate-500">{t.designation}</p>
        </div>
        <Pill tone={due.tone}>{due.text}</Pill>
      </div>
      <p className="mt-2 text-sm font-bold text-slate-800">{t.stepTitle}</p>
      {t.decide ? <p className="text-sm text-slate-700 mt-1">{t.question}</p> : <p className="text-sm text-slate-600 mt-1">{t.instruction}</p>}
      {note && <div className="mt-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
      {t.decide ? (
        <div className="mt-3 space-y-2">
          {!no ? (
            <div className="flex flex-wrap gap-2">
              <button className={`${btnPrimary} !px-5 !py-2.5 !text-sm`} disabled={busy} onClick={() => run(async () => { await flowService.decide(t.id, 'yes'); onDone(); }, 'Thanks, your answer is saved.')}>Yes</button>
              <button className={`${btnGhost} !px-5 !py-2.5 !text-sm`} disabled={busy} onClick={() => setNo(true)}>No</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700" htmlFor={`why-${t.id}`}>Why not? (a short reason is needed)</label>
              <textarea id={`why-${t.id}`} className={input} rows={2} value={why} onChange={(e) => setWhy(e.target.value)} />
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={busy || !why.trim()} onClick={() => run(async () => { await flowService.decide(t.id, 'no', why); onDone(); }, 'Thanks, your answer is saved.')}>Save my answer: No</button>
                <button className={btnGhost} onClick={() => setNo(false)}>Go back</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {t.link && onOpen && <button className={btnPrimary} onClick={() => onOpen(t.link)}><ExternalLink className="w-3.5 h-3.5" />{OPEN_WORDS[t.link] || 'Open'}</button>}
          {t.manualDone
            ? <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await flowService.markDone(t.id); onDone(); }, 'Thanks, marked as done.')}><CheckCircle2 className="w-3.5 h-3.5" />Mark done</button>
            : <span className="text-xs text-slate-500">This task finishes by itself when you complete the work there.</span>}
        </div>
      )}
    </div>
  );
};

/** The signed-in person's hiring tasks: what to do, by when, with the one button they need. */
export const FlowTasks: React.FC<{ onOpenTab?: (tab: string) => void; onChanged?: () => void }> = ({ onOpenTab, onChanged }) => {
  const { data, error, loading, reload } = useLoad(() => flowService.tasks(), []);
  if (loading && !data) return <Loading loading />;
  if (error && !data) return <Loading error={error} />;
  const open = data?.open || []; const recent = data?.recent || [];
  const done = () => { onChanged?.(); reload(); };
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-lg font-extrabold text-slate-900">My hiring tasks</h2><p className="text-sm text-slate-600">Things the hiring flow is waiting on you for. Late ones are at the top of your mind, in red.</p></div>
        <button className={btnGhost} onClick={reload}>Refresh</button>
      </div>
      {open.length === 0 ? (
        <Card><div className="text-center py-6"><CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" /><p className="text-sm font-bold text-slate-800 mt-2">You are all caught up</p><p className="text-xs text-slate-500">When a candidate needs something from you, it shows up here (and you get an email).</p></div></Card>
      ) : open.map((t) => <TaskCard key={t.id} t={t} onDone={done} onOpen={onOpenTab} />)}
      {recent.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <summary className="text-sm font-bold text-slate-700 cursor-pointer">Recently finished ({recent.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">{recent.map((t) => <li key={t.id} className="py-1.5 flex flex-wrap gap-x-3"><b>{t.candidateName}</b><span className="text-slate-600">{t.stepTitle}</span><span className="text-slate-400">{t.status === 'CANCELLED' ? 'cancelled' : t.resolution === 'skipped' ? 'skipped by HR' : 'done'}</span></li>)}</ul>
        </details>
      )}
    </div>
  );
};
