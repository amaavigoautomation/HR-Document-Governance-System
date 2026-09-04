import React from 'react';
import {
  BookOpen,
  LogOut,
  ShieldAlert,
} from 'lucide-react';
import { User } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';

interface EmployeeHeaderProps {
  currentUser: User;
  onLogout: () => void;
}

export const EmployeeHeader: React.FC<EmployeeHeaderProps> = ({
  currentUser,
  onLogout,
}) => {
  const displayId = currentUser.empId || currentUser.loginId || currentUser.id || 'EMP';
  const displayDept = currentUser.departmentName || 'Operations';
  const displayTitle = currentUser.title || 'Staff Member';

  return (
    <header
      id="employee-header"
      className="bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-900 sticky top-0 z-40 shadow-xs"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Employee Portal Branding */}
          <div className="flex items-center space-x-3.5 shrink-0">
            <div className="flex items-center shrink-0">
              <AmaavigoLogo size="md" variant="full" theme="light" height={48} className="shrink-0" />
            </div>
            <div className="hidden sm:flex items-center pl-3 border-l border-slate-200 space-x-2 shrink-0">
              <span className="font-bold text-sm tracking-tight text-slate-900 flex items-center gap-1.5">
                <span className="text-slate-800">DocGov</span>
                <span className="bg-amber-50 text-amber-700 text-[10px] px-2.5 py-0.5 rounded-full font-mono font-bold border border-amber-300">
                  Employee Portal
                </span>
              </span>
            </div>
          </div>

          {/* Employee-Specific Navigation Pill */}
          <nav
            id="employee-navigation-bar"
            className="hidden md:flex items-center space-x-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200"
          >
            <div className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white shadow-sm flex items-center space-x-1.5">
              <BookOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>Policy & SOP Acknowledgements</span>
            </div>
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
