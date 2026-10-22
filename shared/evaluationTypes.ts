/** Result shapes of the AI candidate evaluation (shared by the API and the browser). */

export interface AiScoringSummary {
  enabled: boolean;
  model?: string;
  totalCandidates: number;
  aiScored: number;
  fromCache: number;
  pending: number;
  failed: number;
  note?: string;
  tokens?: { input: number; output: number };
}

export interface CandidateEvaluationResult {
  id: string;
  name: string;
  experience: string;
  experienceNumeric: number | null;
  experienceVsJD: {
    status: 'EXCEEDS' | 'MEETS' | 'BELOW' | 'NOT_EVIDENCED';
    label: string;
  };
  jobPreference: string;
  noticePeriod: string;
  resumeUrl: string | null;
  alignmentScore: number;
  overallAlignment: 'Strong Evidence' | 'Moderate Evidence' | 'Limited Evidence' | 'Not Evidenced';
  rank: number;
  
  skillsAlignment: {
    skill: string;
    status: 'MET' | 'PARTIAL' | 'NOT_EVIDENCED';
    evidence: string;
  }[];
  
  responsibilitiesAlignment: {
    responsibility: string;
    status: 'MET' | 'PARTIAL' | 'NOT_EVIDENCED';
    evidence: string;
  }[];

  strengths: string[];
  gaps: string[];
  missingOrNotEvidenced: string[];
  
  keyTakeaway: string;
  interviewChecklist: string[];

  /** 'AI' when scored from resume evidence, 'RULES' for the rule-based fallback. */
  scoringMode?: 'AI' | 'RULES';
  aiNote?: string;
}

export interface JDCriteriaSummary {
  designation: string;
  department: string;
  minExperience: string;
  maxExperience: string;
  requiredSkills: string[];
  preferredSkills: string[];
  coreResponsibilities: string[];
  requiredTools: string[];
  proofOfWorkRequirements: string[];
  rawJDText: string;
}

export interface AIEvaluationResponse {
  success: boolean;
  timestamp: string;
  designation: string;
  engineUsed: 'enterprise-algorithmic-ai';
  jdSummary: JDCriteriaSummary;
  totalCandidates: number;
  candidates: CandidateEvaluationResult[];
  comparativeMatrix: {
    criteria: string;
    type: 'EXPERIENCE' | 'SKILL' | 'TOOL' | 'RESPONSIBILITY' | 'PROOF';
    candidateValues: Record<string, { status: 'MET' | 'PARTIAL' | 'NOT_EVIDENCED'; note: string }>;
  }[];
  hrRecommendation: {
    topCandidate: {
      id: string;
      name: string;
      score: number;
      alignmentTier: string;
    } | null;
    summaryReasoning: string;
    supportingEvidence: string[];
    poolComparativeInsight: string;
    advisoryDisclaimer: string;
  };
  fairnessNote: string;
  aiScoring?: AiScoringSummary;
}
