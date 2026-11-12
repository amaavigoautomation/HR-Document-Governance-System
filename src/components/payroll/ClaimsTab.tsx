import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, CheckCircle2, Coins, Download, Eye, FileText, Fuel, Hourglass, Laptop, MoreHorizontal, Paperclip, Plane, Plus, Receipt, UtensilsCrossed, X, XCircle } from 'lucide-react';
import { Avatar } from '../home/parts';
import { inr, monthLabel, payrollService } from '../../services/payrollService';
import { Drawer, Field, Notice, Skeleton, btnGhost, input, todayIst, useRunner } from '../leave/ui';
import { btnOutline, btnViolet, dmy, field, Kpi, Pager, PageHead, Panel, Pill, SearchBox, Select, Tabs, THead } from '../leave/kit';

type Icon = React.FC<{ className?: string }>;
/** Violet-theme label and colour for a claim's state. Approved claims wait for the next payroll run, then show as Paid. */
const STATE: Record<string, [string, string]> = { SUBMITTED: ['Pending', 'amber'], APPROVED: ['Approved', 'green'], PAID: ['Paid', 'blue'], REJECTED: ['Rejected', 'rose'] };
const StatePill: React.FC<{ status: string }> = ({ status }) => <Pill tone={(STATE[status] || STATE.SUBMITTED)[1]}>{(STATE[status] || STATE.SUBMITTED)[0]}</Pill>;
const PER = 6;
const claimNo = (id: string) => `CLM-${String(id).replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`;
const catIcon = (c: string): Icon => { const k = c.toLowerCase(); return k.includes('travel') ? Plane : k.includes('food') || k.includes('meal') ? UtensilsCrossed : k.includes('fuel') || k.includes('petrol') ? Fuel : k.includes('home') || k.includes('internet') || k.includes('wfh') ? Laptop : k.includes('office') || k.includes('supplies') ? Briefcase : Receipt; };
const stamp = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600_000);
  const h = d.getUTCHours();
  return `${dmy(iso.slice(0, 10))}, ${String(h % 12 || 12).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
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

/** Claim facts and the steps it went through, shown beside the list. */
const ClaimDetails: React.FC<{ c: any; onClose?: () => void; children?: React.ReactNode; person?: boolean; onBill: (id: string) => void }> = ({ c, onClose, children, person, onBill }) => {
  const Ic = catIcon(c.category);
  const steps: { title: string; sub: string; done: boolean }[] = [{ title: 'Claim Submitted', sub: stamp(c.createdAt), done: true }];
  if (c.status === 'SUBMITTED') steps.push({ title: 'Pending with Manager', sub: `Since ${stamp(c.createdAt)}`, done: false });
  else if (c.status === 'REJECTED') steps.push({ title: 'Rejected', sub: `${stamp(c.decidedAt)}${c.decidedBy ? ` by ${c.decidedBy}` : ''}`, done: true });
  else {
    steps.push({ title: 'Approved', sub: `${stamp(c.decidedAt)}${c.decidedBy ? ` by ${c.decidedBy}` : ''}`, done: true });
    steps.push({ title: c.status === 'PAID' ? 'Paid' : 'Waiting for payroll', sub: c.status === 'PAID' ? paidLabel(c.paidMonth) : 'Added to the next payroll run', done: c.status === 'PAID' });
  }
  const rows: [string, string][] = [
    ...(person ? [['Employee', c.name || '—'] as [string, string]] : []),
    ['Submitted On', stamp(c.createdAt)], ['Expense Date', dmy(c.expenseDate)],
    ['Amount', inr(c.amount) + (c.status !== 'SUBMITTED' && c.status !== 'REJECTED' && c.approvedAmount !== c.amount ? ` (approved ${inr(c.approvedAmount)})` : '')],
    ['Description', c.description || '—'],
  ];
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-950">Claim Details</h2>
        {onClose ? <button type="button" aria-label="Close" onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100 cursor-pointer"><X className="h-5 w-5" /></button> : <StatePill status={c.status} />}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><Ic className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1"><div className="text-lg font-bold text-slate-950">{claimNo(c.id)}</div><div className="text-sm text-slate-600">{c.category} Reimbursement</div></div>
        {onClose && <StatePill status={c.status} />}
      </div>
      <dl className="mt-4 space-y-3 text-sm">
        {rows.map(([k, v]) => <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-2"><dt className="text-slate-600">{k}</dt><dd className="font-medium text-slate-900 break-words">{v}</dd></div>)}
        {c.decisionNote && <div className="grid grid-cols-[7.5rem_1fr] gap-2"><dt className="text-slate-600">Note</dt><dd className="font-medium text-slate-900 break-words">{c.decisionNote}</dd></div>}
      </dl>
      <div className="mt-4 text-sm text-slate-700"><Paperclip className="mr-1.5 inline h-4 w-4" />Attachments ({c.hasBill ? 1 : 0})</div>
      {c.hasBill && (
        <button type="button" onClick={() => onBill(c.id)} className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-sm hover:border-violet-300 cursor-pointer">
          <span className="flex min-w-0 items-center gap-2"><FileText className="h-5 w-5 shrink-0 text-rose-500" /><b className="truncate">{c.billName || 'Bill'}</b></span><Download className="h-4 w-4 shrink-0 text-slate-700" />
        </button>
      )}
      {!person && (
        <>
          <hr className="my-5 border-slate-100" />
          <h3 className="text-base font-bold text-slate-950">Approval Timeline</h3>
          <ol className="mt-3 space-y-4">
            {steps.map((st, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${st.done ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300 bg-white'}`}>{st.done && <CheckCircle2 className="h-4 w-4" />}</span>
                <div><div className="text-sm font-bold text-slate-900">{st.title}</div><div className="text-sm text-slate-600">{st.sub}</div></div>
              </li>
            ))}
          </ol>
        </>
      )}
      {children}
    </>
  );
};

