import React, { useCallback, useEffect, useRef, useState } from 'react';
import { skillTestService } from '../services/flowService';

type Q = { id: string; q: string; options: string[] };
const LETTERS = ['A', 'B', 'C', 'D'];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const keyFor = (token: string) => `amaavigo_test_${token.slice(0, 12)}`;

/** Public page opened from the link in the candidate's test email (/?test=<token>). No login; the token is the credential. */
export const SkillTestPage: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('test') || '';
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [left, setLeft] = useState(0);
  const [done, setDone] = useState(false);
  const sent = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await skillTestService.publicGet(token);
      setInfo(r);
      if (r.state === 'IN_PROGRESS') {
        setLeft(r.secondsLeft);
        try { const saved = JSON.parse(sessionStorage.getItem(keyFor(token)) || '{}'); if (saved && typeof saved === 'object') setAnswers(saved); } catch { /* fine without it */ }
      }
    } catch (e: any) { setError(e?.message || 'This link is not valid.'); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const submit = useCallback(async () => {
    if (sent.current) return;
    sent.current = true; setBusy(true); setError('');
    try { await skillTestService.publicSubmit(token, answers); setDone(true); try { sessionStorage.removeItem(keyFor(token)); } catch { /* ignore */ } }
    catch (e: any) { sent.current = false; setError(e?.message || 'Could not hand in the test. Please try again.'); }
    finally { setBusy(false); }
  }, [token, answers]);

  const running = info?.state === 'IN_PROGRESS' && !done;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => { if (running && left === 0 && info) submit(); }, [left, running, info, submit]);

  const choose = (qid: string, k: number) => {
    const next = { ...answers, [qid]: k }; setAnswers(next);
    try { sessionStorage.setItem(keyFor(token), JSON.stringify(next)); } catch { /* ignore */ }
  };
  const start = async () => {
    setBusy(true); setError('');
    try { const r = await skillTestService.publicStart(token); setInfo(r); setLeft(r.secondsLeft); setI(0); }
    catch (e: any) { setError(e?.message || 'Could not start the test.'); } finally { setBusy(false); }
  };

  const qs: Q[] = info?.questions || [];
  const q = qs[i];
  const answered = qs.filter((x) => answers[x.id] !== undefined).length;
  const message = done || info?.state === 'DONE'
    ? 'Thank you. Your test has been handed in. Our HR team will contact you about the next step.'
    : info?.state === 'EXPIRED' ? 'This test link has run out. Please contact HR and ask for a new one.'
    : info?.state === 'REPLACED' ? 'This link was replaced by a newer one. Please use the latest email from us.' : '';

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-2xl space-y-4">
        {error && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {!info && !error && <div className="text-sm text-slate-500">Loading your test...</div>}
        {info && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h1 className="text-xl font-black text-slate-900">Skills test for {info.designation}</h1>
            <p className="mt-1 text-sm text-slate-600">{info.companyName} · {info.candidateName}</p>
          </div>
        )}
        {message && <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5 text-sm font-semibold text-emerald-900">{message}</div>}
        {info?.state === 'READY' && !done && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
            <ul className="list-disc pl-5 space-y-1">
              <li>{info.questionCount} multiple-choice questions, one right answer each.</li>
              <li>You have {info.minutes} minutes. The clock starts when you press Start and does not stop.</li>
              <li>You can take the test only once. Please use a quiet place and a steady internet connection.</li>
              <li>Please do this on your own, without help from other people or tools.</li>
              <li>Start before {info.expiresOn}.</li>
            </ul>
            <button disabled={busy} onClick={start} className="rounded-lg bg-[#FA7014] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? 'Starting...' : 'Start the test'}</button>
          </div>
        )}
        {running && q && (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600">
              <span>Question {i + 1} of {qs.length} · {answered} answered</span>
              <span className={left <= 120 ? 'text-rose-700' : ''} aria-live="off">Time left {mmss(left)}</span>
            </div>
            <p className="text-base font-bold text-slate-900 whitespace-pre-wrap">{q.q}</p>
            <div className="space-y-2" role="radiogroup" aria-label="Answers">
              {q.options.map((o, k) => (
                <label key={k} className={`flex items-start gap-3 rounded-lg border p-3 text-sm cursor-pointer ${answers[q.id] === k ? 'border-[#FA7014] bg-orange-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" className="mt-1" name={`q-${q.id}`} checked={answers[q.id] === k} onChange={() => choose(q.id, k)} />
                  <span><b className="mr-1">{LETTERS[k]}.</b>{o}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-40" disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
              {i < qs.length - 1
                ? <button className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white" onClick={() => setI(i + 1)}>Next</button>
                : <button disabled={busy} className="rounded-lg bg-[#FA7014] px-4 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={() => { if (answered === qs.length || window.confirm(`You have answered ${answered} of ${qs.length} questions. Hand in anyway?`)) submit(); }}>{busy ? 'Handing in...' : 'Hand in the test'}</button>}
            </div>
            <div className="flex flex-wrap gap-1 pt-1" aria-label="Jump to a question">
              {qs.map((x, k) => <button key={x.id} onClick={() => setI(k)} aria-label={`Question ${k + 1}${answers[x.id] !== undefined ? ' answered' : ''}`} className={`h-7 w-7 rounded text-[11px] font-bold border ${k === i ? 'border-[#FA7014] text-[#FA7014]' : answers[x.id] !== undefined ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 text-slate-600'}`}>{k + 1}</button>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
