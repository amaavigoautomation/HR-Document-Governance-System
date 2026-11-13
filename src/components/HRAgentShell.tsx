import React, { useState, useEffect, useRef } from 'react';
import { homeService } from '../services/homeService';
import { toProfilePhoto } from '../utils/profilePhoto';
import {
  Layers,
  ListChecks,
  Users,
  LayoutDashboard,
  FileSpreadsheet,
  UserCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Bot,
  Menu,
  X,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
  Camera,
  HelpCircle,
  Shield,
  KeyRound,
  Sparkles,
  Settings2,
  CalendarDays,
  Wallet,
  Target,
  Home,
  FileCheck2,
  ClipboardList,
  Contact,
  Workflow,
  Search,
  Bell,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';
import { LeaveSubNav } from './leave/LeaveSubNav';
import { useLeaveNav, resolveSection as resolveLeaveSection } from './leave/leaveNav';
import { NavBadge } from './NavBadge';
import { sumOf, useNavBadges } from '../services/navBadges';
import { ModuleSubNav } from './moduleNav';
import { payrollNav } from './payroll/payrollNav';
import { peopleNav } from './lifecycle/peopleNav';
import { hrbpNav } from './hrbp/hrbpNav';
import { pmNav } from './pm/pmNav';
import { taskNav } from './tasks/taskNav';
import { flowNav } from './hiringflow/flowNav';
import { employeeNav } from './employee/employeeNav';
import {
  hasModulePermission,
  getAuthorizationLabel,
  getAuthorizationBadgeText,
  normalizeAuthorizedModules,
} from '../utils/authorization';
import { hasAnyPerm } from '../../shared/permissions';
import { AskHrPanel, openAskHr } from './assistant/AskHrPanel';

export type HRAgentModule =
  | 'home'
  | 'policies'
  | 'document-version-control'
  | 'talent-acquisition'
  | 'talent-acquisition-overview'
  | 'talent-acquisition-requisitions'
  | 'talent-acquisition-applications'
  | 'talent-acquisition-pipeline'
  | 'talent-acquisition-onboarding'
  | 'my-hiring'
  | 'hrbp'
  | 'performance'
  | 'tasks'
  | 'hiring-automation'
  | 'leave-management'
  | 'payroll'
  | 'people'
  | 'employee'
  | 'administration';

interface HRAgentShellProps {
  currentUser: User;
  activeModule: HRAgentModule;
  onSelectModule: (module: HRAgentModule) => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onLogout?: () => void;
  onRefreshData?: () => void;
  /** Policies the person still has to acknowledge (badge on "My policies"). */
  pendingPolicyCount?: number;
  /** Opens the notifications drawer (the bell in the top bar). */
  onOpenNotifications?: () => void;
  /** Unread notifications: shows a dot on the bell. */
  notificationCount?: number;
  children: React.ReactNode;
}


export const HRAgentShell: React.FC<HRAgentShellProps> = ({
  currentUser,
  activeModule,
  onSelectModule,
  isSidebarOpen,
  onToggleSidebar,
  onLogout,
  onRefreshData,
  pendingPolicyCount = 0,
  onOpenNotifications,
  notificationCount = 0,
  children,
}) => {
  const isHR = currentUser.role === UserRole.CREATOR;

  // Check authorization in database for Talent Acquisition & Document Version Control
  const hasTalentAccess = hasModulePermission(currentUser, 'talent-acquisition');
  const hasDocGovAccess = hasModulePermission(currentUser, 'document-version-control');
  const authorizedCount = (hasTalentAccess ? 1 : 0) + (hasDocGovAccess ? 1 : 0);

  // Company administration (people, departments, roles) is available to anyone holding an admin permission
  const hasAdminAccess = hasAnyPerm(currentUser.perms, ['users.manage', 'departments.manage', 'roles.manage']);

  // Everyone has a Home; the rest of these links follow what the person is allowed to do.
  const canAcknowledge = hasAnyPerm(currentUser.perms, ['doc.acknowledge']);
  // Department heads are employees who may raise hiring requests; the full Talent module stays hidden from them.
  const hasRequestOnlyHiring = currentUser.role === UserRole.EMPLOYEE && hasAnyPerm(currentUser.perms, ['req.create']);

  // Talent Acquisition expanded state in left navigation
  const [isTalentAcquisitionExpanded, setIsTalentAcquisitionExpanded] = useState<boolean>(true);
  const [isLeaveExpanded, setIsLeaveExpanded] = useState<boolean>(true);
  const [isPayrollExpanded, setIsPayrollExpanded] = useState<boolean>(true);
  const [isPeopleExpanded, setIsPeopleExpanded] = useState<boolean>(true);
  const [isEmployeeExpanded, setIsEmployeeExpanded] = useState<boolean>(true);
  const [isHrbpExpanded, setIsHrbpExpanded] = useState<boolean>(true);
  const [isPmExpanded, setIsPmExpanded] = useState<boolean>(true);
  const [isTaskExpanded, setIsTaskExpanded] = useState<boolean>(true);
  const [isFlowExpanded, setIsFlowExpanded] = useState<boolean>(true);
  // Counts of what is waiting for this person, shown on the module titles and their sections.
  const badges = useNavBadges();

  // Mobile sidebar drawer state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  // Auto-redirect if currently selected module is not permitted
  useEffect(() => {
    if (activeModule === 'home' || activeModule === 'policies') return;
    if (activeModule === 'administration' || activeModule === 'leave-management' || activeModule === 'payroll' || activeModule === 'people' || activeModule === 'employee' || activeModule === 'my-hiring' || activeModule === 'hrbp' || activeModule === 'performance' || activeModule === 'tasks' || activeModule === 'hiring-automation') return;
    if (activeModule === 'document-version-control' && !hasDocGovAccess && hasTalentAccess) {
      onSelectModule('talent-acquisition-overview');
    } else if (
      (activeModule === 'talent-acquisition' ||
        activeModule === 'talent-acquisition-overview' ||
        activeModule === 'talent-acquisition-requisitions' ||
        activeModule === 'talent-acquisition-applications' ||
        activeModule === 'talent-acquisition-pipeline' ||
        activeModule === 'talent-acquisition-onboarding') &&
      !hasTalentAccess &&
      hasDocGovAccess
    ) {
      onSelectModule('document-version-control');
    }
  }, [activeModule, hasTalentAccess, hasDocGovAccess, onSelectModule]);

  // Pages this person can open: used for the top bar title and the "go to a page" search.
  const pages: { id: HRAgentModule; label: string }[] = ([
    { id: 'home', label: 'Home', show: true },
    { id: 'policies', label: 'My policies', show: canAcknowledge },
    { id: 'talent-acquisition-requisitions', label: 'Hiring requests', show: hasRequestOnlyHiring },
    { id: 'talent-acquisition-overview', label: 'Talent Acquisition', show: hasTalentAccess },
    { id: 'document-version-control', label: 'Document Version Control', show: hasDocGovAccess },
    { id: 'leave-management', label: 'Leave & Attendance', show: true },
    { id: 'payroll', label: 'Payroll', show: true },
    { id: 'my-hiring', label: 'Referrals & interviews', show: true },
    { id: 'hrbp', label: 'HR Business Partner', show: true },
    { id: 'performance', label: 'Performance', show: true },
    { id: 'tasks', label: 'Tasks', show: true },
    { id: 'hiring-automation', label: 'Hiring Automation', show: true },
    { id: 'people', label: 'People', show: true },
    { id: 'employee', label: 'Employee', show: true },
    { id: 'administration', label: 'Administration', show: hasAdminAccess },
  ] as { id: HRAgentModule; label: string; show: boolean }[]).filter((p) => p.show);
  const pageTitle = pages.find((p) => p.id === activeModule)?.label
    || (activeModule.startsWith('talent-acquisition') ? 'Talent Acquisition' : 'HR Platform');

  // Top bar breadcrumb: "Section › Page". The page is whatever is open in that module's sidebar menu.
  const leaveState = useLeaveNav();
  const payrollState = payrollNav.useNav();
  const peopleState = peopleNav.useNav();
  const pmState = pmNav.useNav();
  const taskState = taskNav.useNav();
  const flowState = flowNav.useNav();
  const hrbpState = hrbpNav.useNav();
  const employeeState = employeeNav.useNav();
  const labelOf = (nav: { resolve: (s: string, i: any[]) => string }, st: { section: string; items: { key: string; label: string }[] }) => {
    if (!st.items.length) return '';
    const key = nav.resolve(st.section, st.items);
    return st.items.find((i) => i.key === key)?.label || '';
  };
  const TA_PAGES: Record<string, string> = {
    'talent-acquisition': 'Overview',
    'talent-acquisition-overview': 'Overview',
    'talent-acquisition-requisitions': 'Requisitions',
    'talent-acquisition-applications': 'Applications',
    'talent-acquisition-pipeline': 'Hiring pipeline',
    'talent-acquisition-onboarding': 'Onboarding',
  };
  const crumb: { section: string; page: string } | null = (() => {
    if (activeModule === 'home') return null;
    if (activeModule.startsWith('talent-acquisition')) {
      if (activeModule === 'talent-acquisition-requisitions' && !hasTalentAccess) return { section: pageTitle, page: '' };
      return { section: 'Talent Acquisition', page: TA_PAGES[activeModule] || '' };
    }
    let page = '';
    if (activeModule === 'leave-management') {
      page = leaveState.items.find((i) => i.key === resolveLeaveSection(leaveState.section, leaveState.items))?.label || '';
    }
    else if (activeModule === 'payroll') page = labelOf(payrollNav, payrollState);
    else if (activeModule === 'people') page = labelOf(peopleNav, peopleState);
    else if (activeModule === 'performance') page = labelOf(pmNav, pmState);
    else if (activeModule === 'tasks') page = labelOf(taskNav, taskState);
    else if (activeModule === 'hiring-automation') page = labelOf(flowNav, flowState);
    else if (activeModule === 'hrbp') page = labelOf(hrbpNav, hrbpState);
    else if (activeModule === 'employee') page = labelOf(employeeNav, employeeState);
    return { section: pageTitle, page };
  })();
  const [pageQuery, setPageQuery] = useState('');
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [photo, setPhoto] = useState('');
  const [photoMsg, setPhotoMsg] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  // Docked "HR AI Agent" tab: can be dragged up and down the left edge; the position is remembered in this browser.
  const DOCK_KEY = 'hr-agent-dock-top';
  const DOCK_MIN = 64;
  const dockBtn = useRef<HTMLButtonElement>(null);
  const dockDrag = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null);
  const dockSkipClick = useRef(false);
  const clampDock = (top: number) => {
    const h = dockBtn.current?.offsetHeight || 36;
    return Math.max(DOCK_MIN, Math.min(top, Math.max(DOCK_MIN, window.innerHeight - h - 8)));
  };
  const [dockTop, setDockTop] = useState<number>(() => {
    try { const v = Number(localStorage.getItem(DOCK_KEY)); if (Number.isFinite(v) && v > 0) return v; } catch { /* storage blocked: use the default */ }
    return 80;
  });
  useEffect(() => {
    const fit = () => setDockTop((t) => clampDock(t));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const onDockDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dockSkipClick.current = false;
    dockDrag.current = { startY: e.clientY, startTop: dockTop, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDockMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dockDrag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 5) return;
    d.moved = true;
    setDockTop(clampDock(d.startTop + dy));
  };
  const onDockUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dockDrag.current;
    dockDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d?.moved) {
      dockSkipClick.current = true;
      try { localStorage.setItem(DOCK_KEY, String(dockTop)); } catch { /* storage blocked: position lasts until reload */ }
    }
  };
  useEffect(() => { homeService.myPhoto().then((r) => setPhoto(r.photo || '')).catch(() => undefined); }, [currentUser.id]);
  const choosePhoto = async (file?: File | null) => {
    if (!file) return;
    setPhotoMsg('Saving…');
    try { const p = await toProfilePhoto(file); const r = await homeService.saveMyPhoto(p); setPhoto(r.photo || p); setPhotoMsg(''); }
    catch (e: any) { setPhotoMsg(e?.message || 'Could not save the photo.'); }
    if (photoInput.current) photoInput.current.value = '';
  };
  const removePhoto = async () => { setPhotoMsg('Removing…'); try { await homeService.saveMyPhoto(''); setPhoto(''); setPhotoMsg(''); } catch (e: any) { setPhotoMsg(e?.message || 'Could not remove the photo.'); } };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const el = document.getElementById('topbar-page-search') as HTMLInputElement | null;
        if (el && el.offsetParent !== null) { e.preventDefault(); el.focus(); el.select(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pageMatches = pageQuery.trim() ? pages.filter((p) => p.label.toLowerCase().includes(pageQuery.trim().toLowerCase())).slice(0, 6) : [];
  const initial = (currentUser.name || 'U').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join('') || 'U';

  const displayId = currentUser.empId || currentUser.loginId || currentUser.id || '';
  const authLabel = hasTalentAccess && hasDocGovAccess ? 'All Modules' : hasTalentAccess ? 'Talent Acquisition' : hasDocGovAccess ? 'Document Version Control' : 'Employee Portal';

  return (
    <div className="h-screen w-full bg-[#F8FAFC] flex flex-col font-sans text-slate-900 overflow-hidden">
      {/* MOBILE TOP BAR (Only visible on small screens to toggle sidebar) */}
      <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30 shadow-2xs shrink-0">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
            className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Toggle Navigation Sidebar"
          >
            {isMobileSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex items-center space-x-2">
            <AmaavigoLogo size="sm" variant="mark" theme="light" height={28} />
            <div className="flex flex-col">
              <span className="font-extrabold text-sm text-slate-900 tracking-tight flex items-center gap-1.5">
                HR AI Agent
                <span className="bg-[#FA7014]/10 text-[#FA7014] text-[9px] px-1.5 py-0.2 rounded font-bold border border-[#FA7014]/20">
                  Platform
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-slate-600 font-mono bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
            {displayId}
          </span>
          {onLogout && <button type="button" onClick={onLogout} aria-label="Log out" title="Log out" className="p-2 rounded-lg text-slate-600 hover:text-rose-600 hover:bg-slate-100 cursor-pointer"><LogOut className="w-4 h-4" /></button>}
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* MOBILE BACKDROP */}
        {isMobileSidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-40 lg:hidden"
            onClick={() => setIsMobileSidebarOpen(false)}
          />
        )}

        {/* DOCKED OPEN BUTTON (When sidebar is collapsed on desktop) */}
        {!isSidebarOpen && (
          <button
            id="btn-open-sidebar-docked"
            ref={dockBtn}
            type="button"
            onClick={() => { if (dockSkipClick.current) { dockSkipClick.current = false; return; } onToggleSidebar?.(); }}
            onPointerDown={onDockDown}
            onPointerMove={onDockMove}
            onPointerUp={onDockUp}
            onPointerCancel={onDockUp}
            style={{ top: dockTop }}
            className="hidden lg:flex fixed left-0 z-40 touch-none select-none bg-white/95 backdrop-blur-xs border border-l-0 border-slate-200 shadow-md py-2 px-3 rounded-r-xl hover:bg-orange-50 hover:text-[#FA7014] hover:border-orange-300 items-center gap-2 text-xs font-bold text-slate-700 transition-colors cursor-pointer group"
            title="Open HR AI Agent side panel (drag to move up or down)"
            aria-label="Open HR AI Agent side panel"
          >
            <PanelLeftOpen className="w-4 h-4 text-slate-500 group-hover:text-[#FA7014] transition-colors" />
            <span className="text-[11px] font-bold tracking-tight">HR AI Agent</span>
          </button>
        )}

        {/* ============================================================ */}
        {/* LEFT SIDEBAR: HR AI AGENT MAIN NAVIGATION                   */}
        {/* ============================================================ */}
        <aside
          id="hr-agent-sidebar"
          className={`
            fixed lg:static inset-y-0 left-0 z-50 lg:z-30
            h-full shrink-0
            relative overflow-hidden bg-gradient-to-b from-[#1a1b36] via-[#1a1c3b] to-[#171a3f] border-r border-white/5
            flex flex-col
            transition-all duration-200 ease-in-out
            ${
              isMobileSidebarOpen
                ? 'translate-x-0 w-56'
                : '-translate-x-full lg:translate-x-0'
            }
            ${
              isSidebarOpen
                ? 'lg:w-56 lg:border-r lg:opacity-100'
                : 'lg:w-0 lg:border-r-0 lg:overflow-hidden lg:pointer-events-none lg:opacity-0'
            }
          `}
        >
          {/* Top Section: Branding & Navigation Tree */}
          <div className="relative z-10 flex flex-col flex-1 min-h-0 overflow-y-auto min-w-[14rem]">
            {/* Platform Brand Header */}
            <div className="px-4 pt-4 pb-2 flex flex-col gap-3 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0"><AmaavigoLogo size="md" variant="mark" theme="dark" height={26} className="shrink-0" /><div className="text-[15px] font-bold tracking-tight text-white">Amaavigo HR</div></div>
                
                <div className="flex items-center space-x-1">
                  {/* Desktop close button to collapse left side panel */}
                  <button
                    id="btn-close-sidebar-desktop"
                    type="button"
                    onClick={onToggleSidebar}
                    className="hidden lg:flex p-1.5 rounded-lg text-indigo-200/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    title="Close left side panel"
                    aria-label="Close left side panel"
                  >
                    <PanelLeftClose className="w-5 h-5" />
                  </button>

                  {/* Mobile close button */}
                  <button
                    type="button"
                    onClick={() => setIsMobileSidebarOpen(false)}
                    className="lg:hidden p-1.5 rounded-lg text-indigo-200/70 hover:text-white hover:bg-white/10 cursor-pointer"
                    title="Close navigation"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

            </div>

            {/* Navigation Category Tree */}
            <div className="px-3 py-3 flex-1 flex flex-col min-h-0 space-y-3">
              <nav className="space-y-0.5 flex-1">
                {/* HOME: every person's own dashboard */}
                {([
                  { id: 'home' as const, label: 'Home', hint: 'What needs you today', icon: Home, show: true, badge: 0 },
                  { id: 'policies' as const, label: 'My policies', hint: 'Read and acknowledge', icon: FileCheck2, show: canAcknowledge, badge: pendingPolicyCount },
                  { id: 'talent-acquisition-requisitions' as const, label: 'Hiring requests', hint: 'Ask for a new hire', icon: ClipboardList, show: hasRequestOnlyHiring, badge: 0 },
                ]).filter((n) => n.show).map((n) => {
                  const active = activeModule === n.id;
                  const Icon = n.icon;
                  return (
                    <button
                      key={n.id}
                      id={`nav-module-${n.id}`}
                      type="button"
                      onClick={() => { onSelectModule(n.id); setIsMobileSidebarOpen(false); }}
                      className={`w-full px-2.5 py-2 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                        active ? 'bg-gradient-to-r from-[#5f4fcf] to-[#7566dd] border-transparent shadow-md shadow-black/20' : 'bg-transparent border-transparent hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-transparent text-white' : 'bg-transparent text-slate-300'}`}>
                          <Icon className="w-[15px] h-[15px]" />
                        </div>
                        <div className="truncate">
                          <span className={`text-[12px] font-medium block truncate ${active ? 'text-white' : 'text-slate-100'}`}>{n.label}</span>
                          <span className="hidden">{n.hint}</span>
                        </div>
                      </div>
                      {n.badge > 0 && <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-white text-violet-700 text-[10px] font-bold flex items-center justify-center">{n.badge}</span>}
                    </button>
                  );
                })}
                {/* ---------------------------------------------------- */}
                {/* 1. TALENT ACQUISITION (Authorized check)             */}
                {/* ---------------------------------------------------- */}
                {hasTalentAccess && (
                  <div className="rounded-xl overflow-hidden transition-all">
                    {/* Expandable Category Toggle Button */}
                    <button
                      id="nav-category-talent-acquisition"
                      type="button"
                      onClick={() => setIsTalentAcquisitionExpanded(!isTalentAcquisitionExpanded)}
                      className="w-full px-2.5 py-2 rounded-xl flex items-center justify-between text-left hover:bg-white/10 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center space-x-2.5">
                        <div className="w-6 h-6 rounded-lg bg-transparent text-slate-300 group-hover:text-white flex items-center justify-center shrink-0">
                          <Users className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-[12px] font-medium text-slate-100 group-hover:text-white block leading-tight">
                            Talent Acquisition
                          </span>
                          
                        </div>
                      </div>
                      <div className="text-slate-400 group-hover:text-slate-200 transition-transform">
                        {isTalentAcquisitionExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </div>
                    </button>

                    {/* Subcategories (Overview, Requisition Form & Candidate Onboarding Form) */}
                    {isTalentAcquisitionExpanded && (
                      <div className="pl-4 pr-1 pb-1 pt-1 space-y-0.5">
                        {/* Sub-item 1: Overview Dashboard */}
                        <button
                          id="nav-submodule-talent-overview"
                          type="button"
                          onClick={() => {
                            onSelectModule('talent-acquisition-overview');
                            setIsMobileSidebarOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-overview' || activeModule === 'talent-acquisition'
                              ? 'bg-white/15 text-white font-bold'
                              : 'text-slate-300 hover:text-white hover:bg-white/10'
                          }`}
                          title="View Talent Acquisition Recruitment Overview Dashboard"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                                activeModule === 'talent-acquisition-overview' || activeModule === 'talent-acquisition'
                                  ? 'bg-white'
                                  : 'bg-white/30'
                              }`}
                            />
                            <LayoutDashboard
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                activeModule === 'talent-acquisition-overview' || activeModule === 'talent-acquisition'
                                  ? 'text-white'
                                  : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">Overview</span>
                          </div>
                          {(activeModule === 'talent-acquisition-overview' || activeModule === 'talent-acquisition') && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                          )}
                        </button>

                        {/* Sub-item 2: Requisitions (native hiring workflow) */}
                        <button
                          id="nav-submodule-talent-requisitions"
                          type="button"
                          onClick={() => {
                            onSelectModule('talent-acquisition-requisitions');
                            setIsMobileSidebarOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-requisitions'
                              ? 'bg-white/15 text-white font-bold'
                              : 'text-slate-300 hover:text-white hover:bg-white/10'
                          }`}
                          title="Hiring requisitions: request, approve and publish new roles"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                                activeModule === 'talent-acquisition-requisitions' ? 'bg-white' : 'bg-white/30'
                              }`}
                            />
                            <FileSpreadsheet
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                activeModule === 'talent-acquisition-requisitions' ? 'text-white' : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">Requisitions</span>
                          </div>
                          {activeModule === 'talent-acquisition-requisitions' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                          )}
                        </button>

                        {/* Sub-item: Applications (webhook, manual add, CSV import) */}
                        <button
                          id="nav-submodule-talent-applications"
                          type="button"
                          onClick={() => {
                            onSelectModule('talent-acquisition-applications');
                            setIsMobileSidebarOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-applications'
                              ? 'bg-white/15 text-white font-bold'
                              : 'text-slate-300 hover:text-white hover:bg-white/10'
                          }`}
                          title="Candidate applications: webhook, manual entry and CSV import"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                                activeModule === 'talent-acquisition-applications' ? 'bg-white' : 'bg-white/30'
                              }`}
                            />
                            <UserCheck
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                activeModule === 'talent-acquisition-applications' ? 'text-white' : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">Applications</span>
                          </div>
                        </button>

                        {/* Sub-item: Hiring pipeline (score, screening, assessments, interviews, postings, referrals) */}
                        <button
                          id="nav-submodule-talent-pipeline"
                          type="button"
                          onClick={() => {
                            onSelectModule('talent-acquisition-pipeline');
                            setIsMobileSidebarOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-pipeline'
                              ? 'bg-white/15 text-white font-bold'
                              : 'text-slate-300 hover:text-white hover:bg-white/10'
                          }`}
                          title="Candidate scores, screening, assessments, interviews, job postings and referrals"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${activeModule === 'talent-acquisition-pipeline' ? 'bg-white' : 'bg-white/30'}`} />
                            <ClipboardList className={`w-3.5 h-3.5 shrink-0 transition-colors ${activeModule === 'talent-acquisition-pipeline' ? 'text-white' : 'text-slate-400'}`} />
                            <span className="truncate">Hiring pipeline</span>
                          </div>
                        </button>

                        {/* Sub-item 3: Onboarding (native workflow, replaces the n8n form) */}
                        <button
                          id="nav-submodule-talent-onboarding"
                          type="button"
                          onClick={() => {
                            onSelectModule('talent-acquisition-onboarding');
                            setIsMobileSidebarOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-onboarding'
                              ? 'bg-white/15 text-white font-bold'
                              : 'text-slate-300 hover:text-white hover:bg-white/10'
                          }`}
                          title="Onboard selected candidates"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                                activeModule === 'talent-acquisition-onboarding' ? 'bg-white' : 'bg-white/30'
                              }`}
                            />
                            <UserCheck
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                activeModule === 'talent-acquisition-onboarding' ? 'text-white' : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">Onboarding</span>
                          </div>
                          {activeModule === 'talent-acquisition-onboarding' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ---------------------------------------------------- */}
                {/* 2. DOCUMENT VERSION CONTROL (Authorized check)       */}
                {/* ---------------------------------------------------- */}
                {hasDocGovAccess && (
                  <button
                    id="nav-module-document-version-control"
                    type="button"
                    onClick={() => {
                      onSelectModule('document-version-control');
                      setIsMobileSidebarOpen(false);
                    }}
                    className={`w-full px-2.5 py-2 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                      activeModule === 'document-version-control'
                        ? 'bg-gradient-to-r from-[#6c4de6] to-[#8567f4] border-transparent text-white shadow-lg shadow-black/30'
                        : 'bg-transparent border-transparent text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div
                        className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                          activeModule === 'document-version-control'
                            ? 'bg-white/20 text-white'
                            : 'bg-white/10 text-slate-300'
                        }`}
                      >
                        <Layers className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`text-[12px] font-medium block truncate ${
                              activeModule === 'document-version-control'
                                ? 'text-white'
                                : 'text-slate-100'
                            }`}
                          >
                            Document Version Control
                          </span>
                        </div>
                        <span className="hidden">
                          {isHR ? 'Policy Governance & Lifecycle' : 'Review & Authorizations'}
                        </span>
                      </div>
                    </div>

                    {activeModule === 'document-version-control' && (
                      <div className="w-5 h-5 rounded-full bg-white text-violet-700 flex items-center justify-center shrink-0 ml-1.5">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </button>
                )}

                {/* ---------------------------------------------------- */}
                {/* LEAVE & ATTENDANCE (every role)                      */}
                {/* ---------------------------------------------------- */}
                <div className="relative">
                <button
                  id="nav-module-leave-management"
                  type="button"
                  onClick={() => {
                    onSelectModule('leave-management');
                    setIsLeaveExpanded(true);
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`w-full ${activeModule === 'leave-management' ? 'pl-3 pr-10' : 'px-3'} py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    activeModule === 'leave-management'
                      ? 'bg-gradient-to-r from-[#6c4de6] to-[#8567f4] border-transparent text-white shadow-lg shadow-black/30'
                      : 'bg-transparent border-transparent text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'leave-management' ? 'bg-transparent text-white' : 'bg-transparent text-slate-300'
                      }`}
                    >
                      <CalendarDays className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-[12px] font-medium block truncate ${activeModule === 'leave-management' ? 'text-white' : 'text-slate-100'}`}>
                        Leave &amp; Attendance
                      </span>
                      <span className="hidden">Leave, holidays, attendance &amp; approvals</span>
                    </div>
                  </div>
                  <NavBadge tone="dark" count={sumOf(badges.leave)} className="ml-1.5" />
                  {activeModule === 'leave-management' && (
                    <div className="w-5 h-5 rounded-full bg-white text-violet-700 flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule !== 'leave-management' && <ChevronRight aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                {activeModule === 'leave-management' && (
                  <button
                    id="nav-module-leave-toggle"
                    type="button"
                    onClick={() => setIsLeaveExpanded((v) => !v)}
                    aria-expanded={isLeaveExpanded}
                    aria-label={isLeaveExpanded ? 'Hide leave sections' : 'Show leave sections'}
                    title={isLeaveExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 cursor-pointer"
                  >
                    {isLeaveExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
                </div>

                {/* Leave sections (Today, My leave, Attendance, Team calendar, Approvals, Manage) */}
                {activeModule === 'leave-management' && isLeaveExpanded && (
                  <LeaveSubNav variant="sidebar" counts={badges.leave} onNavigate={() => setIsMobileSidebarOpen(false)} />
                )}

                {/* ---------------------------------------------------- */}
                {/* PAYROLL (everyone sees payslips; payroll.* sees more) */}
                {/* ---------------------------------------------------- */}
                <div className="relative">
                <button
                  id="nav-module-payroll"
                  type="button"
                  onClick={() => {
                    onSelectModule('payroll');
                    setIsPayrollExpanded(true);
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`w-full ${activeModule === 'payroll' ? 'pl-3 pr-10' : 'px-3'} py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    activeModule === 'payroll'
                      ? 'bg-gradient-to-r from-[#6c4de6] to-[#8567f4] border-transparent text-white shadow-lg shadow-black/30'
                      : 'bg-transparent border-transparent text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'payroll' ? 'bg-transparent text-white' : 'bg-transparent text-slate-300'
                      }`}
                    >
                      <Wallet className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-[12px] font-medium block truncate ${activeModule === 'payroll' ? 'text-white' : 'text-slate-100'}`}>
                        Payroll
                      </span>
                      <span className="hidden">Payslips, salary runs &amp; statutory setup</span>
                    </div>
                  </div>
                  <NavBadge tone="dark" count={sumOf(badges.payroll)} className="ml-1.5" />
                  {activeModule === 'payroll' && (
                    <div className="w-5 h-5 rounded-full bg-white text-violet-700 flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule !== 'payroll' && <ChevronRight aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                {activeModule === 'payroll' && (
                  <button
                    id="nav-module-payroll-toggle"
                    type="button"
                    onClick={() => setIsPayrollExpanded((v) => !v)}
                    aria-expanded={isPayrollExpanded}
                    aria-label={isPayrollExpanded ? 'Hide payroll sections' : 'Show payroll sections'}
                    title={isPayrollExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 cursor-pointer"
                  >
                    {isPayrollExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
                </div>

                {activeModule === 'payroll' && isPayrollExpanded && (
                  <ModuleSubNav nav={payrollNav} counts={badges.payroll} label="Payroll sections" variant="sidebar" idPrefix="nav-submodule-payroll" onNavigate={() => setIsMobileSidebarOpen(false)} />
                )}

                {/* ---------------------------------------------------- */}
                {/* MY HIRING (everyone: refer a candidate, interviews you are on) and HRBP (HR business partners) */}
                {/* ---------------------------------------------------- */}
                {([
                  { key: 'my-hiring' as const, title: 'Referrals & interviews', sub: 'Refer people, give interview feedback', Icon: Users, show: true },
                  { key: 'hrbp' as const, title: 'HR Business Partner', sub: (hasAnyPerm(currentUser.perms, ['hrbp.manage', 'hrbp.view']) || !!currentUser.isCompanyAdmin) ? 'Org, talent, engagement & succession' : 'Surveys, recognition, learning & wellness', Icon: Layers, show: true },
                  { key: 'performance' as const, title: 'Performance', sub: 'Targets, reviews, check-ins & growth', Icon: Check, show: true },
                  { key: 'tasks' as const, title: 'Tasks', sub: 'My tasks, boards & dashboards', Icon: ListChecks, show: true },
                  { key: 'hiring-automation' as const, title: 'Hiring Automation', sub: 'Your hiring steps, applicants & tasks', Icon: Workflow, show: true },
                ]).filter((m) => m.show).map((m) => (
                  <React.Fragment key={m.key}>
                  <div className="relative">
                  <button
                    id={`nav-module-${m.key}`}
                    type="button"
                    onClick={() => {
                      onSelectModule(m.key);
                      if (m.key === 'hrbp') setIsHrbpExpanded(true);
                      if (m.key === 'performance') setIsPmExpanded(true);
                      if (m.key === 'tasks') setIsTaskExpanded(true);
                      if (m.key === 'hiring-automation') setIsFlowExpanded(true);
                      setIsMobileSidebarOpen(false);
                    }}
                    className={`w-full ${activeModule === m.key ? (m.key === 'hrbp' || m.key === 'performance' || m.key === 'tasks' || m.key === 'hiring-automation' ? 'pl-3 pr-10' : 'pl-3 pr-3') : 'px-3'} py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                      activeModule === m.key ? 'bg-gradient-to-r from-[#6c4de6] to-[#8567f4] border-transparent text-white shadow-lg shadow-black/30' : 'bg-transparent border-transparent text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${activeModule === m.key ? 'bg-transparent text-white' : 'bg-transparent text-slate-300'}`}>
                        <m.Icon className="w-[15px] h-[15px]" />
                      </div>
                      <div className="truncate">
                        <span className={`text-[12px] font-medium block truncate ${activeModule === m.key ? 'text-white' : 'text-slate-100'}`}>{m.title}</span>
                        <span className="hidden">{m.sub}</span>
                      </div>
                    </div>
                    {activeModule === m.key && (
                      <div className="w-5 h-5 rounded-full bg-white text-violet-700 flex items-center justify-center shrink-0 ml-1.5">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </button>
                  {m.key === 'hrbp' && activeModule !== 'hrbp' && <ChevronRight aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                  {m.key === 'hrbp' && activeModule === 'hrbp' && (
                    <button
                      id="nav-module-hrbp-toggle"
                      type="button"
                      onClick={() => setIsHrbpExpanded((v) => !v)}
                      aria-expanded={isHrbpExpanded}
                      aria-label={isHrbpExpanded ? 'Hide HR Business Partner sections' : 'Show HR Business Partner sections'}
                      title={isHrbpExpanded ? 'Hide sections' : 'Show sections'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 cursor-pointer"
                    >
                      {isHrbpExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  )}
                  {m.key === 'performance' && activeModule !== 'performance' && <ChevronRight aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                  {m.key === 'performance' && activeModule === 'performance' && (
                    <button
                      id="nav-module-performance-toggle"
                      type="button"
                      onClick={() => setIsPmExpanded((v) => !v)}
                      aria-expanded={isPmExpanded}
                      aria-label={isPmExpanded ? 'Hide Performance sections' : 'Show Performance sections'}
                      title={isPmExpanded ? 'Hide sections' : 'Show sections'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 cursor-pointer"
                    >
                      {isPmExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  )}
                  {m.key === 'tasks' && activeModule !== 'tasks' && <ChevronRight aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                  {m.key === 'tasks' && activeModule === 'tasks' && (
                    <button
                      id="nav-module-tasks-toggle"
                      type="button"
                      onClick={() => setIsTaskExpanded((v) => !v)}
                      aria-expanded={isTaskExpanded}
                      aria-label={isTaskExpanded ? 'Hide Tasks sections' : 'Show Tasks sections'}
                      title={isTaskExpanded ? 'Hide sections' : 'Show sections'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 cursor-pointer"
                    >
                      {isTaskExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  )}
                  {m.key === 'hiring-automation' && activeModule !== 'hiring-automation' && <ChevronRight aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                  {m.key === 'hiring-automation' && activeModule === 'hiring-automation' && (
                    <button
                      id="nav-module-hiring-automation-toggle"
                      type="button"
                      onClick={() => setIsFlowExpanded((v) => !v)}
                      aria-expanded={isFlowExpanded}
                      aria-label={isFlowExpanded ? 'Hide Hiring Automation sections' : 'Show Hiring Automation sections'}
                      title={isFlowExpanded ? 'Hide sections' : 'Show sections'}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 cursor-pointer"
                    >
                      {isFlowExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  )}
                  </div>
                  {m.key === 'performance' && activeModule === 'performance' && isPmExpanded && (
                    <ModuleSubNav nav={pmNav} label="Performance sections" variant="sidebar" idPrefix="nav-submodule-performance" onNavigate={() => setIsMobileSidebarOpen(false)} />
                  )}
                  {m.key === 'tasks' && activeModule === 'tasks' && isTaskExpanded && (
                    <ModuleSubNav nav={taskNav} label="Tasks sections" variant="sidebar" idPrefix="nav-submodule-tasks" onNavigate={() => setIsMobileSidebarOpen(false)} />
                  )}
                  {m.key === 'hiring-automation' && activeModule === 'hiring-automation' && isFlowExpanded && (
                    <ModuleSubNav nav={flowNav} label="Hiring Automation sections" variant="sidebar" idPrefix="nav-submodule-hiring-automation" onNavigate={() => setIsMobileSidebarOpen(false)} />
                  )}
                  {m.key === 'hrbp' && activeModule === 'hrbp' && isHrbpExpanded && (
                    <ModuleSubNav nav={hrbpNav} label="HR Business Partner sections" variant="sidebar" idPrefix="nav-submodule-hrbp" onNavigate={() => setIsMobileSidebarOpen(false)} />
                  )}
                  </React.Fragment>
                ))}

                {/* ---------------------------------------------------- */}
                {/* PEOPLE (directory, joining tasks, exits, letters) */}
                {/* ---------------------------------------------------- */}
                <div className="relative">
                <button
                  id="nav-module-people"
                  type="button"
                  onClick={() => {
                    onSelectModule('people');
                    setIsPeopleExpanded(true);
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`w-full ${activeModule === 'people' ? 'pl-3 pr-10' : 'px-3'} py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    activeModule === 'people'
                      ? 'bg-gradient-to-r from-[#6c4de6] to-[#8567f4] border-transparent text-white shadow-lg shadow-black/30'
                      : 'bg-transparent border-transparent text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'people' ? 'bg-transparent text-white' : 'bg-transparent text-slate-300'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-[12px] font-medium block truncate ${activeModule === 'people' ? 'text-white' : 'text-slate-100'}`}>
                        People
                      </span>
                      <span className="hidden">Directory, onboarding, exits &amp; letters</span>
                    </div>
                  </div>
                  <NavBadge tone="dark" count={sumOf(badges.people)} className="ml-1.5" />
                  {activeModule === 'people' && (
                    <div className="w-5 h-5 rounded-full bg-white text-violet-700 flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule !== 'people' && <ChevronRight aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                {activeModule === 'people' && (
                  <button
                    id="nav-module-people-toggle"
                    type="button"
                    onClick={() => setIsPeopleExpanded((v) => !v)}
                    aria-expanded={isPeopleExpanded}
                    aria-label={isPeopleExpanded ? 'Hide people sections' : 'Show people sections'}
                    title={isPeopleExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 cursor-pointer"
                  >
                    {isPeopleExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
                </div>

                {activeModule === 'people' && isPeopleExpanded && (
                  <ModuleSubNav nav={peopleNav} counts={badges.people} label="People sections" variant="sidebar" idPrefix="nav-submodule-people" onNavigate={() => setIsMobileSidebarOpen(false)} />
                )}

                {/* ---------------------------------------------------- */}
                {/* EMPLOYEE (transactions and reports) */}
                {/* ---------------------------------------------------- */}
                <div className="relative">
                <button
                  id="nav-module-employee"
                  type="button"
                  onClick={() => {
                    onSelectModule('employee');
                    setIsEmployeeExpanded(true);
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`w-full ${activeModule === 'employee' ? 'pl-3 pr-10' : 'px-3'} py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    activeModule === 'employee'
                      ? 'bg-gradient-to-r from-[#6c4de6] to-[#8567f4] border-transparent text-white shadow-lg shadow-black/30'
                      : 'bg-transparent border-transparent text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'employee' ? 'bg-transparent text-white' : 'bg-transparent text-slate-300'
                      }`}
                    >
                      <Contact className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-[12px] font-medium block truncate ${activeModule === 'employee' ? 'text-white' : 'text-slate-100'}`}>
                        Employee
                      </span>
                      <span className="hidden">Master data, acknowledgements &amp; reports</span>
                    </div>
                  </div>
                  <NavBadge tone="dark" count={sumOf(badges.employee)} className="ml-1.5" />
                  {activeModule === 'employee' && (
                    <div className="w-5 h-5 rounded-full bg-white text-violet-700 flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule !== 'employee' && <ChevronRight aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                {activeModule === 'employee' && (
                  <button
                    id="nav-module-employee-toggle"
                    type="button"
                    onClick={() => setIsEmployeeExpanded((v) => !v)}
                    aria-expanded={isEmployeeExpanded}
                    aria-label={isEmployeeExpanded ? 'Hide employee sections' : 'Show employee sections'}
                    title={isEmployeeExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center text-white/80 hover:bg-white/10 cursor-pointer"
                  >
                    {isEmployeeExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
                </div>

                {activeModule === 'employee' && isEmployeeExpanded && (
                  <ModuleSubNav nav={employeeNav} counts={badges.employee} label="Employee sections" variant="sidebar" idPrefix="nav-submodule-employee" onNavigate={() => setIsMobileSidebarOpen(false)} />
                )}

                {/* ---------------------------------------------------- */}
                {/* 3. ADMINISTRATION (people, departments, roles)       */}
                {/* ---------------------------------------------------- */}
                {hasAdminAccess && (
                  <button
                    id="nav-module-administration"
                    type="button"
                    onClick={() => {
                      onSelectModule('administration');
                      setIsMobileSidebarOpen(false);
                    }}
                    className={`w-full px-2.5 py-2 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                      activeModule === 'administration'
                        ? 'bg-gradient-to-r from-[#6c4de6] to-[#8567f4] border-transparent text-white shadow-lg shadow-black/30'
                        : 'bg-transparent border-transparent text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div
                        className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                          activeModule === 'administration' ? 'bg-transparent text-white' : 'bg-transparent text-slate-300'
                        }`}
                      >
                        <Settings2 className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <span className={`text-[12px] font-medium block truncate ${activeModule === 'administration' ? 'text-white' : 'text-slate-100'}`}>
                          Administration
                        </span>
                        <span className="hidden">People, departments &amp; roles</span>
                      </div>
                    </div>
                    {activeModule === 'administration' && (
                      <div className="w-5 h-5 rounded-full bg-white text-violet-700 flex items-center justify-center shrink-0 ml-1.5">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </button>
                )}
              </nav>
            </div>
          </div>

          {/* ============================================================ */}
          {/* BOTTOM SECTION: CURRENT USER PROFILE & LOGOUT OPTION         */}
          {/* ============================================================ */}
          <div className="relative z-10 shrink-0 p-3 min-w-[14rem]">
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] font-medium text-slate-100">
              <HelpCircle className="w-3.5 h-3.5" aria-hidden />
              <span>Help &amp; Support</span>
            </div>
          </div>
        </aside>

        {/* ============================================================ */}
        {/* RIGHT CONTENT AREA: HOSTS SELECTED MODULE                   */}
        {/* ============================================================ */}
        <div className="flex-1 min-w-0 h-full flex flex-col">
          {/* TOP BAR (desktop): page title, jump-to-page search, notifications, account */}
          <header className="hidden lg:flex shrink-0 h-14 items-center gap-4 px-6 bg-white border-b border-slate-200">
            <div className="flex-1 basis-0 min-w-0">
            {crumb && (
              <nav aria-label="Breadcrumb" className="min-w-0">
                <ol className="flex items-center gap-2 text-sm min-w-0">
                  {crumb.page ? (
                    <>
                      <li className="text-slate-600 truncate">{crumb.section}</li>
                      <li aria-hidden className="shrink-0 text-slate-400"><ChevronRight className="w-3.5 h-3.5" /></li>
                      <li aria-current="page" className="font-semibold text-slate-900 truncate">{crumb.page}</li>
                    </>
                  ) : (
                    <li aria-current="page" className="font-semibold text-slate-900 truncate">{crumb.section}</li>
                  )}
                </ol>
              </nav>
            )}
            </div>
            <div className="relative w-full max-w-[25rem] shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
              <input
                id="topbar-page-search"
                type="search"
                value={pageQuery}
                onChange={(e) => setPageQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pageMatches[0]) { onSelectModule(pageMatches[0].id); setPageQuery(''); }
                  if (e.key === 'Escape') setPageQuery('');
                }}
                placeholder="Search pages or ask HR…"
                aria-label="Search pages or ask HR (Ctrl + K)"
                title="Press Ctrl + K to search from anywhere"
                className="w-full h-10 pl-10 pr-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-500 shadow-[0_1px_2px_rgba(16,24,40,0.03)] focus:outline-none focus:border-[#6d4cf0] focus:ring-2 focus:ring-[#6d4cf0]/20"
              />
              {pageQuery.trim().length > 1 && (
                <ul className="absolute left-0 right-0 top-11 z-50 rounded-xl border border-slate-200 bg-white shadow-lg py-1 overflow-hidden">
                  {pageMatches.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => { onSelectModule(p.id); setPageQuery(''); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-orange-50 hover:text-[#FA7014] cursor-pointer">{p.label}</button>
                    </li>
                  ))}
                  <li className={pageMatches.length ? 'border-t border-slate-100' : ''}>
                    <button type="button" onClick={() => { openAskHr(pageQuery.trim()); setPageQuery(''); }} className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-orange-50 hover:text-[#FA7014] cursor-pointer truncate">Ask HR: {pageQuery.trim()}</button>
                  </li>
                </ul>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-4">
            {onOpenNotifications && (
              <button type="button" onClick={onOpenNotifications} aria-label={notificationCount > 0 ? `Notifications (${notificationCount} unread)` : 'Notifications'} title="Notifications" className="relative w-10 h-10 rounded-xl flex items-center justify-center text-slate-700 hover:bg-slate-100 cursor-pointer">
                <Bell className="w-[22px] h-[22px]" />
                {notificationCount > 0 && <span aria-hidden className="absolute top-2 right-2.5 w-2.5 h-2.5 rounded-full bg-[#6d4cf0] ring-2 ring-white" />}
              </button>
            )}
            <div className="relative shrink-0">
              <button type="button" onClick={() => setIsAccountOpen((v) => !v)} aria-haspopup="menu" aria-expanded={isAccountOpen} aria-label="Account menu" title={currentUser.name || 'Account'} className="flex items-center gap-1.5 cursor-pointer rounded-xl pr-1 hover:bg-slate-50">
                <span className="w-10 h-10 rounded-full bg-violet-100 text-[#6d4cf0] font-bold text-sm flex items-center justify-center overflow-hidden ring-2 ring-white shadow-sm">{photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : initial}</span>
                <ChevronDown aria-hidden className="w-4 h-4 text-slate-600" />
              </button>
              {isAccountOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsAccountOpen(false)} aria-hidden />
                  <div role="menu" className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
                    <div className="px-1 pb-2">
                      <div className="truncate text-sm font-bold text-slate-900">{currentUser.name || 'User'}</div>
                      <div className="truncate text-xs text-slate-500">{[displayId, currentUser.title].filter(Boolean).join(' · ')}</div>
                      <div className="mt-1 text-[11px] text-slate-400">{authLabel}</div>
                    </div>
                    <input ref={photoInput} type="file" accept="image/*" className="hidden" aria-label="Choose a profile photo" onChange={(e) => void choosePhoto(e.target.files?.[0])} />
                    <button type="button" role="menuitem" onClick={() => photoInput.current?.click()} className="flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-2 pt-3 pb-2 text-sm font-semibold text-slate-700 hover:text-[#FA7014] cursor-pointer"><Camera className="h-4 w-4" />{photo ? 'Change photo' : 'Upload photo'}</button>
                    {photo && <button type="button" role="menuitem" onClick={() => void removePhoto()} className="flex w-full items-center gap-2 rounded-lg px-2 pb-2 text-sm font-semibold text-slate-700 hover:text-rose-600 cursor-pointer">Remove photo</button>}
                    {photoMsg && <p className="px-2 pb-2 text-xs text-slate-600" role="status">{photoMsg}</p>}
                    {onLogout && <button id="btn-sidebar-logout" type="button" role="menuitem" onClick={() => { setIsAccountOpen(false); onLogout(); }} className="flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-2 pt-3 pb-1 text-sm font-semibold text-slate-700 hover:text-rose-600 cursor-pointer"><LogOut className="h-4 w-4" />Log Out</button>}
                  </div>
                </>
              )}
            </div>
            </div>
          </header>
          <main
            id="hr-agent-right-workspace"
            className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-[#F8FAFC]"
            // Home and Hiring Pipeline are already built at the compact size; every other screen is scaled to match them.
            style={activeModule === 'home' || activeModule === 'talent-acquisition-pipeline' ? undefined : { zoom: 0.86 }}
          >
            {children}
          </main>
        </div>
      </div>
      <AskHrPanel userId={currentUser.authUid || currentUser.id} />

    </div>
  );
};

