import React, { useEffect, useState } from 'react';
import { screenLinkService } from '../services/hiringExtraService';

/** Public page opened from the screening email (/?screen=<token>). The candidate sees who is calling, the role, and picks times. */
export const ScreeningLinkPage: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('screen') || '';
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [f, setF] = useState({ currentCompany: '', noticePeriod: '', currentCtc: '', expectedCtc: '', relocation: '', note: '' });
  const [slots, setSlots] = useState<string[]>(['']);
  useEffect(() => { screenLinkService.publicGet(token).then(setInfo).catch((e) => setError(e?.message || 'This link is not valid.')); }, [token]);
  const send = async (reschedule: boolean) => {
    setBusy(true); setError('');
    try { await screenLinkService.publicSubmit({ token, ...f, slots: slots.filter(Boolean), reschedule }); setDone(reschedule ? 'Thank you. HR will contact you with new times.' : 'Thank you. HR will confirm one of your times shortly.'); } catch (e: any) { setError(e?.message || 'Something went wrong.'); } finally { setBusy(false); }
  };
  const inp = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-2xl space-y-4">
      {error && <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      {!info && !error && <div className="text-sm text-slate-500">Loading...</div>}
      {info && (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-5"><h1 className="text-xl font-black text-slate-900">{info.companyName || 'Screening'}</h1><p className="text-sm text-slate-600">Hello {info.candidateName}, thank you for applying for {info.designation}.</p>
            {info.companyAbout && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{info.companyAbout}</p>}</div>
          {info.jobDescription && <details className="rounded-2xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-sm font-bold">About the role</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700">{info.jobDescription}</pre></details>}
          {done || info.answered ? <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{done || 'You have already answered. Thank you.'}</div> : (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
              <input className={inp} placeholder="Current company" value={f.currentCompany} onChange={(e) => setF({ ...f, currentCompany: e.target.value })} />
              <div className="grid gap-2 sm:grid-cols-3"><input className={inp} placeholder="Notice period" value={f.noticePeriod} onChange={(e) => setF({ ...f, noticePeriod: e.target.value })} /><input className={inp} placeholder="Current CTC" value={f.currentCtc} onChange={(e) => setF({ ...f, currentCtc: e.target.value })} /><input className={inp} placeholder="Expected CTC" value={f.expectedCtc} onChange={(e) => setF({ ...f, expectedCtc: e.target.value })} /></div>
              <input className={inp} placeholder="Open to relocation?" value={f.relocation} onChange={(e) => setF({ ...f, relocation: e.target.value })} />
              <div className="text-xs font-bold text-slate-700">Times that suit you for a call</div>
              {slots.map((s, i) => <input key={i} className={inp} type="datetime-local" value={s} onChange={(e) => setSlots(slots.map((x, k) => (k === i ? e.target.value : x)))} />)}
              {slots.length < 4 && <button className="text-xs font-bold text-[#FA7014]" onClick={() => setSlots([...slots, ''])}>Add another time</button>}
              <textarea className={inp} rows={2} placeholder="Anything else" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
              <div className="flex gap-2"><button disabled={busy || !slots.some(Boolean)} onClick={() => send(false)} className="rounded-lg bg-[#FA7014] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Submit</button><button disabled={busy} onClick={() => send(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">None of these work, please reschedule</button></div>
            </div>
          )}
        </>
      )}
    </div></div>
  );
};
