import React, { useState } from 'react';
import { joiningService } from '../../services/hiringExtraService';
import { Card, ConfirmButton, EmptyState, Field, Notice, btnGhost, btnPrimary, input, todayIst, useRunner } from '../leave/ui';
import { Loading, Pill, useLoad } from '../perf/shared';

const IT_LABEL: Record<string, string> = { email: 'Email', m365: 'Microsoft 365', google: 'Google account', teams: 'Teams', clickup: 'ClickUp', attendance: 'Attendance', payroll: 'Payroll' };

const Board: React.FC = () => {
  const b = useLoad(() => joiningService.board(), []);
  const { run, busy, note } = useRunner();
  const rows: any[] = b.data?.rows || [];
  const kit: string[] = b.data?.kit?.items || [];
  return (
    <div className="space-y-3">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Loading error={b.error} loading={b.loading} />
      {!b.loading && rows.length === 0 && <EmptyState title="Nobody joining yet" text="People appear here once they accept an offer." />}
      {rows.map((r) => (
        <Card key={r.offerId} title={`${r.candidateName} - ${r.designation}`} subtitle={`Joining ${r.joiningDate}${r.employeeId ? ` - ${r.employeeId}` : ''}`} right={<Pill tone={r.offerStatus === 'JOINED' ? 'green' : 'blue'}>{r.offerStatus === 'JOINED' ? 'Joined' : 'Accepted'}</Pill>}>
          {r.onboardingError && <Notice tone="warn">Onboarding did not start automatically: {r.onboardingError}</Notice>}
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Pill tone={r.docsUploaded >= r.docsRequired ? 'green' : 'amber'}>documents {r.docsUploaded}/{r.docsRequired}</Pill>
            <Pill tone={r.emergency ? 'green' : 'amber'}>emergency contact {r.emergency ? 'given' : 'missing'}</Pill>
            <Pill tone={r.kit.done === r.kit.total ? 'green' : 'amber'}>welcome kit {r.kit.done}/{r.kit.total}</Pill>
            {r.assets.map((a: any) => <Pill key={a.id} tone="blue">{a.type} {a.tag}</Pill>)}
          </div>
          {r.onboardingId && (
            <>
              <div className="mt-3 text-xs font-bold text-slate-700">Welcome kit</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">{kit.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!r.kit.ticks[k]} disabled={busy} onChange={(e) => run(async () => { await joiningService.kitTick({ onboardingId: r.onboardingId, item: k, done: e.target.checked }); await b.reload(); })} />{k}</label>
              ))}</div>
              <div className="mt-3 text-xs font-bold text-slate-700">IT and tool setup</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">{(b.data?.itKeys || []).map((it: { key: string; label: string }) => {
                const k = it.key;
                return (
                <label key={k} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={r.itAccounts[k]?.status === 'DONE'} disabled={busy} onChange={(e) => run(async () => { await joiningService.itSet({ onboardingId: r.onboardingId, key: k, status: e.target.checked ? 'DONE' : 'PENDING' }); await b.reload(); })} />{it.label || IT_LABEL[k] || k}</label>
              ); })}</div>
            </>
          )}
        </Card>
      ))}
    </div>
  );
};

const Assets: React.FC = () => {
  const a = useLoad(() => joiningService.assets(), []);
  const board = useLoad(() => joiningService.board(), []);
  const { run, busy, note } = useRunner();
  const [f, setF] = useState({ tag: '', type: 'LAPTOP', serial: '', description: '' });
  const [issue, setIssue] = useState<{ id: string; onboardingId: string }>({ id: '', onboardingId: '' });
  const items: any[] = a.data?.items || [];
  const joiners: any[] = (board.data?.rows || []).filter((r: any) => r.onboardingId);
  return (
    <Card title="Asset register" subtitle="Laptops, phones, ID cards. Each asset tag is unique; issue to a joiner and mark returned later.">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <div className="grid gap-2 sm:grid-cols-5">
        <input className={input} placeholder="Asset tag" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} />
        <select className={input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{(a.data?.types || ['LAPTOP']).map((t: string) => <option key={t}>{t}</option>)}</select>
        <input className={input} placeholder="Serial" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} />
        <input className={input} placeholder="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <button className={btnPrimary} disabled={busy || !f.tag} onClick={() => run(async () => { await joiningService.assetSave({ ...f, purchasedOn: todayIst() }); setF({ ...f, tag: '', serial: '', description: '' }); await a.reload(); }, 'Asset added.')}>Add asset</button>
      </div>
      <Loading error={a.error} loading={a.loading} />
      <ul className="mt-3 divide-y divide-slate-100 text-sm">{items.map((x) => (
        <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span><b>{x.tag}</b> - {x.type}{x.serial ? ` - ${x.serial}` : ''} <Pill tone={x.status === 'ISSUED' ? 'amber' : x.status === 'IN_STOCK' ? 'green' : 'slate'}>{String(x.status).toLowerCase()}</Pill>{x.holderName ? ` held by ${x.holderName}` : ''}</span>
          <span className="flex items-center gap-2">
            {x.status === 'IN_STOCK' && (issue.id === x.id ? (
              <>
                <select className={`${input} max-w-[200px]`} value={issue.onboardingId} onChange={(e) => setIssue({ id: x.id, onboardingId: e.target.value })}><option value="">Issue to...</option>{joiners.map((j) => <option key={j.onboardingId} value={j.onboardingId}>{j.candidateName}</option>)}</select>
                <button className={btnPrimary} disabled={busy || !issue.onboardingId} onClick={() => run(async () => { await joiningService.assetIssue({ id: x.id, onboardingId: issue.onboardingId, issuedOn: todayIst() }); setIssue({ id: '', onboardingId: '' }); await a.reload(); await board.reload(); }, 'Issued.')}>Issue</button>
              </>
            ) : <button className={btnGhost} onClick={() => setIssue({ id: x.id, onboardingId: '' })}>Issue</button>)}
            {x.status === 'ISSUED' && <ConfirmButton question="Returned?" yes="Returned" className={btnGhost} onConfirm={() => run(async () => { await joiningService.assetReturn({ id: x.id, returnedOn: todayIst(), condition: 'GOOD' }); await a.reload(); }, 'Marked returned.')}>Mark returned</ConfirmButton>}
          </span>
        </li>
      ))}</ul>
    </Card>
  );
};

/** Joining board: documents, welcome kit, IT setup and assets for everyone who accepted an offer. */
export const JoiningTab: React.FC = () => (
  <div className="space-y-4"><Board /><Assets /></div>
);
void Field;
