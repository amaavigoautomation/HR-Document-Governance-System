import React, { useState } from 'react';
import { perfService } from '../../services/perfService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, niceDate, useRunner } from '../leave/ui';
import { Loading, PlanPill, useLoad } from './shared';

/** A plan's goals, read-only. */
export const KraList: React.FC<{ kras: any[]; evidenceByKpi?: Record<string, any[]> }> = ({ kras, evidenceByKpi }) => (
  <div className="space-y-3">
    {kras.map((k) => (
      <div key={k.id} className="border border-slate-200 rounded-lg">
        <div className="px-3 py-2 bg-slate-50 rounded-t-lg text-sm font-bold text-slate-800">{k.name}</div>
        <ul className="divide-y divide-slate-100">
          {k.kpis.map((p: any) => (
            <li key={p.id} className="px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{p.code && <span className="text-slate-400 mr-1.5">{p.code}</span>}{p.description}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Target: <span className="text-slate-700">{p.target || 'not set yet'}</span> · Measured by: {p.measurement || '–'} · Evidence: {p.evidenceSource || '–'}</p>
                </div>
                <span className="text-xs font-bold text-slate-500 shrink-0">{p.weightage}%</span>
              </div>
              {evidenceByKpi?.[p.id]?.length ? <p className="text-[11px] text-slate-400 mt-1">{evidenceByKpi[p.id].length} evidence item(s)</p> : null}
            </li>
          ))}
        </ul>
      </div>
    ))}
  </div>
);

export const EvidenceForm: React.FC<{ uid?: string; kras: any[]; onDone: () => void }> = ({ uid, kras, onDone }) => {
  const { busy, note, run } = useRunner();
  const [f, setF] = useState({ kpiId: '', description: '', reference: '', value: '', occurredAt: '' });
  const kpis = kras.flatMap((k) => k.kpis);
  return (
    <div className="space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="KPI"><select className={input} value={f.kpiId} onChange={(e) => setF({ ...f, kpiId: e.target.value })}><option value="">Choose…</option>{kpis.map((p: any) => <option key={p.id} value={p.id}>{p.code} – {p.description.slice(0, 60)}</option>)}</select></Field>
        <Field label="Date"><input type="date" className={input} value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} /></Field>
      </div>
      <Field label="What happened"><textarea className={input} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid sm:grid-cols-2 gap-2">
        <Field label="Link to proof (task, report, dashboard)"><input className={input} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        <Field label="Number (optional)"><input className={input} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
      </div>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <button className={btnPrimary} disabled={busy || !f.kpiId} onClick={() => run(async () => { await perfService.addEvidence({ ...f, uid }); setF({ kpiId: '', description: '', reference: '', value: '', occurredAt: '' }); onDone(); }, 'Evidence added.')}>Add evidence</button>
    </div>
  );
};

export const MyGoals: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const plans = useLoad(() => perfService.plans('me'), []);
  const ev = useLoad(() => perfService.evidence(), []);
  const trend = useLoad(() => perfService.dashboard('employee'), []);
  const { busy, note, run } = useRunner();
  const plan = (plans.data?.items || []).find((p: any) => p.status !== 'SUPERSEDED');
  const byKpi: Record<string, any[]> = {};
  for (const e of ev.data?.items || []) (byKpi[e.kpiId] = byKpi[e.kpiId] || []).push(e);

  return (
    <div className="space-y-4">
      <Loading error={plans.error} loading={plans.loading} />
      {!plans.loading && !plan && <Notice>You do not have a performance plan yet. HR will set it up; you will be told when it is ready.</Notice>}
      {plan && (
        <Card title="My KRAs and KPIs" right={<PlanPill status={plan.status} />} subtitle={`${plan.roleFamilyName || 'Role'} · reporting to ${plan.managerName || 'not set'}${plan.status === 'ACTIVE' ? ` · active since ${niceDate(plan.effectiveFrom)}` : ''}`}>
          {plan.status === 'CONFIGURATION_PENDING' && <Notice tone="warn">{plan.pendingReason || 'Your plan is waiting on HR configuration.'}</Notice>}
          {plan.status === 'DRAFT' && <Notice>Your manager is setting your targets.</Notice>}
          {plan.status === 'SUBMITTED' && <Notice>Your plan is with HR for approval.</Notice>}
          {plan.status === 'PENDING_ACK' && (
            <div className="mb-3 space-y-2">
              <Notice tone="warn">Please read your goals and targets, then confirm. If something looks wrong, speak to your manager first.</Notice>
              {note && <Notice tone={note.tone}>{note.text}</Notice>}
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await perfService.ackPlan(plan.id); await plans.reload(); onChanged(); }, 'Plan confirmed.')}>I have read and understood my goals</button>
            </div>
          )}
          {plan.kras.length > 0 && <KraList kras={plan.kras} evidenceByKpi={byKpi} />}
          {plan.competencies?.length > 0 && (
            <div className="mt-4"><p className="text-xs font-bold text-slate-600 mb-1">Behaviour standards I am assessed on</p>
              <ul className="text-xs text-slate-600 grid sm:grid-cols-2 gap-x-6 gap-y-1">{plan.competencies.map((c: any) => <li key={c.competencyId}><span className="font-semibold text-slate-700">{c.name}</span> – {c.standard}</li>)}</ul></div>
          )}
        </Card>
      )}
      {plan && (plan.status === 'ACTIVE' || plan.status === 'PENDING_ACK') && (
        <Card title="Add evidence of my work" subtitle="Task counts and hours alone never become a rating. Add what shows the result.">
          <EvidenceForm kras={plan.kras} onDone={ev.reload} />
        </Card>
      )}
      {(ev.data?.items || []).length > 0 && (
        <Card title="My evidence">
          <ul className="divide-y divide-slate-100 text-sm">
            {ev.data.items.slice(0, 30).map((e: any) => (
              <li key={e.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-slate-800">{e.description || e.reference}</p><p className="text-xs text-slate-400">{niceDate(e.occurredAt)}{e.reference ? ` · ${e.reference}` : ''}</p></div>
                <span className={`text-[11px] font-bold ${e.status === 'VERIFIED' ? 'text-emerald-600' : e.status === 'REJECTED' ? 'text-rose-600' : 'text-amber-600'}`}>{e.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {(trend.data?.trend || []).length > 0 && (
        <Card title="My results over time" subtitle="Published reviews only.">
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Review</th><th>KRA</th><th>Behaviour</th><th>SOP</th><th>Overall</th></tr></thead>
            <tbody>{trend.data.trend.map((t: any) => <tr key={t.cycle} className="border-t border-slate-100"><td className="py-1.5">{t.cycle}</td><td>{t.kra ?? '–'}</td><td>{t.behaviour ?? '–'}</td><td>{t.sop ?? '–'}</td><td className="font-bold">{t.overall ?? '–'} <span className="font-normal text-slate-500">{t.band}</span></td></tr>)}</tbody></table>
        </Card>
      )}
      <button className={btnGhost} onClick={() => { plans.reload(); ev.reload(); }}>Refresh</button>
    </div>
  );
};
