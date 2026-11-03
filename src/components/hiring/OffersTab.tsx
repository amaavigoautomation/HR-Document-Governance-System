import React, { useState } from 'react';
import { offerService } from '../../services/hiringExtraService';
import { pipelineService } from '../../services/pipelineService';
import { Card, ConfirmButton, Drawer, EmptyState, Field, Notice, btnDanger, btnGhost, btnPrimary, input, todayIst, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';

const LABEL: Record<string, string> = { DRAFT: 'Draft', PENDING_FOUNDER: 'Waiting for founder', APPROVED: 'Approved', REJECTED: 'Rejected', SENT: 'Sent', NEGOTIATION: 'Negotiating', ACCEPTED: 'Accepted', DECLINED: 'Declined', GHOSTED: 'No response', EXPIRED: 'Expired', JOINED: 'Joined', WITHDRAWN: 'Withdrawn' };
const tone = (s: string) => (['ACCEPTED', 'JOINED'].includes(s) ? 'green' : ['REJECTED', 'DECLINED', 'GHOSTED', 'EXPIRED', 'WITHDRAWN'].includes(s) ? 'red' : ['PENDING_FOUNDER', 'NEGOTIATION'].includes(s) ? 'amber' : 'blue') as 'green' | 'red' | 'amber' | 'blue';
const DOCS: [string, string][] = [['offerLetter', 'Offer letter'], ['compensation', 'Compensation'], ['checklist', 'Joining checklist'], ['nda', 'NDA (generic, have a lawyer review)'], ['agreement', 'Employment agreement (generic, have a lawyer review)']];

const OfferDrawer: React.FC<{ id: string; canApprove: boolean; onClose: () => void; onChanged: () => void }> = ({ id, canApprove, onClose, onChanged }) => {
  const d = useLoad(() => offerService.get(id), [id]);
  const { run, busy, note } = useRunner();
  const [extra, setExtra] = useState('');
  const [counter, setCounter] = useState('');
  const [comment, setComment] = useState('');
  const [docs, setDocs] = useState<Record<string, string> | null>(null);
  const o = d.data?.item;
  const act = (action: string, done: string) => run(async () => { const r = await offerService.act({ id, action, note: comment, approvedCtcLpa: counter || undefined }); setExtra(r.probationNote || ''); await d.reload(); onChanged(); }, done);
  return (
    <Drawer open onClose={onClose} title={o?.candidateName || 'Offer'} subtitle={o ? `${o.designation} - ${o.joiningDate}` : ''}>
      <Loading error={d.error} loading={d.loading} />
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {extra && <Notice tone="info">{extra}</Notice>}
      {o && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><Pill tone={tone(o.status)}>{LABEL[o.status] || o.status}</Pill>{o.overBand && <Pill tone="red">Over budget band</Pill>}</div>
          <Card title="Salary">
            <p className="text-sm text-slate-700">Recommended: <b>{o.recommendedCtcLpa} LPA</b>{o.bandMaxLpa ? ` (band up to ${o.bandMaxLpa} LPA)` : ''}. {o.approvedCtcLpa ? <>Approved: <b>{o.approvedCtcLpa} LPA</b>.</> : 'Not approved yet.'}</p>
            {o.justification && <p className="mt-1 text-xs text-slate-500">Reason for going over: {o.justification}</p>}
            {o.responseNote && <p className="mt-1 text-xs text-slate-600">Candidate said: {o.responseNote}</p>}
          </Card>
          <Card title="Actions">
            <Field label="Note (optional)"><input className={input} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
            <div className="mt-2 flex flex-wrap gap-2">
              {['DRAFT', 'REJECTED'].includes(o.status) && <button className={btnPrimary} disabled={busy} onClick={() => act('submit', 'Sent to the founder.')}>Send to founder</button>}
              {o.status === 'PENDING_FOUNDER' && canApprove && (
                <>
                  <input className={`${input} max-w-[180px]`} placeholder="Counter CTC (LPA)" value={counter} onChange={(e) => setCounter(e.target.value)} />
                  <button className={btnPrimary} disabled={busy} onClick={() => act('approve', 'Approved. The offer pack is ready.')}>Approve</button>
                  <button className={btnDanger} disabled={busy} onClick={() => act('reject', 'Rejected.')}>Reject</button>
                </>
              )}
              {o.status === 'APPROVED' && <button className={btnPrimary} disabled={busy} onClick={() => act('send', 'Offer emailed to the candidate.')}>Send to candidate</button>}
              {o.status === 'NEGOTIATION' && <button className={btnGhost} disabled={busy} onClick={() => act('revise', 'Revised. Send it to the founder again.')}>Revise offer</button>}
              {['SENT', 'NEGOTIATION'].includes(o.status) && (
                <>
                  <button className={btnGhost} disabled={busy} onClick={() => act('accept', 'Recorded as accepted.')}>Candidate accepted (by phone)</button>
                  <button className={btnGhost} disabled={busy} onClick={() => act('decline', 'Recorded as declined.')}>Candidate declined</button>
                </>
              )}
              {o.status === 'ACCEPTED' && <button className={btnPrimary} disabled={busy} onClick={() => act('join', 'Marked as joined.')}>Mark as joined</button>}
              {!['JOINED', 'WITHDRAWN', 'DECLINED', 'GHOSTED', 'EXPIRED'].includes(o.status) && <ConfirmButton disabled={busy} onConfirm={() => act('withdraw', 'Offer withdrawn.')}>Withdraw</ConfirmButton>}
            </div>
          </Card>
          {o.pack && (
            <Card title="Offer pack" subtitle={o.status === 'APPROVED' ? 'Edit the wording before you send it.' : 'Read only after sending.'}>
              {(o.packMissing || []).length > 0 && <Notice tone="warn">Fill these before sending: {o.packMissing.join(', ')}.</Notice>}
              {DOCS.filter(([k]) => o.pack[k]).map(([k, label]) => (
                <details key={k} className="mb-2 rounded-lg border border-slate-200 p-2"><summary className="cursor-pointer text-xs font-bold text-slate-800">{label}</summary>
                  <textarea className={`${input} mt-2 h-48 font-mono text-xs`} readOnly={o.status !== 'APPROVED'} value={(docs || o.pack)[k] ?? ''} onChange={(e) => setDocs({ ...(docs || o.pack), [k]: e.target.value })} />
                </details>
              ))}
              {o.status === 'APPROVED' && docs && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await offerService.packSave(id, docs); setDocs(null); await d.reload(); }, 'Documents saved.')}>Save documents</button>}
            </Card>
          )}
          <Card title="History">
            <ul className="space-y-1 text-xs text-slate-600">{(o.history || []).map((h: any, i: number) => <li key={i}>{String(h.at).slice(0, 16).replace('T', ' ')} - {h.by}: {h.action}{h.note ? ` (${h.note})` : ''}</li>)}</ul>
          </Card>
        </div>
      )}
    </Drawer>
  );
};

