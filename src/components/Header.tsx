import React from 'react';
import {
  FileText,
  ShieldCheck,
  Bell,
  RotateCcw,
  UserCheck,
  BookOpen,
  History,
  Layers,
  Sparkles,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import { User, UserRole } from '../types';

interface HeaderProps {
  currentUser: User | null;
  onSwitchUser: (user: User) => void;
  allUsers: User[];
  onLogout: () => void;
  activeTab: 'creator' | 'reviewer' | 'employee' | 'audit' | 'notifications';
  setActiveTab: (tab: 'creator' | 'reviewer' | 'employee' | 'audit' | 'notifications') => void;
  notificationCount: number;
  onOpenNotifications: () => void;
  onResetSeed: () => void;
  onOpenDemoTour: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onSwitchUser,
  allUsers,
  onLogout,
  activeTab,
  setActiveTab,
  notificationCount,
  onOpenNotifications,
  onResetSeed,
  onOpenDemoTour,
}) => {
  const creatorUser = allUsers.find((u) => u.role === UserRole.CREATOR);
  const reviewerUser = allUsers.find((u) => u.role === UserRole.REVIEWER);
  const employeeUser = allUsers.find((u) => u.role === UserRole.EMPLOYEE);

  return (
    <header id="main-header" className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800/80 text-white sticky top-0 z-40 shadow-lg shadow-black/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branding */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md shadow-blue-500/20 border border-blue-400/30">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-white">
                  Amaavigo <span className="text-blue-400">DocGov</span>
                </span>
                <span className="bg-blue-500/15 text-blue-300 text-[11px] px-2 py-0.5 rounded-full font-mono border border-blue-500/30">
                  v2.4 Enterprise
                </span>
              </div>
              <p className="text-xs text-slate-400">HR Document Governance & Version Control System</p>
            </div>
          </div>

          {/* Navigation Links based on role */}
          {currentUser && (
            <nav className="hidden md:flex items-center space-x-1.5 bg-slate-950/60 p-1 rounded-xl border border-slate-800/80">
              {currentUser.role === UserRole.CREATOR && (
                <button
                  id="nav-creator-dashboard"
                  onClick={() => setActiveTab('creator')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                    activeTab === 'creator'
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Creator Studio</span>
                </button>
              )}

              {currentUser.role === UserRole.REVIEWER && (
                <button
                  id="nav-reviewer-dashboard"
                  onClick={() => setActiveTab('reviewer')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                    activeTab === 'reviewer'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                      : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Review Queue</span>
                </button>
              )}

              <button
                id="nav-employee-portal"
                onClick={() => setActiveTab('employee')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                  activeTab === 'employee'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Employee Portal</span>
              </button>

              <button
                id="nav-audit-trail"
                onClick={() => setActiveTab('audit')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5 ${
                  activeTab === 'audit'
                    ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Audit Trail</span>
              </button>
            </nav>
          )}

          {/* Right actions: Quick switcher, Notifications, Reset, Demo Guide */}
          <div className="flex items-center space-x-2.5">
            {/* Demo Tour Button */}
            <button
              id="btn-demo-tour"
              onClick={onOpenDemoTour}
              className="hidden lg:flex items-center space-x-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs"
              title="Interactive End-to-End Workflow Guide"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Workflow Demo Guide</span>
            </button>

            {/* Email Notifications Drawer Button */}
            <button
              id="btn-notification-drawer"
              onClick={onOpenNotifications}
              className="relative p-2 text-slate-300 hover:text-white hover:bg-slate-800/80 rounded-lg transition-colors border border-transparent hover:border-slate-700"
              title="Broadcasted Email Notifications"
            >
              <Bell className="w-4.5 h-4.5" />
              {notificationCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                  {notificationCount > 9 ? '9+' : notificationCount}
                </span>
              )}
            </button>

            {/* Reset Database Button */}
            <button
              id="btn-reset-seed"
              onClick={onResetSeed}
              className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-lg transition-colors border border-transparent hover:border-slate-700"
              title="Reset System to Seed Baseline"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* User Quick Switcher Dropdown */}
            {currentUser && (
              <div className="flex items-center space-x-2 pl-2 border-l border-slate-800">
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <img
                      src={currentUser.avatar || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100'}
                      alt={currentUser.name}
                      className="w-8 h-8 rounded-full border border-slate-600 object-cover shadow-xs"
                    />
                    <span
                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                        currentUser.role === UserRole.REVIEWER
                          ? 'bg-emerald-500'
                          : currentUser.role === UserRole.CREATOR
                          ? 'bg-blue-500'
                          : 'bg-indigo-500'
                      }`}
                    />
                  </div>
                  <div className="hidden sm:block text-left">
                    <div className="text-xs font-bold text-white leading-tight">{currentUser.name}</div>
                    <div className="text-[10px] text-slate-400 flex items-center space-x-1">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          currentUser.role === UserRole.REVIEWER
                            ? 'bg-emerald-400'
                            : 'bg-blue-400'
                        }`}
                      />
                      <span>
                        {currentUser.role === UserRole.REVIEWER
                          ? 'Approver'
                          : 'HR (Creator)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick 3-Role Toggle Bar */}
                <div className="flex items-center bg-slate-950/70 p-1 rounded-xl border border-slate-800">
                  {creatorUser && (
                    <button
                      id="switch-to-creator"
                      onClick={() => {
                        onSwitchUser(creatorUser);
                        setActiveTab('creator');
                      }}
                      className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all ${
                        currentUser.id === creatorUser.id
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Switch to HR Creator (HR001)"
                    >
                      HR
                    </button>
                  )}
                  {reviewerUser && (
                    <button
                      id="switch-to-reviewer"
                      onClick={() => {
                        onSwitchUser(reviewerUser);
                        setActiveTab('reviewer');
                      }}
                      className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all ${
                        currentUser.id === reviewerUser.id
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Switch to Approver (AMA001)"
                    >
                      Approver
                    </button>
                  )}
                  {employeeUser && (
                    <button
                      id="switch-to-employee"
                      onClick={() => {
                        onSwitchUser(employeeUser);
                        setActiveTab('employee');
                      }}
                      className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all ${
                        currentUser.id === employeeUser.id
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Switch to Employee (AM001 - Parth)"
                    >
                      Employee (Parth)
                    </button>
                  )}
                </div>

                {/* Logout */}
                <button
                  id="btn-header-logout"
                  onClick={onLogout}
                  className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800/80 rounded-lg transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
