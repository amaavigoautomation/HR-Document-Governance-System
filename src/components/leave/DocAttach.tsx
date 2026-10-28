import React, { useRef, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { MAX_IDENTITY_FILE_CHARS } from '../../../shared/employeeIdentity';
import { leaveService } from '../../services/leaveService';
import { shrinkImage } from '../employee/shrinkImage';

export interface Picked { name: string; dataUrl: string }

/** Reads a chosen PDF or photo into a small data URL (photos are shrunk and stripped of camera details). */
export async function readAttachment(file: File): Promise<Picked> {
  if (file.type === 'application/pdf') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('That file could not be read.'));
      fr.readAsDataURL(file);
    });
    if (dataUrl.length > MAX_IDENTITY_FILE_CHARS) throw new Error('That PDF is too large. Keep it under about 650 KB, or attach a photo of it.');
    return { name: file.name, dataUrl };
  }
  return { name: file.name, dataUrl: await shrinkImage(file) };
}

export const DocAttach: React.FC<{ value: Picked | null; onChange: (p: Picked | null) => void; label?: string }> = ({ value, onChange, label = 'Attach a PDF or photo' }) => {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const pick = async (f?: File | null) => {
    if (!f) return;
    setError('');
    try { onChange(await readAttachment(f)); } catch (e: any) { setError(e?.message || 'Could not attach that file.'); }
    if (input.current) input.current.value = '';
  };
  return (
    <div>
      <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {value ? (
        <div className="inline-flex items-center gap-2 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-slate-50">
          <FileText className="w-3.5 h-3.5 text-slate-500" /><span className="max-w-[14rem] truncate font-semibold text-slate-700">{value.name}</span>
          <button type="button" aria-label="Remove attachment" onClick={() => onChange(null)}><X className="w-3.5 h-3.5 text-slate-400 hover:text-slate-700" /></button>
        </div>
      ) : (
        <button type="button" className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FA7014] hover:underline" onClick={() => input.current?.click()}>
          <Paperclip className="w-3.5 h-3.5" />{label}
        </button>
      )}
      <div className="text-[11px] text-slate-400 mt-1">Kept private: only you and HR can open it.</div>
      {error && <div className="text-[11px] text-rose-600 mt-1">{error}</div>}
    </div>
  );
};

/** Opens a stored document in a new tab (employee and HR only; the server refuses everyone else). */
export const OpenDoc: React.FC<{ requestId: string; name?: string; canOpen: boolean }> = ({ requestId, name, canOpen }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!canOpen) return <span className="text-[11px] text-slate-500 flex items-center gap-1"><FileText className="w-3.5 h-3.5" />Document attached (HR can open it)</span>;
  const open = async () => {
    setBusy(true); setError('');
    try {
      const r = await leaveService.docGet(requestId);
      const [head, b64] = String(r.dataUrl).split(',');
      const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      window.open(URL.createObjectURL(new Blob([bytes], { type: mime })), '_blank', 'noopener');
    } catch (e: any) { setError(e?.message || 'Could not open the document.'); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center gap-1 text-[11px]">
      <button type="button" className="font-bold text-[#FA7014] underline flex items-center gap-1" disabled={busy} onClick={open}><FileText className="w-3.5 h-3.5" />{name || 'Open document'}</button>
      {error && <span className="text-rose-600">{error}</span>}
    </span>
  );
};
