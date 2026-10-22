import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { assessmentService, type MyAssessment } from '../../services/assessmentService';
import { ComparisonTable, KIND_LABEL, ScoreBars, STATUS_LABEL, fmtDate, statusBadge } from './AssessmentParts';
import { TestRunner } from './TestRunner';

/**
 * "My skill assessments" for the signed-in person: tests waiting for them, their own results, and growth since the
 * first test. Renders nothing when they have never been given a test.
 */
export const EmployeeAssessments: React.FC = () => {
  const [items, setItems] = useState<MyAssessment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [taking, setTaking] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await assessmentService.mine()).items);
      setError(null);
    } catch (e: any) {
      // This card is optional; a failure must never get in the way of the rest of the portal.
      setError(e.message || null);
      setItems((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (items === null) return null;
  if (items.length === 0) return null;

  const pending = items.filter((a) => a.status === 'SENT' || a.status === 'IN_PROGRESS');

  return (
    <div className="mb-6 rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-black text-slate-900 cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-[#FA7014]" />
          My skill assessments
          {pending.length > 0 && <span className="px-2 py-0.5 rounded-full bg-[#FA7014] text-white text-[10px]">{pending.length} waiting</span>}
        </span>
        <span className="text-xs font-bold text-[#FA7014]">{open ? 'Hide' : 'Open'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4 space-y-4">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">{error}</div>}

          {taking ? (
            <div className="space-y-3">
              <TestRunner
                testRef={{ id: taking }}
                onDone={() => {
                  load();
                }}
              />
              <button type="button" onClick={() => { setTaking(null); load(); }} className="text-xs font-bold text-slate-600 underline cursor-pointer">
                Back to my assessments
              </button>
            </div>
          ) : (
            items.map((a) => {
              const canStart = a.status === 'SENT' || a.status === 'IN_PROGRESS';
              return (
                <div key={a.id} className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{a.skills.join(', ')}</div>
                      <div className="text-[11px] text-slate-500">
                        {KIND_LABEL[a.kind] || 'Skill test'} · {a.questionCount} questions · {a.durationMinutes} min ·{' '}
                        {a.completedAt ? `taken ${fmtDate(a.completedAt)}` : `sent ${fmtDate(a.createdAt)}`}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold shrink-0 ${statusBadge(a.status)}`}>{STATUS_LABEL[a.status] || a.status}</span>
                  </div>

                  {canStart && (
                    <button
                      type="button"
                      onClick={() => setTaking(a.id)}
                      className="text-xs font-black px-4 py-2 rounded-lg bg-[#FA7014] text-white hover:bg-[#e0630f] cursor-pointer"
                    >
                      {a.status === 'IN_PROGRESS' ? 'Continue the test' : 'Start the test'}
                    </button>
                  )}
                  {canStart && <p className="text-[11px] text-slate-500">Open until {fmtDate(a.expiresAt)}.</p>}

                  {a.status === 'COMPLETED' && a.resultHidden && (
                    <p className="text-xs text-slate-500">Your result was shared with HR. They will discuss it with you.</p>
                  )}
                  {a.result && (
                    <>
                      <button type="button" onClick={() => setViewing(viewing === a.id ? null : a.id)} className="text-xs font-bold text-[#FA7014] underline cursor-pointer">
                        {viewing === a.id ? 'Hide result' : 'See my result'}
                      </button>
                      {viewing === a.id && (
                        <div className="space-y-4">
                          <ScoreBars result={a.result} />
                          {a.comparison && (
                            <div className="space-y-2">
                              <div className="text-xs font-black text-slate-900">Your growth since your first test</div>
                              <ComparisonTable comparison={a.comparison} beforeLabel="First test" afterLabel="This test" />
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
          {!taking && (
            <button type="button" onClick={load} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 cursor-pointer">
              <Loader2 className="w-3 h-3" /> Refresh
            </button>
          )}
        </div>
      )}
    </div>
  );
};
