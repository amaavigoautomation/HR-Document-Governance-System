import React, { useState, useMemo, useEffect } from 'react';
import {
  MessageSquare,
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Mail,
  Send,
  Calendar,
  Layers,
  FileText,
  User as UserIcon,
  ChevronDown,
  ChevronRight,
  GitBranch,
  RefreshCw,
  Inbox,
  AlertCircle,
  BellRing,
} from 'lucide-react';
import {
  DocumentMaster,
  DocumentSuggestion,
  DocumentVersion,
  SuggestionCategory,
  SuggestionStatus,
  User,
  UserRole,
  VersionStatus,
} from '../types';
import { governanceEngine } from '../services/governance';
import { formatISTDate } from '../utils/dateFormat';
import { formatDDMMYYYY } from '../utils/documentHeaderFooter';

interface PolicySuggestionsDashboardProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  suggestions?: DocumentSuggestion[];
  onOpenCreateVersion?: (doc: DocumentMaster) => void;
  onOpenDocumentDetail?: (doc: DocumentMaster) => void;
  onRefreshData?: () => void;
}

const CATEGORY_COLORS: Record<SuggestionCategory, { bg: string; text: string; border: string }> = {
  IMPROVEMENT: { bg: 'bg-orange-50', text: 'text-[#FA7014]', border: 'border-orange-200' },
  CLARITY: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  OPERATIONAL: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  TYPO_CORRECTION: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  POLICY_CHANGE: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  GENERAL: { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' },
};

const STATUS_CONFIG: Record<SuggestionStatus, { label: string; bg: string; text: string; border: string }> = {
  PENDING_REVIEW: { label: 'Pending Review', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  REVIEWED: { label: 'Reviewed', bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-200' },
  ACCEPTED: { label: 'Accepted for Revision', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' },
  INCORPORATED_IN_REVISION: { label: 'Incorporated in Draft', bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
  DISMISSED: { label: 'Dismissed', bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200' },
};

export const PolicySuggestionsDashboard: React.FC<PolicySuggestionsDashboardProps> = ({
  currentUser,
  documents,
  versions,
  suggestions: propSuggestions,
  onOpenCreateVersion,
  onOpenDocumentDetail,
  onRefreshData,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDocFilter, setSelectedDocFilter] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'grouped' | 'feed'>('grouped');

  // Expanded document sections
  const [expandedDocIds, setExpandedDocIds] = useState<Record<string, boolean>>({});

  // Re-review reminder trigger state
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<{
    sentCount: number;
    checkedDocs: number;
    details: string[];
  } | null>(null);

  // Only officially AUTHORIZED & PUBLISHED documents can receive suggestions or appear in Policy Suggestions
  // Drafts, in-review versions, and documents awaiting approver action must NEVER appear here
  const publishedDocuments = useMemo(() => {
    return documents.filter((d) => {
      if (!d.active) return false;
      if (d.currentStatus !== VersionStatus.PUBLISHED) return false;
      const hasPublishedVersion =
        Boolean(d.currentPublishedVersionId) ||
        versions.some(
          (v) =>
            (v.documentMasterId === d.id || v.documentId === d.documentId) &&
            v.status === VersionStatus.PUBLISHED
        );
      return hasPublishedVersion;
    });
  }, [documents, versions]);

  // Set of all active, published document IDs and logical IDs
  const publishedDocIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    publishedDocuments.forEach((d) => {
      if (d.id) ids.add(d.id.toLowerCase().trim());
      if (d.documentId) ids.add(d.documentId.toLowerCase().trim());
    });
    return ids;
  }, [publishedDocuments]);

  // Suggestions list from governanceEngine or props, strictly filtered to only published documents
  // Drafts, pending review, or deleted documents are completely excluded
  const allSuggestions = useMemo(() => {
    const raw =
      propSuggestions !== undefined
        ? propSuggestions
        : governanceEngine.getDocumentSuggestions();

    return raw.filter((s) => {
      const docLogicalId = (s.documentId || '').toLowerCase().trim();
      const docMasterId = (s.documentMasterId || '').toLowerCase().trim();
      return (
        (docLogicalId && publishedDocIdentifiers.has(docLogicalId)) ||
        (docMasterId && publishedDocIdentifiers.has(docMasterId))
      );
    });
  }, [propSuggestions, publishedDocIdentifiers]);

  // Auto-reset document filter if the selected document is not in published documents
  useEffect(() => {
    if (selectedDocFilter !== 'ALL') {
      const exists = publishedDocuments.some(
        (d) =>
          d.documentId.toLowerCase().trim() === selectedDocFilter.toLowerCase().trim() ||
          d.id.toLowerCase().trim() === selectedDocFilter.toLowerCase().trim()
      );
      if (!exists) {
        setSelectedDocFilter('ALL');
      }
    }
  }, [publishedDocuments, selectedDocFilter]);

  const toggleDocExpand = (docId: string) => {
    setExpandedDocIds((prev) => ({
      ...prev,
      [docId]: !prev[docId],
    }));
  };

  // Re-review date calculation for each published document
  const docsWithReReviewInfo = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return publishedDocuments
      .map((doc) => {
        const pubVer = versions.find((v) => v.id === doc.currentPublishedVersionId) ||
          versions.find((v) => v.documentMasterId === doc.id && v.status === VersionStatus.PUBLISHED);

        const reviewDateStr = pubVer?.reviewDueDate;
        let daysUntilReReview: number | null = null;
        let isDueInTwoDays = false;
        let isPastDue = false;

        if (reviewDateStr) {
          const rDate = new Date(reviewDateStr);
          rDate.setHours(0, 0, 0, 0);
          const diffMs = rDate.getTime() - today.getTime();
          daysUntilReReview = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          isDueInTwoDays = daysUntilReReview <= 2 && daysUntilReReview >= 0;
          isPastDue = daysUntilReReview < 0;
        }

        const docSugs = allSuggestions.filter(
          (s) => s.documentId.toLowerCase() === doc.documentId.toLowerCase() || s.documentMasterId === doc.id
        );

        return {
          doc,
          pubVer,
          reviewDateStr,
          daysUntilReReview,
          isDueInTwoDays,
          isPastDue,
          suggestionsCount: docSugs.length,
        };
      });
  }, [publishedDocuments, versions, allSuggestions]);

  // Documents due soon (within 2 days or past due)
  const upcomingReReviews = useMemo(() => {
    return docsWithReReviewInfo.filter((item) => item.isDueInTwoDays || item.isPastDue);
  }, [docsWithReReviewInfo]);

  // Filtered Suggestions (Search, Document filter, Category filter)
  const filteredSuggestions = useMemo(() => {
    return allSuggestions.filter((sug) => {
      const matchesSearch =
        sug.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sug.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sug.documentId.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sug.documentTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
        sug.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (sug.employeeDepartment || '').toLowerCase().includes(searchTerm.toLowerCase());

      const matchesDoc = selectedDocFilter === 'ALL' || sug.documentId === selectedDocFilter;
      const matchesCategory = selectedCategory === 'ALL' || sug.category === selectedCategory;

      return matchesSearch && matchesDoc && matchesCategory;
    });
  }, [allSuggestions, searchTerm, selectedDocFilter, selectedCategory]);

  // Grouped suggestions by document ID (strictly for published documents)
  const suggestionsByDoc = useMemo(() => {
    const map = new Map<string, { doc: DocumentMaster; suggestions: DocumentSuggestion[] }>();

    for (const d of publishedDocuments) {
      map.set(d.documentId, { doc: d, suggestions: [] });
    }

    for (const sug of filteredSuggestions) {
      const matchingDoc = publishedDocuments.find(
        (d) =>
          d.documentId.toLowerCase().trim() === (sug.documentId || '').toLowerCase().trim() ||
          (sug.documentMasterId && d.id === sug.documentMasterId)
      );
      if (matchingDoc && map.has(matchingDoc.documentId)) {
        map.get(matchingDoc.documentId)!.suggestions.push(sug);
      }
    }

    return Array.from(map.entries()).filter(([_, entry]) => {
      if (selectedDocFilter !== 'ALL') {
        return entry.doc.documentId === selectedDocFilter;
      }
      return true;
    });
  }, [filteredSuggestions, publishedDocuments, selectedDocFilter]);

  // Metrics
  const totalSuggestions = allSuggestions.length;
  const docsWithSuggestionsCount = new Set(allSuggestions.map((s) => s.documentId)).size;
  const distinctCategoriesCount = new Set(allSuggestions.map((s) => s.category)).size;

  // Dispatch 2-Day Re-Review Reminder emails
  const handleDispatchReminders = async (force: boolean = false) => {
    setDispatching(true);
    setDispatchResult(null);
    try {
      const result = await governanceEngine.checkAndDispatchReReviewReminders({ force });
      setDispatchResult(result);
      onRefreshData?.();
    } catch (e: any) {
      alert(`Error dispatching re-review reminders: ${e.message}`);
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* HEADER & TITLE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#FA7014] bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
              Employee Feedback & Governance Lifecycle
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-[#FA7014]" />
            <span>Policy Suggestions & Re-Review Tracker</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Real-time feed of employee feedback, clarity requests, and suggestions across company policies. Automated 2-day reminder emails synthesize these suggestions directly to HR prior to scheduled re-review dates.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2.5 shrink-0">
          <button
            type="button"
            onClick={() => handleDispatchReminders(true)}
            disabled={dispatching}
            className="inline-flex items-center space-x-2 bg-gradient-to-r from-slate-900 to-slate-800 hover:from-slate-800 hover:to-slate-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm hover:shadow-md cursor-pointer disabled:opacity-50"
            title="Dispatch 2-day re-review notification emails with employee feedback to HR"
          >
            <Mail className="w-3.5 h-3.5 text-[#FA7014]" />
            <span>{dispatching ? 'Dispatching...' : 'Dispatch Re-Review Email to HR'}</span>
          </button>

          {onRefreshData && (
            <button
              type="button"
              onClick={onRefreshData}
              className="p-2 bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors shadow-2xs cursor-pointer"
              title="Refresh suggestions data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* DISPATCH RESULT BANNER */}
      {dispatchResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-xs text-emerald-950 space-y-2 animate-fade-in shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 font-bold text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>
                Automated 2-Day Re-Review Check Complete: {dispatchResult.sentCount} Email(s) Dispatched
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDispatchResult(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-semibold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
          {dispatchResult.details.length > 0 ? (
            <ul className="list-disc list-inside space-y-1 text-emerald-800 pl-1 text-[11px]">
              {dispatchResult.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-emerald-800">
              All published documents are up to date. No documents are currently within the 2-day re-review window.
            </p>
          )}
        </div>
      )}

      {/* TOP METRICS SUMMARY */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Total Suggestions
            </span>
            <div className="w-8 h-8 rounded-xl bg-orange-50 text-[#FA7014] flex items-center justify-center">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2">{totalSuggestions}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">Across {docsWithSuggestionsCount} policies</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Policies With Feedback
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-blue-700 mt-2">{docsWithSuggestionsCount}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">Active documents receiving input</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Due in ≤ 2 Days
            </span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-rose-700 mt-2">{upcomingReReviews.length}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">Scheduled periodic re-reviews</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Feedback Categories
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-700 mt-2">{distinctCategoriesCount}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">Diverse improvement areas</p>
        </div>
      </div>

      {/* 2-DAY RE-REVIEW AUTOMATED REMINDER CARD */}
      <div className="bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-white border-2 border-orange-200 rounded-3xl p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start space-x-3.5">
            <div className="w-10 h-10 rounded-2xl bg-[#FA7014] text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
              <BellRing className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-black uppercase tracking-wider text-[#FA7014]">
                  Automated Re-Review Reminder Protocol
                </span>
                <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded-full border border-orange-200 text-slate-700 font-semibold">
                  T-2 Days Notification Rule
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                Pre-Review Employee Feedback Synthesis
              </h3>
              <p className="text-xs text-slate-600 mt-1 max-w-3xl leading-relaxed">
                Before 2 days of a document's scheduled <strong>Re-review Date</strong>, the system triggers an automated email notification to all HR team members. If employees have submitted suggestions, they are compiled line-by-line; if no feedback has been submitted, the email clearly communicates <em>"No suggestions from employees have been submitted for this document"</em> so HR has full visibility before drafting revisions.
              </p>
            </div>
          </div>

          <div className="shrink-0 flex items-center space-x-2">
            <button
              type="button"
              onClick={() => handleDispatchReminders(false)}
              disabled={dispatching}
              className="inline-flex items-center space-x-2 bg-white hover:bg-orange-50 text-[#FA7014] border border-orange-200 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-2xs hover:shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Run Automated 2-Day Check</span>
            </button>
          </div>
        </div>

        {/* UPCOMING RE-REVIEWS SUMMARY STRIP */}
        {docsWithReReviewInfo.length > 0 && (
          <div className="mt-4 pt-4 border-t border-orange-200/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {docsWithReReviewInfo.slice(0, 3).map((item) => (
              <div
                key={item.doc.id}
                className="bg-white/80 border border-slate-200/80 rounded-xl p-2.5 flex items-center justify-between text-xs"
              >
                <div className="min-w-0 pr-2">
                  <span className="font-bold text-slate-900 block truncate" title={item.doc.title}>
                    {item.doc.documentId} — {item.doc.title}
                  </span>
                  <span className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    Re-review: {formatDDMMYYYY(item.reviewDateStr, 'Not set')}
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      item.isDueInTwoDays
                        ? 'bg-rose-100 text-rose-800'
                        : item.isPastDue
                        ? 'bg-red-100 text-red-800'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {item.daysUntilReReview !== null
                      ? item.daysUntilReReview === 0
                        ? 'Due Today'
                        : item.daysUntilReReview < 0
                        ? `${Math.abs(item.daysUntilReReview)}d overdue`
                        : `In ${item.daysUntilReReview}d`
                      : 'Annual'}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    {item.suggestionsCount} suggestion(s)
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FILTER & VIEW CONTROLS */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex-1 flex flex-wrap items-center gap-2.5">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search suggestions, documents, employees, keywords..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 transition-colors"
            />
          </div>

          {/* Document Filter (Published Documents Only) */}
          <select
            value={selectedDocFilter}
            onChange={(e) => setSelectedDocFilter(e.target.value)}
            className="text-xs p-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] cursor-pointer"
          >
            <option value="ALL">All Published Documents</option>
            {publishedDocuments.map((d) => (
              <option key={d.id} value={d.documentId}>
                {d.documentId} — {d.title}
              </option>
            ))}
          </select>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="text-xs p-2 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            <option value="IMPROVEMENT">Process Improvement</option>
            <option value="CLARITY">Clarity & Terms</option>
            <option value="OPERATIONAL">Operational</option>
            <option value="TYPO_CORRECTION">Correction / Outdated</option>
            <option value="POLICY_CHANGE">Policy Change</option>
            <option value="GENERAL">General</option>
          </select>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('grouped')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'grouped' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Group by Document
          </button>
          <button
            type="button"
            onClick={() => setViewMode('feed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              viewMode === 'feed' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Suggestions ({filteredSuggestions.length})
          </button>
        </div>
      </div>

      {/* VIEW MODE 1: GROUPED BY DOCUMENT */}
      {viewMode === 'grouped' && (
        <div className="space-y-4">
          {suggestionsByDoc.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
              <Inbox className="w-12 h-12 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-700">
                {publishedDocuments.length === 0 ? 'No published policy documents yet' : 'No suggestions match your filters'}
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                {publishedDocuments.length === 0
                  ? 'Documents must be authorized and published by an Approver before appearing here for employee suggestions.'
                  : 'Try clearing your search term or adjusting filters.'}
              </p>
            </div>
          ) : (
            suggestionsByDoc.map(([docId, entry]) => {
              const doc = entry.doc || publishedDocuments.find((d) => d.documentId === docId);
              const sugs = entry.suggestions;
              const isExpanded = expandedDocIds[docId] ?? (sugs.length > 0);

              const pubVer = versions.find((v) => v.id === doc?.currentPublishedVersionId) ||
                versions.find((v) => v.documentMasterId === doc?.id && v.status === VersionStatus.PUBLISHED);

              return (
                <div
                  key={docId}
                  className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden transition-all"
                >
                  {/* DOCUMENT CARD HEADER */}
                  <div
                    onClick={() => toggleDocExpand(docId)}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/60 hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-200/80"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <button
                        type="button"
                        className="text-slate-400 hover:text-slate-600 transition-transform"
                      >
                        {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs font-bold text-slate-900 bg-white border border-slate-200 px-2.5 py-0.5 rounded-md shadow-2xs">
                            {docId}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-500">
                            {doc?.category || 'Policy'}
                          </span>
                          <span className="text-[11px] text-slate-400">•</span>
                          <span className="text-[11px] text-slate-600 font-medium truncate">
                            {doc?.departmentName || 'All Department'}
                          </span>
                        </div>
                        <h2 className="text-sm font-bold text-slate-900 truncate mt-1" title={doc?.title || docId}>
                          {doc?.title || docId}
                        </h2>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0 self-end sm:self-center">
                      {/* Re-review date */}
                      {pubVer?.reviewDueDate && (
                        <div className="text-right hidden md:block">
                          <span className="text-[10px] text-slate-400 uppercase font-bold block">
                            Re-review Due Date
                          </span>
                          <span className="text-xs font-semibold text-slate-700 font-mono">
                            {formatDDMMYYYY(pubVer.reviewDueDate)}
                          </span>
                        </div>
                      )}

                      {/* Suggestions count badge */}
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center space-x-1.5 ${
                        sugs.length > 0 ? 'bg-orange-100 text-[#FA7014]' : 'bg-slate-100 text-slate-500'
                      }`}>
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{sugs.length} Suggestion{sugs.length === 1 ? '' : 's'}</span>
                      </span>

                      {/* Quick Revise Action for HR */}
                      {doc && onOpenCreateVersion && (currentUser.role === UserRole.CREATOR || currentUser.role === UserRole.REVIEWER) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenCreateVersion(doc);
                          }}
                          className="inline-flex items-center space-x-1 text-xs font-bold bg-[#FA7014] hover:bg-[#E65A05] text-white px-3 py-1.5 rounded-xl transition-all shadow-2xs cursor-pointer"
                          title="Author next revision incorporating employee suggestions"
                        >
                          <GitBranch className="w-3.5 h-3.5" />
                          <span>Revise Document</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* SUGGESTIONS LIST FOR THIS DOCUMENT */}
                  {isExpanded && (
                    <div className="p-4 sm:p-5 space-y-4 bg-white">
                      {sugs.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 text-xs">
                          <p>No employee suggestions recorded for this document yet.</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Employees can submit suggestions from the Employee Portal.
                          </p>
                        </div>
                      ) : (
                        sugs.map((sug) => (
                          <SuggestionCard
                            key={sug.id}
                            suggestion={sug}
                            currentUser={currentUser}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* VIEW MODE 2: CHRONOLOGICAL FEED */}
      {viewMode === 'feed' && (
        <div className="space-y-4">
          {filteredSuggestions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
              <Inbox className="w-12 h-12 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-700">No suggestions match your filters</p>
              <p className="text-xs text-slate-400 mt-1">Try clearing your search term or adjusting filters.</p>
            </div>
          ) : (
            filteredSuggestions.map((sug) => (
              <SuggestionCard
                key={sug.id}
                suggestion={sug}
                currentUser={currentUser}
                showDocumentHeader={true}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// Reusable individual suggestion card component (View-Only for HR & Founder)
interface SuggestionCardProps {
  suggestion: DocumentSuggestion;
  currentUser?: User;
  showDocumentHeader?: boolean;
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  showDocumentHeader,
}) => {
  const catStyle = CATEGORY_COLORS[suggestion.category] || CATEGORY_COLORS.GENERAL;

  return (
    <div className="bg-slate-50/70 border border-slate-200/90 rounded-2xl p-4 sm:p-5 space-y-3 shadow-2xs hover:border-slate-300 transition-colors">
      {/* CARD TOP INFO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {showDocumentHeader && (
            <span className="font-mono text-xs font-bold text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded">
              {suggestion.documentId}
            </span>
          )}

          <span
            className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}
          >
            {suggestion.category.replace(/_/g, ' ')}
          </span>

          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
            Employee Suggestion
          </span>
        </div>

        <div className="text-[11px] text-slate-400 font-mono">
          Submitted {formatISTDate(suggestion.createdAt)}
        </div>
      </div>

      {/* SUBJECT & CONTENT */}
      <div>
        <h4 className="text-sm font-bold text-slate-900 leading-snug">{suggestion.subject}</h4>
        <p className="text-xs text-slate-700 mt-1.5 leading-relaxed bg-white p-3.5 rounded-xl border border-slate-200/80 whitespace-pre-line font-sans shadow-2xs">
          "{suggestion.content}"
        </p>
      </div>

      {/* EMPLOYEE INFO FOOTER */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-2 border-t border-slate-200/60">
        <div className="flex items-center space-x-2">
          <div className="w-5 h-5 rounded-full bg-orange-100 text-[#FA7014] flex items-center justify-center text-[10px] font-bold">
            {suggestion.employeeName.charAt(0)}
          </div>
          <span>
            Submitted by <strong className="text-slate-800">{suggestion.employeeName}</strong> (
            {suggestion.employeeDepartment || 'General'} • {suggestion.employeeId})
          </span>
        </div>
      </div>
    </div>
  );
};
