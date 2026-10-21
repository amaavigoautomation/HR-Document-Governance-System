/**
 * Client-side Recruitment & Google Sheets Integration Service
 * 
 * Interacts with the secure server-side `/api/recruitment/*` endpoints.
 * Never stores or transmits Google credentials in the client browser.
 */

import { RecruitmentOverviewResult, SheetRowData } from './serverSheets';
import type { AIEvaluationResponse } from './aiEvaluationService';

export class RecruitmentService {
  private overviewCache: { data: RecruitmentOverviewResult; timestamp: number } | null = null;
  private sheetCache: Map<string, { data: SheetRowData; timestamp: number }> = new Map();
  private aiEvalCache: Map<string, { data: AIEvaluationResponse; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 60 * 1000; // 1 minute client cache unless refreshed explicitly

  /**
   * Safely fetches and parses JSON with content-type checking and warmup retry logic.
   */
  private async safeFetchJson<T>(url: string, headers: Record<string, string> = {}, retries = 2): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, { headers });
        const contentType = res.headers.get('content-type') || '';
        const isJson = contentType.includes('application/json');

        if (!res.ok) {
          let errorMsg = `Server error (HTTP ${res.status})`;
          if (isJson) {
            const errJson = await res.json().catch(() => ({}));
            errorMsg = errJson.error || errJson.message || errorMsg;
          } else {
            const text = await res.text().catch(() => '');
            if (text.includes('<!doctype') || text.includes('<html')) {
              errorMsg = 'Backend server is warming up or initializing. Please retry in a few moments.';
            } else if (text.trim()) {
              errorMsg = text.slice(0, 150);
            }
          }
          throw new Error(errorMsg);
        }

        if (!isJson) {
          const text = await res.text().catch(() => '');
          if (text.includes('<!doctype') || text.includes('<html')) {
            if (attempt < retries) {
              await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
              continue;
            }
            throw new Error('Server returned HTML instead of JSON (service warming up). Please click Refresh in a moment.');
          }
          throw new Error(`Unexpected non-JSON response from server: ${text.slice(0, 100)}`);
        }

        return (await res.json()) as T;
      } catch (err: any) {
        lastError = err;
        const isTransient =
          err.message?.includes('warming up') ||
          err.message?.includes('HTML') ||
          err.message?.includes('Failed to fetch') ||
          err.message?.includes('NetworkError');

        if (attempt < retries && isTransient) {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw lastError || new Error('Unable to connect to service. Please check your connection and retry.');
  }

  /**
   * Fetches the recruitment overview metrics from the backend.
   * If forceRefresh is true, bypasses the client cache and instructs the server to re-read.
   */
  async getOverview(forceRefresh = false, userRole?: string): Promise<RecruitmentOverviewResult> {
    const now = Date.now();
    if (!forceRefresh && this.overviewCache && now - this.overviewCache.timestamp < this.CACHE_TTL_MS) {
      return this.overviewCache.data;
    }

    const url = `/api/recruitment/overview${forceRefresh ? '?refresh=true' : ''}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (userRole) {
      headers['X-User-Role'] = userRole;
    }

    const data = await this.safeFetchJson<RecruitmentOverviewResult>(url, headers);
    this.overviewCache = { data, timestamp: now };
    return data;
  }

  /**
   * Fetches raw sheet rows and columns for any available worksheet tab.
   */
  async getSheetData(tabName: string, forceRefresh = false, userRole?: string): Promise<SheetRowData> {
    const now = Date.now();
    const cached = this.sheetCache.get(tabName);
    if (!forceRefresh && cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const url = `/api/recruitment/sheet-data?tabName=${encodeURIComponent(tabName)}${
      forceRefresh ? '&refresh=true' : ''
    }`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (userRole) {
      headers['X-User-Role'] = userRole;
    }

    const data = await this.safeFetchJson<SheetRowData>(url, headers);
    this.sheetCache.set(tabName, { data, timestamp: now });
    return data;
  }

  /**
   * Retrieves Google Sheets configuration status (masked spreadsheet ID, readiness).
   */
  async getConfigStatus(): Promise<{
    isConfigured: boolean;
    spreadsheetIdMasked: string;
    hasApiKey: boolean;
    expectedTabs: string[];
  }> {
    return this.safeFetchJson('/api/recruitment/config', {
      'Content-Type': 'application/json',
    });
  }

  /**
   * Retrieves dynamic AI-powered candidate evaluation, JD comparison, and HR recommendations.
   */
  async getAIEvaluation(designation: string, forceRefresh = false, userRole?: string, evaluateWithAi = false): Promise<AIEvaluationResponse> {
    const key = designation.toLowerCase().trim();
    const now = Date.now();
    const cached = this.aiEvalCache.get(key);
    if (!forceRefresh && !evaluateWithAi && cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.data;
    }

    const url = `/api/recruitment/ai-evaluation?designation=${encodeURIComponent(designation)}${
      forceRefresh ? '&refresh=true' : ''
    }${evaluateWithAi ? '&evaluate=true' : ''}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (userRole) {
      headers['X-User-Role'] = userRole;
    }

    const data = await this.safeFetchJson<AIEvaluationResponse>(url, headers);
    this.aiEvalCache.set(key, { data, timestamp: now });
    return data;
  }

  /**
   * Clears in-memory caches
   */
  clearCache() {
    this.overviewCache = null;
    this.sheetCache.clear();
    this.aiEvalCache.clear();
  }
}

export const recruitmentService = new RecruitmentService();
