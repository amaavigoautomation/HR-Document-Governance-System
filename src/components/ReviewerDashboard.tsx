import React, { useState, useMemo } from 'react';
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
  Users,
  ChevronRight,
  Lock,
  Filter,
  Check,
  Building,
  Calendar,
  Download,
  Loader2,
} from 'lucide-react';
import { ConfidentialityLevel, DocumentCategory, DocumentMaster, DocumentVersion, User, VersionStatus } from '../types';
import { StatusBadge } from './StatusBadge';
import { governanceEngine } from '../services/governance';
import { formatISTDate } from '../utils/dateFormat';
import { formatDDMMYYYY } from '../utils/documentHeaderFooter';
import { downloadDocumentWithIntactFormat } from '../utils/documentStamper';

interface ReviewerDashboardProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  users?: User[];
  onOpenReviewModal: (version: DocumentVersion) => void;
  onOpenDocumentDetail: (doc: DocumentMaster) => void;
  onOpenComplianceTracker?: () => void;
}

export const ReviewerDashboard: React.FC<ReviewerDashboardProps> = ({
  currentUser,
  documents,
  versions,
  users,
  onOpenReviewModal,
  onOpenDocumentDetail,
  onOpenComplianceTracker,
}) => {
  const [activeView, setActiveView] = useState<'queue' | 'consolidated' | 'history'>('queue');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);

  // Helper to dynamically resolve creator name and job title from active users directory or metadata
  const resolveCreator = (ver: DocumentVersion, parentMaster?: DocumentMaster) => {
    const userList = users && users.length > 0 ? users : governanceEngine.getUsers();
    const matched = userList.find((u) => {
      if (
        ver.createdById &&
        (u.id === ver.createdById ||
          u.loginId?.toUpperCase() === ver.createdById.toUpperCase() ||
          u.empId?.toUpperCase() === ver.createdById.toUpperCase())
      ) {
        return true;
      }
      if (ver.createdByName && u.name.trim().toLowerCase() === ver.createdByName.trim().toLowerCase()) {
        return true;
      }
      if (
        parentMaster?.createdById &&
        (u.id === parentMaster.createdById ||
          u.loginId?.toUpperCase() === parentMaster.createdById.toUpperCase() ||
          u.empId?.toUpperCase() === parentMaster.createdById.toUpperCase())
      ) {
        return true;
      }
      if (parentMaster?.createdByName && u.name.trim().toLowerCase() === parentMaster.createdByName.trim().toLowerCase()) {
        return true;
      }
      return false;
    });

    const name = matched?.name || ver.createdByName || parentMaster?.createdByName || 'HR Author';
    const title =
      matched?.title ||
      ver.createdByTitle ||
      parentMaster?.createdByTitle ||
      (matched?.departmentName ? `${matched.departmentName} Author` : (parentMaster?.departmentName ? `${parentMaster.departmentName} Author` : 'Lead HR Operations & Document Specialist'));

    return { name, title, department: matched?.departmentName || parentMaster?.departmentName || 'Human Resources', user: matched };
  };

  const handleDownloadVersion = async (ver: DocumentVersion) => {
    try {
      setDownloadingVersionId(ver.id);
      const parentMaster = documents.find(
        (d) => d.id === ver.documentMasterId || d.documentId === ver.documentId
      );
      const creator = resolveCreator(ver, parentMaster);
      await downloadDocumentWithIntactFormat({
        fileName: ver.fileName || `${ver.documentId}_v${ver.versionNumber}.pdf`,
        documentTitle: ver.documentTitle || parentMaster?.title,
        versionNumber: ver.versionNumber,
        effectiveDate: formatDDMMYYYY(ver.effectiveFrom || ver.createdAt),
        createdByName: creator.name || ver.createdByName || 'Amee Shah',
        approvedByName:
          ver.status === VersionStatus.PUBLISHED
            ? (ver.reviewedByName || ver.publishedByName || 'Vishal Shah')
            : 'Not yet approved',
        approvedDate:
          ver.status === VersionStatus.PUBLISHED && (ver.reviewedAt || ver.publishedAt)
            ? formatDDMMYYYY(ver.reviewedAt || ver.publishedAt!)
            : 'Not yet approved',
        companyName: parentMaster?.companyName || 'Amaavigo',
        rawContent: ver.rawContent,
        fileUrl: ver.fileUrl || ver.originalFileUrl,
        originalFileUrl: ver.originalFileUrl || ver.fileUrl,
        versionId: ver.id,
        documentId: ver.documentId || parentMaster?.documentId || parentMaster?.id,
      });
    } catch (err) {
      console.error('Failed to download version in reviewer dashboard:', err);
    } finally {
      setDownloadingVersionId(null);
    }
  };

  // Queue of pending reviews (only versions that are actively IN_REVIEW and pending decision, sorted newest first)
  const reviewQueue = useMemo(() => {
    return versions
      .filter((v) => {
        if (v.status !== VersionStatus.IN_REVIEW) return false;
        if (v.reviewedAt || v.reviewedById) return false;
        const parentMaster = documents.find((d) => d.id === v.documentMasterId || d.documentId === v.documentId);
        if (parentMaster && parentMaster.currentPublishedVersionId === v.id) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [versions, documents]);

  const approvedVersions = useMemo(() => {
    return versions
      .filter((v) => v.status === VersionStatus.PUBLISHED || v.status === VersionStatus.SUPERSEDED)
      .sort((a, b) => new Date(b.reviewedAt || b.createdAt).getTime() - new Date(a.reviewedAt || a.createdAt).getTime());
  }, [versions]);

  const rejectedVersions = useMemo(() => {
    return versions
      .filter((v) => v.status === VersionStatus.REVISION_REQUIRED)
      .sort((a, b) => new Date(b.reviewedAt || b.createdAt).getTime() - new Date(a.reviewedAt || a.createdAt).getTime());
  }, [versions]);

  // Review history (all versions where decision has been rendered, sorted newest decision first)
  const decidedHistory = useMemo(() => {
    return versions
      .filter((v) => {
        if (v.status !== VersionStatus.IN_REVIEW || !!v.reviewedAt || !!v.reviewedById) return true;
        const parentMaster = documents.find((d) => d.id === v.documentMasterId || d.documentId === v.documentId);
        if (parentMaster && parentMaster.currentPublishedVersionId === v.id) return true;
        return false;
      })
      .sort((a, b) => new Date(b.reviewedAt || b.createdAt).getTime() - new Date(a.reviewedAt || a.createdAt).getTime());
  }, [versions, documents]);

  // Filtered Queue (supports searching by title, document ID, creator name, or creator title)
  const filteredQueue = useMemo(() => {
    return reviewQueue.filter((v) => {
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      const parentMaster = documents.find((d) => d.id === v.documentMasterId || d.documentId === v.documentId);
      const creator = resolveCreator(v, parentMaster);
      return (
        v.documentTitle.toLowerCase().includes(q) ||
        v.documentId.toLowerCase().includes(q) ||
        (v.createdByName && v.createdByName.toLowerCase().includes(q)) ||
        creator.name.toLowerCase().includes(q) ||
        creator.title.toLowerCase().includes(q) ||
        (v.changeSummary && v.changeSummary.toLowerCase().includes(q))
      );
    });
  }, [reviewQueue, searchTerm, documents, users]);

  // Consolidated documents list filter (sorted with newest documents & revisions on top)
  const filteredConsolidatedDocs = useMemo(() => {
    return documents
      .filter((doc) => {
        const q = searchTerm.toLowerCase();
        const matchesSearch =
          doc.title.toLowerCase().includes(q) ||
          doc.documentId.toLowerCase().includes(q) ||
          doc.departmentName.toLowerCase().includes(q) ||
          doc.category.toLowerCase().includes(q);

        const matchesCategory = selectedCategory === 'ALL' || doc.category === selectedCategory;
        const matchesDept = selectedDept === 'ALL' || doc.departmentName === selectedDept;
        const matchesStatus = selectedStatus === 'ALL' || doc.currentStatus === selectedStatus;

        return matchesSearch && matchesCategory && matchesDept && matchesStatus;
      })
      .sort((a, b) => {
        const aVersions = versions.filter(
          (v) => v.documentMasterId === a.id || v.documentId === a.documentId
        );
        const aVersionTimes = aVersions.map((v) => new Date(v.createdAt).getTime()).filter((t) => !isNaN(t));
        const aDocUpdate = new Date(a.updatedAt || a.createdAt).getTime();
        const aDocCreate = new Date(a.createdAt).getTime();
        const aLatest = Math.max(aDocUpdate || 0, aDocCreate || 0, ...aVersionTimes);

        const bVersions = versions.filter(
          (v) => v.documentMasterId === b.id || v.documentId === b.documentId
        );
        const bVersionTimes = bVersions.map((v) => new Date(v.createdAt).getTime()).filter((t) => !isNaN(t));
        const bDocUpdate = new Date(b.updatedAt || b.createdAt).getTime();
        const bDocCreate = new Date(b.createdAt).getTime();
        const bLatest = Math.max(bDocUpdate || 0, bDocCreate || 0, ...bVersionTimes);

        return bLatest - aLatest;
      });
  }, [documents, versions, searchTerm, selectedCategory, selectedDept, selectedStatus]);

  // Unique departments for filter
  const departments = useMemo(() => {
    const set = new Set<string>();
    documents.forEach((d) => {
      if (d.departmentName) set.add(d.departmentName);
    });
    return Array.from(set);
  }, [documents]);

  return (
    <div className="space-y-6">
      {/* Reviewer Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Approver & Governance Portal</h1>
            <span className="bg-[#FA7014]/10 text-[#FA7014] text-xs px-3 py-0.5 rounded-full font-semibold border border-[#FA7014]/30">
              Authorized Approver Queue
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1.5">
            Logged in as <span className="font-semibold text-slate-900">{currentUser.name}</span> ({currentUser.title}) • Review pending policy submissions, inspect side-by-side version diffs, approve to auto-publish or return with mandatory governance notes.
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-xl shadow-xs">
          <Clock className="w-5 h-5 text-[#FA7014]" />
          <span className="text-xs font-bold text-slate-900">
            {reviewQueue.length} {reviewQueue.length === 1 ? 'Document' : 'Documents'} Waiting for Review
          </span>
        </div>
      </div>

      {/* METRIC STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div
          onClick={() => setActiveView('queue')}
          className={`bg-white p-5 rounded-2xl shadow-sm border transition-all cursor-pointer ${
            activeView === 'queue' ? 'border-[#FA7014] ring-2 ring-[#FA7014]/20' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Pending Review</span>
            <Clock className="w-4 h-4 text-[#FA7014]" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-[#FA7014]">{reviewQueue.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Action Required</div>
        </div>

        <div
          onClick={() => setActiveView('history')}
          className={`bg-white p-5 rounded-2xl shadow-sm border transition-all cursor-pointer ${
            activeView === 'history' ? 'border-slate-900 ring-2 ring-slate-900/20' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Decisions Rendered</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{decidedHistory.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Immutable Finalized Decisions</div>
        </div>

        <div
          onClick={() => setActiveView('history')}
          className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200"
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Revisions Requested</span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{rejectedVersions.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Returned with Feedback</div>
        </div>

        <div
          onClick={() => setActiveView('consolidated')}
          className={`bg-white p-5 rounded-2xl shadow-sm border transition-all cursor-pointer ${
            activeView === 'consolidated' ? 'border-[#FA7014] ring-2 ring-[#FA7014]/20' : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 text-xs font-semibold uppercase tracking-wider">
            <span>Consolidated Repository</span>
            <ShieldCheck className="w-4 h-4 text-slate-900" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{documents.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">All Uploaded Documents</div>
        </div>
      </div>

      {/* EMPLOYEE COMPLIANCE BANNER */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-[#FA7014]/10 border border-[#FA7014]/20 flex items-center justify-center shrink-0 text-[#FA7014]">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Employee Compliance & Acknowledgement Radar</h3>
          </div>
        </div>

        {onOpenComplianceTracker && (
          <button
            id="btn-reviewer-goto-compliance"
            onClick={onOpenComplianceTracker}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-sm flex items-center space-x-1.5 transition-colors self-start sm:self-center shrink-0"
          >
            <span>Open Compliance Tracker</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* VIEW TABS SELECTOR */}
      <div className="flex items-center space-x-2 border-b border-slate-200 pb-2">
        <button
          id="tab-reviewer-queue"
          onClick={() => setActiveView('queue')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeView === 'queue'
              ? 'bg-[#FA7014] text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>Pending Review Queue ({reviewQueue.length})</span>
        </button>

        <button
          id="tab-reviewer-consolidated"
          onClick={() => setActiveView('consolidated')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeView === 'consolidated'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Consolidated Documents List ({documents.length})</span>
        </button>

        <button
          id="tab-reviewer-history"
          onClick={() => setActiveView('history')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeView === 'history'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Decision History ({decidedHistory.length})</span>
        </button>
      </div>

      {/* VIEW 1: PENDING REVIEW QUEUE */}
      {activeView === 'queue' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-[#FA7014]" />
                <h2 className="text-base font-bold text-slate-900">Pending Review Queue (Action Required)</h2>
                <span className="bg-[#FA7014]/10 text-[#FA7014] border border-[#FA7014]/30 text-xs px-2.5 py-0.5 rounded-full font-bold">
                  {reviewQueue.length}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Reviewers inspect changed content against the published baseline. Once decided, further decisions are locked to preserve audit integrity.
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
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-slate-700 text-xs uppercase tracking-wider font-semibold">
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
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredQueue.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-500" />
                      <p className="font-semibold text-slate-700">All clear!</p>
                      <p className="text-xs text-slate-500 mt-1">No documents are currently pending reviewer action. All submissions have received binding decisions.</p>
                    </td>
                  </tr>
                ) : (
                  filteredQueue.map((ver) => {
                    const parentMaster = documents.find((d) => d.id === ver.documentMasterId || d.documentId === ver.documentId);
                    const isDecided = ver.status !== VersionStatus.IN_REVIEW || !!ver.reviewedAt;
                    const creator = resolveCreator(ver, parentMaster);

                    return (
                      <tr key={ver.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg inline-block border border-slate-200">
                              {ver.documentId}
                            </span>
                            {parentMaster?.confidentiality === ConfidentialityLevel.INTERNAL ? (
                              <span className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md font-semibold">
                                🔒 Internal Company
                              </span>
                            ) : (
                              <span className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md font-semibold">
                                📢 Public (All Employees)
                              </span>
                            )}
                          </div>
                          <div className="font-semibold text-slate-900">{ver.documentTitle}</div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex flex-col items-start gap-1">
                            <span className="font-bold text-xs text-[#FA7014] bg-[#FA7014]/10 border border-[#FA7014]/25 px-2.5 py-1 rounded-lg">
                              v{ver.versionNumber}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono font-medium">
                              Eff: {formatDDMMYYYY(ver.effectiveFrom || ver.createdAt)}
                            </span>
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          {ver.previousVersionNumber && ver.previousVersionNumber !== ver.versionNumber ? (
                            <span className="font-medium text-xs text-slate-700 bg-slate-100 px-2 py-1 rounded-md border border-slate-200">
                              v{ver.previousVersionNumber} (Baseline)
                            </span>
                          ) : parentMaster?.currentPublishedVersionNumber && parentMaster.currentPublishedVersionNumber !== ver.versionNumber ? (
                            <span className="font-medium text-xs text-slate-700 bg-slate-100 px-2 py-1 rounded-md border border-slate-200">
                              v{parentMaster.currentPublishedVersionNumber} (Published)
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500 italic">Initial Baseline (None)</span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-xs font-semibold text-slate-900">{creator.name}</div>
                          <div className="text-[11px] text-slate-500 font-medium truncate max-w-[220px]" title={creator.title}>
                            {creator.title}
                          </div>
                        </td>

                        <td className="px-6 py-4 max-w-xs">
                          <span className="text-xs font-semibold uppercase tracking-wider text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {ver.versionType}
                          </span>
                          <p className="text-xs text-slate-600 mt-1 line-clamp-2" title={ver.changeSummary}>
                            {ver.changeSummary || 'No change summary provided.'}
                          </p>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                          {formatISTDate(ver.createdAt)}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              id={`btn-download-pending-${ver.id}`}
                              onClick={() => handleDownloadVersion(ver)}
                              disabled={downloadingVersionId === ver.id}
                              className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-100 border border-slate-300 px-3 py-2 rounded-xl transition-all cursor-pointer shadow-2xs disabled:opacity-60"
                              title={`Download Version v${ver.versionNumber}`}
                            >
                              {downloadingVersionId === ver.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA7014]" />
                              ) : (
                                <Download className="w-3.5 h-3.5 text-slate-600" />
                              )}
                              <span>Download</span>
                            </button>

                            {isDecided ? (
                              <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl">
                                <Lock className="w-3.5 h-3.5 text-slate-500" />
                                <span>Decision Given ({ver.status})</span>
                              </span>
                            ) : (
                              <button
                                id={`btn-review-${ver.id}`}
                                onClick={() => onOpenReviewModal(ver)}
                                className="inline-flex items-center space-x-1.5 bg-[#FA7014] hover:bg-[#E65A05] text-white font-semibold text-xs px-4 py-2 rounded-xl shadow-md shadow-[#FA7014]/20 transition-all border border-orange-500/30 cursor-pointer"
                              >
                                <GitCompare className="w-3.5 h-3.5" />
                                <span>Review & Decide</span>
                                <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 2: CONSOLIDATED DOCUMENTS LIST */}
      {activeView === 'consolidated' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <Layers className="w-5 h-5 text-slate-900" />
                  <h2 className="text-base font-bold text-slate-900">Consolidated Uploaded Documents Repository</h2>
                  <span className="bg-slate-200 text-slate-800 text-xs px-2.5 py-0.5 rounded-full font-bold">
                    {filteredConsolidatedDocs.length} Total
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Consolidated master registry of all policies, SOPs, and employee governance records across departments.
                </p>
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="search-consolidated-docs"
                  type="text"
                  placeholder="Search by ID, title, or department..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] placeholder:text-slate-400"
                />
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200 text-xs">
              <div className="flex items-center space-x-1.5 text-slate-500">
                <Filter className="w-3.5 h-3.5" />
                <span className="font-semibold">Filters:</span>
              </div>

              <select
                id="filter-category-approver"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#FA7014] cursor-pointer"
              >
                <option value="ALL">All Categories</option>
                {Object.values(DocumentCategory).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#FA7014]"
              >
                <option value="ALL">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-[#FA7014]"
              >
                <option value="ALL">All Statuses</option>
                <option value="PUBLISHED">Published / Live</option>
                <option value="IN_REVIEW">In Review</option>
                <option value="REVISION_REQUIRED">Revision Required</option>
                <option value="DRAFT">Draft</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-slate-700 text-xs uppercase tracking-wider font-semibold">
                <tr>
                  <th scope="col" className="px-6 py-3.5 text-left">Document ID</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Title & Category</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Department</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Live Version</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Governance Status</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Decision State</th>
                  <th scope="col" className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredConsolidatedDocs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      <FileText className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                      No documents found matching the filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredConsolidatedDocs.map((doc) => {
                    const docVers = versions.filter((v) => v.documentMasterId === doc.id);
                    const latestVer = docVers[0];
                    const hasPendingReview = docVers.some((v) => v.status === VersionStatus.IN_REVIEW && !v.reviewedAt);

                    return (
                      <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                            {doc.documentId}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900">{doc.title}</div>
                          <div className="text-xs text-slate-500 mt-1 flex items-center space-x-2">
                            <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px] font-medium text-slate-700 border border-slate-200">{doc.category}</span>
                            {doc.confidentiality === ConfidentialityLevel.INTERNAL ? (
                              <span className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded-md font-semibold">
                                🔒 Internal Company
                              </span>
                            ) : (
                              <span className="text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md font-semibold">
                                📢 Public (All Employees)
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-700">
                          {doc.departmentName}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          {doc.currentPublishedVersionNumber ? (
                            <span className="font-bold text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                              v{doc.currentPublishedVersionNumber} (Live)
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500 italic">No published version</span>
                          )}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <StatusBadge status={doc.currentStatus} size="sm" />
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          {hasPendingReview ? (
                            <span className="inline-flex items-center space-x-1 text-xs font-semibold text-[#FA7014] bg-[#FA7014]/10 border border-[#FA7014]/30 px-2.5 py-1 rounded-lg">
                              <Clock className="w-3.5 h-3.5 animate-pulse" />
                              <span>Pending Review</span>
                            </span>
                          ) : doc.currentStatus === VersionStatus.PUBLISHED ? (
                            <span className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-900 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg">
                              <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                              <span>Approved & Published</span>
                            </span>
                          ) : doc.currentStatus === VersionStatus.REVISION_REQUIRED ? (
                            <span className="inline-flex items-center space-x-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">
                              <XCircle className="w-3.5 h-3.5 text-rose-600" />
                              <span>Revision Requested</span>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">Draft Baseline</span>
                          )}
                        </td>

                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center space-x-2">
                            {hasPendingReview && (
                              <button
                                id={`btn-reviewer-consolidated-review-${doc.id}`}
                                onClick={() => {
                                  const pendingVer = docVers.find((v) => v.status === VersionStatus.IN_REVIEW);
                                  if (pendingVer) onOpenReviewModal(pendingVer);
                                }}
                                className="inline-flex items-center space-x-1 text-xs font-semibold text-white bg-[#FA7014] hover:bg-[#e0620f] px-3 py-1.5 rounded-lg transition-colors shadow-xs cursor-pointer"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>Review v{docVers.find((v) => v.status === VersionStatus.IN_REVIEW)?.versionNumber || ''}</span>
                              </button>
                            )}
                            <button
                              id={`btn-reviewer-consolidated-view-${doc.id}`}
                              onClick={() => onOpenDocumentDetail(doc)}
                              className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-800 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors border border-slate-200 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Audit & Versions ({docVers.length})</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 3: DECISIONS HISTORY */}
      {activeView === 'history' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <History className="w-5 h-5 text-slate-900" />
                <h2 className="text-base font-bold text-slate-900">Finalized Decisions & Audit Log</h2>
                <span className="bg-slate-200 text-slate-800 text-xs px-2.5 py-0.5 rounded-full font-bold">
                  {decidedHistory.length}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Permanent log of all approved, published, and returned versions. Decisions here are immutable and cannot be re-reviewed.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-slate-700 text-xs uppercase tracking-wider font-semibold">
                <tr>
                  <th scope="col" className="px-6 py-3.5 text-left">Document ID & Title</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Version</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Final Decision</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Decided By</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Decision Date</th>
                  <th scope="col" className="px-6 py-3.5 text-left">Comments / Notes</th>
                  <th scope="col" className="px-6 py-3.5 text-right">Inspection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {decidedHistory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      No decision records found yet.
                    </td>
                  </tr>
                ) : (
                  decidedHistory.map((ver) => (
                    <tr key={ver.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {ver.documentId}
                        </span>
                        <div className="font-semibold text-slate-900 mt-1">{ver.documentTitle}</div>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-bold text-xs text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
                          v{ver.versionNumber}
                        </span>
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap">
                        {ver.status === VersionStatus.PUBLISHED ? (
                          <span className="inline-flex items-center space-x-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                            <Check className="w-3.5 h-3.5 text-emerald-600 stroke-[3]" />
                            <span>Approved & Published</span>
                          </span>
                        ) : ver.status === VersionStatus.REVISION_REQUIRED ? (
                          <span className="inline-flex items-center space-x-1 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full">
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            <span>Revision Requested</span>
                          </span>
                        ) : (
                          <StatusBadge status={ver.status} size="sm" />
                        )}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-700">
                        {ver.reviewedByName || ver.publishedByName || 'Reviewer'}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                        {ver.reviewedAt ? formatISTDate(ver.reviewedAt) : formatISTDate(ver.createdAt)}
                      </td>

                      <td className="px-6 py-4 max-w-xs text-xs text-slate-600 line-clamp-2">
                        {ver.reviewerComments || ver.changeSummary || '—'}
                      </td>

                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <button
                            id={`btn-download-history-${ver.id}`}
                            onClick={() => handleDownloadVersion(ver)}
                            disabled={downloadingVersionId === ver.id}
                            className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-700 hover:text-slate-950 bg-white hover:bg-slate-100 border border-slate-300 px-2.5 py-1.5 rounded-lg transition-all cursor-pointer shadow-2xs disabled:opacity-60"
                            title={`Download Version v${ver.versionNumber}`}
                          >
                            {downloadingVersionId === ver.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FA7014]" />
                            ) : (
                              <Download className="w-3.5 h-3.5 text-slate-600" />
                            )}
                            <span>Download</span>
                          </button>
                          <button
                            onClick={() => onOpenReviewModal(ver)}
                            className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-800 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors border border-slate-200 cursor-pointer"
                          >
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                            <span>View Decision (Locked)</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
