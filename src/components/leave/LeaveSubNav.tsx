import React from 'react';
import { Briefcase, CalendarCheck, ClipboardCheck, FilePenLine, CalendarDays, Home, Inbox, Palmtree } from 'lucide-react';
import { LeaveSection, resolveSection, useLeaveNav, leaveNav } from './leaveNav';

export const LEAVE_ICON: Record<LeaveSection, React.FC<{ className?: string }>> = {
  today: Home, my: Palmtree, attendance: CalendarCheck, regularization: ClipboardCheck, application: FilePenLine, team: CalendarDays, approvals: Inbox, manage: Briefcase,
};

/**
 * The leave sections as a menu.
 * variant "sidebar": indented list under "Leave & Attendance" in the app sidebar (matches the Talent Acquisition sub-menu).
 * variant "pills": horizontal pills at the top of the page, for screens that have no sidebar (employee portal).
 */
export const LeaveSubNav: React.FC<{ variant: 'sidebar' | 'pills'; onNavigate?: () => void }> = ({ variant, onNavigate }) => {
  const { section, items } = useLeaveNav();
  if (items.length === 0) return null;
  const active = resolveSection(section, items);
  const go = (k: LeaveSection) => { leaveNav.setSection(k); onNavigate?.(); };

  if (variant === 'pills') {
    return (
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1" aria-label="Leave and attendance">
        {items.map(({ key, label, badge }) => {
          const Icon = LEAVE_ICON[key];
          return (
            <button key={key} type="button" onClick={() => go(key)} aria-current={active === key ? 'page' : undefined}
              ref={active === key ? (el) => el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) : undefined}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-colors ${active === key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'}`}>
              <Icon className="w-4 h-4" />{label}
              {badge ? <span className="ml-0.5 bg-[#FA7014] text-white rounded-full px-1.5 py-0.5 text-[10px] leading-none">{badge}</span> : null}
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <div className="pl-4 pr-1 pt-1 space-y-1" role="navigation" aria-label="Leave and attendance sections">
      {items.map(({ key, label, badge }) => {
        const Icon = LEAVE_ICON[key];
        const on = active === key;
        return (
          <button key={key} id={`nav-submodule-leave-${key}`} type="button" onClick={() => go(key)} aria-current={on ? 'page' : undefined}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${on ? 'bg-[#FA7014]/15 text-[#FA7014] font-bold shadow-2xs' : 'text-slate-700 hover:text-[#FA7014] hover:bg-orange-50'}`}>
            <div className="flex items-center space-x-2 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${on ? 'bg-[#FA7014]' : 'bg-slate-300'}`} />
              <Icon className={`w-3.5 h-3.5 shrink-0 transition-colors ${on ? 'text-[#FA7014]' : 'text-slate-400'}`} />
              <span className="truncate">{label}</span>
            </div>
            {badge ? <span className="bg-[#FA7014] text-white rounded-full px-1.5 py-0.5 text-[10px] leading-none font-bold shrink-0">{badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
};
