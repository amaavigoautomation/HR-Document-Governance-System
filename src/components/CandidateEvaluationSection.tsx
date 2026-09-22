import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Award,
  ShieldCheck,
  Briefcase,
  Layers,
  Search,
  Filter,
  Users,
  Target,
  Clock,
  ArrowUpDown,
  BookOpen,
  Info,
  X,
} from 'lucide-react';
import { recruitmentService } from '../services/recruitmentService';
import type { AIEvaluationResponse, CandidateEvaluationResult } from '../services/aiEvaluationService';

interface CandidateEvaluationSectionProps {
  availableDesignations?: string[];
  initialDesignation?: string;
  refreshTrigger?: number;
  userRole?: string;
}

export const CandidateEvaluationSection: React.FC<CandidateEvaluationSectionProps> = ({
  availableDesignations = [
    'Performance Marketing Expert',
    'Lead Generation Expert',
    'Social Media Content Creator',
    'Social Media Analyst',
  ],
  initialDesignation = 'Performance Marketing Expert',
  refreshTrigger = 0,
  userRole,
}) => {
  const [selectedDesignation, setSelectedDesignation] = useState<string>(initialDesignation);
  const [data, setData] = useState<AIEvaluationResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [tierFilter, setTierFilter] = useState<string>('ALL');
  const [showFullJD, setShowFullJD] = useState<boolean>(false);

  // Selected candidate for deep-dive inspection drawer/modal
  const [inspectCandidate, setInspectCandidate] = useState<CandidateEvaluationResult | null>(null);

  const fetchEvaluation = async (designation: string, force = false) => {
    try {
      if (force) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const res = await recruitmentService.getAIEvaluation(designation, force, userRole);
      setData(res);
      // Auto-update inspectCandidate if currently viewing someone who updated
      if (inspectCandidate) {
        const updated = res.candidates.find((c) => c.id === inspectCandidate.id);
        if (updated) setInspectCandidate(updated);
      }
    } catch (err: any) {
      console.error('Failed to load candidate evaluation:', err);
      setError(err.message || 'Unable to retrieve evaluation data from Google Sheets.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchEvaluation(selectedDesignation, false);
  }, [selectedDesignation, refreshTrigger]);

  const handleRefresh = () => {
    fetchEvaluation(selectedDesignation, true);
  };

  // Filtered candidate list
  const filteredCandidates = useMemo(() => {
    if (!data?.candidates) return [];
    return data.candidates.filter((cand) => {
      const matchesSearch =
        searchQuery.trim() === '' ||
        cand.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cand.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cand.experience.toLowerCase().includes(searchQuery.toLowerCase()) ||
        cand.strengths.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesTier =
        tierFilter === 'ALL' ||
        cand.overallAlignment.toLowerCase() === tierFilter.toLowerCase();

      return matchesSearch && matchesTier;
    });
  }, [data?.candidates, searchQuery, tierFilter]);

  const getAlignmentBadge = (tier: string) => {
    switch (tier) {
      case 'Strong Evidence':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            Strong Evidence
          </span>
        );
      case 'Moderate Evidence':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertCircle className="w-3 h-3 text-amber-600" />
            Moderate Evidence
          </span>
        );
      case 'Limited Evidence':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
            <AlertCircle className="w-3 h-3 text-orange-600" />
            Limited Evidence
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <HelpCircle className="w-3 h-3 text-slate-400" />
            Not Evidenced
          </span>
        );
    }
  };

  const getRequirementStatusBadge = (status: 'MET' | 'PARTIAL' | 'NOT_EVIDENCED') => {
    switch (status) {
      case 'MET':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800">
            Met
          </span>
        );
      case 'PARTIAL':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">
            Partial
          </span>
        );
      case 'NOT_EVIDENCED':
      default:
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">
            Not Evidenced
          </span>
        );
    }
  };

  return (
    <div
      id="candidate-evaluation-section"
      className="mt-10 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
    >
      {/* 1. Header Banner */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-6 py-5 sm:flex sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-gradient-to-br from-orange-500 to-[#FA7014] text-white rounded-xl shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  Candidate–JD Evaluation & Comparison
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-200">
                  AI-Powered
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Controls & Designation Switcher */}
        <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="designation-select" className="text-xs font-medium text-slate-600 whitespace-nowrap">
              Role:
            </label>
            <select
              id="designation-select"
              value={selectedDesignation}
              onChange={(e) => setSelectedDesignation(e.target.value)}
              className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            >
              {availableDesignations.map((des) => (
                <option key={des} value={des}>
                  {des}
                </option>
              ))}
            </select>
          </div>

          <button
            id="btn-re-evaluate"
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
            title="Recalculate dynamic evaluation from latest Google Sheets data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-orange-600' : 'text-slate-500'}`} />
            {refreshing ? 'Re-analyzing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* 2. Error State */}
      {error && (
        <div className="p-6 bg-rose-50 border-b border-rose-200">
          <div className="flex items-start gap-3 text-rose-800">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-semibold text-sm">Failed to Load Candidate Evaluation</h4>
              <p className="text-sm text-rose-700 mt-1">{error}</p>
              <button
                onClick={handleRefresh}
                className="mt-3 px-3 py-1 bg-rose-600 text-white rounded text-xs font-semibold hover:bg-rose-700 transition"
              >
                Retry Evaluation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Loading State Skeleton */}
      {loading && !error && (
        <div className="p-8 space-y-6 animate-pulse">
          <div className="h-20 bg-slate-100 rounded-xl w-full" />
          <div className="h-64 bg-slate-100 rounded-xl w-full" />
          <div className="h-32 bg-slate-100 rounded-xl w-full" />
        </div>
      )}

      {/* 4. Loaded Content */}
      {!loading && !error && data && (
        <div className="p-6 space-y-8">
          {/* 4A. Job Description Context Summary Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-slate-200 text-slate-700 rounded-lg">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-base">
                      Job Description: {data.jdSummary.designation}
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">
                      {data.jdSummary.department}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  id="btn-toggle-raw-jd"
                  onClick={() => setShowFullJD(!showFullJD)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shadow-sm"
                >
                  <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                  {showFullJD ? 'Hide Full JD Text' : 'View Full Sheet JD'}
                  {showFullJD ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Extracted Core Requirements Chips */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">
                  Mandatory & Core Skills Evaluated:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {data.jdSummary.requiredSkills.map((skill, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded-md text-xs font-medium bg-white text-slate-800 border border-slate-200 shadow-xs"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">
                  Key Responsibilities & Deliverables:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {data.jdSummary.coreResponsibilities.map((resp, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 rounded-md text-xs font-medium bg-white text-slate-700 border border-slate-200 shadow-xs"
                    >
                      {resp}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Expandable Raw JD Drawer */}
            {showFullJD && (
              <div className="mt-4 pt-4 border-t border-slate-200 text-xs font-mono bg-white p-4 rounded-lg border border-slate-200 max-h-60 overflow-y-auto whitespace-pre-wrap text-slate-700 leading-relaxed">
                {data.jdSummary.rawJDText || 'No raw JD text available.'}
              </div>
            )}
          </div>

          {/* 4B. Side-by-Side Candidate Comparison Table */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Candidate Comparison Matrix</span>
                  <span className="text-xs font-normal text-slate-500">
                    ({filteredCandidates.length} candidate{filteredCandidates.length === 1 ? '' : 's'} displayed)
                  </span>
                </h3>
                <p className="text-xs text-slate-500">
                  Every candidate evaluated strictly against JD requirements. Missing items marked as "Not provided / Not evidenced".
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2.5">
                {/* Search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search candidate, skill..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-500 w-44"
                  />
                </div>

                {/* Alignment Tier Filter */}
                <select
                  value={tierFilter}
                  onChange={(e) => setTierFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-orange-500"
                >
                  <option value="ALL">All Tiers</option>
                  <option value="Strong Evidence">Strong Evidence</option>
                  <option value="Moderate Evidence">Moderate Evidence</option>
                  <option value="Limited Evidence">Limited Evidence</option>
                  <option value="Not Evidenced">Not Evidenced</option>
                </select>
              </div>
            </div>

            {/* Table Container */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4 w-12 text-center">Rank</th>
                    <th className="py-3 px-4 min-w-[180px]">Candidate Details</th>
                    <th className="py-3 px-4 min-w-[150px]">Evidence Alignment</th>
                    <th className="py-3 px-4 min-w-[160px]">Experience vs JD</th>
                    <th className="py-3 px-4 min-w-[200px]">Core Skills Evidenced</th>
                    <th className="py-3 px-4 min-w-[220px]">Gaps / Missing Proof</th>
                    <th className="py-3 px-4 min-w-[130px]">Supporting Proof</th>
                    <th className="py-3 px-3 w-20 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        No candidates match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredCandidates.map((cand) => {
                      const isTop = cand.rank === 1 && cand.alignmentScore >= 50;
                      return (
                        <tr
                          key={cand.id}
                          className={`hover:bg-slate-50/70 transition-colors ${
                            isTop ? 'bg-orange-50/30 font-normal' : ''
                          }`}
                        >
                          {/* Rank */}
                          <td className="py-3.5 px-4 text-center">
                            <span
                              className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                                isTop
                                  ? 'bg-[#FA7014] text-white shadow-xs'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {cand.rank}
                            </span>
                          </td>

                          {/* Candidate Info */}
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                              {cand.name}
                              {isTop && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-orange-100 text-orange-800">
                                  <Award className="w-3 h-3 text-[#FA7014]" /> Top Pick
                                </span>
                              )}
                            </div>
                            <div className="text-slate-500 text-[11px] mt-0.5 flex items-center gap-2">
                              <span>ID: #{cand.id}</span>
                              <span>•</span>
                              <span>Mode: {cand.jobPreference || 'Not provided / Not evidenced'}</span>
                            </div>
                            <div className="text-slate-500 text-[11px]">
                              Notice: <strong className="text-slate-700">{cand.noticePeriod || 'Not provided / Not evidenced'}</strong>
                            </div>
                          </td>

                          {/* Evidence Alignment & Score */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-1">
                              <div>{getAlignmentBadge(cand.overallAlignment)}</div>
                              <div className="flex items-center gap-2">
                                <div className="w-20 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      cand.alignmentScore >= 75
                                        ? 'bg-emerald-500'
                                        : cand.alignmentScore >= 50
                                        ? 'bg-amber-500'
                                        : 'bg-orange-400'
                                    }`}
                                    style={{ width: `${cand.alignmentScore}%` }}
                                  />
                                </div>
                                <span className="font-mono font-bold text-slate-700 text-xs">
                                  {cand.alignmentScore}/100
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Experience vs JD */}
                          <td className="py-3.5 px-4">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                                cand.experienceVsJD.status === 'EXCEEDS'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : cand.experienceVsJD.status === 'MEETS'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : cand.experienceVsJD.status === 'BELOW'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {cand.experienceVsJD.label}
                            </span>
                            <div className="text-[11px] text-slate-500 mt-1">
                              Raw: {cand.experience || 'Not provided / Not evidenced'}
                            </div>
                          </td>

                          {/* Skills Evidenced */}
                          <td className="py-3.5 px-4">
                            <div className="space-y-1 max-w-xs">
                              {cand.skillsAlignment.slice(0, 3).map((sa, sIdx) => (
                                <div key={sIdx} className="flex items-center justify-between gap-1 text-[11px]">
                                  <span className="text-slate-700 truncate">{sa.skill}</span>
                                  {getRequirementStatusBadge(sa.status)}
                                </div>
                              ))}
                              {cand.skillsAlignment.length > 3 && (
                                <button
                                  onClick={() => setInspectCandidate(cand)}
                                  className="text-[10px] text-orange-600 hover:text-orange-700 font-semibold"
                                >
                                  +{cand.skillsAlignment.length - 3} more skills...
                                </button>
                              )}
                            </div>
                          </td>

                          {/* Gaps / Missing Proof */}
                          <td className="py-3.5 px-4">
                            {cand.missingOrNotEvidenced.length === 0 ? (
                              <span className="text-emerald-600 font-medium flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> No critical gaps flagged
                              </span>
                            ) : (
                              <ul className="space-y-1 max-w-xs">
                                {cand.missingOrNotEvidenced.slice(0, 2).map((gap, gIdx) => (
                                  <li key={gIdx} className="text-rose-700 bg-rose-50/70 px-2 py-0.5 rounded border border-rose-100 text-[11px] leading-tight">
                                    {gap}
                                  </li>
                                ))}
                                {cand.missingOrNotEvidenced.length > 2 && (
                                  <span className="text-[10px] text-slate-500 block">
                                    +{cand.missingOrNotEvidenced.length - 2} additional un-evidenced items
                                  </span>
                                )}
                              </ul>
                            )}
                          </td>

                          {/* Supporting Proof */}
                          <td className="py-3.5 px-4">
                            {cand.resumeUrl ? (
                              <a
                                href={cand.resumeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-orange-600 hover:text-orange-700 font-medium hover:underline text-xs"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                Resume / CV
                                <ExternalLink className="w-3 h-3 text-slate-400" />
                              </a>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">
                                Not provided / Not evidenced
                              </span>
                            )}
                          </td>

                          {/* Deep Dive Action */}
                          <td className="py-3.5 px-3 text-center">
                            <button
                              id={`btn-inspect-${cand.id}`}
                              onClick={() => setInspectCandidate(cand)}
                              className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-md shadow-xs transition"
                              title="Inspect full candidate alignment breakdown and interview questions"
                            >
                              Review
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

          {/* 4C. HR Recommendation Support Section */}
          <div
            id="hr-recommendation-support"
            className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50/50 via-white to-amber-50/30 p-6 shadow-xs"
          >
            <div className="flex items-start justify-between gap-4 border-b border-orange-200/70 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#FA7014] text-white rounded-xl shadow-xs">
                  <Award className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                      HR Recommendation Support — Evidence-Based Alignment
                    </h3>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">
                      Objective Decision Support
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Synthesizes candidate alignment against explicit JD requirements to assist hiring teams without making automated hiring decisions.
                  </p>
                </div>
              </div>
            </div>

            {/* Content: Top Candidate Alignment Card */}
            {data.hrRecommendation.topCandidate ? (
              <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Top Profile Summary Column */}
                <div className="lg:col-span-1 bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-bold text-[#FA7014] uppercase tracking-wider block">
                      Strongest Evidenced Profile
                    </span>
                    <h4 className="text-xl font-extrabold text-slate-900 mt-1">
                      {data.hrRecommendation.topCandidate.name}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Candidate ID #{data.hrRecommendation.topCandidate.id} • {data.designation}
                    </p>

                    <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-xs text-slate-600 font-medium">Evidence Alignment Score:</span>
                      <span className="text-base font-extrabold text-[#FA7014] font-mono">
                        {data.hrRecommendation.topCandidate.score}/100
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-slate-600 font-medium">Evidence Tier:</span>
                      {getAlignmentBadge(data.hrRecommendation.topCandidate.alignmentTier)}
                    </div>
                  </div>

                  {/* Review Profile button */}
                  {data.candidates.find((c) => c.id === data.hrRecommendation.topCandidate?.id) && (
                    <button
                      onClick={() => {
                        const cand = data.candidates.find(
                          (c) => c.id === data.hrRecommendation.topCandidate?.id
                        );
                        if (cand) setInspectCandidate(cand);
                      }}
                      className="mt-6 w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                    >
                      View Detailed Candidate Profile
                    </button>
                  )}
                </div>

                {/* Reasoning & Supporting Evidence Column */}
                <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
                  <div>
                    <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-[#FA7014]" />
                      Reasoning & Supporting Evidence
                    </h5>
                    <p className="text-sm text-slate-800 mt-2 font-medium leading-relaxed">
                      {data.hrRecommendation.summaryReasoning}
                    </p>
                  </div>

                  {data.hrRecommendation.supportingEvidence.length > 0 && (
                    <div>
                      <span className="text-xs font-semibold text-slate-600 block mb-2">
                        Key Supporting Evidence Extracted from Sheet Data:
                      </span>
                      <ul className="space-y-1.5">
                        {data.hrRecommendation.supportingEvidence.map((ev, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                            <span>{ev}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Pool Comparative Insight */}
                  <div className="pt-3 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-600 block mb-1">
                      Pool Comparative Insight:
                    </span>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {data.hrRecommendation.poolComparativeInsight}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 p-4 bg-white rounded-lg text-xs text-slate-600">
                {data.hrRecommendation.summaryReasoning}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Candidate Deep Dive Modal / Drawer */}
      {inspectCandidate && data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-900">{inspectCandidate.name}</h3>
                  <span className="text-xs font-mono bg-slate-200 text-slate-700 px-2 py-0.5 rounded">
                    #{inspectCandidate.id}
                  </span>
                  {getAlignmentBadge(inspectCandidate.overallAlignment)}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Evaluation for {data.designation} • Score: {inspectCandidate.alignmentScore}/100
                </p>
              </div>
              <button
                onClick={() => setInspectCandidate(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              {/* Profile Overview Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-slate-700">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Experience</span>
                  <span className="font-semibold text-slate-900 text-xs mt-0.5 block">{inspectCandidate.experienceVsJD.label}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Job Preference</span>
                  <span className="font-semibold text-slate-900 text-xs mt-0.5 block">{inspectCandidate.jobPreference || 'Not provided / Not evidenced'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Notice Period</span>
                  <span className="font-semibold text-slate-900 text-xs mt-0.5 block">{inspectCandidate.noticePeriod || 'Not provided / Not evidenced'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Resume / Attachment</span>
                  {inspectCandidate.resumeUrl ? (
                    <a
                      href={inspectCandidate.resumeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-orange-600 hover:underline flex items-center gap-1 mt-0.5"
                    >
                      View File <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-slate-400 italic mt-0.5 block">Not provided / Not evidenced</span>
                  )}
                </div>
              </div>

              {/* Required Skills Evidenced Breakdown */}
              <div>
                <h4 className="font-bold text-slate-900 text-sm mb-2.5 flex items-center gap-2">
                  <Target className="w-4 h-4 text-orange-600" />
                  Required Skills & JD Alignment
                </h4>
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {inspectCandidate.skillsAlignment.map((sa, idx) => (
                    <div key={idx} className="p-3 flex items-start justify-between gap-3 bg-white">
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-800">{sa.skill}</div>
                        <div className="text-slate-500 text-[11px] leading-relaxed">{sa.evidence}</div>
                      </div>
                      <div className="flex-shrink-0">
                        {getRequirementStatusBadge(sa.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Strengths & Gaps Side-by-side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Evidenced Strengths */}
                <div className="bg-emerald-50/50 border border-emerald-200 p-4 rounded-xl">
                  <h5 className="font-bold text-emerald-900 text-xs mb-2 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Evidenced Strengths
                  </h5>
                  <ul className="space-y-1.5">
                    {inspectCandidate.strengths.length === 0 ? (
                      <li className="text-slate-500 italic">No specific strengths documented.</li>
                    ) : (
                      inspectCandidate.strengths.map((str, idx) => (
                        <li key={idx} className="text-slate-700 flex items-start gap-1.5 leading-relaxed">
                          <span className="text-emerald-600 font-bold">•</span>
                          <span>{str}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                {/* Missing or Un-evidenced Requirements */}
                <div className="bg-rose-50/50 border border-rose-200 p-4 rounded-xl">
                  <h5 className="font-bold text-rose-900 text-xs mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    Gaps / Not Evidenced
                  </h5>
                  <ul className="space-y-1.5">
                    {inspectCandidate.missingOrNotEvidenced.length === 0 ? (
                      <li className="text-emerald-700 italic">No explicit gaps flagged against JD.</li>
                    ) : (
                      inspectCandidate.missingOrNotEvidenced.map((gap, idx) => (
                        <li key={idx} className="text-rose-800 flex items-start gap-1.5 leading-relaxed">
                          <span className="text-rose-600 font-bold">•</span>
                          <span>{gap}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>

              {/* Recommended Interview Verification Checklist */}
              {inspectCandidate.interviewChecklist.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
                  <h5 className="font-bold text-slate-800 text-xs mb-2 flex items-center gap-1.5">
                    <Info className="w-4 h-4 text-slate-500" />
                    Recommended Verification Topics for Interview Committee
                  </h5>
                  <ul className="space-y-1">
                    {inspectCandidate.interviewChecklist.map((item, idx) => (
                      <li key={idx} className="text-slate-600 flex items-start gap-1.5">
                        <span className="text-orange-600 font-bold">→</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                Objective HR assessment based on candidate profile evidence
              </span>
              <button
                onClick={() => setInspectCandidate(null)}
                className="px-4 py-1.5 bg-slate-900 text-white font-medium rounded-lg text-xs hover:bg-slate-800 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
