/**
 * Server-Side Recruitment Data Service
 *
 * Exposes candidate applications and open jobs through the "tab" interface the Overview page and AI
 * evaluation already use. Every function takes the company id and answers from that company's data only:
 *   - the HOME_COMPANY_ID company keeps reading the Amaavigo website APIs (job-applications / current-openings);
 *   - every other company reads its own stored applications and published requisitions (recruitmentData.ts).
 *
 * Env (all optional):
 *   JOB_APPLICATIONS_API_URL   default https://www.amaavigo.com/api/job-applications
 *   CURRENT_OPENINGS_API_URL   default https://www.amaavigo.com/api/current-openings
 *   RECRUITMENT_API_KEY        sent if the APIs ever require auth
 *   RECRUITMENT_API_AUTH_HEADER header name for the key (default Authorization: Bearer)
 */

import { listApplications, listOpenings, usesLegacySource, type ApplicationDoc } from './recruitmentData.js';

import type { SheetRowData, RecruitmentOverviewResult, ColumnMappingReport, RecruitmentKPIs } from '../../shared/recruitmentTypes.js';
export { isExcludedSheetTab } from '../../shared/recruitmentTypes.js';
export type { SheetRowData, RecruitmentOverviewResult, ColumnMappingReport, RecruitmentKPIs } from '../../shared/recruitmentTypes.js';

const APPLICATIONS_URL = () =>
  (process.env.JOB_APPLICATIONS_API_URL || 'https://www.amaavigo.com/api/job-applications').trim();
const OPENINGS_URL = () =>
  (process.env.CURRENT_OPENINGS_API_URL || 'https://www.amaavigo.com/api/current-openings').trim();

const CACHE_TTL_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;

const ALL_TAB = 'All Applications';
const JD_TAB = "JD's";
const CANDIDATE_LOG_TAB = 'Candidate Log';

export const APPLICATION_HEADERS = [
  'ID',
  'Name',
  'Email',
  'Mobile',
  'City',
  'Area',
  'Designation',
  'Experience',
  'Notice Period',
  'Job Preference',
  'Status',
  'Interview Date',
  'Message',
  'Interview Comment',
  'Attachment URL',
  'Applied On',
];

interface Application {
  id: string;
  row: (string | number | boolean)[];
  designation: string;
  status: string;
  appliedOn: string;
  raw: Record<string, any>;
}

interface Opening {
  id: string;
  designation: string;
  vacancies: number;
  joiningOn: string;
  qualification: string;
  department?: string;
}

let appsCache: { at: number; data: Application[] } | null = null;
let openingsCache: { at: number; data: Opening[] } | null = null;

// ---------------------------------------------------------------- helpers

