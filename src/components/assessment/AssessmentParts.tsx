import React from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, AlertTriangle } from 'lucide-react';
import type { AssessmentResult, Comparison, SkillLevel } from '../../../shared/assessment';
import { MIN_RELIABLE_QUESTIONS } from '../../../shared/assessment';

export const levelStyle: Record<SkillLevel, string> = {
  Beginner: 'bg-rose-50 text-rose-700 border-rose-200',
  Intermediate: 'bg-amber-50 text-amber-700 border-amber-200',
  Advanced: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export const barColor = (percent: number) => (percent >= 75 ? 'bg-emerald-500' : percent >= 40 ? 'bg-amber-500' : 'bg-rose-500');

export const fmtPercent = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}%`);

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const KIND_LABEL: Record<string, string> = { PRE_HIRE: 'Onboarding test', RETEST: 'Retest', GENERAL: 'Skill test' };

export const STATUS_LABEL: Record<string, string> = {
  SENT: 'Sent, not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const statusBadge = (status: string) => {
  if (status === 'COMPLETED') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (status === 'IN_PROGRESS') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
};

/** Overall score plus one bar per skill. */
export const ScoreBars: React.FC<{ result: AssessmentResult }> = ({ result }) => (
  <div className="space-y-3">
    <div className="flex items-end justify-between">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Overall</div>
        <div className="text-3xl font-black text-slate-900 leading-none mt-1">{fmtPercent(result.overall.percent)}</div>
      </div>
      <div className="text-[11px] text-slate-500 text-right">
        {result.overall.correct} of {result.total} correct
        <br />
        {result.answered} answered
      </div>
    </div>
    <div className="space-y-2.5">
      {result.skills.map((s) => (
        <div key={s.skillKey}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-bold text-slate-900">{s.skill}</span>
            <span className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500">
                {s.correct}/{s.total} correct{s.total < MIN_RELIABLE_QUESTIONS ? ' · few questions, treat as a rough guide' : ''}
              </span>
              <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${levelStyle[s.level]}`}>{s.level}</span>
              <span className="font-black text-slate-900 w-12 text-right">{fmtPercent(s.percent)}</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full ${barColor(s.percent)} transition-all`} style={{ width: `${Math.max(2, s.percent)}%` }} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const Delta: React.FC<{ points: number | null }> = ({ points }) => {
  if (points === null) return <span className="text-slate-400">—</span>;
  if (points === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-slate-500 font-bold">
        <ArrowRight className="w-3 h-3" /> no change
      </span>
    );
  }
  const up = points > 0;
  return (
    <span className={`inline-flex items-center gap-1 font-black ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {up ? '+' : ''}
      {points.toFixed(1).replace(/\.0$/, '')} pts
    </span>
  );
};

/** Before / after table with the change in percentage points and as a relative increase. */
export const ComparisonTable: React.FC<{ comparison: Comparison; beforeLabel?: string; afterLabel?: string }> = ({ comparison, beforeLabel = 'Before', afterLabel = 'Now' }) => {
  const rows = [...comparison.skills, comparison.overall];
  const warn = rows.filter((r) => r.note);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
              <th className="px-3 py-2">Skill</th>
              <th className="px-3 py-2">{beforeLabel}</th>
              <th className="px-3 py-2">{afterLabel}</th>
              <th className="px-3 py-2">Change</th>
              <th className="px-3 py-2">Growth</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.skillKey} className={r.skillKey === 'overall' ? 'bg-slate-50 font-bold' : ''}>
                <td className="px-3 py-2 font-bold text-slate-900">
                  {r.skill}
                  {r.note && r.skillKey !== 'overall' && <AlertTriangle className="inline w-3 h-3 ml-1 text-amber-500" aria-label={r.note} />}
                </td>
                <td className="px-3 py-2">{fmtPercent(r.before)}</td>
                <td className="px-3 py-2">{fmtPercent(r.after)}</td>
                <td className="px-3 py-2">
                  <Delta points={r.deltaPoints} />
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {r.relativePercent === null ? '—' : `${r.relativePercent > 0 ? '+' : ''}${r.relativePercent.toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {warn.length > 0 && (
        <ul className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
          {warn.map((r) => (
            <li key={r.skillKey}>
              <b>{r.skill}:</b> {r.note}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-slate-400">Change is in percentage points. Growth is the change relative to the first score.</p>
    </div>
  );
};
