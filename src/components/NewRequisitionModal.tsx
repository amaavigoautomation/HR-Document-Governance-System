import React, { useMemo, useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { Requisition, User, UserRole } from '../types';
import { createRequisition, NewRequisitionInput } from '../services/requisitionService';
import { isDepartmentHead } from '../utils/requisitionPermissions';

interface Props {
  currentUser: User;
  users: User[];
  existing: Requisition[];
  onClose: () => void;
  onCreated: (req: Requisition) => void;
}

const field =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FA7014]/30 focus:border-[#FA7014]';
const label = 'block text-xs font-bold text-slate-600 mb-1';

export const NewRequisitionModal: React.FC<Props> = ({ currentUser, users, existing, onClose, onCreated }) => {
  const actorIsHead = isDepartmentHead(currentUser);

  // HR / founder raise on behalf of a department head (or any active employee if none are flagged yet)
  const requesterOptions = useMemo(() => {
    const employees = users.filter((u) => u.role === UserRole.EMPLOYEE && u.active !== false);
    const heads = employees.filter((u) => u.isDepartmentHead);
    return (heads.length ? heads : employees).sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const [requesterId, setRequesterId] = useState<string>(actorIsHead ? currentUser.id : requesterOptions[0]?.id || '');
  const requester = actorIsHead ? currentUser : users.find((u) => u.id === requesterId);

  const [positionTitle, setPositionTitle] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [vacancies, setVacancies] = useState(1);
  const [employmentType, setEmploymentType] = useState<NewRequisitionInput['employmentType']>('Full-time');
  const [location, setLocation] = useState('');
  const [minExp, setMinExp] = useState(0);
  const [maxExp, setMaxExp] = useState(0);
  const [urgency, setUrgency] = useState<NewRequisitionInput['urgency']>('MEDIUM');
  const [joinBy, setJoinBy] = useState('');
  const [budget, setBudget] = useState('');
  const [keySkills, setKeySkills] = useState('');
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveDept = departmentName || requester?.departmentName || '';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await createRequisition(
        currentUser,
        {
          positionTitle,
          departmentName: effectiveDept,
          vacancies,
          employmentType,
          location,
          minExperienceYears: minExp,
          maxExperienceYears: maxExp,
          urgency,
          expectedJoiningDate: joinBy,
          budgetRange: budget,
          justification,
          keySkills,
          requestedBy: requester,
        },
        existing
      );
      onCreated(created);
    } catch (err: any) {
      setError(err?.message || 'Could not submit the requisition.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-black text-slate-900">New hiring requisition</h2>
            <p className="text-xs text-slate-500">Goes to Head HR for assignment, then HR and the founder for approval.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-5">
          {!actorIsHead && (
            <div className="sm:col-span-2">
              <label className={label}>Requested by (department head / manager)</label>
              <select className={field} value={requesterId} onChange={(e) => setRequesterId(e.target.value)} required>
                {requesterOptions.length === 0 && <option value="">No employees found</option>}
                {requesterOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} - {u.departmentName}
                    {u.isDepartmentHead ? ' (dept head)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">You are raising this on their behalf; they will be notified of every decision.</p>
            </div>
          )}

          <div>
            <label className={label}>Position title *</label>
            <input className={field} value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} required maxLength={120} />
          </div>
          <div>
            <label className={label}>Department *</label>
            <input
              className={field}
              value={effectiveDept}
              onChange={(e) => setDepartmentName(e.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div>
            <label className={label}>Number of vacancies *</label>
            <input className={field} type="number" min={1} max={500} value={vacancies} onChange={(e) => setVacancies(Number(e.target.value))} required />
          </div>
          <div>
            <label className={label}>Employment type</label>
            <select className={field} value={employmentType} onChange={(e) => setEmploymentType(e.target.value as NewRequisitionInput['employmentType'])}>
              <option>Full-time</option>
              <option>Part-time</option>
              <option>Contract</option>
              <option>Internship</option>
            </select>
          </div>
          <div>
            <label className={label}>Location</label>
            <input className={field} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />
          </div>
          <div>
            <label className={label}>Urgency</label>
            <select className={field} value={urgency} onChange={(e) => setUrgency(e.target.value as NewRequisitionInput['urgency'])}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
            </select>
          </div>
          <div>
            <label className={label}>Min experience (years)</label>
            <input className={field} type="number" min={0} max={50} value={minExp} onChange={(e) => setMinExp(Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Max experience (years)</label>
            <input className={field} type="number" min={0} max={50} value={maxExp} onChange={(e) => setMaxExp(Number(e.target.value))} />
          </div>
          <div>
            <label className={label}>Expected joining date</label>
            <input className={field} type="date" value={joinBy} onChange={(e) => setJoinBy(e.target.value)} />
          </div>
          <div>
            <label className={label}>Budget range (optional)</label>
            <input className={field} value={budget} onChange={(e) => setBudget(e.target.value)} maxLength={80} placeholder="e.g. INR 6-8 LPA" />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Key skills (comma separated)</label>
            <input className={field} value={keySkills} onChange={(e) => setKeySkills(e.target.value)} maxLength={500} placeholder="React, Node.js, SQL" />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Business justification *</label>
            <textarea className={field} rows={4} value={justification} onChange={(e) => setJustification(e.target.value)} required maxLength={2000} />
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-[#FA7014] px-4 py-2 text-xs font-bold text-white hover:bg-[#E65A05] disabled:bg-slate-400"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Submit requisition
          </button>
        </div>
      </form>
    </div>
  );
};
