/**
 * Server-Side Google Sheets Integration Service
 * 
 * Securely accesses the designated Google Sheet without exposing credentials,
 * private API keys, or service-account tokens to the frontend client.
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

// Fixed or Environment-Configured Spreadsheet ID
export function getConfiguredSpreadsheetId(): string {
  const rawId = (
    process.env.GOOGLE_SHEET_ID ||
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID ||
    process.env.RECRUITMENT_SPREADSHEET_ID ||
    ''
  ).trim();

  // If user pasted a full Google Sheet URL e.g. https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
  const urlMatch = rawId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  // Filter out dummy slash or placeholder
  if (rawId === '/' || rawId.length < 15) {
    return '';
  }

  return rawId;
}

export function maskSpreadsheetId(id: string): string {
  if (!id) return 'Not Configured';
  if (id.length <= 8) return '****';
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}

export function getGoogleSheetsConfigStatus() {
  const sheetId = getConfiguredSpreadsheetId();
  const apiKey = (process.env.GOOGLE_SHEETS_API_KEY || '').trim();

  return {
    isConfigured: !!sheetId,
    spreadsheetIdMasked: maskSpreadsheetId(sheetId),
    hasApiKey: !!apiKey,
    preferredAuth: apiKey ? 'API_KEY' : 'GOOGLE_VIZ_AUTHENTICATED',
    expectedTabs: ['Request Data', 'Candidate Log'],
  };
}

/**
 * Parses Google Visualization JSON response (gviz/tq)
 */
function parseGvizResponse(rawText: string, tabName: string): SheetRowData {
  // gviz returns: /*O_o*/\ngoogle.visualization.Query.setResponse({...});
  const jsonStart = rawText.indexOf('{');
  const jsonEnd = rawText.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`Invalid Google Sheets response format for tab '${tabName}'`);
  }

  const jsonStr = rawText.substring(jsonStart, jsonEnd + 1);
  const data = JSON.parse(jsonStr);

  if (data.status === 'error') {
    const errorMsg = data.errors?.map((e: any) => e.message || e.detailed_message).join(', ') || 'Unknown Sheets error';
    throw new Error(`Google Sheets error: ${errorMsg}`);
  }

  const table = data.table;
  if (!table) {
    return {
      headers: [],
      rows: [],
      totalRows: 0,
      totalColumns: 0,
      tabName,
      lastRefreshed: new Date().toISOString(),
    };
  }

  // Determine headers
  let headers: string[] = [];
  const rawRows: any[] = table.rows || [];

  // Check if table.cols has meaningful labels
  const colLabels = (table.cols || []).map((c: any) => (c && c.label ? String(c.label).trim() : ''));
  const hasLabels = colLabels.some((l: string) => l.length > 0);

  let dataRows: any[] = rawRows;

  if (hasLabels) {
    headers = colLabels;
  } else if (rawRows.length > 0) {
    // First row might be header
    const firstRowValues = (rawRows[0].c || []).map((cell: any) =>
      cell && (cell.v !== null && cell.v !== undefined) ? String(cell.v).trim() : ''
    );
    headers = firstRowValues;
    dataRows = rawRows.slice(1);
  }

  // Ensure unique, non-empty header names
  headers = headers.map((h, idx) => h || `Column_${idx + 1}`);

  // Extract cell values
  const parsedRows: (string | number | boolean)[][] = [];

  for (const row of dataRows) {
    if (!row || !row.c) continue;
    const cells = row.c;
    const rowValues = headers.map((_, colIdx) => {
      const cell = cells[colIdx];
      if (!cell || cell.v === null || cell.v === undefined) {
        return '';
      }
      // If formatted value exists (e.g. currency, formatted date), prioritize or use value
      if (typeof cell.v === 'number' || typeof cell.v === 'boolean') {
        return cell.v;
      }
      return String(cell.f || cell.v).trim();
    });

    // Only include rows that have at least one non-empty value
    const hasValue = rowValues.some(val => val !== '' && val !== null && val !== undefined);
    if (hasValue) {
      parsedRows.push(rowValues);
    }
  }

  return {
    headers,
    rows: parsedRows,
    totalRows: parsedRows.length,
    totalColumns: headers.length,
    tabName,
    lastRefreshed: new Date().toISOString(),
  };
}

