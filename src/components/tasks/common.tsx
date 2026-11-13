import React, { createContext, useContext } from 'react';
import { AlertCircle, CheckCircle2, CircleDashed, Eye, Loader2, RotateCcw, Paperclip, ListChecks, CalendarDays } from 'lucide-react';
import { STATUS_LABEL, isOverdue, progressOf } from '../../../shared/taskEngine';
import { relDay, shortDate, todayIst } from '../leave/ui';

export interface Att { id: string; name: string; bytes: number; type: string; at: string; byName: string; resourceType: string }
export interface Task {
  id: string; title: string; description: string; status: string; priority: string;
  assigneeUid: string; assigneeName: string; creatorUid: string; creatorName: string; reviewerUid: string; reviewerName: string; requiresReview: boolean;
  projectId: string; projectName: string; startDate: string; dueDate: string; tags: string[]; checklist: { id: string; text: string; done: boolean }[];
  attachments: Att[]; watchers: string[]; kpi: { planId: string; kpiId: string; kpiName: string } | null; order: number; completedAt: string; evidenceStatus: string; mine: boolean;
}
export interface Person { uid: string; name: string; department: string; title: string }
export interface Meta {
  me: { uid: string; name: string; department: string };
  flags: { manager: boolean; canManage: boolean; canViewAll: boolean; headOf: string[]; companyWide: boolean };
  people: Person[]; assignable: string[]; departments: string[];
  projects: { id: string; name: string; scope: string; department: string; color: string }[];
  counts: { open: number; overdue: number; review: number };
  storage: { enabled: boolean; maxMb: number; allowed: string[] };
  statuses: { key: string; label: string; type: string }[]; priorities: { key: string; label: string; rank: number }[];
}

/** What every Tasks screen shares: who is signed in, the lists to pick from, and how to open or create a task. */
export interface TasksCtx {
  meta: Meta;
  /** bumps whenever anything changes, so lists reload */
  version: number;
  changed: () => void;
  openTask: (id: string) => void;
  newTask: (defaults?: Partial<Task>) => void;
}
export const TasksContext = createContext<TasksCtx | null>(null);
export const useTasks = () => useContext(TasksContext)!;

// ------------------------------------------------------------------ small pieces

export const STATUS_LOOK: Record<string, { cls: string; dot: string; icon: React.FC<{ className?: string }> }> = {
  TODO: { cls: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400', icon: CircleDashed },
  IN_PROGRESS: { cls: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500', icon: Loader2 },
  IN_REVIEW: { cls: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500', icon: Eye },
  REWORK: { cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500', icon: RotateCcw },
  DONE: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2 },
};
export const StatusChip: React.FC<{ status: string }> = ({ status }) => {
  const l = STATUS_LOOK[status] || STATUS_LOOK.TODO; const Icon = l.icon;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border whitespace-nowrap ${l.cls}`}><Icon className="w-3 h-3" />{STATUS_LABEL[status] || status}</span>;
};

const PRI: Record<string, string> = { URGENT: 'text-rose-600', HIGH: 'text-orange-500', NORMAL: 'text-slate-400', LOW: 'text-sky-400' };
export const PriorityFlag: React.FC<{ priority: string; label?: boolean }> = ({ priority, label }) => (
  <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${PRI[priority] || PRI.NORMAL}`} title={`${priority.charAt(0)}${priority.slice(1).toLowerCase()} priority`}>
    <AlertCircle className="w-3.5 h-3.5" />{label && priority.charAt(0) + priority.slice(1).toLowerCase()}
  </span>
);

export const initials = (name: string) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
const HUES = ['bg-violet-100 text-violet-700', 'bg-sky-100 text-sky-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700'];
export const Avatar: React.FC<{ name: string; size?: number }> = ({ name, size = 24 }) => {
  const hue = HUES[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
  return <span title={name} style={{ width: size, height: size, fontSize: size * 0.42 }} className={`inline-flex items-center justify-center rounded-full font-bold shrink-0 ${hue}`}>{initials(name)}</span>;
};

/** "Overdue · 2 days ago" in red, "today" in amber, otherwise the short date. */
export const DueLabel: React.FC<{ task: Pick<Task, 'dueDate' | 'status'> }> = ({ task }) => {
  if (!task.dueDate) return <span className="text-[11px] text-slate-400">No due date</span>;
  const late = isOverdue(task, todayIst()); const today = task.dueDate === todayIst() && task.status !== 'DONE';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${late ? 'text-rose-600' : today ? 'text-amber-600' : 'text-slate-500'}`}>
      <CalendarDays className="w-3.5 h-3.5" />{late ? `Overdue · ${relDay(task.dueDate)}` : today ? 'Today' : shortDate(task.dueDate)}
    </span>
  );
};

export const TaskMeta: React.FC<{ task: Task }> = ({ task }) => {
  const p = progressOf(task);
  return (
    <>
      {p.total > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><ListChecks className="w-3.5 h-3.5" />{p.done}/{p.total}</span>}
      {task.attachments.length > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Paperclip className="w-3.5 h-3.5" />{task.attachments.length}</span>}
    </>
  );
};

export const fileSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const when = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`; };

/** A wide side panel (bottom sheet on phones). Closes on Escape and on a click outside. */
export const Sheet: React.FC<{ onClose: () => void; title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }> = ({ onClose, title, right, children, footer, wide }) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={`absolute inset-x-0 bottom-0 max-h-[94vh] rounded-t-2xl sm:rounded-none sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none ${wide ? 'sm:w-[46rem]' : 'sm:w-[32rem]'} bg-white shadow-2xl flex flex-col`}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200">
          <div className="min-w-0 text-base font-bold text-slate-900 truncate">{title}</div>
          <div className="flex items-center gap-2 shrink-0">{right}<button className="p-1.5 -m-1.5 rounded-lg hover:bg-slate-100 text-slate-500 text-lg leading-none" aria-label="Close" onClick={onClose}>✕</button></div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-slate-200 px-5 py-3 bg-slate-50">{footer}</div>}
      </div>
    </div>
  );
};
