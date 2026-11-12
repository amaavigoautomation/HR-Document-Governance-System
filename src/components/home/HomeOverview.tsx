import React from 'react';
import { ArrowRight, CalendarCheck, FileCheck2, FileText, Briefcase, ListChecks, Users } from 'lucide-react';
import type { DashboardWidget, WidgetTarget } from '../../../shared/dashboard';
import { Card } from '../leave/ui';

/** Welcome banner: greeting, one line about the product, and a simple building illustration drawn here (no image file). */
export const WelcomeBanner: React.FC<{ first: string }> = ({ first }) => (
  <section className="relative overflow-hidden rounded-2xl border border-orange-100 bg-gradient-to-r from-orange-50 via-orange-50 to-orange-100/60 px-6 py-6 sm:px-8">
    <div className="relative z-10 max-w-xl">
      <p className="text-base font-medium text-slate-700">{first ? `Good morning, ${first}` : 'Welcome back'} <span aria-hidden>👋</span></p>
      <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">Welcome to Amaavigo HR</h1>
      <p className="mt-2 text-sm text-slate-600">Manage your people, hiring, attendance and performance &mdash; all in one place.</p>
    </div>
    <svg className="hidden md:block absolute right-0 bottom-0 h-full w-[420px]" viewBox="0 0 420 150" preserveAspectRatio="xMaxYMax meet" aria-hidden>
      <path d="M0 150 C 60 90 140 120 210 100 C 290 78 340 110 420 70 L420 150 Z" fill="#FDD9BF" opacity=".7" />
      <g fill="#FA7014">
        <rect x="250" y="58" width="62" height="92" rx="3" opacity=".9" />
        <rect x="318" y="30" width="58" height="120" rx="3" />
        <rect x="214" y="96" width="40" height="54" rx="3" opacity=".65" />
      </g>
      <g fill="#FFE8D6">
        {[0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((c) => <rect key={`a${r}${c}`} x={328 + c * 17} y={40 + r * 20} width="9" height="11" rx="1.5" />))}
        {[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => <rect key={`b${r}${c}`} x={258 + c * 17} y={68 + r * 20} width="9" height="11" rx="1.5" />))}
      </g>
      <g fill="#F9A66C">
        <ellipse cx="392" cy="112" rx="9" ry="22" transform="rotate(-25 392 112)" />
        <ellipse cx="404" cy="100" rx="8" ry="20" transform="rotate(15 404 100)" />
        <ellipse cx="380" cy="126" rx="7" ry="16" transform="rotate(-50 380 126)" />
      </g>
    </svg>
  </section>
);

const DONUT = ['#8B5CF6', '#3B82F6', '#FACC15', '#22C55E', '#9CA3AF', '#F97316'];

