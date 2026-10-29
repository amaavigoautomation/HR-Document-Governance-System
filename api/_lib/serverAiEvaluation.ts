import { fetchSheetData, getSpreadsheetTabNames } from './serverSheets.js';
import { applyAiScoring, experiencePoints } from './aiScoring.js';
import { applyKeywordScoring } from './resumeKeywords.js';
import { designationKey } from './jobDescriptions.js';

export type { CandidateEvaluationResult, JDCriteriaSummary, AIEvaluationResponse } from '../../shared/evaluationTypes.js';
import type { CandidateEvaluationResult, JDCriteriaSummary, AIEvaluationResponse } from '../../shared/evaluationTypes.js';

// In-memory cache for evaluation results (invalidated on refresh)
const evaluationCache = new Map<string, { data: AIEvaluationResponse; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000;

/** Clears cached evaluations; with a company id only that company's entries go. */
export function clearEvaluationCache(companyId?: string) {
  if (!companyId) {
    evaluationCache.clear();
    return;
  }
  for (const key of Array.from(evaluationCache.keys())) if (key.startsWith(`${companyId}|`)) evaluationCache.delete(key);
}

/**
 * Extracts number of years from experience string (e.g. "2.11 Years", "7+", "10months", "1–3 years")
 */
function parseExperienceYears(expStr: string | null | undefined): number | null {
  if (!expStr || typeof expStr !== 'string') return null;
  const s = expStr.trim().toLowerCase();
  if (!s || s === 'not provided' || s === 'none' || s === 'fresher') return 0;
  
  // Months: e.g. "10months", "6 months"
  const monthMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:month|mos)/);
  if (monthMatch) {
    return Math.round((parseFloat(monthMatch[1]) / 12) * 10) / 10;
  }

  // Years: e.g. "2.11 years", "7+", "5 yrs", "3"
  const yearMatch = s.match(/(\d+(?:\.\d+)?)/);
  if (yearMatch) {
    return parseFloat(yearMatch[1]);
  }

  return null;
}

/**
 * Parses JD Markdown or raw text into structured criteria
 */
export function parseJDText(designation: string, jdText: string, source: 'PORTAL' | 'REQUISITION' | 'WEBSITE' | 'NONE' = 'WEBSITE'): JDCriteriaSummary {
  const norm = (jdText || '').trim();
  
  let minExp = 'Not specified';
  let maxExp = 'Not specified';
  const expMatch = norm.match(/(?:experience|exp)[^\n:]*[:\-\s]+(\d+)(?:\s*[-–to]+\s*(\d+))?\s*(?:year|yr|\+)/i);
  if (expMatch) {
    minExp = `${expMatch[1]} Years`;
    if (expMatch[2]) {
      maxExp = `${expMatch[2]} Years`;
    }
  }

  // Common designation-specific criteria extraction
  const requiredSkills: string[] = [];
  const preferredSkills: string[] = [];
  const coreResponsibilities: string[] = [];
  const requiredTools: string[] = [];
  const proofOfWorkRequirements: string[] = [];

  // Parse lines or sections
  const lines = norm.split('\n').map(l => l.trim()).filter(Boolean);
  let currentSection = '';

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/responsibilit/i.test(lower)) {
      currentSection = 'RESPONSIBILITIES';
      continue;
    } else if (/technical requirement|required skill|must understand|skills/i.test(lower)) {
      currentSection = 'REQUIRED_SKILLS';
      continue;
    } else if (/preferred|nice to have/i.test(lower)) {
      currentSection = 'PREFERRED_SKILLS';
      continue;
    } else if (/tool|platforms/i.test(lower)) {
      currentSection = 'TOOLS';
      continue;
    } else if (/proof|applicant.*must.*(?:share|provide)|portfolio|kpi/i.test(lower)) {
      currentSection = 'PROOF';
      continue;
    } else if (/^(##|###|\*\*)/.test(line)) {
      currentSection = 'OTHER';
    }

    const cleanedLine = line.replace(/^[•\*\-\d\.\s]+/, '').trim();
    if (!cleanedLine || cleanedLine.length < 3 || cleanedLine.length > 120) continue;
    if (/^(we are specifically|must understand|we are looking for|what amaavigo offers|how to apply|role overview|applicants must)/i.test(cleanedLine)) continue;

    if (currentSection === 'RESPONSIBILITIES' && coreResponsibilities.length < 6) {
      coreResponsibilities.push(cleanedLine);
    } else if (currentSection === 'REQUIRED_SKILLS' && requiredSkills.length < 8) {
      requiredSkills.push(cleanedLine);
    } else if (currentSection === 'PREFERRED_SKILLS' && preferredSkills.length < 6) {
      preferredSkills.push(cleanedLine);
    } else if (currentSection === 'TOOLS' && requiredTools.length < 6) {
      requiredTools.push(cleanedLine);
    } else if (currentSection === 'PROOF' && proofOfWorkRequirements.length < 5) {
      proofOfWorkRequirements.push(cleanedLine);
    }
  }

  // A JD that has no recognisable headings: use its bullet points as the requirements, so a plainly written
  // description still gives something to score against. No JD at all means no criteria (nothing is invented).
  if (norm && requiredSkills.length === 0) {
    for (const line of lines) {
      if (!/^\s*(?:[•*\-–]|\d+[.)])\s+\S/.test(line)) continue;
      const cleaned = line.replace(/^[•\*\-–\d\.\)\s]+/, '').trim();
      if (cleaned.length < 4 || cleaned.length > 120) continue;
      if (coreResponsibilities.includes(cleaned)) continue;
      requiredSkills.push(cleaned);
      if (requiredSkills.length >= 8) break;
    }
  }

  return {
    designation,
    department: /marketing|content|social/i.test(designation) ? 'Marketing' : 'Not specified',
    minExperience: minExp,
    maxExperience: maxExp,
    requiredSkills,
    preferredSkills,
    coreResponsibilities,
    requiredTools,
    proofOfWorkRequirements,
    rawJDText: norm,
    jdProvided: norm.length > 0,
    jdSource: norm ? source : 'NONE',
  };
}

