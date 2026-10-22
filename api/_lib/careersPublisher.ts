import { authErrorResponse, requirePermission } from './authContext.js';
import { usesLegacySource } from './recruitmentData.js';
/**
 * Careers page publisher.
 *
 * Ports the n8n "HTTP Request" node that posts an opening to the live website:
 *   POST https://www.amaavigo.com/api/current-openings
 *   Headers: Accept: application/json, content-type: application/json
 *   Body: { designation, minimum_exp, maximum_exp, no_of_opening, joining_on, qualification }
 *
 * `qualification` carries the full Job Description text.
 *
 * Shared by server.ts (Express) and api/careers/publish.ts (Vercel) so the logic lives in one place.
 */

export interface CareersPublishInput {
  positionTitle: string;
  minExperience: number | string;
  maxExperience: number | string;
  vacancies: number | string;
  /** ISO date (yyyy-mm-dd) or an already-formatted date string */
  expectedJoining: string;
  /** Full job description text; sent as `qualification` */
  jdText: string;
}

/** Exactly what the careers API receives. n8n sent every value as a string, so we do too. */
export interface CareersApiPayload {
  designation: string;
  minimum_exp: string;
  maximum_exp: string;
  no_of_opening: string;
  joining_on: string;
  qualification: string;
}

export interface CareersPublishResult {
  success: boolean;
  postingId?: string;
  httpStatus?: number;
  error?: string;
  /** Raw (parsed) response from the careers API, for debugging/audit */
  response?: unknown;
}

const DEFAULT_API_URL = 'https://www.amaavigo.com/api/current-openings';
const MAX_TITLE = 200;
const MAX_JD = 20000;
const REQUEST_TIMEOUT_MS = 20000;
const ALLOWED_ROLES = ['CREATOR', 'REVIEWER'];

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

/**
 * The careers API date format is not confirmed. Default is DD-MM-YYYY (how the form displays it).
 * Set CAREERS_JOINING_DATE_FORMAT=YYYY-MM-DD to send ISO dates instead.
 */
function formatJoiningDate(raw: string): string {
  const format = (process.env.CAREERS_JOINING_DATE_FORMAT || 'DD-MM-YYYY').toUpperCase();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return raw; // already in some other format; pass through untouched
  const [, y, m, d] = iso;
  return format === 'YYYY-MM-DD' ? `${y}-${m}-${d}` : `${d}-${m}-${y}`;
}

export function buildCareersPayload(
  input: Partial<CareersPublishInput> | null | undefined
): { payload?: CareersApiPayload; errors?: string[] } {
  const errors: string[] = [];
  const src = input || {};

  const title = asString(src.positionTitle);
  const minExp = asString(src.minExperience);
  const maxExp = asString(src.maxExperience);
  const vacancies = asString(src.vacancies);
  const joining = asString(src.expectedJoining);
  const jd = asString(src.jdText);

  if (!title) errors.push('Position title is required.');
  else if (title.length > MAX_TITLE) errors.push(`Position title must be at most ${MAX_TITLE} characters.`);

  const minNum = Number(minExp);
  const maxNum = Number(maxExp);
  if (minExp === '' || !Number.isFinite(minNum) || minNum < 0) errors.push('Minimum experience must be a number >= 0.');
  if (maxExp === '' || !Number.isFinite(maxNum) || maxNum < 0) errors.push('Maximum experience must be a number >= 0.');
  if (Number.isFinite(minNum) && Number.isFinite(maxNum) && minNum > maxNum) {
    errors.push('Minimum experience cannot be greater than maximum experience.');
  }

  const vacNum = Number(vacancies);
  if (vacancies === '' || !Number.isInteger(vacNum) || vacNum < 1) errors.push('Number of vacancies must be a whole number >= 1.');

  if (!joining) errors.push('Expected joining date is required.');

  if (!jd) errors.push('Job description is required (it is published as the qualification text).');
  else if (jd.length > MAX_JD) errors.push(`Job description must be at most ${MAX_JD} characters.`);

  if (errors.length) return { errors };

  return {
    payload: {
      designation: title,
      minimum_exp: minExp,
      maximum_exp: maxExp,
      no_of_opening: vacancies,
      joining_on: formatJoiningDate(joining),
      qualification: jd,
    },
  };
}

function pickPostingId(json: any): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const candidates = [
    json.id,
    json._id,
    json.opening_id,
    json.openingId,
    json.data?.id,
    json.data?._id,
    json.result?.id,
  ];
  const found = candidates.find((v) => v !== undefined && v !== null && String(v).trim() !== '');
  return found === undefined ? undefined : String(found);
}

export async function publishToCareersPage(payload: CareersApiPayload): Promise<CareersPublishResult> {
  const url = (process.env.CAREERS_API_URL || DEFAULT_API_URL).trim();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  // Optional auth. Not part of the original n8n headers; set these if the careers API requires a key.
  const apiKey = (process.env.CAREERS_API_KEY || '').trim();
  if (apiKey) {
    const headerName = (process.env.CAREERS_API_AUTH_HEADER || 'Authorization').trim();
    headers[headerName] = headerName.toLowerCase() === 'authorization' ? `Bearer ${apiKey}` : apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON response; keep raw text */
    }

    if (!res.ok) {
      const detail =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as any).error || (parsed as any).message
          : String(parsed).slice(0, 200);
      return {
        success: false,
        httpStatus: res.status,
        error: `Careers API responded with HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
        response: parsed,
      };
    }

    return { success: true, httpStatus: res.status, postingId: pickPostingId(parsed), response: parsed };
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError';
    return {
      success: false,
      error: timedOut
        ? `Careers API did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`
        : `Could not reach the careers API: ${err?.message || 'unknown error'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Framework-agnostic request handler used by both Express and Vercel.
 * NOTE: the role check relies on the x-user-role header like the other /api routes. It is NOT real
 * authentication; replace it with verified ID-token roles once Firebase Auth is added.
 */
export async function handleCareersPublish(
  body: unknown,
  userRole: string | undefined
): Promise<{ status: number; json: CareersPublishResult | { success: false; error: string; errors?: string[] } }> {
  if (!userRole || !ALLOWED_ROLES.includes(userRole)) {
    return { status: 403, json: { success: false, error: 'Access denied: only HR or Approver roles can publish openings.' } };
  }

  const { payload, errors } = buildCareersPayload(body as Partial<CareersPublishInput>);
  if (!payload) {
    return { status: 400, json: { success: false, error: errors!.join(' '), errors } };
  }

  const result = await publishToCareersPage(payload);
  return { status: result.success ? 200 : 502, json: result };
}

/**
 * Publish for the signed-in user's company. Only the company that still runs on the Amaavigo website posts to its
 * external careers API; every other company's job is simply open inside the portal, and its own website reads it from
 * the public jobs feed (GET /api/apply/<webhook id>).
 */
export async function publishForCompany(
  headers: Record<string, any>,
  body: unknown
): Promise<{ status: number; json: any }> {
  try {
    const ctx = await requirePermission(headers, 'req.manage_jd');
    if (!usesLegacySource(ctx.companyId)) {
      return { status: 200, json: { success: true, internal: true } };
    }
    return await handleCareersPublish(body, 'CREATOR');
  } catch (err) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    throw err;
  }
}
