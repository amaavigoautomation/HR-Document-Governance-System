import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Layers,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  AlertTriangle,
  Eye,
  CalendarDays,
  Laptop,
  Home,
  Users,
  BookOpen,
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
import { Chip, FilterField, KpiCard, KpiGrid, PageHeader, Pagination, UnderlineTabs, searchInput, tbl } from './common/pageChrome';

interface EmployeePortalViewProps {
  currentUser: User;
  documents: DocumentMaster[];
  versions: DocumentVersion[];
  acknowledgements?: AcknowledgementRecord[];
  onOpenDocumentView: (version: DocumentVersion) => void;
  activeTab?: 'acknowledgements' | 'all-documents';
  onTabChange?: (tab: 'acknowledgements' | 'all-documents') => void;
}

type PolicyTab = 'all' | 'acknowledged' | 'pending' | 'updates';
type PolicyStatus = 'ACKNOWLEDGED' | 'PENDING' | 'ACTIVE';
type DetailTab = 'overview' | 'history' | 'ack';

interface PolicyRow {
  doc: DocumentMaster;
  ver?: DocumentVersion;
  verNumber: string;
  ack?: AcknowledgementRecord;
  status: PolicyStatus;
  updatedAt: string;
  dueSoon: boolean;
  recentlyUpdated: boolean;
  signedOlderVersion: boolean;
}

const DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 8;

const STATUS_LABEL: Record<PolicyStatus, string> = { ACKNOWLEDGED: 'Acknowledged', PENDING: 'Pending', ACTIVE: 'Active' };
const STATUS_TONE: Record<PolicyStatus, 'green' | 'amber'> = { ACKNOWLEDGED: 'green', PENDING: 'amber', ACTIVE: 'green' };

