import React, { useCallback, useEffect, useState } from 'react';
import { Check, Eye, EyeOff, FileBadge, Pencil, RefreshCw, X } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { maskIdentity } from '../../../shared/employeeIdentity';
import { Drawer, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

interface Item { type: string; label: string; hint: string; number: string; pendingNumber: string; status: '' | 'APPROVED' | 'PENDING' | 'REJECTED'; note: string }

const PILL: Record<string, { text: string; cls: string }> = {
  APPROVED: { text: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PENDING: { text: 'Waiting for HR', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  REJECTED: { text: 'Not approved', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const EditDrawer: React.FC<{ item: Item | null; uid?: string; byHr: boolean; onClose: () => void; onSaved: () => void }> = ({ item, uid, byHr, onClose, onSaved }) => {
  const [number, setNumber] = useState('');
  const { busy, note, run } = useRunner();
  useEffect(() => { if (item) setNumber(item.pendingNumber || item.number); }, [item]);
  return (
    <Drawer open={!!item} onClose={onClose} title={item?.label || ''} subtitle={byHr ? 'Saved straight away' : 'HR will check this before it is approved'}
      footer={<div className="flex gap-2 justify-end"><button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => item && run(async () => { await lifecycleService.saveIdentity({ uid, type: item.type, number }); onSaved(); onClose(); }, byHr ? 'Saved' : 'Sent to HR for approval')}>Save</button></div>}>
      {item && (
        <div className="space-y-3">
          <Field label="Number" hint={item.hint}><input className={input} value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" /></Field>
          {byHr && <p className="text-[11px] text-slate-400">Leave it empty to remove this number.</p>}
          {note && <Notice tone={note.tone}>{note.text}</Notice>}
        </div>
      )}
    </Drawer>
  );
};

/** Employee Identity: one card per identity document, numbers masked until the eye is clicked. */
export const EmployeeIdentityPage: React.FC<{ uid?: string }> = ({ uid }) => {
  const [data, setData] = useState<{ items: Item[]; canDecide: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Item | null>(null);
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [reason, setReason] = useState('');
  const { busy, note, run } = useRunner();

  const load = useCallback(() => lifecycleService.identities(uid).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message)), [uid]);
  useEffect(() => { setData(null); setShown(new Set()); load(); }, [load]);

  if (err) return <Notice tone="error">{err}</Notice>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const toggle = (t: string) => setShown((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const decide = (i: Item, approve: boolean, why?: string) => run(async () => { await lifecycleService.decideIdentity({ uid: uid || '', type: i.type, approve, note: why }); setRejecting(null); setReason(''); await load(); }, approve ? 'Approved' : 'Sent back');

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">Numbers are hidden by default. Only this person and HR can see them.</p>
        <button type="button" aria-label="Refresh" className="p-1.5 rounded hover:bg-slate-100 text-slate-500" onClick={() => void load()}><RefreshCw className="w-4 h-4" /></button>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <ul className="space-y-2">
        {data.items.map((i) => {
          const value = i.pendingNumber || i.number;
          const visible = shown.has(i.type);
          const pill = i.status ? PILL[i.status] : null;
          return (
            <li key={i.type} className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><FileBadge className="w-4 h-4" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800">{i.label}</div>
                  <div className="text-xs text-slate-600 font-mono tracking-wide">{value ? (visible ? value : maskIdentity(value)) : <span className="font-sans text-slate-400">Not added</span>}</div>
                </div>
                {pill && <span className={`hidden sm:inline text-[10px] font-bold px-2 py-0.5 rounded-full border ${pill.cls}`}>{pill.text}</span>}
                <div className="flex items-center gap-0.5">
                  {value && <button type="button" aria-label={visible ? 'Hide number' : 'Show number'} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => toggle(i.type)}>{visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>}
                  <button type="button" aria-label={`Edit ${i.label}`} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setEditing(i)}><Pencil className="w-4 h-4" /></button>
                </div>
              </div>
              {i.status === 'REJECTED' && i.note && <p className="mt-2 text-xs text-rose-700">HR note: {i.note}</p>}
              {i.status === 'APPROVED' && i.note && <p className="mt-2 text-xs text-rose-700">Your last change was not approved: {i.note}</p>}
              {i.status === 'PENDING' && data.canDecide && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  {rejecting?.type === i.type ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input className={input} placeholder="Why is it not approved?" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
                      <button type="button" className={btnGhost} onClick={() => setRejecting(null)}>Cancel</button>
                      <button type="button" className={btnPrimary} disabled={busy || !reason.trim()} onClick={() => void decide(i, false, reason)}>Send back</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2"><span className="text-xs text-slate-500 mr-auto">Waiting for your approval</span>
                      <button type="button" className={btnGhost} onClick={() => setRejecting(i)}><X className="w-3.5 h-3.5" />Reject</button>
                      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void decide(i, true)}><Check className="w-3.5 h-3.5" />Approve</button></div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <EditDrawer item={editing} uid={uid} byHr={data.canDecide} onClose={() => setEditing(null)} onSaved={() => void load()} />
    </div>
  );
};
