import React, { useState } from 'react';
import { hrbpService } from '../../services/hrbpService';
import { Card, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';

/** Pulse surveys. Managers create them and read results (hidden below 5 answers); everyone answers once, anonymously. */
export const Surveys: React.FC<{ manage: boolean }> = ({ manage }) => {
  const list = useLoad(() => hrbpService.get('survey-list'), []);
  const { run, busy, note } = useRunner();
  const [draft, setDraft] = useState({ title: '', questions: 'I enjoy my work | scale\nI would recommend this company | scale\nWhat should we change? | text' });
  const [answers, setAnswers] = useState<Record<string, Record<string, any>>>({});
  const [results, setResults] = useState<Record<string, any>>({});
  const items: any[] = list.data?.items || [];

  return (
    <div className={`grid gap-4 ${manage ? 'lg:grid-cols-5' : ''}`}>
      <div className={`space-y-3 ${manage ? 'lg:col-span-3' : ''}`}>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <Loading error={list.error} loading={list.loading} />
        {!list.loading && items.length === 0 && <EmptyState title="No surveys" text={manage ? 'Create a pulse survey on the right.' : 'Nothing to answer right now.'} />}
        {items.map((s) => (
          <Card key={s.id} title={s.title} right={<Pill tone={s.status === 'OPEN' ? (s.answered ? 'green' : 'amber') : 'slate'}>{s.status === 'OPEN' ? (s.answered ? 'answered' : 'open') : 'closed'}</Pill>}
            subtitle="Anonymous: your name is never stored with your answers.">
            {s.status === 'OPEN' && !s.answered && (
              <div className="space-y-3">
                {s.questions.map((q: any) => (
                  <Field key={q.id} label={q.text}>
                    {q.type === 'scale' ? (
                      <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setAnswers({ ...answers, [s.id]: { ...answers[s.id], [q.id]: n } })} className={`h-8 w-8 rounded-md border text-xs font-bold ${answers[s.id]?.[q.id] === n ? 'border-[#FA7014] bg-[#FA7014] text-white' : 'border-slate-300 bg-white text-slate-600'}`}>{n}</button>)}<span className="ml-2 self-center text-[11px] font-normal text-slate-400">1 = strongly disagree, 5 = strongly agree</span></div>
                    ) : <textarea className={input} rows={2} value={answers[s.id]?.[q.id] || ''} onChange={(e) => setAnswers({ ...answers, [s.id]: { ...answers[s.id], [q.id]: e.target.value } })} />}
                  </Field>
                ))}
                <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await hrbpService.post('survey-respond', { surveyId: s.id, answers: answers[s.id] || {} }); await list.reload(); }, 'Thank you. Your answers were saved anonymously.')}>Submit anonymously</button>
              </div>
            )}
            {manage && (
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <button className={btnGhost} onClick={() => run(async () => { const r = await hrbpService.get('survey-results', { surveyId: s.id }); setResults({ ...results, [s.id]: r }); })}>Results</button>
                  {s.status === 'OPEN' && <button className={btnGhost} onClick={() => run(async () => { await hrbpService.post('survey-close', { id: s.id }); await list.reload(); })}>Close survey</button>}
                </div>
                {results[s.id] && (
                  <div className="rounded-lg bg-slate-50 p-3 text-xs">
                    <div className="font-bold text-slate-800">{results[s.id].participation.responses} of {results[s.id].participation.people} answered ({results[s.id].participation.percent}%)</div>
                    {!results[s.id].results.visible ? <div className="mt-1 text-slate-600">Results appear once at least 5 people have answered ({results[s.id].results.needed} more needed). This protects everyone's anonymity.</div> : (
                      <div className="mt-2 space-y-2">
                        {results[s.id].results.questions.map((q: any) => (
                          <div key={q.id}><div className="font-semibold text-slate-700">{q.text}</div>{q.type === 'scale' ? <div>Average {q.average} out of 5 ({q.answered} answers)</div> : <ul className="list-disc pl-4 text-slate-600">{q.texts.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
      {manage && (
        <div className="lg:col-span-2">
          <Card title="New pulse survey">
            <div className="space-y-3">
              <Field label="Title"><input className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
              <Field label="Questions" hint="One per line. Add | scale (1-5 rating) or | text (free comment) at the end.">
                <textarea className={input} rows={6} value={draft.questions} onChange={(e) => setDraft({ ...draft, questions: e.target.value })} />
              </Field>
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await hrbpService.post('survey-save', { title: draft.title, questions: draft.questions.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.lastIndexOf('|'); return i > 0 ? { text: l.slice(0, i).trim(), type: l.slice(i + 1).trim() === 'text' ? 'text' : 'scale' } : { text: l, type: 'scale' }; }) }); setDraft({ ...draft, title: '' }); await list.reload(); }, 'Survey opened.')}>Open survey</button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
