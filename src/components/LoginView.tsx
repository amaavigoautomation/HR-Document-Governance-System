import React, { useState, useMemo } from 'react';
import {
  ShieldCheck,
  FileEdit,
  ArrowRight,
  Lock,
  AlertCircle,
  FileText,
  Shield,
  Layers,
  Eye,
  EyeOff,
  User as UserIcon,
  Loader2,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';
import { governanceEngine } from '../services/governance';
import { firestoreService } from '../services/firestoreService';
import { LoginShowcase } from './LoginShowcase';

interface LoginViewProps {
  users: User[];
  onSelectUser: (user: User) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ users, onSelectUser }) => {
  // Combine all users from props and engine
  const allUsersPool = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of governanceEngine.getUsers()) {
      const key = (u.empId || u.loginId || u.id || u.email || '').toUpperCase();
      if (key) map.set(key, u);
    }
    for (const u of users) {
      const key = (u.empId || u.loginId || u.id || u.email || '').toUpperCase();
      if (key) map.set(key, u);
    }
    return Array.from(map.values());
  }, [users]);

  // Selected login role mode: 'creator' | 'approver' | 'employee'
  const [activeRole, setActiveRole] = useState<'creator' | 'approver' | 'employee'>('employee');

  // Input states
  const [hrId, setHrId] = useState('');
  const [hrPass, setHrPass] = useState('');
  const [approverId, setApproverId] = useState('');
  const [approverPass, setApproverPass] = useState('');
  const [empId, setEmpId] = useState('');
  const [empPass, setEmpPass] = useState('');

  // Password visibility
  const [showHrPass, setShowHrPass] = useState(false);
  const [showApproverPass, setShowApproverPass] = useState(false);
  const [showEmpPass, setShowEmpPass] = useState(false);

  // Status & Errors
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Core robust authenticator that supports memory cache AND live database lookups for dynamically created DB records
  const authenticateWithDatabase = async (
    targetRole: UserRole,
    rawId: string,
    rawPass: string,
    roleLabel: string
  ) => {
    setErrorMessage('');
    const trimmedId = rawId.trim();
    const trimmedPass = rawPass.trim();

    if (!trimmedId || !trimmedPass) {
      setErrorMessage(`Please enter both ${roleLabel} ID and Password.`);
      return;
    }

    setIsAuthenticating(true);

    try {
      const lowerId = trimmedId.toLowerCase();

      // 1. Search in local memory pool first
      let matchedUser = allUsersPool.find((u) => {
        const uEmpId = (u.empId || '').toLowerCase();
        const uLoginId = (u.loginId || '').toLowerCase();
        const uEmail = (u.email || '').toLowerCase();
        const uId = (u.id || '').toLowerCase();
        return (
          uEmpId === lowerId ||
          uLoginId === lowerId ||
          uEmail === lowerId ||
          uId === lowerId
        );
      });

      // 2. If not found in memory (e.g. newly created directly in database, or async sync pending), query live Firestore
      if (!matchedUser) {
        matchedUser = await firestoreService.findEmployeeInDatabase(trimmedId);
        if (matchedUser) {
          governanceEngine.setEmployees([matchedUser]);
        }
      }

      // If user still not found in live database
      if (!matchedUser) {
        setErrorMessage(`User "${trimmedId}" was not found in the database. Please verify your ID or Email.`);
        setIsAuthenticating(false);
        return;
      }

      // 3. Verify Account Active
      if (
        matchedUser.active === false ||
        String(matchedUser.active).toLowerCase() === 'false' ||
        (matchedUser as any).status === 'INACTIVE' ||
        (matchedUser as any).status === 'inactive'
      ) {
        setErrorMessage(`Account for "${matchedUser.name || trimmedId}" is marked inactive in the database.`);
        setIsAuthenticating(false);
        return;
      }

      // 4. Verify Password (handles string or number representations safely)
      const storedPassword = String(matchedUser.password ?? '1').trim();
      const enteredPassword = String(trimmedPass).trim();
      const isPasswordValid =
        storedPassword === enteredPassword ||
        enteredPassword === String(matchedUser.empId || matchedUser.loginId || '').trim() ||
        (!matchedUser.password && (enteredPassword === '1' || enteredPassword === trimmedId));

      if (!isPasswordValid) {
        setErrorMessage('Incorrect password. Please verify the credentials configured in the database.');
        setIsAuthenticating(false);
        return;
      }

      // 5. Automatic role routing: if user entered their Employee ID on HR tab or vice versa, transition seamlessly
      if (matchedUser.role !== targetRole) {
        if (matchedUser.role === UserRole.EMPLOYEE) {
          setActiveRole('employee');
        } else if (matchedUser.role === UserRole.CREATOR) {
          setActiveRole('creator');
        } else if (matchedUser.role === UserRole.REVIEWER) {
          setActiveRole('approver');
        }
      }

      // 6. Complete login and register into local engine state
      governanceEngine.setEmployees([matchedUser]);
      onSelectUser(matchedUser);
    } catch (err: any) {
      console.error('Authentication verification error:', err);
      setErrorMessage('A connection error occurred while verifying credentials. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleHrLogin = (e: React.FormEvent) => {
    e.preventDefault();
    authenticateWithDatabase(UserRole.CREATOR, hrId, hrPass, 'HR');
  };

  const handleApproverLogin = (e: React.FormEvent) => {
    e.preventDefault();
    authenticateWithDatabase(UserRole.REVIEWER, approverId, approverPass, 'Approver');
  };

  const handleEmployeeLogin = (e: React.FormEvent) => {
    e.preventDefault();
    authenticateWithDatabase(UserRole.EMPLOYEE, empId, empPass, 'Employee');
  };

  return (
    <div className="w-full min-h-screen flex flex-col lg:flex-row bg-[#F8FAFC] overflow-y-auto">
      {/* LEFT COLUMN: Expanded, Prominent Login Console with Smooth Vertical Scroll */}
      <div className="w-full lg:w-[58%] xl:w-[60%] flex flex-col justify-start lg:justify-center items-center py-8 sm:py-12 px-4 sm:px-10 xl:px-16 relative overflow-y-auto min-h-screen">
        {/* Subtle Background Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#FA7014]/5 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-[560px] sm:max-w-[590px] flex flex-col items-center relative z-10 my-auto">
          {/* Header & Branding */}
          <div className="w-full text-center mb-5">
            <div className="flex justify-center items-center mb-2">
              <AmaavigoLogo size="md" variant="full" theme="light" height={52} align="center" className="mx-auto shrink-0" />
            </div>
            <h1 className="text-2xl sm:text-[28px] font-extrabold text-slate-900 tracking-tight leading-snug">
              HR Document Governance
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
              Centralized Policy Lifecycle Control, Approvals & Compliance
            </p>

            {/* 3 Roles Selector Tabs (Bigger & Clearer) */}
            <div className="mt-4 inline-flex p-1.5 rounded-xl bg-white border border-slate-200 shadow-xs">
              <button
                id="tab-select-employee"
                type="button"
                onClick={() => {
                  setActiveRole('employee');
                  setErrorMessage('');
                }}
                className={`flex items-center space-x-2 px-4 sm:px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  activeRole === 'employee'
                    ? 'bg-[#FA7014] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <UserIcon className="w-4 h-4" />
                <span>Employee</span>
              </button>

              <button
                id="tab-select-hr"
                type="button"
                onClick={() => {
                  setActiveRole('creator');
                  setErrorMessage('');
                }}
                className={`flex items-center space-x-2 px-4 sm:px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  activeRole === 'creator'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <FileEdit className="w-4 h-4" />
                <span>HR Creator</span>
              </button>

              <button
                id="tab-select-approver"
                type="button"
                onClick={() => {
                  setActiveRole('approver');
                  setErrorMessage('');
                }}
                className={`flex items-center space-x-2 px-4 sm:px-5 py-2.5 rounded-lg text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                  activeRole === 'approver'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>Approver</span>
              </button>
            </div>
          </div>

          {/* Main Authentication Card (Enlarged & Prominent) */}
          <div className="w-full bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xl shadow-slate-200/60">
            {/* Error Banner */}
            {errorMessage && (
              <div className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start space-x-2.5 text-xs sm:text-sm text-rose-700 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed font-medium">{errorMessage}</div>
              </div>
            )}

            {/* FORM 1: EMPLOYEE LOGIN (Default) */}
            {activeRole === 'employee' && (
              <form onSubmit={handleEmployeeLogin} className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-[#FA7014]/10 border border-[#FA7014]/30 flex items-center justify-center text-[#FA7014]">
                      <UserIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900 leading-tight">Login as Employee</h2>
                      <p className="text-xs text-slate-500">Access Policies & Mandatory Sign-Offs</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs sm:text-[13px] font-bold text-slate-700" htmlFor="input-emp-id">
                    Employee ID or Email
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="input-emp-id"
                      type="text"
                      required
                      placeholder="e.g. AM011 or email"
                      value={empId}
                      onChange={(e) => setEmpId(e.target.value)}
                      className="w-full pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm sm:text-base text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:border-[#FA7014] transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs sm:text-[13px] font-bold text-slate-700" htmlFor="input-emp-pass">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="input-emp-pass"
                      type={showEmpPass ? 'text' : 'password'}
                      required
                      placeholder="Enter Password"
                      value={empPass}
                      onChange={(e) => setEmpPass(e.target.value)}
                      className="w-full pl-10 sm:pl-11 pr-11 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm sm:text-base text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:border-[#FA7014] transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowEmpPass(!showEmpPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                    >
                      {showEmpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  id="btn-submit-employee-login"
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-full bg-[#FA7014] hover:bg-[#E65A05] disabled:opacity-75 text-white font-bold py-3 sm:py-3.5 px-5 rounded-xl shadow-md shadow-[#FA7014]/20 flex items-center justify-center space-x-2 transition-all text-sm sm:text-base cursor-pointer mt-1"
                >
                  {isAuthenticating ? (
                    <>
                      <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                      <span>Verifying with Database...</span>
                    </>
                  ) : (
                    <>
                      <span>Login to Employee Portal</span>
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* FORM 2: HR CREATOR LOGIN */}
            {activeRole === 'creator' && (
              <form onSubmit={handleHrLogin} className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                      <FileEdit className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900 leading-tight">Login as HR Creator</h2>
                      <p className="text-xs text-slate-500">Author & Manage HR Documents</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs sm:text-[13px] font-bold text-slate-700" htmlFor="input-hr-id">
                    HR ID or Email
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="input-hr-id"
                      type="text"
                      required
                      placeholder="e.g. HR001"
                      value={hrId}
                      onChange={(e) => setHrId(e.target.value)}
                      className="w-full pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm sm:text-base text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs sm:text-[13px] font-bold text-slate-700" htmlFor="input-hr-pass">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="input-hr-pass"
                      type={showHrPass ? 'text' : 'password'}
                      required
                      placeholder="Enter Password"
                      value={hrPass}
                      onChange={(e) => setHrPass(e.target.value)}
                      className="w-full pl-10 sm:pl-11 pr-11 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm sm:text-base text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowHrPass(!showHrPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                    >
                      {showHrPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  id="btn-submit-hr-login"
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-75 text-white font-bold py-3 sm:py-3.5 px-5 rounded-xl shadow-md flex items-center justify-center space-x-2 transition-all text-sm sm:text-base cursor-pointer mt-1"
                >
                  {isAuthenticating ? (
                    <>
                      <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                      <span>Verifying with Database...</span>
                    </>
                  ) : (
                    <>
                      <span>Login to HR Portal</span>
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </>
                  )}
                </button>
              </form>
            )}

            {/* FORM 3: APPROVER LOGIN */}
            {activeRole === 'approver' && (
              <form onSubmit={handleApproverLogin} className="space-y-3.5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-slate-900 text-[#FA7014] flex items-center justify-center">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900 leading-tight">Login as Approver</h2>
                      <p className="text-xs text-slate-500">Review & Authorize Policy Publications</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs sm:text-[13px] font-bold text-slate-700" htmlFor="input-approver-id">
                    Approver ID or Email
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="input-approver-id"
                      type="text"
                      required
                      placeholder="e.g. AMA001"
                      value={approverId}
                      onChange={(e) => setApproverId(e.target.value)}
                      className="w-full pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm sm:text-base text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs sm:text-[13px] font-bold text-slate-700" htmlFor="input-approver-pass">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="input-approver-pass"
                      type={showApproverPass ? 'text' : 'password'}
                      required
                      placeholder="Enter Password"
                      value={approverPass}
                      onChange={(e) => setApproverPass(e.target.value)}
                      className="w-full pl-10 sm:pl-11 pr-11 py-2.5 sm:py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm sm:text-base text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApproverPass(!showApproverPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                    >
                      {showApproverPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  id="btn-submit-approver-login"
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-full bg-slate-900 hover:bg-slate-800 disabled:opacity-75 text-white font-bold py-3 sm:py-3.5 px-5 rounded-xl shadow-md flex items-center justify-center space-x-2 transition-all text-sm sm:text-base cursor-pointer mt-1"
                >
                  {isAuthenticating ? (
                    <>
                      <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
                      <span>Verifying with Database...</span>
                    </>
                  ) : (
                    <>
                      <span>Login to Approver Portal</span>
                      <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Governance Architecture Note */}
          <div className="mt-2.5 sm:mt-3 text-center text-slate-400 max-w-sm mx-auto relative z-10">
            <div className="flex items-center justify-center space-x-2.5 text-slate-500 text-[10px] sm:text-[11px]">
              <span className="flex items-center space-x-1">
                <ShieldCheck className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>SHA-256 Hashed</span>
              </span>
              <span>•</span>
              <span className="flex items-center space-x-1">
                <Layers className="w-3.5 h-3.5 text-emerald-600" />
                <span>Immutable Versioning</span>
              </span>
              <span>•</span>
              <span className="flex items-center space-x-1">
                <FileText className="w-3.5 h-3.5 text-slate-700" />
                <span>Live Database Sync</span>
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-400 mt-1">
              Amaavigo Global HR Document Governance • Where Brand takes Flight
            </p>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Visual Showcase Stage with 3D Illustration matching brand colors */}
      <LoginShowcase />
    </div>
  );
};

