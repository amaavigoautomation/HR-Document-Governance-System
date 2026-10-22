import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { csvToObjects } from '../../../shared/csv';
import { downloadCsv, leaveService } from '../../services/leaveService';
import { MonthView } from './AttendanceTab';
import { Card, Field, Notice, StatusPill, btnDanger, btnGhost, btnPrimary, days, input, niceDate, range, thisMonth, todayIst, useRunner } from './ui';

const readCsv = async (file: File) => csvToObjects(await file.text());

// ------------------------------------------------------------------ people
export const HrPeople: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [dirty, setDirty] = useState<Record<string, any>>({});
  const [q, setQ] = useState('');
  const { busy, note, run } = useRunner();
  const [importResult, setImportResult] = useState<any | null>(null);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([leaveService.people(), leaveService.settings()]);
    setItems(p.items); setSettings(s.settings); setDirty({});
  }, []);
  useEffect(() => { load().catch(() => undefined); }, [load]);

  const row = (p: any) => ({ ...p, ...(dirty[p.uid] || {}) });
  const edit = (uid: string, patch: any) => setDirty({ ...dirty, [uid]: { ...(dirty[uid] || {}), ...patch } });
  const shown = items.filter((p) => !q || `${p.name} ${p.email} ${p.empId}`.toLowerCase().includes(q.toLowerCase()));

  if (!settings) return <div className="text-sm text-slate-500">Loading…</div>;
  return (
    <Card title={`People (${items.length})`} right={
      <div className="flex gap-2">
        <label className={`${btnGhost} cursor-pointer`}>Import CSV
          <input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(async () => { const r = await leaveService.importProfiles(await readCsv(f)); setImportResult(r); await load(); }, 'Import finished.'); }} />
        </label>
        <button className={btnPrimary} disabled={busy || Object.keys(dirty).length === 0} onClick={() => run(async () => {
          await leaveService.saveProfiles(Object.entries(dirty).map(([uid, d]) => { const p = items.find((x) => x.uid === uid); return { uid, locationId: p.locationId, policyId: p.policyId, managerUid: p.managerUid, joinDate: p.joinDate, gender: p.gender, ...d }; }));
          await load();
        }, 'Saved.')}>Save {Object.keys(dirty).length || ''} change(s)</button>
      </div>}>
      <p className="text-[11px] text-slate-400 mb-2">CSV columns: email, location, policy, manager_email, join_date (YYYY-MM-DD), gender (F/M/O). Blank cells keep the current value.</p>
      {note && <div className="mb-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
      {importResult && <div className="mb-2"><Notice tone={importResult.errors.length ? 'info' : 'ok'}>Saved {importResult.saved}. {importResult.errors.slice(0, 5).map((e: any) => `Row ${e.row}: ${e.error}. `)}</Notice></div>}
      <input className={`${input} max-w-xs mb-2`} placeholder="Search name, email, ID" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="overflow-x-auto">
        <table className="text-xs min-w-[900px] w-full">
          <thead className="text-left text-slate-500"><tr><th className="p-1.5">Person</th><th className="p-1.5">Location</th><th className="p-1.5">Policy</th><th className="p-1.5">Manager</th><th className="p-1.5">Joined</th><th className="p-1.5">Gender</th></tr></thead>
          <tbody>
            {shown.map((p0) => { const p = row(p0); return (
              <tr key={p.uid} className={`border-t border-slate-100 ${p.active ? '' : 'opacity-50'}`}>
                <td className="p-1.5"><div className="font-semibold text-slate-800">{p.name}</div><div className="text-slate-400">{p.email}</div></td>
                <td className="p-1"><select className={input} value={p.locationId} onChange={(e) => edit(p.uid, { locationId: e.target.value })}>{settings.locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></td>
                <td className="p-1"><select className={input} value={p.policyId} onChange={(e) => edit(p.uid, { policyId: e.target.value })}>{settings.policies.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></td>
                <td className="p-1"><select className={input} value={p.managerUid} onChange={(e) => edit(p.uid, { managerUid: e.target.value })}><option value="">None (HR approves)</option>{items.filter((m) => m.uid !== p.uid && m.active).map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}</select></td>
                <td className="p-1"><input type="date" className={input} value={p.joinDate} onChange={(e) => edit(p.uid, { joinDate: e.target.value })} /></td>
                <td className="p-1"><select className={input} value={p.gender} onChange={(e) => edit(p.uid, { gender: e.target.value })}><option value="">—</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option></select></td>
              </tr>); })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

// ------------------------------------------------------------------ balances
export const HrBalances: React.FC = () => {
  const [people, setPeople] = useState<any[]>([]);
  const [settings, setSettings] = useState<any | null>(null);
  const [uid, setUid] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState({ typeId: '', delta: '', note: '', kind: 'ADJUST' });
  const [res, setRes] = useState<any | null>(null);
  const { busy, note, run } = useRunner();

  useEffect(() => { Promise.all([leaveService.people(), leaveService.settings()]).then(([p, s]) => { setPeople(p.items); setSettings(s.settings); setForm((f) => ({ ...f, typeId: s.settings.types.find((t: any) => t.requiresBalance && !t.isLop)?.id || '' })); }); }, []);
  const loadLedger = useCallback((u: string) => u ? leaveService.balancesOf(u).then((r) => setRows(r.items)) : setRows([]), []);
  useEffect(() => { loadLedger(uid); }, [uid, loadLedger]);

  if (!settings) return <div className="text-sm text-slate-500">Loading…</div>;
  return (
    <div className="space-y-4">
      <Card title="Accrual and year-end" right={<button className={btnGhost} disabled={busy} onClick={() => run(async () => { const r = await leaveService.runAccrual(); setRes(r); }, 'Accrual run complete.')}>Run accrual now</button>}>
        <p className="text-xs text-slate-600">Credits are added automatically each day by the scheduled job, and the year-end carry-forward / lapse runs when a new leave year begins. Use this to run it immediately (it never credits the same period twice).</p>
        {res && <div className="mt-2"><Notice tone="ok">{res.employees} employees · {res.credits} credits added · {res.rollovers} year-end roll-overs</Notice></div>}
      </Card>
      <Card title="Adjust or encash a balance">
        <div className="grid sm:grid-cols-5 gap-3 items-end">
          <Field label="Employee"><select className={input} value={uid} onChange={(e) => setUid(e.target.value)}><option value="">Choose…</option>{people.filter((p) => p.active).map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>
          <Field label="Leave type"><select className={input} value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })}>{settings.types.filter((t: any) => t.requiresBalance && !t.isLop).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Action"><select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="ADJUST">Add / deduct days</option><option value="ENCASH">Encash (deduct)</option></select></Field>
          <Field label="Days" hint={form.kind === 'ADJUST' ? 'Use a minus to deduct' : ''}><input type="number" step="0.5" className={input} value={form.delta} onChange={(e) => setForm({ ...form, delta: e.target.value })} /></Field>
          <Field label="Note (required)"><input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>
        <div className="mt-3"><button className={btnPrimary} disabled={busy || !uid} onClick={() => run(async () => { await leaveService.adjust({ uid, ...form, delta: Number(form.delta) }); setForm({ ...form, delta: '', note: '' }); await loadLedger(uid); }, 'Recorded.')}>Save</button></div>
        {note && <div className="mt-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
        {uid && <div className="mt-4 max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {rows.length === 0 ? <div className="p-3 text-xs text-slate-500">No entries yet.</div> : rows.map((e) => (
            <div key={e.id} className="flex justify-between px-3 py-1.5 text-xs"><span>{e.typeName} · {e.kind.toLowerCase().replace('_', ' ')} · {niceDate(e.date)} {e.note && `· ${e.note}`} {e.by && <span className="text-slate-400">({e.by})</span>}</span><b className={e.delta < 0 ? 'text-rose-600' : 'text-emerald-600'}>{e.delta > 0 ? '+' : ''}{e.delta}</b></div>
          ))}
        </div>}
      </Card>
      <Card title="Import opening balances">
        <p className="text-[11px] text-slate-500 mb-2">CSV columns: email, type (code such as CL), balance. Importing again replaces the opening balance for the current leave year.</p>
        <label className={`${btnGhost} cursor-pointer`}>Choose CSV
          <input type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(async () => { const r = await leaveService.importBalances(await readCsv(f)); setRes(null); setForm((x) => ({ ...x })); alert(`Saved ${r.saved}.${r.errors.length ? ' Problems: ' + r.errors.slice(0, 5).map((x: any) => `row ${x.row}: ${x.error}`).join('; ') : ''}`); }); }} />
        </label>
      </Card>
    </div>
  );
};

