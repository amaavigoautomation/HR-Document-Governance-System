import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Bot,
  Brain,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Briefcase,
  Clock,
  Layers,
  FileText,
  FileCheck,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Award,
  TrendingUp,
  UserCheck,
  Users,
  Shield,
  X,
  Eye,
  Info,
  SlidersHorizontal,
  FileSpreadsheet,
} from 'lucide-react';
import { recruitmentService } from '../services/recruitmentService';
import { apiJson } from '../services/apiClient';
import { hasPerm } from '../../shared/permissions';
import type {
  AIEvaluationResponse,
  CandidateEvaluationResult,
} from '../services/aiEvaluationService';
import { User, UserRole } from '../types';
import { onboardingService, CandidateStatus, STATUS_LABELS } from '../services/onboardingService';

interface CandidateEvaluationSectionProps {
  currentUser: User;
  activeDesignation: string;
  availableDesignations: string[];
  onSelectDesignation: (designation: string) => void;
  parentRefreshCount?: number;
}

export const CandidateEvaluationSection: React.FC<CandidateEvaluationSectionProps> = ({
  currentUser,
  activeDesignation,
  availableDesignations,
  onSelectDesignation,
  parentRefreshCount = 0,
}) => {
  const [evaluation, setEvaluation] = useState<AIEvaluationResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Modals & Drawers
  const [showFullJDModal, setShowFullJDModal] = useState<boolean>(false);
  const [selectedCandidateForDeepDive, setSelectedCandidateForDeepDive] =
    useState<CandidateEvaluationResult | null>(null);

  // Candidate status (Pending / On hold / Rejected) + onboarding state, stored server-side
  const isHr = currentUser.role === UserRole.CREATOR;
  const canEditJd = hasPerm(currentUser.perms, 'req.manage_jd');

  // Job description editor (the description written here is used for this role instead of the website's)
  const [jdEditing, setJdEditing] = useState<boolean>(false);
  const [jdDraft, setJdDraft] = useState<string>('');
  const [jdBusy, setJdBusy] = useState<'save' | 'generate' | 'revert' | null>(null);
  const [jdMsg, setJdMsg] = useState<string | null>(null);
  const [candStatuses, setCandStatuses] = useState<Record<string, CandidateStatus>>({});
  const [candOnboardings, setCandOnboardings] = useState<Record<string, { id: string; status: string; employeeId: string }>>({});
  const [onboardTarget, setOnboardTarget] = useState<{ id: string; name: string } | null>(null);
  const [onboardDate, setOnboardDate] = useState<string>('');
  const [onboardBusy, setOnboardBusy] = useState<boolean>(false);
  const [onboardMsg, setOnboardMsg] = useState<string | null>(null);

  const loadCandidateStates = useCallback(async () => {
    try {
      const r = await onboardingService.candidateStatuses(currentUser);
      setCandStatuses(r.statuses || {});
      setCandOnboardings(r.onboardings || {});
    } catch (err) {
      console.warn('Could not load candidate statuses:', err);
    }
  }, [currentUser]);

  useEffect(() => {
    loadCandidateStates();
  }, [loadCandidateStates, parentRefreshCount]);

  const changeCandidateStatus = async (id: string, status: CandidateStatus) => {
    const prev = candStatuses[id];
    setCandStatuses((m) => ({ ...m, [id]: status }));
    try {
      await onboardingService.setCandidateStatus(currentUser, id, status);
    } catch (err: any) {
      setCandStatuses((m) => ({ ...m, [id]: prev }));
      setOnboardMsg(err.message || 'Could not update status.');
    }
  };

  const confirmOnboard = async () => {
    if (!onboardTarget || !onboardDate) return;
    setOnboardBusy(true);
    setOnboardMsg(null);
    try {
      const r = await onboardingService.start(currentUser, onboardTarget.id, onboardDate);
      setOnboardMsg(
        r.status === 'PRIOR_EMPLOYEE_REVIEW'
          ? `${onboardTarget.name} matches an existing record (${r.employeeId}). Open Onboarding to decide whether to continue.`
          : `Onboarding started for ${onboardTarget.name} (${r.employeeId}). Document request ${r.emailSent ? 'emailed' : 'could not be emailed'}.`
      );
      setOnboardTarget(null);
      await loadCandidateStates();
    } catch (err: any) {
      setOnboardMsg(err.message || 'Could not start onboarding.');
      setOnboardTarget(null);
    } finally {
      setOnboardBusy(false);
    }
  };

  const openJdModal = (edit: boolean) => {
    setJdMsg(null);
    setJdDraft(evaluation?.jdSummary?.rawJDText || '');
    setJdEditing(edit);
    setShowFullJDModal(true);
  };

  const afterJdChange = async (message: string) => {
    recruitmentService.clearCache();
    setJdEditing(false);
    setJdMsg(message);
    await fetchEvaluation(true);
  };

  const saveJd = async () => {
    const role = evaluation?.designation || activeDesignation;
    setJdBusy('save');
    setJdMsg(null);
    try {
      await recruitmentService.saveJobDescription(role, jdDraft);
      await afterJdChange('Saved. Candidates are scored against this description from now on.');
    } catch (err: any) {
      setJdMsg(err?.message || 'Could not save the job description.');
    } finally {
      setJdBusy(null);
    }
  };

  const revertJd = async () => {
    const role = evaluation?.designation || activeDesignation;
    setJdBusy('revert');
    setJdMsg(null);
    try {
      await recruitmentService.deleteJobDescription(role);
      await afterJdChange('Reverted to the website description.');
    } catch (err: any) {
      setJdMsg(err?.message || 'Could not revert the job description.');
    } finally {
      setJdBusy(null);
    }
  };

  const generateJd = async () => {
    const role = evaluation?.designation || activeDesignation;
    const dept = evaluation?.jdSummary?.department;
    setJdBusy('generate');
    setJdMsg(null);
    try {
      const r = await apiJson<{ text: string; generatedBy: string; note?: string }>('/api/requisitions/generate-jd', {
        positionTitle: role,
        departmentName: dept && dept !== 'Not specified' ? dept : 'General',
      });
      setJdDraft(r.text || '');
      setJdMsg(r.note || 'Draft generated. Review and edit it, then save.');
    } catch (err: any) {
      setJdMsg(err?.message || 'Could not generate a draft.');
    } finally {
      setJdBusy(null);
    }
  };

  // Search & Filter within candidate matrix
  const [candidateSearch, setCandidateSearch] = useState<string>('');
  const [alignmentFilter, setAlignmentFilter] = useState<string>('ALL');

  // Fetch evaluation from backend
  const fetchEvaluation = useCallback(
    async (forceRefresh = false) => {
      if (!activeDesignation) return;
      if (forceRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setErrorMsg(null);

      try {
        const data = await recruitmentService.getAIEvaluation(
          activeDesignation,
          forceRefresh,
          currentUser.role
        );
        setEvaluation(data);
      } catch (err: any) {
        console.error('Failed to load candidate AI evaluation:', err);
        setErrorMsg(
          err.message || 'Failed to retrieve AI candidate evaluation from Google Sheets.'
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [activeDesignation, currentUser.role]
  );

  // AI (resume evidence) scoring: runs only when HR clicks the button, a few candidates per request,
  // results are cached server-side so each candidate is only ever sent to the model once.
  const [aiRunning, setAiRunning] = useState<boolean>(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  const runAiScoring = async () => {
    if (!activeDesignation || aiRunning) return;
    setAiRunning(true);
    setAiMsg(null);
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      for (let i = 0; i < 15; i++) {
        const data = await recruitmentService.getAIEvaluation(activeDesignation, false, currentUser.role, true);
        setEvaluation(data);
        const sum = data.aiScoring;
        tokensIn += sum?.tokens?.input || 0;
        tokensOut += sum?.tokens?.output || 0;
        if (!sum || !sum.enabled) {
          setAiMsg(sum?.note || 'AI scoring is not enabled.');
          break;
        }
        if (sum.note && sum.pending > 0) {
          setAiMsg(sum.note);
          break;
        }
        if (sum.pending === 0) {
          setAiMsg(`AI scoring finished. About ${(tokensIn + tokensOut).toLocaleString()} tokens used in this run.`);
          break;
        }
      }
    } catch (err: any) {
      setAiMsg(err.message || 'AI scoring failed.');
    } finally {
      setAiRunning(false);
    }
  };

  // Re-fetch whenever designation changes or parent refresh triggers
  useEffect(() => {
    fetchEvaluation(false);
  }, [fetchEvaluation, parentRefreshCount]);

  // Filter candidates in matrix
  const filteredCandidates = (evaluation?.candidates || []).filter((cand) => {
    const matchesSearch =
      !candidateSearch.trim() ||
      cand.name.toLowerCase().includes(candidateSearch.toLowerCase()) ||
      cand.experience.toLowerCase().includes(candidateSearch.toLowerCase()) ||
      cand.strengths.some((s) => s.toLowerCase().includes(candidateSearch.toLowerCase()));

    const matchesAlignment =
      alignmentFilter === 'ALL' ||
      cand.overallAlignment.toLowerCase().includes(alignmentFilter.toLowerCase());

    return matchesSearch && matchesAlignment;
  });

  const getTierColorClass = (tier: string) => {
    switch (tier) {
      case 'Strong Evidence':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Moderate Evidence':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Limited Evidence':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Not Evidenced':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getScoreColorClass = (score: number) => {
    if (score >= 75) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (score >= 50) return 'text-blue-600 bg-blue-50 border-blue-200';
    if (score >= 30) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-slate-600 bg-slate-100 border-slate-200';
  };

  return (
    <section
      id="candidate-ai-evaluation-section"
      className="mt-8 space-y-6 animate-in fade-in duration-300"
    >
      {/* SECTION HEADER CARD */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl p-5 sm:p-6 shadow-lg border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2">
              <span className="p-1.5 rounded-lg bg-[#FA7014] text-white shadow-xs">
                <Brain className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-[#FA7014]">
                Enterprise AI Evaluation Engine
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/10 text-slate-300 border border-white/10">
                Live Applications Data
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              AI Candidate Evaluation &amp; Recommendation
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl leading-relaxed">
              Reads the live Job Description and applications, compares every applicant against required
              skills and experience, and provides objective evidence-backed decision support for the
              hiring team.
            </p>
            {(aiMsg || evaluation?.aiScoring) && (
              <p className="text-[11px] text-slate-300">
                {aiMsg ||
                  (evaluation?.aiScoring?.enabled
                    ? `AI-scored ${evaluation.aiScoring.aiScored} of ${evaluation.aiScoring.totalCandidates} candidates${
                        evaluation.aiScoring.pending > 0
                          ? ` · ${evaluation.aiScoring.pending} not AI-scored yet (click Evaluate with AI)`
                          : ''
                      }. ${
                        evaluation.aiScoring.keywordScored
                          ? `${evaluation.aiScoring.keywordScored} scored by matching the JD against their resume. `
                          : ''
                      }${
                        evaluation.aiScoring.keywordPending
                          ? `${evaluation.aiScoring.keywordPending} resumes still to read: refresh to continue. `
                          : ''
                      }${evaluation.duplicatesMerged ? `${evaluation.duplicatesMerged} repeat application(s) merged.` : ''}`
                    : [
                        evaluation?.aiScoring?.note,
                        evaluation?.aiScoring?.keywordScored
                          ? `${evaluation.aiScoring.keywordScored} scored by matching the JD against their resume.`
                          : '',
                        evaluation?.duplicatesMerged ? `${evaluation.duplicatesMerged} repeat application(s) merged.` : '',
                      ]
                        .filter(Boolean)
                        .join(' '))}
              </p>
            )}
          </div>

          {/* Role Selector & Refresh Action */}
          <div className="flex items-center space-x-2.5 shrink-0">
            {availableDesignations.length > 0 && (
              <div className="relative">
                <select
                  value={activeDesignation}
                  onChange={(e) => onSelectDesignation(e.target.value)}
                  className="bg-slate-800/90 text-white text-xs font-bold rounded-xl px-3 py-2 border border-slate-700 hover:border-slate-600 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] pr-8 cursor-pointer"
                  title="Select role designation to evaluate"
                >
                  {availableDesignations.map((desig) => (
                    <option key={desig} value={desig} className="bg-slate-900 text-white">
                      {desig}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => fetchEvaluation(true)}
              disabled={isRefreshing || isLoading}
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold transition-all shadow-md cursor-pointer disabled:opacity-50"
              title="Re-run AI evaluation and bypass cache"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Re-analyze</span>
            </button>

            <button
              type="button"
              onClick={runAiScoring}
              disabled={aiRunning || isLoading || !isHr || evaluation?.aiScoring?.enabled === false}
              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 transition-all cursor-pointer disabled:opacity-50"
              title={
                evaluation?.aiScoring?.enabled === false
                  ? 'Set OPENAI_API_KEY on the server to enable AI scoring'
                  : 'Score candidates from their resumes with AI (results are cached; each candidate is only analysed once)'
              }
            >
              <Sparkles className={`w-3.5 h-3.5 ${aiRunning ? 'animate-pulse' : ''}`} />
              <span>{aiRunning ? 'Scoring…' : 'Evaluate with AI'}</span>
            </button>
          </div>
        </div>

        {/* Dynamic JD Highlights Bar */}
        {evaluation?.jdSummary && (
          <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400 font-medium">JD Grounding:</span>
              <span className="font-bold text-white bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-700">
                {evaluation.jdSummary.designation}
              </span>
              <span className="text-slate-400 font-mono text-[11px] bg-white/5 px-2 py-1 rounded-lg">
                Min Exp: <strong className="text-white">{evaluation.jdSummary.minExperience}</strong>
              </span>
              <span className="text-slate-400 font-mono text-[11px] bg-white/5 px-2 py-1 rounded-lg">
                Core Skills: <strong className="text-white">{evaluation.jdSummary.requiredSkills.length} Criteria</strong>
              </span>
              <span className="text-slate-400 font-mono text-[11px] bg-white/5 px-2 py-1 rounded-lg">
                Applicants: <strong className="text-white">{evaluation.totalCandidates} Evaluated</strong>
              </span>
            </div>

            <button
              type="button"
              onClick={() => openJdModal(false)}
              className="text-xs text-[#FA7014] hover:text-orange-300 font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{canEditJd ? 'View / edit JD' : 'View JD'}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {evaluation?.jdSummary && evaluation.jdSummary.jdProvided === false && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-xs text-amber-100">
            <span>
              No job description exists for this role, so applicants cannot be scored yet.
              {canEditJd ? ' Add one and they are scored from their resumes.' : ' Ask someone who manages job descriptions to add one.'}
            </span>
            {canEditJd && (
              <button
                type="button"
                onClick={() => openJdModal(true)}
                className="px-3 py-1.5 rounded-lg bg-[#FA7014] hover:bg-[#E65A05] text-white font-bold cursor-pointer"
              >
                Add job description
              </button>
            )}
          </div>
        )}
      </div>

      {/* ERROR STATE */}
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-4 rounded-2xl flex items-start gap-3 text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Evaluation Synchronization Notice</p>
            <p>{errorMsg}</p>
            <button
              type="button"
              onClick={() => fetchEvaluation(true)}
              className="mt-2 text-rose-700 font-bold underline cursor-pointer"
            >
              Click here to retry analysis
            </button>
          </div>
        </div>
      )}

      {/* LOADING SKELETON */}
      {isLoading && !evaluation && (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-orange-50 text-[#FA7014] flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Brain className="w-6 h-6 animate-spin" />
          </div>
          <h3 className="text-sm font-bold text-slate-800">
            Analyzing Candidates Against Google Sheet JD...
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
            Reading criteria from the JD's sheet tab, cross-referencing candidate records, and computing
            evidence alignment scores.
          </p>
        </div>
      )}

      {/* MAIN EVALUATION CONTENT */}
      {evaluation && (
        <div className="space-y-6">
          {/* 1. HR RECOMMENDATION SUPPORT CARD */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md p-5 sm:p-6 overflow-hidden relative">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
              {/* Left Column: Top Match Callout */}
              <div className="flex-1 space-y-4">
                <div className="flex items-center space-x-2">
                  <span className="p-1 rounded-md bg-emerald-100 text-emerald-700">
                    <Award className="w-4 h-4" />
                  </span>
                  <span className="text-xs font-black uppercase tracking-wider text-slate-600">
                    Hiring Decision Support Recommendation
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Strongest Evidenced Profile
                  </span>
                </div>

                {evaluation.hrRecommendation.topCandidate ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                        {evaluation.hrRecommendation.topCandidate.name}
                      </h3>
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-full border ${getTierColorClass(
                          evaluation.hrRecommendation.topCandidate.alignmentTier
                        )}`}
                      >
                        {evaluation.hrRecommendation.topCandidate.alignmentTier}
                      </span>
                      <span
                        className={`text-xs font-mono font-extrabold px-3 py-1 rounded-full border ${getScoreColorClass(
                          evaluation.hrRecommendation.topCandidate.score
                        )}`}
                      >
                        Alignment Score: {evaluation.hrRecommendation.topCandidate.score}/100
                      </span>
                    </div>

                    {/* Summary Reasoning */}
                    <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium bg-slate-50 p-3.5 rounded-xl border border-slate-200/70">
                      {evaluation.hrRecommendation.summaryReasoning}
                    </p>

                    {/* Evidenced Strengths Bullet Points */}
                    {evaluation.hrRecommendation.supportingEvidence.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Documented Evidence in Profile:
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {evaluation.hrRecommendation.supportingEvidence.map((ev, idx) => (
                            <div
                              key={idx}
                              className="flex items-start space-x-2 text-xs text-slate-700 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span className="leading-snug">{ev}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Pool Comparative Insight */}
                    {evaluation.hrRecommendation.poolComparativeInsight && (
                      <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl text-xs text-blue-900 flex items-start space-x-2.5">
                        <TrendingUp className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Applicant Pool Comparison: </span>
                          <span className="leading-relaxed">
                            {evaluation.hrRecommendation.poolComparativeInsight}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-xl text-xs text-slate-600">
                    No candidates found in the active worksheet tab to evaluate.
                  </div>
                )}
              </div>

              {/* Right Column: Advisory Notice & Methodology */}
              <div className="w-full lg:w-72 shrink-0 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 text-xs">
                <div className="flex items-center space-x-1.5 font-bold text-slate-900">
                  <Shield className="w-4 h-4 text-[#FA7014]" />
                  <span>Decision Governance</span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  {evaluation.hrRecommendation.advisoryDisclaimer}
                </p>
                <div className="pt-2 border-t border-slate-200 text-[10px] text-slate-500">
                  <span className="font-semibold text-slate-700 block mb-0.5">Privacy Guardrail:</span>
                  Evaluations strictly omit phone numbers, emails, addresses, and demographic attributes.
                </div>
              </div>
            </div>
          </div>

          {/* 2. SIDE-BY-SIDE CANDIDATE COMPARISON MATRIX */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Table Controls Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <Users className="w-4 h-4 text-[#FA7014]" />
                <h3 className="text-sm font-bold text-slate-900">
                  Candidate Comparison Matrix ({filteredCandidates.length} of{' '}
                  {evaluation.candidates.length})
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Search input */}
                <input
                  type="text"
                  placeholder="Filter candidate by name, skill, or tenure..."
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] w-48 sm:w-60"
                />

                {/* Alignment Tier Filter */}
                <select
                  value={alignmentFilter}
                  onChange={(e) => setAlignmentFilter(e.target.value)}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014] cursor-pointer"
                >
                  <option value="ALL">All Alignment Tiers</option>
                  <option value="Strong">Strong Evidence</option>
                  <option value="Moderate">Moderate Evidence</option>
                  <option value="Limited">Limited Evidence</option>
                  <option value="Not Evidenced">Not Evidenced</option>
                </select>
              </div>
            </div>

            {/* Matrix Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <th className="px-4 py-3 text-center w-12">Rank</th>
                    <th className="px-4 py-3 min-w-[180px]">Candidate</th>
                    <th className="px-4 py-3 min-w-[140px]">Experience vs. JD</th>
                    <th className="px-4 py-3 min-w-[130px]">Alignment Tier</th>
                    <th className="px-4 py-3 min-w-[90px] text-center">Score</th>
                    <th className="px-4 py-3 min-w-[220px]">Key Verified Strengths</th>
                    <th className="px-4 py-3 min-w-[200px]">Missing / Gaps</th>
                    <th className="px-4 py-3 text-center min-w-[100px]">Action</th>
                    <th className="px-4 py-3 min-w-[130px]">Status</th>
                    <th className="px-4 py-3 text-center min-w-[130px]">Onboard</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                        No candidates match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredCandidates.map((cand) => (
                      <tr
                        key={cand.id}
                        className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                        onClick={() => setSelectedCandidateForDeepDive(cand)}
                      >
                        {/* Rank */}
                        <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-400">
                          {cand.rank === 1 ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 text-xs font-black shadow-2xs">
                              1
                            </span>
                          ) : (
                            `#${cand.rank}`
                          )}
                        </td>

                        {/* Candidate Name & Notice */}
                        <td className="px-4 py-3.5">
                          <div className="font-bold text-slate-900 group-hover:text-[#FA7014] transition-colors">
                            {cand.name}
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center space-x-1.5 mt-0.5">
                            <span>Notice: {cand.noticePeriod}</span>
                            {cand.resumeUrl && (
                              <>
                                <span>•</span>
                                <a
                                  href={cand.resumeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[#FA7014] hover:underline inline-flex items-center gap-0.5"
                                >
                                  Resume
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </>
                            )}
                          </div>
                        </td>

                        {/* Experience vs JD */}
                        <td className="px-4 py-3.5">
                          <div className="font-semibold text-slate-800">{cand.experience}</div>
                          <div className="text-[10px] text-slate-500 font-medium">
                            {cand.experienceVsJD.label}
                          </div>
                        </td>

                        {/* Alignment Tier Badge */}
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${getTierColorClass(
                              cand.overallAlignment
                            )}`}
                          >
                            {cand.scored === false ? 'Not scored' : cand.overallAlignment}
                          </span>
                        </td>

                        {/* Score */}
                        <td className="px-4 py-3.5 text-center">
                          {cand.scored === false ? (
                            <span
                              className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-500"
                              title={cand.aiNote || cand.keyTakeaway}
                            >
                              Not scored
                            </span>
                          ) : (
                            <>
                              <span
                                className={`inline-block text-xs font-mono font-bold px-2 py-0.5 rounded-lg border ${getScoreColorClass(
                                  cand.alignmentScore
                                )}`}
                              >
                                {cand.alignmentScore}
                              </span>
                              <div
                                className="text-[9px] font-bold uppercase tracking-wide text-slate-400 mt-0.5"
                                title={
                                  cand.aiNote ||
                                  (cand.scoringMode === 'AI'
                                    ? 'Scored from resume evidence by AI'
                                    : cand.scoringMode === 'KEYWORDS'
                                      ? 'Job description requirements matched against the resume text'
                                      : 'Scored from recruiter notes')
                                }
                              >
                                {cand.scoringMode === 'AI' ? 'AI' : cand.scoringMode === 'KEYWORDS' ? 'Resume match' : 'Notes'}
                              </div>
                            </>
                          )}
                        </td>

                        {/* Key Verified Strengths */}
                        <td className="px-4 py-3.5">
                          {cand.strengths.length > 0 ? (
                            <div className="space-y-1">
                              {cand.strengths.slice(0, 2).map((st, i) => (
                                <div
                                  key={i}
                                  className="text-[11px] text-slate-700 flex items-start gap-1 line-clamp-1"
                                >
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" />
                                  <span className="truncate">{st}</span>
                                </div>
                              ))}
                              {cand.strengths.length > 2 && (
                                <span className="text-[10px] text-slate-400 font-medium">
                                  +{cand.strengths.length - 2} more documented strengths
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">
                              Not provided / Not evidenced
                            </span>
                          )}
                        </td>

                        {/* Missing / Gaps */}
                        <td className="px-4 py-3.5">
                          {cand.scored === false ? (
                            <span className="text-slate-500 text-[11px]">
                              {cand.aiNote || (evaluation?.jdSummary?.jdProvided === false ? 'Add a job description to score' : 'Waiting for resume')}
                            </span>
                          ) : cand.missingOrNotEvidenced.length > 0 ? (
                            <div className="space-y-1">
                              {cand.missingOrNotEvidenced.slice(0, 2).map((gap, i) => (
                                <div
                                  key={i}
                                  className="text-[11px] text-slate-600 flex items-start gap-1 line-clamp-1"
                                >
                                  <HelpCircle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                                  <span className="truncate">{gap}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-emerald-700 text-[11px] font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Zero critical gaps evidenced
                            </span>
                          )}
                        </td>

                        {/* Action Review Button */}
                        <td className="px-4 py-3.5 text-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCandidateForDeepDive(cand);
                            }}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-[#FA7014] hover:text-white text-slate-700 font-bold text-xs transition-colors cursor-pointer"
                          >
                            <span>Review</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </td>

                        {/* Candidate status */}
                        <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={candStatuses[cand.id] || 'PENDING'}
                            disabled={!isHr}
                            onChange={(e) => changeCandidateStatus(cand.id, e.target.value as CandidateStatus)}
                            className={`text-[11px] font-bold rounded-lg border px-2 py-1 outline-none ${
                              (candStatuses[cand.id] || 'PENDING') === 'REJECTED'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : (candStatuses[cand.id] || 'PENDING') === 'ON_HOLD'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            <option value="PENDING">Pending</option>
                            <option value="ON_HOLD">On hold</option>
                            <option value="REJECTED">Rejected</option>
                          </select>
                        </td>

                        {/* Onboard */}
                        <td className="px-4 py-3.5 text-center" onClick={(e) => e.stopPropagation()}>
                          {candOnboardings[cand.id] ? (
                            <span
                              className="inline-block text-[10px] font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200"
                              title={STATUS_LABELS[candOnboardings[cand.id].status] || candOnboardings[cand.id].status}
                            >
                              {candOnboardings[cand.id].employeeId} · {STATUS_LABELS[candOnboardings[cand.id].status] || candOnboardings[cand.id].status}
                            </span>
                          ) : (
                            <button
                              type="button"
                              disabled={!isHr || (candStatuses[cand.id] || 'PENDING') === 'REJECTED'}
                              onClick={() => {
                                setOnboardTarget({ id: cand.id, name: cand.name });
                                setOnboardDate('');
                              }}
                              className="inline-flex items-center px-2.5 py-1 rounded-lg bg-[#FA7014] hover:bg-[#E65A05] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold text-xs transition-colors cursor-pointer"
                              title={isHr ? 'Start the onboarding flow' : 'Only HR can onboard'}
                            >
                              Onboard
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Matrix Footer Note */}
            <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-500">
              <div className="flex items-center space-x-2">
                <Info className="w-3.5 h-3.5 text-[#FA7014]" />
                <span>
                  Click on any candidate row or <strong>Review</strong> to open the line-by-line
                  verification deep-dive checklist.
                </span>
              </div>
              <span className="font-mono text-[10px]">
                Evaluation Timestamp: {new Date(evaluation.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ONBOARD CONFIRM MODAL */}
      {onboardTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Onboard {onboardTarget.name}</h3>
            <p className="text-xs text-slate-600">
              An employee ID will be generated, previous employment checked, and the document request emailed to the candidate.
            </p>
            <label className="block text-xs font-bold text-slate-700">
              Onboarding (joining) date
              <input
                type="date"
                value={onboardDate}
                onChange={(e) => setOnboardDate(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOnboardTarget(null)}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-100 text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!onboardDate || onboardBusy}
                onClick={confirmOnboard}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-[#FA7014] text-white disabled:bg-slate-300 cursor-pointer"
              >
                {onboardBusy ? 'Starting…' : 'Start onboarding'}
              </button>
            </div>
          </div>
        </div>
      )}
      {onboardMsg && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm bg-slate-900 text-white text-xs rounded-xl px-4 py-3 shadow-lg flex gap-3">
          <span>{onboardMsg}</span>
          <button type="button" onClick={() => setOnboardMsg(null)} className="font-bold cursor-pointer">×</button>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 1: VIEW FULL SHEET JOB DESCRIPTION                    */}
      {/* ============================================================ */}
      {showFullJDModal && evaluation?.jdSummary && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#FA7014] flex items-center justify-center text-white">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {evaluation.jdSummary.designation} — Full Job Description
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    {evaluation.jdSummary.jdSource === 'PORTAL'
                      ? 'Written in this portal'
                      : evaluation.jdSummary.jdSource === 'WEBSITE'
                        ? "From the company's careers website"
                        : 'No description found for this role'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFullJDModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6 text-xs text-slate-700 font-sans">
              {/* Core Attributes Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] text-slate-400 font-medium block">Department</span>
                  <span className="font-bold text-slate-900">{evaluation.jdSummary.department}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-medium block">Required Experience</span>
                  <span className="font-bold text-slate-900">{evaluation.jdSummary.minExperience}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-medium block">Key Skills</span>
                  <span className="font-bold text-slate-900">
                    {evaluation.jdSummary.requiredSkills.length} Criteria
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-medium block">Proof Requirements</span>
                  <span className="font-bold text-slate-900">
                    {evaluation.jdSummary.proofOfWorkRequirements.length} Criteria
                  </span>
                </div>
              </div>

              {/* Extracted Core Responsibilities */}
              {evaluation.jdSummary.coreResponsibilities.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Key Role Responsibilities:
                  </h4>
                  <ul className="list-disc pl-5 space-y-1 text-slate-700">
                    {evaluation.jdSummary.coreResponsibilities.map((resp, i) => (
                      <li key={i}>{resp}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Extracted Required Skills */}
              {evaluation.jdSummary.requiredSkills.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Required Skills &amp; Technical Competencies:
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {evaluation.jdSummary.requiredSkills.map((sk, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 rounded-lg bg-orange-50 text-[#FA7014] border border-orange-200 font-semibold"
                      >
                        {sk}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Extracted Proof of Work Requirements */}
              {evaluation.jdSummary.proofOfWorkRequirements.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                    Proof of Work / Deliverables Required from Candidates:
                  </h4>
                  <ul className="list-disc pl-5 space-y-1 text-slate-700">
                    {evaluation.jdSummary.proofOfWorkRequirements.map((proof, i) => (
                      <li key={i}>{proof}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Job description text (viewer or editor) */}
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">Job description text:</h4>
                  {canEditJd && !jdEditing && (
                    <button
                      type="button"
                      onClick={() => openJdModal(true)}
                      className="text-xs font-bold text-[#FA7014] hover:text-[#E65A05] cursor-pointer"
                    >
                      {evaluation.jdSummary.jdProvided === false ? 'Add JD' : 'Edit JD'}
                    </button>
                  )}
                </div>
                {jdEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={jdDraft}
                      onChange={(e) => setJdDraft(e.target.value)}
                      rows={14}
                      maxLength={20000}
                      placeholder={'Role overview\n\nResponsibilities\n- ...\n\nRequired skills\n- ...\n\nExperience: 2-4 years'}
                      className="w-full bg-white p-3 rounded-xl border border-slate-300 font-mono text-[11px] leading-relaxed text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-[#FA7014]"
                    />
                    <p className="text-[10px] text-slate-500">
                      Use headings such as "Responsibilities" and "Required skills" with one point per line. Candidates are
                      matched against these points, and the minimum experience is read from a line like "Experience: 3 years".
                    </p>
                  </div>
                ) : (
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 font-mono text-[11px] leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto text-slate-800">
                    {evaluation.jdSummary.rawJDText || 'No job description available for this role.'}
                  </div>
                )}
                {jdMsg && <p className="text-[11px] font-medium text-slate-700">{jdMsg}</p>}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-end gap-2 shrink-0">
              {jdEditing && (
                <>
                  {evaluation.jdSummary.jdSource === 'PORTAL' && (
                    <button
                      type="button"
                      onClick={revertJd}
                      disabled={jdBusy !== null}
                      className="mr-auto px-3 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 underline cursor-pointer disabled:opacity-50"
                    >
                      {jdBusy === 'revert' ? 'Reverting…' : 'Revert to website version'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={generateJd}
                    disabled={jdBusy !== null}
                    className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-bold rounded-xl text-xs cursor-pointer disabled:opacity-50"
                  >
                    {jdBusy === 'generate' ? 'Generating…' : 'Generate draft with AI'}
                  </button>
                  <button
                    type="button"
                    onClick={saveJd}
                    disabled={jdBusy !== null || !jdDraft.trim()}
                    className="px-4 py-2 bg-[#FA7014] hover:bg-[#E65A05] text-white font-bold rounded-xl text-xs cursor-pointer disabled:opacity-50"
                  >
                    {jdBusy === 'save' ? 'Saving…' : 'Save job description'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowFullJDModal(false);
                  setJdEditing(false);
                }}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: CANDIDATE DEEP DIVE REVIEW DRAWER / MODAL          */}
      {/* ============================================================ */}
      {selectedCandidateForDeepDive && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-[#FA7014] flex items-center justify-center font-bold text-white text-sm">
                  {selectedCandidateForDeepDive.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-base font-bold text-white">
                      {selectedCandidateForDeepDive.name}
                    </h3>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getTierColorClass(
                        selectedCandidateForDeepDive.overallAlignment
                      )}`}
                    >
                      {selectedCandidateForDeepDive.overallAlignment}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {selectedCandidateForDeepDive.scored === false
                      ? 'Not scored'
                      : `Rank #${selectedCandidateForDeepDive.rank} • Score: ${selectedCandidateForDeepDive.alignmentScore}/100`}{' '}
                    • Experience:{' '}
                    {selectedCandidateForDeepDive.experience}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCandidateForDeepDive(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6 text-xs text-slate-700">
              {/* Key Takeaway Callout */}
              <div className="p-3.5 bg-orange-50/70 border border-orange-200 rounded-xl">
                <span className="font-bold text-slate-900 block text-[11px] uppercase tracking-wider mb-1">
                  AI Alignment Assessment:
                </span>
                <p className="text-slate-800 font-medium leading-relaxed">
                  {selectedCandidateForDeepDive.keyTakeaway}
                </p>
              </div>

              {/* Skills Verification Checklist */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  JD Skills Verification Checklist:
                </h4>
                <div className="space-y-1.5">
                  {selectedCandidateForDeepDive.skillsAlignment.map((sk, i) => (
                    <div
                      key={i}
                      className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex items-start justify-between gap-3"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <span className="font-bold text-slate-900 block">{sk.skill}</span>
                        <span className="text-[11px] text-slate-500 block leading-tight">
                          Evidence: {sk.evidence}
                        </span>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 border ${
                          sk.status === 'MET'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : sk.status === 'PARTIAL'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {sk.status === 'MET'
                          ? '✓ Met'
                          : sk.status === 'PARTIAL'
                          ? '~ Partial'
                          : '✕ Not Evidenced'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Documented Strengths & Missing Elements Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Strengths */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Evidenced Strengths:</span>
                  </h4>
                  {selectedCandidateForDeepDive.strengths.length > 0 ? (
                    <ul className="space-y-1.5">
                      {selectedCandidateForDeepDive.strengths.map((st, i) => (
                        <li
                          key={i}
                          className="bg-emerald-50/60 border border-emerald-200/60 p-2 rounded-lg text-emerald-900 leading-snug"
                        >
                          {st}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-slate-400 italic">No verified strengths documented in profile.</p>
                  )}
                </div>

                {/* Missing / Gaps */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Missing / Not Evidenced:</span>
                  </h4>
                  {selectedCandidateForDeepDive.scored === false ? (
                    <p className="text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200">
                      {selectedCandidateForDeepDive.aiNote || selectedCandidateForDeepDive.keyTakeaway}
                    </p>
                  ) : selectedCandidateForDeepDive.missingOrNotEvidenced.length > 0 ? (
                    <ul className="space-y-1.5">
                      {selectedCandidateForDeepDive.missingOrNotEvidenced.map((gap, i) => (
                        <li
                          key={i}
                          className="bg-amber-50/60 border border-amber-200/60 p-2 rounded-lg text-amber-900 leading-snug"
                        >
                          {gap}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-emerald-700 font-semibold bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                      All core JD requirements evidenced in profile.
                    </p>
                  )}
                </div>
              </div>

              {/* Interview Panel Recommendations Checklist */}
              {selectedCandidateForDeepDive.interviewChecklist.length > 0 && (
                <div className="space-y-2 bg-blue-50/60 border border-blue-200/70 p-4 rounded-xl">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-blue-600" />
                    <span>Recommended Interview Verification Priorities:</span>
                  </h4>
                  <ul className="list-disc pl-5 space-y-1 text-blue-950 font-medium">
                    {selectedCandidateForDeepDive.interviewChecklist.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-500">
                Notice: Evaluation based strictly on job-related candidate data in Google Sheets.
              </span>
              <button
                type="button"
                onClick={() => setSelectedCandidateForDeepDive(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Close Review
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
