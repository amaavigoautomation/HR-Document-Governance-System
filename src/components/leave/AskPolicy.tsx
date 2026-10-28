import React, { useState } from 'react';
import { leaveService } from '../../services/leaveService';
import { btnGhost, Card } from './ui';

/** Ask a question about the leave policy. The answer is read from the published policy and names its version. */
export const AskPolicy: React.FC = () => {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ answer: string; policyReference: string; answered: boolean } | null>(null);
  const [err, setErr] = useState('');

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setErr('');
    try { setRes(await leaveService.askPolicy(q.trim())); } catch (x: any) { setErr(x?.message || 'Could not answer right now.'); }
    setBusy(false);
  };

  return (
    <Card title="Ask about the leave policy" subtitle="For example: how much notice does casual leave need?">
      <form onSubmit={ask} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="Type your question"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" aria-label="Question about the leave policy" />
        <button type="submit" disabled={busy || !q.trim()} className={btnGhost}>{busy ? 'Looking…' : 'Ask'}</button>
      </form>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {res && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <p>{res.answer}</p>
          <p className="mt-1 text-xs text-slate-500">{res.policyReference}. HR makes the final decision on any request.</p>
        </div>
      )}
    </Card>
  );
};
