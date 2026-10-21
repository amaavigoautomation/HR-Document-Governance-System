import React, { useState } from 'react';
import { Clock, Loader2, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import type { Company } from '../types';

interface Props {
  company: Company;
  email: string;
  suspended?: boolean;
  onCheckAgain: () => Promise<void>;
  onLogout: () => void;
}

/** Shown to a newly registered company (and to suspended ones). They have no access to company data yet. */
export const PendingApprovalView: React.FC<Props> = ({ company, email, suspended, onCheckAgain, onLogout }) => {
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      await onCheckAgain();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg shadow-slate-200/50">
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${suspended ? 'bg-rose-50 text-rose-600' : 'bg-orange-50 text-[#FA7014]'}`}>
          {suspended ? <ShieldAlert className="h-6 w-6" /> : <Clock className="h-6 w-6" />}
        </div>
        <h1 className="mt-4 text-lg font-black text-slate-900">
          {suspended ? 'Account suspended' : 'Registration received'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {suspended ? (
            <>Access for <b>{company.name}</b> is currently suspended. Please contact support.</>
          ) : (
            <>
              <b>{company.name}</b> is awaiting approval. We review every new company before activating it, and you
              will have full access as soon as it is approved.
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-slate-400">Signed in as {email}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {!suspended && (
            <button
              onClick={check}
              disabled={checking}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#FA7014] px-4 py-2 text-sm font-bold text-white hover:bg-[#E65A05] disabled:opacity-60"
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check again
            </button>
          )}
          <button
            onClick={onLogout}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
