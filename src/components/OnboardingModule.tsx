import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, UserCheck, UserPlus, ClipboardList, CheckCircle2, Download, Search, ChevronLeft, ChevronRight, ExternalLink, X, CalendarDays, Clock, Check } from 'lucide-react';
import { Avatar } from './home/parts';
import { User, UserRole } from '../types';
import {
  onboardingService,
  OnboardingListItem,
  DocDef,
  AccountItemDef,
  STATUS_LABELS,
} from '../services/onboardingService';

const badge = (status: string) => {
  if (status === 'ONBOARDED') return 'bg-emerald-50 text-emerald-700';
  if (status === 'REJECTED' || status === 'HR_STOPPED') return 'bg-rose-50 text-rose-700';
  if (status === 'DOCS_REQUESTED') return 'bg-orange-50 text-orange-700';
  if (status === 'DOCS_SUBMITTED') return 'bg-sky-50 text-sky-700';
  if (status === 'ACCOUNTS_PENDING') return 'bg-amber-50 text-amber-700';
  if (status === 'READY_FOR_JOINING') return 'bg-violet-50 text-violet-700';
  if (status === 'PRIOR_EMPLOYEE_REVIEW') return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-700';
};

const PAGE = 10;
const TABS: { key: 'onboarding' | 'documents' | 'accounts'; label: string }[] = [
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'documents', label: 'Documents' },
  { key: 'accounts', label: 'Accounts' },
];

const exportCsv = (rows: OnboardingListItem[]) => {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Employee ID', 'Name', 'Email', 'Designation', 'Onboarding date', 'Stage'].join(',')].concat(
    rows.map((r) => [r.employeeId, r.name, r.email, r.designation, r.onboardingDate, STATUS_LABELS[r.status] || r.status].map(q).join(','))
  );
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'onboarding.csv';
  a.click();
  URL.revokeObjectURL(url);
};

