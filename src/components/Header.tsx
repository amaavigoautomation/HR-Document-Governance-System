import React, { useState } from 'react';
import {
  FileText,
  ShieldCheck,
  Bell,
  RotateCcw,
  BookOpen,
  History,
  Sparkles,
  LogOut,
  Users,
  UserCog,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';
import { EditProfileModal } from './EditProfileModal';

interface HeaderProps {
  currentUser: User | null;
  onSwitchUser: (user: User) => void;
  allUsers: User[];
  onLogout: () => void;
  activeTab: 'creator' | 'reviewer' | 'employee' | 'compliance' | 'audit' | 'notifications';
  setActiveTab: (tab: 'creator' | 'reviewer' | 'employee' | 'compliance' | 'audit' | 'notifications') => void;
  notificationCount: number;
  pendingComplianceCount?: number;
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
  pendingComplianceCount = 0,
  onOpenNotifications,
  onResetSeed,
  onOpenDemoTour,
}) => {
  const creatorUser = allUsers.find((u) => u.role === UserRole.CREATOR);
  const reviewerUser = allUsers.find((u) => u.role === UserRole.REVIEWER);
  const employeeUser = allUsers.find((u) => u.role === UserRole.EMPLOYEE);

  const [showEditProfile, setShowEditProfile] = useState(false);

  return (
    <header id="main-header" className="bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-900 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branding */}
          <div className="flex items-center space-x-3.5 shrink-0">
            <div className="flex items-center shrink-0">
              <AmaavigoLogo size="md" variant="full" theme="light" height={48} className="shrink-0" />
            </div>
            <div className="hidden sm:flex items-center pl-3 border-l border-slate-200 space-x-2 shrink-0">
              <span className="font-bold text-sm tracking-tight text-slate-900 flex items-center gap-1.5">
                <span className="text-slate-800">DocGov</span>
                <span className="bg-[#FA7014]/10 text-[#FA7014] text-[10px] px-2 py-0.5 rounded-full font-mono font-bold border border-[#FA7014]/30">
                  Enterprise
                </span>
              </span>
            </div>
          </div>

          {/* Navigation Links based on role */}
          {currentUser && (
            <nav className="hidden md:flex items-center space-x-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200">
              {currentUser.role === UserRole.CREATOR && (
                <button
                  id="nav-creator-dashboard"
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
              )}

              {currentUser.role === UserRole.REVIEWER && (
                <button
                  id="nav-reviewer-dashboard"
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
              )}

              {/* Employee Acknowledgement & Compliance Tracker Module (For HR / Reviewers / Admin) */}
              {(currentUser.role === UserRole.CREATOR || currentUser.role === UserRole.REVIEWER) && (
                <button
                  id="nav-compliance-tracker"
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
                    <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-[#FA7014] text-white font-bold shadow-xs">
                      {pendingComplianceCount}
                    </span>
                  )}
                </button>
              )}

              {currentUser.role !== UserRole.CREATOR && currentUser.role !== UserRole.REVIEWER && (
                <button
                  id="nav-employee-portal"
                  onClick={() => setActiveTab('employee')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 ${
                    activeTab === 'employee'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-white hover:text-slate-900'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Employee Portal</span>
                </button>
              )}

              {currentUser.role !== UserRole.EMPLOYEE && (
                <button
                  id="nav-audit-trail"
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
              )}
            </nav>
          )}

          {/* Right actions: Quick switcher, Notifications, Reset, Demo Guide */}
          <div className="flex items-center space-x-2.5">
            {/* Demo Tour Button (Styled like "Connect Now" on amaavigo.com) */}
            <button
              id="btn-demo-tour"
              onClick={onOpenDemoTour}
              className="hidden lg:flex items-center space-x-1.5 bg-white border border-slate-900 hover:bg-slate-900 text-slate-900 hover:text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs"
              title="Interactive End-to-End Workflow Guide"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#FA7014]" />
              <span>Demo Guide</span>
            </button>

            {/* Email Notifications Drawer Button */}
            {currentUser && currentUser.role !== UserRole.CREATOR && currentUser.role !== UserRole.REVIEWER && currentUser.role !== UserRole.EMPLOYEE && (
              <button
                id="btn-notification-drawer"
                onClick={onOpenNotifications}
                className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                title="Broadcasted Email Notifications"
              >
                <Bell className="w-4.5 h-4.5" />
                {notificationCount > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-[#FA7014] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </span>
                )}
              </button>
            )}

            {/* Reset Database Button */}
            {currentUser && currentUser.role !== UserRole.CREATOR && currentUser.role !== UserRole.REVIEWER && currentUser.role !== UserRole.EMPLOYEE && (
              <button
                id="btn-reset-seed"
                onClick={onResetSeed}
                className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                title="Reset System to Seed Baseline"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}

            {/* User Quick Switcher Dropdown */}
            {currentUser && (
              <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
                <div className="flex items-center space-x-2">
                  <div className="hidden sm:block text-left">
                    <div className="flex items-center space-x-1.5">
                      <div className="text-xs font-bold text-slate-900 leading-tight">{currentUser.name}</div>
                      <button
                        id="btn-edit-user-profile"
                        onClick={() => setShowEditProfile(true)}
                        className="p-0.5 text-slate-400 hover:text-[#FA7014] rounded transition-colors"
                        title="Edit User Profile (Name, Title, Email)"
                      >
                        <UserCog className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center space-x-1.5 mt-0.5">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          currentUser.role === UserRole.REVIEWER
                            ? 'bg-emerald-500'
                            : currentUser.role === UserRole.CREATOR
                            ? 'bg-[#FA7014]'
                            : 'bg-amber-500'
                        }`}
                      />
                      <span className="truncate max-w-[140px] font-medium" title={currentUser.title || ''}>
                        {currentUser.title ||
                          (currentUser.role === UserRole.REVIEWER
                            ? 'Approver'
                            : currentUser.role === UserRole.CREATOR
                            ? 'HR (Creator)'
                            : 'Employee')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick 3-Role Toggle Bar */}
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
                  {creatorUser && (
                    <button
                      id="switch-to-creator"
                      onClick={() => {
                        onSwitchUser(creatorUser);
                        setActiveTab('creator');
                      }}
                      className={`px-2.5 py-1 text-xs rounded-lg font-bold transition-all ${
                        currentUser.id === creatorUser.id
                          ? 'bg-[#FA7014] text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
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
                      className={`px-2.5 py-1 text-xs rounded-lg font-bold transition-all ${
                        currentUser.id === reviewerUser.id
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
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
                      className={`px-2.5 py-1 text-xs rounded-lg font-bold transition-all ${
                        currentUser.id === employeeUser.id
                          ? 'bg-slate-900 text-[#FA7014] border border-[#FA7014]/40 font-bold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="Switch to Employee (AM001 - Parth)"
                    >
                      Employee
                    </button>
                  )}
                </div>

                {/* Logout */}
                <button
                  id="btn-header-logout"
                  onClick={onLogout}
                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit User Profile Modal */}
      {currentUser && showEditProfile && (
        <EditProfileModal
          isOpen={showEditProfile}
          onClose={() => setShowEditProfile(false)}
          currentUser={currentUser}
          onProfileUpdated={(updatedUser) => {
            onSwitchUser(updatedUser);
          }}
        />
      )}
    </header>
  );
};
