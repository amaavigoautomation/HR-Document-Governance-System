import React, { useState } from 'react';
import {
  Shield,
  Bot,
  Check,
  X,
  Users,
  Layers,
  Sparkles,
  Lock,
  Loader2,
  CheckCircle2,
  Search,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { governanceEngine } from '../services/governance';
import {
  normalizeAuthorizedModules,
  getAuthorizationLabel,
  ModuleAuthorizationCode,
} from '../utils/authorization';

interface ManageModuleAuthorizationModalProps {
  currentUser: User;
  users: User[];
  onClose: () => void;
  onSuccess: () => void;
}

export const ManageModuleAuthorizationModal: React.FC<ManageModuleAuthorizationModalProps> = ({
  currentUser,
  users,
  onClose,
  onSuccess,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filter users to HR and Founder / Approvers (and all users that can access platforms)
  const hrAndApproverUsers = users.filter((u) => {
    const isHrOrApprover = u.role === UserRole.CREATOR || u.role === UserRole.REVIEWER;
    if (!isHrOrApprover) return false;
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.loginId && u.loginId.toLowerCase().includes(q)) ||
      (u.empId && u.empId.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.title && u.title.toLowerCase().includes(q))
    );
  });

  const handleUpdateAuthorization = async (
    targetUser: User,
    newAuth: ModuleAuthorizationCode
  ) => {
    setUpdatingUserId(targetUser.id);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      await governanceEngine.updateUserModuleAuthorization(
        targetUser.id,
        newAuth,
        currentUser
      );
      setSuccessMessage(
        `Authorization for ${targetUser.name} updated to "${getAuthorizationLabel(
          newAuth
        )}".`
      );
      onSuccess();
    } catch (err: any) {
      console.error('Failed to update module authorization:', err);
      setErrorMessage(
        err.message || 'Failed to update authorization in database. Please try again.'
      );
    } finally {
      setUpdatingUserId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#FA7014] text-white flex items-center justify-center shadow-md">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight flex items-center gap-2">
                Module Access &amp; Authorization
                <span className="bg-emerald-500/20 text-emerald-300 text-[10px] px-2 py-0.5 rounded font-mono font-bold border border-emerald-500/30">
                  Database Synced
                </span>
              </h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Configure module permissions for HR and Founder/Approver accounts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Explanation banner */}
        <div className="bg-orange-50/70 border-b border-orange-100 p-4 text-xs text-slate-700 flex items-start gap-3">
          <Sparkles className="w-4 h-4 text-[#FA7014] shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-slate-900">Authorization Rules:</span>
            <ul className="list-disc pl-4 mt-1 space-y-0.5 text-slate-600">
              <li>
                <strong className="text-slate-800">All Modules:</strong> User sees both{' '}
                <span className="text-[#FA7014] font-semibold">Talent Acquisition</span> and{' '}
                <span className="text-slate-900 font-semibold">Document Version Control</span> (entire software).
              </li>
              <li>
                <strong className="text-slate-800">Talent Acquisition:</strong> User only sees the{' '}
                <span className="text-[#FA7014] font-semibold">Talent Acquisition</span> module (Overview &amp; Forms).
              </li>
              <li>
                <strong className="text-slate-800">Document Version Control:</strong> User only sees the{' '}
                <span className="text-slate-900 font-semibold">Document Version Control</span> module (Policies, Reviews &amp; Compliance).
              </li>
            </ul>
          </div>
        </div>

        {/* Alerts */}
        {successMessage && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
            <X className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Search bar */}
        <div className="p-5 pb-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search HR or Founder accounts by name, ID or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014]"
            />
          </div>
        </div>

        {/* User list */}
        <div className="px-5 pb-5 max-h-[360px] overflow-y-auto space-y-3">
          {hrAndApproverUsers.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              No HR or Founder/Approver accounts found matching search.
            </div>
          ) : (
            hrAndApproverUsers.map((user) => {
              const currentAuth = normalizeAuthorizedModules(user.authorizedModules);
              const isUpdating = updatingUserId === user.id;

              return (
                <div
                  key={user.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                        user.role === UserRole.CREATOR
                          ? 'bg-orange-100 text-[#FA7014]'
                          : 'bg-slate-900 text-white'
                      }`}
                    >
                      {user.role === UserRole.CREATOR ? (
                        <Bot className="w-4 h-4" />
                      ) : (
                        <Shield className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {user.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white text-slate-600 font-semibold border border-slate-200">
                          {user.loginId || user.empId || user.id}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                            user.role === UserRole.CREATOR
                              ? 'bg-[#FA7014]/15 text-[#FA7014]'
                              : 'bg-slate-200 text-slate-800'
                          }`}
                        >
                          {user.role === UserRole.CREATOR ? 'HR Agent' : 'Founder / Approver'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">
                        {user.title || user.email}
                      </div>
                    </div>
                  </div>

                  {/* Authorization Select Buttons */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isUpdating ? (
                      <div className="flex items-center space-x-1.5 text-xs text-slate-500 font-medium px-3 py-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA7014]" />
                        <span>Saving...</span>
                      </div>
                    ) : (
                      <div className="inline-flex p-0.5 rounded-lg bg-slate-200/80 border border-slate-300/80">
                        {/* Option 1: ALL */}
                        <button
                          type="button"
                          onClick={() => handleUpdateAuthorization(user, 'ALL')}
                          title="Authorized for entire software (Talent Acquisition + Document Version Control)"
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                            currentAuth === 'ALL'
                              ? 'bg-slate-900 text-white shadow-2xs'
                              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                          }`}
                        >
                          All Modules
                        </button>

                        {/* Option 2: TALENT ACQUISITION */}
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateAuthorization(user, 'TALENT_ACQUISITION')
                          }
                          title="Authorized ONLY for Talent Acquisition module"
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                            currentAuth === 'TALENT_ACQUISITION'
                              ? 'bg-[#FA7014] text-white shadow-2xs'
                              : 'text-slate-600 hover:text-[#FA7014] hover:bg-white/60'
                          }`}
                        >
                          Talent Acq
                        </button>

                        {/* Option 3: DOCUMENT VERSION CONTROL */}
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateAuthorization(user, 'DOCUMENT_VERSION_CONTROL')
                          }
                          title="Authorized ONLY for Document Version Control module"
                          className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                            currentAuth === 'DOCUMENT_VERSION_CONTROL'
                              ? 'bg-emerald-600 text-white shadow-2xs'
                              : 'text-slate-600 hover:text-emerald-700 hover:bg-white/60'
                          }`}
                        >
                          Doc Version
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-100 p-4 border-t border-slate-200 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Changes are written directly to Firestore and take effect immediately.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