/** Requisitions waiting on this person, by step. Real counts from the Hiring widget. */
export const HiringDonut: React.FC<{ widget: DashboardWidget; onOpen: (t: WidgetTarget) => void }> = ({ widget, onOpen }) => {
  const waiting: { label: string; count: number }[] = ((widget.data as any)?.waiting || []).filter((w: any) => w.count > 0);
  const total = waiting.reduce((n, w) => n + w.count, 0);
  const R = 52; const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <Card title="Hiring" right={widget.target ? <button type="button" onClick={() => onOpen(widget.target!)} className="text-xs font-bold text-[#FA7014] inline-flex items-center gap-1 hover:underline">View <ArrowRight className="w-3 h-3" /></button> : undefined}>
      <div className="flex items-center gap-6">
        <div className="relative w-36 h-36 shrink-0">
          <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90" role="img" aria-label={`${total} requisitions waiting on you`}>
            <circle cx="70" cy="70" r={R} fill="none" stroke="#F1F5F9" strokeWidth="16" />
            {total > 0 && waiting.map((w, i) => {
              const len = (w.count / total) * C;
              const el = <circle key={w.label} cx="70" cy="70" r={R} fill="none" stroke={DONUT[i % DONUT.length]} strokeWidth="16" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />;
              offset += len;
              return el;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black tabular-nums text-slate-900">{total}</span>
            <span className="text-[11px] font-medium text-slate-500">waiting on you</span>
          </div>
        </div>
        <ul className="flex-1 min-w-0 text-sm">
          {waiting.length === 0 && <li className="text-slate-500">Nothing is waiting on you.</li>}
          {waiting.map((w, i) => (
            <li key={w.label} className="flex items-center gap-2 py-1.5 border-b last:border-0 border-slate-100">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT[i % DONUT.length] }} />
              <span className="flex-1 truncate text-slate-700">{w.label}</span>
              <b className="tabular-nums text-slate-900">{w.count}</b>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
};

interface TaskRow { key: string; text: string; count: number; target?: WidgetTarget; Icon: React.FC<{ className?: string }> }

/** One row per thing waiting on this person, built from the dashboard widgets (counts are real). */
const TAGS: Record<string, [string, string]> = {
  ap: ['Leave', 'bg-amber-100 text-amber-800'], rq: ['Documents', 'bg-violet-100 text-violet-700'], mr: ['Documents', 'bg-violet-100 text-violet-700'],
  rr: ['Documents', 'bg-violet-100 text-violet-700'], ak: ['Policies', 'bg-violet-100 text-violet-700'], mt: ['General', 'bg-slate-100 text-slate-700'],
  pt: ['People', 'bg-emerald-100 text-emerald-700'],
};
const tagFor = (key: string): [string, string] => TAGS[key] || (key.startsWith('h-') ? ['Hiring', 'bg-sky-100 text-sky-700'] : ['General', 'bg-slate-100 text-slate-700']);

/** Everything waiting on this person, one row per kind of work. Shared by the My Tasks card and the "Waiting on you" tile so their numbers always agree. */
export const taskRows = (widgets: DashboardWidget[]): TaskRow[] => {
  const rows: TaskRow[] = [];
  const d = (id: string) => widgets.find((w) => w.id === id);
  const num = (n: any) => (typeof n === 'number' ? n : 0);
  const a = d('approvals'); if (a && num((a.data as any).leave) > 0) rows.push({ key: 'ap', count: num((a.data as any).leave), text: `Review leave requests (${(a.data as any).leave})`, target: a.target, Icon: CalendarCheck });
  const rq = d('review-queue'); if (rq && num((rq.data as any).count) > 0) rows.push({ key: 'rq', count: num((rq.data as any).count), text: `Review documents (${(rq.data as any).count})`, target: rq.target, Icon: FileText });
  const mr = d('my-revisions'); if (mr && num((mr.data as any).count) > 0) rows.push({ key: 'mr', count: num((mr.data as any).count), text: `Fix documents sent back (${(mr.data as any).count})`, target: mr.target, Icon: FileText });
  const rr = d('rereview-due'); if (rr && num((rr.data as any).count) > 0) rows.push({ key: 'rr', count: num((rr.data as any).count), text: `Documents due for re-review (${(rr.data as any).count})`, target: rr.target, Icon: FileText });
  const ak = d('acknowledgements'); if (ak && num((ak.data as any).count) > 0) rows.push({ key: 'ak', count: num((ak.data as any).count), text: `Acknowledge policies (${(ak.data as any).count})`, target: ak.target, Icon: FileCheck2 });
  const mt = d('my-tasks'); if (mt && num((mt.data as any).openTasks) > 0) rows.push({ key: 'mt', count: num((mt.data as any).openTasks), text: `Finish your tasks (${(mt.data as any).openTasks})`, target: mt.target, Icon: ListChecks });
  const h = d('hiring'); if (h) for (const w of ((h.data as any).waiting || []) as { label: string; count: number }[]) rows.push({ key: `h-${w.label}`, count: num(w.count), text: `${w.label} (${w.count})`, target: h.target, Icon: Briefcase });
  const pt = d('people-tasks'); if (pt && num((pt.data as any).open) > 0) rows.push({ key: 'pt', count: num((pt.data as any).open), text: `Onboarding and exit tasks (${(pt.data as any).open})`, target: pt.target, Icon: Users });
  return rows;
};

export const MyTasks: React.FC<{ widgets: DashboardWidget[]; onOpen: (t: WidgetTarget) => void }> = ({ widgets, onOpen }) => {
  const rows = taskRows(widgets);
  return (
    <div id="home-my-tasks"><Card className="min-w-0" title={`My Tasks${rows.length ? ` (${rows.length})` : ''}`}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">You are all caught up. Nothing needs you right now.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" disabled={!r.target} onClick={() => r.target && onOpen(r.target)} className="w-full flex items-center gap-3 py-1.5 text-left rounded-lg hover:bg-orange-50/60 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default px-1">
                <span className="w-7 h-7 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><r.Icon className="w-4 h-4" /></span>
                <span className="flex-1 min-w-0 truncate text-xs font-medium text-slate-800">{r.text}</span>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${tagFor(r.key)[1]}`}>{tagFor(r.key)[0]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card></div>
  );
};
