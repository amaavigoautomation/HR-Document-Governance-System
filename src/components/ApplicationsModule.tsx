import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Copy, KeyRound, Plus, Upload, Trash2 } from 'lucide-react';
import { User } from '../types';
import { hasPerm } from '../../shared/permissions';
import { csvToObjects } from '../../shared/csv';
import { applicationsService, ApplicationItem, ApplicationSettings } from '../services/applicationsService';

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FA7014]/40';
const btnCls = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-colors disabled:opacity-50';

export const ApplicationsModule: React.FC<{ currentUser: User }> = ({ currentUser }) => {
  const canManage = hasPerm(currentUser.perms, 'app.manage');
  const [legacy, setLegacy] = useState(false);
  const [items, setItems] = useState<ApplicationItem[]>([]);
  const [stages, setStages] = useState<string[]>([]);
  const [settings, setSettings] = useState<Partial<ApplicationSettings> | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [origins, setOrigins] = useState('');
  const [prefix, setPrefix] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', mobile: '', designation: '', city: '', experience: '', resumeUrl: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, st] = await Promise.all([applicationsService.list(), applicationsService.stages()]);
      setLegacy(list.legacy);
      setItems(list.items);
      setStages(st.stages);
      if (!list.legacy && canManage) {
        const cfg = await applicationsService.settings();
        setSettings(cfg);
        if (cfg.secret) setSecret(cfg.secret);
        setOrigins((cfg.allowedOrigins || []).join('\n'));
        setPrefix(cfg.employeeIdPrefix || '');
      }
    } catch (e: any) {
      setError(e.message || 'Could not load applications.');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
    } catch (e: any) {
      setNote(e.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => setNote('Copied.')).catch(() => undefined);

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading applications…</div>;
  if (error) return <div className="p-6 text-sm text-rose-600">{error}</div>;
  if (legacy) {
    return (
      <div className="p-6 text-sm text-slate-600">
        This company reads candidates from its existing website, so applications are not managed here.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-900">Applications</h2>
        <button className={`${btnCls} border-slate-300 bg-white text-slate-700`} onClick={load}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      {note && <div className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">{note}</div>}

      {canManage && settings && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Connect your careers page</h3>
          <p className="text-xs text-slate-500">
            Send a POST with JSON (name, email, mobile, designation, resumeUrl …) to this address from your site's form or server.
            Send the key in the <code>X-Webhook-Key</code> header, or list your site below to allow browser posts from it.
            A GET on the same address returns your open jobs.
          </p>
          <div className="flex gap-2">
            <input readOnly value={settings.webhookUrl || ''} className={inputCls} />
            <button className={`${btnCls} border-slate-300`} onClick={() => copy(settings.webhookUrl || '')}><Copy className="w-3.5 h-3.5" /></button>
          </div>
          {secret ? (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs space-y-2">
              <div className="font-bold text-emerald-800">Your key (shown only now — copy it and store it safely)</div>
              <div className="flex gap-2">
                <input readOnly value={secret} className={inputCls} />
                <button className={`${btnCls} border-emerald-300`} onClick={() => copy(secret)}><Copy className="w-3.5 h-3.5" /></button>
              </div>
              <button className="underline text-emerald-800" onClick={() => setSecret(null)}>I have saved it</button>
            </div>
          ) : (
            <button
              disabled={busy}
              className={`${btnCls} border-slate-300 bg-white text-slate-700`}
              onClick={() => {
                if (!window.confirm('Create a new key? The old key stops working immediately.')) return;
                run(async () => {
                  const r = await applicationsService.rotateKey();
                  setSecret(r.secret || null);
                  setSettings(r);
                });
              }}
            >
              <KeyRound className="w-3.5 h-3.5" /> Create a new key
            </button>
          )}
          <div className="grid md:grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600">
              Allowed websites (one per line, e.g. https://careers.example.com)
              <textarea rows={3} className={inputCls} value={origins} onChange={(e) => setOrigins(e.target.value)} />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Employee ID prefix (e.g. ACM gives ACM001)
              <input className={inputCls} value={prefix} maxLength={5} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
            </label>
          </div>
          <button
            disabled={busy}
            className={`${btnCls} border-[#FA7014] bg-[#FA7014] text-white`}
            onClick={() =>
              run(async () => {
                const r = await applicationsService.saveSettings(origins.split('\n').map((x) => x.trim()).filter(Boolean), prefix);
                setSettings(r);
                setOrigins(r.allowedOrigins.join('\n'));
                setPrefix(r.employeeIdPrefix);
              }, 'Saved.')
            }
          >
            Save settings
          </button>
        </section>
      )}

      {canManage && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Add a candidate</h3>
          <div className="grid md:grid-cols-3 gap-2">
            {(['name', 'email', 'mobile', 'designation', 'city', 'experience', 'resumeUrl'] as const).map((k) => (
              <input
                key={k}
                className={inputCls}
                placeholder={k === 'resumeUrl' ? 'Resume link (https://…)' : k[0].toUpperCase() + k.slice(1)}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              className={`${btnCls} border-[#FA7014] bg-[#FA7014] text-white`}
              onClick={() =>
                run(async () => {
                  const r = await applicationsService.add(form);
                  setForm({ name: '', email: '', mobile: '', designation: '', city: '', experience: '', resumeUrl: '' });
                  await load();
                  setNote(r.duplicate ? 'That candidate already applied for this role; the record was refreshed.' : 'Candidate added.');
                })
              }
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
            <label className={`${btnCls} border-slate-300 bg-white text-slate-700 cursor-pointer`}>
              <Upload className="w-3.5 h-3.5" /> Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  run(async () => {
                    const rows = csvToObjects(await f.text());
                    if (rows.length === 0) throw new Error('No rows found. The first row must be the column names.');
                    const r = await applicationsService.importRows(rows);
                    await load();
                    setNote(`Imported ${r.created}, already existed ${r.duplicates}, skipped ${r.errors.length}${r.errors[0] ? ` (row ${r.errors[0].row}: ${r.errors[0].error})` : ''}.`);
                  });
                }}
              />
            </label>
          </div>
          <p className="text-xs text-slate-500">CSV columns: name, email, mobile, designation (required), city, experience, resumeUrl. Up to 500 rows at a time.</p>
        </section>
      )}

      <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="p-2">Candidate</th><th className="p-2">Role</th><th className="p-2">Source</th>
              <th className="p-2">Applied</th><th className="p-2">Status</th><th className="p-2">Interview</th><th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={7} className="p-4 text-center text-slate-500">No applications yet.</td></tr>
            )}
            {items.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 align-top">
                <td className="p-2">
                  <div className="font-semibold text-slate-800">{a.name}</div>
                  <div className="text-slate-500">{a.email}{a.mobile ? ` · ${a.mobile}` : ''}</div>
                  {a.resumeUrl && <a className="text-[#FA7014] underline" href={a.resumeUrl} target="_blank" rel="noopener noreferrer">Resume</a>}
                </td>
                <td className="p-2">{a.designation}</td>
                <td className="p-2">{a.source}</td>
                <td className="p-2">{a.createdAt.slice(0, 10)}</td>
                <td className="p-2">
                  <select
                    disabled={!canManage || busy}
                    className="border border-slate-300 rounded px-1.5 py-1"
                    value={a.status}
                    onChange={(e) => run(async () => { await applicationsService.update(a.id, { status: e.target.value }); await load(); })}
                  >
                    {[...new Set([a.status, ...stages])].map((st) => <option key={st}>{st}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    type="date"
                    disabled={!canManage || busy}
                    className="border border-slate-300 rounded px-1.5 py-1"
                    defaultValue={a.interviewDate}
                    onBlur={(e) => e.target.value !== a.interviewDate && run(async () => { await applicationsService.update(a.id, { interviewDate: e.target.value }); await load(); })}
                  />
                </td>
                <td className="p-2">
                  {canManage && (
                    <button
                      title="Delete"
                      disabled={busy}
                      className="text-rose-600"
                      onClick={() => window.confirm(`Delete ${a.name}'s application?`) && run(async () => { await applicationsService.remove(a.id); await load(); })}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