const inLast = (iso: string, days: string) => days === 'ALL' || iso >= new Date(Date.now() + 5.5 * 3600_000 - Number(days) * 86400_000).toISOString().slice(0, 10);

/** Everyone: raise a claim with a bill and follow it through approval to payment. */
export const MyClaims: React.FC = () => {
  const [data, setData] = useState<any | null>(null);
  const [tab, setTab] = useState('claims');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [range, setRange] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pickId, setPickId] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [f, setF] = useState({ category: '', amount: '', expenseDate: todayIst(), description: '' });
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => {
    const r = await payrollService.myClaims();
    setData(r);
    setF((cur) => ({ ...cur, category: cur.category || r.categories[0] || '' }));
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const items: any[] = data?.items || [];
  const rows = useMemo(() => items.filter((c) => (cat === 'ALL' || c.category === cat) && (status === 'ALL' || (status === 'APPROVED' ? ['APPROVED', 'PAID'].includes(c.status) : c.status === status))
    && inLast(c.expenseDate, range) && (!q || `${claimNo(c.id)} ${c.category} ${c.description}`.toLowerCase().includes(q.toLowerCase()))), [items, cat, status, range, q]);
  const byCat = useMemo(() => {
    const m = new Map<string, { n: number; amount: number; approved: number }>();
    items.forEach((c) => { const e = m.get(c.category) || { n: 0, amount: 0, approved: 0 }; e.n++; e.amount += c.amount; if (['APPROVED', 'PAID'].includes(c.status)) e.approved += c.approvedAmount; m.set(c.category, e); });
    return Array.from(m.entries());
  }, [items]);
  if (!data) return <Skeleton rows={5} />;

  const count = (fn: (c: any) => boolean) => items.filter(fn).length;
  const cur = Math.min(page, Math.max(1, Math.ceil(rows.length / PER)));
  const sel = items.find((c) => c.id === pickId) || rows[0] || null;
  const needBill = Number(f.amount) > data.billRequiredAbove;
  const bad = !f.category || !(Number(f.amount) > 0) || !f.description.trim() || (needBill && !file);

  return (
    <div className="space-y-5">
      <PageHead title="My Claims" subtitle="Submit, track and manage your reimbursement claims." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total Claims" value={items.length} tone="violet" Icon={FileText} />
        <Kpi label="Approved" value={count((c) => ['APPROVED', 'PAID'].includes(c.status))} tone="green" Icon={CheckCircle2} />
        <Kpi label="Pending" value={count((c) => c.status === 'SUBMITTED')} tone="orange" Icon={Hourglass} />
        <Kpi label="Rejected" value={count((c) => c.status === 'REJECTED')} tone="rose" Icon={XCircle} />
        <Kpi label="Total Amount" value={inr(items.reduce((n, c) => n + c.amount, 0))} tone="violet" Icon={Coins} />
      </div>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,0.9fr)]">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs tabs={[{ key: 'claims', label: 'My Claims' }, { key: 'summary', label: 'Claim Summary' }]} value={tab} onChange={setTab} />
            <button type="button" className={btnViolet} onClick={() => setDrawer(true)}><Plus className="h-4 w-4" />New Claim</button>
          </div>
          {tab === 'claims' ? (
            <>
              <div className="my-4 flex flex-wrap items-center gap-3">
                <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by claim ID, type…" className="w-60" />
                <Select label="Claim type" className="w-44" value={cat} onChange={(v) => { setCat(v); setPage(1); }} options={[{ value: 'ALL', label: 'Claim Type: All' }, ...data.categories.map((c: string) => ({ value: c, label: c }))]} />
                <Select label="Status" className="w-40" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'ALL', label: 'Status: All' }, { value: 'SUBMITTED', label: 'Pending' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} />
                <Select label="Date range" className="w-44" value={range} onChange={(v) => { setRange(v); setPage(1); }} options={[{ value: 'ALL', label: 'Date Range: All' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last year' }]} />
              </div>
              {rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{items.length === 0 ? 'You have not claimed anything yet.' : 'No claims match these filters.'}</p> : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <THead cols={['Claim ID', 'Claim Type', 'Submitted On', 'Amount', 'Status', 'Actions']} />
                      <tbody className="divide-y divide-slate-100">
                        {rows.slice((cur - 1) * PER, cur * PER).map((c) => {
                          const Ic = catIcon(c.category);
                          return (
                            <tr key={c.id} className={`text-slate-800 ${sel?.id === c.id ? 'bg-violet-50/50' : ''}`}>
                              <td className="whitespace-nowrap px-3 py-3.5"><button type="button" className="font-semibold text-violet-700 underline cursor-pointer" onClick={() => setPickId(c.id)}>{claimNo(c.id)}</button></td>
                              <td className="px-3 py-3.5"><span className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Ic className="h-4 w-4" /></span><b className="text-slate-900">{c.category}</b></span></td>
                              <td className="whitespace-nowrap px-3 py-3.5">{dmy((c.createdAt || c.expenseDate).slice(0, 10))}</td>
                              <td className="whitespace-nowrap px-3 py-3.5 tabular-nums">{inr(c.amount)}</td>
                              <td className="px-3 py-3.5"><StatePill status={c.status} /></td>
                              <td className="relative px-3 py-3.5">
                                <span className="flex gap-2">
                                  <button type="button" aria-label={`View ${claimNo(c.id)}`} onClick={() => setPickId(c.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 hover:border-violet-300 cursor-pointer"><Eye className="h-4 w-4" /></button>
                                  <button type="button" aria-label="More actions" onClick={() => setMenu(menu === c.id ? null : c.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 hover:border-violet-300 cursor-pointer"><MoreHorizontal className="h-4 w-4" /></button>
                                </span>
                                {menu === c.id && (
                                  <div className="absolute right-3 top-14 z-10 w-40 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lg">
                                    {c.hasBill && <button type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50 cursor-pointer" onClick={() => { setMenu(null); void run(() => openBill(c.id)); }}>View bill</button>}
                                    {c.status === 'SUBMITTED' ? <button type="button" className="block w-full rounded-lg px-3 py-2 text-left text-rose-700 hover:bg-rose-50 cursor-pointer" disabled={busy} onClick={() => { setMenu(null); void run(async () => { await payrollService.withdrawClaim(c.id); await load(); }, 'Claim withdrawn.'); }}>Withdraw claim</button> : !c.hasBill && <span className="block px-3 py-2 text-slate-500">No actions</span>}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} total={rows.length} per={PER} noun="claims" onPage={setPage} />
                </>
              )}
            </>
          ) : (
            <div className="mt-4 overflow-x-auto">
              {byCat.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Nothing to summarise yet.</p> : (
                <table className="w-full min-w-[420px] text-left text-sm">
                  <THead cols={['Claim Type', 'Claims', 'Claimed', 'Approved']} />
                  <tbody className="divide-y divide-slate-100">
                    {byCat.map(([k, v]) => <tr key={k} className="text-slate-800"><td className="px-3 py-3 font-semibold text-slate-900">{k}</td><td className="px-3 py-3 tabular-nums">{v.n}</td><td className="px-3 py-3 tabular-nums">{inr(v.amount)}</td><td className="px-3 py-3 tabular-nums">{inr(v.approved)}</td></tr>)}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </Panel>

        <Panel>{sel ? <ClaimDetails c={sel} onBill={(id) => void run(() => openBill(id))} /> : <p className="py-10 text-center text-sm text-slate-500">Pick a claim to see its details.</p>}</Panel>
      </div>

      <Drawer open={drawer} onClose={() => setDrawer(false)} title="New claim" subtitle="Money you spent for work. Once approved it is added to your salary as a reimbursement (not taxed)."
        footer={<div className="flex gap-3"><button type="button" className={`${btnViolet} flex-1`} disabled={busy || bad} onClick={() => run(async () => {
          const bill = file ? await fileToBill(file) : undefined;
          await payrollService.submitClaim({ ...f, amount: Number(f.amount), bill });
          setF({ ...f, amount: '', description: '' }); setFile(null); if (fileRef.current) fileRef.current.value = '';
          setDrawer(false); await load();
        }, 'Claim sent for approval.')}>{busy ? 'Sending…' : 'Submit Claim'}</button><button type="button" className={btnOutline} onClick={() => setDrawer(false)}>Cancel</button></div>}>
        <div className="space-y-4">
          <Field label="Category"><select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{data.categories.map((c: string) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Amount (₹)"><input type="number" className={input} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date of expense"><input type="date" className={input} max={todayIst()} value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></Field>
          <Field label="What was it for?"><textarea rows={3} maxLength={300} className={input} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label={needBill ? `Bill (required above ${inr(data.billRequiredAbove)})` : 'Bill (optional)'}>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <div className="flex items-center gap-2">
              <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>{file ? 'Change bill' : 'Attach bill'}</button>
              {file ? <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate-700"><span className="max-w-[10rem] truncate">{file.name}</span><button type="button" aria-label="Remove bill" className="font-bold text-rose-600" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>×</button></span> : <span className="text-[11px] text-slate-500">JPG, PNG or PDF</span>}
            </div>
          </Field>
          {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
        </div>
      </Drawer>
    </div>
  );
};

/** Managers see their team's claims; payroll sees everyone's. Approved claims go into the next payroll run. */
export const ClaimApprovals: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [data, setData] = useState<any | null>(null);
  const [tab, setTab] = useState('SUBMITTED');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('ALL');
  const [amt, setAmt] = useState('ALL');
  const [range, setRange] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pickId, setPickId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [remarks, setRemarks] = useState('');
  const [amount, setAmount] = useState('');
  const { busy, note, run } = useRunner();

  const load = useCallback(async () => setData(await payrollService.claims()), []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const items: any[] = data?.items || [];
  const n = (s: string) => items.filter((c) => (s === 'APPROVED' ? ['APPROVED', 'PAID'].includes(c.status) : c.status === s)).length;
  const cats = useMemo(() => Array.from(new Set(items.map((c) => c.category))), [items]);
  const rows = useMemo(() => items.filter((c) => (tab === 'ALL' || (tab === 'APPROVED' ? ['APPROVED', 'PAID'].includes(c.status) : c.status === tab))
    && (cat === 'ALL' || c.category === cat) && inLast(c.expenseDate, range)
    && (amt === 'ALL' || (amt === 'LOW' ? c.amount < 1000 : amt === 'MID' ? c.amount >= 1000 && c.amount <= 5000 : c.amount > 5000))
    && (!q || `${c.name} ${claimNo(c.id)} ${c.description}`.toLowerCase().includes(q.toLowerCase()))), [items, tab, cat, amt, range, q]);
  const cur = Math.min(page, Math.max(1, Math.ceil(rows.length / PER)));
  const shown = rows.slice((cur - 1) * PER, cur * PER);
  const sel = items.find((c) => c.id === pickId) || shown[0] || null;
  useEffect(() => { if (sel) setAmount(String(sel.amount)); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <Skeleton rows={5} />;

  const can = (c: any) => c.status === 'SUBMITTED' && (canManage || data.scope === 'REPORTS');
  const pendingShown = shown.filter(can);
  const lessThanClaimed = sel && Number(amount) !== sel.amount;
  const need = (d: 'APPROVE' | 'REJECT') => d === 'REJECT' || lessThanClaimed ? !remarks.trim() : false;
  const decide = (c: any, d: 'APPROVE' | 'REJECT') => run(async () => {
    await payrollService.decideClaim(d === 'APPROVE' ? { id: c.id, decision: d, approvedAmount: Number(amount), note: remarks } : { id: c.id, decision: d, note: remarks });
    setRemarks(''); setPickId(null); await load();
  }, d === 'APPROVE' ? 'Approved.' : 'Rejected.');
  const bulk = (d: 'APPROVE' | 'REJECT') => {
    const picked = items.filter((c) => checked.has(c.id) && can(c));
    return run(async () => {
      for (const c of picked) await payrollService.decideClaim({ id: c.id, decision: d, ...(d === 'APPROVE' ? { approvedAmount: c.amount } : {}), note: remarks });
      setChecked(new Set()); setRemarks(''); await load();
    }, `${d === 'APPROVE' ? 'Approved' : 'Rejected'} ${picked.length} claim(s).`);
  };
  const allOn = pendingShown.length > 0 && pendingShown.every((c) => checked.has(c.id));
  const toggleAll = () => setChecked(allOn ? new Set() : new Set(pendingShown.map((c) => c.id)));
  const pickedCount = items.filter((c) => checked.has(c.id) && can(c)).length;

  return (
    <div className="space-y-5">
      <PageHead title="Claim Approvals" subtitle="Review and take action on employee reimbursement claims." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Total Claims" value={items.length} tone="violet" Icon={FileText} />
        <Kpi label="Approved" value={n('APPROVED')} tone="green" Icon={CheckCircle2} />
        <Kpi label="Pending" value={n('SUBMITTED')} tone="orange" Icon={Hourglass} />
        <Kpi label="Rejected" value={n('REJECTED')} tone="rose" Icon={XCircle} />
        <Kpi label="Total Amount (Pending)" value={inr(items.filter((c) => c.status === 'SUBMITTED').reduce((s, c) => s + c.amount, 0))} tone="violet" Icon={Coins} />
      </div>
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
      <p className="text-xs text-slate-600">{data.scope === 'REPORTS' ? 'Showing claims from the people who report to you.' : canManage ? 'Showing everyone\'s claims. Approved claims join the next payroll run you calculate; they cannot change once that run is approved.' : 'Showing everyone\'s claims (read-only).'}</p>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,0.9fr)]">
        <Panel>
          <Tabs tabs={[{ key: 'SUBMITTED', label: 'Pending', count: n('SUBMITTED') }, { key: 'APPROVED', label: 'Approved', count: n('APPROVED') }, { key: 'REJECTED', label: 'Rejected', count: n('REJECTED') }, { key: 'ALL', label: 'All', count: items.length }]} value={tab} onChange={(k) => { setTab(k); setPage(1); setChecked(new Set()); }} />
          <div className="my-4 flex flex-wrap items-center gap-3">
            <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by employee, claim ID or description…" className="w-72" />
            <Select label="Claim type" className="w-44" value={cat} onChange={(v) => { setCat(v); setPage(1); }} options={[{ value: 'ALL', label: 'Claim Type: All' }, ...cats.map((c) => ({ value: c, label: c }))]} />
            <Select label="Amount" className="w-40" value={amt} onChange={(v) => { setAmt(v); setPage(1); }} options={[{ value: 'ALL', label: 'Amount: All' }, { value: 'LOW', label: 'Under ₹1,000' }, { value: 'MID', label: '₹1,000 – ₹5,000' }, { value: 'HIGH', label: 'Above ₹5,000' }]} />
            <Select label="Date range" className="w-44" value={range} onChange={(v) => { setRange(v); setPage(1); }} options={[{ value: 'ALL', label: 'Date Range: All' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last year' }]} />
          </div>
          {rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Nothing here.</p> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <THead cols={['', 'Claim ID', 'Employee', 'Claim Type', 'Submitted On', 'Amount', 'Description']} />
                  <tbody className="divide-y divide-slate-100">
                    {shown.map((c) => {
                      const Ic = catIcon(c.category);
                      return (
                        <tr key={c.id} onClick={() => setPickId(c.id)} className={`cursor-pointer text-slate-800 ${sel?.id === c.id ? 'bg-violet-50/50' : 'hover:bg-slate-50'}`}>
                          <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>{can(c) ? <input type="checkbox" aria-label={`Select ${claimNo(c.id)}`} className="h-4 w-4 accent-violet-600" checked={checked.has(c.id)} onChange={() => setChecked((s) => { const x = new Set(s); if (x.has(c.id)) x.delete(c.id); else x.add(c.id); return x; })} /> : null}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 font-semibold text-violet-700 underline">{claimNo(c.id)}</td>
                          <td className="px-3 py-3.5"><span className="flex items-center gap-2.5"><Avatar name={c.name || '?'} /><b className="text-slate-900">{c.name}</b></span></td>
                          <td className="px-3 py-3.5"><span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700"><Ic className="h-3.5 w-3.5" />{c.category}</span></td>
                          <td className="whitespace-nowrap px-3 py-3.5">{dmy((c.createdAt || c.expenseDate).slice(0, 10))}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 tabular-nums">{inr(c.amount)}</td>
                          <td className="max-w-[14rem] truncate px-3 py-3.5 text-slate-600" title={c.description}>{c.description}{tab === 'ALL' || tab === 'APPROVED' || tab === 'REJECTED' ? <span className="ml-2"><StatePill status={c.status} /></span> : null}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} total={rows.length} per={PER} noun="claims" onPage={setPage} />
            </>
          )}
          {pendingShown.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-slate-50 p-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-900"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={allOn} onChange={toggleAll} />Select All ({pendingShown.length})</label>
              <button type="button" disabled={busy || pickedCount === 0} onClick={() => void bulk('APPROVE')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer"><CheckCircle2 className="h-4 w-4" />Approve Selected</button>
              <button type="button" disabled={busy || pickedCount === 0 || !remarks.trim()} title={remarks.trim() ? '' : 'Write a remark first'} onClick={() => void bulk('REJECT')} className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer"><XCircle className="h-4 w-4" />Reject Selected</button>
              {pickedCount > 0 && !remarks.trim() && <span className="text-xs text-slate-600">Add a remark to reject.</span>}
            </div>
          )}
        </Panel>

        <Panel>
          {sel ? (
            <ClaimDetails c={sel} person onClose={() => setPickId(null)} onBill={(id) => void run(() => openBill(id))}>
              {can(sel) ? (
                <div className="mt-5 space-y-3">
                  <Field label="Amount to approve (₹)"><input type="number" className={field + ' w-full'} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                  <div>
                    <div className="mb-1 text-sm font-bold text-slate-900">Approval Remarks (Optional)</div>
                    <textarea rows={3} maxLength={300} placeholder="Add your remarks…" className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                    <div className="text-right text-xs text-slate-500">{remarks.length} / 300</div>
                    <p className="text-xs text-slate-600">A remark is needed to reject or to approve less than claimed.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" disabled={busy || need('REJECT')} onClick={() => void decide(sel, 'REJECT')} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 cursor-pointer"><X className="h-4 w-4" />Reject</button>
                    <button type="button" disabled={busy || need('APPROVE') || !(Number(amount) > 0)} onClick={() => void decide(sel, 'APPROVE')} className={btnViolet}><CheckCircle2 className="h-4 w-4" />Approve</button>
                  </div>
                </div>
              ) : <div className="mt-4"><StatePill status={sel.status} /></div>}
            </ClaimDetails>
          ) : <p className="py-10 text-center text-sm text-slate-500">Pick a claim to review it.</p>}
        </Panel>
      </div>
    </div>
  );
};