/**
 * Evaluates candidate using our resilient, deep algorithmic AI evaluator
 */
function evaluateCandidateAlgorithmic(
  cand: any,
  jd: JDCriteriaSummary,
  allCandidatesCount: number
): CandidateEvaluationResult {
  const name = String(cand.name || 'Candidate').trim();
  const id = String(cand.id || '').trim();
  const rawExp = cand.experience !== undefined && cand.experience !== null && String(cand.experience).trim() !== ''
    ? String(cand.experience).trim()
    : 'Not provided / Not evidenced';

  const expNum = parseExperienceYears(rawExp);
  const pros = String(cand.pros || '').trim();
  const cons = String(cand.cons || '').trim();
  const jobPref = String(cand.job_preference || 'Not provided / Not evidenced').trim();
  const notice = String(cand.notice_period || 'Not provided / Not evidenced').trim();
  const resumeUrl = cand.attachment_url && String(cand.attachment_url).startsWith('http')
    ? String(cand.attachment_url).trim()
    : null;

  // 1. Experience check
  const minExpNum = parseExperienceYears(jd.minExperience) || 0;
  let expStatus: 'EXCEEDS' | 'MEETS' | 'BELOW' | 'NOT_EVIDENCED' = 'NOT_EVIDENCED';
  let expLabel = 'Not provided / Not evidenced';

  if (expNum !== null) {
    if (minExpNum === 0) {
      expStatus = 'MEETS';
      expLabel = `${expNum} Years documented`;
    } else if (expNum >= minExpNum + 2) {
      expStatus = 'EXCEEDS';
      expLabel = `${expNum} Years (Exceeds ${minExpNum}+ yrs requirement)`;
    } else if (expNum >= minExpNum) {
      expStatus = 'MEETS';
      expLabel = `${expNum} Years (Meets ${minExpNum}+ yrs requirement)`;
    } else {
      expStatus = 'BELOW';
      expLabel = `${expNum} Years (Below ${minExpNum}+ yrs requirement)`;
    }
  }

  // 2. Skills alignment check against JD requirements
  const skillsAlignment = jd.requiredSkills.map(skill => {
    const sLower = skill.toLowerCase();
    const keywords = sLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    
    // Check in Pros and Cons
    const combinedText = `${pros} ${cons}`.toLowerCase();
    const prosLower = pros.toLowerCase();
    const consLower = cons.toLowerCase();

    // Check if explicitly noted as gap/missing in Cons
    const mentionedInConsMissing = keywords.some(k => 
      consLower.includes(`no ${k}`) || 
      consLower.includes(`missing ${k}`) || 
      consLower.includes(`not ${k}`) ||
      consLower.includes(`no evidence of ${k}`) ||
      consLower.includes(`does not explicitly mention ${k}`)
    );

    // Check if explicitly demonstrated in Pros
    const mentionedInPros = keywords.some(k => 
      prosLower.includes(k) && 
      (prosLower.includes('experience') || prosLower.includes('hands-on') || prosLower.includes('strong') || prosLower.includes('proven') || prosLower.includes('demonstrated'))
    );

    if (mentionedInPros && !mentionedInConsMissing) {
      // Find matching sentence in pros
      const sentence = pros.split(/[.;]/).find(s => keywords.some(k => s.toLowerCase().includes(k)))?.trim();
      return {
        skill,
        status: 'MET' as const,
        evidence: sentence || `Demonstrated hands-on experience in ${skill}`,
      };
    } else if (mentionedInConsMissing) {
      const sentence = cons.split(/[.;]/).find(s => keywords.some(k => s.toLowerCase().includes(k)))?.trim();
      return {
        skill,
        status: 'NOT_EVIDENCED' as const,
        evidence: sentence || 'Not provided / Not evidenced in profile',
      };
    } else {
      // Check partial match
      const hasAnyKeyword = keywords.some(k => combinedText.includes(k));
      if (hasAnyKeyword) {
        return {
          skill,
          status: 'PARTIAL' as const,
          evidence: `Related experience mentioned, but comprehensive verification not fully evidenced`,
        };
      }
      return {
        skill,
        status: 'NOT_EVIDENCED' as const,
        evidence: 'Not provided / Not evidenced',
      };
    }
  });

  // 3. Responsibilities alignment
  const responsibilitiesAlignment = jd.coreResponsibilities.map(resp => {
    const rLower = resp.toLowerCase();
    const keywords = rLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
    const inPros = keywords.some(k => pros.toLowerCase().includes(k));
    const inConsMissing = keywords.some(k => 
      cons.toLowerCase().includes(`no evidence of ${k}`) || 
      cons.toLowerCase().includes(`no ${k}`) ||
      cons.toLowerCase().includes(`missing ${k}`)
    );

    if (inPros && !inConsMissing) {
      return {
        responsibility: resp,
        status: 'MET' as const,
        evidence: 'Demonstrated history executing comparable workflows',
      };
    } else if (inConsMissing) {
      return {
        responsibility: resp,
        status: 'NOT_EVIDENCED' as const,
        evidence: 'Not provided / Not evidenced',
      };
    }
    return {
      responsibility: resp,
      status: inPros ? ('PARTIAL' as const) : ('NOT_EVIDENCED' as const),
      evidence: inPros ? 'Partial alignment noted' : 'Not provided / Not evidenced',
    };
  });

  // 4. Strengths (extracted from Pros, clean and bulleted)
  const strengths: string[] = [];
  if (pros) {
    const parts = pros.split(/[;\n]/).map(p => p.trim()).filter(p => p.length > 10);
    parts.slice(0, 5).forEach(p => strengths.push(p.replace(/^[•\-\*\s]+/, '')));
  }
  if (expStatus === 'EXCEEDS' || expStatus === 'MEETS') {
    strengths.unshift(expLabel);
  }

  // 5. Gaps (extracted from Cons, clean and bulleted)
  const gaps: string[] = [];
  const missingOrNotEvidenced: string[] = [];
  if (cons) {
    const parts = cons.split(/[;\n]/).map(p => p.trim()).filter(p => p.length > 10);
    parts.forEach(p => {
      const clean = p.replace(/^[•\-\*\s]+/, '');
      gaps.push(clean);
      if (/no evidence|not provided|missing|no mention|does not demonstrate|cannot verify/i.test(clean)) {
        missingOrNotEvidenced.push(clean);
      }
    });
  }

  // Also check if any required skills were not evidenced
  skillsAlignment.forEach(sa => {
    if (sa.status === 'NOT_EVIDENCED' && !missingOrNotEvidenced.some(m => m.toLowerCase().includes(sa.skill.toLowerCase()))) {
      missingOrNotEvidenced.push(`${sa.skill}: Not provided / Not evidenced`);
    }
  });

  // If no resume attachment
  if (!resumeUrl) {
    missingOrNotEvidenced.push('Portfolio / Resume attachment document: Not provided / Not evidenced');
  }

  // 6. Score calculation based strictly on evidenced alignment
  // Experience weight: 25%
  let score = experiencePoints(expStatus, expNum, expLabel);
  
  // Skills weight: 45%
  const metSkills = skillsAlignment.filter(s => s.status === 'MET').length;
  const partialSkills = skillsAlignment.filter(s => s.status === 'PARTIAL').length;
  const totalSkills = Math.max(1, skillsAlignment.length);
  const skillScore = ((metSkills * 1.0 + partialSkills * 0.4) / totalSkills) * 45;
  score += Math.round(skillScore);

  // Responsibilities weight: 20%
  const metResp = responsibilitiesAlignment.filter(r => r.status === 'MET').length;
  const totalResp = Math.max(1, responsibilitiesAlignment.length);
  const partResp = responsibilitiesAlignment.filter(r => r.status === 'PARTIAL').length;
  score += Math.round(((metResp + partResp * 0.4) / totalResp) * 20);

  // Proof / Portfolio weight: 10%
  if (resumeUrl) score += 5;
  if (strengths.some(s => /case stud|roas|cpl|metrics|results|portfolio|lead quality/i.test(s))) score += 5;

  // Cap score between 10 and 98
  const baseSheetScore = parseInt(cand.score, 10);
  if (!isNaN(baseSheetScore) && baseSheetScore > 0) {
    // Blend with sheet score if present
    score = Math.round((score * 0.6) + (baseSheetScore * 0.4));
  }
  score = Math.min(98, Math.max(5, score));

  // Overall alignment category
  let overallAlignment: 'Strong Evidence' | 'Moderate Evidence' | 'Limited Evidence' | 'Not Evidenced' = 'Not Evidenced';
  if (score >= 75) overallAlignment = 'Strong Evidence';
  else if (score >= 55) overallAlignment = 'Moderate Evidence';
  else if (score >= 35) overallAlignment = 'Limited Evidence';
  else overallAlignment = 'Not Evidenced';

  // Key takeaway
  let keyTakeaway = '';
  if (overallAlignment === 'Strong Evidence') {
    keyTakeaway = `Strongest alignment in the pool: possesses ${rawExp} experience, verified mastery of core channels, and demonstrable campaign outcomes meeting the JD criteria.`;
  } else if (overallAlignment === 'Moderate Evidence') {
    keyTakeaway = `Relevant experience present (${rawExp}) with core competencies, but specific technical requirements (e.g. CAPI or outreach automation) require interview validation.`;
  } else {
    keyTakeaway = `Significant gaps against explicit JD requirements; critical core competencies and measurable portfolio proof are not evidenced in profile.`;
  }

  // Interview Checklist
  const interviewChecklist: string[] = [];
  if (missingOrNotEvidenced.length > 0) {
    missingOrNotEvidenced.slice(0, 3).forEach(m => {
      interviewChecklist.push(`Verify proof and hands-on depth for: ${m.replace(/: Not provided.*/, '')}`);
    });
  }
  if (notice && notice !== 'Not provided / Not evidenced') {
    interviewChecklist.push(`Confirm availability and notice period commitment (${notice})`);
  }

  // A score needs evidence. Rows from the website API carry no recruiter notes (Pros/Cons), so without a JD and
  // without a resume reading there is nothing to score from: say so instead of showing a number every
  // candidate would share. The keyword and AI passes score these rows afterwards.
  const hasCriteria = jd.requiredSkills.length + jd.coreResponsibilities.length > 0;
  const scored = hasCriteria && !!(pros || cons);
  if (!scored) {
    return {
      id,
      name,
      experience: rawExp,
      experienceNumeric: expNum,
      experienceVsJD: { status: expStatus, label: expLabel },
      jobPreference: jobPref,
      noticePeriod: notice,
      resumeUrl,
      alignmentScore: 0,
      scored: false,
      overallAlignment: 'Not Evidenced',
      rank: 1,
      skillsAlignment,
      responsibilitiesAlignment,
      strengths: expStatus === 'EXCEEDS' || expStatus === 'MEETS' ? [expLabel] : [],
      gaps: [],
      missingOrNotEvidenced: [],
      keyTakeaway: hasCriteria
        ? 'Not scored yet: the resume has not been read.'
        : 'Not scored: this role has no job description yet. Add one to score candidates.',
      interviewChecklist: notice && notice !== 'Not provided / Not evidenced' ? [`Confirm availability and notice period commitment (${notice})`] : [],
      scoringMode: 'RULES',
      aiNote: hasCriteria ? undefined : 'Add a job description for this role to score candidates.',
    };
  }

  return {
    id,
    name,
    experience: rawExp,
    experienceNumeric: expNum,
    experienceVsJD: {
      status: expStatus,
      label: expLabel,
    },
    jobPreference: jobPref,
    noticePeriod: notice,
    resumeUrl,
    alignmentScore: score,
    scored: true,
    overallAlignment,
    rank: 1, // will be sorted later
    skillsAlignment,
    responsibilitiesAlignment,
    strengths,
    gaps,
    missingOrNotEvidenced: missingOrNotEvidenced.slice(0, 5),
    keyTakeaway,
    interviewChecklist: interviewChecklist.slice(0, 4),
    scoringMode: 'RULES',
  };
}

