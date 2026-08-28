import React, { useState } from 'react';
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Search,
  Eye,
  GitBranch,
  ArrowRight,
  AlertTriangle,
  History,
  Layers,
  Sparkles,
  GitCompare,
} from 'lucide-react';
import { DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { StatusBadge } from './StatusBadge';

interface ReviewerDashboardProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  onOpenReviewModal: (version: DocumentVersion) => void;
  onOpenDocumentDetail: (doc: DocumentMaster) => void;
}

export const ReviewerDashboard: React.FC<ReviewerDashboardProps> = ({
  currentUser,
  documents,
  versions,
  onOpenReviewModal,
  onOpenDocumentDetail,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Queue of pending reviews
  const reviewQueue = versions.filter((v) => v.status === VersionStatus.IN_REVIEW);
  const approvedVersions = versions.filter((v) => v.status === VersionStatus.PUBLISHED);
  const rejectedVersions = versions.filter((v) => v.status === VersionStatus.REVISION_REQUIRED);

  const filteredQueue = reviewQueue.filter((v) => {
    const q = searchTerm.toLowerCase();
    return (
      v.documentTitle.toLowerCase().includes(q) ||
      v.documentId.toLowerCase().includes(q) ||
      v.createdByName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Reviewer Header */}
      <div className="glass-panel-dark rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold text-white tracking-tight">Approver & Governance Portal</h1>
            <span className="bg-emerald-500/15 text-emerald-300 text-xs px-3 py-0.5 rounded-full font-semibold border border-emerald-500/30">
              Authorized Approver Queue
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1.5">
            Logged in as <span className="font-semibold text-slate-200">{currentUser.name}</span> ({currentUser.title}) • Review pending policy submissions, inspect side-by-side version diffs, approve to auto-publish or return with mandatory governance notes.
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-emerald-950/60 border border-emerald-800/60 px-4 py-2.5 rounded-xl shadow-inner">
          <Clock className="w-5 h-5 text-emerald-400 animate-pulse" />
          <span className="text-xs font-bold text-emerald-300">
            {reviewQueue.length} {reviewQueue.length === 1 ? 'Document' : 'Documents'} Waiting for Review
          </span>
        </div>
      </div>

      {/* METRIC STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-amber-900/40">
          <div className="flex items-center justify-between text-amber-400 text-xs font-semibold uppercase tracking-wider">
            <span>Pending Review</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-amber-400">{reviewQueue.length}</div>
          <div className="text-[11px] text-amber-500/80 mt-1">Action Required</div>
        </div>

        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-emerald-900/40">
          <div className="flex items-center justify-between text-emerald-400 text-xs font-semibold uppercase tracking-wider">
            <span>Approved & Published</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-emerald-400">{approvedVersions.length}</div>
          <div className="text-[11px] text-emerald-500/80 mt-1">Live Operational Versions</div>
        </div>

        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-rose-900/40">
          <div className="flex items-center justify-between text-rose-400 text-xs font-semibold uppercase tracking-wider">
            <span>Revisions Requested</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-rose-400">{rejectedVersions.length}</div>
          <div className="text-[11px] text-rose-500/80 mt-1">Returned with Feedback</div>
        </div>

        <div className="glass-panel-dark p-5 rounded-2xl shadow-md border border-slate-800/80">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
            <span>Total Masters Monitored</span>
            <ShieldCheck className="w-4 h-4 text-blue-400" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-white">{documents.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Active Governance Registry</div>
        </div>
      </div>

      {/* PENDING REVIEW QUEUE SECTION */}
      <div className="glass-panel-dark rounded-2xl border border-emerald-500/40 shadow-xl overflow-hidden">
        <div className="px-6 py-4 bg-emerald-950/30 border-b border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <h2 className="text-base font-bold text-white">Pending Review Queue (Action Required)</h2>
              <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs px-2.5 py-0.5 rounded-full font-bold">
                {reviewQueue.length}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Reviewers inspect changed content against the current published baseline and make binding approval or rejection decisions.
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="search-review-queue"
              type="text"
              placeholder="Search queue..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 placeholder:text-slate-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800/80">
            <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th scope="col" className="px-6 py-3.5 text-left">Document ID & Title</th>
                <th scope="col" className="px-6 py-3.5 text-left">Submitted Version</th>
                <th scope="col" className="px-6 py-3.5 text-left">Baseline (Published)</th>
                <th scope="col" className="px-6 py-3.5 text-left">Creator</th>
                <th scope="col" className="px-6 py-3.5 text-left">Change Type & Summary</th>
                <th scope="col" className="px-6 py-3.5 text-left">Submission Date</th>
                <th scope="col" className="px-6 py-3.5 text-right">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {filteredQueue.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
                    All clear! No documents are currently pending reviewer action.
                  </td>
                </tr>
              ) : (
                filteredQueue.map((ver) => {
                  const parentMaster = documents.find((d) => d.id === ver.documentMasterId);
                  return (
                    <tr key={ver.id} className="hover:bg-emerald-950/20 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-mono text-xs font-bold text-blue-300 bg-blue-950/60 px-2.5 py-0.5 rounded-lg inline-block border border-blue-800/60 mb-1">
                          {ver.documentId}
                        </div>
                        <div className="font-semibold text-white">{ver.documentTitle}</div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-bold text-xs text-amber-300 bg-amber-950/60 border border-amber-800/60 px-2.5 py-1 rounded-lg">
                          v{ver.versionNumber}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        {ver.previousVersionNumber ? (
                          <span className="font-medium text-xs text-slate-300 bg-slate-800 px-2 py-1 rounded-md border border-slate-700">
                            v{ver.previousVersionNumber} (Baseline)
                          </span>
                        ) : parentMaster?.currentPublishedVersionNumber ? (
                          <span className="font-medium text-xs text-slate-300 bg-slate-800 px-2 py-1 rounded-md border border-slate-700">
                            v{parentMaster.currentPublishedVersionNumber} (Published)
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500 italic">Initial Document</span>
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-xs font-semibold text-slate-200">{ver.createdByName}</div>
                        <div className="text-[11px] text-slate-500">HR Operations</div>
                      </td>

                      <td className="px-6 py-4 max-w-xs">
                        <span className="text-xs font-semibold uppercase tracking-wider text-blue-300 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/50">
                          {ver.versionType}
                        </span>
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2" title={ver.changeSummary}>
                          {ver.changeSummary || 'No change summary provided.'}
                        </p>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-400">
                        {new Date(ver.createdAt).toLocaleDateString()}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          id={`btn-review-${ver.id}`}
                          onClick={() => onOpenReviewModal(ver)}
                          className="inline-flex items-center space-x-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs px-4 py-2 rounded-xl shadow-md shadow-emerald-900/30 transition-all hover:scale-[1.02] border border-emerald-400/30"
                        >
                          <GitCompare className="w-3.5 h-3.5" />
                          <span>Review & Decide</span>
                          <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ALL DOCUMENTS GOVERNANCE DIRECTORY */}
      <div className="glass-panel-dark rounded-2xl border border-slate-800/80 shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">All Document Masters & Published Status</h2>
            <p className="text-xs text-slate-400">Comprehensive overview of all logical document records and active version numbers.</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-800/80">
            <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase tracking-wider font-semibold">
              <tr>
                <th scope="col" className="px-6 py-3 text-left">Document ID</th>
                <th scope="col" className="px-6 py-3 text-left">Title</th>
                <th scope="col" className="px-6 py-3 text-left">Category</th>
                <th scope="col" className="px-6 py-3 text-left">Published Version</th>
                <th scope="col" className="px-6 py-3 text-left">Status</th>
                <th scope="col" className="px-6 py-3 text-left">Confidentiality</th>
                <th scope="col" className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {documents.map((doc) => {
                const docVers = versions.filter((v) => v.documentMasterId === doc.id);
                return (
                  <tr key={doc.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-6 py-3.5 whitespace-nowrap font-mono text-xs font-bold text-blue-300">
                      {doc.documentId}
                    </td>
                    <td className="px-6 py-3.5 font-semibold text-white">{doc.title}</td>
                    <td className="px-6 py-3.5 text-xs text-slate-400">{doc.category}</td>
                    <td className="px-6 py-3.5 whitespace-nowrap">
                      {doc.currentPublishedVersionNumber ? (
                        <span className="font-bold text-xs text-emerald-300 bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-800/60">
                          v{doc.currentPublishedVersionNumber} (Live)
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500 italic">None</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 whitespace-nowrap">
                      <StatusBadge status={doc.currentStatus} size="sm" />
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-400">{doc.confidentiality}</td>
                    <td className="px-6 py-3.5 text-right">
                      <button
                        id={`btn-reviewer-view-${doc.id}`}
                        onClick={() => onOpenDocumentDetail(doc)}
                        className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition-colors border border-slate-700"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Audit Timeline ({docVers.length})</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
