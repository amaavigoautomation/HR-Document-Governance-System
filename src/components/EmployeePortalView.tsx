import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Search,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  ShieldCheck,
  AlertCircle,
  Building,
  Check,
  ExternalLink,
  Layers,
  Filter,
  MessageSquarePlus,
} from 'lucide-react';
import {
  AcknowledgementRecord,
  ConfidentialityLevel,
  DocumentCategory,
  DocumentMaster,
  DocumentVersion,
  User,
  VersionStatus,
} from '../types';
import { governanceEngine, isEmployeeInDepartment } from '../services/governance';
import { formatISTDate } from '../utils/dateFormat';
import { formatDDMMYYYY } from '../utils/documentHeaderFooter';
import { downloadDocumentWithIntactFormat } from '../utils/documentStamper';
import { SubmitSuggestionModal } from './SubmitSuggestionModal';

interface EmployeePortalViewProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  acknowledgements?: AcknowledgementRecord[];
  onOpenDocumentView: (version: DocumentVersion) => void;
  activeTab?: 'acknowledgements' | 'all-documents';
  onTabChange?: (tab: 'acknowledgements' | 'all-documents') => void;
}

const isOfflineSignOff = (ack?: AcknowledgementRecord | null): boolean => {
  if (!ack) return false;
  if (ack.offlineSignOff === true || ack.signOffType === 'OFFLINE') return true;
  if (ack.signatureReference && ack.signatureReference.startsWith('MANUAL-ATTEST')) return true;
  const n = (ack.notes || '').toLowerCase();
  return n.includes('offline') || n.includes('manual') || n.includes('attested by') || n.includes('paper attestation');
};

