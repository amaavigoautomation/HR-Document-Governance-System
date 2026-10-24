import React, { useCallback, useEffect, useState } from 'react';
import { UserCheck } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { addDaysIso, btnGhost, btnPrimary, Card, ConfirmButton, Field, input, Notice, shortRange, todayIst, useRunner } from './ui';

/**
 * "Going away? Choose who approves for you."
 * A manager picks a colleague and the dates. While those dates last, that person sees the manager's requests and can approve them.
 * HR can do the same for any manager. People who are covering for someone see a reminder.
 */
export const CoverPanel: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [info, setInfo] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState('');           // HR only: whose cover to set ('' = me)
  const [delegate, setDelegate] = useState('');
  const [from, setFrom] = useState(todayIst());
  const [to, setTo] = useState(addDaysIso(todayIst(), 2));
  const { busy, note, run } = useRunner();

  const load = useCallback(() => leaveService.delegation().then(setInfo).catch(() => setInfo({ canSet: false, mine: null, covering: [], all: [], candidates: [] })), []);
  useEffect(() => { load(); }, [load]);
  if (!info) return null;

  const covering: any[] = info.covering || [];
  const all: any[] = (info.all || []).filter((d: any) => !info.mine || d.managerUid !== info.mine.managerUid || d.delegateUid !== info.mine.delegateUid);
  if (!info.canSet && covering.length === 0) return null;

  const today = todayIst();
  const startOpen = (d?: any) => {
    setWho(''); setDelegate(d?.delegateUid || ''); setFrom(d ? (d.from < today ? today : d.from) : today); setTo(d?.to || addDaysIso(today, 2)); setOpen(true);
  };
  const save = () => run(async () => {
    await leaveService.setDelegation({ delegateUid: delegate, from, to, managerUid: who || undefined });
    setOpen(false);
    await Promise.all([load(), onChanged()]);
  }, 'Saved. They have been told.');
  const stop = (managerUid?: string) => run(async () => { await leaveService.clearDelegation(managerUid); await Promise.all([load(), onChanged()]); }, 'Cover stopped.');

  const candidates: { uid: string; name: string }[] = (info.candidates || []).filter((p: any) => !who || p.uid !== who);
  const bad = !delegate || !from || !to || to < from || from < today;

  return (
    <div className="space-y-2">
      {covering.map((d) => (
        <Notice key={d.managerUid}>
          You are covering for <b>{d.managerName}</b> {d.from <= today ? 'until' : 'from'} <b>{d.from <= today ? shortRange(d.to, d.to) : shortRange(d.from, d.to)}</b>. Their team&apos;s requests show below with a &ldquo;Covering for&rdquo; label.
        </Notice>
      ))}

      {info.canSet && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><UserCheck className="w-4 h-4" /></span>
              <div className="min-w-0">
                {info.mine ? (
                  <>
                    <div className="text-sm font-bold text-slate-900">{info.mine.delegateName} approves for you</div>
                    <div className="text-xs text-slate-500">{shortRange(info.mine.from, info.mine.to)}. You can still approve too.</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-bold text-slate-900">Going away?</div>
                    <div className="text-xs text-slate-500">Choose who approves your team&apos;s requests while you are out, so nothing waits.</div>
                  </>
                )}
              </div>
            </div>
            {!open && (
              <div className="flex items-center gap-2">
                <button className={info.mine ? btnGhost : btnPrimary} disabled={busy} onClick={() => startOpen(info.mine)}>{info.mine ? 'Change' : 'Choose who covers'}</button>
                {info.mine && <ConfirmButton disabled={busy} question="Stop the cover?" yes="Stop" onConfirm={() => stop()}>Stop</ConfirmButton>}
              </div>
            )}
          </div>

          {open && (
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
              {info.hr && (
                <Field label="For"><select className={input} value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">Me</option>
                  {candidates.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                </select></Field>
              )}
              <Field label="Who approves while away">
                <select className={input} value={delegate} onChange={(e) => setDelegate(e.target.value)}>
                  <option value="">Choose a colleague…</option>
                  {candidates.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From"><input type="date" className={input} min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
                <Field label="Until (last day)"><input type="date" className={input} min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </div>
              {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
              <div className="flex gap-2">
                <button className={btnPrimary} disabled={busy || bad} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
                <button className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
        </Card>
      )}

      {info.hr && all.length > 0 && (
        <Card title="Cover set up for managers" subtitle="HR view. You can stop any of these.">
          <ul className="divide-y divide-slate-100">
            {all.map((d) => (
              <li key={d.managerUid} className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span><b>{d.delegateName}</b> approves for <b>{d.managerName}</b> · {shortRange(d.from, d.to)}</span>
                <ConfirmButton disabled={busy} question="Stop?" yes="Stop" onConfirm={() => stop(d.managerUid)}>Stop</ConfirmButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
};
