import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, ConfirmButton, EmptyState, Field, Notice, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';
import { FileText } from 'lucide-react';
import { Loading, Pill, useLoad } from './shared';

/** My assigned SOPs: read, then acknowledge. Acknowledging says "I have read it", not "I always follow it". */
export const MySops: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const q = useLoad(() => perfService.assignments(), []);
  const { busy, note, run } = useRunner();
  const items: any[] = q.data?.items || [];
  return (
    <Card title="My SOPs" subtitle="Standard operating procedures for your role. Please read each one, then confirm.">
      <Loading error={q.error} loading={q.loading} />
      {!q.loading && items.length === 0 && <EmptyState icon={FileText} title="No SOPs assigned" text="When HR maps SOPs to your department they will appear here." />}
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <ul className="divide-y divide-slate-100">{items.map((a) => (
        <li key={a.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div><p className="text-sm font-semibold text-slate-800">{a.sopTitle} {a.versionNumber && <span className="text-slate-400 font-normal">v{a.versionNumber}</span>}</p>
            <p className="text-xs text-slate-500">{a.retrainRequired ? 'A new version needs your acknowledgement. ' : ''}{a.trainingStatus === 'PENDING' ? 'Training pending. ' : ''}{a.verifiedAt ? `Verified by ${a.verifiedBy}` : ''}</p></div>
          {a.ackStatus === 'ACKNOWLEDGED' ? <Pill tone="green">acknowledged {a.ackAt ? niceDate(a.ackAt.slice(0, 10)) : ''}</Pill>
            : <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.ackSop(a.id); await q.reload(); onChanged(); }, 'Thank you.')}>I have read it</button>}
        </li>))}</ul>
    </Card>
  );
};

const blank = { id: '', title: '', departmentName: '', roleFamilyIds: [] as string[], versionId: '', versionNumber: '', criticality: 'NORMAL', mandatory: true, trainingRequired: false, acknowledgementRequired: true, checkpoints: [] as any[], processOwnerUid: '', reviewDate: '', active: true };

