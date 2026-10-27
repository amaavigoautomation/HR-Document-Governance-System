/** Result shapes of the AI candidate evaluation (shared by the API and the browser). */

export interface AiScoringSummary {
  enabled: boolean;
  model?: string;
  totalCandidates: number;
  aiScored: number;
  fromCache: number;
  pending: number;
  failed: number;
  /** Candidates scored by matching the JD against their resume text (no AI call). */
  keywordScored?: number;
  /** Candidates whose resume has not been read yet (time budget reached); refresh to continue. */
  keywordPending?: number;
  /** Resumes that could not be read, with the most common reason. */
  keywordFailed?: number;
  keywordFailureNote?: string;
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
  /** The role the applicant applied for (always set; the list view of all roles shows it). */
  role?: string;
  alignmentScore: number;
  /** false when there is nothing to score from yet (no JD, no resume, or resume not read). alignmentScore is 0 and must not be shown as a score. */
  scored?: boolean;
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

  /** 'AI' = resume read by the model, 'KEYWORDS' = JD requirements matched against the resume text, 'RULES' = from recruiter notes (Pros/Cons) only. */
  scoringMode?: 'AI' | 'KEYWORDS' | 'RULES';
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
  /** false when no JD text exists for this role, so no criteria could be taken from it. */
  jdProvided?: boolean;
  /** PORTAL = written or edited on the evaluation screen, REQUISITION = stored on the hiring requisition, WEBSITE = from the company's careers API, NONE = missing. */
  jdSource?: 'PORTAL' | 'REQUISITION' | 'WEBSITE' | 'NONE';
}

export interface AIEvaluationResponse {
  success: boolean;
  timestamp: string;
  designation: string;
  engineUsed: 'enterprise-algorithmic-ai';
  jdSummary: JDCriteriaSummary;
  totalCandidates: number;
  /** Set when this is the list of every role: each applicant is scored against their own role's JD. */
  allRoles?: { roles: number; rolesMissingJd: string[] };
  /** Repeat applications by the same person that were merged into their latest one. */
  duplicatesMerged?: number;
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
