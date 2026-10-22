import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import type { User } from '../../types';
import { assessmentService, type AssessmentSummary, type SkillRequest } from '../../services/assessmentService';
import { MAX_QUESTIONS_PER_SKILL, MAX_SKILLS_PER_TEST, MIN_RELIABLE_QUESTIONS, type DifficultyPreset } from '../../../shared/assessment';
import { fmtDate } from './AssessmentParts';

export type FormMode = 'candidate' | 'employee' | 'retest';

export interface CandidatePrefill {
  name: string;
  email: string;
  role?: string;
  onboardingId?: string;
}

interface Props {
  /** Everyone in the company (used to pick an employee). */
  users?: User[];
  mode?: FormMode;
  /** When set, the form is locked to this person (used from the onboarding screen). */
  candidate?: CandidatePrefill;
  /** Pre-selected employee for a retest. */
  employeeUid?: string;
  skillSuggestions?: string[];
  onCreated: (message: string) => void;
  onClose: () => void;
}

const field = 'mt-1 block w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white';
const label = 'text-xs font-bold text-slate-700 block';

export const NewAssessmentForm: React.FC<Props> = ({ users = [], mode: startMode = 'candidate', candidate, employeeUid: startUid, skillSuggestions = [], onCreated, onClose }) => {
  const [mode, setMode] = useState<FormMode>(candidate ? 'candidate' : startMode);
  const [name, setName] = useState(candidate?.name || '');
  const [email, setEmail] = useState(candidate?.email || '');
  const [employeeUid, setEmployeeUid] = useState(startUid || '');
  const [skills, setSkills] = useState<SkillRequest[]>([{ skill: '', count: 10, preset: 'balanced' }]);
  const [duration, setDuration] = useState(30);
  const [expiryDays, setExpiryDays] = useState(7);
  const [showResult, setShowResult] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Retest: the person's earlier completed tests decide the baseline and the skills.
  const [history, setHistory] = useState<AssessmentSummary[] | null>(null);
  const [retestSkills, setRetestSkills] = useState<string[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const employees = useMemo(
    () => users.filter((u) => u.authUid && u.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [users]
  );

  useEffect(() => {
    // Sensible default for who sees the result: employees do, candidates do not.
    setShowResult(mode !== 'candidate');
  }, [mode]);

  useEffect(() => {
    if (mode !== 'retest' || !employeeUid) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);
    assessmentService
      .history({ employeeUid })
      .then((r) => {
        if (cancelled) return;
        setHistory(r.items);
        const first = r.items[0];
        setRetestSkills(first ? first.skills : []);
        if (first) setDuration(first.durationMinutes);
      })
      .catch((e) => !cancelled && setError(e.message || 'Could not load earlier tests.'))
      .finally(() => !cancelled && setLoadingHistory(false));
    return () => {
      cancelled = true;
    };
  }, [mode, employeeUid]);

  const setSkill = (i: number, patch: Partial<SkillRequest>) => setSkills((list) => list.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'retest') {
        if (!employeeUid) throw new Error('Choose the employee to retest.');
        const r = await assessmentService.retest({
          employeeUid,
          skills: retestSkills,
          durationMinutes: duration,
          expiresInDays: expiryDays,
          showResultToTaker: showResult,
          sendEmail,
        });
        onCreated(sendEmail ? (r.emailSent ? 'Retest created and emailed.' : 'Retest created, but the email could not be sent. Use Resend link.') : 'Retest created.');
      } else {
        const clean = skills.map((s) => ({ ...s, skill: s.skill.trim() })).filter((s) => s.skill);
        if (clean.length === 0) throw new Error('Add at least one skill.');
        const r = await assessmentService.create({
          kind: mode === 'candidate' ? 'PRE_HIRE' : 'GENERAL',
          ...(mode === 'candidate'
            ? { name: name.trim(), email: email.trim(), role: candidate?.role, onboardingId: candidate?.onboardingId }
            : { employeeUid }),
          skills: clean,
          durationMinutes: duration,
          expiresInDays: expiryDays,
          showResultToTaker: showResult,
          sendEmail,
        });
        onCreated(sendEmail ? (r.emailSent ? 'Test created and emailed.' : 'Test created, but the email could not be sent. Use Resend link.') : 'Test created.');
      }
    } catch (err: any) {
      setError(err.message || 'Could not create the test.');
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'retest' ? 'Retest an employee' : mode === 'employee' ? 'New test for an employee' : 'New test for a candidate';

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {mode === 'retest'
              ? 'Uses the same skills and difficulty mix as their first test, with new questions, so the two scores can be compared.'
              : 'Type any skill, technical or not. The AI writes the questions for it.'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 cursor-pointer" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!candidate && (
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit text-xs font-bold">
          {([['candidate', 'Candidate'], ['employee', 'Employee'], ['retest', 'Retest']] as [FormMode, string][]).map(([m, l]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md cursor-pointer ${mode === m ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500'}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {/* who */}
      {mode === 'candidate' ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <label className={label}>
            Candidate name
            <input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!candidate} required className={field} />
          </label>
          <label className={label}>
            Candidate email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={!!candidate} required className={field} />
          </label>
        </div>
      ) : (
        <label className={label}>
          Employee
          <select value={employeeUid} onChange={(e) => setEmployeeUid(e.target.value)} required className={field}>
            <option value="">Choose a person…</option>
            {employees.map((u) => (
              <option key={u.authUid} value={u.authUid}>
                {u.name} — {u.email}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* what */}
      {mode === 'retest' ? (
        <div className="space-y-2">
          {loadingHistory && (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking up their first test…
            </div>
          )}
          {history && history.length === 0 && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              This person has no completed test yet, so there is nothing to compare with. Use the Employee tab to give them a first test.
            </div>
          )}
          {history && history.length > 0 && (
            <>
              <p className="text-xs text-slate-600">
                Comparing with the test completed on <b>{fmtDate(history[0].completedAt)}</b> ({history[0].questionCount} questions). Skills to retest:
              </p>
              <div className="flex flex-wrap gap-2">
                {history[0].skills.map((s) => {
                  const on = retestSkills.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setRetestSkills((cur) => (on ? cur.filter((x) => x !== s) : [...cur, s]))}
                      className={`px-3 py-1.5 rounded-full border text-xs font-bold cursor-pointer ${on ? 'bg-orange-50 border-[#FA7014] text-[#FA7014]' : 'border-slate-200 text-slate-500'}`}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-700">Skills to test</div>
          <datalist id="assess-skill-suggestions">
            {skillSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {skills.map((s, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <label className="col-span-12 sm:col-span-6 text-[11px] font-bold text-slate-600">
                {i === 0 ? 'Skill (for example React, B2B sales, Excel)' : 'Skill'}
                <input
                  list="assess-skill-suggestions"
                  value={s.skill}
                  maxLength={60}
                  onChange={(e) => setSkill(i, { skill: e.target.value })}
                  placeholder="Type a skill"
                  className={field}
                />
              </label>
              <label className="col-span-5 sm:col-span-2 text-[11px] font-bold text-slate-600">
                Questions
                <input
                  type="number"
                  min={1}
                  max={MAX_QUESTIONS_PER_SKILL}
                  value={s.count}
                  onChange={(e) => setSkill(i, { count: Math.max(1, Math.min(MAX_QUESTIONS_PER_SKILL, Number(e.target.value) || 1)) })}
                  className={field}
                />
              </label>
              <label className="col-span-5 sm:col-span-3 text-[11px] font-bold text-slate-600">
                Difficulty
                <select value={s.preset} onChange={(e) => setSkill(i, { preset: e.target.value as DifficultyPreset })} className={field}>
                  <option value="easy">Mostly easy</option>
                  <option value="balanced">Balanced</option>
                  <option value="hard">Mostly hard</option>
                </select>
              </label>
              <button
                type="button"
                disabled={skills.length === 1}
                onClick={() => setSkills((list) => list.filter((_, idx) => idx !== i))}
                className="col-span-2 sm:col-span-1 p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 disabled:opacity-30 cursor-pointer"
                aria-label="Remove skill"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {s.count < MIN_RELIABLE_QUESTIONS && s.skill.trim() && (
                <p className="col-span-12 text-[10px] text-amber-600">
                  With fewer than {MIN_RELIABLE_QUESTIONS} questions the percentage for {s.skill.trim()} is only a rough guide.
                </p>
              )}
            </div>
          ))}
          {skills.length < MAX_SKILLS_PER_TEST && (
            <button
              type="button"
              onClick={() => setSkills((list) => [...list, { skill: '', count: 10, preset: 'balanced' }])}
              className="inline-flex items-center gap-1 text-xs font-bold text-[#FA7014] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add another skill
            </button>
          )}
        </div>
      )}

      {/* how */}
      <div className="grid sm:grid-cols-3 gap-3">
        <label className={label}>
          Time limit (minutes)
          <input type="number" min={5} max={180} value={duration} onChange={(e) => setDuration(Math.max(5, Math.min(180, Number(e.target.value) || 30)))} className={field} />
        </label>
        <label className={label}>
          Link valid for (days)
          <input type="number" min={1} max={30} value={expiryDays} onChange={(e) => setExpiryDays(Math.max(1, Math.min(30, Number(e.target.value) || 7)))} className={field} />
        </label>
        <div className="space-y-2 pt-5">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={showResult} onChange={(e) => setShowResult(e.target.checked)} /> Show the result to the person
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} /> Email the link now
          </label>
        </div>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">{error}</div>}
      {busy && <div className="bg-slate-50 border border-slate-200 text-slate-600 text-xs rounded-xl p-3">The AI is writing the questions. This can take up to a minute.</div>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || (mode === 'retest' && (!history || history.length === 0 || retestSkills.length === 0))}
          className="inline-flex items-center gap-2 text-xs font-black px-4 py-2.5 rounded-lg bg-[#FA7014] text-white hover:bg-[#e0630f] disabled:opacity-50 cursor-pointer"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {mode === 'retest' ? 'Create retest' : 'Create test'}
        </button>
        <button type="button" onClick={onClose} className="text-xs font-bold px-4 py-2.5 rounded-lg bg-slate-100 cursor-pointer">
          Cancel
        </button>
      </div>
    </form>
  );
};
