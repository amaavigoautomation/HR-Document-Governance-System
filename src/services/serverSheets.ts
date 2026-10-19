/**
 * Server-Side Recruitment Data Service
 *
 * Reads candidate applications and live openings from the Amaavigo website APIs
 * (job-applications / current-openings) and exposes them through the same
 * "tab" interface the Overview page and AI evaluation already use, so the
 * rest of the app is unchanged. Nothing is read from Google Sheets any more.
 *
 * Env (all optional):
 *   JOB_APPLICATIONS_API_URL   default https://www.amaavigo.com/api/job-applications
 *   CURRENT_OPENINGS_API_URL   default https://www.amaavigo.com/api/current-openings
 *   RECRUITMENT_API_KEY        sent if the APIs ever require auth
 *   RECRUITMENT_API_AUTH_HEADER header name for the key (default Authorization: Bearer)
 */

export interface SheetRowData {
  headers: string[];
  rows: (string | number | boolean)[][];
  totalRows: number;
  totalColumns: number;
  tabName: string;
  lastRefreshed: string;
}

export interface RecruitmentKPIs {
  openPositions: number | null;
  totalVacancies: number | null;
  totalApplications: number | null;
  activeRequisitionsCount: number | null;
  departmentsCount: number | null;
}

/**
 * Filter out administrative/raw sheets from the Explore Sheet Data tab filter:
 * - request data
 * - budget band
 * - HR data
 * - JD's
 * - Workflow tracker
 * - candidate log
 */
export function isExcludedSheetTab(tabName: string): boolean {
  if (!tabName) return false;
  const clean = tabName.toLowerCase().trim().replace(/['’"`\s_-]/g, '');
  const excluded = [
    'requestdata',
    'budgetband',
    'hrdata',
    'jds',
    'jd',
    'workflowtracker',
    'candidatelog',
  ];
  if (excluded.includes(clean)) return true;

  // Handle common prefixes/variants like "workflowtracker...", "budgetband..."
  const prefixes = [
    'requestdata',
    'budgetband',
    'hrdata',
    'workflowtracker',
    'candidatelog',
  ];
  return prefixes.some(p => clean.startsWith(p));
}

export interface ColumnMappingReport {
  requestData: {
    sheetFound: boolean;
    tabNameUsed: string;
    positionColumn: string | null;
    requestIdColumn?: string | null;
    statusColumn: string | null;
    vacancyColumn: string | null;
    departmentColumn: string | null;
    totalRows: number;
    rawHeaders: string[];
  };
  candidateLog: {
    sheetFound: boolean;
    tabNameUsed: string;
    candidateColumn: string | null;
    designationColumn: string | null;
    stageColumn: string | null;
    dateColumn: string | null;
    totalRows: number;
    rawHeaders: string[];
  };
}

export interface RecruitmentOverviewResult {
  success: boolean;
  status: 'OK' | 'NOT_CONFIGURED' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'SHEET_MISSING' | 'ERROR';
  spreadsheetIdMasked?: string;
  lastRefreshed?: string;
  kpis?: RecruitmentKPIs;
  designations?: string[];
  applicationsByDesignation?: { designation: string; count: number }[];
  positionsByDepartment?: { department: string; openPositions: number; vacancies: number }[];
  applicationsByStage?: { stage: string; count: number }[];
  availableTabs?: string[];
  columnMapping?: ColumnMappingReport;
  error?: string;
  message?: string;
  requiredConfiguration?: {
    envKey: string;
    expectedTabs: string[];
    documentation: string;
  };
}

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
}

interface Opening {
  id: string;
  designation: string;
  vacancies: number;
  joiningOn: string;
  qualification: string;
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

async function loadApplications(force = false): Promise<Application[]> {
  if (!force && appsCache && Date.now() - appsCache.at < CACHE_TTL_MS) return appsCache.data;

  const json = await getJson(APPLICATIONS_URL());
  if (json && json.success === false) {
    throw new Error(json.message || json.error || 'job-applications API reported failure');
  }
  const list = unwrapList(json);

  const data: Application[] = list.map((a: any, i: number) => {
    const designation = titleCase(nested(a.designation) || str(a.designation_name)) || 'Unspecified';
    const status = nested(a.interview_status) || 'New Applicant';
    const appliedOn = str(a.created_at);
    const id = str(a.id) || String(i + 1);
    return {
      id,
      designation,
      status,
      appliedOn,
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
  });

  appsCache = { at: Date.now(), data };
  return data;
}

/** Openings are optional enrichment: a failure here must never break the dashboard. */
async function loadOpenings(force = false): Promise<Opening[] | null> {
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
export function getGoogleSheetsConfigStatus() {
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
export async function fetchSheetData(tabName: string): Promise<SheetRowData> {
  const wanted = tabName.trim().toLowerCase();

  if (wanted === JD_TAB.toLowerCase()) {
    const openings = (await loadOpenings()) || [];
    return sheet(
      JD_TAB,
      openings.map(o => [o.designation, o.qualification]),
      ['Designation', 'Job Description']
    );
  }

  if (wanted === 'request data') {
    return sheet('Request Data', [], []);
  }

  const apps = await loadApplications();

  if (wanted === ALL_TAB.toLowerCase() || wanted === CANDIDATE_LOG_TAB.toLowerCase()) {
    return sheet(tabName, apps.map(a => a.row), APPLICATION_HEADERS);
  }

  const matched = apps.filter(a => a.designation.toLowerCase() === wanted);
  if (matched.length === 0 && !apps.some(a => a.designation.toLowerCase() === wanted)) {
    throw new Error(`NOT_FOUND: no applications found for '${tabName}'`);
  }
  return sheet(tabName, matched.map(a => a.row), APPLICATION_HEADERS);
}

export async function getSpreadsheetTabNames(): Promise<string[]> {
  const apps = await loadApplications();
  const designations = Array.from(new Set(apps.map(a => a.designation))).sort();
  return [ALL_TAB, ...designations, CANDIDATE_LOG_TAB, JD_TAB];
}

export async function computeRecruitmentOverview(): Promise<RecruitmentOverviewResult> {
  const masked = maskSpreadsheetId('');
  try {
    const [apps, openings] = await Promise.all([loadApplications(true), loadOpenings(true)]);

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
        // The website APIs carry no department, so this KPI cannot be computed from them.
        departmentsCount: null,
      },
      designations: applicationsByDesignation.map(d => d.designation),
      applicationsByDesignation,
      positionsByDepartment: [],
      applicationsByStage,
      availableTabs,
      columnMapping: {
        requestData: {
          sheetFound: !!openings,
          tabNameUsed: 'current-openings API',
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
          tabNameUsed: 'job-applications API',
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