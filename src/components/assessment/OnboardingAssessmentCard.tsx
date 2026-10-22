import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Plus } from 'lucide-react';
import type { User } from '../../types';
import { hasPerm } from '../../../shared/permissions';
import { assessmentService, type AssessmentSummary } from '../../services/assessmentService';
import { ScoreBars, STATUS_LABEL, fmtDate, fmtPercent, statusBadge } from './AssessmentParts';
import { NewAssessmentForm } from './NewAssessmentForm';

const can = (user: User, key: string) => user.isCompanyAdmin === true || hasPerm(user.perms, key);

/**
 * "Skill assessment" step inside one candidate's onboarding: send the test, follow its status, read the score.
 * The result stays on record so it becomes the baseline for the employee's retests later.
 */
export const OnboardingAssessmentCard: React.FC<{
  currentUser: User;
  onboarding: { id: string; name: string; email: string; designation?: string };
}> = ({ currentUser, onboarding }) => {
  const canManage = can(currentUser, 'assess.manage');
  const canView = canManage || can(currentUser, 'assess.view');
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await assessmentService.list({ onboardingId: onboarding.id })).items);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Could not load the skill assessment.');
      setItems([]);
    }
  }, [onboarding.id]);

  useEffect(() => {
    setItems(null);
    setShowForm(false);
    setOpenId(null);
    if (canView) load();
  }, [canView, load]);

  if (!canView) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
          <ClipboardCheck className="w-4 h-4 text-[#FA7014]" /> Skill assessment
        </h3>
        {canManage && !showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#FA7014] text-white hover:bg-[#e0630f] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Send skill test
          </button>
        )}
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">{error}</div>}
      {note && <div className="bg-slate-900 text-white text-xs rounded-xl p-3">{note}</div>}

      {showForm && (
        <NewAssessmentForm
          mode="candidate"
          candidate={{ name: onboarding.name, email: onboarding.email, role: onboarding.designation, onboardingId: onboarding.id }}
          onClose={() => setShowForm(false)}
          onCreated={(msg) => {
            setShowForm(false);
            setNote(msg);
            load();
          }}
        />
      )}

      {items === null ? (
        <div className="text-xs text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-500">No skill test has been sent to this candidate yet. This step does not block joining.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.id} className="border border-slate-200 rounded-xl p-3 text-xs space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-slate-900">{a.skills.join(', ')}</div>
                  <div className="text-[11px] text-slate-500">
                    {a.questionCount} questions · {a.durationMinutes} min · sent {fmtDate(a.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.result && <span className="font-black text-slate-900">{fmtPercent(a.result.overall.percent)}</span>}
                  <span className={`px-2 py-0.5 rounded-full border font-bold text-[11px] ${statusBadge(a.status)}`}>{STATUS_LABEL[a.status] || a.status}</span>
                </div>
              </div>
              {a.result && (
                <>
                  <button type="button" onClick={() => setOpenId(openId === a.id ? null : a.id)} className="text-[#FA7014] font-bold underline cursor-pointer">
                    {openId === a.id ? 'Hide result' : 'See result'}
                  </button>
                  {openId === a.id && <ScoreBars result={a.result} />}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-slate-400">More detail, resending links and retests are in Talent Acquisition, Skill Assessments.</p>
    </div>
  );
};
