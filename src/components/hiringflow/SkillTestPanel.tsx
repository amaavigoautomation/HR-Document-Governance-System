import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { skillTestService, type SkillQuestion, type SkillTest, type SkillTestRow } from '../../services/flowService';

const blank = (): SkillQuestion => ({ id: Math.random().toString(36).slice(2, 10), q: '', options: ['', '', '', ''], answer: 0 });
const LETTERS = ['A', 'B', 'C', 'D'];

/** Inside a "Skills test" step: one test per job title, made by the AI from the job description, editable by HR. */
export const SkillTestPanel: React.FC<{ jobTitles: string[]; questions: number }> = ({ jobTitles, questions }) => {
  const { busy, note, setNote, run } = useRunner();
  const [rows, setRows] = useState<SkillTestRow[]>([]);
  const [aiOn, setAiOn] = useState(true);
  const [title, setTitle] = useState(jobTitles[0] || '');
  const [test, setTest] = useState<SkillTest | null>(null);
  const [hasJd, setHasJd] = useState(true);
  const [draft, setDraft] = useState<SkillQuestion[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const l = await skillTestService.list(); setRows(l.tests); setAiOn(l.aiOn);
  }, []);
  const pick = useCallback(async (t: string) => {
    setDraft(null); setTest(null);
    if (!t) return;
    const r = await skillTestService.get(t); setTest(r.test); setHasJd(r.hasJd); setAiOn(r.aiOn);
  }, []);

  useEffect(() => { refresh().then(() => setLoaded(true)).catch(() => setLoaded(true)); }, [refresh]);
  useEffect(() => { if (!title && jobTitles[0]) setTitle(jobTitles[0]); }, [jobTitles, title]);
  useEffect(() => { pick(title).catch(() => undefined); }, [title, pick]);

  const missing = jobTitles.filter((j) => !rows.some((r) => r.designationKey === j.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()));
  const setQ = (i: number, patch: Partial<SkillQuestion>) => setDraft((d) => (d || []).map((q, k) => (k === i ? { ...q, ...patch } : q)));

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-3 space-y-3">
      <div>
        <p className="text-sm font-extrabold text-slate-900">The test questions</p>
        <p className="text-xs text-slate-600">One test per job title, so everyone applying for the same job gets the same questions. The app writes it from the job description. You can read and change every question.</p>
      </div>
      {loaded && missing.length > 0 && <Notice tone="warn">No test yet for: {missing.slice(0, 6).join(', ')}{missing.length > 6 ? ` and ${missing.length - 6} more` : ''}. Candidates for these jobs will wait until a test is made.</Notice>}
      {jobTitles.length === 0 ? <Notice>Choose the designations for this flow first, then make the test for each one.</Notice> : (
        <>
          <select className={input} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Job title">
            {jobTitles.map((j) => <option key={j} value={j}>{j}{rows.some((r) => r.designationKey === j.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()) ? ' ✓ test ready' : ' (no test yet)'}</option>)}
          </select>
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
          {!draft && (
            <div className="space-y-2">
              {test ? <p className="text-xs text-slate-700"><b>{test.questions.length} questions</b> ready ({test.source}). Each candidate gets the first {Math.min(questions, test.questions.length)}.</p>
                : <p className="text-xs text-slate-700">There is no test for this job title yet.</p>}
              {!hasJd && !test && <Notice tone="warn">This job title has no job description yet, so the AI has nothing to read. Add the job description first, or type the questions yourself.</Notice>}
              {!aiOn && <Notice tone="warn">The AI is not switched on for your company, so you can only type questions yourself.</Notice>}
              <div className="flex flex-wrap gap-2">
                {aiOn && <button className={btnPrimary} disabled={busy || !title || (!hasJd && !test)} onClick={() => run(async () => { const r = await skillTestService.generate(title, questions); setTest(r.test); await refresh(); }, test ? 'New test made. The old questions were replaced.' : 'Test made. Read it and change anything you like.')}><Sparkles className="inline w-4 h-4 mr-1" />{busy ? 'Writing the test...' : test ? 'Make a new test with AI' : 'Make the test with AI'}</button>}
                <button className={btnGhost} disabled={busy || !title} onClick={() => setDraft(test ? test.questions.map((q) => ({ ...q, options: [...q.options] })) : [blank(), blank(), blank(), blank(), blank()])}>{test ? 'Read and edit the questions' : 'Type the questions myself'}</button>
                {test && <button className="text-xs font-bold text-rose-700 hover:underline px-2" disabled={busy} onClick={() => { if (window.confirm(`Delete the test for ${title}? Applicants not yet sent a test will wait until a new one is made.`)) run(async () => { await skillTestService.remove(title); setTest(null); await refresh(); }, 'Test deleted.'); }}>Delete this test</button>}
              </div>
            </div>
          )}
          {draft && (
            <div className="space-y-3">
              {draft.map((q, i) => (
                <div key={q.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-extrabold text-slate-500 mt-2">{i + 1}.</span>
                    <textarea className={input} rows={2} placeholder="Question" value={q.q} maxLength={500} onChange={(e) => setQ(i, { q: e.target.value })} />
                    <button className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-700" aria-label={`Remove question ${i + 1}`} onClick={() => setDraft((d) => (d || []).filter((_, k) => k !== i))}><Trash2 className="w-4 h-4" /></button>
                  </div>
                  {q.options.map((o, k) => (
                    <label key={k} className="flex items-center gap-2 text-xs">
                      <input type="radio" name={`ans-${q.id}`} checked={q.answer === k} onChange={() => setQ(i, { answer: k })} aria-label={`Option ${LETTERS[k]} is correct`} />
                      <span className="font-bold text-slate-500 w-4">{LETTERS[k]}</span>
                      <input className={input} placeholder={`Answer ${LETTERS[k]}`} value={o} maxLength={250} onChange={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} />
                    </label>
                  ))}
                  <p className="text-[11px] text-slate-500">Tick the round button next to the correct answer.</p>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button className={btnGhost} disabled={draft.length >= 30} onClick={() => setDraft((d) => [...(d || []), blank()])}><Plus className="inline w-4 h-4 mr-1" />Add a question</button>
                <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { const r = await skillTestService.save(title, draft); setTest(r.test); setDraft(null); await refresh(); }, 'Test saved.')}>Save the test</button>
                <button className={btnGhost} disabled={busy} onClick={() => { setDraft(null); setNote(null); }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