/** Identity of an applicant for spotting repeat applications: email first, then mobile, then name. */
export function personKey(email: unknown, mobile: unknown, name: unknown): string {
  const e = String(email ?? '').trim().toLowerCase();
  if (e) return `e:${e}`;
  const m = String(mobile ?? '').replace(/\D+/g, '').slice(-10);
  if (m.length >= 8) return `m:${m}`;
  const n = String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return n ? `n:${n}` : '';
}

/** One row per person: the most recent application wins (later date, then later position in the list). */
export function collapseRepeatApplications<T extends { _identity: string; _appliedAt: number; _order: number }>(rows: T[]): T[] {
  const latest = new Map<string, T>();
  const keep: T[] = [];
  for (const r of rows) {
    if (!r._identity) {
      keep.push(r);
      continue;
    }
    const cur = latest.get(r._identity);
    if (!cur || r._appliedAt > cur._appliedAt || (r._appliedAt === cur._appliedAt && r._order > cur._order)) latest.set(r._identity, r);
  }
  return [...keep, ...latest.values()].sort((a, b) => a._order - b._order);
}

/**
 * Main evaluation orchestrator:
 * 1. Reads JD from sheet
 * 2. Reads Candidates from sheet
 * 3. Compares all candidates against JD and each other
 * 4. Generates HR recommendation support
 */
