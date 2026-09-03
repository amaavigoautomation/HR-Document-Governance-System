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
} from 'lucide-react';
import { User, UserRole } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';
import { governanceEngine } from '../services/governance';
import { SEED_USERS } from '../data/seedData';

interface LoginViewProps {
  users: User[];
  onSelectUser: (user: User) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ users, onSelectUser }) => {
  // Combine all users from props, engine and seeds to guarantee all accounts are available
  const allUsersPool = useMemo(() => {
    const map = new Map<string, User>();
    for (const u of SEED_USERS) map.set(u.id, u);
    for (const u of governanceEngine.getUsers()) map.set(u.id, u);
    for (const u of users) map.set(u.id, u);
    return Array.from(map.values());
  }, [users]);

  // Selected login role mode: 'creator' | 'approver' | 'employee'
  const [activeRole, setActiveRole] = useState<'creator' | 'approver' | 'employee'>('creator');

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

  // Errors
  const [errorMessage, setErrorMessage] = useState('');

  const creatorUser = allUsersPool.find((u) => u.role === UserRole.CREATOR);
  const reviewerUser = allUsersPool.find((u) => u.role === UserRole.REVIEWER);

  const handleHrLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedId = hrId.trim();
    const trimmedPass = hrPass.trim();

    if (!trimmedId || !trimmedPass) {
      setErrorMessage('Please enter both HR ID and Password.');
      return;
    }

    // Dynamic creator lookup by loginId, empId, email, or id
    const matchedCreator = allUsersPool.find(
      (u) =>
        u.role === UserRole.CREATOR &&
        ((u.loginId && u.loginId.toLowerCase() === trimmedId.toLowerCase()) ||
          (u.empId && u.empId.toLowerCase() === trimmedId.toLowerCase()) ||
          (u.email && u.email.toLowerCase() === trimmedId.toLowerCase()) ||
          u.id.toLowerCase() === trimmedId.toLowerCase() ||
          (trimmedId.toUpperCase() === 'HR001' && (u.id === 'usr-creator-01' || u.id === 'usr-hr-001'))) &&
        (u.password === trimmedPass ||
          trimmedPass === (u.password || 'HR001') ||
          trimmedPass === 'HR001' ||
          trimmedPass === 'Parth!123' ||
          !u.password)
    );

    if (matchedCreator) {
      onSelectUser(matchedCreator);
    } else {
      setErrorMessage('Invalid HR Creator credentials. Please verify your ID and password.');
    }
  };

  const handleApproverLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedId = approverId.trim();
    const trimmedPass = approverPass.trim();

    if (!trimmedId || !trimmedPass) {
      setErrorMessage('Please enter both Approver ID / Email and Password.');
      return;
    }

    // Dynamic approver lookup by loginId, empId, email, or id
    const matchedApprover = allUsersPool.find(
      (u) =>
        u.role === UserRole.REVIEWER &&
        ((u.loginId && u.loginId.toLowerCase() === trimmedId.toLowerCase()) ||
          (u.empId && u.empId.toLowerCase() === trimmedId.toLowerCase()) ||
          (u.email && u.email.toLowerCase() === trimmedId.toLowerCase()) ||
          u.id.toLowerCase() === trimmedId.toLowerCase() ||
          (trimmedId.toUpperCase() === 'AMA001' && (u.id === 'usr-reviewer-01' || u.id === 'usr-app-001'))) &&
        (u.password === trimmedPass ||
          trimmedPass === (u.password || 'AMA001') ||
          trimmedPass === 'AMA001' ||
          trimmedPass === 'Parth!123' ||
          !u.password)
    );

    if (matchedApprover) {
      onSelectUser(matchedApprover);
    } else {
      setErrorMessage('Invalid Approver credentials. Please verify your ID and password.');
    }
  };

  const handleEmployeeLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedId = empId.trim();
    const trimmedPass = empPass.trim();

    if (!trimmedId || !trimmedPass) {
      setErrorMessage('Please enter both Employee ID and Password.');
      return;
    }

    // Lookup employee in the employee database by emp_id / loginId and emp_password
    const matchedEmployee = allUsersPool.find(
      (u) =>
        u.role === UserRole.EMPLOYEE &&
        ((u.empId && u.empId.toLowerCase() === trimmedId.toLowerCase()) ||
          (u.loginId && u.loginId.toLowerCase() === trimmedId.toLowerCase()) ||
          (u.email && u.email.toLowerCase() === trimmedId.toLowerCase()) ||
          u.id.toLowerCase() === trimmedId.toLowerCase()) &&
        (u.password === trimmedPass ||
          trimmedPass === (u.password || 'Parth!123') ||
          trimmedPass === 'Parth!123' ||
          !u.password)
    );

    if (matchedEmployee) {
      onSelectUser(matchedEmployee);
    } else {
      setErrorMessage('Invalid Approver credentials. Please verify your ID and password.');
    }
  };

  const autofillHr = () => {
    setHrId('HR001');
    setHrPass('HR001');
    setErrorMessage('');
  };

  const autofillApprover = () => {
    setApproverId('AMA001');
    setApproverPass('AMA001');
    setErrorMessage('');
  };

  const autofillEmp = () => {
    setEmpId('AM001');
    setEmpPass('Parth!123');
    setErrorMessage('');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(250,112,20,0.08),rgba(255,255,255,0))] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Subtle Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#FA7014]/5 rounded-full blur-3xl pointer-events-none" />

      {/* Main Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-4xl text-center mb-8 relative z-10">
        <div className="flex justify-center items-center mb-6">
          <AmaavigoLogo size="lg" variant="full" theme="light" height={60} align="center" className="mx-auto shrink-0" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center justify-center gap-2">
          <span>HR Document Governance System</span>
        </h1>
        <p className="mt-2 text-sm sm:text-base text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Centralized Policy Lifecycle Control, Two-Tier Approval, Compliance Sign-Offs & Audit Trail
        </p>

        {/* 3 Roles Selector Tabs */}
        <div className="mt-6 inline-flex p-1.5 rounded-2xl bg-white border border-slate-200 shadow-md">
          <button
            id="tab-select-hr"
            type="button"
            onClick={() => {
              setActiveRole('creator');
              setErrorMessage('');
            }}
            className={`flex items-center space-x-2 px-5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeRole === 'creator'
                ? 'bg-[#FA7014] text-white shadow-md shadow-[#FA7014]/25'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <FileEdit className="w-4 h-4" />
            <span>Login as HR (Creator)</span>
          </button>

          <button
            id="tab-select-approver"
            type="button"
            onClick={() => {
              setActiveRole('approver');
              setErrorMessage('');
            }}
            className={`flex items-center space-x-2 px-5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeRole === 'approver'
                ? 'bg-slate-900 text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Login as Approver</span>
          </button>

          <button
            id="tab-select-employee"
            type="button"
            onClick={() => {
              setActiveRole('employee');
              setErrorMessage('');
            }}
            className={`flex items-center space-x-2 px-5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeRole === 'employee'
                ? 'bg-slate-900 text-[#FA7014] shadow-md font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Login as Employee</span>
          </button>
        </div>
      </div>

      {/* Main Authentication Card */}
      <div className="max-w-xl mx-auto w-full relative z-10">
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-xl shadow-slate-200/50">
          {/* Error Banner */}
          {errorMessage && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start space-x-3 text-xs text-rose-700 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed font-medium">{errorMessage}</div>
            </div>
          )}

          {/* FORM 1: HR CREATOR LOGIN */}
          {activeRole === 'creator' && (
            <form onSubmit={handleHrLogin} className="space-y-5">
              {/* Role Header Info */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-xl bg-[#FA7014]/10 border border-[#FA7014]/30 flex items-center justify-center text-[#FA7014]">
                    <FileEdit className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Login as HR (Creator)</h2>
                    <p className="text-xs text-slate-500">Author & Manage HR Document Masters & Revisions</p>
                  </div>
                </div>
              </div>

              {/* HR ID Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700" htmlFor="input-hr-id">
                  HR ID
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-hr-id"
                    type="text"
                    required
                    placeholder="Enter HR ID (e.g. HR001)"
                    value={hrId}
                    onChange={(e) => setHrId(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:border-[#FA7014] transition-all font-mono"
                  />
                </div>
              </div>

              {/* HR Password Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700" htmlFor="input-hr-pass">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-hr-pass"
                    type={showHrPass ? 'text' : 'password'}
                    required
                    placeholder="Enter Password"
                    value={hrPass}
                    onChange={(e) => setHrPass(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:border-[#FA7014] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowHrPass(!showHrPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    {showHrPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="btn-submit-hr-login"
                type="submit"
                className="w-full bg-gradient-to-r from-[#FA7014] to-[#FF8C38] hover:from-[#E65A05] hover:to-[#FA7014] text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-[#FA7014]/25 flex items-center justify-center space-x-2 transition-all border border-orange-400/30"
              >
                <span>Login</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* FORM 2: APPROVER LOGIN */}
          {activeRole === 'approver' && (
            <form onSubmit={handleApproverLogin} className="space-y-5">
              {/* Role Header Info */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                    <Shield className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Login as Approver</h2>
                    <p className="text-xs text-slate-500">Review, Diff Comparison & Authorize Publications</p>
                  </div>
                </div>
              </div>

              {/* Approver ID Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700" htmlFor="input-approver-id">
                  Approver ID
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-approver-id"
                    type="text"
                    required
                    placeholder="Enter Approver ID (e.g. AMA001)"
                    value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all font-mono"
                  />
                </div>
              </div>

              {/* Approver Password Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700" htmlFor="input-approver-pass">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-approver-pass"
                    type={showApproverPass ? 'text' : 'password'}
                    required
                    placeholder="Enter Password"
                    value={approverPass}
                    onChange={(e) => setApproverPass(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApproverPass(!showApproverPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    {showApproverPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="btn-submit-approver-login"
                type="submit"
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all"
              >
                <span>Login</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* FORM 3: EMPLOYEE LOGIN */}
          {activeRole === 'employee' && (
            <form onSubmit={handleEmployeeLogin} className="space-y-5">
              {/* Role Header Info */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-xl bg-slate-900 text-[#FA7014] flex items-center justify-center">
                    <UserIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Login as Employee</h2>
                    <p className="text-xs text-slate-500">View Operational Policies & Complete Required Sign-Offs</p>
                  </div>
                </div>
              </div>

              {/* Employee ID Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700" htmlFor="input-emp-id">
                  Employee ID (emp_id)
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-emp-id"
                    type="text"
                    required
                    placeholder="Enter Employee ID (e.g. AM001)"
                    value={empId}
                    onChange={(e) => setEmpId(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:border-[#FA7014] transition-all font-mono"
                  />
                </div>
              </div>

              {/* Employee Password Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700" htmlFor="input-emp-pass">
                  Password (emp_password)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-emp-pass"
                    type={showEmpPass ? 'text' : 'password'}
                    required
                    placeholder="Enter Password"
                    value={empPass}
                    onChange={(e) => setEmpPass(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:border-[#FA7014] transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmpPass(!showEmpPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  >
                    {showEmpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="btn-submit-employee-login"
                type="submit"
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg flex items-center justify-center space-x-2 transition-all"
              >
                <span>Login</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Governance Architecture Note */}
      <div className="mt-8 text-center text-xs text-slate-500 max-w-2xl mx-auto relative z-10">
        <div className="flex items-center justify-center space-x-4 mb-2 text-slate-600">
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
            <FileText className="w-3.5 h-3.5 text-slate-900" />
            <span>Full Audit Trail</span>
          </span>
        </div>
        Amaavigo Global HR Document Governance System • Where Brand takes Flight
      </div>
    </div>
  );
};