const Check3: React.FC<{ on: boolean; label: string }> = ({ on, label }) => (
  <li className="flex items-center gap-3 text-sm text-slate-800">
    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${on ? 'bg-emerald-500 text-white' : 'border border-slate-300 bg-white'}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
    {label}
  </li>
);

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
  const [page, setPage] = useState(1);
  const [drawerTab, setDrawerTab] = useState<'onboarding' | 'documents' | 'accounts'>('onboarding');

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
    setDrawerTab('onboarding');
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
  const metrics = [
    { label: 'New joiners', value: items.length, tone: 'bg-orange-50', icon: 'bg-orange-100 text-orange-600', Icon: UserPlus },
    { label: 'In progress', value: countStatus(['DOCS_REQUESTED', 'DOCS_SUBMITTED', 'PRIOR_EMPLOYEE_REVIEW']), tone: 'bg-sky-50', icon: 'bg-sky-100 text-sky-600', Icon: ClipboardList },
    { label: 'Ready for joining', value: countStatus(['READY_FOR_JOINING', 'ACCOUNTS_PENDING']), tone: 'bg-emerald-50', icon: 'bg-emerald-100 text-emerald-600', Icon: UserCheck },
    { label: 'Onboarded', value: countStatus(['ONBOARDED']), tone: 'bg-emerald-50', icon: 'bg-emerald-100 text-emerald-600', Icon: CheckCircle2 },
  ];
  const pages = Math.max(1, Math.ceil(visibleItems.length / PAGE));
  const cur = Math.min(page, pages);
  const rows = visibleItems.slice((cur - 1) * PAGE, cur * PAGE);
  const closed = d && ['ONBOARDED', 'REJECTED', 'HR_STOPPED'].includes(d.status);
  const docsShown = d && ['DOCS_REQUESTED', 'DOCS_SUBMITTED', 'ACCOUNTS_PENDING', 'READY_FOR_JOINING', 'ONBOARDED', 'REJECTED'].includes(d.status);
  const accountsShown = d && ['ACCOUNTS_PENDING', 'READY_FOR_JOINING', 'ONBOARDED'].includes(d.status);
  const docDone = d ? docDefs.filter((x) => d.docs?.[x.key]).length : 0;
  const accountDone = (key: string, fields: string[]) => fields.length > 0 && fields.every((f) => (d?.accounts?.[key]?.[f] || '').trim());
  const accDone = d ? accountDefs.filter((x) => accountDone(x.key, x.fields)).length : 0;
  const field = 'rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-[#FA7014]';

  return (
    <div className="flex-1 w-full min-w-0 max-w-[1600px] mx-auto px-4 sm:px-6 xl:px-8 py-6 space-y-5 bg-[#F6F7F9]">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">Talent Acquisition <span className="mx-1">/</span> <span className="font-semibold text-slate-800">Onboarding</span></div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Onboarding</h1>
          <p className="mt-1 text-sm text-slate-600">Manage new joiners, track document submission and set up accounts.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#FA7014] hover:text-[#FA7014] cursor-pointer"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button type="button" disabled={visibleItems.length === 0} onClick={() => exportCsv(visibleItems)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#FA7014] hover:text-[#FA7014] disabled:opacity-50 cursor-pointer"><Download className="h-4 w-4" />Export</button>
        </div>
      </header>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{error}</div>}
      {note && <div className="rounded-xl bg-slate-900 p-3 text-xs text-white">{note}</div>}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className={`flex items-center gap-4 rounded-2xl border border-white p-4 ${m.tone}`}>
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${m.icon}`}><m.Icon className="h-5 w-5" /></span>
            <div><div className="text-sm font-semibold text-slate-700">{m.label}</div><div className="text-3xl font-bold text-slate-950">{loading && items.length === 0 ? '—' : m.value}</div></div>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search by name, employee ID or designation…" className={`${field} w-full pl-9`} />
            </label>
            <select value={stageFilter} onChange={(e) => { setStageFilter(e.target.value); setPage(1); }} className={field} aria-label="Stage">
              <option value="ALL">Stage: All</option>
              {Object.entries(STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 text-xs font-bold text-slate-700">
                    <th className="px-4 py-3">Emp. ID</th>
                    <th className="px-4 py-3">Candidate</th>
                    <th className="px-4 py-3">Designation</th>
                    <th className="px-4 py-3">Joining date</th>
                    <th className="px-4 py-3">Stage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">{loading ? 'Loading…' : 'No onboardings yet.'}</td></tr>
                  )}
                  {rows.map((it) => (
                    <tr key={it.id} onClick={() => setOpenId(it.id)} className={`cursor-pointer hover:bg-slate-50 ${openId === it.id ? 'bg-orange-50/60' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-700">{it.employeeId}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3"><Avatar name={it.name} /><div className="min-w-0"><div className="truncate font-bold text-slate-900">{it.name}</div><div className="truncate text-xs text-slate-500">{it.email}</div></div></div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{it.designation}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{it.onboardingDate}</td>
                      <td className="px-4 py-3"><span className={`inline-block whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${badge(it.status)}`}>{STATUS_LABELS[it.status] || it.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
              <span>{visibleItems.length === 0 ? 'Showing 0' : `Showing ${(cur - 1) * PAGE + 1} – ${Math.min(cur * PAGE, visibleItems.length)}`} of {visibleItems.length} onboardees</span>
              {pages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button type="button" aria-label="Previous page" disabled={cur === 1} onClick={() => setPage(cur - 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"><ChevronLeft className="h-4 w-4" /></button>
                  {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, cur - 3), Math.max(0, cur - 3) + 5).map((n) => (
                    <button key={n} type="button" onClick={() => setPage(n)} className={`h-9 w-9 rounded-lg border text-sm font-semibold cursor-pointer ${n === cur ? 'border-[#F36B21] bg-[#F36B21] text-white' : 'border-slate-200 text-slate-700'}`}>{n}</button>
                  ))}
                  <button type="button" aria-label="Next page" disabled={cur === pages} onClick={() => setPage(cur + 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-40 cursor-pointer"><ChevronRight className="h-4 w-4" /></button>
                </div>
              )}
            </div>
          </div>
        </section>

        {d ? (
          <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm xl:sticky xl:top-4">
            <div className="flex items-start justify-between gap-3 p-5 pb-0">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={d.name} size="lg" />
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold text-slate-900">{d.name}</h2>
                  <p className="truncate text-xs text-slate-500">{d.employeeId} • {d.designation}</p>
                  <p className="truncate text-xs text-slate-500">{d.email}{d.mobile ? ` · ${d.mobile}` : ''}</p>
                </div>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpenId(null)} className="rounded-lg p-1.5 hover:bg-slate-100 cursor-pointer"><X className="h-5 w-5" /></button>
            </div>
            <nav className="mt-4 flex gap-1 border-b border-slate-200 px-5" role="tablist">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={drawerTab === t.key} onClick={() => setDrawerTab(t.key)} className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold cursor-pointer ${drawerTab === t.key ? 'border-[#F36B21] text-[#F36B21]' : 'border-transparent text-slate-700 hover:text-slate-900'}`}>{t.label}</button>
              ))}
            </nav>

            <div className="space-y-5 p-5">
              {drawerTab === 'onboarding' && (
                <>
                  {d.status === 'PRIOR_EMPLOYEE_REVIEW' && (
                    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
                      <h3 className="text-sm font-bold text-amber-900">This candidate may have worked at Amaavigo before</h3>
                      <ul className="text-xs text-amber-900 space-y-1">
                        {(d.priorMatches || []).map((m: any, i: number) => (
                          <li key={i}><strong>{m.source}</strong>: {m.name} ({m.id}) · {m.email} · {m.detail}</li>
                        ))}
                      </ul>
                      <details className="text-xs">
                        <summary className="font-bold cursor-pointer">Candidate's full application data</summary>
                        <pre className="mt-2 bg-white border border-amber-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(d.candidate, null, 2)}</pre>
                      </details>
                      <div className="flex gap-2">
                        <button type="button" disabled={busy} onClick={() => run(() => onboardingService.decidePrior(currentUser, d.id, 'PROCEED'), 'Moving forward. Document request sent.')} className="px-3 py-2 rounded-lg bg-[#FA7014] text-white text-xs font-bold cursor-pointer disabled:opacity-50">Move forward</button>
                        <button type="button" disabled={busy} onClick={() => run(() => onboardingService.decidePrior(currentUser, d.id, 'STOP'), 'Process stopped.')} className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50">Stop process</button>
                      </div>
                    </div>
                  )}

                  {docDefs.length > 0 && (
                    <div>
                      <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-bold text-slate-900">Document checklist</h3><span className="text-sm font-semibold text-slate-600">{docDone}/{docDefs.length}</span></div>
                      <ul className="space-y-2.5">{docDefs.map((x) => <Check3 key={x.key} on={!!d.docs?.[x.key]} label={x.label} />)}</ul>
                    </div>
                  )}
                  {accountDefs.length > 0 && (
                    <div className="border-t border-slate-100 pt-5">
                      <div className="mb-3 flex items-center justify-between"><h3 className="text-base font-bold text-slate-900">Account setup</h3><span className="text-sm font-semibold text-slate-600">{accDone}/{accountDefs.length}</span></div>
                      <ul className="space-y-2.5">{accountDefs.map((x) => <Check3 key={x.key} on={accountDone(x.key, x.fields)} label={x.label} />)}</ul>
                    </div>
                  )}

                  <div className="border-t border-slate-100 pt-5">
                    <div className="flex items-start gap-3">
                      <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-900">Joining date</div>
                        <div className="text-sm text-slate-600">{d.onboardingDate}</div>
                        {!closed && (
                          <div className="mt-2 flex items-center gap-2">
                            <input type="date" value={dateEdit} onChange={(e) => setDateEdit(e.target.value)} className={field} />
                            <button type="button" disabled={busy || !dateEdit || dateEdit === d.onboardingDate} onClick={() => run(() => onboardingService.updateDate(currentUser, d.id, dateEdit), 'Date updated.')} className="px-3 py-2.5 rounded-xl bg-slate-100 text-sm font-bold disabled:opacity-50 cursor-pointer">Update</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-5">
                    <div className="flex items-start gap-3">
                      <Clock className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-900">Onboarding timeline</div>
                        <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                          {[...(d.events || [])].reverse().map((e: any, i: number) => (
                            <li key={i}><span className="text-slate-400">{new Date(e.at).toLocaleString()}</span> · {e.message}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {drawerTab === 'documents' && (
                docsShown ? (
                  <div>
                    <h3 className="text-base font-bold text-slate-900 mb-3">Documents</h3>
                    <ul className="text-sm divide-y divide-slate-100 border border-slate-200 rounded-xl">
                      {docDefs.map((def) => {
                        const f = d.docs?.[def.key];
                        return (
                          <li key={def.key} className="px-3 py-2.5 flex items-center justify-between gap-3">
                            <span>{def.label}{!def.required && <span className="text-slate-400"> (optional)</span>}</span>
                            {f ? (
                              <button type="button" onClick={() => onboardingService.openFile(currentUser, d.id, def.key).catch((e) => setNote(e.message))} className="text-[#FA7014] font-bold inline-flex items-center gap-1 cursor-pointer text-xs">
                                {f.fileName} <ExternalLink className="w-3 h-3" />
                              </button>
                            ) : (
                              <span className="text-slate-400 italic text-xs">not uploaded</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {d.status === 'DOCS_REQUESTED' && (
                      <button type="button" disabled={busy} onClick={() => run(() => onboardingService.resendDocs(currentUser, d.id), 'Request re-sent.')} className="mt-3 px-3 py-2 rounded-lg bg-slate-100 text-xs font-bold cursor-pointer">Re-send upload link</button>
                    )}
                    {d.status === 'DOCS_SUBMITTED' && (
                      <div className="mt-3 space-y-2">
                        <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason (only needed if rejecting)" className={`${field} w-full`} />
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={busy} onClick={() => run(() => onboardingService.reviewDocs(currentUser, d.id, 'VERIFY'), 'Documents verified.')} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50">Documents verified</button>
                          <button type="button" disabled={busy} onClick={() => run(() => onboardingService.reviewDocs(currentUser, d.id, 'REJECT', rejectReason), 'Candidate rejected.')} className="px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50">Verification failed: reject candidate</button>
                        </div>
                      </div>
                    )}
                    {d.status === 'REJECTED' && d.rejectionReason && <p className="mt-2 text-xs text-rose-700">Rejected: {d.rejectionReason}</p>}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Documents are requested once HR moves this candidate forward.</p>
                )
              )}

              {drawerTab === 'accounts' && (
                accountsShown ? (
                  <div>
                    <h3 className="text-base font-bold text-slate-900 mb-3">Accounts to create</h3>
                    <div className="grid gap-3">
                      {accountDefs.map((item) => (
                        <div key={item.key} className="border border-slate-200 rounded-xl p-3 space-y-2">
                          <div className="text-sm font-bold text-slate-800">{item.label}</div>
                          {item.fields.map((f) => (
                            <input key={f} disabled={d.status === 'ONBOARDED'} value={accounts[item.key]?.[f] || ''} onChange={(e) => setAccounts((a) => ({ ...a, [item.key]: { ...(a[item.key] || {}), [f]: e.target.value } }))} placeholder={f.charAt(0).toUpperCase() + f.slice(1)} className={`${field} w-full`} />
                          ))}
                        </div>
                      ))}
                    </div>
                    {d.status !== 'ONBOARDED' && (
                      <button type="button" disabled={busy} onClick={() => run(() => onboardingService.saveAccounts(currentUser, d.id, accounts), 'Accounts saved.')} className="mt-3 px-4 py-2.5 rounded-xl bg-[#F36B21] text-white text-sm font-bold cursor-pointer disabled:opacity-50">Save accounts</button>
                    )}
                    {d.status === 'READY_FOR_JOINING' && (
                      <p className="mt-2 text-xs text-emerald-700">Checklist complete. Welcome and credentials emails go out at 9:00 AM IST on {d.onboardingDate}.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Account setup opens after the documents are verified.</p>
                )
              )}
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center"><div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#F36B21]"><UserCheck className="h-5 w-5" /></div><h2 className="mt-3 text-sm font-bold text-slate-800">Joiner details</h2><p className="mt-1 text-xs text-slate-500">Select a person from the list to review documents, account setup and onboarding history.</p></section>
        )}
      </div>
    </div>
  );
};
