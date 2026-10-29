import React, { useState, useEffect } from 'react';
import {
  Layers,
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
} from 'lucide-react';
import { User, UserRole } from '../types';
import { AmaavigoLogo } from './AmaavigoLogo';
import { LeaveSubNav } from './leave/LeaveSubNav';
import { NavBadge } from './NavBadge';
import { sumOf, useNavBadges } from '../services/navBadges';
import { ModuleSubNav } from './moduleNav';
import { payrollNav } from './payroll/payrollNav';
import { perfNav } from './perf/perfNav';
import { peopleNav } from './lifecycle/peopleNav';
import { employeeNav } from './employee/employeeNav';
import {
  hasModulePermission,
  getAuthorizationLabel,
  getAuthorizationBadgeText,
  normalizeAuthorizedModules,
} from '../utils/authorization';
import { hasAnyPerm } from '../../shared/permissions';

export type HRAgentModule =
  | 'home'
  | 'policies'
  | 'document-version-control'
  | 'talent-acquisition'
  | 'talent-acquisition-overview'
  | 'talent-acquisition-requisitions'
  | 'talent-acquisition-applications'
  | 'talent-acquisition-onboarding'
  | 'leave-management'
  | 'payroll'
  | 'performance'
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
  const [isPerfExpanded, setIsPerfExpanded] = useState<boolean>(true);
  const [isPeopleExpanded, setIsPeopleExpanded] = useState<boolean>(true);
  const [isEmployeeExpanded, setIsEmployeeExpanded] = useState<boolean>(true);
  // Counts of what is waiting for this person, shown on the module titles and their sections.
  const badges = useNavBadges();

  // Mobile sidebar drawer state
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  // Auto-redirect if currently selected module is not permitted
  useEffect(() => {
    if (activeModule === 'home' || activeModule === 'policies') return;
    if (activeModule === 'administration' || activeModule === 'leave-management' || activeModule === 'payroll' || activeModule === 'performance' || activeModule === 'people' || activeModule === 'employee') return;
    if (activeModule === 'document-version-control' && !hasDocGovAccess && hasTalentAccess) {
      onSelectModule('talent-acquisition-overview');
    } else if (
      (activeModule === 'talent-acquisition' ||
        activeModule === 'talent-acquisition-overview' ||
        activeModule === 'talent-acquisition-requisitions' ||
        activeModule === 'talent-acquisition-applications' ||
        activeModule === 'talent-acquisition-onboarding') &&
      !hasTalentAccess &&
      hasDocGovAccess
    ) {
      onSelectModule('document-version-control');
    }
  }, [activeModule, hasTalentAccess, hasDocGovAccess, onSelectModule]);

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
            type="button"
            onClick={onToggleSidebar}
            className="hidden lg:flex fixed top-20 left-0 z-40 bg-white/95 backdrop-blur-xs border border-l-0 border-slate-200 shadow-md py-2 px-3 rounded-r-xl hover:bg-orange-50 hover:text-[#FA7014] hover:border-orange-300 items-center gap-2 text-xs font-bold text-slate-700 transition-all cursor-pointer group"
            title="Open HR AI Agent side panel"
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
            bg-white border-r border-slate-200 shadow-sm
            flex flex-col
            transition-all duration-200 ease-in-out
            ${
              isMobileSidebarOpen
                ? 'translate-x-0 w-72 sm:w-76'
                : '-translate-x-full lg:translate-x-0'
            }
            ${
              isSidebarOpen
                ? 'lg:w-72 lg:sm:w-76 lg:border-r lg:opacity-100'
                : 'lg:w-0 lg:border-r-0 lg:overflow-hidden lg:pointer-events-none lg:opacity-0'
            }
          `}
        >
          {/* Top Section: Branding & Navigation Tree */}
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto min-w-[18rem] sm:min-w-[19rem]">
            {/* Platform Brand Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col gap-3 shrink-0">
              <div className="flex items-center justify-between">
                <AmaavigoLogo size="md" variant="full" theme="light" height={40} className="shrink-0" />
                
                <div className="flex items-center space-x-1">
                  {/* Desktop close button to collapse left side panel */}
                  <button
                    id="btn-close-sidebar-desktop"
                    type="button"
                    onClick={onToggleSidebar}
                    className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                    title="Close left side panel"
                    aria-label="Close left side panel"
                  >
                    <PanelLeftClose className="w-5 h-5" />
                  </button>

                  {/* Mobile close button */}
                  <button
                    type="button"
                    onClick={() => setIsMobileSidebarOpen(false)}
                    className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                    title="Close navigation"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* HR AI AGENT Platform Banner */}
              <div className="rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 p-3 text-white shadow-xs">
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 rounded-md bg-[#FA7014] flex items-center justify-center text-white shadow-xs">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h2 className="text-xs font-black tracking-wide uppercase text-white leading-tight flex items-center gap-1.5">
                      HR AI Agent
                    </h2>
                    <p className="text-[10px] text-slate-300 font-medium leading-none mt-0.5">
                      Autonomous People Ops
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Category Tree */}
            <div className="px-3 sm:px-4 py-4 flex-1 flex flex-col min-h-0 space-y-4">
              {/* Category Group Header */}
              <div className="px-2 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Platform Modules
                </span>
                <span className="text-[10px] font-semibold text-slate-400 font-mono">
                  {authorizedCount === 1 ? '1 Module' : `${authorizedCount} Modules`}
                </span>
              </div>

              <nav className="space-y-1.5 flex-1">
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
                      className={`w-full px-3 py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                        active ? 'bg-[#FA7014]/10 border-[#FA7014]/40 shadow-xs' : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-[#FA7014] text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="truncate">
                          <span className={`text-xs font-bold block truncate ${active ? 'text-[#FA7014]' : 'text-slate-800'}`}>{n.label}</span>
                          <span className="text-[10px] text-slate-500 font-medium block truncate">{n.hint}</span>
                        </div>
                      </div>
                      {n.badge > 0 && <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-[#FA7014] text-white text-[10px] font-bold flex items-center justify-center">{n.badge}</span>}
                    </button>
                  );
                })}
                {/* ---------------------------------------------------- */}
                {/* 1. TALENT ACQUISITION (Authorized check)             */}
                {/* ---------------------------------------------------- */}
                {hasTalentAccess && (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 overflow-hidden transition-all">
                    {/* Expandable Category Toggle Button */}
                    <button
                      id="nav-category-talent-acquisition"
                      type="button"
                      onClick={() => setIsTalentAcquisitionExpanded(!isTalentAcquisitionExpanded)}
                      className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-slate-100/80 transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center space-x-2.5">
                        <div className="w-7 h-7 rounded-lg bg-orange-100 text-[#FA7014] flex items-center justify-center shrink-0">
                          <Users className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-800 group-hover:text-slate-900 block leading-tight">
                            Talent Acquisition
                          </span>
                          <span className="text-[10px] text-slate-500 font-medium block">
                            Overview, Requisitions & Onboarding
                          </span>
                        </div>
                      </div>
                      <div className="text-slate-400 group-hover:text-slate-600 transition-transform">
                        {isTalentAcquisitionExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </div>
                    </button>

                    {/* Subcategories (Overview, Requisition Form & Candidate Onboarding Form) */}
                    {isTalentAcquisitionExpanded && (
                      <div className="pl-4 pr-2 pb-2 pt-1 border-t border-slate-200/60 bg-white/70 space-y-1">
                        {/* Sub-item 1: Overview Dashboard */}
                        <button
                          id="nav-submodule-talent-overview"
                          type="button"
                          onClick={() => {
                            onSelectModule('talent-acquisition-overview');
                            setIsMobileSidebarOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-overview' || activeModule === 'talent-acquisition'
                              ? 'bg-[#FA7014]/15 text-[#FA7014] font-bold shadow-2xs'
                              : 'text-slate-700 hover:text-[#FA7014] hover:bg-orange-50'
                          }`}
                          title="View Talent Acquisition Recruitment Overview Dashboard"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                                activeModule === 'talent-acquisition-overview' || activeModule === 'talent-acquisition'
                                  ? 'bg-[#FA7014]'
                                  : 'bg-slate-300'
                              }`}
                            />
                            <LayoutDashboard
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                activeModule === 'talent-acquisition-overview' || activeModule === 'talent-acquisition'
                                  ? 'text-[#FA7014]'
                                  : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">Overview</span>
                          </div>
                          {(activeModule === 'talent-acquisition-overview' || activeModule === 'talent-acquisition') && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#FA7014] shrink-0" />
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
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-requisitions'
                              ? 'bg-[#FA7014]/15 text-[#FA7014] font-bold shadow-2xs'
                              : 'text-slate-700 hover:text-[#FA7014] hover:bg-orange-50'
                          }`}
                          title="Hiring requisitions: request, approve and publish new roles"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                                activeModule === 'talent-acquisition-requisitions' ? 'bg-[#FA7014]' : 'bg-slate-300'
                              }`}
                            />
                            <FileSpreadsheet
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                activeModule === 'talent-acquisition-requisitions' ? 'text-[#FA7014]' : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">Requisitions</span>
                          </div>
                          {activeModule === 'talent-acquisition-requisitions' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#FA7014] shrink-0" />
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
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-applications'
                              ? 'bg-[#FA7014]/15 text-[#FA7014] font-bold shadow-2xs'
                              : 'text-slate-700 hover:text-[#FA7014] hover:bg-orange-50'
                          }`}
                          title="Candidate applications: webhook, manual entry and CSV import"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                                activeModule === 'talent-acquisition-applications' ? 'bg-[#FA7014]' : 'bg-slate-300'
                              }`}
                            />
                            <UserCheck
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                activeModule === 'talent-acquisition-applications' ? 'text-[#FA7014]' : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">Applications</span>
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
                          className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            activeModule === 'talent-acquisition-onboarding'
                              ? 'bg-[#FA7014]/15 text-[#FA7014] font-bold shadow-2xs'
                              : 'text-slate-700 hover:text-[#FA7014] hover:bg-orange-50'
                          }`}
                          title="Onboard selected candidates"
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                                activeModule === 'talent-acquisition-onboarding' ? 'bg-[#FA7014]' : 'bg-slate-300'
                              }`}
                            />
                            <UserCheck
                              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                                activeModule === 'talent-acquisition-onboarding' ? 'text-[#FA7014]' : 'text-slate-400'
                              }`}
                            />
                            <span className="truncate">Onboarding</span>
                          </div>
                          {activeModule === 'talent-acquisition-onboarding' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#FA7014] shrink-0" />
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
                    className={`w-full px-3 py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                      activeModule === 'document-version-control'
                        ? 'bg-[#FA7014]/10 border-[#FA7014]/40 text-slate-900 shadow-xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          activeModule === 'document-version-control'
                            ? 'bg-[#FA7014] text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Layers className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`text-xs font-bold block truncate ${
                              activeModule === 'document-version-control'
                                ? 'text-[#FA7014]'
                                : 'text-slate-800'
                            }`}
                          >
                            Document Version Control
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-medium block truncate">
                          {isHR ? 'Policy Governance & Lifecycle' : 'Review & Authorizations'}
                        </span>
                      </div>
                    </div>

                    {activeModule === 'document-version-control' && (
                      <div className="w-5 h-5 rounded-full bg-[#FA7014] text-white flex items-center justify-center shrink-0 ml-1.5">
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
                      ? 'bg-[#FA7014]/10 border-[#FA7014]/40 text-slate-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'leave-management' ? 'bg-[#FA7014] text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <CalendarDays className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-xs font-bold block truncate ${activeModule === 'leave-management' ? 'text-[#FA7014]' : 'text-slate-800'}`}>
                        Leave &amp; Attendance
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium block truncate">Leave, holidays, attendance &amp; approvals</span>
                    </div>
                  </div>
                  <NavBadge count={sumOf(badges.leave)} className="ml-1.5" />
                  {activeModule === 'leave-management' && (
                    <div className="w-5 h-5 rounded-full bg-[#FA7014] text-white flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule === 'leave-management' && (
                  <button
                    id="nav-module-leave-toggle"
                    type="button"
                    onClick={() => setIsLeaveExpanded((v) => !v)}
                    aria-expanded={isLeaveExpanded}
                    aria-label={isLeaveExpanded ? 'Hide leave sections' : 'Show leave sections'}
                    title={isLeaveExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-[#FA7014] hover:bg-[#FA7014]/15 cursor-pointer"
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
                      ? 'bg-[#FA7014]/10 border-[#FA7014]/40 text-slate-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'payroll' ? 'bg-[#FA7014] text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Wallet className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-xs font-bold block truncate ${activeModule === 'payroll' ? 'text-[#FA7014]' : 'text-slate-800'}`}>
                        Payroll
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium block truncate">Payslips, salary runs &amp; statutory setup</span>
                    </div>
                  </div>
                  <NavBadge count={sumOf(badges.payroll)} className="ml-1.5" />
                  {activeModule === 'payroll' && (
                    <div className="w-5 h-5 rounded-full bg-[#FA7014] text-white flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule === 'payroll' && (
                  <button
                    id="nav-module-payroll-toggle"
                    type="button"
                    onClick={() => setIsPayrollExpanded((v) => !v)}
                    aria-expanded={isPayrollExpanded}
                    aria-label={isPayrollExpanded ? 'Hide payroll sections' : 'Show payroll sections'}
                    title={isPayrollExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-[#FA7014] hover:bg-[#FA7014]/15 cursor-pointer"
                  >
                    {isPayrollExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
                </div>

                {activeModule === 'payroll' && isPayrollExpanded && (
                  <ModuleSubNav nav={payrollNav} counts={badges.payroll} label="Payroll sections" variant="sidebar" idPrefix="nav-submodule-payroll" onNavigate={() => setIsMobileSidebarOpen(false)} />
                )}

                {/* ---------------------------------------------------- */}
                {/* PERFORMANCE (everyone sees their goals and reviews; managers and HR see more) */}
                {/* ---------------------------------------------------- */}
                <div className="relative">
                <button
                  id="nav-module-performance"
                  type="button"
                  onClick={() => {
                    onSelectModule('performance');
                    setIsPerfExpanded(true);
                    setIsMobileSidebarOpen(false);
                  }}
                  className={`w-full ${activeModule === 'performance' ? 'pl-3 pr-10' : 'px-3'} py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                    activeModule === 'performance'
                      ? 'bg-[#FA7014]/10 border-[#FA7014]/40 text-slate-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'performance' ? 'bg-[#FA7014] text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Target className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-xs font-bold block truncate ${activeModule === 'performance' ? 'text-[#FA7014]' : 'text-slate-800'}`}>
                        Performance
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium block truncate">Goals, reviews &amp; SOP compliance</span>
                    </div>
                  </div>
                  {activeModule === 'performance' && (
                    <div className="w-5 h-5 rounded-full bg-[#FA7014] text-white flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule === 'performance' && (
                  <button
                    id="nav-module-performance-toggle"
                    type="button"
                    onClick={() => setIsPerfExpanded((v) => !v)}
                    aria-expanded={isPerfExpanded}
                    aria-label={isPerfExpanded ? 'Hide performance sections' : 'Show performance sections'}
                    title={isPerfExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-[#FA7014] hover:bg-[#FA7014]/15 cursor-pointer"
                  >
                    {isPerfExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                )}
                </div>

                {activeModule === 'performance' && isPerfExpanded && (
                  <ModuleSubNav nav={perfNav} label="Performance sections" variant="sidebar" idPrefix="nav-submodule-performance" onNavigate={() => setIsMobileSidebarOpen(false)} />
                )}

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
                      ? 'bg-[#FA7014]/10 border-[#FA7014]/40 text-slate-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'people' ? 'bg-[#FA7014] text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-xs font-bold block truncate ${activeModule === 'people' ? 'text-[#FA7014]' : 'text-slate-800'}`}>
                        People
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium block truncate">Directory, onboarding, exits &amp; letters</span>
                    </div>
                  </div>
                  <NavBadge count={sumOf(badges.people)} className="ml-1.5" />
                  {activeModule === 'people' && (
                    <div className="w-5 h-5 rounded-full bg-[#FA7014] text-white flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule === 'people' && (
                  <button
                    id="nav-module-people-toggle"
                    type="button"
                    onClick={() => setIsPeopleExpanded((v) => !v)}
                    aria-expanded={isPeopleExpanded}
                    aria-label={isPeopleExpanded ? 'Hide people sections' : 'Show people sections'}
                    title={isPeopleExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-[#FA7014] hover:bg-[#FA7014]/15 cursor-pointer"
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
                      ? 'bg-[#FA7014]/10 border-[#FA7014]/40 text-slate-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                        activeModule === 'employee' ? 'bg-[#FA7014] text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      <Contact className="w-4 h-4" />
                    </div>
                    <div className="truncate">
                      <span className={`text-xs font-bold block truncate ${activeModule === 'employee' ? 'text-[#FA7014]' : 'text-slate-800'}`}>
                        Employee
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium block truncate">Master data, acknowledgements &amp; reports</span>
                    </div>
                  </div>
                  <NavBadge count={sumOf(badges.employee)} className="ml-1.5" />
                  {activeModule === 'employee' && (
                    <div className="w-5 h-5 rounded-full bg-[#FA7014] text-white flex items-center justify-center shrink-0 ml-1.5">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
                {activeModule === 'employee' && (
                  <button
                    id="nav-module-employee-toggle"
                    type="button"
                    onClick={() => setIsEmployeeExpanded((v) => !v)}
                    aria-expanded={isEmployeeExpanded}
                    aria-label={isEmployeeExpanded ? 'Hide employee sections' : 'Show employee sections'}
                    title={isEmployeeExpanded ? 'Hide sections' : 'Show sections'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-[#FA7014] hover:bg-[#FA7014]/15 cursor-pointer"
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
                    className={`w-full px-3 py-2.5 rounded-xl border flex items-center justify-between text-left transition-all cursor-pointer ${
                      activeModule === 'administration'
                        ? 'bg-[#FA7014]/10 border-[#FA7014]/40 text-slate-900 shadow-xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          activeModule === 'administration' ? 'bg-[#FA7014] text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        <Settings2 className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <span className={`text-xs font-bold block truncate ${activeModule === 'administration' ? 'text-[#FA7014]' : 'text-slate-800'}`}>
                          Administration
                        </span>
                        <span className="text-[10px] text-slate-500 font-medium block truncate">People, departments &amp; roles</span>
                      </div>
                    </div>
                    {activeModule === 'administration' && (
                      <div className="w-5 h-5 rounded-full bg-[#FA7014] text-white flex items-center justify-center shrink-0 ml-1.5">
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
          <div className="shrink-0 border-t border-slate-200 bg-slate-50/80 p-3 sm:p-3.5 min-w-[18rem] sm:min-w-[19rem] space-y-2">
            {/* User Identity Details */}
            <div className="flex items-center gap-2.5 px-0.5">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs border border-slate-700/50">
                {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-900 truncate block leading-tight">
                    {currentUser.name || 'User'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 truncate mt-0.5">
                  {displayId && (
                    <span className="font-mono font-medium text-slate-700 bg-white px-1.5 py-0.2 rounded border border-slate-200 text-[9px] shrink-0">
                      {displayId}
                    </span>
                  )}
                  <span
                    className="truncate text-slate-500 font-medium"
                    title={currentUser.title || (isHR ? 'HR Policy Lead' : 'Approver')}
                  >
                    {currentUser.title || (isHR ? 'HR Policy Lead' : 'Approver')}
                  </span>
                </div>
              </div>
            </div>

            {/* Authorization Status Badge & Management Action */}
            <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
              <div className="flex items-center space-x-1.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    hasTalentAccess && hasDocGovAccess
                      ? 'bg-emerald-500'
                      : hasTalentAccess
                      ? 'bg-[#FA7014]'
                      : 'bg-indigo-500'
                  }`}
                />
                <span className="text-[10px] font-bold text-slate-700 truncate" title={`Authorization: ${authLabel}`}>
                  {authLabel}
                </span>
              </div>

            </div>

            {/* Logout Option */}
            {onLogout && (
              <button
                id="btn-sidebar-logout"
                type="button"
                onClick={() => {
                  setIsMobileSidebarOpen(false);
                  onLogout();
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 border border-slate-200 transition-all cursor-pointer shadow-2xs group"
                title="Logout from platform"
                aria-label="Logout"
              >
                <LogOut className="w-3.5 h-3.5 text-slate-400 group-hover:text-rose-600 transition-colors" />
                <span>Log Out</span>
              </button>
            )}
          </div>
        </aside>

        {/* ============================================================ */}
        {/* RIGHT CONTENT AREA: HOSTS SELECTED MODULE                   */}
        {/* ============================================================ */}
        <main
          id="hr-agent-right-workspace"
          className="flex-1 min-w-0 h-full overflow-y-auto bg-[#F8FAFC]"
        >
          {children}
        </main>
      </div>

    </div>
  );
};

