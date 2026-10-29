import React, { useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { NavBadge } from './NavBadge';

/**
 * Section menus for modules (Payroll, People, ...).
 * The module page publishes which sections the signed-in person may open; the app sidebar shows them under the module card
 * (variant "sidebar") and screens without a sidebar show them as pills at the top of the page (variant "pills").
 * Both read and set the same selected section, so they always agree.
 */
export interface NavItem { key: string; label: string; badge?: number; group?: string }

export interface ModuleNav {
  getState: () => { section: string; items: NavItem[] };
  subscribe: (l: () => void) => () => void;
  setSection: (section: string) => void;
  publish: (items: NavItem[]) => void;
  useNav: () => { section: string; items: NavItem[] };
  /** The section to show: the chosen one if this person may see it, otherwise the first they may see. */
  resolve: (section: string, items: NavItem[]) => string;
  icons: Record<string, React.FC<{ className?: string }>>;
}

export function createModuleNav(storageKey: string, valid: string[], fallback: string, icons: Record<string, React.FC<{ className?: string }>>): ModuleNav {
  const read = (): string => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v && valid.includes(v)) return v;
    } catch { /* private mode */ }
    return fallback;
  };
  let state = { section: read(), items: [] as NavItem[] };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const getState = () => state;
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
  return {
    getState,
    subscribe,
    setSection(section) {
      if (state.section === section) return;
      state = { ...state, section };
      try { localStorage.setItem(storageKey, section); } catch { /* private mode */ }
      emit();
    },
    publish(items) {
      if (JSON.stringify(items) === JSON.stringify(state.items)) return;
      state = { ...state, items };
      emit();
    },
    useNav: () => useSyncExternalStore(subscribe, getState, getState),
    resolve: (section, items) => (items.some((i) => i.key === section) ? section : (items[0]?.key ?? fallback)),
    icons,
  };
}

/** Split items into their groups, keeping order. Group titles show only when there is more than one group. */
const groupItems = (items: NavItem[]) => {
  const groups: { title?: string; items: NavItem[] }[] = [];
  for (const it of items) {
    const last = groups[groups.length - 1];
    if (last && last.title === it.group) last.items.push(it); else groups.push({ title: it.group, items: [it] });
  }
  return groups;
};

export const ModuleSubNav: React.FC<{ nav: ModuleNav; label: string; variant: 'sidebar' | 'pills'; onNavigate?: () => void; idPrefix?: string; counts?: Record<string, number> }> = ({ nav, label, variant, onNavigate, idPrefix, counts }) => {
  const nav0 = nav.useNav();
  // Counts given by the app (kept fresh in the background) win over the numbers a screen published when it opened.
  const items = nav0.items.map((i) => ({ ...i, badge: counts?.[i.key] ?? i.badge }));
  const section = nav0.section;
  // Groups start closed and only open when the person clicks their header.
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const active = items.length ? nav.resolve(section, items) : '';
  if (items.length === 0) return null;
  const go = (k: string) => { nav.setSection(k); onNavigate?.(); };

  if (variant === 'pills') {
    return (
      <nav className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1" aria-label={label}>
        {items.map(({ key, label: text, badge }) => {
          const Icon = nav.icons[key];
          return (
            <button key={key} type="button" onClick={() => go(key)} aria-current={active === key ? 'page' : undefined}
              ref={active === key ? (el) => el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) : undefined}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-colors ${active === key ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'}`}>
              {Icon && <Icon className="w-4 h-4" />}{text}
              <NavBadge count={badge} className="ml-0.5" />
            </button>
          );
        })}
      </nav>
    );
  }

  const groups = groupItems(items);
  const titled = groups.length > 1;
  return (
    <div className="pl-4 pr-1 pt-1 space-y-1" role="navigation" aria-label={label}>
      {groups.map((g, gi) => {
        const isClosed = titled && !!g.title && !opened[g.title];
        const hasActive = g.items.some((i) => i.key === active);
        const hidden = g.items.reduce((n, i) => n + (i.badge || 0), 0);
        return (
          <div key={g.title || gi} className="space-y-1">
            {titled && g.title && (
              <button type="button" onClick={() => setOpened((o) => ({ ...o, [g.title!]: !o[g.title!] }))} aria-expanded={!isClosed}
                className={`w-full flex items-center justify-between px-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${isClosed && hasActive ? 'text-[#FA7014]' : 'text-slate-400 hover:text-slate-600'} hover:bg-slate-50 cursor-pointer py-1.5 ${gi > 0 ? 'mt-1' : ''}`}>
                <span>{g.title}</span>
                <span className="flex items-center gap-1.5">
                  {isClosed ? <NavBadge count={hidden} className="normal-case tracking-normal" /> : null}
                  {isClosed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
              </button>
            )}
            {!isClosed && g.items.map(({ key, label: text, badge }) => {
              const Icon = nav.icons[key];
              const on = active === key;
              return (
                <button key={key} id={idPrefix ? `${idPrefix}-${key}` : undefined} type="button" onClick={() => go(key)} aria-current={on ? 'page' : undefined}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${on ? 'bg-[#FA7014]/15 text-[#FA7014] font-bold shadow-2xs' : 'text-slate-700 hover:text-[#FA7014] hover:bg-orange-50'}`}>
                  <div className="flex items-center space-x-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${on ? 'bg-[#FA7014]' : 'bg-slate-300'}`} />
                    {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 transition-colors ${on ? 'text-[#FA7014]' : 'text-slate-400'}`} />}
                    <span className="truncate">{text}</span>
                  </div>
                  <NavBadge count={badge} />
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
