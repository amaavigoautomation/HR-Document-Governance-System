import React from 'react';
import { Check, Eye, Target } from 'lucide-react';
import { Avatar, DueLabel, PriorityFlag, StatusChip, TaskMeta, useTasks, type Task } from './common';

/** What the round button on a row does for this person, if anything. */
export function quickMove(t: Task, me: string): { to: string; label: string } | null {
  if (t.status === 'DONE') return null;
  if (!t.requiresReview) return t.assigneeUid === me || t.creatorUid === me ? { to: 'DONE', label: 'Mark done' } : null;
  if (t.status === 'IN_REVIEW') return t.reviewerUid === me ? { to: 'DONE', label: 'Approve and finish' } : null;
  return t.assigneeUid === me ? { to: 'IN_REVIEW', label: 'Send for review' } : null;
}

export const TaskRow: React.FC<{ task: Task; onQuick?: (t: Task, to: string) => void; showPerson?: boolean }> = ({ task: t, onQuick, showPerson }) => {
  const { meta, openTask } = useTasks();
  const q = onQuick ? quickMove(t, meta.me.uid) : null;
  const done = t.status === 'DONE';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 group">
      {q ? (
        <button type="button" aria-label={q.label} title={q.label} onClick={() => onQuick!(t, q.to)}
          className="w-5 h-5 rounded-full border-2 border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 flex items-center justify-center shrink-0 text-transparent hover:text-emerald-600">
          {q.to === 'IN_REVIEW' ? <Eye className="w-3 h-3" /> : <Check className="w-3 h-3 stroke-[3]" />}
        </button>
      ) : <span className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200'}`}>{done && <Check className="w-3 h-3 stroke-[3]" />}</span>}
      <button type="button" onClick={() => openTask(t.id)} className="flex-1 min-w-0 text-left">
        <span className={`block text-sm font-semibold truncate ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{t.title}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
          <DueLabel task={t} /><TaskMeta task={t} />
          {t.projectName && <span className="text-[11px] text-slate-400">{t.projectName}</span>}
          {t.kpi && <span className="inline-flex items-center gap-1 text-[11px] text-violet-600"><Target className="w-3 h-3" />KPI</span>}
          {showPerson && <span className="text-[11px] text-slate-500">{t.mine ? 'You' : t.assigneeName}</span>}
        </span>
      </button>
      <span className="hidden sm:flex items-center gap-2.5 shrink-0"><PriorityFlag priority={t.priority} />{t.status !== 'TODO' && <StatusChip status={t.status} />}{!t.mine && <Avatar name={t.assigneeName} />}</span>
    </div>
  );
};
