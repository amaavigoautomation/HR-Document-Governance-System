import React, { useCallback, useEffect, useState } from 'react';
import { inr, monthLabel, payrollService } from '../../services/payrollService';
import { Card, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, todayIst, useRunner } from '../leave/ui';

const STATUS: Record<string, [string, string]> = {
  SUBMITTED: ['Waiting', 'bg-amber-50 text-amber-700 border-amber-200'],
  APPROVED: ['Approved, to be paid', 'bg-sky-50 text-sky-700 border-sky-200'],
  PAID: ['Paid', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
  REJECTED: ['Rejected', 'bg-rose-50 text-rose-700 border-rose-200'],
};
const Pill: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${(STATUS[status] || STATUS.SUBMITTED)[1]}`}>{(STATUS[status] || STATUS.SUBMITTED)[0]}</span>
);
const paidLabel = (m: string) => (m === 'FNF' ? 'with final settlement' : monthLabel(m));

/** A bill as base64 for upload. Photos are shrunk in the browser; PDFs must already be small. */
async function fileToBill(file: File): Promise<{ name: string; type: string; data: string }> {
  const read = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(blob);
  });
  if (file.type === 'application/pdf') {
    const data = await read(file);
    if (data.length > 680_000) throw new Error('This PDF is too large. Use one under 500 KB, or photograph the bill instead.');
    return { name: file.name, type: file.type, data };
  }
  if (!file.type.startsWith('image/')) throw new Error('Attach a photo (JPG, PNG) or a PDF of the bill.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not open this image.'));
      i.src = url;
    });
    for (const [max, q] of [[1400, 0.7], [1100, 0.6], [800, 0.55]] as const) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      const blob: Blob = await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/jpeg', q));
      const data = await read(blob);
      if (data.length <= 680_000) return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data };
    }
    throw new Error('This photo is too large even after shrinking. Try a smaller one.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function openBill(id: string) {
  const b = await payrollService.claimBill(id);
  const bytes = Uint8Array.from(atob(b.data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: b.type }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Everyone: raise a claim with a bill and follow it through approval to payment. */
export const MyClaims: React.FC = () => {
  const [data, setData] = useState<any | null>(null);
  const [f, setF] = useState({ category: '', amount: '', expenseDate: todayIst(), description: '' });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const r = await payrollService.myClaims();
    setData(r);
    setF((cur) => ({ ...cur, category: cur.category || r.categories[0] || '' }));
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  const needBill = Number(f.amount) > data.billRequiredAbove;
  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <Card title="Claim an expense">
        <p className="text-[11px] text-slate-400 mb-3">Money you spent for work. Once your manager or HR approves it, it is added to your salary as a reimbursement (not taxed). A bill is needed above {inr(data.billRequiredAbove)}.</p>
        <div className="grid md:grid-cols-5 gap-2 items-end">
          <Field label="Category"><select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{data.categories.map((c: string) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Amount (₹)"><input type="number" className={input} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date of expense"><input type="date" className={input} max={todayIst()} value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></Field>
          <div className="md:col-span-2"><Field label="What was it for?"><input className={input} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <Field label={needBill ? 'Bill (required)' : 'Bill (optional)'}>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <div className="flex items-center gap-2">
              <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>{file ? 'Change bill' : 'Attach bill'}</button>
              {file ? (
                <span className="flex items-center gap-1.5 text-xs text-slate-700 min-w-0"><span className="truncate max-w-[10rem]">{file.name}</span>
                  <button type="button" aria-label="Remove bill" className="text-rose-600 font-bold" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>×</button></span>
              ) : <span className="text-[11px] text-slate-400">JPG, PNG or PDF</span>}
            </div>
          </Field>
          <button className={btnPrimary} disabled={busy} onClick={() => run(async () => {
            const bill = file ? await fileToBill(file) : undefined;
            await payrollService.submitClaim({ ...f, amount: Number(f.amount), bill });
            setF({ ...f, amount: '', description: '' });
            setFile(null);
            if (fileRef.current) fileRef.current.value = '';
            await load();
          }, 'Claim sent for approval.')}>Submit claim</button>
        </div>
      </Card>

      <Card title={`Your claims (${data.items.length})`}>
        {data.items.length === 0 && <div className="text-sm text-slate-500">You have not claimed anything yet.</div>}
        <div className="divide-y divide-slate-100">
          {data.items.map((c: any) => (
            <div key={c.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-800">{c.category} · {inr(c.amount)}{c.status !== 'SUBMITTED' && c.status !== 'REJECTED' && c.approvedAmount !== c.amount ? ` (approved ${inr(c.approvedAmount)})` : ''}</div>
                <div className="text-xs text-slate-500">{niceDate(c.expenseDate)} · {c.description}</div>
                {c.decisionNote && <div className="text-xs text-slate-500">Note from {c.decidedBy}: {c.decisionNote}</div>}
                {c.status === 'PAID' && <div className="text-xs text-emerald-700">Paid {paidLabel(c.paidMonth)}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Pill status={c.status} />
                {c.hasBill && <button className={btnGhost} onClick={() => run(() => openBill(c.id))}>Bill</button>}
                {c.status === 'SUBMITTED' && <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await payrollService.withdrawClaim(c.id); await load(); }, 'Claim withdrawn.')}>Withdraw</button>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

/** Managers see their team's claims; payroll sees everyone's. Approved claims go into the next payroll run. */
export const ClaimApprovals: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [status, setStatus] = useState('SUBMITTED');
  const [data, setData] = useState<any | null>(null);
  const [open, setOpen] = useState<{ id: string; amount: string; note: string } | null>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => setData(await payrollService.claims(status || undefined)), [status]);
  useEffect(() => { setData(null); load().catch(() => undefined); }, [load]);

  return (
    <Card title="Expense claims" right={
      <select className={`${input} max-w-[12rem]`} value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="SUBMITTED">Waiting for a decision</option><option value="APPROVED">Approved, to be paid</option><option value="PAID">Paid</option><option value="REJECTED">Rejected</option><option value="">All</option>
      </select>}>
      {note && <div className="mb-3"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
      <p className="text-[11px] text-slate-400 mb-3">{data?.scope === 'REPORTS' ? 'Showing claims from the people who report to you.' : canManage ? 'Showing everyone\'s claims. Approved claims join the next payroll run you calculate; they cannot change once that run is approved.' : 'Showing everyone\'s claims (read-only).'}</p>
      {!data && <div className="text-sm text-slate-500">Loading…</div>}
      {data && data.items.length === 0 && <div className="text-sm text-slate-500">Nothing here.</div>}
      <div className="divide-y divide-slate-100">
        {data?.items.map((c: any) => {
          const canDecide = c.status === 'SUBMITTED' && (canManage || data.scope === 'REPORTS');
          return (
            <div key={c.id} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800">{c.name} · {c.category} · {inr(c.amount)}</div>
                  <div className="text-xs text-slate-500">{niceDate(c.expenseDate)} · {c.description}</div>
                  {c.decisionNote && <div className="text-xs text-slate-500">{c.decidedBy}: {c.decisionNote}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <Pill status={c.status} />
                  {c.hasBill ? <button className={btnGhost} onClick={() => run(() => openBill(c.id))}>View bill</button> : <span className="text-[11px] text-slate-400">No bill</span>}
                  {canDecide && <button className={btnGhost} onClick={() => setOpen(open?.id === c.id ? null : { id: c.id, amount: String(c.amount), note: '' })}>Decide</button>}
                </div>
              </div>
              {open?.id === c.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2 bg-slate-50 rounded-lg p-2">
                  <Field label="Amount to approve (₹)"><input type="number" className={`${input} w-36`} value={open.amount} onChange={(e) => setOpen({ ...open, amount: e.target.value })} /></Field>
                  <Field label="Note (needed to reject or approve less)"><input className={`${input} w-72`} value={open.note} onChange={(e) => setOpen({ ...open, note: e.target.value })} /></Field>
                  <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await payrollService.decideClaim({ id: c.id, decision: 'APPROVE', approvedAmount: Number(open.amount), note: open.note }); setOpen(null); await load(); }, 'Approved.')}>Approve</button>
                  <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await payrollService.decideClaim({ id: c.id, decision: 'REJECT', note: open.note }); setOpen(null); await load(); }, 'Rejected.')}>Reject</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};
