import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Loader2,
  AlertCircle,
  Paperclip,
  Check,
  XCircle,
  Sparkles,
  Send,
  UserCog,
  Download,
  Clock,
} from 'lucide-react';
import { Requisition, User, UserRole } from '../types';
import {
  assignRequisition,
  closeRequisition,
  founderDecide,
  generateJd,
  hrDecide,
  publishJob,
  readAttachment,
  saveJd,
} from '../services/requisitionService';
import { STATUS_LABEL, can, isFounder, isHr } from '../utils/requisitionPermissions';

interface Props {
  req: Requisition;
  currentUser: User;
  users: User[];
  allRequisitions: Requisition[];
  onClose: () => void;
}

const box = 'rounded-2xl border border-slate-200 bg-white p-4';
const field =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#FA7014]/30 focus:border-[#FA7014]';
const btnPrimary =
  'inline-flex items-center gap-2 rounded-xl bg-[#FA7014] px-4 py-2 text-xs font-bold text-white hover:bg-[#E65A05] disabled:bg-slate-400 disabled:cursor-not-allowed';
const btnGhost =
  'inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed';
const btnDanger =
  'inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:bg-slate-400 disabled:cursor-not-allowed';

const fmt = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '-';

const Row: React.FC<{ k: string; v?: React.ReactNode }> = ({ k, v }) => (
  <div className="flex justify-between gap-4 py-1.5 text-xs">
    <span className="font-semibold text-slate-500">{k}</span>
    <span className="text-right font-semibold text-slate-900">{v || '-'}</span>
  </div>
);

