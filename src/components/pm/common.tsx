import React, { useState } from 'react';
import { Info, ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { Notice, btnPrimary, btnGhost, input, Field } from '../leave/ui';
import { Pill } from '../common/loadUi';
import { RATING_HELP, RATING_WORDS, PLAN_WORDS, REVIEW_WORDS, GROWTH_STATUS_WORDS, SOP_WORDS, type SopResult } from '../../../shared/pmEngine';

/** One short sentence at the top of every screen: what this is and what to do. */
export const Intro: React.FC<{ title: string; what: string; todo?: string }> = ({ title, what, todo }) => (
  <div className="mb-4">
    <h2 className="text-lg font-extrabold text-slate-900">{title}</h2>
    <p className="text-sm text-slate-600 mt-0.5">{what}</p>
    {todo && <p className="text-sm text-slate-800 mt-1.5 flex items-start gap-1.5"><Info className="w-4 h-4 mt-0.5 text-[#FA7014] shrink-0" /><span><b>What to do:</b> {todo}</span></p>}
  </div>
);

/** A "how does this work?" box that stays out of the way. */
export const Explain: React.FC<{ title?: string; children: React.ReactNode }> = ({ title = 'How does this work?', children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4 border border-slate-200 rounded-xl bg-slate-50">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700">
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{title}
      </button>
      {open && <div className="px-3 pb-3 text-sm text-slate-600 space-y-1.5">{children}</div>}
    </div>
  );
};

/** 1 to 5 as big buttons with words, plus "Not observed". Nothing is chosen until the person chooses. Hover shows what each number means. */
export const RatingPick: React.FC<{ value: unknown; onChange: (v: number | 'NO' | null) => void; disabled?: boolean; label?: string }> = ({ value, onChange, disabled, label }) => (
  <div role="radiogroup" aria-label={label || 'Rating'} className="flex flex-wrap gap-1.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" role="radio" aria-checked={value === n} disabled={disabled} title={RATING_HELP[n]} onClick={() => onChange(value === n ? null : n)}
        className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold text-left leading-tight transition-colors disabled:opacity-60 ${value === n ? 'bg-[#FA7014] border-[#FA7014] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
        <span className="text-sm">{n}</span><span className="block text-[10px] font-medium opacity-90">{RATING_WORDS[n]}</span>
      </button>
    ))}
    <button type="button" role="radio" aria-checked={value === 'NO'} disabled={disabled} title="No evidence either way. Left out of the score, never counted as 0." onClick={() => onChange(value === 'NO' ? null : 'NO')}
      className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold leading-tight disabled:opacity-60 ${value === 'NO' ? 'bg-slate-700 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
      Not observed<span className="block text-[10px] font-medium opacity-90">Left out, not zero</span>
    </button>
  </div>
);

export const ratingText = (v: unknown) => (v === 'NO' ? 'Not observed' : typeof v === 'number' ? `${v} · ${RATING_WORDS[v]}` : '-');

export const SopPick: React.FC<{ value: unknown; onChange: (v: SopResult) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => (
  <div className="flex flex-wrap gap-1.5" role="radiogroup">
    {(['C', 'N', 'NA', 'NV'] as SopResult[]).map((k) => (
      <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} onClick={() => onChange(k)}
        className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-60 ${value === k ? (k === 'N' ? 'bg-rose-600 border-rose-600 text-white' : k === 'C' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-700 border-slate-700 text-white') : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
        {SOP_WORDS[k]}
      </button>
    ))}
  </div>
);

const TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  ON_HOLD: 'amber', SET_TARGETS: 'blue', HR_CHECK: 'amber', ACTIVE: 'green', CLOSED: 'slate',
  SELF: 'blue', MANAGER: 'blue', HR: 'amber', APPROVED: 'green', PUBLISHED: 'blue', ACKNOWLEDGED: 'green', DISPUTED: 'red', RESOLVED: 'green', DEFERRED: 'slate',
  PROPOSED: 'amber', DONE: 'green', CANCELLED: 'slate', DUE: 'amber', PENDING: 'amber', VERIFIED: 'green', REJECTED: 'red',
};
const WORDS: Record<string, string> = { ...GROWTH_STATUS_WORDS, ...PLAN_WORDS, ...REVIEW_WORDS, DUE: 'To do', PENDING: 'Waiting for manager', VERIFIED: 'Verified', REJECTED: 'Does not count' };
export const StatusChip: React.FC<{ status: string; kind?: 'plan' | 'review' | 'growth' | 'other' }> = ({ status, kind }) => {
  const words = kind === 'plan' ? PLAN_WORDS[status] : kind === 'review' ? REVIEW_WORDS[status] : kind === 'growth' ? GROWTH_STATUS_WORDS[status] : WORDS[status];
  return <Pill tone={TONE[status] || 'slate'}>{words || WORDS[status] || status.replace(/_/g, ' ').toLowerCase()}</Pill>;
};

export const Note: React.FC<{ label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string; disabled?: boolean; placeholder?: string }> = ({ label, value, onChange, rows = 3, hint, disabled, placeholder }) => (
  <Field label={label} hint={hint}><textarea className={input} rows={rows} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></Field>
);

export const ResultNote: React.FC<{ note: { tone: 'ok' | 'error'; text: string } | null }> = ({ note }) => (note ? <Notice tone={note.tone}>{note.text}</Notice> : null);
export const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-sm text-slate-500 py-6 text-center">{text}</p>;

export const Tabs: React.FC<{ value: string; onChange: (v: string) => void; items: { key: string; label: string; count?: number }[] }> = ({ value, onChange, items }) => (
  <div className="flex flex-wrap gap-1.5 mb-4" role="tablist">
    {items.map((i) => (
      <button key={i.key} type="button" role="tab" aria-selected={value === i.key} onClick={() => onChange(i.key)} className={value === i.key ? btnPrimary : btnGhost}>
        {i.label}{i.count ? ` (${i.count})` : ''}
      </button>
    ))}
  </div>
);

/**
 * A button that stays locked until everything it needs is there, and says why.
 * This is the main "can't get it wrong" rule: wrong actions are impossible, not just warned about.
 */
export const GuardedButton: React.FC<{ missing: string[]; onClick: () => void; busy?: boolean; className?: string; children: React.ReactNode }> = ({ missing, onClick, busy, className = btnPrimary, children }) => (
  <div className="inline-flex flex-col items-start gap-1">
    <button type="button" className={className} disabled={busy || missing.length > 0} onClick={onClick}>{missing.length > 0 && <Lock className="w-3.5 h-3.5" />}{children}</button>
    {missing.length > 0 && <span className="text-[11px] text-slate-500 max-w-md">Locked until: {missing.slice(0, 3).join('; ')}{missing.length > 3 ? ` and ${missing.length - 3} more` : ''}.</span>}
  </div>
);

export const score = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n.toFixed(2));
export const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