const formatBytes = (n?: number) => {
  if (!n || n <= 0) return 'Not available';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const fileKind = (name?: string): { label: string; tile: string } => {
  const ext = (name || '').split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return { label: 'PDF', tile: 'bg-rose-50 text-rose-500' };
  if (ext === 'doc' || ext === 'docx') return { label: 'DOCX', tile: 'bg-sky-50 text-sky-600' };
  return { label: (ext || 'File').toUpperCase(), tile: 'bg-violet-50 text-violet-600' };
};

const categoryIcon = (c: string) => {
  const k = c.toLowerCase();
  if (k.includes('it') || k.includes('security')) return Laptop;
  if (k.includes('work')) return Home;
  if (k.includes('hr')) return Users;
  if (k.includes('compliance') || k.includes('legal')) return ShieldCheck;
  return Tag;
};

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
  activeTab,
  onTabChange,
}) => {
  const toPolicyTab = (t?: 'acknowledgements' | 'all-documents'): PolicyTab => (t === 'acknowledgements' ? 'pending' : 'all');
  const [tab, setTabState] = useState<PolicyTab>(toPolicyTab(activeTab));
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [menuDocId, setMenuDocId] = useState<string | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [selectedDocForSuggestion, setSelectedDocForSuggestion] = useState<DocumentMaster | null>(null);
  const [suggestionSuccessMsg, setSuggestionSuccessMsg] = useState<string | null>(null);

  const [localAcks, setLocalAcks] = useState<AcknowledgementRecord[]>(() => {
    return acknowledgements && acknowledgements.length > 0
      ? acknowledgements
      : governanceEngine.getAcknowledgements();
  });

  // The app can ask for a tab (for example from a notification); follow it.
  useEffect(() => {
    if (activeTab) setTabState(toPolicyTab(activeTab));
  }, [activeTab]);

  const setTab = (t: PolicyTab) => {
    setTabState(t);
    setPage(1);
    if (t === 'pending') onTabChange?.('acknowledgements');
    else if (t === 'all') onTabChange?.('all-documents');
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
        reReviewDate: formatDDMMYYYY(ver.reviewDueDate, ''),
        creationDate: formatDDMMYYYY(doc.createdAt || ver.createdAt),
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

  const rows: PolicyRow[] = useMemo(() => {
    const now = Date.now();
    return publishedDocs.map((doc) => {
      const ver = getPublishedVersionForDoc(doc);
      const verNumber = doc.currentPublishedVersionNumber || ver?.versionNumber || '1.0';
      const docAcks = userAcks.filter((a) => a.documentId.toLowerCase() === doc.documentId.toLowerCase() && a.status === 'ACKNOWLEDGED');
      const ack = docAcks.find((a) => a.versionNumber === verNumber);
      const required = !!doc.acknowledgementRequired;
      const status: PolicyStatus = required ? (ack ? 'ACKNOWLEDGED' : 'PENDING') : 'ACTIVE';
      const updatedAt = ver?.publishedAt || doc.updatedAt || ver?.createdAt || doc.createdAt;
      const due = ver?.reviewDueDate ? new Date(ver.reviewDueDate).getTime() : NaN;
      const upd = new Date(updatedAt).getTime();
      return {
        doc,
        ver,
        verNumber,
        ack,
        status,
        updatedAt,
        dueSoon: Number.isFinite(due) && due - now <= 30 * DAY,
        recentlyUpdated: Number.isFinite(upd) && now - upd <= 30 * DAY,
        signedOlderVersion: required && !ack && docAcks.length > 0,
      };
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [publishedDocs, userAcks, versions]);

  const counts = useMemo(() => ({
    total: rows.length,
    acknowledged: rows.filter((r) => r.status === 'ACKNOWLEDGED').length,
    pending: rows.filter((r) => r.status === 'PENDING').length,
    expiring: rows.filter((r) => r.dueSoon).length,
    updates: rows.filter((r) => r.recentlyUpdated || r.signedOlderVersion).length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return rows.filter((r) => {
      if (tab === 'acknowledged' && r.status !== 'ACKNOWLEDGED') return false;
      if (tab === 'pending' && r.status !== 'PENDING') return false;
      if (tab === 'updates' && !(r.recentlyUpdated || r.signedOlderVersion)) return false;
      if (selectedCategory !== 'ALL' && r.doc.category !== selectedCategory) return false;
      if (selectedStatus !== 'ALL' && r.status !== selectedStatus) return false;
      if (!q) return true;
      return (
        r.doc.title.toLowerCase().includes(q) ||
        r.doc.documentId.toLowerCase().includes(q) ||
        r.doc.category.toLowerCase().includes(q) ||
        r.doc.departmentName.toLowerCase().includes(q) ||
        (r.doc.description || '').toLowerCase().includes(q)
      );
    });
  }, [rows, tab, searchTerm, selectedCategory, selectedStatus]);

  useEffect(() => { setPage(1); }, [searchTerm, selectedCategory, selectedStatus, tab]);

  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selected = filtered.find((r) => r.doc.id === selectedDocId) || filtered[0];
  const hasFilters = !!searchTerm || selectedCategory !== 'ALL' || selectedStatus !== 'ALL';
  const resetFilters = () => { setSearchTerm(''); setSelectedCategory('ALL'); setSelectedStatus('ALL'); };

  const selectRow = (id: string) => { setSelectedDocId(id); setDetailTab('overview'); };

  const historyFor = (doc: DocumentMaster) =>
    versions
      .filter((v) => (v.documentMasterId === doc.id || v.documentId === doc.documentId) && (v.status === VersionStatus.PUBLISHED || v.status === VersionStatus.SUPERSEDED))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const tabs: { value: PolicyTab; label: React.ReactNode; badge?: number }[] = [
    { value: 'all', label: 'All Policies', badge: counts.total },
    { value: 'acknowledged', label: 'Acknowledged', badge: counts.acknowledged },
    { value: 'pending', label: 'Pending', badge: counts.pending },
    { value: 'updates', label: 'Updates', badge: counts.updates },
  ];

  const emptyText: Record<PolicyTab, [string, string]> = {
    all: ['No policies found', 'Try changing your search or filters.'],
    acknowledged: ['Nothing acknowledged yet', 'Policies you sign will appear here.'],
    pending: ['You are all caught up', 'Every policy that needs your acknowledgement is signed.'],
    updates: ['No recent updates', 'Policies changed in the last 30 days will appear here.'],
  };

  const sel = selected;
  const selKind = fileKind(sel?.ver?.fileName);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Layers}
        title="My Policies"
        subtitle="View and acknowledge company policies applicable to you."
      />

      <KpiGrid cols={4}>
        <KpiCard icon={FileText} tone="violet" label="Total Policies" value={counts.total} />
        <KpiCard icon={CheckCircle2} tone="green" label="Acknowledged" value={counts.acknowledged} />
        <KpiCard icon={Clock} tone="amber" label="Pending Acknowledgement" value={counts.pending} onClick={counts.pending ? () => setTab('pending') : undefined} />
        <KpiCard icon={AlertTriangle} tone="rose" label="Expiring Soon" value={counts.expiring} hint="Review due in 30 days" />
      </KpiGrid>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        {/* LEFT: list */}
        <div className="min-w-0 space-y-4">
          <UnderlineTabs value={tab} onChange={setTab} options={tabs} />

          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="search-policies"
                type="text"
                placeholder="Search policies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={searchInput}
              />
            </div>
            <FilterField icon={Tag} label="Category:">
              <select
                id="filter-employee-category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer"
              >
                <option value="ALL">All</option>
                {Object.values(DocumentCategory).map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </FilterField>
            <FilterField icon={ShieldCheck} label="Status:">
              <select
                id="filter-employee-status"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer"
              >
                <option value="ALL">All</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="PENDING">Pending</option>
                <option value="ACTIVE">Active (no sign-off)</option>
              </select>
            </FilterField>
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasFilters}
              className="w-11 h-11 shrink-0 rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-default"
              title="Reset filters"
              aria-label="Reset filters"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>

          <div className={tbl.wrap}>
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <BookOpen className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-bold text-slate-700">{hasFilters ? 'No policies match your filters' : emptyText[tab][0]}</p>
                <p className="text-xs text-slate-500 mt-1">{hasFilters ? 'Try changing your search or filters.' : emptyText[tab][1]}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className={tbl.table}>
                  <thead>
                    <tr className={tbl.headRow}>
                      <th className={tbl.th}>Policy Name</th>
                      <th className={tbl.th}>Category</th>
                      <th className={tbl.th}>Version</th>
                      <th className={tbl.th}>Last Updated</th>
                      <th className={tbl.th}>Status</th>
                      <th className={`${tbl.th} w-12`}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className={tbl.body}>
                    {pageRows.map((r) => {
                      const kind = fileKind(r.ver?.fileName);
                      const CatIcon = categoryIcon(r.doc.category);
                      const isSel = sel?.doc.id === r.doc.id;
                      return (
                        <tr
                          key={r.doc.id}
                          onClick={() => selectRow(r.doc.id)}
                          className={`${tbl.row} cursor-pointer ${isSel ? 'bg-violet-50/70' : ''}`}
                        >
                          <td className={tbl.td}>
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${kind.tile}`}><FileText className="w-4 h-4" /></span>
                              <div className="min-w-0">
                                <div className="font-bold text-slate-900 truncate max-w-[16rem]" title={r.doc.title}>{r.doc.title}</div>
                                <div className="text-[11px] text-slate-500">{r.doc.documentId}</div>
                              </div>
                            </div>
                          </td>
                          <td className={tbl.td}>
                            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg whitespace-nowrap">
                              <CatIcon className="w-3.5 h-3.5 text-slate-500" />{r.doc.category}
                            </span>
                          </td>
                          <td className={tbl.td}><Chip tone="violet">v{r.verNumber}</Chip></td>
                          <td className={`${tbl.td} text-xs text-slate-700 whitespace-nowrap`}>{formatISTDate(r.updatedAt)}</td>
                          <td className={tbl.td}><Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip></td>
                          <td className={`${tbl.td} relative`} onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => setMenuDocId(menuDocId === r.doc.id ? null : r.doc.id)}
                              className="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 flex items-center justify-center cursor-pointer"
                              aria-label="More actions"
                              aria-haspopup="menu"
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </button>
                            {menuDocId === r.doc.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setMenuDocId(null)} />
                                <div role="menu" className="absolute right-3 top-12 z-20 w-44 bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-sm">
                                  {r.ver && (
                                    <button role="menuitem" type="button" id={`btn-table-read-${r.doc.id}`} onClick={() => { setMenuDocId(null); onOpenDocumentView(r.ver!); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-slate-700 cursor-pointer"><Eye className="w-4 h-4" />Read</button>
                                  )}
                                  {r.ver && (
                                    <button role="menuitem" type="button" id={`btn-table-download-${r.doc.id}`} disabled={downloadingDocId === r.doc.id} onClick={() => { setMenuDocId(null); handleDownloadIntact(r.doc, r.ver!); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-slate-700 cursor-pointer disabled:opacity-50"><Download className="w-4 h-4" />Download</button>
                                  )}
                                  <button role="menuitem" type="button" id={`btn-table-suggest-${r.doc.id}`} onClick={() => { setMenuDocId(null); setSelectedDocForSuggestion(r.doc); }} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 text-slate-700 cursor-pointer"><MessageSquarePlus className="w-4 h-4" />Give suggestion</button>
                                </div>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} noun="policies" />
          </div>
        </div>

        {/* RIGHT: detail */}
        <aside className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.04)] p-5 xl:sticky xl:top-4 min-w-0">
          {!sel ? (
            <div className="py-16 text-center text-slate-500">
              <FileText className="w-10 h-10 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-bold text-slate-700">Select a policy</p>
              <p className="text-xs mt-1">Its details and history show here.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${selKind.tile}`}><FileText className="w-5 h-5" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-extrabold text-slate-900 leading-snug">{sel.doc.title}</h2>
                  <div className="mt-1"><Chip tone="violet">Current Version: v{sel.verNumber}</Chip></div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {sel.ver && (
                    <button type="button" id={`btn-employee-read-${sel.doc.id}`} onClick={() => onOpenDocumentView(sel.ver!)} className="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center cursor-pointer" title="Read document" aria-label="Read document"><ExternalLink className="w-4 h-4" /></button>
                  )}
                  {sel.ver && (
                    <button type="button" disabled={downloadingDocId === sel.doc.id} onClick={() => handleDownloadIntact(sel.doc, sel.ver!)} className="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center cursor-pointer disabled:opacity-50" title="Download" aria-label="Download"><Download className="w-4 h-4" /></button>
                  )}
                  <button type="button" id={`btn-card-suggest-${sel.doc.id}`} onClick={() => setSelectedDocForSuggestion(sel.doc)} className="w-9 h-9 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center cursor-pointer" title="Give suggestion" aria-label="Give suggestion"><MessageSquarePlus className="w-4 h-4" /></button>
                </div>
              </div>

              <div role="tablist" className="mt-4 grid grid-cols-3 border-b border-slate-200">
                {([['overview', 'Overview'], ['history', 'Version History'], ['ack', 'Acknowledgement']] as const).map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={detailTab === k} onClick={() => setDetailTab(k)}
                    className={`relative py-2.5 text-sm font-bold cursor-pointer ${detailTab === k ? 'text-[#6d4cf0]' : 'text-slate-700 hover:text-slate-900'}`}>
                    {label}
                    {detailTab === k && <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full bg-[#6d4cf0]" />}
                  </button>
                ))}
              </div>

              <div className="mt-4 min-h-[15rem]">
                {detailTab === 'overview' && (
                  <>
                    <p className="text-sm text-slate-600 leading-relaxed">{sel.doc.description || 'No description has been added for this policy.'}</p>
                    <dl className="mt-4 rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
                      {[
                        [Tag, 'Category', sel.doc.category],
                        [ShieldCheck, 'Version', `v${sel.verNumber}`],
                        [CalendarDays, 'Last Updated', formatISTDate(sel.updatedAt)],
                        [Building2, 'Department', sel.doc.confidentiality === ConfidentialityLevel.PUBLIC ? `${sel.doc.departmentName} (all employees)` : sel.doc.departmentName],
                        [FileText, 'Document Size', sel.ver ? `${formatBytes(sel.ver.fileSize)} (${selKind.label})` : 'Not available'],
                        [Clock, 'Review Due', sel.ver?.reviewDueDate ? formatDDMMYYYY(sel.ver.reviewDueDate) : 'Not set'],
                      ].map(([Icon, label, value]) => {
                        const I = Icon as React.ComponentType<{ className?: string }>;
                        return (
                          <div key={label as string} className="flex items-center justify-between gap-3 px-3.5 py-3">
                            <dt className="flex items-center gap-2.5 text-slate-600"><I className="w-4 h-4 text-slate-500" />{label as string}</dt>
                            <dd className="font-semibold text-slate-900 text-right">{value as string}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </>
                )}

                {detailTab === 'history' && (
                  <ol className="space-y-3">
                    {historyFor(sel.doc).length === 0 && <li className="text-sm text-slate-500">No earlier versions.</li>}
                    {historyFor(sel.doc).map((v) => (
                      <li key={v.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Chip tone="violet">v{v.versionNumber}</Chip>
                          <Chip tone={v.status === VersionStatus.PUBLISHED ? 'green' : 'slate'}>{v.status === VersionStatus.PUBLISHED ? 'Live' : 'Superseded'}</Chip>
                        </div>
                        <div className="text-xs text-slate-500 mt-1.5">{formatISTDate(v.publishedAt || v.createdAt)}</div>
                        {v.changeSummary && <p className="text-sm text-slate-700 mt-1">{v.changeSummary}</p>}
                      </li>
                    ))}
                  </ol>
                )}

                {detailTab === 'ack' && (
                  <div className="space-y-3 text-sm">
                    {sel.status === 'ACKNOWLEDGED' && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                        <div className="flex items-center gap-2 font-bold text-emerald-800"><CheckCircle2 className="w-4 h-4" />Acknowledged v{sel.verNumber}</div>
                        <div className="text-xs text-emerald-800/80 mt-1.5">
                          {isOfflineSignOff(sel.ack) ? 'Offline attestation' : 'Signed electronically'}
                          {sel.ack?.acknowledgedAt ? ` on ${formatISTDate(sel.ack.acknowledgedAt)}` : ''}
                        </div>
                      </div>
                    )}
                    {sel.status === 'PENDING' && (
                      <div className="rounded-xl bg-orange-50 border border-orange-100 p-4">
                        <div className="flex items-center gap-2 font-bold text-orange-800"><Clock className="w-4 h-4" />Waiting for you</div>
                        <div className="text-xs text-orange-800/80 mt-1.5">
                          Read the policy, then acknowledge v{sel.verNumber}.
                          {sel.signedOlderVersion ? ' You signed an earlier version; this one has changed.' : ''}
                        </div>
                      </div>
                    )}
                    {sel.status === 'ACTIVE' && (
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-slate-600">This policy does not need an acknowledgement.</div>
                    )}
                  </div>
                )}
              </div>

              {sel.status === 'PENDING' ? (
                <button
                  id={`btn-ack-${sel.doc.id}`}
                  type="button"
                  onClick={() => handleAcknowledge(sel.doc, sel.verNumber)}
                  className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-[#6d4cf0] hover:bg-[#5b3be0] text-white font-bold py-3 rounded-xl text-sm shadow-md shadow-violet-500/30 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  Acknowledge Policy
                </button>
              ) : sel.status === 'ACKNOWLEDGED' ? (
                <div className="mt-4 w-full inline-flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 font-bold py-3 rounded-xl text-sm border border-emerald-100">
                  <CheckCircle2 className="w-4 h-4" />Acknowledged
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>

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
