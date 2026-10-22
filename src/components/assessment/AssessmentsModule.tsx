import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Plus, RefreshCw, X } from 'lucide-react';
import type { User } from '../../types';
import { hasPerm } from '../../../shared/permissions';
import {
  assessmentService,
  type AssessmentDetail,
  type AssessmentSummary,
  type BankQuestionRow,
} from '../../services/assessmentService';
import { ComparisonTable, KIND_LABEL, ScoreBars, STATUS_LABEL, fmtDate, fmtDateTime, fmtPercent, statusBadge } from './AssessmentParts';
import { NewAssessmentForm, type FormMode } from './NewAssessmentForm';

const can = (user: User, key: string) => user.isCompanyAdmin === true || hasPerm(user.perms, key);

export const AssessmentsModule: React.FC<{ currentUser: User; users: User[] }> = ({ currentUser, users }) => {
  const canManage = can(currentUser, 'assess.manage');
  const canView = canManage || can(currentUser, 'assess.view');

  const [tab, setTab] = useState<'tests' | 'bank'>('tests');
  const [items, setItems] = useState<AssessmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [form, setForm] = useState<{ mode: FormMode; employeeUid?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await assessmentService.list()).items);
    } catch (e: any) {
      setError(e.message || 'Could not load assessments.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail((await assessmentService.get(id)).item);
      setShowReview(false);
    } catch (e: any) {
      setNote(e.message || 'Could not open this assessment.');
    }
  }, []);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  useEffect(() => {
    if (openId) loadDetail(openId);
    else setDetail(null);
  }, [openId, loadDetail]);

  const run = async (fn: () => Promise<any>, okMsg: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      setNote(okMsg);
      await load();
      if (openId) await loadDetail(openId);
    } catch (e: any) {
      setNote(e.message || 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const suggestions = useMemo(() => Array.from(new Set(items.flatMap((i) => i.skills))).sort(), [items]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!statusFilter || i.status === statusFilter) &&
        (!q || i.subject.name.toLowerCase().includes(q) || i.subject.email.toLowerCase().includes(q) || i.skills.some((s) => s.toLowerCase().includes(q)))
    );
  }, [items, search, statusFilter]);

  if (!canView) {
    return <div className="p-8 text-sm text-slate-600">You do not have access to skill assessments. Ask your company administrator.</div>;
  }

  const d = detail;
  const canRetest = !!d && canManage && d.status === 'COMPLETED' && !!d.subject.employeeUid;
  const canResend = !!d && canManage && !d.startedAt && (d.status === 'SENT' || d.status === 'EXPIRED');
  const canCancel = !!d && canManage && (d.status === 'SENT' || d.status === 'IN_PROGRESS');

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      <div className="bg-white rounded-2xl p-5 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-[#FA7014]" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Skill assessments</h1>
            <p className="text-xs text-slate-500">AI-written multiple-choice tests with a percentage score per skill, and retests to measure growth.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() => setForm({ mode: 'candidate' })}
              className="inline-flex items-center gap-1.5 text-xs font-black px-3 py-2 rounded-lg bg-[#FA7014] text-white hover:bg-[#e0630f] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> New test
            </button>
          )}
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">{error}</div>}
      {note && (
        <div className="bg-slate-900 text-white text-xs rounded-xl p-3 flex items-center justify-between">
          <span>{note}</span>
          <button type="button" onClick={() => setNote(null)} className="cursor-pointer" aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {form && canManage && (
        <NewAssessmentForm
          users={users}
          mode={form.mode}
          employeeUid={form.employeeUid}
          skillSuggestions={suggestions}
          onClose={() => setForm(null)}
          onCreated={(msg) => {
            setForm(null);
            setNote(msg);
            load();
          }}
        />
      )}

      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit text-xs font-bold">
        {([['tests', 'Tests'], ['bank', 'Question bank']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-md cursor-pointer ${tab === k ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'bank' ? (
        <QuestionBank canManage={canManage} />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or skill"
              className="border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white w-64"
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white">
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                  <th className="px-4 py-3">Person</th>
                  <th className="px-4 py-3">Test</th>
                  <th className="px-4 py-3">Skills</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      {loading ? 'Loading…' : items.length === 0 ? 'No tests yet. Click “New test” to create the first one.' : 'No tests match your filters.'}
                    </td>
                  </tr>
                )}
                {shown.map((i) => (
                  <tr key={i.id} onClick={() => setOpenId(i.id)} className={`cursor-pointer hover:bg-slate-50 ${openId === i.id ? 'bg-orange-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{i.subject.name}</div>
                      <div className="text-[10px] text-slate-500">{i.subject.email}</div>
                    </td>
                    <td className="px-4 py-3">{KIND_LABEL[i.kind] || i.kind}</td>
                    <td className="px-4 py-3">{i.skills.join(', ')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full border font-bold text-[11px] ${statusBadge(i.status)}`}>{STATUS_LABEL[i.status] || i.status}</span>
                    </td>
                    <td className="px-4 py-3 font-black">{i.result ? fmtPercent(i.result.overall.percent) : '—'}</td>
                    <td className="px-4 py-3">{fmtDate(i.completedAt || i.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {d && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{d.subject.name}</h2>
                  <p className="text-xs text-slate-500">
                    {d.subject.email} · {KIND_LABEL[d.kind] || d.kind} · {d.questionCount} questions · {d.durationMinutes} min
                  </p>
                </div>
                <button type="button" onClick={() => setOpenId(null)} className="p-1 rounded hover:bg-slate-100 cursor-pointer" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded-full border font-bold ${statusBadge(d.status)}`}>{STATUS_LABEL[d.status] || d.status}</span>
                <span className="text-slate-500">Sent {fmtDateTime(d.createdAt)}</span>
                {d.startedAt && <span className="text-slate-500">· started {fmtDateTime(d.startedAt)}</span>}
                {d.completedAt && <span className="text-slate-500">· finished {fmtDateTime(d.completedAt)}</span>}
                {!d.showResultToTaker && <span className="text-slate-400">· result hidden from the person</span>}
              </div>

              {d.status === 'COMPLETED' && (d.tabSwitches > 0 || d.lateBySeconds > 0) && (
                <div className="text-[11px] bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 space-y-0.5">
                  {d.tabSwitches > 0 && <div>Left the test page {d.tabSwitches} time{d.tabSwitches > 1 ? 's' : ''}.</div>}
                  {d.lateBySeconds > 0 && <div>Submitted {Math.ceil(d.lateBySeconds / 60)} minute(s) after the time limit.</div>}
                  <div className="text-amber-700">These are signals to discuss, not proof of anything.</div>
                </div>
              )}

              {d.result && <ScoreBars result={d.result} />}

              {d.comparison && (
                <div className="space-y-2">
                  <div className="text-xs font-black text-slate-900">
                    Growth since the first test{d.baseline ? ` (${fmtDate(d.baseline.completedAt)})` : ''}
                  </div>
                  <ComparisonTable comparison={d.comparison} beforeLabel="First test" afterLabel="This test" />
                </div>
              )}

              {(canRetest || canResend || canCancel) && (
                <div className="flex flex-wrap gap-2">
                  {canRetest && (
                    <button
                      type="button"
                      onClick={() => setForm({ mode: 'retest', employeeUid: d.subject.employeeUid! })}
                      className="text-xs font-black px-3 py-2 rounded-lg bg-[#FA7014] text-white hover:bg-[#e0630f] cursor-pointer"
                    >
                      Retest this person
                    </button>
                  )}
                  {canResend && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(async () => { const r = await assessmentService.resend(d.id); if (!r.emailSent) throw new Error('A new link was created but the email could not be sent.'); }, 'New link emailed.')}
                      className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-50 cursor-pointer"
                    >
                      Resend link
                    </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => assessmentService.cancel(d.id), 'Assessment cancelled.')}
                      className="text-xs font-bold px-3 py-2 rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer"
                    >
                      Cancel test
                    </button>
                  )}
                </div>
              )}

              {d.review.length > 0 && (
                <div className="space-y-2">
                  <button type="button" onClick={() => setShowReview((v) => !v)} className="text-xs font-bold text-[#FA7014] underline cursor-pointer">
                    {showReview ? 'Hide' : 'Show'} question-by-question review
                  </button>
                  {showReview && (
                    <ol className="space-y-3">
                      {d.review.map((r, idx) => (
                        <li key={idx} className={`rounded-xl border p-3 text-xs ${r.correct ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40'}`}>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                            {r.skill} · {r.difficulty}
                            {r.topic ? ` · ${r.topic}` : ''}
                          </div>
                          <div className="font-bold text-slate-900 mt-1 whitespace-pre-wrap">
                            {idx + 1}. {r.text}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {r.options.map((o, oi) => (
                              <li key={oi} className={`${oi === r.correctIndex ? 'text-emerald-700 font-bold' : oi === r.chosenIndex ? 'text-rose-700 font-bold' : 'text-slate-600'}`}>
                                {String.fromCharCode(65 + oi)}. {o}
                                {oi === r.correctIndex ? '  ✓ correct' : oi === r.chosenIndex ? '  ✗ chosen' : ''}
                              </li>
                            ))}
                          </ul>
                          {r.chosenIndex === null && <div className="mt-1 text-slate-500">Not answered.</div>}
                          {r.explanation && <div className="mt-2 text-slate-600">Why: {r.explanation}</div>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}

              {d.events.length > 0 && (
                <details className="text-[11px] text-slate-500">
                  <summary className="cursor-pointer font-bold">Activity</summary>
                  <ul className="mt-1 space-y-0.5">
                    {d.events.map((ev, idx) => (
                      <li key={idx}>
                        {fmtDateTime(ev.at)} — {ev.text}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** The saved AI-written questions for this company. HR can switch off any question that looks wrong. */
const QuestionBank: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [skills, setSkills] = useState<{ skill: string; total: number; active: number }[]>([]);
  const [items, setItems] = useState<BankQuestionRow[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (skill?: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await assessmentService.bank(skill);
      if (!skill) setSkills(r.skills);
      setItems(r.items);
    } catch (e: any) {
      setError(e.message || 'Could not load the question bank.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(selected || undefined);
  }, [load, selected]);

  const toggle = async (q: BankQuestionRow) => {
    const next = q.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      await assessmentService.setQuestionStatus(q.id, next);
      setItems((list) => list.map((x) => (x.id === q.id ? { ...x, status: next } : x)));
    } catch (e: any) {
      setError(e.message || 'Could not update the question.');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Questions are written by AI the first time a skill is tested and then reused. If a question looks wrong or unclear, switch it off and it will not be used again.
      </p>
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setSelected('')} className={`px-3 py-1.5 rounded-full border text-xs font-bold cursor-pointer ${!selected ? 'bg-orange-50 border-[#FA7014] text-[#FA7014]' : 'border-slate-200 text-slate-500'}`}>
          All skills
        </button>
        {skills.map((s) => (
          <button
            key={s.skill}
            type="button"
            onClick={() => setSelected(s.skill)}
            className={`px-3 py-1.5 rounded-full border text-xs font-bold cursor-pointer ${selected === s.skill ? 'bg-orange-50 border-[#FA7014] text-[#FA7014]' : 'border-slate-200 text-slate-500'}`}
          >
            {s.skill} · {s.active}/{s.total}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="text-xs text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-500">
          No questions yet. They are created automatically when you create the first test for a skill.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((q) => (
            <li key={q.id} className={`bg-white rounded-xl border p-3 text-xs ${q.status === 'ACTIVE' ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                    {q.skill} · {q.difficulty}
                    {q.topic ? ` · ${q.topic}` : ''} · used {q.timesUsed}×
                  </div>
                  <div className="font-bold text-slate-900 mt-1 whitespace-pre-wrap">{q.text}</div>
                  <ul className="mt-1.5 space-y-0.5">
                    {q.options.map((o, i) => (
                      <li key={i} className={i === q.correctIndex ? 'text-emerald-700 font-bold' : 'text-slate-600'}>
                        {String.fromCharCode(65 + i)}. {o}
                        {i === q.correctIndex ? '  ✓' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
                {canManage && (
                  <button type="button" onClick={() => toggle(q)} className="shrink-0 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer">
                    {q.status === 'ACTIVE' ? 'Switch off' : 'Switch on'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