// ------------------------------------------------------------------ requests
export const HrRequests: React.FC<{ me: any }> = ({ me }) => {
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [form, setForm] = useState({ uid: '', typeId: me.settings.types[0]?.id || '', from: todayIst(), to: todayIst(), halfFrom: false, reason: '' });
  const { busy, note, run } = useRunner();
  const load = useCallback(() => leaveService.allRequests({ status }).then((r) => setItems(r.items)), [status]);
  useEffect(() => { load().catch(() => undefined); }, [load]);
  useEffect(() => { leaveService.people().then((p) => setPeople(p.items)).catch(() => undefined); }, []);

  return (
    <div className="space-y-4">
      <Card title="Record leave for someone (approved immediately)">
        <div className="grid sm:grid-cols-6 gap-3 items-end">
          <Field label="Employee"><select className={input} value={form.uid} onChange={(e) => setForm({ ...form, uid: e.target.value })}><option value="">Choose…</option>{people.filter((p) => p.active).map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>
          <Field label="Type"><select className={input} value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })}>{me.settings.types.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="From"><input type="date" className={input} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to < e.target.value ? e.target.value : form.to })} /></Field>
          <Field label="To"><input type="date" className={input} value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field>
          <Field label="Reason"><input className={input} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          <button className={btnPrimary} disabled={busy || !form.uid} onClick={() => run(async () => { await leaveService.hrCreate(form); await load(); }, 'Recorded.')}>Record</button>
        </div>
        {note && <div className="mt-2"><Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice></div>}
      </Card>
      <Card title="All requests" right={<select className="border border-slate-300 rounded px-2 py-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CANCEL_REQUESTED'].map((s) => <option key={s}>{s}</option>)}</select>}>
        <div className="divide-y divide-slate-100">
          {items.length === 0 && <div className="text-xs text-slate-500">No requests.</div>}
          {items.map((r) => (
            <div key={r.id} className="py-2 flex flex-wrap justify-between items-center gap-2">
              <div><div className="text-sm font-semibold text-slate-800">{r.name} · {r.typeName} · {days(r.days)}</div><div className="text-xs text-slate-500">{range(r.from, r.to)}{r.managerName ? ` · manager ${r.managerName}` : ''}{r.reason ? ` · ${r.reason}` : ''}</div></div>
              <div className="flex items-center gap-2"><StatusPill status={r.status} />
                {['PENDING', 'APPROVED', 'CANCEL_REQUESTED'].includes(r.status) && <button className={btnDanger} disabled={busy} onClick={() => window.confirm('Cancel this leave and restore the balance?') && run(async () => { await leaveService.hrCancel(r.id); await load(); })}>Cancel</button>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ------------------------------------------------------------------ reports
export const HrReports: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [month, setMonth] = useState(thisMonth());
  const [att, setAtt] = useState<any | null>(null);
  const [bal, setBal] = useState<any | null>(null);
  const [open, setOpen] = useState<any | null>(null);
  const [fix, setFix] = useState({ date: todayIst(), checkIn: '09:30', checkOut: '18:30', note: '' });
  const { busy, note, run } = useRunner();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setError(null); leaveService.reportAttendance(month).then(setAtt).catch((e) => setError(e.message)); }, [month]);
  useEffect(() => { leaveService.reportBalances().then(setBal).catch(() => undefined); }, []);

  const exportAtt = () => att && downloadCsv(`attendance-${month}.csv`, [
    ['Employee ID', 'Name', 'Department', 'Present', 'Late', 'Half days', 'Leave', 'Absent', 'Incomplete', 'Holidays', 'Weekly offs', 'Loss of pay days', 'Late deduction (suggested)'],
    ...att.rows.map((r: any) => [r.empId, r.name, r.department, r.present, r.late, r.halfDay, r.leave, r.absent, r.incomplete, r.holidays, r.weeklyOffs, r.lossOfPayDays, r.lateDeductionDays]),
  ]);
  const exportBal = () => bal && downloadCsv('leave-balances.csv', [
    ['Employee ID', 'Name', 'Department', ...bal.types.map((t: any) => t.name)],
    ...bal.rows.map((r: any) => [r.empId, r.name, r.department, ...bal.types.map((t: any) => r.balances[t.id] ?? '')]),
  ]);

  return (
    <div className="space-y-4">
      <Card title="Monthly attendance" right={<div className="flex gap-2 items-center"><input type="month" className="border border-slate-300 rounded px-2 py-1 text-xs" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /><button className={btnGhost} onClick={exportAtt}>Export CSV</button></div>}>
        {error && <Notice tone="error">{error}</Notice>}
        <p className="text-[11px] text-slate-400 mb-2">Loss of pay = absent days + half of each half day. Click a name to see the days{canManage ? ' and fix them' : ''}.</p>
        <div className="overflow-x-auto">
          <table className="text-xs w-full min-w-[800px]">
            <thead className="text-left text-slate-500"><tr>{['Name', 'Present', 'Late', 'Half', 'Leave', 'Absent', 'No out', 'Loss of pay', 'Suggested late cut'].map((h) => <th key={h} className="p-1.5">{h}</th>)}</tr></thead>
            <tbody>
              {att?.rows.map((r: any) => (
                <tr key={r.uid} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setOpen(r)}>
                  <td className="p-1.5 font-semibold text-slate-800">{r.name}<span className="text-slate-400 font-normal"> {r.empId}</span></td>
                  <td className="p-1.5">{r.present}</td><td className="p-1.5">{r.late}</td><td className="p-1.5">{r.halfDay}</td><td className="p-1.5">{r.leave}</td>
                  <td className="p-1.5">{r.absent}</td><td className="p-1.5">{r.incomplete}</td><td className="p-1.5 font-bold">{r.lossOfPayDays}</td><td className="p-1.5">{r.lateDeductionDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {open && (
        <Card title={open.name} right={<button className={btnGhost} onClick={() => setOpen(null)}>Close</button>}>
          {canManage && (
            <div className="flex flex-wrap items-end gap-2 mb-3 p-3 bg-slate-50 rounded-lg">
              <Field label="Date"><input type="date" className={input} value={fix.date} onChange={(e) => setFix({ ...fix, date: e.target.value })} /></Field>
              <Field label="In"><input type="time" className={input} value={fix.checkIn} onChange={(e) => setFix({ ...fix, checkIn: e.target.value })} /></Field>
              <Field label="Out"><input type="time" className={input} value={fix.checkOut} onChange={(e) => setFix({ ...fix, checkOut: e.target.value })} /></Field>
              <Field label="Note"><input className={input} value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} /></Field>
              <button className={btnPrimary} disabled={busy} onClick={() => run(async () => { await leaveService.markAttendance({ uid: open.uid, ...fix }); const r = await leaveService.reportAttendance(month); setAtt(r); setOpen({ ...open }); }, 'Saved.')}>Mark present</button>
              <button className={btnDanger} disabled={busy} onClick={() => run(async () => { await leaveService.markAttendance({ uid: open.uid, date: fix.date, clear: true }); setAtt(await leaveService.reportAttendance(month)); setOpen({ ...open }); }, 'Cleared.')}>Clear that day</button>
              {note && <Notice tone={note.tone === 'ok' ? 'ok' : 'error'}>{note.text}</Notice>}
            </div>
          )}
          <MonthView key={`${open.uid}-${month}-${att?.rows?.length}-${JSON.stringify(open.present)}`} uid={open.uid} />
        </Card>
      )}
      <Card title="Leave balances (current year)" right={<button className={btnGhost} onClick={exportBal}>Export CSV</button>}>
        <div className="overflow-x-auto">
          <table className="text-xs w-full">
            <thead className="text-left text-slate-500"><tr><th className="p-1.5">Name</th>{bal?.types.map((t: any) => <th key={t.id} className="p-1.5">{t.code}</th>)}</tr></thead>
            <tbody>
              {bal?.rows.map((r: any) => (
                <tr key={r.uid} className="border-t border-slate-100"><td className="p-1.5 font-semibold text-slate-800">{r.name}</td>{bal.types.map((t: any) => <td key={t.id} className={`p-1.5 ${(r.balances[t.id] ?? 0) < 0 ? 'text-rose-600 font-bold' : ''}`}>{r.balances[t.id] ?? '—'}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
export { useMemo };
