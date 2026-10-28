import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, FileCheck2, History } from 'lucide-react';
import { leaveService } from '../../services/leaveService';
import { Card, EmptyState, Field, Notice, btnDanger, btnGhost, btnPrimary, input, niceDate, Skeleton, useRunner } from './ui';

const ChangeList: React.FC<{ items: { area: string; text: string }[] }> = ({ items }) => (
  <ul className="text-xs text-slate-700 space-y-1">
    {items.map((c, i) => (
      <li key={i} className="flex gap-2"><span className="shrink-0 w-16 text-[10px] font-bold uppercase text-slate-400 pt-0.5">{c.area}</span><span>{c.text}</span></li>
    ))}
  </ul>
);

/** Policy versions: what is live, the change waiting for approval, and the history of every published version. */
export const PolicyChanges: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const [st, setSt] = useState<any | null>(null);
  const [ref, setRef] = useState('');
  const [when, setWhen] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [returnNote, setReturnNote] = useState('');
  const { busy, note, run } = useRunner();

  const load = useCallback(() => leaveService.policyState().then((r) => {
    setSt(r); setRef(r.draft?.governanceRef || ''); setWhen(r.draft?.effectiveFrom || '');
  }).catch(() => setSt({ error: true })), []);
  useEffect(() => { load(); }, [load]);

  if (!st) return <Skeleton rows={4} />;
  if (st.error) return <Notice tone="error">Could not load policy versions.</Notice>;
  const d = st.draft;
  const after = (fn: () => Promise<any>, msg: string) => run(async () => { await fn(); await load(); onChanged(); }, msg);

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}

      <Card title="Live policy" subtitle="The rules every new request is checked against.">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div><div className="text-[11px] text-slate-400">Version</div><div className="font-black text-slate-900">v{st.version}</div></div>
          <div><div className="text-[11px] text-slate-400">In force since</div><div className="font-semibold">{st.effectiveFrom ? niceDate(st.effectiveFrom) : '-'}</div></div>
          <div><div className="text-[11px] text-slate-400">Approved by</div><div className="font-semibold">{st.approvedBy || '-'}</div></div>
          <div className="min-w-0"><div className="text-[11px] text-slate-400">Policy document</div><div className="font-semibold truncate">{st.governanceRef || 'Not linked'}</div></div>
        </div>
        <label className="mt-4 flex items-start gap-2 text-xs text-slate-600">
          <input type="checkbox" className="mt-0.5 accent-[#FA7014]" checked={st.requireApproval} disabled={busy || !st.canApprove}
            onChange={(e) => after(() => leaveService.policyRequire(e.target.checked), e.target.checked ? 'Policy changes now need approval.' : 'HR can save policy changes directly again.')} />
          <span><b>Policy changes need approval.</b> HR prepares a change as a draft, an administrator approves it, and it goes live on the effective date. Requests already decided keep the version they were decided under.{!st.canApprove && ' Only an administrator can change this.'}</span>
        </label>
      </Card>

      {d ? (
        <Card title={d.status === 'APPROVED' ? 'Approved, waiting for its date' : d.status === 'SUBMITTED' ? 'Waiting for approval' : 'Draft change'}
          subtitle={`Prepared by ${d.savedBy}${d.submittedBy ? ` · sent by ${d.submittedBy}` : ''}`}>
          {d.stale && <div className="mb-3"><Notice tone="error">The live policy changed after this draft was made. Discard it and make the change again.</Notice></div>}
          {d.returnedNote && <div className="mb-3"><Notice tone="error">Returned: {d.returnedNote}</Notice></div>}
          <div className="text-[11px] font-bold uppercase text-slate-400 mb-1">What changes</div>
          <ChangeList items={d.changes} />
          {d.impact?.people > 0 && (
            <div className="mt-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Affects <b>{d.impact.people}</b> employee(s): {d.impact.policies.map((p: any) => `${p.name} (${p.people})`).join(', ')}. Leave already credited or approved is not recalculated.
            </div>
          )}
          {d.status === 'DRAFT' && (
            <div className="mt-4 grid sm:grid-cols-2 gap-3 max-w-2xl">
              <Field label="Policy document (required)" hint="Title, number or link of the approved document in Document Governance">
                <input className={input} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. AMA-HR-LEAVE-001 v2" />
              </Field>
              <Field label="Takes effect on"><input type="date" className={input} value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {d.status === 'DRAFT' && <>
              <button className={btnGhost} disabled={busy} onClick={() => after(() => leaveService.policyDraftSave({ governanceRef: ref, effectiveFrom: when, settings: d.settings }), 'Draft updated.')}>Save details</button>
              <button className={btnPrimary} disabled={busy || !ref.trim()} onClick={() => after(async () => { await leaveService.policyDraftSave({ governanceRef: ref, effectiveFrom: when, settings: d.settings }); await leaveService.policySubmit(); }, 'Sent for approval.')}>Send for approval</button>
            </>}
            {d.status === 'SUBMITTED' && st.canApprove && !d.stale && <>
              <button className={btnPrimary} disabled={busy} onClick={() => after(() => leaveService.policyDecide('APPROVE'), 'Approved.')}><FileCheck2 className="w-4 h-4 inline mr-1" />Approve{d.effectiveFrom > new Date().toISOString().slice(0, 10) ? ` (live ${niceDate(d.effectiveFrom)})` : ' and publish'}</button>
              <input className={`${input} max-w-xs`} placeholder="Reason, to return it" value={returnNote} onChange={(e) => setReturnNote(e.target.value)} />
              <button className={btnGhost} disabled={busy || !returnNote.trim()} onClick={() => after(() => leaveService.policyDecide('REJECT', returnNote.trim()), 'Returned to HR.')}>Return</button>
            </>}
            {d.status === 'SUBMITTED' && !st.canApprove && <span className="text-xs text-slate-500">An administrator will review this.</span>}
            <button className={btnDanger} disabled={busy} onClick={() => after(() => leaveService.policyDiscard(), 'Draft discarded.')}>Discard</button>
          </div>
        </Card>
      ) : (
        <Card title="No change waiting" subtitle={st.requireApproval ? 'Edit the settings in the other sections and press Save: your change is kept here as a draft.' : 'Changes saved in the other sections go live straight away and are recorded as a new version.'}>
          <div className="text-xs text-slate-500">Turn on "Policy changes need approval" above for a draft, approve and publish flow.</div>
        </Card>
      )}

      <Card title="Version history" subtitle="Every published version with what changed." right={<History className="w-4 h-4 text-slate-400" />}>
        {st.versions.length === 0 ? <EmptyState icon={History} title="No versions yet" text="Versions appear once leave is set up." /> : (
          <div className="divide-y divide-slate-100">
            {st.versions.map((v: any) => (
              <div key={v.version} className="py-2.5">
                <button className="w-full flex items-center justify-between gap-2 text-left" onClick={() => setOpen(open === v.version ? null : v.version)} aria-expanded={open === v.version}>
                  <span className="text-sm font-bold text-slate-800">v{v.version} <span className="font-normal text-xs text-slate-500">· from {niceDate(v.effectiveFrom)} · {v.publishedBy}</span></span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open === v.version ? 'rotate-180' : ''}`} />
                </button>
                {open === v.version && (
                  <div className="mt-2 pl-1">
                    <div className="text-[11px] text-slate-500 mb-1.5">Approved by {v.approvedBy || '-'}{v.governanceRef ? ` · document ${v.governanceRef}` : ''}</div>
                    <ChangeList items={v.changes || []} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
