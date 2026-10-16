import { GoogleGenAI } from '@google/genai';

export interface JdRequest {
  positionTitle: string;
  departmentName: string;
  employmentType?: string;
  location?: string;
  minExperienceYears?: number;
  maxExperienceYears?: number;
  vacancies?: number;
  keySkills?: string;
  justification?: string;
  companyName?: string;
}

export interface JdResult {
  text: string;
  generatedBy: 'AI' | 'TEMPLATE';
  note?: string;
}

const MODEL = process.env.GEMINI_JD_MODEL || 'gemini-2.5-flash';

function experienceLine(r: JdRequest): string {
  const min = r.minExperienceYears ?? 0;
  const max = r.maxExperienceYears ?? 0;
  if (min && max && max >= min) return `${min}-${max} years`;
  if (min) return `${min}+ years`;
  return 'Entry level / as per profile';
}

/** Deterministic fallback used when no Gemini key is configured or the call fails. */
export function buildTemplateJd(r: JdRequest): string {
  const company = r.companyName || 'Amaavigo';
  const skills = (r.keySkills || '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const skillLines = skills.length ? skills.map((s) => `- ${s}`).join('\n') : '- (add required skills)';

  return [
    `# ${r.positionTitle}`,
    '',
    `**Company:** ${company}`,
    `**Department:** ${r.departmentName}`,
    `**Employment type:** ${r.employmentType || 'Full-time'}`,
    `**Location:** ${r.location || 'To be confirmed'}`,
    `**Experience:** ${experienceLine(r)}`,
    r.vacancies ? `**Openings:** ${r.vacancies}` : '',
    '',
    '## About the role',
    `${company} is hiring a ${r.positionTitle} for the ${r.departmentName} team. ${r.justification ? r.justification.trim() : 'You will work closely with the team to deliver high-quality outcomes.'}`,
    '',
    '## Key responsibilities',
    '- (add responsibilities)',
    '',
    '## Required skills',
    skillLines,
    '',
    '## Preferred skills',
    '- (add preferred skills)',
    '',
    '## What we offer',
    '- (add benefits)',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}

export async function generateJobDescription(r: JdRequest): Promise<JdResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return {
      text: buildTemplateJd(r),
      generatedBy: 'TEMPLATE',
      note: 'GEMINI_API_KEY is not configured, so a structured template was generated instead.',
    };
  }

  const prompt = [
    'Write a clear, inclusive, professional job description in plain markdown.',
    'Use exactly these sections in this order: a "# <Title>" heading, a short metadata block, "## About the role", "## Key responsibilities", "## Required skills", "## Preferred skills", "## What we offer".',
    'Use bullet points for the last four sections. Do not invent salary figures, benefits that are not implied, or company facts. Do not mention age, gender, or other protected attributes.',
    'Use only the facts below. Where a detail is missing, keep the wording generic.',
    '',
    `Company: ${r.companyName || 'Amaavigo'}`,
    `Position: ${r.positionTitle}`,
    `Department: ${r.departmentName}`,
    `Employment type: ${r.employmentType || 'Full-time'}`,
    `Location: ${r.location || 'Not specified'}`,
    `Experience: ${experienceLine(r)}`,
    `Openings: ${r.vacancies ?? 1}`,
    `Key skills requested by the hiring manager: ${r.keySkills || 'Not specified'}`,
    `Business justification: ${r.justification || 'Not specified'}`,
  ].join('\n');

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({ model: MODEL, contents: prompt });
    const text = (response.text || '').trim();
    if (!text) throw new Error('Empty response from model');
    return { text, generatedBy: 'AI' };
  } catch (err: any) {
    console.warn('[JD Generator] Gemini call failed, using template:', err?.message || err);
    return {
      text: buildTemplateJd(r),
      generatedBy: 'TEMPLATE',
      note: `AI generation failed (${err?.message || 'unknown error'}); a structured template was generated instead.`,
    };
  }
}
