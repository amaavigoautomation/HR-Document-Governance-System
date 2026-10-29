import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';
import { EvidenceForm, KraList } from './MyGoals';
import { Loading, PlanPill, useLoad } from './shared';

/** Edits a plan's targets and weights. Targets are never filled in automatically. */
export const PlanEditor: React.FC<{ planId: string; canSubmit: boolean; onDone: () => void }> = ({ planId, canSubmit, onDone }) => {
  const q = useLoad(() => perfService.plan(planId), [planId]);
  const { busy, note, run } = useRunner();
  const [kras, setKras] = useState<any[] | null>(null);
  React.useEffect(() => { if (q.data?.item) setKras(q.data.item.kras); }, [q.data]);
  if (!q.data || !kras) return <Loading error={q.error} loading={q.loading} />;
  const plan = q.data.item;
  const editable = plan.status === 'DRAFT';
  const setKpi = (ki: number, pi: number, patch: any) => setKras(kras.map((k, i) => (i !== ki ? k : { ...k, kpis: k.kpis.map((p: any, j: number) => (j !== pi ? p : { ...p, ...patch })) })));
  const total = kras.flatMap((k) => k.kpis).reduce((s, p) => s + (Number(p.weightage) || 0), 0);
  const flagsOf = (id: string) => (q.data.flags || []).find((f: any) => f.kpiId === id)?.flags || [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-sm font-bold text-slate-800">{plan.employeeName}</p><PlanPill status={plan.status} /></div>
      {plan.approvals?.length > 0 && plan.status === 'DRAFT' && plan.approvals[plan.approvals.length - 1].decision === 'RETURNED' && <Notice tone="warn">HR sent this back: {plan.approvals[plan.approvals.length - 1].note}</Notice>}
      {!editable && <KraList kras={plan.kras} />}
      {editable && kras.map((k, ki) => (
        <div key={k.id} className="border border-slate-200 rounded-lg">
          <div className="px-3 py-2 bg-slate-50 rounded-t-lg text-sm font-bold text-slate-800">{k.name}</div>
          <div className="p-3 space-y-3">{k.kpis.map((p: any, pi: number) => (
            <div key={p.id} className="space-y-1.5">
              <p className="text-sm font-semibold text-slate-800">{p.code && <span className="text-slate-400 mr-1">{p.code}</span>}{p.description}</p>
              <div className="grid sm:grid-cols-[1fr_6rem] gap-2">
                <Field label="Measurable target (agreed with the employee)"><input className={input} value={p.target} placeholder="e.g. 95% of campaigns launched by the planned date" onChange={(e) => setKpi(ki, pi, { target: e.target.value })} /></Field>
                <Field label="Weight %"><input className={input} inputMode="numeric" value={p.weightage} onChange={(e) => setKpi(ki, pi, { weightage: e.target.value })} /></Field>
              </div>
              {flagsOf(p.id).map((f: string) => <p key={f} className="text-[11px] text-amber-700">⚠ {f}</p>)}
            </div>))}</div>
        </div>
      ))}
      {editable && <p className={`text-xs font-bold ${total === 100 ? 'text-emerald-600' : 'text-rose-600'}`}>KPI weights total {total}% (must be 100%)</p>}
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {editable && (
        <div className="flex gap-2">
          <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await perfService.savePlan(planId, kras); await q.reload(); }, 'Saved.')}>Save</button>
          {canSubmit && <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.savePlan(planId, kras); await perfService.submitPlan(planId); await q.reload(); onDone(); }, 'Sent to HR for approval.')}>Save and send to HR</button>}
        </div>
      )}
    </div>
  );
};

