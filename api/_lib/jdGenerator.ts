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

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const MODEL = process.env.OPENAI_JD_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 45000;

function experienceLine(r: JdRequest): string {
  const min = r.minExperienceYears ?? 0;
  const max = r.maxExperienceYears ?? 0;
  if (min && max && max >= min) return `${min}-${max} years`;
  if (min) return `${min}+ years`;
  return 'Entry level / as per profile';
}

/** Deterministic fallback used when no OpenAI key is configured or the call fails. */
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

const SYSTEM_PROMPT = [
  'You write clear, inclusive, professional job descriptions in plain markdown.',
  'Use exactly these sections in this order: a "# <Title>" heading, a short metadata block, "## About the role", "## Key responsibilities", "## Required skills", "## Preferred skills", "## What we offer".',
  'Use bullet points for the last four sections.',
  'Do not invent salary figures, benefits that are not implied, or company facts.',
  'Do not mention age, gender, or other protected attributes.',
  'Use only the facts provided by the user. Where a detail is missing, keep the wording generic.',
  'Return only the job description markdown, with no preamble or code fences.',
].join('\n');

function buildUserPrompt(r: JdRequest): string {
  return [
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
}

export async function generateJobDescription(r: JdRequest): Promise<JdResult> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_OPENAI_API_KEY') {
    return {
      text: buildTemplateJd(r),
      generatedBy: 'TEMPLATE',
      note: 'OPENAI_API_KEY is not configured, so a structured template was generated instead.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(r) },
        ],
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      /* non-JSON error body */
    }

    if (!res.ok) {
      const detail = data?.error?.message || raw.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`OpenAI API error (HTTP ${res.status}): ${detail}`);
    }

    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    if (!text) throw new Error('Empty response from model');
    return { text, generatedBy: 'AI' };
  } catch (err: any) {
    const message = err?.name === 'AbortError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err?.message || 'unknown error';
    console.warn('[JD Generator] OpenAI call failed, using template:', message);
    return {
      text: buildTemplateJd(r),
      generatedBy: 'TEMPLATE',
      note: `AI generation failed (${message}); a structured template was generated instead.`,
    };
  } finally {
    clearTimeout(timer);
  }
}