export function getRecruitmentSourceStatus() {
  return {
    applicationsUrl: APPLICATIONS_URL(),
    openingsUrl: OPENINGS_URL(),
    hasApiKey: !!(process.env.RECRUITMENT_API_KEY || '').trim(),
  };
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function nested(v: any): string {
  if (v && typeof v === 'object') return str(v.title ?? v.name ?? v.label ?? '');
  return str(v);
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map(w => (w.length > 1 && w === w.toUpperCase() ? w : w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function unwrapList(json: any): any[] {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.data?.data)) return json.data.data;
  if (Array.isArray(json?.results)) return json.results;
  return [];
}

async function getJson(url: string): Promise<any> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = (process.env.RECRUITMENT_API_KEY || '').trim();
  if (key) {
    const name = (process.env.RECRUITMENT_API_AUTH_HEADER || 'Authorization').trim();
    headers[name] = name.toLowerCase() === 'authorization' ? `Bearer ${key}` : key;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}${text ? `: ${text.slice(0, 120)}` : ''}`);
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Non-JSON response from ${new URL(url).pathname}`);
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Timed out after ${REQUEST_TIMEOUT_MS / 1000}s calling ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- loaders

/** Maps one application (in the website API's shape) to the row layout the tabs use. */
function mapApplication(a: any, i: number): Application {
  {
    const designation = titleCase(nested(a.designation) || str(a.designation_name)) || 'Unspecified';
    const status = nested(a.interview_status) || 'New Applicant';
    const appliedOn = str(a.created_at);
    const id = str(a.id) || String(i + 1);
    return {
      id,
      designation,
      status,
      appliedOn,
      raw: a,
      row: [
        id,
        str(a.name),
        str(a.email),
        str(a.mobile),
        str(a.city),
        str(a.area),
        designation,
        str(a.experience),
        str(a.notice_period),
        nested(a.job_prefrence ?? a.job_preference),
        status,
        str(a.telephonic_interview_datetime),
        str(a.message),
        str(a.interview_comment),
        str(a.attachment_url),
        appliedOn,
      ],
    };
  }
}

/** A stored application, written in the same shape as the website API so one mapper serves both sources. */
function fromStored(d: ApplicationDoc): any {
  return {
    id: d.id,
    name: d.name,
    email: d.email,
    mobile: d.mobile,
    city: d.city,
    area: d.area,
    designation: d.designation,
    experience: d.experience,
    notice_period: d.noticePeriod,
    job_prefrence: d.jobPreference,
    interview_status: d.status,
    telephonic_interview_datetime: d.interviewDate,
    message: d.message,
    interview_comment: d.interviewComment,
    attachment_url: d.resumeUrl,
    created_at: d.createdAt,
  };
}

async function loadLegacyApplications(force: boolean): Promise<Application[]> {
  if (!force && appsCache && Date.now() - appsCache.at < CACHE_TTL_MS) return appsCache.data;

  const json = await getJson(APPLICATIONS_URL());
  if (json && json.success === false) {
    throw new Error(json.message || json.error || 'job-applications API reported failure');
  }
  const data: Application[] = unwrapList(json).map(mapApplication);
  appsCache = { at: Date.now(), data };
  return data;
}

async function loadApplications(companyId: string, force = false): Promise<Application[]> {
  if (usesLegacySource(companyId)) return loadLegacyApplications(force);
  return (await listApplications(companyId)).map((d, i) => mapApplication(fromStored(d), i));
}

/** Openings are optional enrichment: a failure here must never break the dashboard. */
async function loadOpenings(companyId: string, force = false): Promise<Opening[] | null> {
  if (!usesLegacySource(companyId)) {
    try {
      return (await listOpenings(companyId)).map((o) => ({
        id: o.id,
        designation: o.designation,
        vacancies: o.vacancies,
        joiningOn: o.joiningOn,
        qualification: o.qualification,
        department: o.department,
      }));
    } catch (err: any) {
      console.warn('[Recruitment] Could not read open jobs:', err?.message || err);
      return null;
    }
  }
  if (!force && openingsCache && Date.now() - openingsCache.at < CACHE_TTL_MS) return openingsCache.data;
  try {
    const json = await getJson(OPENINGS_URL());
    const list = unwrapList(json);
    const data: Opening[] = list.map((o: any) => ({
      id: str(o.id),
      designation: nested(o.designation),
      vacancies: Number(o.no_of_opening) > 0 ? Number(o.no_of_opening) : 1,
      joiningOn: str(o.joining_on),
      qualification: str(o.qualification),
    }));
    openingsCache = { at: Date.now(), data };
    return data;
  } catch (err: any) {
    console.warn('[Recruitment] Could not read current openings:', err?.message || err);
    return null;
  }
}

// ---------------------------------------------------------------- public API (same names as before)

export function getConfiguredSpreadsheetId(): string {
  return '';
}

export function maskSpreadsheetId(_id: string): string {
  return 'Amaavigo careers API';
}

/** Kept under its old name so existing routes/UI keep working. */
export function getGoogleSheetsConfigStatus(companyId?: string | null) {
  if (companyId && !usesLegacySource(companyId)) {
    return {
      isConfigured: true,
      source: 'built-in',
      spreadsheetIdMasked: 'Built-in applications',
      hasApiKey: false,
      preferredAuth: 'BUILT_IN',
      expectedTabs: [ALL_TAB],
    };
  }
  const s = getRecruitmentSourceStatus();
  return {
    isConfigured: true,
    source: 'amaavigo-website-api',
    spreadsheetIdMasked: maskSpreadsheetId(''),
    hasApiKey: s.hasApiKey,
    preferredAuth: s.hasApiKey ? 'API_KEY' : 'PUBLIC',
    expectedTabs: [ALL_TAB],
  };
}

function sheet(tabName: string, rows: (string | number | boolean)[][], headers: string[]): SheetRowData {
  return {
    headers,
    rows,
    totalRows: rows.length,
    totalColumns: headers.length,
    tabName,
    lastRefreshed: new Date().toISOString(),
  };
}

/**
 * Virtual "tabs":
 *   All Applications / Candidate Log -> every application
 *   <Designation>                    -> applications for that designation
 *   JD's                             -> [designation, JD text] per live opening
 *   Request Data                     -> empty (no longer a data source)
 */
export async function fetchSheetData(companyId: string, tabName: string): Promise<SheetRowData> {
  const wanted = tabName.trim().toLowerCase();

  if (wanted === JD_TAB.toLowerCase()) {
    const openings = (await loadOpenings(companyId)) || [];
    return sheet(
      JD_TAB,
      openings.map(o => [o.designation, o.qualification]),
      ['Designation', 'Job Description']
    );
  }

  if (wanted === 'request data') {
    return sheet('Request Data', [], []);
  }

  const apps = await loadApplications(companyId);

  if (wanted === ALL_TAB.toLowerCase() || wanted === CANDIDATE_LOG_TAB.toLowerCase()) {
    return sheet(tabName, apps.map(a => a.row), APPLICATION_HEADERS);
  }

  const matched = apps.filter(a => a.designation.toLowerCase() === wanted);
  if (matched.length === 0 && !apps.some(a => a.designation.toLowerCase() === wanted)) {
    throw new Error(`NOT_FOUND: no applications found for '${tabName}'`);
  }
  return sheet(tabName, matched.map(a => a.row), APPLICATION_HEADERS);
}

/** Server-side lookup of one application by id (used by the onboarding flow; never sent to the browser as-is). */
export async function getApplicationRecord(companyId: string, id: string): Promise<{
  id: string;
  name: string;
  email: string;
  mobile: string;
  designation: string;
  status: string;
  raw: Record<string, any>;
} | null> {
  const apps = await loadApplications(companyId, true);
  const a = apps.find(x => x.id === String(id));
  if (!a) return null;
  return {
    id: a.id,
    name: str(a.raw.name),
    email: str(a.raw.email),
    mobile: str(a.raw.mobile),
    designation: a.designation,
    status: a.status,
    raw: a.raw,
  };
}

export async function getSpreadsheetTabNames(companyId: string): Promise<string[]> {
  const apps = await loadApplications(companyId);
  const designations = Array.from(new Set(apps.map(a => a.designation))).sort();
  return [ALL_TAB, ...designations, CANDIDATE_LOG_TAB, JD_TAB];
}

export async function computeRecruitmentOverview(companyId: string): Promise<RecruitmentOverviewResult> {
  const legacy = usesLegacySource(companyId);
  const masked = legacy ? maskSpreadsheetId('') : 'Built-in applications';
  try {
    const [apps, openings] = await Promise.all([loadApplications(companyId, true), loadOpenings(companyId, true)]);

    const byDesignation = new Map<string, number>();
    const byStage = new Map<string, number>();
    for (const a of apps) {
      byDesignation.set(a.designation, (byDesignation.get(a.designation) || 0) + 1);
      byStage.set(a.status, (byStage.get(a.status) || 0) + 1);
    }

    const applicationsByDesignation = Array.from(byDesignation, ([designation, count]) => ({ designation, count })).sort(
      (a, b) => b.count - a.count
    );
    const applicationsByStage = Array.from(byStage, ([stage, count]) => ({ stage, count })).sort(
      (a, b) => b.count - a.count
    );

    const openPositions = openings ? openings.length : null;
    const totalVacancies = openings ? openings.reduce((n, o) => n + o.vacancies, 0) : null;

    const availableTabs = [ALL_TAB, ...applicationsByDesignation.map(d => d.designation).sort()];

    // Built-in jobs know their department; the website API does not.
    const byDept = new Map<string, { openPositions: number; vacancies: number }>();
    for (const o of openings || []) {
      if (!o.department) continue;
      const e = byDept.get(o.department) || { openPositions: 0, vacancies: 0 };
      e.openPositions += 1;
      e.vacancies += o.vacancies;
      byDept.set(o.department, e);
    }
    const positionsByDepartment = Array.from(byDept, ([department, v]) => ({ department, ...v }));

    return {
      success: true,
      status: 'OK',
      spreadsheetIdMasked: masked,
      lastRefreshed: new Date().toISOString(),
      kpis: {
        openPositions,
        totalVacancies,
        totalApplications: apps.length,
        activeRequisitionsCount: openPositions,
        // The website APIs carry no department, so this KPI is only available for built-in jobs.
        departmentsCount: legacy ? null : byDept.size,
      },
      designations: applicationsByDesignation.map(d => d.designation),
      applicationsByDesignation,
      positionsByDepartment,
      applicationsByStage,
      availableTabs,
      columnMapping: {
        requestData: {
          sheetFound: !!openings,
          tabNameUsed: legacy ? 'current-openings API' : 'Open jobs',
          positionColumn: 'designation',
          requestIdColumn: 'id',
          statusColumn: null,
          vacancyColumn: 'no_of_opening',
          departmentColumn: null,
          totalRows: openings ? openings.length : 0,
          rawHeaders: ['id', 'designation', 'minimum_exp', 'maximum_exp', 'no_of_opening', 'joining_on', 'qualification'],
        },
        candidateLog: {
          sheetFound: true,
          tabNameUsed: legacy ? 'job-applications API' : 'Applications',
          candidateColumn: 'id',
          designationColumn: 'designation.title',
          stageColumn: 'interview_status.name',
          dateColumn: 'created_at',
          totalRows: apps.length,
          rawHeaders: APPLICATION_HEADERS,
        },
      },
    };
  } catch (err: any) {
    console.error('Error computing recruitment overview:', err);
    return {
      success: false,
      status: 'ERROR',
      spreadsheetIdMasked: masked,
      error: err?.message || 'Could not read applications from the job-applications API',
    };
  }
}