const Costs: React.FC = () => {
  const list = useLoad(() => offerService.costs(), []);
  const { run, busy, note } = useRunner();
  const [f, setF] = useState({ category: 'JOB_BOARD', amount: '', date: todayIst(), note: '' });
  return (
    <Card title="Hiring costs" subtitle="Job boards, agency fees, assessments. These feed cost per hire on the dashboard.">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="grid gap-2 sm:grid-cols-5">
        <select className={input} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{(list.data?.categories || ['JOB_BOARD']).map((c: string) => <option key={c} value={c}>{c.replace('_', ' ').toLowerCase()}</option>)}</select>
        <input className={input} placeholder="Amount (Rs)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <input className={input} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <input className={input} placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <button className={btnPrimary} disabled={busy || !f.amount} onClick={() => run(async () => { await offerService.costSave(f); setF({ ...f, amount: '', note: '' }); await list.reload(); }, 'Cost added.')}>Add</button>
      </div>
      <ul className="mt-3 divide-y divide-slate-100 text-sm">{(list.data?.items || []).map((c: any) => (
        <li key={c.id} className="flex items-center justify-between py-1.5"><span>{c.date} - {String(c.category).replace('_', ' ').toLowerCase()}{c.note ? ` - ${c.note}` : ''}</span>
          <span className="flex items-center gap-2">Rs {Number(c.amount).toLocaleString('en-IN')}<ConfirmButton onConfirm={() => run(async () => { await offerService.costDelete(c.id); await list.reload(); })}>Delete</ConfirmButton></span></li>
      ))}</ul>
    </Card>
  );
};

