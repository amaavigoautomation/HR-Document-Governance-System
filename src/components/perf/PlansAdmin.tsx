import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, ConfirmButton, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { Loading, PlanPill, useLoad } from './shared';
import { KraList } from './MyGoals';
import { PlanEditor } from './TeamTab';

/** HR view of every plan: build missing ones, approve submitted ones, see what is blocked and why. */
export const PlansAdmin: React.FC<{ me: any; onChanged: () => void }> = ({ me, onChanged }) => {
  const q = useLoad(() => perfService.plans('all'), []);
  const { busy, note, run } = useRunner();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const rows: any[] = (q.data?.items || []).filter((p: any) => !filter || p.status === filter);
  const count = (s: string) => (q.data?.items || []).filter((p: any) => p.status === s).length;
  const refresh = async () => { await q.reload(); onChanged(); };
  return (
    <div className="space-y-4">
      <Card title="KRA/KPI plans" subtitle="Plans are built from the approved role template. Nothing is guessed: if something is missing, the plan waits here with the reason."
        right={me.canManage ? <ConfirmButton className={btnPrimary} question="Create plans for everyone who needs one?" yes="Create" onConfirm={() => run(async () => { const r = await perfService.generatePlans(); await refresh(); }, 'Plans checked and created.')}>Create missing plans</ConfirmButton> : undefined}>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <div className="flex flex-wrap gap-2 mb-3">
          {['', 'CONFIGURATION_PENDING', 'DRAFT', 'SUBMITTED', 'PENDING_ACK', 'ACTIVE'].map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${filter === s ? 'bg-[#FA7014] text-white border-[#FA7014]' : 'bg-white border-slate-300 text-slate-600'}`}>
              {s ? s.replace(/_/g, ' ').toLowerCase() : 'all'} {s ? `(${count(s)})` : ''}</button>))}
        </div>
        <Loading error={q.error} loading={q.loading} />
        <ul className="divide-y divide-slate-100">{rows.map((p) => (
          <li key={p.id} className="py-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{p.employeeName} <span className="font-normal text-slate-400">· {p.department || 'no department'}</span></p>
                <p className="text-xs text-slate-500">{p.roleFamilyName || 'No role family'} · manager {p.managerName || 'not set'}</p>
                {p.pendingReason && <p className="text-xs text-rose-600">{p.pendingReason}</p>}</div>
              <div className="flex items-center gap-2"><PlanPill status={p.status} />{p.kras.length > 0 && <button className={btnGhost} onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Close' : 'Open'}</button>}</div>
            </div>
            {open === p.id && (
              <div className="mt-3 space-y-2">
                {p.status === 'SUBMITTED' ? (<>
                  <KraList kras={p.kras} />
                  <input className={input} placeholder="Note (needed if you send it back)" value={text} onChange={(e) => setText(e.target.value)} />
                  <div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.decidePlan(p.id, 'APPROVE', text); setText(''); setOpen(null); await refresh(); }, 'Approved. The employee will be asked to confirm.')}>Approve</button>
                    <button className={btnGhost} disabled={busy || !text.trim()} onClick={() => run(async () => { await perfService.decidePlan(p.id, 'RETURN', text); setText(''); setOpen(null); await refresh(); }, 'Sent back to the manager.')}>Send back</button></div>
                </>) : <PlanEditor planId={p.id} canSubmit={me.canManage} onDone={refresh} />}
              </div>)}
          </li>))}</ul>
        {!q.loading && rows.length === 0 && <p className="text-sm text-slate-500">No plans in this view.</p>}
      </Card>
    </div>
  );
};
