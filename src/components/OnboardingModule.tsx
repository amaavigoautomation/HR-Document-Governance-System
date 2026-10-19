import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserCheck, ExternalLink, X } from 'lucide-react';
import { User, UserRole } from '../types';
import {
  onboardingService,
  OnboardingListItem,
  DocDef,
  AccountItemDef,
  STATUS_LABELS,
} from '../services/onboardingService';

const badge = (status: string) => {
  if (status === 'ONBOARDED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'REJECTED' || status === 'HR_STOPPED') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (status === 'PRIOR_EMPLOYEE_REVIEW' || status === 'DOCS_SUBMITTED' || status === 'ACCOUNTS_PENDING')
    return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

export const OnboardingModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const isHr = currentUser.role === UserRole.CREATOR;
  const [items, setItems] = useState<OnboardingListItem[]>([]);
  const [docDefs, setDocDefs] = useState<DocDef[]>([]);
  const [accountDefs, setAccountDefs] = useState<AccountItemDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Record<string, Record<string, string>>>({});
  const [rejectReason, setRejectReason] = useState('');
  const [dateEdit, setDateEdit] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await onboardingService.list(currentUser);
      setItems(r.items);
      setDocDefs(r.documents);
      setAccountDefs(r.accountItems);
    } catch (e: any) {
      setError(e.message || 'Could not load onboardings.');
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const r = await onboardingService.get(currentUser, id);
        setDetail(r.item);
        setAccounts(r.item.accounts || {});
        setDateEdit(r.item.onboardingDate || '');
        setRejectReason('');
      } catch (e: any) {
        setNote(e.message || 'Could not open this onboarding.');
      }
    },
    [currentUser]
  );

  useEffect(() => {
    if (isHr) load();
  }, [isHr, load]);

  useEffect(() => {
    if (openId) loadDetail(openId);
    else setDetail(null);
  }, [openId, loadDetail]);

  const run = async (fn: () => Promise<any>, okMsg?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (okMsg) setNote(okMsg);
      await load();
      if (openId) await loadDetail(openId);
    } catch (e: any) {
      setNote(e.message || 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!isHr) {
    return <div className="p-8 text-sm text-slate-600">Onboarding is available to HR only.</div>;
  }

  const d = detail;
  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      <div className="bg-white rounded-2xl p-5 border border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-[#FA7014]" />
          <div>
            <h1 className="text-lg font-bold text-slate-900">Onboarding</h1>
            <p className="text-xs text-slate-500">Start onboarding from the Candidate Comparison Matrix on the Overview page.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl p-3">{error}</div>}
      {note && <div className="bg-slate-900 text-white text-xs rounded-xl p-3">{note}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
              <th className="px-4 py-3">Employee ID</th>
              <th className="px-4 py-3">Candidate</th>
              <th className="px-4 py-3">Designation</th>
              <th className="px-4 py-3">Onboarding date</th>
              <th className="px-4 py-3">Stage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {loading ? 'Loading…' : 'No onboardings yet.'}
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr
                key={it.id}
                onClick={() => setOpenId(it.id)}
                className={`cursor-pointer hover:bg-slate-50 ${openId === it.id ? 'bg-orange-50/50' : ''}`}
              >
                <td className="px-4 py-3 font-mono font-bold">{it.employeeId}</td>
                <td className="px-4 py-3">
                  <div className="font-bold text-slate-900">{it.name}</div>
                  <div className="text-[10px] text-slate-500">{it.email}</div>
                </td>
                <td className="px-4 py-3">{it.designation}</td>
                <td className="px-4 py-3">{it.onboardingDate}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded-full border font-bold text-[11px] ${badge(it.status)}`}>
                    {STATUS_LABELS[it.status] || it.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {d.name} <span className="font-mono text-slate-500">({d.employeeId})</span>
              </h2>
              <p className="text-xs text-slate-500">
                {d.designation} · {d.email} · {d.mobile}
              </p>
            </div>
            <button type="button" onClick={() => setOpenId(null)} className="p-1 rounded hover:bg-slate-100 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Date */}
          {d.status !== 'ONBOARDED' && d.status !== 'REJECTED' && d.status !== 'HR_STOPPED' && (
            <div className="flex items-end gap-2 text-xs">
              <label className="font-bold text-slate-700">
                Onboarding date
                <input
                  type="date"
                  value={dateEdit}
                  onChange={(e) => setDateEdit(e.target.value)}
                  className="mt-1 block border border-slate-300 rounded-lg px-3 py-2"
                />
              </label>
              <button
                type="button"
                disabled={busy || !dateEdit || dateEdit === d.onboardingDate}
                onClick={() => run(() => onboardingService.updateDate(currentUser, d.id, dateEdit), 'Date updated.')}
                className="px-3 py-2 rounded-lg bg-slate-100 font-bold disabled:opacity-50 cursor-pointer"
              >
                Update
              </button>
            </div>
          )}

          {/* Prior employee decision */}
          {d.status === 'PRIOR_EMPLOYEE_REVIEW' && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-amber-900">This candidate may have worked at Amaavigo before</h3>
              <ul className="text-xs text-amber-900 space-y-1">
                {(d.priorMatches || []).map((m: any, i: number) => (
                  <li key={i}>
                    <strong>{m.source}</strong>: {m.name} ({m.id}) · {m.email} · {m.detail}
                  </li>
                ))}
              </ul>
              <details className="text-xs">
                <summary className="font-bold cursor-pointer">Candidate's full application data</summary>
                <pre className="mt-2 bg-white border border-amber-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(d.candidate, null, 2)}
                </pre>
              </details>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onboardingService.decidePrior(currentUser, d.id, 'PROCEED'), 'Moving forward. Document request sent.')}
                  className="px-3 py-2 rounded-lg bg-[#FA7014] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Move forward
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onboardingService.decidePrior(currentUser, d.id, 'STOP'), 'Process stopped.')}
                  className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Stop process
                </button>
              </div>
            </div>
          )}

          {/* Documents */}
          {['DOCS_REQUESTED', 'DOCS_SUBMITTED', 'ACCOUNTS_PENDING', 'READY_FOR_JOINING', 'ONBOARDED', 'REJECTED'].includes(d.status) && (
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Documents</h3>
              <ul className="text-xs divide-y divide-slate-100 border border-slate-200 rounded-xl">
                {docDefs.map((def) => {
                  const f = d.docs?.[def.key];
                  return (
                    <li key={def.key} className="px-3 py-2 flex items-center justify-between">
                      <span>
                        {def.label}
                        {!def.required && <span className="text-slate-400"> (optional)</span>}
                      </span>
                      {f ? (
                        f.url ? (
                          <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[#FA7014] font-bold inline-flex items-center gap-1">
                            {f.fileName} <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span>{f.fileName}</span>
                        )
                      ) : (
                        <span className="text-slate-400 italic">not uploaded</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {d.status === 'DOCS_REQUESTED' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onboardingService.resendDocs(currentUser, d.id), 'Request re-sent.')}
                  className="mt-3 px-3 py-2 rounded-lg bg-slate-100 text-xs font-bold cursor-pointer"
                >
                  Re-send upload link
                </button>
              )}
              {d.status === 'DOCS_SUBMITTED' && (
                <div className="mt-3 space-y-2">
                  <input
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Reason (only needed if rejecting)"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => onboardingService.reviewDocs(currentUser, d.id, 'VERIFY'), 'Documents verified.')}
                      className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Documents verified
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => onboardingService.reviewDocs(currentUser, d.id, 'REJECT', rejectReason), 'Candidate rejected.')}
                      className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      Verification failed: reject candidate
                    </button>
                  </div>
                </div>
              )}
              {d.status === 'REJECTED' && d.rejectionReason && (
                <p className="mt-2 text-xs text-rose-700">Rejected: {d.rejectionReason}</p>
              )}
            </div>
          )}

          {/* Accounts checklist */}
          {['ACCOUNTS_PENDING', 'READY_FOR_JOINING', 'ONBOARDED'].includes(d.status) && (
            <div>
              <h3 className="text-sm font-bold text-slate-900 mb-2">Accounts to create</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {accountDefs.map((item) => (
                  <div key={item.key} className="border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="text-xs font-bold text-slate-800">{item.label}</div>
                    {item.fields.map((f) => (
                      <input
                        key={f}
                        disabled={d.status === 'ONBOARDED'}
                        value={accounts[item.key]?.[f] || ''}
                        onChange={(e) =>
                          setAccounts((a) => ({ ...a, [item.key]: { ...(a[item.key] || {}), [f]: e.target.value } }))
                        }
                        placeholder={f.charAt(0).toUpperCase() + f.slice(1)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                      />
                    ))}
                  </div>
                ))}
              </div>
              {d.status !== 'ONBOARDED' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => onboardingService.saveAccounts(currentUser, d.id, accounts), 'Accounts saved.')}
                  className="mt-3 px-3 py-2 rounded-lg bg-[#FA7014] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Save accounts
                </button>
              )}
              {d.status === 'READY_FOR_JOINING' && (
                <p className="mt-2 text-xs text-emerald-700">
                  Checklist complete. Welcome and credentials emails go out at 9:00 AM IST on {d.onboardingDate}.
                </p>
              )}
            </div>
          )}

          {/* Timeline */}
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-2">Timeline</h3>
            <ul className="text-[11px] text-slate-600 space-y-1">
              {[...(d.events || [])].reverse().map((e: any, i: number) => (
                <li key={i}>
                  <span className="font-mono text-slate-400">{new Date(e.at).toLocaleString()}</span> · {e.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
