import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Sunrise, Sunset, Sun } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { addDaysIso, btnBig, btnGhost, days, Drawer, Field, input, Notice, shortDate, useRunner } from './ui';

type Length = 'FULL' | 'MORNING' | 'AFTERNOON';

/**
 * Apply for leave in one panel: pick a type, pick dates, (optionally) half day, add a reason, see exactly what will
 * happen, send. Maps to the API's halfFrom / halfTo / halfPart fields.
 */
export const ApplyLeaveDrawer: React.FC<{ me: any; open: boolean; onClose: () => void; onSent: () => void; initialFrom?: string; initialType?: string }> = ({ me, open, onClose, onSent, initialFrom, initialType }) => {
  const choices: any[] = useMemo(() => me.balances.filter((b: any) => b.eligible), [me.balances]);
  const typeMeta = (id: string) => me.settings.types.find((t: any) => t.id === id);
  const firstUsable = choices.find((b) => b.typeId === initialType) || choices.find((b) => !b.isLop && (!b.requiresBalance || b.balance > 0)) || choices[0];

  const [typeId, setTypeId] = useState<string>(firstUsable?.typeId || '');
  const [from, setFrom] = useState(initialFrom || me.today);
  const [to, setTo] = useState(initialFrom || me.today);
  const [length, setLength] = useState<Length>('FULL');
  const [startLate, setStartLate] = useState(false);
  const [endEarly, setEndEarly] = useState(false);
  const [reason, setReason] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [checking, setChecking] = useState(false);
  const { busy, note, setNote, run } = useRunner();

  // Fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setTypeId(firstUsable?.typeId || '');
    setFrom(initialFrom || me.today); setTo(initialFrom || me.today);
    setLength('FULL'); setStartLate(false); setEndEarly(false); setReason(''); setDocUrl(''); setNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bal = choices.find((b) => b.typeId === typeId);
  const meta = typeMeta(typeId);
  const canHalf = !!bal?.halfDay;
  const single = from === to;

  const halfFrom = canHalf && (single ? length !== 'FULL' : startLate);
  const halfTo = canHalf && !single && endEarly;
  const halfPart: 'FIRST' | 'SECOND' = single && length === 'MORNING' ? 'FIRST' : 'SECOND';
  // The server refuses the preview while the document is missing, so also show the field when that is the reason.
  const docError = preview?.valid === false && /supporting document/i.test(preview.error || '');
  const needsDoc = (meta?.docRequiredAfterDays || 0) > 0 && ((preview?.days || 0) > meta.docRequiredAfterDays || docError || !!docUrl);

  useEffect(() => {
    if (!open || !typeId || !from || !to || to < from) { setPreview(null); return; }
    setChecking(true);
    const t = setTimeout(() => {
      leaveService.calc({ typeId, from, to, halfFrom, halfTo, halfPart, reason, docUrl })
        .then(setPreview).catch(() => setPreview(null)).finally(() => setChecking(false));
    }, 250);
    return () => clearTimeout(t);
  }, [open, typeId, from, to, halfFrom, halfTo, halfPart, docUrl, reason]);

  const submit = () => run(async () => {
    await leaveService.apply({ typeId, from, to, halfFrom, halfTo, halfPart, reason, docUrl });
    onSent();
    onClose();
  }, 'Leave request sent. You will get an email when it is decided.');

  const quick = [
    { label: 'Today', from: me.today, to: me.today },
    { label: 'Tomorrow', from: addDaysIso(me.today, 1), to: addDaysIso(me.today, 1) },
  ];
  const who = (preview?.steps || []).map((s: string) => (s === 'MANAGER' ? (me.profile.manager || 'your manager') : 'HR')).join(', then ');
  const after = bal?.requiresBalance && preview?.valid ? Object.values<number>(preview.balanceAfter || {})[0] : undefined;
  const blocked = busy || !typeId || !preview?.valid || (needsDoc && !docUrl.trim());

  return (
    <Drawer open={open} onClose={onClose} title="Apply for leave" subtitle="Takes under a minute. Your manager gets an email right away."
      footer={
        <div className="flex items-center gap-2">
          <button className={`${btnBig} flex-1`} disabled={blocked} onClick={submit}>{busy ? 'Sending…' : 'Send request'}</button>
          <button className={btnGhost} onClick={onClose}>Cancel</button>
        </div>
      }>
      <div className="space-y-5">
        {/* 1. type */}
        <section>
          <StepTitle n={1}>What kind of leave?</StepTitle>
          {choices.length === 0 ? <Notice tone="warn">No leave types are set up for you yet. Ask HR.</Notice> : (
            <div className="grid grid-cols-2 gap-2">
              {choices.map((b) => {
                const empty = b.requiresBalance && b.balance <= 0;
                const sel = b.typeId === typeId;
                return (
                  <button key={b.typeId} type="button" onClick={() => setTypeId(b.typeId)}
                    className={`text-left rounded-xl border-2 px-3 py-2.5 transition-colors ${sel ? 'border-[#FA7014] bg-orange-50/60' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-bold text-slate-800 truncate">{b.name}</span>
                      {sel && <CheckCircle2 className="w-4 h-4 text-[#FA7014] shrink-0" />}
                    </div>
                    <div className={`text-xs mt-0.5 ${empty ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
                      {!b.requiresBalance ? (b.isLop ? 'Unpaid' : 'No limit') : empty ? 'None left' : `${b.balance} left`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* 2. dates */}
        <section>
          <StepTitle n={2}>Which days?</StepTitle>
          <div className="flex gap-1.5 mb-2">
            {quick.map((q) => (
              <button key={q.label} type="button" onClick={() => { setFrom(q.from); setTo(q.to); }}
                className={`px-3 py-1 rounded-full text-xs font-bold border ${from === q.from && to === q.to ? 'bg-[#FA7014] border-[#FA7014] text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{q.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input type="date" className={input} value={from} onChange={(e) => { const v = e.target.value; setFrom(v); if (!to || to < v) setTo(v); }} /></Field>
            <Field label="To (last day off)"><input type="date" className={input} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </section>

        {/* 3. half day */}
        <section>
          <StepTitle n={3}>{single ? 'Whole day or half?' : 'Any half days?'}</StepTitle>
          {!canHalf ? (
            <p className="text-xs text-slate-500">{bal ? `${bal.name} is taken in full days only.` : 'Pick a leave type first.'}</p>
          ) : single ? (
            <div className="grid grid-cols-3 gap-2">
              {([['FULL', 'Full day', Sun], ['MORNING', 'Morning', Sunrise], ['AFTERNOON', 'Afternoon', Sunset]] as const).map(([v, l, Icon]) => (
                <button key={v} type="button" onClick={() => setLength(v)}
                  className={`rounded-xl border-2 py-2.5 flex flex-col items-center gap-1 text-xs font-bold ${length === v ? 'border-[#FA7014] bg-orange-50/60 text-[#FA7014]' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                  <Icon className="w-4 h-4" />{l}
                  <span className="text-[10px] font-normal text-slate-400">{v === 'FULL' ? '1 day' : '½ day'}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <Toggle checked={startLate} onChange={setStartLate} label={`Start after lunch on ${shortDate(from)}`} hint="Work the morning, leave from the afternoon" />
              <Toggle checked={endEarly} onChange={setEndEarly} label={`Come back after lunch on ${shortDate(to)}`} hint="Off in the morning, back for the afternoon" />
            </div>
          )}
        </section>

        {/* 4. reason */}
        <section>
          <StepTitle n={4} optional>Reason</StepTitle>
          <textarea rows={2} className={input} placeholder="e.g. Family function in Pune" value={reason} onChange={(e) => setReason(e.target.value)} />
          {needsDoc && (
            <div className="mt-2">
              <Field label="Link to a document (required)" hint={`${bal?.name} longer than ${days(meta.docRequiredAfterDays)} needs a supporting document, e.g. a Google Drive link to a medical note.`}>
                <input className={input} placeholder="https://drive.google.com/…" value={docUrl} onChange={(e) => setDocUrl(e.target.value)} />
              </Field>
            </div>
          )}
        </section>

        {/* summary */}
        <section aria-live="polite">
          {to < from ? <Notice tone="error">The last day is before the first day.</Notice>
            : docError ? <Notice tone="warn">Add the document link above to continue.</Notice>
            : preview?.valid === false ? <Notice tone="error">{preview.error}</Notice>
            : preview?.valid ? (
              <div className={`rounded-xl border border-slate-200 bg-slate-50 p-3 ${checking ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><CalendarDays className="w-4 h-4 text-[#FA7014]" />{days(preview.days)} of {bal?.name}</div>
                <ul className="mt-1.5 space-y-1 text-xs text-slate-600">
                  {bal?.requiresBalance && after !== undefined && <li>Balance: <b>{bal.balance}</b> → <b className={after < 0 ? 'text-rose-600' : 'text-slate-900'}>{after}</b></li>}
                  {who && <li>Goes to <b>{who}</b> for approval</li>}
                  {preview.days === 0 && <li className="text-amber-700">These dates are holidays or weekly offs, so no leave is counted.</li>}
                  {preview.warnings?.map((w: string, i: number) => <li key={i} className="text-amber-700">{w}</li>)}
                </ul>
              </div>
            ) : checking ? <div className="h-16 rounded-xl bg-slate-100 animate-pulse" /> : null}
          {note && <div className="mt-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
        </section>
      </div>
    </Drawer>
  );
};

const StepTitle: React.FC<{ n: number; optional?: boolean; children: React.ReactNode }> = ({ n, optional, children }) => (
  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-2">
    <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[11px] flex items-center justify-center">{n}</span>
    {children}{optional && <span className="text-xs font-normal text-slate-400">(optional)</span>}
  </h3>
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({ checked, onChange, label, hint }) => (
  <label className={`flex items-start gap-3 rounded-xl border-2 px-3 py-2.5 cursor-pointer ${checked ? 'border-[#FA7014] bg-orange-50/60' : 'border-slate-200 hover:border-slate-300'}`}>
    <input type="checkbox" className="mt-0.5 accent-[#FA7014] w-4 h-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span><span className="block text-xs font-bold text-slate-800">{label}</span>{hint && <span className="block text-[11px] text-slate-500">{hint}</span>}</span>
  </label>
);