/**
 * Fetch raw sheet data by tab name
 */
export async function fetchSheetData(tabName: string): Promise<SheetRowData> {
  const spreadsheetId = getConfiguredSpreadsheetId();
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_NOT_CONFIGURED');
  }

  const apiKey = (process.env.GOOGLE_SHEETS_API_KEY || '').trim();

  // 1. If API key available, try official Google Sheets API v4
  if (apiKey) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
        tabName
      )}?key=${apiKey}`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const json = await response.json();
        const values: any[][] = json.values || [];
        if (values.length === 0) {
          return {
            headers: [],
            rows: [],
            totalRows: 0,
            totalColumns: 0,
            tabName,
            lastRefreshed: new Date().toISOString(),
          };
        }
        const headers = values[0].map((h: any, i: number) => (h ? String(h).trim() : `Column_${i + 1}`));
        const rows = values.slice(1).map(r =>
          headers.map((_, i) => (r[i] !== undefined && r[i] !== null ? r[i] : ''))
        );
        return {
          headers,
          rows,
          totalRows: rows.length,
          totalColumns: headers.length,
          tabName,
          lastRefreshed: new Date().toISOString(),
        };
      }
    } catch (e) {
      console.warn(`Sheets API v4 failed for tab ${tabName}, falling back to Visualization API`, e);
    }
  }

  // 2. Fetch via Google Visualization Query Endpoint
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(
    tabName
  )}`;

  const res = await fetch(gvizUrl, {
    headers: {
      'User-Agent': 'Amaavigo-HRAgent/1.0',
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`NOT_FOUND: Google Sheet not found with ID '${spreadsheetId}'. Check your spreadsheet ID.`);
    }
    if (res.status === 403 || res.status === 401) {
      throw new Error(`PERMISSION_DENIED: Access denied to Google Sheet. Ensure the spreadsheet is shared with viewer access or configured properly.`);
    }
    throw new Error(`FETCH_FAILED: Server returned HTTP ${res.status}`);
  }

  const rawText = await res.text();
  return parseGvizResponse(rawText, tabName);
}

/**
 * Fetch list of worksheet tab names
 */
