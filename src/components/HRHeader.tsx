import React from 'react';
import {
  FileText,
  Users,
  MessageSquare,
  History,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
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

export const HRHeader: React.FC<HRHeaderProps> = ({
  currentUser,
  onLogout,
  activeTab,
  setActiveTab,
  pendingComplianceCount = 0,
  suggestionsCount = 0,
  isSidebarOpen,
  onToggleSidebar,
}) => {
  const displayId = currentUser.empId || currentUser.loginId || currentUser.id || '';

  return (
    <header
      id="hr-header"
      className="bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-900 sticky top-0 z-40 shadow-xs"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & HR Studio Branding */}
          <div className="flex items-center space-x-3 shrink-0">
            {onToggleSidebar && (
              <button
                id="btn-hr-toggle-sidebar"
                type="button"
                onClick={onToggleSidebar}
                className="hidden lg:flex p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer mr-1"
                title={isSidebarOpen ? "Close side panel" : "Open HR AI Agent side panel"}
                aria-label={isSidebarOpen ? "Close side panel" : "Open HR AI Agent side panel"}
              >
                {isSidebarOpen ? (
                  <PanelLeftClose className="w-5 h-5" />
                ) : (
                  <PanelLeftOpen className="w-5 h-5 text-[#FA7014]" />
                )}
              </button>
            )}
            <div className="flex items-center shrink-0">
              <AmaavigoLogo size="md" variant="full" theme="light" height={48} className="shrink-0" />
            </div>
            <div className="hidden sm:flex items-center pl-3 border-l border-slate-200 space-x-2 shrink-0">
              <span className="font-bold text-sm tracking-tight text-slate-900 flex items-center gap-1.5">
                <span className="text-slate-800">DocGov</span>
                <span className="bg-[#FA7014]/10 text-[#FA7014] text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold border border-[#FA7014]/30">
                  HR Studio
                </span>
              </span>
            </div>
          </div>

          {/* HR-Specific Navigation Links */}
          <nav
            id="hr-navigation-bar"
            className="hidden md:flex items-center space-x-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200"
          >
            {/* Creator Studio Tab */}
            <button
              id="hr-nav-creator"
              type="button"
              onClick={() => setActiveTab('creator')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
                activeTab === 'creator'
                  ? 'bg-[#FA7014] text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Creator Studio</span>
            </button>

            {/* Compliance Tracker Tab */}
            <button
              id="hr-nav-compliance"
              type="button"
              onClick={() => setActiveTab('compliance')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
                activeTab === 'compliance'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Compliance Tracker</span>
            </button>

            {/* Policy Suggestions Tab (Beside Compliance Tracker) */}
            <button
              id="hr-nav-suggestions"
              type="button"
              onClick={() => setActiveTab('suggestions')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
                activeTab === 'suggestions'
                  ? 'bg-[#FA7014] text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Policy Suggestions</span>
              {suggestionsCount > 0 && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold transition-colors ${
                    activeTab === 'suggestions'
                      ? 'bg-white/25 text-white'
                      : 'bg-orange-100 text-[#FA7014]'
                  }`}
                >
                  {suggestionsCount}
                </span>
              )}
            </button>

            {/* Audit Trail Tab */}
            <button
              id="hr-nav-audit"
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
                activeTab === 'audit'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Audit Trail</span>
            </button>
          </nav>

          {/* Right actions: HR Profile & Logout */}
          <div className="flex items-center space-x-2.5">
            {/* HR Profile Details */}
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
              <div className="hidden sm:block text-left">
                <div className="flex items-center space-x-1.5">
                  <div className="text-xs font-bold text-slate-900 leading-tight">
                    {currentUser.name || 'HR Author'}
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-50 text-[#FA7014] font-semibold border border-orange-200">
                    {displayId}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 flex items-center space-x-1.5 mt-0.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#FA7014]" />
                  <span className="truncate max-w-[150px] font-medium" title={currentUser.title || 'HR Policy Lead'}>
                    {currentUser.title || 'HR Policy & Governance Lead'}
                  </span>
                </div>
              </div>

              {/* Logout Button */}
              <button
                id="btn-hr-logout"
                type="button"
                onClick={onLogout}
                className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors"
                title="Logout from HR Studio"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
