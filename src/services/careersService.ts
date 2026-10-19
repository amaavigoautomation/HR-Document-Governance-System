/**
 * Client-side helper for publishing an opening to the live careers page.
 * Calls our own backend (/api/careers/publish); the careers API key never reaches the browser.
 */

export interface CareersPublishInput {
  positionTitle: string;
  minExperience: number | string;
  maxExperience: number | string;
  vacancies: number | string;
  /** yyyy-mm-dd (as saved by <input type="date">) */
  expectedJoining: string;
  /** Full job description text */
  jdText: string;
}

export interface CareersPublishResponse {
  success: boolean;
  postingId?: string;
  error?: string;
  errors?: string[];
}

/**
 * Maps a requisition document to the publish input.
 * ADJUST the property names below if your requisition fields are named differently.
 */
export function requisitionToCareersInput(req: any): CareersPublishInput {
  return {
    positionTitle: req.positionTitle,
    minExperience: req.minExperience ?? req.minExp ?? req.experienceMin,
    maxExperience: req.maxExperience ?? req.maxExp ?? req.experienceMax,
    vacancies: req.vacancies ?? req.numberOfVacancies ?? req.openings,
    expectedJoining: req.expectedJoiningDate ?? req.expectedJoining ?? req.joiningDate,
    jdText: req.jd?.text ?? '',
  };
}

export async function publishToCareers(
  input: CareersPublishInput,
  userRole: string
): Promise<CareersPublishResponse> {
  try {
    const res = await fetch('/api/careers/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-role': userRole },
      body: JSON.stringify(input),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { success: false, error: `Unexpected server response (HTTP ${res.status}).` };
    }

    const data = (await res.json()) as CareersPublishResponse;
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || `Publish failed (HTTP ${res.status}).`, errors: data.errors };
    }
    return { success: true, postingId: data.postingId };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Network error while publishing.' };
  }
}