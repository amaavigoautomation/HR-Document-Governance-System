import React, { useCallback, useEffect, useState } from 'react';
import { lifecycleService } from '../../services/lifecycleService';
import { Card, Field, Notice, btnGhost, btnPrimary, input, useRunner } from '../leave/ui';
import { downloadLetterPdf } from './letterPdf';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Pick a template and a person, fill the blanks, check the preview, then issue (numbered, stored, shown to the employee). */
export const LettersTab: React.FC<{ people: { uid: string; name: string }[]; templates: { id: string; name: string; kind: string }[] }> = ({ people, templates }) => {
  const [tplId, setTplId] = useState(templates[0]?.id || '');
  const [uid, setUid] = useState('');
  const [recipient, setRecipient] = useState('');
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [pv, setPv] = useState<any | null>(null);
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const { busy, note, run } = useRunner();

  const loadHistory = useCallback(() => lifecycleService.letters().then((r) => setHistory(r.letters)).catch(() => undefined), []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const preview = useCallback(async (values = typed) => {
    if (!tplId) return;
    const r = await lifecycleService.previewLetter({ templateId: tplId, uid, recipient, values });
    setPv(r);
    if (!edited) setText(r.text);
  }, [tplId, uid, recipient, typed, edited]);
  useEffect(() => { setEdited(false); setPv(null); }, [tplId, uid]);

  const manual = (pv?.catalog || []).filter((c: any) => c.source === 'manual' && pv.fields.includes(c.key));
  const unknown = (pv?.fields || []).filter((k: string) => !(pv.catalog || []).some((c: any) => c.key === k));

  return (
    <div className="space-y-4">
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      <Card title="Create a letter">
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="Letter"><select className={input} value={tplId} onChange={(e) => setTplId(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="For (employee)" hint="Leave empty for a candidate who has no account yet"><select className={input} value={uid} onChange={(e) => setUid(e.target.value)}><option value="">A candidate / someone else</option>{people.map((p) => <option key={p.uid} value={p.uid}>{p.name}</option>)}</select></Field>
          {!uid && <Field label="Name on the letter"><input className={input} value={recipient} onChange={(e) => setRecipient(e.target.value)} /></Field>}
        </div>
        <div className="mt-3"><button className={btnGhost} disabled={busy || !tplId} onClick={() => run(() => preview())}>Fill and preview</button></div>
      </Card>

      {pv && (
        <Card title="Preview">
          {pv.warnings.map((w: string) => <div key={w} className="mb-2"><Notice>{w}</Notice></div>)}
          {(manual.length > 0 || unknown.length > 0) && (
            <div className="grid sm:grid-cols-3 gap-3 mb-3">
              {manual.map((c: any) => <Field key={c.key} label={c.label}><input className={input} value={typed[c.key] ?? ''} onChange={(e) => setTyped({ ...typed, [c.key]: e.target.value })} /></Field>)}
              {unknown.map((k: string) => <Field key={k} label={k.replace(/_/g, ' ')}><input className={input} value={typed[k] ?? ''} onChange={(e) => setTyped({ ...typed, [k]: e.target.value })} /></Field>)}
              <div className="flex items-end"><button className={btnGhost} onClick={() => { setEdited(false); run(() => preview()); }}>Update preview</button></div>
            </div>
          )}
          {pv.missing.length > 0 && <div className="mb-2"><Notice tone="error">Still empty: {pv.missing.join(', ')}. Fill them in or the letter cannot be issued.</Notice></div>}
          <textarea className={`${input} font-mono text-xs leading-5`} rows={20} value={text} onChange={(e) => { setText(e.target.value); setEdited(true); }} />
          <p className="text-[11px] text-slate-400 mt-1">You can adjust the wording here before issuing. {edited && 'Edited text is issued as typed.'}</p>
          <div className="mt-3">
            <button className={btnPrimary} disabled={busy || (!uid && !recipient.trim()) || /\{\{[a-z0-9_]+\}\}/i.test(text)} onClick={() => run(async () => {
              const r = await lifecycleService.issueLetter({ templateId: tplId, uid, recipient, values: typed, text: edited ? text : undefined });
              downloadLetterPdf(r.letter);
              setPv(null); setTyped({}); await loadHistory();
            }, 'Letter issued. The PDF has been downloaded' + (uid ? ' and the employee can see it under My letters.' : '.'))}>Issue letter and download PDF</button>
          </div>
        </Card>
      )}

      <Card title="Issued letters">
        {history.length === 0 ? <p className="text-sm text-slate-400">Nothing issued yet.</p> : (
          <table className="w-full text-xs"><tbody>{history.map((l) => (
            <tr key={l.id} className="border-b border-slate-100">
              <td className="p-1.5 font-mono">{l.number}</td><td className="p-1.5">{l.title}</td><td className="p-1.5 font-bold">{l.recipient}</td><td className="p-1.5 text-slate-500">{when(l.issuedAt)} · {l.issuedBy}</td>
              <td className="p-1.5 text-right"><button className="text-[#FA7014] font-bold hover:underline" onClick={() => run(async () => { const r = await lifecycleService.letter(l.id); downloadLetterPdf(r.letter); })}>PDF</button></td>
            </tr>
          ))}</tbody></table>
        )}
      </Card>
    </div>
  );
};

export const MyLetters: React.FC = () => {
  const [list, setList] = useState<any[] | null>(null);
  useEffect(() => { lifecycleService.myLetters().then((r) => setList(r.letters)).catch(() => setList([])); }, []);
  if (!list) return <div className="text-sm text-slate-500">Loading…</div>;
  return (
    <Card title="My letters">
      {list.length === 0 ? <p className="text-sm text-slate-400">HR has not issued any letters to you yet.</p> : (
        <ul className="divide-y divide-slate-100">{list.map((l) => (
          <li key={l.id} className="py-2 flex items-center gap-3 text-sm"><div className="flex-1"><div className="font-bold">{l.title}</div><div className="text-[11px] text-slate-500">{l.number} · {when(l.issuedAt)}</div></div><button className={btnGhost} onClick={() => downloadLetterPdf(l)}>Download PDF</button></li>
        ))}</ul>
      )}
    </Card>
  );
};