export const EmployeePortalView: React.FC<EmployeePortalViewProps> = ({
  currentUser,
  documents,
  versions,
  acknowledgements,
  onOpenDocumentView,
  activeTab = 'acknowledgements',
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<'acknowledgements' | 'all-documents'>(activeTab);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [selectedDocForSuggestion, setSelectedDocForSuggestion] = useState<DocumentMaster | null>(null);
  const [suggestionSuccessMsg, setSuggestionSuccessMsg] = useState<string | null>(null);

  const [localAcks, setLocalAcks] = useState<AcknowledgementRecord[]>(() => {
    return acknowledgements && acknowledgements.length > 0
      ? acknowledgements
      : governanceEngine.getAcknowledgements();
  });

  useEffect(() => {
    if (activeTab) {
      setInternalTab(activeTab);
    }
  }, [activeTab]);

  const currentTab = activeTab || internalTab;
  const setTab = (tab: 'acknowledgements' | 'all-documents') => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  useEffect(() => {
    if (acknowledgements && acknowledgements.length > 0) {
      setLocalAcks(acknowledgements);
    } else {
      setLocalAcks(governanceEngine.getAcknowledgements());
    }
  }, [acknowledgements, documents, versions, currentUser]);

  // Employee only sees PUBLISHED documents that are:
  // 1. Public (All Employees)
  // 2. Specific Department matching the current employee's department
  // Internal Company documents are strictly restricted to HR & Approvers
  const publishedDocs = useMemo(() => {
    return documents.filter((d) => {
      if (!d.active || d.currentStatus !== VersionStatus.PUBLISHED) return false;
      const hasPublishedVersion =
        Boolean(d.currentPublishedVersionId) ||
        versions.some(
          (v) =>
            (v.documentMasterId === d.id || v.documentId === d.documentId) &&
            v.status === VersionStatus.PUBLISHED
        );
      if (!hasPublishedVersion) return false;
      if (d.confidentiality === ConfidentialityLevel.PUBLIC) return true;
      if (d.confidentiality === ConfidentialityLevel.SPECIFIC_DEPARTMENT) {
        return isEmployeeInDepartment(currentUser, d.departmentName, d.departmentId);
      }
      return false;
    });
  }, [documents, versions, currentUser]);

  const userIdentifiers = useMemo(() => {
    const list = [currentUser.id, currentUser.empId, currentUser.loginId, currentUser.email]
      .filter(Boolean)
      .map((s) => s!.toLowerCase());

    const matchedUser =
      governanceEngine.findUserByIdentifiers(currentUser.id) ||
      governanceEngine.findUserByIdentifiers(currentUser.empId) ||
      governanceEngine.findUserByIdentifiers(currentUser.email);
    if (matchedUser) {
      [matchedUser.id, matchedUser.empId, matchedUser.loginId, matchedUser.email].forEach((id) => {
        if (id && !list.includes(id.toLowerCase())) {
          list.push(id.toLowerCase());
        }
      });
    }
    return list;
  }, [currentUser]);

  const effectiveAcks = localAcks.length > 0 ? localAcks : (acknowledgements || []);
  const userAcks = useMemo(() => {
    return effectiveAcks.filter(
      (a) =>
        (a.employeeId && userIdentifiers.includes(a.employeeId.toLowerCase())) ||
        (a.employeeEmail && userIdentifiers.includes(a.employeeEmail.toLowerCase()))
    );
  }, [effectiveAcks, userIdentifiers]);

  const handleAcknowledge = async (doc: DocumentMaster, verNumber: string) => {
    governanceEngine.acknowledgeDocument(currentUser, doc.documentId, verNumber);
    setLocalAcks(governanceEngine.getAcknowledgements());
  };

  const getPublishedVersionForDoc = (doc: DocumentMaster): DocumentVersion | undefined => {
    if (doc.currentPublishedVersionId) {
      const v = versions.find((ver) => ver.id === doc.currentPublishedVersionId);
      if (v) return v;
    }
    const matching = versions
      .filter((v) => (v.documentMasterId === doc.id || v.documentId === doc.documentId) && v.status === VersionStatus.PUBLISHED)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (matching.length > 0) return matching[0];
    return undefined;
  };

  const handleDownloadIntact = async (doc: DocumentMaster, ver: DocumentVersion) => {
    setDownloadingDocId(doc.id);
    try {
      await downloadDocumentWithIntactFormat({
        fileName: ver.fileName,
        documentTitle: ver.documentTitle || doc.title,
        versionNumber: ver.versionNumber,
        effectiveDate: formatDDMMYYYY(ver.effectiveFrom || ver.createdAt),
        createdByName: ver.createdByName || doc.processOwnerName || 'Amee Shah',
        approvedByName:
          ver.status === VersionStatus.PUBLISHED
            ? (ver.reviewedByName || ver.publishedByName || doc.documentOwnerName || 'Vishal Shah')
            : 'Not yet approved',
        approvedDate:
          ver.status === VersionStatus.PUBLISHED && (ver.reviewedAt || ver.publishedAt)
            ? formatDDMMYYYY(ver.reviewedAt || ver.publishedAt!)
            : 'Not yet approved',
        companyName: doc.companyName || 'Amaavigo',
        rawContent: ver.rawContent,
        fileUrl: ver.fileUrl || ver.originalFileUrl,
        originalFileUrl: ver.originalFileUrl || ver.fileUrl,
        versionId: ver.id,
        documentId: doc.documentId || ver.documentId,
      });
    } catch (e) {
      console.error('Download error', e);
    } finally {
      setDownloadingDocId(null);
    }
  };

  // Pending documents for "Policy & SOP Acknowledgements":
  // - Must require compliance acknowledgement (acknowledgementRequired === true)
  // - Not yet acknowledged by this employee
  // (If Employee Compliance is unchecked, do not create an acknowledgement card; it stays directly in All Documents)
  const pendingAckDocs = useMemo(() => {
    return publishedDocs.filter((doc) => {
      if (!doc.acknowledgementRequired) return false;
      const verNumber = doc.currentPublishedVersionNumber || '1.0';
      const ack = userAcks.find(
        (a) =>
          a.documentId.toLowerCase() === doc.documentId.toLowerCase() &&
          a.versionNumber === verNumber &&
          a.status === 'ACKNOWLEDGED'
      );
      return !ack;
    });
  }, [publishedDocs, userAcks]);

  const pendingAcksCount = pendingAckDocs.length;

  // Filter pending acknowledgement cards by search term
  const filteredPendingDocs = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return pendingAckDocs;
    return pendingAckDocs.filter((doc) => {
      return (
        doc.title.toLowerCase().includes(q) ||
        doc.documentId.toLowerCase().includes(q) ||
        doc.category.toLowerCase().includes(q) ||
        doc.departmentName.toLowerCase().includes(q)
      );
    });
  }, [pendingAckDocs, searchTerm]);

  // Filter All Documents table/list
  const filteredAllDocs = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return publishedDocs.filter((doc) => {
      const matchesSearch =
        !q ||
        doc.title.toLowerCase().includes(q) ||
        doc.documentId.toLowerCase().includes(q) ||
        doc.category.toLowerCase().includes(q) ||
        doc.departmentName.toLowerCase().includes(q) ||
        (doc.description && doc.description.toLowerCase().includes(q));

      const matchesCategory = selectedCategory === 'ALL' || doc.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [publishedDocs, searchTerm, selectedCategory]);

  return (
    <div className="space-y-6">
      {/* HEADER SUMMARY */}
      <div className="bg-white rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-slate-200">
        <div>
          <div className="flex items-center space-x-2.5 flex-wrap gap-y-1">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Employee Document Portal</h1>
            <span className="bg-amber-50 text-amber-700 text-xs px-3 py-0.5 rounded-full font-semibold border border-amber-300">
              Live Company Policies & SOPs
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Department: <strong className="text-slate-700">{currentUser.departmentName || 'Operations'}</strong> • Access scope includes Public and Department-specific policies.
          </p>
        </div>

        {pendingAcksCount > 0 ? (
          <div className="bg-amber-50/90 border border-amber-200 px-4 py-2.5 rounded-xl flex items-center space-x-2.5 text-xs text-amber-900 shadow-xs">
            <Clock className="w-4 h-4 text-amber-600 animate-pulse shrink-0" />
            <span>
              You have <strong className="text-amber-700 font-bold">{pendingAcksCount} document(s)</strong> awaiting your compliance acknowledgement.
            </span>
          </div>
        ) : (
          <div className="bg-emerald-50 border border-emerald-200 px-4 py-2.5 rounded-xl flex items-center space-x-2.5 text-xs text-emerald-900 shadow-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>All active policy acknowledgements up to date!</span>
          </div>
        )}
      </div>

      {/* TAB CONTENT: 1. POLICY & SOP ACKNOWLEDGEMENTS */}
      {currentTab === 'acknowledgements' && (
        <div className="space-y-4">
          {/* If there are no pending acknowledgement cards, show required catch-up banner with button */}
          {pendingAckDocs.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-xs w-full">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-200">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">You’re all caught up!</h2>
              <p className="text-sm text-slate-600 mb-6 max-w-md mx-auto leading-relaxed">
                All required documents have been acknowledged. View all available documents in All Documents.
              </p>
              <button
                id="btn-view-all-documents"
                type="button"
                onClick={() => setTab('all-documents')}
                className="inline-flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all shadow-xs cursor-pointer"
              >
                <FileText className="w-4 h-4 text-amber-400" />
                <span>View All Documents</span>
              </button>
            </div>
          ) : (
            <>
              {/* Search Bar for Pending Cards */}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-xs">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="search-pending-docs"
                    type="text"
                    placeholder="Search pending documents awaiting your acknowledgement..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 transition-colors"
                  />
                </div>
              </div>

              {/* Grid of Pending Acknowledgement Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPendingDocs.length === 0 ? (
                  <div className="col-span-2 bg-white rounded-2xl p-10 text-center text-slate-500 border border-slate-200 shadow-xs">
                    <BookOpen className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                    <p className="text-sm">No pending documents found matching your search term.</p>
                  </div>
                ) : (
                  filteredPendingDocs.map((doc) => {
                    const pubVersion = getPublishedVersionForDoc(doc);
                    const verNumber = doc.currentPublishedVersionNumber || pubVersion?.versionNumber || '1.0';

                    return (
                      <div
                        key={doc.id}
                        className="bg-white rounded-2xl border border-amber-200 p-5 shadow-xs hover:border-amber-300 transition-all flex flex-col justify-between relative overflow-hidden"
                      >
                        {/* Top banner accent for pending compliance */}
                        <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />

                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center space-x-2">
                              <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded-lg border border-slate-200">
                                {doc.documentId}
                              </span>
                              <span className="font-bold text-xs text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                                v{verNumber} Live
                              </span>
                            </div>

                            <span className="text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md font-medium border border-slate-200">
                              {doc.category}
                            </span>
                          </div>

                          <h2 className="text-base font-bold text-slate-900 leading-snug">{doc.title}</h2>

                          {doc.description && (
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{doc.description}</p>
                          )}

                          <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-500">
                            <div>
                              <span className="text-slate-400 block text-[10px] uppercase font-bold">Department</span>
                              <span className="text-slate-700 font-medium">{doc.departmentName}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[10px] uppercase font-bold">Effective Date</span>
                              <span className="text-slate-700 font-medium">{pubVersion?.effectiveFrom || '2026-08-01'}</span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                          {/* Acknowledge Button */}
                          <button
                            id={`btn-ack-${doc.id}`}
                            onClick={() => handleAcknowledge(doc, verNumber)}
                            className="inline-flex items-center justify-center space-x-1.5 bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all shadow-xs cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                            <span>Acknowledge Policy v{verNumber}</span>
                          </button>

                          <div className="flex items-center gap-2">
                            {/* Suggestion Button */}
                            <button
                              id={`btn-card-suggest-${doc.id}`}
                              onClick={() => setSelectedDocForSuggestion(doc)}
                              className="inline-flex items-center justify-center space-x-1.5 bg-white hover:bg-orange-50 text-slate-700 hover:text-[#FA7014] text-xs font-medium px-3 py-2 rounded-xl transition-colors border border-slate-200 hover:border-orange-300 cursor-pointer"
                              title="Give feedback or suggest an improvement on this policy"
                            >
                              <MessageSquarePlus className="w-3.5 h-3.5 text-[#FA7014]" />
                              <span>Give Suggestion</span>
                            </button>

                            {/* Read Document Button */}
                            {pubVersion && (
                              <button
                                id={`btn-employee-read-${doc.id}`}
                                onClick={() => onOpenDocumentView(pubVersion)}
                                className="inline-flex items-center justify-center space-x-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors border border-slate-200 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5 text-slate-600" />
                                <span>Read Document</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB CONTENT: 2. ALL DOCUMENTS (Clean table / list view of all documents available to employee) */}
      {currentTab === 'all-documents' && (
        <div className="space-y-4">
          {/* SEARCH & CATEGORY FILTER */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="search-all-docs"
                type="text"
                placeholder="Search all documents by ID, title, department, or keyword..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] focus:bg-white placeholder:text-slate-400 transition-colors"
              />
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <label htmlFor="filter-employee-category" className="text-xs font-semibold text-slate-600 whitespace-nowrap">
                Category:
              </label>
              <select
                id="filter-employee-category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] cursor-pointer"
              >
                <option value="ALL">All Categories</option>
                {Object.values(DocumentCategory).map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* TABLE OF ALL DOCUMENTS */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            {filteredAllDocs.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <BookOpen className="w-12 h-12 mx-auto mb-2 text-slate-400" />
                <p className="text-sm font-medium text-slate-700">No documents found</p>
                <p className="text-xs text-slate-500 mt-1">Try changing your search term or category filter.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50/90 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                      <th className="py-3.5 px-4">Document ID & Category</th>
                      <th className="py-3.5 px-4">Title & Scope</th>
                      <th className="py-3.5 px-4">Department</th>
                      <th className="py-3.5 px-4">Live Version</th>
                      <th className="py-3.5 px-4">Compliance Status</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAllDocs.map((doc) => {
                      const pubVersion = getPublishedVersionForDoc(doc);
                      const verNumber = doc.currentPublishedVersionNumber || pubVersion?.versionNumber || '1.0';

                      const ack = userAcks.find(
                        (a) =>
                          a.documentId.toLowerCase() === doc.documentId.toLowerCase() &&
                          a.versionNumber === verNumber &&
                          a.status === 'ACKNOWLEDGED'
                      );
                      const isAcked = !!ack;

                      return (
                        <tr key={doc.id} className="hover:bg-slate-50/80 transition-colors">
                          {/* Document ID & Category */}
                          <td className="py-3.5 px-4 align-top">
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 w-fit">
                                {doc.documentId}
                              </span>
                              <span className="text-[11px] text-slate-600 font-medium">
                                {doc.category}
                              </span>
                            </div>
                          </td>

                          {/* Title & Scope */}
                          <td className="py-3.5 px-4 align-top max-w-xs">
                            <div className="font-bold text-slate-900 leading-snug">{doc.title}</div>
                            {doc.description && (
                              <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{doc.description}</p>
                            )}
                            <div className="mt-1 flex items-center gap-1.5">
                              {doc.confidentiality === ConfidentialityLevel.PUBLIC ? (
                                <span className="inline-flex items-center text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                                  Public (All Employees)
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-[10px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                                  Dept Specific ({doc.departmentName})
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Department */}
                          <td className="py-3.5 px-4 align-top text-slate-700 font-medium">
                            {doc.departmentName}
                          </td>

                          {/* Live Version & Effective Date */}
                          <td className="py-3.5 px-4 align-top">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200 w-fit text-[11px]">
                                v{verNumber}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                Effective: {pubVersion?.effectiveFrom || '2026-08-01'}
                              </span>
                            </div>
                          </td>

                          {/* Compliance Status */}
                          <td className="py-3.5 px-4 align-top">
                            {doc.acknowledgementRequired ? (
                              isAcked ? (
                                <div className="flex flex-col gap-0.5">
                                  <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 w-fit">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                    <span>Acknowledged</span>
                                  </span>
                                  <span className="text-[10px] text-slate-500 pl-0.5">
                                    {isOfflineSignOff(ack) ? 'Offline Attestation' : `v${verNumber}`}
                                    {ack?.acknowledgedAt ? ` • ${formatISTDate(ack.acknowledgedAt)}` : ''}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-1.5">
                                  <span className="inline-flex items-center space-x-1.5 text-xs font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 w-fit">
                                    <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0 animate-pulse" />
                                    <span>Pending Sign-off</span>
                                  </span>
                                  <button
                                    id={`btn-table-ack-${doc.id}`}
                                    onClick={() => handleAcknowledge(doc, verNumber)}
                                    className="inline-flex items-center space-x-1 bg-[#FA7014] hover:bg-[#E65A05] text-white text-[11px] font-bold px-2 py-0.5 rounded-md transition-all shadow-xs cursor-pointer w-fit"
                                  >
                                    <Check className="w-3 h-3 stroke-[3]" />
                                    <span>Sign-off</span>
                                  </button>
                                </div>
                              )
                            ) : (
                              <span className="inline-flex items-center space-x-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">
                                <span>Compliance Not Required</span>
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                            <div className="inline-flex items-center space-x-1.5">
                              {/* Employee Suggestion Button */}
                              <button
                                id={`btn-table-suggest-${doc.id}`}
                                onClick={() => setSelectedDocForSuggestion(doc)}
                                className="inline-flex items-center space-x-1 bg-white hover:bg-orange-50 hover:text-[#FA7014] text-slate-700 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors border border-slate-200 hover:border-orange-300 cursor-pointer shadow-2xs"
                                title="Give Suggestion or Feedback on this document"
                              >
                                <MessageSquarePlus className="w-3.5 h-3.5 text-[#FA7014]" />
                                <span>Suggest</span>
                              </button>

                              {pubVersion && (
                                <button
                                  id={`btn-table-read-${doc.id}`}
                                  onClick={() => onOpenDocumentView(pubVersion)}
                                  className="inline-flex items-center space-x-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors border border-slate-200 cursor-pointer"
                                  title="Read Document"
                                >
                                  <Eye className="w-3.5 h-3.5 text-slate-600" />
                                  <span>Read</span>
                                </button>
                              )}

                              {pubVersion && (
                                <button
                                  id={`btn-table-download-${doc.id}`}
                                  disabled={downloadingDocId === doc.id}
                                  onClick={() => handleDownloadIntact(doc, pubVersion)}
                                  className="inline-flex items-center space-x-1 bg-white hover:bg-slate-100 text-slate-700 text-xs font-medium px-2 py-1.5 rounded-lg transition-colors border border-slate-200 cursor-pointer disabled:opacity-50"
                                  title="Download Document Intact"
                                >
                                  <Download className="w-3.5 h-3.5 text-slate-500" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUCCESS TOAST FOR SUGGESTION */}
      {suggestionSuccessMsg && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center space-x-2.5 border border-slate-700 animate-in slide-in-from-bottom duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-medium">{suggestionSuccessMsg}</span>
          <button
            onClick={() => setSuggestionSuccessMsg(null)}
            className="text-slate-400 hover:text-white ml-2 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* MODAL: SUBMIT SUGGESTION */}
      {selectedDocForSuggestion && currentUser && (
        <SubmitSuggestionModal
          document={selectedDocForSuggestion}
          currentUser={currentUser}
          onClose={() => setSelectedDocForSuggestion(null)}
          onSuccess={(newSug) => {
            setSelectedDocForSuggestion(null);
            setSuggestionSuccessMsg(`Suggestion for ${newSug.documentId} submitted successfully to HR!`);
            setTimeout(() => setSuggestionSuccessMsg(null), 5000);
          }}
        />
      )}
    </div>
  );
};