const Templates: React.FC = () => {
  const t = useLoad(() => offerService.templates(), []);
  const { run, busy, note } = useRunner();
  const [edit, setEdit] = useState<Record<string, string>>({});
  return (
    <Card title="Offer document wording" subtitle="Use {{placeholders}} such as {{candidate_name}}. The NDA and agreement start as generic drafts: get them reviewed by a lawyer before real use.">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {(t.data?.items || []).map((x: any) => (
        <details key={x.docKey} className="mb-2 rounded-lg border border-slate-200 p-2"><summary className="cursor-pointer text-xs font-bold">{x.docKey}{x.custom ? ' (your version)' : ' (default)'}</summary>
          <textarea className={`${input} mt-2 h-48 font-mono text-xs`} value={edit[x.docKey] ?? x.body} onChange={(e) => setEdit({ ...edit, [x.docKey]: e.target.value })} />
          <div className="mt-2 flex gap-2"><button className={btnPrimary} disabled={busy || edit[x.docKey] === undefined} onClick={() => run(async () => { await offerService.templateSave(x.docKey, edit[x.docKey]); await t.reload(); }, 'Saved.')}>Save</button>
            {x.custom && <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await offerService.templateSave(x.docKey, ''); setEdit({}); await t.reload(); }, 'Back to the default.')}>Reset to default</button>}</div>
        </details>
      ))}
    </Card>
  );
};

/** Offers: raise from a candidate, founder approval, offer pack, send, status, hiring costs and wording. */
export const OffersTab: React.FC<{ canApprove: boolean }> = ({ canApprove }) => {
  const list = useLoad(() => offerService.list(), []);
  const board = useLoad(() => pipelineService.board(), []);
  const { run, busy, note } = useRunner();
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ applicationId: '', recommendedCtcLpa: '', joiningDate: '', probationMonths: '3', justification: '' });
  const [err, setErr] = useState('');
  const items: any[] = list.data?.items || [];
  const cands: any[] = (board.data?.rows || []).filter((r: any) => !items.some((o) => o.applicationId === r.id && !['REJECTED', 'DECLINED', 'GHOSTED', 'EXPIRED', 'WITHDRAWN'].includes(o.status)));
  return (
    <div className="space-y-4">
      <Card title="New offer" subtitle="Pick a candidate, enter the salary you recommend and the joining date. It goes to the founder before anything is sent.">
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        {err && <Notice tone="error">{err}</Notice>}
        <div className="grid gap-2 sm:grid-cols-5">
          <select className={`${input} sm:col-span-2`} value={f.applicationId} onChange={(e) => setF({ ...f, applicationId: e.target.value })}><option value="">Candidate</option>{cands.map((c) => <option key={c.id} value={c.id}>{c.name} - {c.designation}</option>)}</select>
          <input className={input} placeholder="CTC (LPA)" value={f.recommendedCtcLpa} onChange={(e) => setF({ ...f, recommendedCtcLpa: e.target.value })} />
          <input className={input} type="date" min={todayIst()} value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} />
          <input className={input} placeholder="Probation (months)" value={f.probationMonths} onChange={(e) => setF({ ...f, probationMonths: e.target.value })} />
        </div>
        <input className={`${input} mt-2`} placeholder="Reason, needed if the CTC is above the job's budget band" value={f.justification} onChange={(e) => setF({ ...f, justification: e.target.value })} />
        <button className={`${btnPrimary} mt-2`} disabled={busy || !f.applicationId || !f.recommendedCtcLpa || !f.joiningDate} onClick={() => { setErr(''); run(async () => { try { const r = await offerService.create(f); setF({ ...f, applicationId: '', recommendedCtcLpa: '', justification: '' }); await list.reload(); setOpen(r.item.id); } catch (e: any) { setErr(e?.message || 'Could not create the offer.'); } }); }}>Create offer</button>
      </Card>
      <Loading error={list.error} loading={list.loading} />
      {!list.loading && items.length === 0 && <EmptyState title="No offers yet" text="Create one above for a candidate who has cleared the interviews." />}
      <div className="grid gap-2">{items.map((o) => (
        <button key={o.id} onClick={() => setOpen(o.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-[#FA7014]">
          <div><div className="text-sm font-bold text-slate-800">{o.candidateName}</div><div className="text-xs text-slate-500">{o.designation} - joining {o.joiningDate} - {o.approvedCtcLpa || o.recommendedCtcLpa} LPA</div></div>
          <Pill tone={tone(o.status)}>{LABEL[o.status] || o.status}</Pill>
        </button>
      ))}</div>
      <Costs />
      <Templates />
      {open && <OfferDrawer id={open} canApprove={canApprove} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </div>
  );
};
