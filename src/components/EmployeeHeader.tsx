import React from 'react';
import {
  BookOpen,
  FileText,
  LogOut,
  ShieldAlert,
} from 'lucide-react';
import { User } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';

interface EmployeeHeaderProps {
  currentUser: User;
  onLogout: () => void;
  activeTab?: 'acknowledgements' | 'all-documents';
  onTabChange?: (tab: 'acknowledgements' | 'all-documents') => void;
  pendingCount?: number;
  totalDocsCount?: number;
}

export const EmployeeHeader: React.FC<EmployeeHeaderProps> = ({
  currentUser,
  onLogout,
  activeTab = 'acknowledgements',
  onTabChange,
  pendingCount = 0,
  totalDocsCount = 0,
}) => {
  const displayId = currentUser.empId || currentUser.loginId || currentUser.id || '';
  const displayDept = currentUser.departmentName || 'Operations';
  const displayTitle = currentUser.title || 'Staff Member';

  return (
    <header
      id="employee-header"
      className="bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-900 sticky top-0 z-40 shadow-xs"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center space-x-3.5 shrink-0">
            <div className="flex items-center shrink-0">
              <AmaavigoLogo size="md" variant="full" theme="light" height={48} className="shrink-0" />
            </div>
          </div>

          {/* Employee Navigation Tabs: Policy & SOP Acknowledgements + All Documents */}
          <nav
            id="employee-navigation-bar"
            className="flex items-center space-x-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200"
          >
            <button
              id="header-nav-acknowledgements"
              type="button"
              onClick={() => onTabChange?.('acknowledgements')}
              className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                activeTab === 'acknowledgements'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
            >
              <BookOpen className={`w-3.5 h-3.5 ${activeTab === 'acknowledgements' ? 'text-amber-400' : 'text-slate-400'}`} />
              <span><span className="hidden sm:inline">Policy & SOP </span>Acknowledgements</span>
              {pendingCount > 0 ? (
                <span className="ml-1 bg-amber-500 text-slate-950 text-[10px] px-1.5 py-0.5 rounded-full font-extrabold leading-none">
                  {pendingCount}
                </span>
              ) : (
                <span className="ml-1 bg-emerald-500/20 text-emerald-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none">
                  ✓
                </span>
              )}
            </button>

            <button
              id="header-nav-all-documents"
              type="button"
              onClick={() => onTabChange?.('all-documents')}
              className={`px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer ${
                activeTab === 'all-documents'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white'
              }`}
            >
              <FileText className={`w-3.5 h-3.5 ${activeTab === 'all-documents' ? 'text-amber-400' : 'text-slate-400'}`} />
              <span>All Documents</span>
              <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold leading-none ${
                activeTab === 'all-documents' ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-700'
              }`}>
                {totalDocsCount}
              </span>
            </button>
          </nav>

          {/* Right actions: Employee Profile & Logout */}
          <div className="flex items-center space-x-2.5">
            {/* Employee Profile Details */}
            <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
              <div className="hidden sm:block text-left">
                <div className="flex items-center space-x-1.5">
                  <div className="text-xs font-bold text-slate-900 leading-tight">
                    {currentUser.name || 'Employee'}
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-semibold border border-amber-200">
                    {displayId}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 flex items-center space-x-1.5 mt-0.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                  <span className="truncate max-w-[150px] font-medium" title={`${displayTitle} • ${displayDept}`}>
                    {displayTitle} ({displayDept})
                  </span>
                </div>
              </div>

              {/* Logout Button */}
              <button
                id="btn-employee-logout"
                type="button"
                onClick={onLogout}
                className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-slate-100 rounded-lg transition-colors ml-1"
                title="Logout from Employee Portal"
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
