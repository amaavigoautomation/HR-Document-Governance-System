import React, { useCallback, useEffect, useState } from 'react';
import { onboardingService } from '../services/onboardingService';

type Info = Awaited<ReturnType<typeof onboardingService.publicInfo>>;

/** Public page opened from the link in the candidate's email. No login; the token is the credential. */
export const CandidateUploadPage: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await onboardingService.publicInfo(token));
    } catch (e: any) {
      setError(e.message || 'This link is not valid.');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const onPick = async (key: string, file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 4 * 1024 * 1024) {
      setError(`${file.name} is larger than 4 MB.`);
      return;
    }
    setBusyKey(key);
    try {
      await onboardingService.uploadDocument(token, key, file);
      await load();
    } catch (e: any) {
      setError(e.message || 'Upload failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onboardingService.submit(token);
      setDone(true);
      await load();
    } catch (e: any) {
      setError(e.message || 'Could not submit.');
    } finally {
      setSubmitting(false);
    }
  };

  const wrap = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50 flex justify-center px-4 py-10">
      <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">{children}</div>
    </div>
  );

  if (!info) {
    return wrap(<p className="text-sm text-slate-600">{error || 'Loading…'}</p>);
  }

  if (done || !info.open) {
    return wrap(
      <>
        <h1 className="text-lg font-bold text-slate-900">
          {done || info.status !== 'DOCS_REQUESTED' ? 'Documents received' : 'Upload closed'}
        </h1>
        <p className="text-sm text-slate-600">
          Thank you, {info.name}. Your documents have been submitted and our HR team will verify them and be in touch.
        </p>
      </>
    );
  }

  const missing = info.documents.filter((d) => d.required && !d.uploaded);
  return wrap(
    <>
      <div>
        <h1 className="text-lg font-bold text-slate-900">Onboarding documents</h1>
        <p className="text-sm text-slate-600">
          Hi {info.name}, please upload the documents below for your role as {info.designation} (Employee ID {info.employeeId}).
          PDF, JPG or PNG, up to 4 MB each.
        </p>
      </div>
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
        {info.documents.map((d) => (
          <li key={d.key} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
            <div>
              <div className="font-semibold text-slate-800">
                {d.label}
                {!d.required && <span className="text-slate-400 font-normal"> (if applicable)</span>}
              </div>
              <div className="text-xs text-slate-500">{d.uploaded ? `✓ ${d.uploaded.fileName}` : 'Not uploaded'}</div>
            </div>
            <label className="shrink-0 text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer">
              {busyKey === d.key ? 'Uploading…' : d.uploaded ? 'Replace' : 'Choose file'}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                disabled={busyKey !== null}
                onChange={(e) => {
                  onPick(d.key, e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || missing.length > 0}
        className="w-full py-3 rounded-xl bg-[#FA7014] text-white font-bold text-sm disabled:bg-slate-300 cursor-pointer"
      >
        {submitting ? 'Submitting…' : missing.length ? `Upload ${missing.length} more required document${missing.length > 1 ? 's' : ''}` : 'Submit documents'}
      </button>
      <p className="text-[11px] text-slate-400">Once submitted you will not be able to change your documents.</p>
    </>
  );
};
