import React, { useEffect, useState } from 'react';
import { offerService } from '../services/hiringExtraService';

const DOCS: [string, string][] = [['offerLetter', 'Offer letter'], ['compensation', 'Compensation'], ['checklist', 'Joining checklist'], ['nda', 'Non-disclosure agreement'], ['agreement', 'Employment agreement']];

/** Public page opened from the link in the candidate's offer email (/?offer=<token>). No login; the token is the credential. */
export const OfferResponsePage: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('offer') || '';
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [ask, setAsk] = useState('');
  const [mode, setMode] = useState<'' | 'NEGOTIATE' | 'DECLINE'>('');

  useEffect(() => { offerService.publicGet(token).then((r) => setInfo(r)).catch((e) => setError(e?.message || 'This link is not valid.')); }, [token]);

  const send = async (response: 'ACCEPT' | 'DECLINE' | 'NEGOTIATE') => {
    setBusy(true); setError('');
    try {
      await offerService.publicRespond({ token, response, confirm, note, expectedCtcLpa: ask });
      setDone(response === 'ACCEPT' ? 'Thank you. Your acceptance is recorded and our HR team will contact you about joining.' : response === 'DECLINE' ? 'Your response is recorded. Thank you for letting us know.' : 'Your request is with our HR team. They will come back to you.');
    } catch (e: any) { setError(e?.message || 'Something went wrong.'); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-3xl space-y-4">
        {error && <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        {!info && !error && <div className="text-sm text-slate-500">Loading your offer...</div>}
        {info && (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h1 className="text-xl font-black text-slate-900">Your offer from {info.companyName}</h1>
              <p className="mt-1 text-sm text-slate-600">{info.candidateName} - {info.designation}. Joining date {info.joiningDate}. {info.validTill && `Please answer by ${info.validTill}.`}</p>
              {info.status !== 'SENT' && <p className="mt-2 text-sm font-bold text-slate-700">Status: {String(info.status).replace('_', ' ').toLowerCase()}</p>}
            </div>
            {DOCS.filter(([k]) => info.pack?.[k]).map(([k, label]) => (
              <details key={k} className="rounded-2xl border border-slate-200 bg-white p-4" open={k === 'offerLetter'}>
                <summary className="cursor-pointer text-sm font-bold text-slate-800">{label}</summary>
                <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-slate-700">{info.pack[k]}</pre>
              </details>
            ))}
            {done && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{done}</div>}
            {!done && info.canRespond && (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
                <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I have read the documents above and I accept this offer.</label>
                <button disabled={busy || !confirm} onClick={() => send('ACCEPT')} className="rounded-lg bg-[#FA7014] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Accept offer</button>
                <div className="flex gap-2 text-xs">
                  <button className="rounded-lg border border-slate-300 px-3 py-2 font-bold" onClick={() => setMode('NEGOTIATE')}>Ask to discuss</button>
                  <button className="rounded-lg border border-slate-300 px-3 py-2 font-bold" onClick={() => setMode('DECLINE')}>Decline</button>
                </div>
                {mode && (
                  <div className="space-y-2">
                    {mode === 'NEGOTIATE' && <input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Expected CTC in lakhs per year (optional)" value={ask} onChange={(e) => setAsk(e.target.value)} />}
                    <textarea className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" rows={3} placeholder="Message to HR" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button disabled={busy} onClick={() => send(mode)} className="rounded-lg border border-slate-400 px-3 py-2 text-xs font-bold">{mode === 'DECLINE' ? 'Confirm decline' : 'Send request'}</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