/** HR: SOP library, links to controlled documents, who it applies to, and the checkpoints managers verify. */
export const SopAdmin: React.FC = () => {
  const sops = useLoad(() => perfService.sops(), []);
  const src = useLoad(() => perfService.sopSources(), []);
  const set = useLoad(() => perfService.settings(), []);
  const asg = useLoad(() => perfService.assignments('all'), []);
  const { busy, note, run } = useRunner();
  const [f, setF] = useState<any | null>(null);
  const departments: string[] = set.data?.departments || [];
  const families: any[] = set.data?.roleFamilies || [];
  const pending = (asg.data?.items || []).filter((a: any) => a.ackStatus === 'PENDING');
  const reload = async () => { await Promise.all([sops.reload(), asg.reload()]); };
  const setCp = (i: number, patch: any) => setF({ ...f, checkpoints: f.checkpoints.map((c: any, j: number) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-4">
      <Card title="SOP library" subtitle="SOPs are the approved procedures people are assessed against. Link one to a published document so versions stay controlled."
        right={<div className="flex gap-2"><button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await perfService.syncSops(); await reload(); }, 'Assignments updated.')}>Re-check assignments</button><button className={btnPrimary} onClick={() => setF({ ...blank })}>Add SOP</button></div>}>
        <Loading error={sops.error} loading={sops.loading} />
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        {!sops.loading && (sops.data?.items || []).length === 0 && <Notice>No SOPs yet. Add the approved procedures for each department; where none exist, HR will see a gap here instead of a made-up SOP.</Notice>}
        <ul className="divide-y divide-slate-100">{(sops.data?.items || []).map((s: any) => (
          <li key={s.id} className="py-2.5 flex items-center justify-between gap-2 flex-wrap">
            <div><p className="text-sm font-semibold text-slate-800">{s.title} {s.versionNumber && <span className="text-slate-400 font-normal">v{s.versionNumber}</span>} {s.criticality === 'CRITICAL' && <Pill tone="red">critical</Pill>} {!s.active && <Pill>retired</Pill>}</p>
              <p className="text-xs text-slate-500">{s.departmentName || 'All departments'} · {s.checkpoints.length} checkpoint(s){s.documentMasterId ? ' · linked to a controlled document' : ''}</p></div>
            <div className="flex gap-2"><button className={btnGhost} onClick={() => setF({ ...blank, ...s })}>Edit</button>
              {s.active && <ConfirmButton className={btnGhost} question="Retire this SOP?" yes="Retire" onConfirm={() => run(async () => { await perfService.deleteSop(s.id); await reload(); })}>Retire</ConfirmButton>}</div>
          </li>))}</ul>
      </Card>

      {f && (
        <Card title={f.id ? 'Edit SOP' : 'New SOP'} right={<button className={btnGhost} onClick={() => setF(null)}>Cancel</button>}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Title"><input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Department (empty = everyone)"><select className={input} value={f.departmentName} onChange={(e) => setF({ ...f, departmentName: e.target.value })}><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</select></Field>
            <Field label="Linked document (published version)" hint="Optional. The version number is read from Document Governance."><select className={input} value={f.versionId} onChange={(e) => setF({ ...f, versionId: e.target.value })}><option value="">Not linked</option>{(src.data?.items || []).map((v: any) => <option key={v.versionId} value={v.versionId}>{v.title} v{v.versionNumber}</option>)}</select></Field>
            {!f.versionId && <Field label="Version"><input className={input} value={f.versionNumber} onChange={(e) => setF({ ...f, versionNumber: e.target.value })} placeholder="1.0" /></Field>}
            <Field label="Applies to role families (none = whole department)"><select multiple className={`${input} h-24`} value={f.roleFamilyIds} onChange={(e) => setF({ ...f, roleFamilyIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>{families.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Process owner"><select className={input} value={f.processOwnerUid} onChange={(e) => setF({ ...f, processOwnerUid: e.target.value })}><option value="">–</option>{(set.data?.people || []).map((p: any) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>
          </div>
          <div className="flex flex-wrap gap-4 mt-3 text-sm">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.criticality === 'CRITICAL'} onChange={(e) => setF({ ...f, criticality: e.target.checked ? 'CRITICAL' : 'NORMAL' })} /> Critical SOP</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.mandatory} onChange={(e) => setF({ ...f, mandatory: e.target.checked })} /> Mandatory</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.acknowledgementRequired} onChange={(e) => setF({ ...f, acknowledgementRequired: e.target.checked })} /> Needs acknowledgement</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.trainingRequired} onChange={(e) => setF({ ...f, trainingRequired: e.target.checked })} /> Training required</label>
          </div>
          <p className="text-xs font-bold text-slate-600 mt-4 mb-1">Checkpoints managers verify</p>
          {f.checkpoints.map((c: any, i: number) => (
            <div key={i} className="flex gap-2 mb-1.5"><input className={input} value={c.text} placeholder="e.g. Tracking tested before launch" onChange={(e) => setCp(i, { text: e.target.value })} />
              <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" checked={c.critical} onChange={(e) => setCp(i, { critical: e.target.checked })} /> critical</label>
              <button className={btnGhost} onClick={() => setF({ ...f, checkpoints: f.checkpoints.filter((_: any, j: number) => j !== i) })}>Remove</button></div>))}
          <button className={btnGhost} onClick={() => setF({ ...f, checkpoints: [...f.checkpoints, { text: '', critical: false }] })}>Add checkpoint</button>
          <div className="mt-4"><button className={btnPrimary} disabled={busy || !f.title.trim()} onClick={() => run(async () => { await perfService.saveSop(f); setF(null); await reload(); }, 'SOP saved and assigned.')}>Save SOP</button></div>
        </Card>
      )}

      <Card title={`Waiting for acknowledgement (${pending.length})`}>
        <Loading error={asg.error} loading={asg.loading} />
        <ul className="divide-y divide-slate-100 text-sm">{pending.slice(0, 50).map((a: any) => <li key={a.id} className="py-1.5"><span className="font-semibold">{a.employeeName}</span> · {a.sopTitle} v{a.versionNumber} <span className="text-xs text-slate-400">since {niceDate(a.assignedAt.slice(0, 10))}</span></li>)}</ul>
        {pending.length === 0 && !asg.loading && <p className="text-sm text-slate-500">Everyone has acknowledged their SOPs.</p>}
      </Card>
    </div>
  );
};
