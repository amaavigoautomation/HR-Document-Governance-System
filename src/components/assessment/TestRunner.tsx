import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, ShieldAlert } from 'lucide-react';
import { assessmentService, type TakerAssessment } from '../../services/assessmentService';
import { ScoreBars, KIND_LABEL } from './AssessmentParts';

export interface TestRef {
  token?: string;
  id?: string;
}

const clock = (secs: number) => {
  const s = Math.max(0, secs);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const storeKey = (id: string) => `ama_assess_${id}`;

function readSaved(id: string): { answers: Record<string, number>; tabSwitches: number } {
  try {
    const raw = sessionStorage.getItem(storeKey(id));
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage may be unavailable */
  }
  return { answers: {}, tabSwitches: 0 };
}

function writeSaved(id: string, data: { answers: Record<string, number>; tabSwitches: number }) {
  try {
    sessionStorage.setItem(storeKey(id), JSON.stringify(data));
  } catch {
    /* best effort */
  }
}

/**
 * The test itself: intro, one question at a time with a server-enforced timer, then the result.
 * Used by the public candidate page (token) and by signed-in employees (id).
 */
export const TestRunner: React.FC<{ testRef: TestRef; onDone?: () => void }> = ({ testRef, onDone }) => {
  const [info, setInfo] = useState<TakerAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tabSwitches, setTabSwitches] = useState(0);
  const endsAt = useRef<number | null>(null);
  const submitting = useRef(false);
  const lastSwitch = useRef(0);

  const questions = info?.questions || [];
  const running = info?.status === 'IN_PROGRESS' && questions.length > 0;

  const load = useCallback(async () => {
    try {
      const r = await assessmentService.takerInfo(testRef);
      setInfo(r.assessment);
      // Reloading the page while a test is open resumes it.
      if (r.assessment.status === 'IN_PROGRESS' && (r.assessment.secondsLeft ?? 0) > 0) {
        const s = await assessmentService.start(testRef);
        enter(s.assessment);
      }
    } catch (e: any) {
      setError(e.message || 'This link is not valid.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testRef.token, testRef.id]);

  const enter = (a: TakerAssessment) => {
    setInfo(a);
    if (a.status === 'IN_PROGRESS') {
      const saved = readSaved(a.id);
      setAnswers(saved.answers);
      setTabSwitches(saved.tabSwitches);
      endsAt.current = Date.now() + (a.secondsLeft ?? 0) * 1000;
      setSecondsLeft(a.secondsLeft ?? 0);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await assessmentService.start(testRef);
      enter(r.assessment);
      setIndex(0);
    } catch (e: any) {
      setError(e.message || 'Could not start the test.');
    } finally {
      setBusy(false);
    }
  };

  const submit = useCallback(
    async (auto = false) => {
      if (!info || submitting.current) return;
      submitting.current = true;
      setBusy(true);
      setError(null);
      try {
        const saved = readSaved(info.id);
        const r = await assessmentService.submit(testRef, answers, Math.max(tabSwitches, saved.tabSwitches));
        setInfo(r.assessment);
        setConfirming(false);
        try {
          sessionStorage.removeItem(storeKey(info.id));
        } catch {
          /* ignore */
        }
        onDone?.();
      } catch (e: any) {
        submitting.current = false;
        setError(e.message || (auto ? 'Time is up, but your answers could not be sent. Please try again.' : 'Could not submit.'));
      } finally {
        setBusy(false);
      }
    },
    [answers, info, onDone, tabSwitches, testRef]
  );

  // Countdown. The server owns the real deadline; this only drives the display and the automatic submit.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (endsAt.current === null) return;
      const left = Math.round((endsAt.current - Date.now()) / 1000);
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(t);
        submit(true);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [running, submit]);

  // Leaving the test page is recorded (never blocked).
  useEffect(() => {
    if (!running) return;
    const note = () => {
      if (document.visibilityState === 'visible' && !document.hidden) return;
      const now = Date.now();
      if (now - lastSwitch.current < 1500) return;
      lastSwitch.current = now;
      setTabSwitches((n) => n + 1);
    };
    document.addEventListener('visibilitychange', note);
    return () => document.removeEventListener('visibilitychange', note);
  }, [running]);

  useEffect(() => {
    if (running && info) writeSaved(info.id, { answers, tabSwitches });
  }, [answers, tabSwitches, running, info]);

  const shell = (children: React.ReactNode) => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8">{children}</div>
  );

  if (error && !info) {
    return shell(
      <div className="text-center space-y-2">
        <ShieldAlert className="w-8 h-8 text-rose-500 mx-auto" />
        <p className="text-sm font-bold text-slate-900">{error}</p>
        <p className="text-xs text-slate-500">If you think this is a mistake, please contact the HR team that sent you the link.</p>
      </div>
    );
  }
  if (!info) {
    return shell(
      <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  // ---- finished
  if (info.status === 'COMPLETED') {
    return shell(
      <div className="space-y-5">
        <div className="text-center space-y-1">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <h2 className="text-lg font-black text-slate-900">Assessment submitted</h2>
          <p className="text-xs text-slate-500">
            {info.result ? 'Here is how you did.' : 'Thank you. The HR team will review your result and be in touch.'}
          </p>
        </div>
        {info.result && <ScoreBars result={info.result} />}
      </div>
    );
  }

  if (info.status === 'CANCELLED' || info.status === 'EXPIRED') {
    return shell(
      <div className="text-center space-y-2">
        <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto" />
        <p className="text-sm font-bold text-slate-900">
          {info.status === 'CANCELLED' ? 'This assessment was cancelled.' : 'This assessment has expired.'}
        </p>
        <p className="text-xs text-slate-500">Please contact HR if you need a new link.</p>
      </div>
    );
  }

  // ---- intro
  if (!running) {
    return shell(
      <div className="space-y-5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#FA7014]">{KIND_LABEL[info.kind] || 'Skill test'}</div>
          <h2 className="text-xl font-black text-slate-900 mt-1">Hello {info.name.split(' ')[0]}, your skill assessment</h2>
          {info.companyName && <p className="text-xs text-slate-500 mt-1">Prepared for you by {info.companyName}</p>}
        </div>
        <dl className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Questions</dt>
            <dd className="text-lg font-black text-slate-900">{info.questionCount}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Time</dt>
            <dd className="text-lg font-black text-slate-900">{info.durationMinutes} min</dd>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
            <dt className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Skills</dt>
            <dd className="text-lg font-black text-slate-900">{info.skills.length}</dd>
          </div>
        </dl>
        <p className="text-xs text-slate-700">
          <b>Covers:</b> {info.skills.join(', ')}
        </p>
        <ul className="text-xs text-slate-600 list-disc pl-5 space-y-1">
          <li>The timer starts when you press Start and cannot be paused.</li>
          <li>Each question has one correct answer. Unanswered questions score zero.</li>
          <li>Stay on this page. Switching to other tabs or windows is recorded.</li>
          <li>Do not refresh needlessly; if you do, you will continue where you left off.</li>
        </ul>
        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">{error}</div>}
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#FA7014] hover:bg-[#e0630f] disabled:opacity-60 text-white text-sm font-black rounded-xl py-3 cursor-pointer"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Start assessment
        </button>
      </div>
    );
  }

  // ---- taking the test
  const q = questions[index];
  const answeredCount = Object.keys(answers).length;
  const low = (secondsLeft ?? 999) <= 60;

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex items-center justify-between sticky top-2 z-10">
        <div className="text-xs font-bold text-slate-700">
          Question {index + 1} of {questions.length} <span className="text-slate-400 font-medium">· {answeredCount} answered</span>
        </div>
        <div className={`inline-flex items-center gap-1.5 text-sm font-black tabular-nums ${low ? 'text-rose-600' : 'text-slate-900'}`}>
          <Clock className="w-4 h-4" /> {clock(secondsLeft ?? 0)}
        </div>
      </div>

      {tabSwitches > 0 && (
        <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-2">
          You left this page {tabSwitches} time{tabSwitches > 1 ? 's' : ''}. This is recorded for HR.
        </div>
      )}

      {shell(
        <div className="space-y-5">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{q.skill}</span>
            <p className="text-base font-bold text-slate-900 mt-1 whitespace-pre-wrap">{q.text}</p>
          </div>
          <div role="radiogroup" className="space-y-2">
            {q.options.map((opt, i) => {
              const selected = answers[q.id] === i;
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}
                  className={`w-full text-left flex items-start gap-3 rounded-xl border px-4 py-3 text-sm cursor-pointer transition-colors ${
                    selected ? 'border-[#FA7014] bg-orange-50 text-slate-900 font-semibold' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span
                    className={`mt-0.5 w-5 h-5 shrink-0 rounded-full border flex items-center justify-center text-[10px] font-black ${
                      selected ? 'bg-[#FA7014] border-[#FA7014] text-white' : 'border-slate-300 text-slate-400'
                    }`}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="whitespace-pre-wrap">{opt}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
              className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Previous
            </button>
            {index < questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setIndex((i) => i + 1)}
                className="inline-flex items-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-xs font-black px-4 py-2 rounded-lg bg-[#FA7014] text-white hover:bg-[#e0630f] cursor-pointer"
              >
                Review and submit
              </button>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-3">
        <div className="flex flex-wrap gap-1.5">
          {questions.map((qq, i) => (
            <button
              key={qq.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to question ${i + 1}`}
              className={`w-7 h-7 rounded-lg text-[11px] font-bold cursor-pointer border ${
                i === index
                  ? 'border-[#FA7014] text-[#FA7014] bg-orange-50'
                  : answers[qq.id] !== undefined
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-[11px] font-bold text-slate-600 hover:text-slate-900 underline cursor-pointer"
          >
            Submit now
          </button>
        </div>
      </div>

      {confirming && (
        <div className="bg-white rounded-2xl border-2 border-[#FA7014] p-5 space-y-3">
          <p className="text-sm font-black text-slate-900">Submit your answers?</p>
          <p className="text-xs text-slate-600">
            You answered {answeredCount} of {questions.length} questions
            {answeredCount < questions.length ? `; ${questions.length - answeredCount} unanswered will score zero` : ''}. You cannot change them after submitting.
          </p>
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">{error}</div>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => submit(false)}
              className="inline-flex items-center gap-2 text-xs font-black px-4 py-2 rounded-lg bg-[#FA7014] text-white disabled:opacity-60 cursor-pointer"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Yes, submit
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="text-xs font-bold px-4 py-2 rounded-lg bg-slate-100 cursor-pointer">
              Keep working
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
