import React, { useState } from 'react';
import { X, UserCheck, Mail, Briefcase, Building, User, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { User as UserType, UserRole } from '../types';
import { governanceEngine } from '../services/governance';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserType;
  onProfileUpdated: (updatedUser: UserType) => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onProfileUpdated,
}) => {
  const [name, setName] = useState(currentUser.name || '');
  const [title, setTitle] = useState(currentUser.title || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [departmentName, setDepartmentName] = useState(currentUser.departmentName || '');
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!name.trim() || !email.trim()) {
      setErrorMessage('Name and Email are required.');
      return;
    }

    setIsSaving(true);
    try {
      const updated: UserType = {
        ...currentUser,
        name: name.trim(),
        title: title.trim(),
        email: email.trim(),
        departmentName: departmentName.trim() || currentUser.departmentName,
        updatedAt: new Date().toISOString(),
      };

      await governanceEngine.updateUser(updated);
      onProfileUpdated(updated);
      setSuccessMessage('Profile updated and synchronized with Cloud Firestore.');
      setTimeout(() => {
        setIsSaving(false);
        onClose();
      }, 1000);
    } catch (err: any) {
      setIsSaving(false);
      setErrorMessage(err?.message || 'Failed to update profile. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#FA7014]/10 border border-[#FA7014]/30 flex items-center justify-center text-[#FA7014]">
              <UserCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Edit Profile & Account Information</h2>
              <p className="text-xs text-slate-500">
                {currentUser.role === UserRole.CREATOR
                  ? 'HR Creator Profile'
                  : currentUser.role === UserRole.REVIEWER
                  ? 'Approver / Governance Officer Profile'
                  : 'Employee Profile'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback notifications */}
        {successMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center space-x-2 text-xs font-semibold text-emerald-800">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-center space-x-2 text-xs font-semibold text-rose-800">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Full Name <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah Jenkins"
                className="w-full pl-10 pr-3.5 py-2 rounded-xl text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FA7014]/20 focus:border-[#FA7014]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Job Title / Role Title <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Briefcase className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Lead HR Operations & Document Specialist"
                className="w-full pl-10 pr-3.5 py-2 rounded-xl text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FA7014]/20 focus:border-[#FA7014]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Official Email Address <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. hr.operations@amaavigo.com"
                className="w-full pl-10 pr-3.5 py-2 rounded-xl text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FA7014]/20 focus:border-[#FA7014]"
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Used for governance emails, review notices, and audit stamps.</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Department
            </label>
            <div className="relative">
              <Building className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={departmentName}
                onChange={(e) => setDepartmentName(e.target.value)}
                placeholder="e.g. Human Resources"
                className="w-full pl-10 pr-3.5 py-2 rounded-xl text-sm border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#FA7014]/20 focus:border-[#FA7014]"
              />
            </div>
          </div>

          {/* User ID / System Info */}
          <div className="pt-2 pb-1 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Login ID: <strong className="font-mono text-slate-600">{currentUser.loginId || currentUser.id}</strong></span>
            <span>Cloud Sync: <strong className="text-emerald-600">Active (Firestore)</strong></span>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center space-x-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-[#FA7014] hover:bg-[#E05D07] transition-all shadow-md shadow-[#FA7014]/20 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Saving...' : 'Save & Sync Profile'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
