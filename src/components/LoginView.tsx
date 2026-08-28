import React, { useState } from 'react';
import {
  ShieldCheck,
  FileEdit,
  ArrowRight,
  Lock,
  CheckCircle2,
  AlertCircle,
  FileText,
  KeyRound,
  Shield,
  Layers,
  Sparkles,
  Eye,
  EyeOff,
  User as UserIcon,
} from 'lucide-react';
import { User, UserRole } from '../types';

interface LoginViewProps {
  users: User[];
  onSelectUser: (user: User) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ users, onSelectUser }) => {
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

  const creatorUser = users.find((u) => u.role === UserRole.CREATOR);
  const reviewerUser = users.find((u) => u.role === UserRole.REVIEWER);

  const handleHrLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedId = hrId.trim().toUpperCase();
    const trimmedPass = hrPass.trim();

    if (!trimmedId || !trimmedPass) {
      setErrorMessage('Please enter both HR ID and Password.');
      return;
    }

    if (trimmedId === 'HR001' && trimmedPass === 'HR001') {
      if (creatorUser) {
        onSelectUser(creatorUser);
      }
    } else {
      setErrorMessage('Invalid HR credentials! Required — ID: HR001 | Password: HR001');
    }
  };

  const handleApproverLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const trimmedId = approverId.trim().toUpperCase();
    const trimmedPass = approverPass.trim();

    if (!trimmedId || !trimmedPass) {
      setErrorMessage('Please enter both Approver ID and Password.');
      return;
    }

    if (trimmedId === 'AMA001' && trimmedPass === 'AMA001') {
      if (reviewerUser) {
        onSelectUser(reviewerUser);
      }
    } else {
      setErrorMessage('Invalid Approver credentials! Required — ID: AMA001 | Password: AMA001');
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
    const matchedEmployee = users.find(
      (u) =>
        u.role === UserRole.EMPLOYEE &&
        ((u.empId && u.empId.toLowerCase() === trimmedId.toLowerCase()) ||
          (u.loginId && u.loginId.toLowerCase() === trimmedId.toLowerCase()) ||
          (u.email && u.email.toLowerCase() === trimmedId.toLowerCase()) ||
          u.id.toLowerCase() === trimmedId.toLowerCase()) &&
        (u.password === trimmedPass || (!u.password && trimmedPass === 'Parth!123'))
    );

    if (matchedEmployee) {
      onSelectUser(matchedEmployee);
    } else {
      setErrorMessage('Invalid Employee credentials! (Demo: ID: AM001 | Password: Parth!123)');
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
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(59,130,246,0.15),rgba(255,255,255,0))] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Subtle Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-72 h-72 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Header */}
      <div className="sm:mx-auto sm:w-full sm:max-w-4xl text-center mb-8 relative z-10">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl shadow-blue-500/25 mb-4 border border-blue-400/40 ring-4 ring-blue-500/10">
          <ShieldCheck className="w-9 h-9 text-white" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          HR Document Governance System
        </h1>
        <p className="mt-2 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          Secure Authentication Portal — Centralized Lifecycle Control, Immutability & Audit Trail
        </p>

        {/* 3 Roles Selector Tabs */}
        <div className="mt-6 inline-flex p-1.5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-md">
          <button
            id="tab-select-hr"
            type="button"
            onClick={() => {
              setActiveRole('creator');
              setErrorMessage('');
            }}
            className={`flex items-center space-x-2 px-5 py-3 rounded-xl text-xs font-bold transition-all ${
              activeRole === 'creator'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/30 border border-blue-400/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
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
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-600/30 border border-emerald-400/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
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
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30 border border-indigo-400/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Login as Employee</span>
          </button>
        </div>
      </div>

      {/* Main Authentication Card */}
      <div className="max-w-xl mx-auto w-full relative z-10">
        <div className="glass-panel-dark rounded-3xl border border-slate-800/90 p-8 shadow-2xl shadow-black/50 backdrop-blur-xl">
          {/* Error Banner */}
          {errorMessage && (
            <div className="mb-6 p-4 rounded-xl bg-rose-950/50 border border-rose-800/60 flex items-start space-x-3 text-xs text-rose-300 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{errorMessage}</div>
            </div>
          )}

          {/* FORM 1: HR CREATOR LOGIN */}
          {activeRole === 'creator' && (
            <form onSubmit={handleHrLogin} className="space-y-5">
              {/* Role Header Info */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                    <FileEdit className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Login as HR (Creator)</h2>
                    <p className="text-xs text-slate-400">Author & Manage HR Document Masters & Revisions</p>
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold text-blue-300 bg-blue-950/60 border border-blue-800/60 px-2.5 py-1 rounded-lg">
                  Role: HR Creator
                </span>
              </div>

              {/* HR ID Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300" htmlFor="input-hr-id">
                  HR ID
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-hr-id"
                    type="text"
                    required
                    placeholder="Enter HR ID (e.g. HR001)"
                    value={hrId}
                    onChange={(e) => setHrId(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-mono"
                  />
                </div>
              </div>

              {/* HR Password Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300" htmlFor="input-hr-pass">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-hr-pass"
                    type={showHrPass ? 'text' : 'password'}
                    required
                    placeholder="Enter Password (HR001)"
                    value={hrPass}
                    onChange={(e) => setHrPass(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowHrPass(!showHrPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                  >
                    {showHrPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Demo Credentials Pill */}
              <div className="bg-blue-950/40 border border-blue-900/50 rounded-xl p-3 flex items-center justify-between text-xs">
                <div className="text-blue-300">
                  <span className="font-semibold text-blue-200">Credentials:</span> ID: <strong className="font-mono text-white">HR001</strong> | Pass: <strong className="font-mono text-white">HR001</strong>
                </div>
                <button
                  type="button"
                  onClick={autofillHr}
                  className="text-[11px] font-semibold text-blue-400 hover:text-blue-200 bg-blue-900/60 hover:bg-blue-900 px-2.5 py-1 rounded-lg border border-blue-700/50 transition-colors"
                >
                  Autofill
                </button>
              </div>

              {/* Submit Button */}
              <button
                id="btn-submit-hr-login"
                type="submit"
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 transition-all border border-blue-400/30"
              >
                <span>Login as HR (Creator)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* FORM 2: APPROVER LOGIN */}
          {activeRole === 'approver' && (
            <form onSubmit={handleApproverLogin} className="space-y-5">
              {/* Role Header Info */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Shield className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Login as Approver</h2>
                    <p className="text-xs text-slate-400">Review, Diff Comparison & Authorize Publications</p>
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold text-emerald-300 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded-lg">
                  Role: Approver
                </span>
              </div>

              {/* Approver ID Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300" htmlFor="input-approver-id">
                  Approver ID
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-approver-id"
                    type="text"
                    required
                    placeholder="Enter Approver ID (e.g. AMA001)"
                    value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all font-mono"
                  />
                </div>
              </div>

              {/* Approver Password Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300" htmlFor="input-approver-pass">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-approver-pass"
                    type={showApproverPass ? 'text' : 'password'}
                    required
                    placeholder="Enter Password (AMA001)"
                    value={approverPass}
                    onChange={(e) => setApproverPass(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApproverPass(!showApproverPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                  >
                    {showApproverPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Demo Credentials Pill */}
              <div className="bg-emerald-950/40 border border-emerald-900/50 rounded-xl p-3 flex items-center justify-between text-xs">
                <div className="text-emerald-300">
                  <span className="font-semibold text-emerald-200">Credentials:</span> ID: <strong className="font-mono text-white">AMA001</strong> | Pass: <strong className="font-mono text-white">AMA001</strong>
                </div>
                <button
                  type="button"
                  onClick={autofillApprover}
                  className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-200 bg-emerald-900/60 hover:bg-emerald-900 px-2.5 py-1 rounded-lg border border-emerald-700/50 transition-colors"
                >
                  Autofill
                </button>
              </div>

              {/* Submit Button */}
              <button
                id="btn-submit-approver-login"
                type="submit"
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-emerald-600/30 flex items-center justify-center space-x-2 transition-all border border-emerald-400/30"
              >
                <span>Login as Approver</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* FORM 3: EMPLOYEE LOGIN */}
          {activeRole === 'employee' && (
            <form onSubmit={handleEmployeeLogin} className="space-y-5">
              {/* Role Header Info */}
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <UserIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white">Login as Employee</h2>
                    <p className="text-xs text-slate-400">View Operational Policies & Complete Required Sign-Offs</p>
                  </div>
                </div>
                <span className="text-[11px] font-mono font-bold text-indigo-300 bg-indigo-950/60 border border-indigo-800/60 px-2.5 py-1 rounded-lg">
                  Role: Employee
                </span>
              </div>

              {/* Employee ID Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300" htmlFor="input-emp-id">
                  Employee ID (emp_id)
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-emp-id"
                    type="text"
                    required
                    placeholder="Enter Employee ID (e.g. AM001)"
                    value={empId}
                    onChange={(e) => setEmpId(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all font-mono"
                  />
                </div>
              </div>

              {/* Employee Password Input */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-300" htmlFor="input-emp-pass">
                  Password (emp_password)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-emp-pass"
                    type={showEmpPass ? 'text' : 'password'}
                    required
                    placeholder="Enter Password (Parth!123)"
                    value={empPass}
                    onChange={(e) => setEmpPass(e.target.value)}
                    className="w-full pl-10 pr-10 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmpPass(!showEmpPass)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-1"
                  >
                    {showEmpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Employee Details Preview & Autofill */}
              <div className="bg-indigo-950/40 border border-indigo-900/50 rounded-xl p-3.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-indigo-300">
                  <div>
                    <span className="font-semibold text-indigo-200">Employee Database Record:</span>
                  </div>
                  <button
                    type="button"
                    onClick={autofillEmp}
                    className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-200 bg-indigo-900/60 hover:bg-indigo-900 px-2.5 py-1 rounded-lg border border-indigo-700/50 transition-colors"
                  >
                    Autofill (AM001)
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-indigo-900/40 text-[11px] font-mono text-slate-300">
                  <div><span className="text-slate-400">emp_id:</span> <strong className="text-white">AM001</strong></div>
                  <div><span className="text-slate-400">emp_name:</span> <strong className="text-white">Parth</strong></div>
                  <div><span className="text-slate-400">emp_email:</span> <strong className="text-white">parth@amaavigo.in</strong></div>
                  <div><span className="text-slate-400">emp_password:</span> <strong className="text-white">Parth!123</strong></div>
                </div>
              </div>

              {/* Submit Button */}
              <button
                id="btn-submit-employee-login"
                type="submit"
                className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-indigo-600/30 flex items-center justify-center space-x-2 transition-all border border-indigo-400/30"
              >
                <span>Login to Employee Portal</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Governance Architecture Note */}
      <div className="mt-8 text-center text-xs text-slate-400 max-w-2xl mx-auto relative z-10">
        <div className="flex items-center justify-center space-x-4 mb-2 text-slate-400">
          <span className="flex items-center space-x-1">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>SHA-256 Hashed</span>
          </span>
          <span>•</span>
          <span className="flex items-center space-x-1">
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            <span>Immutable Versioning</span>
          </span>
          <span>•</span>
          <span className="flex items-center space-x-1">
            <FileText className="w-3.5 h-3.5 text-purple-400" />
            <span>Full Audit Trail</span>
          </span>
        </div>
        Amaavigo Global HR Document Governance System • Two-Tier Role Authorization Model
      </div>
    </div>
  );
};