export async function runCandidateEvaluation(
  companyId: string,
  designation: string,
  forceRefresh = false,
  evaluateWithAi = false,
  opts: { keywordBudgetMs?: number } = {}
): Promise<AIEvaluationResponse> {
  if (isAllRolesName(designation)) return runAllRolesEvaluation(companyId, forceRefresh);

  // Evaluations are cached per company: the same job title in two companies must never share a result.
  const cacheKey = `${companyId}|${designation.toLowerCase().trim()}`;
  const now = Date.now();
  if (!forceRefresh && !evaluateWithAi && evaluationCache.has(cacheKey)) {
    const cached = evaluationCache.get(cacheKey)!;
    if (now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  // 1. Fetch JD tab
  let rawJDText = '';
  let jdSource: 'PORTAL' | 'REQUISITION' | 'WEBSITE' | 'NONE' = 'NONE';
  try {
    const jdsSheet = await fetchSheetData(companyId, "JD's");
    const target = designationKey(designation);
    // The exact role first, so "Sales Manager" never picks up the "Inside Sales Manager" description.
    const sameRole = jdsSheet.rows.filter(r => designationKey(String(r[0] || '')) === target);
    const looseRole = jdsSheet.rows.filter(r => {
      const k = designationKey(String(r[0] || ''));
      return !!k && (k.includes(target) || target.includes(k));
    });
    const matchedRow = sameRole.find(r => r[1]) || looseRole.find(r => r[1]);
    if (matchedRow && matchedRow[1]) {
      rawJDText = String(matchedRow[1]);
      jdSource = matchedRow[2] === 'PORTAL' || matchedRow[2] === 'REQUISITION' ? matchedRow[2] : 'WEBSITE';
    }
  } catch (err) {
    console.warn("Could not read JD's tab, checking Request Data...", err);
  }

  // Fallback to Request data tab if JD's had no match
  if (!rawJDText) {
    try {
      const reqDataSheet = await fetchSheetData(companyId, 'Request Data');
      const posColIdx = reqDataSheet.headers.findIndex(h => /position|title|designation/i.test(h));
      const jdColIdx = reqDataSheet.headers.findIndex(h => /job description|jd/i.test(h));
      const skillsColIdx = reqDataSheet.headers.findIndex(h => /required skills|skills/i.test(h));
      if (posColIdx !== -1) {
        const row = reqDataSheet.rows.find(r => 
          String(r[posColIdx] || '').toLowerCase().includes(designation.toLowerCase())
        );
        if (row) {
          rawJDText = (row[jdColIdx] ? String(row[jdColIdx]) : '') + '\n' + (row[skillsColIdx] ? String(row[skillsColIdx]) : '');
        }
      }
    } catch {
      // ignore
    }
  }

  if (rawJDText.trim() && jdSource === 'NONE') jdSource = 'WEBSITE';
  const jdSummary = parseJDText(designation, rawJDText, jdSource);

  // 2. Fetch Candidates for this designation tab
  let candidateRows: any[] = [];
  let candHeaders: string[] = [];

  // Try exact tab name
  const allTabs = await getSpreadsheetTabNames(companyId);
  const matchedTab = allTabs.find(t => t.toLowerCase().trim() === designation.toLowerCase().trim()) ||
    allTabs.find(t => t.toLowerCase().includes(designation.toLowerCase()) || designation.toLowerCase().includes(t.toLowerCase()));

  if (matchedTab) {
    try {
      const sheet = await fetchSheetData(companyId, matchedTab);
      candHeaders = sheet.headers;
      candidateRows = sheet.rows;
    } catch (e) {
      console.warn(`Failed reading tab ${matchedTab}:`, e);
    }
  }

  // Fallback to Candidate Log if specific tab is empty
  if (candidateRows.length === 0) {
    try {
      const logSheet = await fetchSheetData(companyId, 'Candidate Log');
      candHeaders = logSheet.headers;
      const desigIdx = logSheet.headers.findIndex(h => /designation|role|position/i.test(h));
      if (desigIdx !== -1) {
        candidateRows = logSheet.rows.filter(r => 
          String(r[desigIdx] || '').toLowerCase().includes(designation.toLowerCase())
        );
      }
    } catch (e) {
      console.warn("Failed reading Candidate Log:", e);
    }
  }

  // Map candidate rows into normalized candidate objects (stripping protected personal details!)
  const idIdx = candHeaders.findIndex(h => /^id$/i.test(h) || /candidate.*id/i.test(h));
  const nameIdx = candHeaders.findIndex(h => /^name$/i.test(h) || /candidate.*name/i.test(h));
  const expIdx = candHeaders.findIndex(h => /^experience$/i.test(h));
  const noticeIdx = candHeaders.findIndex(h => /notice.*period/i.test(h));
  const jobPrefIdx = candHeaders.findIndex(h => /job.*preference|work.*mode/i.test(h));
  const attachIdx = candHeaders.findIndex(h => /attachment.*url|resume|cv/i.test(h));
  const scoreIdx = candHeaders.findIndex(h => /score/i.test(h));
  const prosIdx = candHeaders.findIndex(h => /^pros$/i.test(h) || /strengths/i.test(h));
  const consIdx = candHeaders.findIndex(h => /^cons$/i.test(h) || /gaps/i.test(h));

  // Used only to recognise repeat applications; never sent to the browser.
  const emailIdx = candHeaders.findIndex(h => /^e-?mail$/i.test(h));
  const mobileIdx = candHeaders.findIndex(h => /^(mobile|phone)/i.test(h));
  const appliedIdx = candHeaders.findIndex(h => /^applied on$|^created/i.test(h));

  const allParsed = candidateRows.map((row, idx) => {
    return {
      _identity: personKey(
        emailIdx !== -1 ? row[emailIdx] : null,
        mobileIdx !== -1 ? row[mobileIdx] : null,
        nameIdx !== -1 ? row[nameIdx] : null
      ),
      _appliedAt: appliedIdx !== -1 ? Date.parse(String(row[appliedIdx] || '')) || 0 : 0,
      _order: idx,
      id: idIdx !== -1 && row[idIdx] ? String(row[idIdx]).trim() : `CAND-${idx + 1}`,
      name: nameIdx !== -1 && row[nameIdx] ? String(row[nameIdx]).trim() : `Applicant ${idx + 1}`,
      experience: expIdx !== -1 ? row[expIdx] : null,
      notice_period: noticeIdx !== -1 ? row[noticeIdx] : null,
      job_preference: jobPrefIdx !== -1 ? row[jobPrefIdx] : null,
      attachment_url: attachIdx !== -1 ? row[attachIdx] : null,
      score: scoreIdx !== -1 ? row[scoreIdx] : null,
      pros: prosIdx !== -1 ? row[prosIdx] : null,
      cons: consIdx !== -1 ? row[consIdx] : null,
    };
  });

  // The same person applying again is one candidate: keep their latest application.
  const parsedCandidates = collapseRepeatApplications(allParsed);
  const duplicatesMerged = allParsed.length - parsedCandidates.length;

  // Evaluate each candidate
  let evaluatedCandidates = parsedCandidates.map(cand => 
    evaluateCandidateAlgorithmic(cand, jdSummary, parsedCandidates.length)
  );

  // Free pass: match the JD against each resume's text (no AI call) for everyone who has no score yet.
  const keywordRun = await applyKeywordScoring({ jd: jdSummary, results: evaluatedCandidates, budgetMs: opts.keywordBudgetMs });
  evaluatedCandidates = keywordRun.results;

  // Optional resume-evidence scoring with OpenAI (cached; only runs when HR clicks Evaluate)
  const aiRun = await applyAiScoring({ companyId, jd: jdSummary, results: evaluatedCandidates, evaluate: evaluateWithAi });
  evaluatedCandidates = aiRun.results;
  aiRun.summary.keywordScored = keywordRun.summary.scored;
  aiRun.summary.keywordPending = keywordRun.summary.pending;
  aiRun.summary.keywordFailed = keywordRun.summary.failed;
  aiRun.summary.keywordFailureNote = keywordRun.summary.failureNote;
  // Several candidates with exactly the same score means the criteria are not telling them apart (for example a
  // job description whose requirements nothing in the resumes can match). Say so instead of showing a flat list.
  const scoredNow = evaluatedCandidates.filter(c => c.scored !== false);
  if (scoredNow.length >= 3 && new Set(scoredNow.map(c => c.alignmentScore)).size === 1 && !aiRun.summary.note) {
    aiRun.summary.note = `All ${scoredNow.length} scored candidates got ${scoredNow[0].alignmentScore}. The job description's requirements are probably too generic or too specific to match the resumes: open View / edit JD and list concrete skills and responsibilities.`;
  }

  // Scored candidates first (best first); candidates with nothing to score from follow in application order.
  evaluatedCandidates.sort((a, b) => (b.scored === false ? 0 : 1) - (a.scored === false ? 0 : 1) || b.alignmentScore - a.alignmentScore);
  // Assign ranks
  evaluatedCandidates = evaluatedCandidates.map((c, idx) => ({ ...c, rank: idx + 1, role: designation }));

  // 3. Build Comparative Matrix
  const comparativeCriteria: { criteria: string; type: 'EXPERIENCE' | 'SKILL' | 'TOOL' | 'RESPONSIBILITY' | 'PROOF' }[] = [
    { criteria: `Years of Relevant Experience (${jdSummary.minExperience || 'Required'})`, type: 'EXPERIENCE' },
    ...jdSummary.requiredSkills.slice(0, 4).map(s => ({ criteria: s, type: 'SKILL' as const })),
    ...jdSummary.coreResponsibilities.slice(0, 3).map(r => ({ criteria: r, type: 'RESPONSIBILITY' as const })),
    { criteria: 'Measurable Proof / Portfolio Deliverables', type: 'PROOF' as const },
  ];

  const comparativeMatrix = comparativeCriteria.map(cc => {
    const candidateValues: Record<string, { status: 'MET' | 'PARTIAL' | 'NOT_EVIDENCED'; note: string }> = {};
    
    evaluatedCandidates.forEach(cand => {
      if (cc.type === 'EXPERIENCE') {
        const met = cand.experienceVsJD.status === 'MEETS' || cand.experienceVsJD.status === 'EXCEEDS';
        candidateValues[cand.id] = {
          status: met ? 'MET' : cand.experienceNumeric && cand.experienceNumeric > 0 ? 'PARTIAL' : 'NOT_EVIDENCED',
          note: cand.experienceVsJD.label,
        };
      } else if (cc.type === 'SKILL') {
        const found = cand.skillsAlignment.find(s => s.skill === cc.criteria);
        candidateValues[cand.id] = {
          status: found ? found.status : 'NOT_EVIDENCED',
          note: found ? found.evidence : 'Not provided / Not evidenced',
        };
      } else if (cc.type === 'RESPONSIBILITY') {
        const found = cand.responsibilitiesAlignment.find(r => r.responsibility === cc.criteria);
        candidateValues[cand.id] = {
          status: found ? found.status : 'NOT_EVIDENCED',
          note: found ? found.evidence : 'Not provided / Not evidenced',
        };
      } else if (cc.type === 'PROOF') {
        const hasResume = !!cand.resumeUrl;
        const hasProofStrength = cand.strengths.some(s => /case stud|roas|screenshot|portfolio|proof/i.test(s));
        candidateValues[cand.id] = {
          status: hasProofStrength && hasResume ? 'MET' : hasResume ? 'PARTIAL' : 'NOT_EVIDENCED',
          note: hasProofStrength ? 'Verified measurable outcomes & portfolio linked' : hasResume ? 'Resume attached; metrics pending interview proof' : 'Not provided / Not evidenced',
        };
      }
    });

    return {
      criteria: cc.criteria,
      type: cc.type,
      candidateValues,
    };
  });

  // 4. Generate HR Recommendation Support
  const topCandidate = evaluatedCandidates.length > 0 && evaluatedCandidates[0].scored !== false ? evaluatedCandidates[0] : null;
  let summaryReasoning = '';
  const supportingEvidence: string[] = [];
  let poolComparativeInsight = '';

  if (topCandidate && topCandidate.alignmentScore >= 50) {
    summaryReasoning = `${topCandidate.name} presents the strongest documented alignment with the ${designation} Job Description, evidencing ${topCandidate.experience} of relevant experience (threshold: ${jdSummary.minExperience}) and hands-on track record across core channels.`;
    
    topCandidate.strengths.slice(0, 4).forEach(s => supportingEvidence.push(s));
    
    if (evaluatedCandidates.length > 1) {
      const runnerUp = evaluatedCandidates[1];
      poolComparativeInsight = `When contrasted against the rest of the pool (${evaluatedCandidates.length} applicants evaluated), ${topCandidate.name} shows noticeably fewer critical gaps in core technical requirements. In contrast, runner-up ${runnerUp.name} (Score: ${runnerUp.alignmentScore}) ${runnerUp.missingOrNotEvidenced.length > 0 ? `lacks evidenced experience in ${runnerUp.missingOrNotEvidenced[0]}` : 'shows lower verifiable experience'}.`;
    } else {
      poolComparativeInsight = `Single applicant profile evaluated against the role requirements.`;
    }
  } else if (topCandidate) {
    summaryReasoning = `While ${topCandidate.name} ranks highest in the current applicant pool (Score: ${topCandidate.alignmentScore}), the overall evidence across all candidates remains limited. Multiple core technical requirements in the JD lack documented verification.`;
    topCandidate.strengths.forEach(s => supportingEvidence.push(s));
    poolComparativeInsight = `The current candidate pool exhibits significant un-evidenced competencies across core JD criteria. Sourcing additional candidates or conducting targeted technical screens is recommended.`;
  } else if (evaluatedCandidates.length > 0) {
    summaryReasoning = jdSummary.jdProvided
      ? `None of the ${evaluatedCandidates.length} applicants for ${designation} has been scored yet. Resumes are read in small batches: refresh to continue, or click Evaluate with AI.`
      : `No job description exists for ${designation}, so applicants cannot be scored. Add one (View / edit JD) and they will be scored from their resumes.`;
    poolComparativeInsight = '';
  } else {
    summaryReasoning = `No applications found for ${designation}.`;
    poolComparativeInsight = `Applications appear here as soon as they arrive.`;
  }

  const responseData: AIEvaluationResponse = {
    success: true,
    timestamp: new Date().toISOString(),
    designation,
    engineUsed: 'enterprise-algorithmic-ai',
    jdSummary,
    totalCandidates: evaluatedCandidates.length,
    duplicatesMerged,
    candidates: evaluatedCandidates,
    comparativeMatrix,
    hrRecommendation: {
      topCandidate: topCandidate ? {
        id: topCandidate.id,
        name: topCandidate.name,
        score: topCandidate.alignmentScore,
        alignmentTier: topCandidate.overallAlignment,
      } : null,
      summaryReasoning,
      supportingEvidence,
      poolComparativeInsight,
      advisoryDisclaimer: 'Notice: This evaluation provides objective decision support based strictly on documented evidence in candidate profiles against the job description. It does NOT make the final hiring decision, which remains the sole responsibility of the hiring manager and interview committee.',
    },
    aiScoring: aiRun.summary,
    fairnessNote: 'Fairness & Compliance: Evaluation conducted exclusively on verified job-related qualifications, skills, experience, and responsibilities. Protected characteristics (gender, age, race, address, contact info) are strictly excluded.',
  };

  evaluationCache.set(cacheKey, { data: responseData, timestamp: now });
  return responseData;
}

// ------------------------------------------------------------------ the whole list: every applicant against their own role

const ALL_ROLES_NAME = 'All Applications';

function isAllRolesName(designation: string): boolean {
  return designation.toLowerCase().trim() === ALL_ROLES_NAME.toLowerCase();
}

/**
 * "All Applications" is not a role, so there is no single JD to score against. Each role is evaluated on its own
 * (its own JD, its own repeat-application merge) and the applicants are listed together, best first, with their role.
 * One shared time budget covers all the resume reading, and AI scoring is left to the per-role view: here it only
 * shows results that were already cached.
 */
async function runAllRolesEvaluation(companyId: string, forceRefresh: boolean): Promise<AIEvaluationResponse> {
  const cacheKey = `${companyId}|${ALL_ROLES_NAME.toLowerCase()}`;
  const now = Date.now();
  if (!forceRefresh && evaluationCache.has(cacheKey)) {
    const cached = evaluationCache.get(cacheKey)!;
    if (now - cached.timestamp < CACHE_TTL_MS) return cached.data;
  }

  const roles = (await getSpreadsheetTabNames(companyId)).filter(
    t => t.toLowerCase() !== ALL_ROLES_NAME.toLowerCase() && t.toLowerCase() !== 'candidate log' && t.toLowerCase() !== "jd's"
  );

  const totalBudget = Number.parseInt(process.env.KEYWORD_PASS_BUDGET_MS || '', 10) || 7000;
  const deadline = Date.now() + totalBudget;
  const perRole: AIEvaluationResponse[] = [];
  for (const role of roles) {
    // Roles are done one after another so they share the resume-reading budget instead of each taking their own.
    perRole.push(await runCandidateEvaluation(companyId, role, forceRefresh, false, { keywordBudgetMs: Math.max(0, deadline - Date.now()) }));
  }

  const rolesMissingJd = perRole.filter(r => r.jdSummary.jdProvided === false && r.totalCandidates > 0).map(r => r.designation);
  const candidates = perRole
    .flatMap(r => r.candidates)
    .sort((a, b) => (b.scored === false ? 0 : 1) - (a.scored === false ? 0 : 1) || b.alignmentScore - a.alignmentScore)
    .map((c, idx) => ({ ...c, rank: idx + 1 }));

  const sum = (pick: (s: NonNullable<AIEvaluationResponse['aiScoring']>) => number | undefined) =>
    perRole.reduce((n, r) => n + (r.aiScoring ? pick(r.aiScoring) || 0 : 0), 0);
  const firstOf = <T,>(pick: (s: NonNullable<AIEvaluationResponse['aiScoring']>) => T | undefined) =>
    perRole.map(r => (r.aiScoring ? pick(r.aiScoring) : undefined)).find(Boolean);
  const failed = sum(s => s.keywordFailed);

  const response: AIEvaluationResponse = {
    success: true,
    timestamp: new Date().toISOString(),
    designation: ALL_ROLES_NAME,
    engineUsed: 'enterprise-algorithmic-ai',
    jdSummary: {
      designation: ALL_ROLES_NAME,
      department: 'Various',
      minExperience: 'Varies by role',
      maxExperience: 'Varies by role',
      requiredSkills: [],
      preferredSkills: [],
      coreResponsibilities: [],
      requiredTools: [],
      proofOfWorkRequirements: [],
      rawJDText: '',
      jdProvided: true,
      jdSource: 'NONE',
    },
    allRoles: { roles: roles.length, rolesMissingJd },
    duplicatesMerged: perRole.reduce((n, r) => n + (r.duplicatesMerged || 0), 0),
    totalCandidates: candidates.length,
    candidates,
    comparativeMatrix: [],
    hrRecommendation: {
      topCandidate: null,
      summaryReasoning: `Each applicant is scored against the job description of the role they applied for (${roles.length} roles). Pick a role to compare its applicants side by side.`,
      supportingEvidence: [],
      poolComparativeInsight: '',
      advisoryDisclaimer: 'Notice: This evaluation provides objective decision support based strictly on documented evidence in candidate profiles against the job description. It does NOT make the final hiring decision, which remains the sole responsibility of the hiring manager and interview committee.',
    },
    aiScoring: {
      enabled: perRole.some(r => r.aiScoring?.enabled),
      model: firstOf(s => s.model),
      totalCandidates: candidates.length,
      aiScored: sum(s => s.aiScored),
      fromCache: sum(s => s.fromCache),
      pending: sum(s => s.pending),
      failed: sum(s => s.failed),
      keywordScored: sum(s => s.keywordScored),
      keywordPending: sum(s => s.keywordPending),
      keywordFailed: failed,
      keywordFailureNote: failed ? firstOf(s => s.keywordFailureNote) : undefined,
    },
    fairnessNote: 'Fairness & Compliance: Evaluation conducted exclusively on verified job-related qualifications, skills, experience, and responsibilities. Protected characteristics (gender, age, race, address, contact info) are strictly excluded.',
  };
  evaluationCache.set(cacheKey, { data: response, timestamp: now });
  return response;
}