export async function getSpreadsheetTabNames(): Promise<string[]> {
  const spreadsheetId = getConfiguredSpreadsheetId();
  if (!spreadsheetId) return [];

  const apiKey = (process.env.GOOGLE_SHEETS_API_KEY || '').trim();

  // If API key is available, query spreadsheet metadata
  if (apiKey) {
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?key=${apiKey}`;
      const response = await fetch(url);
      if (response.ok) {
        const json = await response.json();
        if (json.sheets && Array.isArray(json.sheets)) {
          return json.sheets.map((s: any) => s.properties?.title).filter(Boolean);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch spreadsheet tabs via API v4:', err);
    }
  }

  // Default known tabs specified in the requirement
  const candidateTabs = [
    'Candidates',
    'Lead Generation',
    'Interviews',
    'Applications',
    'Shortlisted',
    'Employee Tracker',
    'Request Data',
    'Candidate Log',
  ];
  const verifiedTabs: string[] = [];

  for (const tab of candidateTabs) {
    try {
      const data = await fetchSheetData(tab);
      if (data.headers.length > 0 || data.rows.length > 0) {
        verifiedTabs.push(tab);
      }
    } catch {
      // Tab doesn't exist
    }
  }

  // Fallback to designated base tabs if probe is inconclusive
  return verifiedTabs.length > 0 ? verifiedTabs : ['Request Data', 'Candidate Log'];
}

/**
 * Fuzzy column finder
 */
function findColumnIndex(headers: string[], candidates: string[]): { index: number; name: string | null } {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim().replace(/[^a-z0-9]/g, ''));

  // 1. Exact match
  for (const candidate of candidates) {
    const normCand = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const idx = normalizedHeaders.indexOf(normCand);
    if (idx !== -1) {
      return { index: idx, name: headers[idx] };
    }
  }

  // 2. Partial / substring match
  for (const candidate of candidates) {
    const normCand = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const idx = normalizedHeaders.findIndex(h => h.includes(normCand) || normCand.includes(h));
    if (idx !== -1) {
      return { index: idx, name: headers[idx] };
    }
  }

  return { index: -1, name: null };
}

/**
 * Core business calculations for the Overview Dashboard
 */
export async function computeRecruitmentOverview(): Promise<RecruitmentOverviewResult> {
  const spreadsheetId = getConfiguredSpreadsheetId();

  if (!spreadsheetId) {
    return {
      success: false,
      status: 'NOT_CONFIGURED',
      error: 'Google Sheet ID is not yet configured.',
      message: 'The designated Google Sheet has not been linked. Configure GOOGLE_SHEET_ID in your environment.',
      requiredConfiguration: {
        envKey: 'GOOGLE_SHEET_ID',
        expectedTabs: ['Request Data', 'Candidate Log'],
        documentation: 'Provide the Google Spreadsheet ID from your Google Drive URL: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit',
      },
    };
  }

  try {
    // 1. Fetch Request Data and Candidate Log with tab name auto-resolution
    const availableTabs = await getSpreadsheetTabNames();
    const requestDataTabName = availableTabs.find(t => t.toLowerCase().trim() === 'request data') || 'Request Data';
    const candidateLogTabName = availableTabs.find(t => t.toLowerCase().trim() === 'candidate log') || 'Candidate Log';

    let requestDataSheet: SheetRowData;
    let requestDataError: string | null = null;
    try {
      requestDataSheet = await fetchSheetData(requestDataTabName);
    } catch (err: any) {
      requestDataError = err.message || 'Failed to read Request Data';
      requestDataSheet = {
        headers: [],
        rows: [],
        totalRows: 0,
        totalColumns: 0,
        tabName: requestDataTabName,
        lastRefreshed: new Date().toISOString(),
      };
    }

    let candidateLogSheet: SheetRowData;
    let candidateLogError: string | null = null;
    try {
      candidateLogSheet = await fetchSheetData(candidateLogTabName);
    } catch (err: any) {
      candidateLogError = err.message || 'Failed to read Candidate Log';
      candidateLogSheet = {
        headers: [],
        rows: [],
        totalRows: 0,
        totalColumns: 0,
        tabName: candidateLogTabName,
        lastRefreshed: new Date().toISOString(),
      };
    }

    // If both failed with permission or not found
    if (requestDataError && candidateLogError) {
      const isPermission = requestDataError.includes('PERMISSION_DENIED') || candidateLogError.includes('PERMISSION_DENIED');
      const isNotFound = requestDataError.includes('NOT_FOUND') || candidateLogError.includes('NOT_FOUND');

      return {
        success: false,
        status: isPermission ? 'PERMISSION_DENIED' : isNotFound ? 'NOT_FOUND' : 'ERROR',
        spreadsheetIdMasked: maskSpreadsheetId(spreadsheetId),
        error: requestDataError || candidateLogError,
        message: isPermission
          ? 'Permission denied accessing Google Sheet. Please grant Viewer access to automation@amaavigo.com or make the document shareable.'
          : 'Spreadsheet or worksheets could not be found.',
      };
    }

    // --- Column Detection: Request Data (Dynamic Header Matching) ---
    const reqHeaders = requestDataSheet.headers;
    const reqIdCol = findColumnIndex(reqHeaders, [
      'requestid',
      'request id',
      'requisition id',
      'req id',
      'reqid',
      'requisitionid',
      'requisition no',
      'requisition number',
      'job id',
    ]);
    const vacancyCol = findColumnIndex(reqHeaders, [
      'number of vacancies',
      'numberofvacancies',
      'no of vacancies',
      'no. of vacancies',
      'vacancies',
      'total vacancies',
      'openings',
      'headcount',
      'positions',
    ]);
    const deptCol = findColumnIndex(reqHeaders, [
      'department',
      'dept',
      'function',
      'team',
      'business unit',
    ]);
    const posTitleCol = findColumnIndex(reqHeaders, [
      'position title',
      'position',
      'job title',
      'role',
      'title',
      'designation',
    ]);
    const statusCol = findColumnIndex(reqHeaders, [
      'status',
      'requisition status',
      'job status',
      'req status',
      'state',
    ]);

    // --- Column Detection: Candidate Log ---
    const candHeaders = candidateLogSheet.headers;
    const candIdCol = findColumnIndex(candHeaders, [
      'id',
      'candidate id',
      'application id',
      'app id',
      'applicant id',
      'candidate_id',
      'applicant_id',
      'candidate name',
      'applicant name',
      'name',
      'email',
    ]);
    const desigCol = findColumnIndex(candHeaders, [
      'designation',
      'position applied',
      'applied for',
      'role',
      'job title',
      'position',
    ]);
    const stageCol = findColumnIndex(candHeaders, [
      'status',
      'stage',
      'current stage',
      'candidate status',
      'selection status',
      'interview stage',
    ]);
    const dateCol = findColumnIndex(candHeaders, [
      'application date',
      'applied date',
      'date of application',
      'date',
      'created at',
      'timestamp',
      'interview_datetime',
      'synced_at',
    ]);

    // Build Column Mapping Report
    const columnMapping: ColumnMappingReport = {
      requestData: {
        sheetFound: requestDataSheet.rows.length > 0 || requestDataSheet.headers.length > 0,
        tabNameUsed: requestDataTabName,
        positionColumn: posTitleCol.name || reqIdCol.name,
        requestIdColumn: reqIdCol.name,
        statusColumn: statusCol.name,
        vacancyColumn: vacancyCol.name,
        departmentColumn: deptCol.name,
        totalRows: requestDataSheet.rows.length,
        rawHeaders: reqHeaders,
      },
      candidateLog: {
        sheetFound: candidateLogSheet.rows.length > 0 || candidateLogSheet.headers.length > 0,
        tabNameUsed: candidateLogTabName,
        candidateColumn: candIdCol.name,
        designationColumn: desigCol.name,
        stageColumn: stageCol.name,
        dateColumn: dateCol.name,
        totalRows: candidateLogSheet.rows.length,
        rawHeaders: candHeaders,
      },
    };

    // --- KPI 1: Open Positions, KPI 2: Total Vacancies, KPI 3: Hiring Departments ---
    // User Specification & Exact Logic:
    // 1. Open Positions: Count unique, non-empty RequestID values. Each valid requisition counts as one open position.
    // 2. Total Vacancies: Sum the numeric values in the Number of Vacancies column for all valid requisition rows.
    // 3. Hiring Departments: Count unique, non-empty values in the Department column.
    // Ensure the calculations dynamically update whenever the Google Sheet data changes and the user clicks Refresh.
    // Ignore blank rows, trim whitespace, prevent duplicate counting, and use actual sheet headers.

    let openPositions = 0;
    let totalVacancies = 0;
    const seenRequestIds = new Set<string>();
    const uniqueDepartmentMap = new Map<string, string>(); // lowercase key -> canonical display string
    const departmentBreakdown = new Map<string, { department: string; openPositions: number; vacancies: number }>();

    for (let i = 0; i < requestDataSheet.rows.length; i++) {
      const row = requestDataSheet.rows[i];
      if (!row || !Array.isArray(row)) continue;

      // Ignore blank rows (all cells empty or whitespace)
      const isBlankRow = row.every(cell => cell === null || cell === undefined || String(cell).trim() === '');
      if (isBlankRow) continue;

      // 1. Open Positions: Count unique, non-empty RequestID values
      const rawReqId = reqIdCol.index !== -1
        ? row[reqIdCol.index]
        : (posTitleCol.index !== -1 ? row[posTitleCol.index] : null);

      const reqId = rawReqId !== null && rawReqId !== undefined ? String(rawReqId).trim() : '';
      if (!reqId) {
        // Ignore rows with empty RequestID
        continue;
      }

      // Prevent duplicate counting
      if (seenRequestIds.has(reqId)) {
        continue;
      }
      seenRequestIds.add(reqId);
      openPositions++;

      // 2. Total Vacancies: Sum the numeric values in the Number of Vacancies column for all valid requisition rows
      let vacCount = 0;
      if (vacancyCol.index !== -1) {
        const rawVac = row[vacancyCol.index];
        if (rawVac !== null && rawVac !== undefined) {
          if (typeof rawVac === 'number') {
            vacCount = Number.isFinite(rawVac) && rawVac > 0 ? rawVac : 0;
          } else {
            const trimmedVac = String(rawVac).trim();
            if (trimmedVac) {
              const match = trimmedVac.match(/[-+]?[0-9]*\.?[0-9]+/);
              if (match) {
                const parsed = parseFloat(match[0]);
                if (!isNaN(parsed) && parsed > 0 && isFinite(parsed)) {
                  vacCount = parsed;
                }
              }
            }
          }
        }
      }
      totalVacancies += vacCount;

      // 3. Hiring Departments: Count unique, non-empty values in the Department column
      if (deptCol.index !== -1) {
        const rawDept = row[deptCol.index];
        const dept = rawDept !== null && rawDept !== undefined ? String(rawDept).trim() : '';
        if (dept) {
          const deptKey = dept.toLowerCase();
          if (!uniqueDepartmentMap.has(deptKey)) {
            uniqueDepartmentMap.set(deptKey, dept);
          }

          const existing = departmentBreakdown.get(deptKey) || {
            department: dept,
            openPositions: 0,
            vacancies: 0,
          };
          existing.openPositions += 1;
          existing.vacancies += vacCount;
          departmentBreakdown.set(deptKey, existing);
        }
      }
    }

    const departmentsCount = uniqueDepartmentMap.size;
    const positionsByDepartment = Array.from(departmentBreakdown.values())
      .sort((a, b) => b.vacancies - a.vacancies || b.openPositions - a.openPositions);

    // --- Candidate Log: Total Applications & Breakdown ---
    let totalApplications = 0;
    const candidateIdSet = new Set<string>();
    const designationCountMap = new Map<string, number>();
    const stageCountMap = new Map<string, number>();

    for (let i = 0; i < candidateLogSheet.rows.length; i++) {
      const row = candidateLogSheet.rows[i];
      if (!row || !Array.isArray(row)) continue;

      const isBlankRow = row.every(cell => cell === null || cell === undefined || String(cell).trim() === '');
      if (isBlankRow) continue;

      // Application identity: prefer ID if available
      const rawCandId = candIdCol.index !== -1 ? row[candIdCol.index] : null;
      const candIdVal = rawCandId !== null && rawCandId !== undefined ? String(rawCandId).trim() : '';
      if (candIdVal) {
        if (!candidateIdSet.has(candIdVal)) {
          candidateIdSet.add(candIdVal);
          totalApplications++;
        }
      } else {
        totalApplications++;
      }

      // Designation
      if (desigCol.index !== -1) {
        const rawDesig = row[desigCol.index];
        let desig = rawDesig !== null && rawDesig !== undefined ? String(rawDesig).trim() : '';
        if (desig) {
          desig = desig
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
          designationCountMap.set(desig, (designationCountMap.get(desig) || 0) + 1);
        }
      }

      // Stage / Status
      if (stageCol.index !== -1) {
        const rawStage = row[stageCol.index];
        let stage = rawStage !== null && rawStage !== undefined ? String(rawStage).trim() : '';
        if (stage) {
          stage = stage.charAt(0).toUpperCase() + stage.slice(1);
          stageCountMap.set(stage, (stageCountMap.get(stage) || 0) + 1);
        }
      }
    }

    // Sort designations by count descending
    const applicationsByDesignation = Array.from(designationCountMap.entries())
      .map(([designation, count]) => ({ designation, count }))
      .sort((a, b) => b.count - a.count);

    const designations = applicationsByDesignation.map(d => d.designation);

    // Applications by Stage
    const applicationsByStage = Array.from(stageCountMap.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count);

    return {
      success: true,
      status: 'OK',
      spreadsheetIdMasked: maskSpreadsheetId(spreadsheetId),
      lastRefreshed: new Date().toISOString(),
      kpis: {
        openPositions,
        totalVacancies,
        totalApplications,
        activeRequisitionsCount: openPositions,
        departmentsCount,
      },
      designations,
      applicationsByDesignation,
      positionsByDepartment,
      applicationsByStage,
      availableTabs,
      columnMapping,
    };
  } catch (err: any) {
    console.error('Error computing recruitment overview:', err);
    return {
      success: false,
      status: 'ERROR',
      spreadsheetIdMasked: maskSpreadsheetId(spreadsheetId),
      error: err.message || 'Unknown error occurred while processing Google Sheets data',
    };
  }
}
