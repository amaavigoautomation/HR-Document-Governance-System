import React, { useState } from 'react';
import { Copy } from 'lucide-react';
import { pipelineService } from '../../services/pipelineService';
import { Requisition } from '../../types';
import { Card, EmptyState, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../common/loadUi';

/** Where each approved job is posted. Only the careers site is published automatically; for the other boards HR copies a ready-made post and records it here. */
export const PostingsTab: React.FC<{ requisitions: Requisition[] }> = ({ requisitions }) => {
  const approved = requisitions.filter((r) => r.status === 'JOB_OPEN' || r.status === 'JD_DRAFT');
  const [reqId, setReqId] = useState('');
  const list = useLoad(() => pipelineService.postings(), []);
  const kit = useLoad(() => (reqId ? pipelineService.postKit(reqId) : Promise.resolve(null)), [reqId]);
  const { run, busy, note } = useRunner();
  const [form, setForm] = useState({ board: 'LinkedIn', url: '', cost: '', status: 'LIVE' });
  const items: any[] = (list.data?.items || []).filter((p: any) => !reqId || p.requisitionId === reqId);
  const boards: string[] = list.data?.boards || [];

  return (
    <div className="space-y-4">
      <Card title="Job posting tracker" subtitle="Pick a job to get a paste-ready post for each board, then record where you posted it.">
        <Field label="Job">
          <select className={input} value={reqId} onChange={(e) => setReqId(e.target.value)}>
            <option value="">All jobs</option>
            {approved.map((r) => <option key={r.id} value={r.id}>{r.positionId ? `${r.positionId} - ` : ''}{r.positionTitle}</option>)}
          </select>
        </Field>
      </Card>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {reqId && (
        <>
          <Card title="Paste-ready posts">
            <Loading error={kit.error} loading={kit.loading} />
            <div className="grid gap-3 md:grid-cols-2">
              {(kit.data?.kits || []).map((k: any) => (
                <div key={k.board} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">{k.board}</span>
                    <button className={btnGhost} onClick={() => navigator.clipboard?.writeText(`${k.title}\n\n${k.body}`)}><Copy className="h-3.5 w-3.5" /> Copy</button>
                  </div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600">{k.body}</pre>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Record a posting">
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Board"><select className={input} value={form.board} onChange={(e) => setForm({ ...form, board: e.target.value })}>{boards.map((b) => <option key={b}>{b}</option>)}</select></Field>
              <Field label="Link to the post"><input className={input} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" /></Field>
              <Field label="Cost (INR)"><input className={input} type="number" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
              <Field label="Status"><select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>PLANNED</option><option>LIVE</option><option>CLOSED</option></select></Field>
              <div className="flex items-end"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await pipelineService.postSave({ ...form, requisitionId: reqId, cost: form.cost || 0 }); setForm({ ...form, url: '', cost: '' }); await list.reload(); }, 'Posting saved.')}>Save posting</button></div>
            </div>
          </Card>
        </>
      )}
      <Card title="Where jobs are posted">
        <Loading error={list.error} loading={list.loading} />
        {!list.loading && items.length === 0 && <EmptyState title="Nothing recorded yet" text="Record a posting after you publish a job on a board." />}
        <div className="divide-y divide-slate-100">
          {items.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
              <div className="min-w-0">
                <div className="font-bold text-slate-800">{p.positionTitle} <span className="font-normal text-slate-400">{p.positionId}</span></div>
                <div className="text-slate-500">{p.board}{p.postedOn ? ` - ${p.postedOn}` : ''}{p.cost ? ` - INR ${p.cost}` : ''}{p.url && <> - <a className="text-[#FA7014] underline" href={p.url} target="_blank" rel="noreferrer">open</a></>}</div>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={p.status === 'LIVE' ? 'green' : p.status === 'CLOSED' ? 'slate' : 'amber'}>{p.status}</Pill>
                {p.status === 'LIVE' && <button className={btnGhost} onClick={() => run(async () => { await pipelineService.postSave({ ...p, status: 'CLOSED' }); await list.reload(); })}>Mark closed</button>}
                <button className={btnGhost} onClick={() => run(async () => { await pipelineService.postDelete(p.id); await list.reload(); })}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