export const TeamTab: React.FC<{ me: any; onChanged: () => void }> = ({ me, onChanged }) => {
  const plans = useLoad(() => perfService.plans('team'), []);
  const checkins = useLoad(() => perfService.checkins('team'), []);
  const [sel, setSel] = useState<string | null>(null);
  const [evUid, setEvUid] = useState<string | null>(null);
  const evidence = useLoad(() => (evUid ? perfService.evidence(evUid) : Promise.resolve({ items: [] })), [evUid]);
  const { busy, run } = useRunner();
  const rows: any[] = plans.data?.items || [];
  const [ci, setCi] = useState<any | null>(null);
  const evPlan = rows.find((p) => p.uid === evUid);
  return (
    <div className="space-y-4">
      <Card title="Goals for my team" subtitle="Set measurable targets for each KPI, then send the plan to HR. Each person confirms it once approved.">
        <Loading error={plans.error} loading={plans.loading} />
        {!plans.loading && rows.length === 0 && <Notice>Nobody reports to you yet, or their plans have not been created.</Notice>}
        <ul className="divide-y divide-slate-100">{rows.map((p) => (
          <li key={p.id} className="py-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div><p className="text-sm font-semibold text-slate-800">{p.employeeName}</p><p className="text-xs text-slate-500">{p.roleFamilyName || 'No role family'}{p.pendingReason ? ` · ${p.pendingReason}` : ''}</p></div>
              <div className="flex items-center gap-2"><PlanPill status={p.status} />
                {p.kras.length > 0 && <button className={btnGhost} onClick={() => setSel(sel === p.id ? null : p.id)}>{sel === p.id ? 'Close' : p.status === 'DRAFT' ? 'Set targets' : 'View'}</button>}
                {(p.status === 'ACTIVE' || p.status === 'PENDING_ACK') && <button className={btnGhost} onClick={() => setEvUid(evUid === p.uid ? null : p.uid)}>Evidence</button>}</div>
            </div>
            {sel === p.id && <div className="mt-3"><PlanEditor planId={p.id} canSubmit onDone={() => { plans.reload(); onChanged(); }} /></div>}
          </li>))}</ul>
      </Card>

      {evUid && evPlan && (
        <Card title={`Evidence · ${evPlan.employeeName}`} right={<button className={btnGhost} onClick={() => setEvUid(null)}>Close</button>}>
          <Loading error={evidence.error} loading={evidence.loading} />
          <ul className="divide-y divide-slate-100 text-sm mb-3">{(evidence.data?.items || []).map((e: any) => (
            <li key={e.id} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0"><p>{e.description || e.reference}</p><p className="text-xs text-slate-400">{niceDate(e.occurredAt)} · {e.source.toLowerCase()}{e.reference ? ` · ${e.reference}` : ''}</p></div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-bold text-slate-500">{e.status.toLowerCase()}</span>
                {e.status === 'PENDING' && <><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await perfService.verifyEvidence(e.id, 'VERIFY'); await evidence.reload(); })}>Verify</button>
                  <button className={btnGhost} disabled={busy} onClick={() => run(async () => { await perfService.verifyEvidence(e.id, 'REJECT'); await evidence.reload(); })}>Reject</button></>}
              </div>
            </li>))}</ul>
          <p className="text-xs font-bold text-slate-600 mb-1">Add evidence on their behalf</p>
          <EvidenceForm uid={evUid} kras={evPlan.kras} onDone={evidence.reload} />
        </Card>
      )}

      <Card title="Monthly check-ins" subtitle="Progress, roadblocks and feedback. Short and regular beats long and rare.">
        <Loading error={checkins.error} loading={checkins.loading} />
        <ul className="divide-y divide-slate-100">{(checkins.data?.items || []).slice(0, 40).map((c: any) => (
          <li key={c.id} className="py-2">
            <div className="flex items-center justify-between gap-2"><p className="text-sm"><span className="font-semibold text-slate-800">{c.employeeName}</span> <span className="text-slate-400">· {c.month}</span></p>
              <div className="flex items-center gap-2"><span className={`text-[11px] font-bold ${c.status === 'DONE' ? 'text-emerald-600' : 'text-amber-600'}`}>{c.status === 'DONE' ? 'done' : 'pending'}</span>
                <button className={btnGhost} onClick={() => setCi(ci?.id === c.id ? null : { ...c })}>{ci?.id === c.id ? 'Close' : 'Open'}</button></div></div>
            {ci?.id === c.id && (
              <div className="mt-2 space-y-2">
                {c.employeeNote && <Notice>Employee note: {c.employeeNote}</Notice>}
                <Field label="Progress"><textarea className={input} rows={2} value={ci.progress} onChange={(e) => setCi({ ...ci, progress: e.target.value })} /></Field>
                <Field label="Roadblocks"><textarea className={input} rows={2} value={ci.roadblocks} onChange={(e) => setCi({ ...ci, roadblocks: e.target.value })} /></Field>
                <Field label="Feedback"><textarea className={input} rows={2} value={ci.feedback} onChange={(e) => setCi({ ...ci, feedback: e.target.value })} /></Field>
                <div className="flex gap-2"><button className={btnGhost} disabled={busy} onClick={() => run(async () => { await perfService.saveCheckin({ uid: c.uid, month: c.month, progress: ci.progress, roadblocks: ci.roadblocks, feedback: ci.feedback }); await checkins.reload(); }, 'Saved.')}>Save</button>
                  <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.saveCheckin({ uid: c.uid, month: c.month, progress: ci.progress, roadblocks: ci.roadblocks, feedback: ci.feedback, done: true }); setCi(null); await checkins.reload(); }, 'Check-in done.')}>Mark done</button></div>
              </div>)}
          </li>))}</ul>
      </Card>
      <span className="hidden">{me.uid}</span>
    </div>
  );
};
