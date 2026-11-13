import React from 'react';
import { FileText, ShieldCheck, MessageSquareText, History, FileStack } from 'lucide-react';
import { User } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';

interface HRHeaderProps {
  currentUser: User;
  onLogout: () => void;
  activeTab: 'creator' | 'compliance' | 'suggestions' | 'audit';
  setActiveTab: (tab: 'creator' | 'compliance' | 'suggestions' | 'audit') => void;
  pendingComplianceCount?: number;
  suggestionsCount?: number;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

type Tab = HRHeaderProps['activeTab'];

/**
 * Sub-bar for Document Version Control: product mark on the left, the four sections as a pill switcher.
 * The account menu and log-out live in the top bar, so they are not repeated here.
 */
export const HRHeader: React.FC<HRHeaderProps> = ({ activeTab, setActiveTab, suggestionsCount = 0 }) => {
  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }[] = [
    { id: 'creator', label: 'Creator Studio', icon: FileText },
    { id: 'compliance', label: 'Compliance Tracker', icon: ShieldCheck },
    { id: 'suggestions', label: 'Policy Requests', icon: MessageSquareText, count: suggestionsCount },
    { id: 'audit', label: 'Audit Trail', icon: History },
  ];

  return (
    <header id="hr-header" className="bg-white border-b border-slate-200 sticky top-0 z-30">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-[72px]">
          <div className="flex items-center gap-3 shrink-0">
            <FileStack className="w-7 h-7 text-slate-700 hidden sm:block" strokeWidth={1.6} />
            <div className="leading-none">
              <AmaavigoLogo size="sm" variant="full" theme="light" height={30} showTagline={false} className="shrink-0" />
              <div className="text-xs text-slate-500 mt-0.5 hidden sm:block">HR Document Governance</div>
            </div>
          </div>

          <nav id="hr-navigation-bar" className="hidden md:flex items-center gap-1 bg-slate-50 border border-slate-100 p-1.5 rounded-2xl">
            {tabs.map((t) => {
              const on = activeTab === t.id;
              const I = t.icon;
              return (
                <button
                  key={t.id}
                  id={`hr-nav-${t.id}`}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    on ? 'bg-[#6d4cf0] text-white shadow-md shadow-violet-500/25' : 'text-slate-700 hover:bg-white hover:text-slate-900'
                  }`}
                >
                  <I className="w-4 h-4" />
                  <span>{t.label}</span>
                  {!!t.count && t.count > 0 && (
                    <span className={`text-[11px] min-w-[1.25rem] h-5 px-1.5 rounded-full font-bold flex items-center justify-center ${on ? 'bg-white/25 text-white' : 'bg-orange-100 text-orange-600'}`}>
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
};