export const RequisitionDetailPanel: React.FC<Props> = ({ req, currentUser, users, allRequisitions, onClose }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // assignment
  const [assigneeId, setAssigneeId] = useState('');
  const [assignNote, setAssignNote] = useState('');
  // decisions
  const [comments, setComments] = useState('');
  const [file, setFile] = useState<File | null>(null);
  // JD
  const [jdText, setJdText] = useState(req.jd?.text || '');
  const [closeReason, setCloseReason] = useState('');

  // Keep the editor in sync when the stored JD changes (generate / save / remote edit),
  // but never overwrite text the user has typed and not yet saved.
  const lastSyncedJd = useRef(req.jd?.text || '');
  useEffect(() => {
    const incoming = req.jd?.text || '';
    setJdText((current) => (current === lastSyncedJd.current ? incoming : current));
    lastSyncedJd.current = incoming;
  }, [req.jd?.text]);

  const hrOptions = useMemo(
    () => users.filter((u) => u.role === UserRole.CREATOR && u.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [users]
  );
  const workload = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRequisitions) {
      if (r.ownerHr && r.status !== 'REJECTED' && r.status !== 'CLOSED') m.set(r.ownerHr.id, (m.get(r.ownerHr.id) || 0) + 1);
    }
    return m;
  }, [allRequisitions]);

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setError(null);
    setNotice(null);
    setBusy(key);
    try {
      await fn();
      if (success) setNotice(success);
      setComments('');
      setFile(null);
      setAssignNote('');
    } catch (e: any) {
      const msg: string = e?.message || 'Something went wrong.';
      setError(/permission|insufficient/i.test(msg) ? `${msg} (If this persists, the Firestore rules for "requisitions" may not be deployed yet.)` : msg);
    } finally {
      setBusy(null);
    }
  };

  const canSeeAttachment = isHr(currentUser) || isFounder(currentUser);
  const canEditJd = can(currentUser, 'editJd', req);
  const dirtyJd = jdText !== (req.jd?.text || '');

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true">
      <div className="h-full w-full max-w-3xl overflow-y-auto bg-slate-50 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-mono font-bold text-slate-500">{req.reqNo}</div>
            <h2 className="truncate text-lg font-black text-slate-900">{req.positionTitle}</h2>
            <div className="mt-1 inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-bold text-[#C2570C]">
              {STATUS_LABEL[req.status]}
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}
          {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">{notice}</div>}

          {/* Summary */}
          <div className={box}>
            <Row k="Department" v={req.departmentName} />
            <Row k="Requested by" v={`${req.requestedBy.name}${req.raisedBy.id !== req.requestedBy.id ? ` (raised by ${req.raisedBy.name})` : ''}`} />
            <Row k="Vacancies" v={req.vacancies} />
            <Row k="Type / location" v={`${req.employmentType}${req.location ? ` - ${req.location}` : ''}`} />
            <Row
              k="Experience"
              v={req.maxExperienceYears ? `${req.minExperienceYears}-${req.maxExperienceYears} yrs` : req.minExperienceYears ? `${req.minExperienceYears}+ yrs` : 'Not specified'}
            />
            <Row k="Urgency" v={req.urgency} />
            <Row k="Expected joining" v={req.expectedJoiningDate} />
            <Row k="Budget" v={req.budgetRange} />
            <Row k="HR owner" v={req.ownerHr ? `${req.ownerHr.name} (assigned by ${req.assignedByName})` : 'Not assigned'} />
            {req.jobId && <Row k="Job ID" v={req.jobId} />}
            <div className="mt-2 border-t border-slate-100 pt-2 text-xs">
              <div className="font-semibold text-slate-500">Key skills</div>
              <div className="text-slate-900">{req.keySkills || '-'}</div>
              <div className="mt-2 font-semibold text-slate-500">Justification</div>
              <div className="whitespace-pre-wrap text-slate-900">{req.justification}</div>
            </div>
          </div>

          {/* Decisions so far */}
          {(req.hrDecision || req.founderDecision) && (
            <div className={box}>
              {req.hrDecision && (
                <div className="text-xs">
                  <div className="font-black text-slate-900">
                    HR {req.hrDecision.decision === 'APPROVED' ? 'approved' : 'rejected'} - {req.hrDecision.byName}
                  </div>
                  <div className="text-slate-500">{fmt(req.hrDecision.at)}</div>
                  {req.hrDecision.comments && <p className="mt-1 whitespace-pre-wrap text-slate-800">{req.hrDecision.comments}</p>}
                </div>
              )}
              {req.hrAttachment && canSeeAttachment && (
                <a
                  href={req.hrAttachment.fileUrl}
                  download={req.hrAttachment.fileName}
                  className="mt-2 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <Paperclip className="w-3.5 h-3.5" /> {req.hrAttachment.fileName}
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                </a>
              )}
              {req.founderDecision && (
                <div className="mt-3 border-t border-slate-100 pt-3 text-xs">
                  <div className="font-black text-slate-900">
                    Founder {req.founderDecision.decision === 'APPROVED' ? 'approved' : 'rejected'} - {req.founderDecision.byName}
                  </div>
                  <div className="text-slate-500">{fmt(req.founderDecision.at)}</div>
                  {req.founderDecision.comments && <p className="mt-1 whitespace-pre-wrap text-slate-800">{req.founderDecision.comments}</p>}
                </div>
              )}
            </div>
          )}

          {/* Assign / reassign */}
          {can(currentUser, 'assign', req) && (
            <div className={box}>
              <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                <UserCog className="w-4 h-4 text-[#FA7014]" /> {req.ownerHr ? 'Reassign HR owner' : 'Assign to an HR'}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select className={field} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">Select HR...</option>
                  {hrOptions.map((u) => (
                    <option key={u.id} value={u.id} disabled={u.id === req.ownerHr?.id}>
                      {u.name}
                      {u.hrLevel === 'HEAD' ? ' (Head HR)' : ''} - {workload.get(u.id) || 0} open
                    </option>
                  ))}
                </select>
                <input className={field} placeholder="Note (optional)" value={assignNote} onChange={(e) => setAssignNote(e.target.value)} />
              </div>
              <button
                className={`${btnPrimary} mt-3`}
                disabled={!assigneeId || busy !== null}
                onClick={() => {
                  const hr = users.find((u) => u.id === assigneeId);
                  if (hr) run('assign', () => assignRequisition(currentUser, req, hr, assignNote), `Assigned to ${hr.name}.`).then(() => setAssigneeId(''));
                }}
              >
                {busy === 'assign' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {req.ownerHr ? 'Reassign' : 'Assign'}
              </button>
              {hrOptions.length === 0 && <p className="mt-2 text-xs text-slate-500">No active HR users found.</p>}
            </div>
          )}

          {/* HR decision */}
          {can(currentUser, 'hrDecide', req) && (
            <div className={box}>
              <div className="text-sm font-black text-slate-900">Your decision</div>
              <p className="mt-1 text-xs text-slate-500">
                Approve to attach a supporting document and forward to the founder, or reject with a reason.
              </p>
              <textarea className={`${field} mt-3`} rows={3} placeholder="Comments (required when rejecting)" value={comments} onChange={(e) => setComments(e.target.value)} />
              <label className="mt-3 block text-xs font-bold text-slate-600">Supporting document (required to approve, max 700 KB)</label>
              <input
                type="file"
                className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[#C2570C]"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className={btnPrimary}
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      'hr-approve',
                      async () => {
                        if (!file) throw new Error('Attach a supporting document before forwarding to the founder.');
                        const attachment = await readAttachment(file);
                        await hrDecide(currentUser, req, { decision: 'APPROVED', comments, attachment });
                      },
                      'Approved and forwarded to the founder.'
                    )
                  }
                >
                  {busy === 'hr-approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Approve and forward
                </button>
                <button
                  className={btnDanger}
                  disabled={busy !== null}
                  onClick={() => run('hr-reject', () => hrDecide(currentUser, req, { decision: 'REJECTED', comments }), 'Requisition rejected.')}
                >
                  {busy === 'hr-reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Founder decision */}
          {can(currentUser, 'founderDecide', req) && (
            <div className={box}>
              <div className="text-sm font-black text-slate-900">Founder decision</div>
              <textarea className={`${field} mt-3`} rows={3} placeholder="Comments (required when rejecting)" value={comments} onChange={(e) => setComments(e.target.value)} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className={btnPrimary}
                  disabled={busy !== null}
                  onClick={() => run('f-approve', () => founderDecide(currentUser, req, { decision: 'APPROVED', comments }), 'Approved. HR can now prepare the job description.')}
                >
                  {busy === 'f-approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Approve
                </button>
                <button
                  className={btnDanger}
                  disabled={busy !== null}
                  onClick={() => run('f-reject', () => founderDecide(currentUser, req, { decision: 'REJECTED', comments }), 'Requisition rejected.')}
                >
                  {busy === 'f-reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Job description */}
          {(req.status === 'JD_DRAFT' || req.status === 'JOB_OPEN') && (canEditJd || req.jd) && (
            <div className={box}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-black text-slate-900">Job description</div>
                {req.jd && (
                  <span className="text-[11px] font-semibold text-slate-500">
                    {req.jd.generatedBy === 'AI' ? 'AI generated' : req.jd.generatedBy === 'TEMPLATE' ? 'Template' : 'Manually written'} - edited by {req.jd.updatedByName}, {fmt(req.jd.updatedAt)}
                  </span>
                )}
              </div>

              {canEditJd && req.status === 'JD_DRAFT' && (
                <button
                  className={`${btnGhost} mt-3`}
                  disabled={busy !== null || (!!req.jd && dirtyJd)}
                  title={dirtyJd ? 'Save or discard your edits before regenerating' : undefined}
                  onClick={() => {
                    if (req.jd && !window.confirm('Regenerating replaces the current JD text. Continue?')) return;
                    run('gen', () => generateJd(currentUser, req), 'Job description generated. Review and edit it below.');
                  }}
                >
                  {busy === 'gen' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-[#FA7014]" />}
                  {req.jd ? 'Regenerate with AI' : 'Generate with AI'}
                </button>
              )}

              <textarea
                className={`${field} mt-3 font-mono text-[13px] leading-relaxed`}
                rows={18}
                readOnly={!canEditJd}
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder={canEditJd ? 'Generate with AI, or write the job description here...' : ''}
              />

              {canEditJd && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className={btnGhost}
                    disabled={busy !== null || !dirtyJd}
                    onClick={() => run('save-jd', () => saveJd(currentUser, req, jdText), 'Job description saved.')}
                  >
                    {busy === 'save-jd' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save changes
                  </button>
                  {req.status === 'JD_DRAFT' && (
                    <button
                      className={btnPrimary}
                      disabled={busy !== null || dirtyJd || !req.jd?.text.trim()}
                      title={dirtyJd ? 'Save your edits first' : undefined}
                      onClick={() => {
                        if (window.confirm('Publish this job description as an open job?')) {
                          run('publish', () => publishJob(currentUser, req), 'Published. The job is now open.');
                        }
                      }}
                    >
                      {busy === 'publish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Publish job
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Close job */}
          {can(currentUser, 'close', req) && (
            <div className={box}>
              <div className="text-sm font-black text-slate-900">Close this job</div>
              <input className={`${field} mt-3`} placeholder="Reason (e.g. position filled)" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
              <button
                className={`${btnDanger} mt-3`}
                disabled={busy !== null || !closeReason.trim()}
                onClick={() => run('close', () => closeRequisition(currentUser, req, closeReason), 'Job closed.')}
              >
                {busy === 'close' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Close job
              </button>
            </div>
          )}

          {req.status === 'CLOSED' && req.closedReason && <div className={`${box} text-xs`}><b>Closed:</b> {req.closedReason}</div>}

          {/* Timeline */}
          <div className={box}>
            <div className="mb-2 flex items-center gap-2 text-sm font-black text-slate-900">
              <Clock className="w-4 h-4 text-slate-400" /> History
            </div>
            <ol className="space-y-3 border-l border-slate-200 pl-4">
              {[...req.events].reverse().map((ev, i) => (
                <li key={`${ev.at}-${i}`} className="relative text-xs">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-[#FA7014]" />
                  <div className="font-bold text-slate-900">{ev.action}</div>
                  <div className="text-slate-500">
                    {ev.byName} - {fmt(ev.at)}
                  </div>
                  {ev.note && <div className="mt-0.5 whitespace-pre-wrap text-slate-700">{ev.note}</div>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
