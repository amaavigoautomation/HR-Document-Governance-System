import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Briefcase,
  UserCheck,
  Building2,
  RefreshCw,
  ExternalLink,
  Table,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Info,
  ChevronDown,
  Layers,
  FileSpreadsheet,
  BarChart3,
  Calendar,
  HelpCircle,
  Lock,
  Mail,
  Phone,
  Paperclip,
  FileText,
} from 'lucide-react';
import { recruitmentService } from '../services/recruitmentService';
import { RecruitmentOverviewResult, SheetRowData, isExcludedSheetTab } from '../services/serverSheets';
import { User, UserRole } from '../types';
import { CandidateEvaluationSection } from './CandidateEvaluationSection';

import { OverviewDashboard } from './hiring/OverviewDashboard';
import { PERIODS } from './hiring/PipelineBoard';

interface TalentAcquisitionOverviewProps {
  currentUser: User;
  onLogout?: () => void;
  onOpenRequisitions?: () => void;
  onOpenOnboarding?: () => void;
}


export const TalentAcquisitionOverview: React.FC<TalentAcquisitionOverviewProps> = ({ currentUser, onLogout, onOpenRequisitions, onOpenOnboarding }) => {
  // Primary State
  const [overviewData, setOverviewData] = useState<RecruitmentOverviewResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [selectedDesignation, setSelectedDesignation] = useState<string>('ALL');
  const [refreshCount, setRefreshCount] = useState<number>(0);
  const [days, setDays] = useState<number>(30);

  // Sheet Explorer State
  const [activeSheetTab, setActiveSheetTab] = useState<string>('');
  const [sheetTableData, setSheetTableData] = useState<SheetRowData | null>(null);
  const [isSheetLoading, setIsSheetLoading] = useState<boolean>(false);
  const [sheetSearchQuery, setSheetSearchQuery] = useState<string>('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Filter out administrative / internal sheets from the Sheet tab explorer:
  // - request data
  // - budget band
  // - HR data
  // - JD's
  // - Workflow tracker
  // - candidate log
  const visibleSheetTabs = useMemo(() => {
    if (!overviewData?.availableTabs || overviewData.availableTabs.length === 0) {
      return [];
    }
    return overviewData.availableTabs.filter((tab) => !isExcludedSheetTab(tab));
  }, [overviewData?.availableTabs]);

  // Diagnostics modal / drawer
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);

  // Track expanded cells for pros and cons (Google Sheets style double-tap expansion)
  const [expandedCells, setExpandedCells] = useState<Record<string, boolean>>({});
  const lastTapRef = React.useRef<{ [key: string]: number }>({});

  const toggleCellExpand = useCallback((cellKey: string) => {
    setExpandedCells((prev) => ({
      ...prev,
      [cellKey]: !prev[cellKey],
    }));
  }, []);

  const handleCellTouch = useCallback((cellKey: string) => {
    const now = Date.now();
    const lastTap = lastTapRef.current[cellKey] || 0;
    if (now - lastTap < 350) {
      toggleCellExpand(cellKey);
      lastTapRef.current[cellKey] = 0;
    } else {
      lastTapRef.current[cellKey] = now;
    }
  }, [toggleCellExpand]);

  // Load Overview Data
  const loadOverview = useCallback(async (force = false) => {
    if (force) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMsg(null);

    try {
      const data = await recruitmentService.getOverview(force, currentUser.role);
      setOverviewData(data);

      // Default active tab to first non-excluded available tab
      if (data.availableTabs && data.availableTabs.length > 0) {
        const allowedTabs = data.availableTabs.filter((t) => !isExcludedSheetTab(t));
        if (allowedTabs.length > 0) {
          setActiveSheetTab((prev) => {
            if (!prev || isExcludedSheetTab(prev) || !allowedTabs.includes(prev)) {
              return allowedTabs[0];
            }
            return prev;
          });
        } else {
          setActiveSheetTab('');
        }
      }
    } catch (err: any) {
      console.error('Failed to load recruitment overview:', err);
      setErrorMsg(err.message || 'Unable to connect to Google Sheets service.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUser.role]);

  // Load Sheet Explorer Table
  const loadSheetData = useCallback(async (tabName: string, force = false) => {
    if (!tabName || isExcludedSheetTab(tabName)) return;
    setIsSheetLoading(true);
    try {
      const data = await recruitmentService.getSheetData(tabName, force, currentUser.role);
      setSheetTableData(data);
      setCurrentPage(1);
    } catch (err: any) {
      console.warn(`Failed to fetch sheet data for ${tabName}:`, err);
      setSheetTableData(null);
    } finally {
      setIsSheetLoading(false);
    }
  }, [currentUser.role]);

  // Initial mount
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Synchronize activeSheetTab when visibleSheetTabs become available
  useEffect(() => {
    if (visibleSheetTabs.length > 0) {
      if (!activeSheetTab || isExcludedSheetTab(activeSheetTab) || !visibleSheetTabs.includes(activeSheetTab)) {
        setActiveSheetTab(visibleSheetTabs[0]);
      }
    } else if (overviewData?.status === 'OK') {
      setActiveSheetTab('');
    }
  }, [visibleSheetTabs, activeSheetTab, overviewData?.status]);

  // Handle Manual Refresh
  const handleRefresh = async () => {
    if (isRefreshing || isLoading) return;
    recruitmentService.clearCache();
    setRefreshCount((c) => c + 1);
    await loadOverview(true);
  };

  // Filtered Applications for Designation Filter
  const filteredMetrics = useMemo(() => {
    if (!overviewData?.applicationsByDesignation) {
      return {
        applicationsCount: overviewData?.kpis?.totalApplications ?? 0,
        chartData: [],
      };
    }

    if (selectedDesignation === 'ALL') {
      return {
        applicationsCount: overviewData.kpis?.totalApplications ?? 0,
        chartData: overviewData.applicationsByDesignation,
      };
    }

    const matched = overviewData.applicationsByDesignation.find(
      d => d.designation.toLowerCase() === selectedDesignation.toLowerCase()
    );

    return {
      applicationsCount: matched ? matched.count : 0,
      chartData: overviewData.applicationsByDesignation.filter(
        d => d.designation.toLowerCase() === selectedDesignation.toLowerCase()
      ),
    };
  }, [overviewData, selectedDesignation]);

  // Detect index and name of Status or Stage column in current active worksheet
  const statusColumnInfo = useMemo(() => {
    if (!sheetTableData?.headers || sheetTableData.headers.length === 0) {
      return { index: -1, name: null };
    }

    const headers = sheetTableData.headers;
    const candidates = [
      'status',
      'stage',
      'candidate status',
      'candidate stage',
      'requisition status',
      'interview status',
      'hiring status',
      'selection status',
    ];

    // 1. Exact match
    for (const cand of candidates) {
      const idx = headers.findIndex(h => h.toLowerCase().trim() === cand);
      if (idx !== -1) return { index: idx, name: headers[idx] };
    }

    // 2. Substring match
    const partialIdx = headers.findIndex(h => {
      const l = h.toLowerCase().trim();
      return l.includes('status') || l.includes('stage');
    });
    if (partialIdx !== -1) return { index: partialIdx, name: headers[partialIdx] };

    return { index: -1, name: null };
  }, [sheetTableData?.headers]);

  // Extract distinct status values available in the active sheet
  const availableStatuses = useMemo(() => {
    const set = new Set<string>();
    if (sheetTableData && statusColumnInfo.index !== -1) {
      sheetTableData.rows.forEach(row => {
        const val = row[statusColumnInfo.index];
        if (val !== undefined && val !== null) {
          const str = String(val).trim();
          if (str !== '' && str !== '—') {
            set.add(str);
          }
        }
      });
    }

    const values = Array.from(set);
    const hasShortlisted = values.some(s => s.toLowerCase() === 'shortlisted');
    const otherStatuses = values.filter(s => s.toLowerCase() !== 'shortlisted').sort();

    // Ensure 'Shortlisted' is always prominent at the top
    return hasShortlisted
      ? [values.find(s => s.toLowerCase() === 'shortlisted')!, ...otherStatuses]
      : ['Shortlisted', ...otherStatuses];
  }, [sheetTableData, statusColumnInfo.index]);

  // Filtered Sheet Table Rows based on search query AND status filter (e.g. Shortlisted)
  const filteredTableRows = useMemo(() => {
    if (!sheetTableData || !sheetTableData.rows) return [];

    let rows = sheetTableData.rows;

    // 1. Filter by Status (e.g., 'Shortlisted')
    if (selectedStatusFilter !== 'ALL') {
      const target = selectedStatusFilter.toLowerCase().trim();
      if (statusColumnInfo.index !== -1) {
        rows = rows.filter(row => {
          const cellVal = String(row[statusColumnInfo.index] ?? '').toLowerCase().trim();
          return cellVal === target || cellVal.includes(target);
        });
      } else {
        // Fallback search across all columns if no explicit status column exists
        rows = rows.filter(row =>
          row.some(cell => {
            const cellVal = String(cell ?? '').toLowerCase().trim();
            return cellVal === target || cellVal.includes(target);
          })
        );
      }
    }

    // 2. Filter by Search Query
    if (sheetSearchQuery.trim()) {
      const q = sheetSearchQuery.toLowerCase().trim();
      rows = rows.filter(row =>
        row.some(cell => String(cell).toLowerCase().includes(q))
      );
    }

    return rows;
  }, [sheetTableData, sheetSearchQuery, selectedStatusFilter, statusColumnInfo.index]);

  // Paginated Rows
  const paginatedRows = useMemo(() => {
    const startIdx = (currentPage - 1) * pageSize;
    return filteredTableRows.slice(startIdx, startIdx + pageSize);
  }, [filteredTableRows, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredTableRows.length / pageSize) || 1;

  // Format last refreshed time
  const formattedLastRefreshed = useMemo(() => {
    if (!overviewData?.lastRefreshed) return null;
    try {
      const date = new Date(overviewData.lastRefreshed);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(date);
    } catch {
      return overviewData.lastRefreshed;
    }
  }, [overviewData?.lastRefreshed]);

  // Helper to assign generous cell width/length tailored to content type,
  // preventing awkward wrap while keeping gaps between columns tight and clean.
  const getColumnWidthClass = (header: string) => {
    const h = header.toLowerCase().trim();
    if (/attachment|url|link|resume|formurl/i.test(h)) return 'min-w-[320px]';
    if (/email|mail/i.test(h)) return 'min-w-[250px]';
    if (/pros|cons|required skills|business justification|job description|message/i.test(h)) return 'min-w-[360px]';
    if (/position|designation|department|company/i.test(h)) return 'min-w-[220px]';
    if (/name|manager|assigned/i.test(h)) return 'min-w-[190px]';
    if (/datetime|date|submitted|published|synced|joining/i.test(h)) return 'min-w-[170px]';
    if (/phone|mobile|contact/i.test(h)) return 'min-w-[160px]';
    if (/id|requestid|score|salary/i.test(h)) return 'min-w-[140px]';
    if (/status|stage|priority|preference|mode|type|experience|notice/i.test(h)) return 'min-w-[140px]';
    return 'min-w-[180px]';
  };

  // Helper to render cell content matching Document Masters Directory aesthetic,
  // making emails, phone numbers, and attachment_urls clickable, and supporting Google Sheet style
  // small height cells with (....) and double-tap full text expansion for PROS and CONS.
  const renderCellContent = (val: any, header: string, cellKey?: string) => {
    if (val === '' || val === null || val === undefined) {
      return <span className="text-slate-300 italic">—</span>;
    }

    const strVal = String(val);
    const trimmed = strVal.trim();
    const headerLower = header.toLowerCase();

    // 1. Email field: Clickable mailto: link with generous cell length and clean single-line display
    const isEmailHeader = headerLower.includes('email') || headerLower.includes('mail');
    const isEmailValue = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    if (isEmailHeader || isEmailValue) {
      return (
        <a
          href={`mailto:${trimmed}`}
          className="inline-flex items-center gap-1.5 text-sky-600 hover:text-sky-800 hover:underline font-medium whitespace-nowrap transition-colors"
          title={`Send email to ${trimmed}`}
        >
          <Mail className="w-3.5 h-3.5 shrink-0 text-sky-500" />
          <span>{strVal}</span>
        </a>
      );
    }

    // 2. Phone / Mobile field: Clickable tel: link
    const isPhoneHeader = /phone|mobile|contact|tel/i.test(headerLower);
    const isPhoneValue =
      /^\+?[0-9\s\-()]{7,20}$/.test(trimmed) && trimmed.replace(/[^0-9]/g, '').length >= 7;
    if (isPhoneHeader || isPhoneValue) {
      const cleanDigits = trimmed.replace(/[^0-9+]/g, '');
      return (
        <a
          href={`tel:${cleanDigits}`}
          className="inline-flex items-center gap-1.5 text-slate-800 hover:text-[#FA7014] hover:underline font-mono text-xs font-semibold whitespace-nowrap transition-colors bg-slate-100 hover:bg-orange-50/60 border border-slate-200 px-2.5 py-1 rounded-lg"
          title={`Call ${trimmed}`}
        >
          <Phone className="w-3.5 h-3.5 shrink-0 text-slate-500" />
          <span>{strVal}</span>
        </a>
      );
    }

    // 3. Attachment URL / Links: Clickable external link with full text visible and generous cell length
    const isUrlHeader = /attachment|url|link|resume|cv|file|formurl/i.test(headerLower);
    const isUrlValue = /^https?:\/\//i.test(trimmed);
    if (isUrlHeader || isUrlValue) {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const isFile = /resume|pdf|doc|drive\.google|attachment/i.test(trimmed) || isUrlHeader;
        return (
          <a
            href={trimmed}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-start gap-1.5 text-[#FA7014] hover:text-[#E65A05] hover:underline font-medium break-all transition-colors group"
            title={`Open attachment: ${trimmed}`}
          >
            {isFile ? (
              <Paperclip className="w-3.5 h-3.5 shrink-0 text-[#FA7014] mt-0.5" />
            ) : (
              <ExternalLink className="w-3.5 h-3.5 shrink-0 text-[#FA7014] mt-0.5" />
            )}
            <span className="break-all">{strVal}</span>
            <ExternalLink className="w-3 h-3 shrink-0 opacity-60 group-hover:opacity-100 mt-0.5 ml-0.5" />
          </a>
        );
      }
    }

    // 4. RequestID or Candidate ID: styled like Document Masters Directory ID badge
    const isIdHeader = /^(requestid|requisitionid|^id$|cand_id|req_id)$/i.test(headerLower);
    const isReqIdFormat = /^REQ-\d+/i.test(trimmed);
    if (isIdHeader || isReqIdFormat) {
      return (
        <div className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg inline-block border border-slate-200 whitespace-nowrap">
          {strVal}
        </div>
      );
    }

    // 5. Status / Stage: styled with clean badges matching the system design
    const isStatusHeader = /^(status|stage|requisition status|job status)$/i.test(headerLower);
    if (isStatusHeader && trimmed.length > 0) {
      const s = trimmed.toLowerCase();
      let badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
      if (s.includes('recruiter assigned') || s.includes('in review') || s.includes('pending')) {
        badgeClass = 'bg-amber-50 text-amber-800 border-amber-200';
      } else if (s.includes('parsed') || s.includes('applied') || s.includes('screen')) {
        badgeClass = 'bg-sky-50 text-sky-800 border-sky-200';
      } else if (s.includes('interview') || s.includes('assessment')) {
        badgeClass = 'bg-indigo-50 text-indigo-800 border-indigo-200';
      } else if (
        s.includes('offer') ||
        s.includes('joined') ||
        s.includes('selected') ||
        s.includes('hired') ||
        s.includes('active') ||
        s.includes('published')
      ) {
        badgeClass = 'bg-emerald-50 text-emerald-800 border-emerald-200';
      } else if (
        s.includes('reject') ||
        s.includes('closed') ||
        s.includes('dropped') ||
        s.includes('hold')
      ) {
        badgeClass = 'bg-rose-50 text-rose-800 border-rose-200';
      }
      return (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${badgeClass}`}
        >
          {strVal}
        </span>
      );
    }

    // 6. Priority: Immediate / Urgent / High / Medium / Low
    const isPriorityHeader = /priority/i.test(headerLower);
    if (isPriorityHeader && trimmed.length > 0) {
      const p = trimmed.toLowerCase();
      let priorityClass = 'bg-slate-100 text-slate-700 border-slate-200';
      if (p.includes('immediate') || p.includes('urgent') || p.includes('high')) {
        priorityClass = 'bg-rose-50 text-rose-800 border-rose-200 font-semibold';
      } else if (p.includes('medium') || p.includes('normal')) {
        priorityClass = 'bg-amber-50 text-amber-800 border-amber-200 font-semibold';
      } else if (p.includes('low')) {
        priorityClass = 'bg-slate-100 text-slate-600 border-slate-200';
      }
      return (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border whitespace-nowrap ${priorityClass}`}
        >
          {strVal}
        </span>
      );
    }

    // 7. PROS and CONS: Google Sheets compact height with (....) and double-tap expansion
    const isProsOrCons = /pros|cons/i.test(headerLower);
    if (isProsOrCons) {
      const isExpanded = cellKey ? !!expandedCells[cellKey] : false;
      const isLongText = strVal.length > 45 || strVal.includes('\n') || strVal.includes(';');

      if (!isLongText) {
        return (
          <div className="text-slate-700 text-sm whitespace-pre-line break-words leading-relaxed">
            {strVal}
          </div>
        );
      }

      if (isExpanded) {
        return (
          <div
            onDoubleClick={() => cellKey && toggleCellExpand(cellKey)}
            onTouchEnd={() => cellKey && handleCellTouch(cellKey)}
            className="bg-orange-50/40 border border-[#FA7014]/50 rounded-lg p-2.5 shadow-xs transition-all cursor-pointer select-text ring-1 ring-[#FA7014]/20"
            title="Double-tap or double-click to collapse"
          >
            <div className="text-slate-800 text-sm whitespace-pre-line break-words leading-relaxed">
              {strVal}
            </div>
          </div>
        );
      }

      // Compact view: small height, text preview with (....)
      return (
        <div
          onDoubleClick={() => cellKey && toggleCellExpand(cellKey)}
          onTouchEnd={() => cellKey && handleCellTouch(cellKey)}
          className="cursor-pointer select-none rounded p-0.5 hover:bg-orange-50/30 transition-colors"
          title="Double-tap or double-click to expand"
        >
          <p className="text-slate-700 text-sm line-clamp-2 leading-relaxed break-words">
            {strVal}
            <span className="inline-block ml-1 font-mono text-xs font-semibold text-slate-400">
              (....)
            </span>
          </p>
        </div>
      );
    }

    // 8. General cell: ENTIRE TEXT VISIBLE!
    // whitespace-pre-line and break-words ensure that multi-line text (e.g. numbered skill lists, JDs, descriptions)
    // is fully shown without truncation or ellipsis, preserving intentional line breaks.
    return (
      <div className="text-slate-700 text-sm whitespace-pre-line break-words leading-relaxed">
        {strVal}
      </div>
    );
  };

  return (
    <div className="flex-1 w-full max-w-[1600px] mx-auto px-4 sm:px-6 xl:px-8 py-6 space-y-5 bg-[#F7F8FA]">
      {/* ---------------------------------------------------- */}
      {/* 1. HEADER SECTION                                     */}
      {/* ---------------------------------------------------- */}
      <div className="bg-transparent rounded-2xl py-1 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-slate-500">
            <span>Talent Acquisition</span><span aria-hidden>›</span><span className="font-semibold text-slate-800">Overview</span>
          </nav>
          <h1 className="text-[28px] leading-tight font-bold text-slate-900 tracking-tight mt-3">
            Talent Acquisition Overview
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            A bird's-eye view of your hiring efforts.
          </p>
        </div>

        {/* Action Controls & External Forms */}
        <div className="flex flex-wrap items-center gap-2.5">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 outline-none">
            {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
          </select>
          {/* External Form Shortcuts */}
          <div className="hidden sm:flex items-center space-x-2 border-r border-slate-200 pr-3 mr-1">
            <button
              type="button"
              onClick={onOpenRequisitions}
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-orange-50 hover:text-[#FA7014] border border-slate-200 transition-all cursor-pointer"
              title="Open hiring requisitions"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />
              <span>Requisitions</span>
            </button>

            <button
              type="button"
              onClick={onOpenOnboarding}
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-orange-50 hover:text-[#FA7014] border border-slate-200 transition-all cursor-pointer"
              title="Open Onboarding"
            >
              <UserCheck className="w-3.5 h-3.5 text-slate-400" />
              <span>Onboarding</span>
            </button>
          </div>

          {/* Refresh Button */}
          <button
            id="btn-refresh-recruitment-data"
            type="button"
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            className={`inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-xs cursor-pointer ${
              isLoading || isRefreshing
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-[#FA7014] hover:bg-[#E65A05] active:scale-[0.99]'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing || isLoading ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <OverviewDashboard refreshKey={refreshCount} days={days} />

      <h2 className="pt-4 text-lg font-bold text-slate-950">Sheet data</h2>
      <p className="-mt-3 text-sm text-slate-600">Recruitment numbers read from your connected Google Sheet.</p>
      <div className="flex flex-wrap items-center gap-2">
        {overviewData?.status === 'OK' && (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Live Google Sheet Connected</span>
          </span>
        )}
        {overviewData?.status === 'NOT_CONFIGURED' && (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            <span>Setup Pending</span>
          </span>
        )}
      </div>


      {/* ---------------------------------------------------- */}
      {/* 2. CONFIGURATION / STATUS BANNER                      */}
      {/* ---------------------------------------------------- */}
      {overviewData?.status === 'NOT_CONFIGURED' && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-5 sm:p-6 text-amber-900 shadow-xs">
          <div className="flex items-start space-x-3.5">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="space-y-2 flex-1">
              <h3 className="text-sm font-black text-amber-950">
                Google Sheet Data Source Configuration Required
              </h3>
              <p className="text-xs text-amber-800 leading-relaxed max-w-3xl">
                The Overview dashboard relies on the designated Google Sheet for live recruitment KPIs, vacancies, and candidate logs. To link your spreadsheet, set the environment variable in your project configuration:
              </p>

              <div className="bg-white/80 border border-amber-200 rounded-xl p-3 font-mono text-xs text-amber-950 space-y-1">
                <div># Add to container environment variables or .env</div>
                <div className="font-bold text-slate-900">
                  GOOGLE_SHEET_ID="your_google_spreadsheet_id_here"
                </div>
              </div>

              <div className="pt-2 text-xs text-amber-800">
                <strong>Expected Worksheet Tabs:</strong>
                <ul className="list-disc list-inside mt-1 space-y-0.5 font-medium">
                  <li>
                    <code className="bg-amber-100/70 px-1 py-0.5 rounded font-mono text-amber-900">Request Data</code> — Contains job requisition openings, statuses, and vacancy counts.
                  </li>
                  <li>
                    <code className="bg-amber-100/70 px-1 py-0.5 rounded font-mono text-amber-900">Candidate Log</code> — Contains applicant identities, applied designations, and recruitment stages.
                  </li>
                </ul>
              </div>

              <div className="pt-2 flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => loadOverview(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-200 text-amber-900 hover:bg-amber-300 transition-colors cursor-pointer"
                >
                  Re-check Connection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {overviewData?.status === 'PERMISSION_DENIED' && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5 sm:p-6 text-rose-900 shadow-xs">
          <div className="flex items-start space-x-3.5">
            <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-sm font-black text-rose-950">
                Google Sheets Permission Denied (403)
              </h3>
              <p className="text-xs text-rose-800 leading-relaxed">
                The spreadsheet ID (<code className="font-mono">{overviewData.spreadsheetIdMasked}</code>) was reached, but access was denied by Google. Please ensure the spreadsheet is shared with Viewer permissions or made accessible to the automation account.
              </p>
              <button
                type="button"
                onClick={() => loadOverview(true)}
                className="mt-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-200 text-rose-900 hover:bg-rose-300 transition-colors cursor-pointer"
              >
                Retry Request
              </button>
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => loadOverview(true)}
            className="text-rose-900 underline hover:no-underline font-bold"
          >
            Retry
          </button>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 3. KPI CARDS SECTION                                 */}
      {/* ---------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([
          { label: 'Open Positions', icon: Briefcase, tone: 'from-violet-100/80 to-indigo-50', chip: 'bg-violet-100 text-violet-600', value: overviewData?.kpis?.openPositions, note: 'Active requisition postings' },
          { label: 'Total Vacancies', icon: Users, tone: 'from-sky-100/80 to-blue-50', chip: 'bg-sky-100 text-sky-600', value: overviewData?.kpis?.totalVacancies, note: 'Total approved headcounts' },
          { label: 'Total Applications', icon: UserCheck, tone: 'from-emerald-100/70 to-green-50', chip: 'bg-emerald-100 text-emerald-600', value: selectedDesignation !== 'ALL' ? filteredMetrics.applicationsCount : overviewData?.kpis?.totalApplications, note: selectedDesignation === 'ALL' ? 'All logged candidates' : `Filtered by: ${selectedDesignation}` },
          { label: 'Hiring Departments', icon: Building2, tone: 'from-orange-100/80 to-amber-50', chip: 'bg-orange-100 text-[#F36B21]', value: overviewData?.kpis?.departmentsCount, note: 'Active business functions' },
        ] as const).map((t) => (
          <div key={t.label} className={`flex items-center gap-3 rounded-2xl border border-white bg-gradient-to-br px-4 py-3.5 ${t.tone}`}>
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${t.chip}`}><t.icon className="h-6 w-6" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-3xl font-bold leading-tight tabular-nums text-slate-950">
                {isLoading ? <span className="inline-block h-8 w-16 animate-pulse rounded-lg bg-white/70" /> : t.value !== null && t.value !== undefined ? t.value : <span className="text-lg text-slate-400">—</span>}
              </span>
              <span className="block truncate text-sm text-slate-700">{t.label}</span>
              <span className="block truncate text-[11px] text-slate-500">{t.note}</span>
            </span>
          </div>
        ))}
      </div>

      {/* ---------------------------------------------------- */}
      {/* 4. DESIGNATION FILTER & VISUAL ANALYTICS              */}
      {/* ---------------------------------------------------- */}
      <div className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-950 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-violet-600" />
              <span>Applications by Designation</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Dynamic distribution of candidate applications across job designations.
            </p>
          </div>

          {/* Dynamic Designation Filter */}
          <div className="flex items-center space-x-2">
            <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <label htmlFor="designation-filter-select" className="text-xs font-bold text-slate-700 whitespace-nowrap">
              Filter by Designation:
            </label>
            <select
              id="designation-filter-select"
              value={selectedDesignation}
              onChange={(e) => setSelectedDesignation(e.target.value)}
              className="text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-300/40 focus:border-violet-400 cursor-pointer"
            >
              <option value="ALL">
                All Designations ({overviewData?.designations?.length || 0})
              </option>
              {overviewData?.designations?.map((desig) => (
                <option key={desig} value={desig}>
                  {desig}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Horizontal Bar Chart: Applications by Designation */}
        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
            <span className="text-xs text-slate-500 font-medium">Loading recruitment charts...</span>
          </div>
        ) : filteredMetrics.chartData.length === 0 ? (
          <div className="py-10 text-center text-slate-400 text-xs">
            {overviewData?.status === 'OK'
              ? 'No candidate applications found for the selected filter.'
              : 'Recruitment data will appear here once Google Sheets is synchronized.'}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMetrics.chartData.slice(0, 8).map((item) => {
              const maxCount = Math.max(...filteredMetrics.chartData.map(c => c.count), 1);
              const percentage = Math.round((item.count / maxCount) * 100);
              const isFilteredMatch = selectedDesignation !== 'ALL';

              return (
                <div key={item.designation} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 truncate max-w-xs sm:max-w-md">
                      {item.designation}
                    </span>
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] font-mono text-slate-400">
                        {item.count} {item.count === 1 ? 'applicant' : 'applicants'}
                      </span>
                      <span className="text-xs font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md font-mono min-w-8 text-center">
                        {item.count}
                      </span>
                    </div>
                  </div>
                  <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isFilteredMatch ? 'bg-[#6d4cf0]' : 'bg-[#8b6cf3] hover:bg-[#6d4cf0]'
                      }`}
                      style={{ width: `${Math.max(percentage, 4)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Secondary Analytical Cards (Department) */}
        {overviewData?.status === 'OK' && (
          <div className="pt-4 border-t border-slate-100">
            {/* Department Breakdown */}
            <div className="bg-slate-50/70 rounded-2xl p-4 border border-slate-200">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center justify-between">
                <span>Positions by Department</span>
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
              </h3>
              {overviewData.positionsByDepartment && overviewData.positionsByDepartment.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {overviewData.positionsByDepartment.map(dept => (
                    <div key={dept.department} className="flex items-center justify-between text-xs bg-white p-2.5 rounded-lg border border-slate-200/60 shadow-2xs">
                      <span className="font-medium text-slate-700 truncate">{dept.department}</span>
                      <div className="flex items-center space-x-2 font-mono text-[11px]">
                        <span className="text-slate-500">{dept.openPositions} pos</span>
                        <span className="font-bold text-violet-600 bg-orange-50 px-1.5 py-0.5 rounded">
                          {dept.vacancies} vac
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">Department data not specified in Request Data.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* AI-POWERED CANDIDATE EVALUATION & RECOMMENDATION SECTION     */}
      {/* Positioned immediately below Explore Sheet Data section      */}
      {/* ============================================================ */}
      <CandidateEvaluationSection
        currentUser={currentUser}
        activeDesignation={
          activeSheetTab || (visibleSheetTabs.length > 0 ? visibleSheetTabs[0] : 'Performance Marketing Expert')
        }
        availableDesignations={visibleSheetTabs}
        onSelectDesignation={(newDesig) => {
          setActiveSheetTab(newDesig);
          setSelectedStatusFilter('ALL');
          setSheetSearchQuery('');
          setCurrentPage(1);
        }}
        parentRefreshCount={refreshCount}
      />
    </div>
  );
};
