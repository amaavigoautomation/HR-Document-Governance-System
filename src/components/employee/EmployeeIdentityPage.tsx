import React, { useCallback, useEffect, useState } from 'react';
import { Check, Eye, EyeOff, FileBadge, ImagePlus, Image as ImageIcon, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { lifecycleService } from '../../services/lifecycleService';
import { maskIdentity } from '../../../shared/employeeIdentity';
import { shrinkImage } from './shrinkImage';
import { Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';

interface Item { type: string; label: string; hint: string; number: string; pendingNumber: string; status: '' | 'APPROVED' | 'PENDING' | 'REJECTED'; note: string; files: { id: string; at: string; kb: number }[] }

const PILL: Record<string, { text: string; cls: string }> = {
  APPROVED: { text: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PENDING: { text: 'Waiting for HR', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  REJECTED: { text: 'Not approved', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/** The number editor: a small dropdown under the pencil instead of a side panel. */
const EditPopover: React.FC<{ item: Item; uid?: string; byHr: boolean; onClose: () => void; onSaved: () => void }> = ({ item, uid, byHr, onClose, onSaved }) => {
  const [number, setNumber] = useState(item.pendingNumber || item.number);
  const { busy, note, run } = useRunner();
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden />
      <div role="dialog" aria-label={`Edit ${item.label}`} className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg space-y-2.5">
        <Field label="Number" hint={item.hint}><input className={input} value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" autoFocus /></Field>
        <p className="text-[11px] text-slate-400">{byHr ? 'Saved straight away. Leave it empty to remove this number.' : 'HR will check this before it is approved.'}</p>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <div className="flex gap-2 justify-end">
          <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(async () => { await lifecycleService.saveIdentity({ uid, type: item.type, number }); onSaved(); onClose(); }, byHr ? 'Saved' : 'Sent to HR for approval')}>Save</button>
        </div>
      </div>
    </>
  );
};

/** Employee Identity: one card per identity document, numbers masked until the eye is clicked. */
export const EmployeeIdentityPage: React.FC<{ uid?: string }> = ({ uid }) => {
  const [data, setData] = useState<{ items: Item[]; canDecide: boolean; maxFiles: number } | null>(null);
  const [viewing, setViewing] = useState<{ title: string; src: string | null } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const uploadFor = React.useRef<{ type: string; replaceId?: string }>({ type: '' });
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const asked = React.useRef<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Item | null>(null);
  const [reason, setReason] = useState('');
  const { busy, note, run } = useRunner();

  const load = useCallback(() => lifecycleService.identities(uid).then((d) => { setData(d); setErr(null); }).catch((e) => setErr(e.message)), [uid]);
  useEffect(() => { setData(null); setShown(new Set()); setThumbs({}); asked.current = new Set(); load(); }, [load]);
  // Small previews of every uploaded photo, loaded one by one so the page itself is not held up.
  useEffect(() => {
    if (!data) return;
    data.items.forEach((i) => i.files.forEach((f) => {
      if (asked.current.has(f.id)) return;
      asked.current.add(f.id);
      lifecycleService.identityFile(f.id, uid).then((r) => setThumbs((t) => ({ ...t, [f.id]: r.dataUrl }))).catch(() => asked.current.delete(f.id));
    }));
  }, [data, uid]);

  if (err) return <Notice tone="error">{err}</Notice>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;
  const toggle = (t: string) => setShown((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; });
  const pick = (type: string, replaceId?: string) => { uploadFor.current = { type, replaceId }; fileInput.current?.click(); };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const { type, replaceId } = uploadFor.current;
    setUploading(replaceId || type);
    try {
      await run(async () => {
        const dataUrl = await shrinkImage(file);
        if (replaceId) {
          await lifecycleService.replaceIdentityFile({ uid, id: replaceId, dataUrl });
          asked.current.delete(replaceId);
          setThumbs((t) => { const n = { ...t }; delete n[replaceId]; return n; });
        } else await lifecycleService.addIdentityFile({ uid, type, dataUrl });
      }, replaceId ? 'Photo replaced' : 'Photo added');
    } finally {
      // Always re-read: whatever happened, the card should show what is actually saved.
      await load();
      setUploading(null);
    }
  };
  const open = async (title: string, id: string) => {
    setViewing({ title, src: null });
    try { setViewing({ title, src: (await lifecycleService.identityFile(id, uid)).dataUrl }); } catch { setViewing(null); }
  };
  const removeFile = (id: string) => run(async () => { await lifecycleService.deleteIdentityFile({ uid, id }); await load(); }, 'Photo removed').finally(() => void load());
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
                  <div className="text-xs text-slate-600 font-mono tracking-wide">{value ? (visible ? value : maskIdentity(value)) : <span className="font-sans text-slate-400">{i.files.length ? 'Number not added' : 'Not added'}</span>}</div>
                  {i.files.length > 0 && <div className="text-[11px] text-slate-500">{i.files.length} {i.files.length === 1 ? 'photo' : 'photos'} uploaded</div>}
                </div>
                {pill && <span className={`hidden sm:inline text-[10px] font-bold px-2 py-0.5 rounded-full border ${pill.cls}`}>{pill.text}</span>}
                <div className="flex items-center gap-0.5 relative">
                  {value && <button type="button" aria-label={visible ? 'Hide number' : 'Show number'} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => toggle(i.type)}>{visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>}
                  <button type="button" aria-label={`Edit ${i.label}`} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-haspopup="dialog" aria-expanded={editing === i.type} onClick={() => setEditing(editing === i.type ? null : i.type)}><Pencil className="w-4 h-4" /></button>
                  {editing === i.type && <EditPopover item={i} uid={uid} byHr={data.canDecide} onClose={() => setEditing(null)} onSaved={() => void load()} />}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {i.files.map((f, n) => (
                  <div key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                    <button type="button" className="w-14 h-14 rounded-md bg-white border border-slate-200 overflow-hidden flex items-center justify-center text-slate-300 hover:border-[#FA7014]" onClick={() => void open(`${i.label} photo ${n + 1}`, f.id)} aria-label={`View ${i.label} photo ${n + 1}`}>
                      {thumbs[f.id] ? <img src={thumbs[f.id]} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-5 h-5" />}
                    </button>
                    <div className="text-xs text-slate-700">
                      <div className="font-bold">Photo {n + 1} <span className="font-normal text-slate-400">{f.kb} KB</span></div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <button type="button" className="font-bold text-[#FA7014] hover:underline disabled:opacity-50" disabled={busy} onClick={() => void open(`${i.label} photo ${n + 1}`, f.id)}>View</button>
                        <button type="button" className="font-bold text-slate-600 hover:underline disabled:opacity-50" disabled={busy} onClick={() => pick(i.type, f.id)}>{uploading === f.id ? 'Replacing…' : 'Replace'}</button>
                        <button type="button" className="text-slate-400 hover:text-rose-700 disabled:opacity-50" disabled={busy} onClick={() => void removeFile(f.id)} aria-label={`Remove ${i.label} photo ${n + 1}`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </div>
                ))}
                {i.files.length < data.maxFiles && (
                  <button type="button" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FA7014] px-2 py-1 rounded-lg hover:bg-orange-50 disabled:opacity-50" disabled={busy} onClick={() => pick(i.type)}>
                    <ImagePlus className="w-3.5 h-3.5" />{uploading === i.type ? 'Uploading…' : i.files.length ? 'Add back side' : 'Add photo'}
                  </button>
                )}
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
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e)} aria-label="Choose a photo" />
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label={viewing.title} onClick={() => setViewing(null)}>
          <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <button type="button" aria-label="Close" className="absolute -top-3 -right-3 bg-white rounded-full p-1.5 shadow" onClick={() => setViewing(null)}><X className="w-4 h-4" /></button>
            {viewing.src ? <img src={viewing.src} alt={viewing.title} className="w-full max-h-[85vh] object-contain rounded-lg bg-white" /> : <div className="bg-white rounded-lg p-10 text-center text-sm text-slate-500">Loading…</div>}
          </div>
        </div>
      )}
    </div>
  );
};
