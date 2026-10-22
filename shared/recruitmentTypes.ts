/** Shapes and helpers the Overview screen shares with the server. Pure TypeScript. */

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
