import React from 'react';
import {
  ShieldCheck,
  Users,
  History,
  Bell,
  LogOut,
} from 'lucide-react';
import { User } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';

interface ApproverHeaderProps {
  currentUser: User;
  onLogout: () => void;
  activeTab: 'reviewer' | 'compliance' | 'audit';
  setActiveTab: (tab: 'reviewer' | 'compliance' | 'audit') => void;
  notificationCount?: number;
  pendingComplianceCount?: number;
  onOpenNotifications?: () => void;
}

export const ApproverHeader: React.FC<ApproverHeaderProps> = ({
  currentUser,
  onLogout,
  activeTab,
  setActiveTab,
  notificationCount = 0,
  pendingComplianceCount = 0,
  onOpenNotifications,
}) => {
  const displayId = currentUser.empId || currentUser.loginId || currentUser.id || 'AMA001';

  return (
    <header
      id="approver-header"
      className="bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-900 sticky top-0 z-40 shadow-xs"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Approver Governance Branding */}
          <div className="flex items-center space-x-3.5 shrink-0">
            <div className="flex items-center shrink-0">
              <AmaavigoLogo size="md" variant="full" theme="light" height={48} className="shrink-0" />
            </div>
            <div className="hidden sm:flex items-center pl-3 border-l border-slate-200 space-x-2 shrink-0">
              <span className="font-bold text-sm tracking-tight text-slate-900 flex items-center gap-1.5">
                <span className="text-slate-800">DocGov</span>
                <span className="bg-emerald-50 text-emerald-700 text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold border border-emerald-300">
                  Approver Portal
                </span>
              </span>
            </div>
          </div>

          {/* Approver-Specific Navigation Links */}
          <nav
            id="approver-navigation-bar"
            className="hidden md:flex items-center space-x-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200"
          >
            {/* Review Queue Tab */}
            <button
              id="approver-nav-review"
              type="button"
              onClick={() => setActiveTab('reviewer')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
                activeTab === 'reviewer'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Review Queue</span>
            </button>

            {/* Compliance Tracker Tab */}
            <button
              id="approver-nav-compliance"
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
              {pendingComplianceCount > 0 && (
                <span className="ml-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full">
                  {pendingComplianceCount}
                </span>
              )}
            </button>

            {/* Audit Trail Tab */}
            <button
              id="approver-nav-audit"
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

          {/* Right actions: Notifications, Approver Profile & Logout */}
          <div className="flex items-center space-x-2.5">
            {/* Email Notifications Drawer Button */}
            {onOpenNotifications && (
              <button
                id="btn-approver-notifications"
                type="button"
                onClick={onOpenNotifications}
                className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                title="Broadcasted Email Notifications"
              >
                <Bell className="w-4.5 h-4.5" />
                {notificationCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-emerald-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </button>
            )}

            {/* Approver Profile Details */}
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
              <div className="hidden sm:block text-left">
                <div className="flex items-center space-x-1.5">
                  <div className="text-xs font-bold text-slate-900 leading-tight">
                    {currentUser.name || 'Approver Executive'}
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-300">
                    {displayId}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 flex items-center space-x-1.5 mt-0.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="truncate max-w-[150px] font-medium" title={currentUser.title || 'Approver'}>
                    {currentUser.title || 'VP of Human Resources & Governance'}
                  </span>
                </div>
              </div>

              {/* Logout Button */}
              <button
                id="btn-approver-logout"
                type="button"
                onClick={onLogout}
                className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors"
                title="Logout from Approver Portal"
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
