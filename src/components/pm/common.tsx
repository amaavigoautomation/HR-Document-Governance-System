import React, { useState } from 'react';
import { Info, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { Notice, btnGhost, btnPrimary, input, Field } from '../leave/ui';
import { Pill } from '../common/loadUi';

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

export const RATING_WORDS: Record<number, string> = { 1: 'Needs improvement', 2: 'Below expectations', 3: 'Meets expectations', 4: 'Exceeds expectations', 5: 'Outstanding' };

/** 1 to 5 as big buttons with words, plus "Not observed" where it applies. Nothing is chosen until the person chooses. */
export const RatingPick: React.FC<{ value: number | string | null | undefined; onChange: (v: number | 'NOT_OBSERVED' | null) => void; allowNotObserved?: boolean; disabled?: boolean; label?: string }> = ({ value, onChange, allowNotObserved, disabled, label }) => (
  <div role="radiogroup" aria-label={label || 'Rating'} className="flex flex-wrap gap-1.5">
    {[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" role="radio" aria-checked={value === n} disabled={disabled} onClick={() => onChange(value === n ? null : n)}
        className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold text-left leading-tight transition-colors disabled:opacity-60 ${value === n ? 'bg-[#FA7014] border-[#FA7014] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
        <span className="text-sm">{n}</span><span className="block text-[10px] font-medium opacity-90">{RATING_WORDS[n]}</span>
      </button>
    ))}
    {allowNotObserved && (
      <button type="button" role="radio" aria-checked={value === 'NOT_OBSERVED'} disabled={disabled} onClick={() => onChange(value === 'NOT_OBSERVED' ? null : 'NOT_OBSERVED')}
        className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold leading-tight disabled:opacity-60 ${value === 'NOT_OBSERVED' ? 'bg-slate-700 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
        Not observed<span className="block text-[10px] font-medium opacity-90">Not scored, not zero</span>
      </button>
    )}
  </div>
);

/** A row of numbered steps showing where something is. */
export const Steps: React.FC<{ steps: { key: string; label: string }[]; current: number }> = ({ steps, current }) => (
  <ol className="flex flex-wrap gap-1.5 mb-4" aria-label="Progress">
    {steps.map((s, i) => (
      <li key={s.key} className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border ${i < current ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : i === current ? 'bg-[#FA7014] border-[#FA7014] text-white' : 'bg-white border-slate-200 text-slate-400'}`}>
        {i < current ? <Check className="w-3 h-3" /> : <span>{i + 1}</span>}{s.label}
      </li>
    ))}
  </ol>
);

export const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  OPEN: 'blue', SELF_ASSESSED: 'blue', MANAGER_EVALUATED: 'blue', DISCUSSED: 'blue', HR_REVIEWED: 'amber', APPROVED: 'green', PUBLISHED: 'green', ACKNOWLEDGED: 'green', DISPUTED: 'red', DEFERRED: 'slate', CONFIGURATION_PENDING: 'amber',
  GENERATED: 'blue', CUSTOMISED: 'blue', VALIDATED: 'amber', ACTIVE: 'green', SUPERSEDED: 'slate', DRAFT: 'slate', RETIRED: 'slate', DUE: 'amber', DONE: 'green', PROPOSED: 'amber', COMPLETED: 'green', CANCELLED: 'slate',
};
export const STATUS_WORDS: Record<string, string> = {
  OPEN: 'Waiting for self-assessment', SELF_ASSESSED: 'Waiting for manager', MANAGER_EVALUATED: 'Waiting for feedback discussion', DISCUSSED: 'Waiting for HR check', HR_REVIEWED: 'Waiting for approval', APPROVED: 'Approved, not yet shared',
  PUBLISHED: 'Shared with employee', ACKNOWLEDGED: 'Done', DISPUTED: 'Employee disagrees', DEFERRED: 'Paused', CONFIGURATION_PENDING: 'Waiting for setup', GENERATED: 'Manager to set targets', CUSTOMISED: 'Waiting for HR', VALIDATED: 'Waiting for approval',
  ACTIVE: 'Active', SUPERSEDED: 'Replaced by a newer version', DRAFT: 'Draft', RETIRED: 'Retired', DUE: 'To do', DONE: 'Done', PROPOSED: 'Waiting for HR approval', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
export const StatusChip: React.FC<{ status: string }> = ({ status }) => <Pill tone={STATUS_TONE[status] || 'slate'}>{STATUS_WORDS[status] || status.replace(/_/g, ' ').toLowerCase()}</Pill>;

/** Text box + save, used for short notes. */
export const Note: React.FC<{ label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string; disabled?: boolean }> = ({ label, value, onChange, rows = 3, hint, disabled }) => (
  <Field label={label} hint={hint}><textarea className={input} rows={rows} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></Field>
);

/** Shows server messages in plain words, and the list of "fix these first" problems when there are some. */
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

export const money = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? 'Not scored' : n.toFixed(d));
