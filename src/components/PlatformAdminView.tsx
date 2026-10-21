import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Loader2, LogOut, Pause, Play, RefreshCw } from 'lucide-react';
import type { Company } from '../types';
import { platformApi } from '../services/adminService';
import { MODULES } from '../../shared/permissions';

interface Props {
  email: string;
  onLogout: () => void;
}

const statusStyle: Record<Company['status'], string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  SUSPENDED: 'bg-rose-50 text-rose-700',
};

/** Platform administrators approve new companies and choose which modules each company gets. */
export const PlatformAdminView: React.FC<Props> = ({ email, onLogout }) => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  // Module choices per company that are being edited but not saved yet
  const [draft, setDraft] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCompanies(await platformApi.listCompanies());
    } catch (e: any) {
      setError(e?.message || 'Could not load companies.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const modulesFor = (c: Company) => draft[c.id] ?? (c.modules.length ? c.modules : MODULES.map((m) => m.key));
  const toggle = (c: Company, key: string) => {
    const cur = modulesFor(c);
    setDraft((d) => ({ ...d, [c.id]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] }));
  };

  const run = async (c: Company, fn: () => Promise<unknown>) => {
    setBusyId(c.id);
    setError('');
    try {
      await fn();
      setDraft((d) => {
        const { [c.id]: _, ...rest } = d;
        return rest;
      });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Action failed.');
    } finally {
      setBusyId('');
    }
  };

  const pending = companies.filter((c) => c.status === 'PENDING');

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div>
          <div className="text-sm font-black text-slate-900">Platform administration</div>
          <div className="text-xs text-slate-500">{email}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={onLogout} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Companies</h1>
          <p className="text-sm text-slate-500">
            {pending.length ? `${pending.length} waiting for approval.` : 'No companies are waiting for approval.'}
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center p-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-3">
            {companies.map((c) => {
              const mods = modulesFor(c);
              const busy = busyId === c.id;
              const changed = draft[c.id] !== undefined;
              return (
                <div key={c.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900">{c.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyle[c.status]}`}>{c.status}</span>
                      </div>
                      <div className="text-xs text-slate-500">{c.adminEmail} · registered {new Date(c.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {c.status === 'PENDING' && (
                        <button
                          disabled={busy || !mods.length}
                          onClick={() => run(c, () => platformApi.approve(c.id, mods))}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                        </button>
                      )}
                      {c.status === 'ACTIVE' && (
                        <>
                          {changed && (
                            <button
                              disabled={busy || !mods.length}
                              onClick={() => run(c, () => platformApi.updateModules(c.id, mods))}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FA7014] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#E65A05] disabled:opacity-50"
                            >
                              Save modules
                            </button>
                          )}
                          <button
                            disabled={busy}
                            onClick={() => window.confirm(`Suspend ${c.name}? Everyone in the company will lose access.`) && run(c, () => platformApi.suspend(c.id))}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <Pause className="h-3.5 w-3.5" /> Suspend
                          </button>
                        </>
                      )}
                      {c.status === 'SUSPENDED' && (
                        <button
                          disabled={busy}
                          onClick={() => run(c, () => platformApi.approve(c.id, mods))}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Play className="h-3.5 w-3.5" /> Reactivate
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 border-t border-slate-100 pt-3">
                    {MODULES.map((m) => (
                      <label key={m.key} className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <input type="checkbox" checked={mods.includes(m.key)} onChange={() => toggle(c, m.key)} disabled={c.status === 'SUSPENDED'} />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            {!companies.length && <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">No companies have registered yet.</div>}
          </div>
        )}
      </main>
    </div>
  );
};
