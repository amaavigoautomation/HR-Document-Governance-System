import React, { useState } from 'react';
import {
  X,
  MessageSquarePlus,
  Send,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  FileText,
  User as UserIcon,
  Tag,
  Clock,
  ChevronRight,
  Info,
} from 'lucide-react';
import { DocumentMaster, DocumentSuggestion, SuggestionCategory, User } from '../types';
import { governanceEngine } from '../services/governance';
import { formatISTDate } from '../utils/dateFormat';

interface SubmitSuggestionModalProps {
  document: DocumentMaster;
  currentUser: User;
  onClose: () => void;
  onSuccess: (newSuggestion: DocumentSuggestion) => void;
}

const CATEGORY_OPTIONS: { value: SuggestionCategory; label: string; desc: string }[] = [
  {
    value: 'IMPROVEMENT',
    label: 'Process & Policy Improvement',
    desc: 'Streamline workflow, remove operational friction, or modernize rules',
  },
  {
    value: 'CLARITY',
    label: 'Clarity & Interpretation',
    desc: 'Clarify ambiguous language, definitions, or confusing clauses',
  },
  {
    value: 'OPERATIONAL',
    label: 'Operational Feedback',
    desc: 'Real-world practical constraints, edge cases, and field observations',
  },
  {
    value: 'TYPO_CORRECTION',
    label: 'Correction / Outdated Reference',
    desc: 'Fix typos, broken links, outdated tools, or inaccurate references',
  },
  {
    value: 'POLICY_CHANGE',
    label: 'Policy Addition / Modification',
    desc: 'Propose an amendment, updated entitlement, or standard protocol',
  },
  {
    value: 'GENERAL',
    label: 'General Constructive Feedback',
    desc: 'General thoughts or questions for the HR Policy Lead',
  },
];

export const SubmitSuggestionModal: React.FC<SubmitSuggestionModalProps> = ({
  document,
  currentUser,
  onClose,
  onSuccess,
}) => {
  const [category, setCategory] = useState<SuggestionCategory>('IMPROVEMENT');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Past suggestions submitted by this employee for this document
  const pastSuggestions = governanceEngine
    .getDocumentSuggestions(document.documentId)
    .filter(
      (s) =>
        s.employeeId.toLowerCase() === (currentUser.empId || currentUser.id).toLowerCase() ||
        s.employeeEmail.toLowerCase() === currentUser.email.toLowerCase()
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!document.active || document.currentStatus !== 'PUBLISHED') {
      setError('Suggestions can only be submitted for officially authorized and published policy documents.');
      return;
    }
    if (!subject.trim()) {
      setError('Please provide a subject line summarizing your suggestion.');
      return;
    }
    if (!content.trim() || content.trim().length < 15) {
      setError('Please provide detailed feedback with reasoning (minimum 15 characters).');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const created = await governanceEngine.submitDocumentSuggestion(currentUser, {
        documentId: document.documentId,
        category,
        subject: subject.trim(),
        content: content.trim(),
      });

      setSuccess(true);
      setTimeout(() => {
        onSuccess(created);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit suggestion.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
        {/* HEADER */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#FA7014]/20 border border-[#FA7014]/40 flex items-center justify-center text-[#FA7014] shrink-0">
              <MessageSquarePlus className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="font-mono text-[11px] font-bold text-[#FA7014] bg-white/10 px-2 py-0.5 rounded">
                  {document.documentId}
                </span>
                <span className="text-xs text-slate-300 font-medium">v{document.currentPublishedVersionNumber || '1.0'}</span>
              </div>
              <h2 className="text-base font-bold text-white truncate mt-0.5" title={document.title}>
                Suggest Improvement: {document.title}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 bg-white">
          {/* NOTICE BANNER */}
          <div className="bg-orange-50/70 border border-orange-200/80 rounded-2xl p-3.5 flex items-start space-x-3 text-xs text-slate-700">
            <Sparkles className="w-4 h-4 text-[#FA7014] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-900">Direct Input to HR & Leadership:</span> Your suggestions are directly routed to the HR Policy Authors and Founders. When this document undergoes its scheduled periodic re-review, all employee suggestions are reviewed and synthesized into upcoming revisions.
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 text-xs flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Thank you for your feedback!</h3>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                Your suggestion for <strong>{document.title}</strong> has been logged. The HR Governance team and Founder will review it and consider it for the next document revision.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* EMPLOYEE INFO PREVIEW */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <div className="flex items-center space-x-2">
                  <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    Submitting as: <strong className="text-slate-900">{currentUser.name}</strong> ({currentUser.email})
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 font-mono">
                  {currentUser.departmentName || 'General Staff'} • {currentUser.empId || currentUser.loginId}
                </div>
              </div>

              {/* CATEGORY SELECT */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="select-suggestion-category">
                  Suggestion Type <span className="text-[#FA7014]">*</span>
                </label>
                <select
                  id="select-suggestion-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SuggestionCategory)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white cursor-pointer font-medium"
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.desc}
                    </option>
                  ))}
                </select>
              </div>

              {/* SUBJECT INPUT */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="input-suggestion-subject">
                  Subject / Summary <span className="text-[#FA7014]">*</span>
                </label>
                <input
                  id="input-suggestion-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Increase core overlap flexibility for remote teams..."
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 font-medium"
                  required
                />
              </div>

              {/* CONTENT TEXTAREA */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider" htmlFor="textarea-suggestion-content">
                    Detailed Suggestion & Reasoning <span className="text-[#FA7014]">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {content.length} characters (min 15)
                  </span>
                </div>
                <textarea
                  id="textarea-suggestion-content"
                  rows={4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Describe your suggestion in detail. What is working well? What needs improvement or clarity? How would this change benefit your team and the organization?"
                  className="w-full text-xs p-3 bg-slate-50 border border-slate-200 text-slate-900 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 leading-relaxed font-sans"
                  required
                />
              </div>

              {/* PREVIOUS SUGGESTIONS CALLOUT */}
              {pastSuggestions.length > 0 && (
                <div className="pt-2">
                  <span className="text-[11px] font-bold text-slate-600 block mb-2">
                    Your previous suggestions for this document ({pastSuggestions.length}):
                  </span>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                    {pastSuggestions.map((ps) => (
                      <div
                        key={ps.id}
                        className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-800 truncate block">
                            {ps.subject}
                          </span>
                          <span className="text-slate-400 text-[10px]">
                            {formatISTDate(ps.createdAt)} • {ps.category}
                          </span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                          ps.status === 'ACCEPTED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : ps.status === 'INCORPORATED_IN_REVISION'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {ps.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ACTION BUTTONS */}
              <div className="pt-3 flex items-center justify-end space-x-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center space-x-2 bg-[#FA7014] hover:bg-[#E65A05] text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Submitting...' : 'Submit Suggestion to HR'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
