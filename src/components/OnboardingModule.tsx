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
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('ALL');

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
  const visibleItems = items.filter((it) => {
    const matchesQuery = !query || `${it.name} ${it.employeeId} ${it.designation} ${it.email}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (stageFilter === 'ALL' || it.status === stageFilter);
  });
  const countStatus = (statuses: string[]) => items.filter((it) => statuses.includes(it.status)).length;
  const metrics = [{ label: 'New joiners', value: items.length, tone: 'orange' }, { label: 'In progress', value: countStatus(['DOCS_REQUESTED', 'DOCS_SUBMITTED', 'PRIOR_EMPLOYEE_REVIEW']), tone: 'blue' }, { label: 'Ready for joining', value: countStatus(['READY_FOR_JOINING', 'ACCOUNTS_PENDING']), tone: 'green' }, { label: 'Onboarded', value: countStatus(['ONBOARDED']), tone: 'violet' }];
  const metricTone: Record<string, string> = { orange: 'bg-orange-50 text-orange-600', blue: 'bg-sky-50 text-sky-600', green: 'bg-emerald-50 text-emerald-600', violet: 'bg-violet-50 text-violet-600' };
  return (
    <div className="flex-1 w-full min-w-0 max-w-[1600px] mx-auto px-4 sm:px-6 xl:px-8 py-6 space-y-5 bg-[#F6F7F9]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#F36B21]">Talent acquisition</div><h1 className="text-[28px] font-bold tracking-tight text-slate-950">Onboarding</h1><p className="mt-1 text-sm text-slate-500">Manage new joiners, verify documents and prepare accounts for day one.</p></div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
      {note && <div className="rounded-xl bg-slate-900 p-3 text-xs text-white">{note}</div>}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metrics.map((m) => <div key={m.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${metricTone[m.tone]}`}><UserCheck className="h-4 w-4" /></div><div className="text-2xl font-bold text-slate-950">{loading && items.length === 0 ? '—' : m.value}</div><div className="mt-1 text-xs font-semibold text-slate-600">{m.label}</div></div>)}</div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)]">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><div><h2 className="text-sm font-bold text-slate-900">New joiners</h2><p className="mt-0.5 text-xs text-slate-500">Track document submission and account setup.</p></div><div className="flex flex-wrap gap-2"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, ID or role…" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#FA7014] sm:w-52" /><select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#FA7014]"><option value="ALL">All stages</option>{Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>
        <div className="overflow-x-auto">
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
            {visibleItems.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {loading ? 'Loading…' : 'No onboardings yet.'}
                </td>
              </tr>
            )}
            {visibleItems.map((it) => (
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
        <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-400">Showing {visibleItems.length} of {items.length} joiners</div>
      </section>
      {d ? (
        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-4 space-y-5">
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
                        <button
                          type="button"
                          onClick={() =>
                            onboardingService.openFile(currentUser, d.id, def.key).catch((e) => setNote(e.message))
                          }
                          className="text-[#FA7014] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          {f.fileName} <ExternalLink className="w-3 h-3" />
                        </button>
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
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#F36B21]"><UserCheck className="h-5 w-5" /></div><h2 className="mt-3 text-sm font-bold text-slate-800">Joiner details</h2><p className="mt-1 text-xs text-slate-500">Select a person from the list to review documents, account setup and onboarding history.</p></section>
      )}
      </div>
    </div>
  );
};
