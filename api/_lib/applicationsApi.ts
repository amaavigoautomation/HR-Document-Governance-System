/**
 * Candidate applications, per company.
 *
 *  - /api/applications/:action   HR screens: settings, list, add, CSV import, update, delete, rotate key
 *  - /api/apply/:webhookId       public: a company's own website posts applications here (POST) and can read its open
 *                                jobs (GET). A POST needs the company's key, or must come from a website the company listed.
 *
 * Shared by server.ts (Express) and the Vercel handlers in api/applications and api/apply.
 */
import { AuthError, authErrorResponse, requirePermission, type AuthContext } from './authContext.js';
import {
  APPLICATION_STAGES,
  createApplication,
  deleteApplication,
  getCompanyName,
  getSettings,
  importApplications,
  listApplications,
  listOpenings,
  normalizeApplicationInput,
  rateLimited,
  rotateSecret,
  saveSettings,
  ensureSettings,
  secretMatches,
  settingsByWebhookId,
  touchReceived,
  updateApplication,
  usesLegacySource,
  type RecruitmentSettings,
} from './recruitmentData.js';

export interface ApplicationsRequest {
  method: string;
  action: string;
  query: Record<string, any>;
  body: any;
  headers: Record<string, any>;
  origin?: string;
}

interface Result {
  status: number;
  json: any;
  headers?: Record<string, string>;
}

const ok = (json: Record<string, any> = {}, status = 200): Result => ({ status, json: { success: true, ...json } });
const fail = (status: number, error: string, headers?: Record<string, string>): Result => ({ status, json: { success: false, error }, headers });
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v)).trim();

const MAX_IMPORT_ROWS = 500;

function appBase(origin?: string): string {
  return (process.env.APP_URL || origin || 'http://localhost:3000').replace(/\/+$/, '');
}

function header(headers: Record<string, any>, name: string): string {
  const v = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(v) ? String(v[0] || '') : String(v || '');
}

function settingsView(settings: RecruitmentSettings, origin?: string) {
  return {
    webhookUrl: `${appBase(origin)}/api/apply/${settings.webhookId}`,
    allowedOrigins: settings.allowedOrigins,
    employeeIdPrefix: settings.employeeIdPrefix,
    lastReceivedAt: settings.lastReceivedAt || null,
    keyRotatedAt: settings.rotatedAt,
  };
}

// ------------------------------------------------------------------ HR screens

function needCompany(ctx: AuthContext): string {
  if (!ctx.companyId) throw new AuthError(403, 'Open this as a company user.');
  return ctx.companyId;
}

export async function routeApplications(r: ApplicationsRequest): Promise<Result> {
  try {
    const body = r.body && typeof r.body === 'object' ? r.body : {};
    const viewing = r.action === 'list' || r.action === 'stages';
    const ctx = viewing ? await requirePermission(r.headers, 'talent.view', 'app.manage') : await requirePermission(r.headers, 'app.manage');
    const companyId = needCompany(ctx);
    const legacy = usesLegacySource(companyId);

    if (r.action === 'stages' && r.method === 'GET') return ok({ stages: APPLICATION_STAGES, legacy });

    if (r.action === 'list' && r.method === 'GET') {
      if (legacy) return ok({ legacy: true, items: [] });
      const items = (await listApplications(companyId)).map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        mobile: a.mobile,
        city: a.city,
        designation: a.designation,
        experience: a.experience,
        noticePeriod: a.noticePeriod,
        status: a.status,
        interviewDate: a.interviewDate,
        interviewComment: a.interviewComment,
        message: a.message,
        resumeUrl: a.resumeUrl,
        source: a.source,
        createdAt: a.createdAt,
        reappliedAt: a.reappliedAt || null,
        extra: a.extra,
      }));
      return ok({ legacy: false, items });
    }

    if (r.action === 'settings' && r.method === 'GET') {
      if (legacy) return ok({ legacy: true });
      const { settings, secret } = await ensureSettings(companyId, await getCompanyName(companyId));
      return ok({ legacy: false, ...settingsView(settings, r.origin), secret: secret || null });
    }

    if (r.method !== 'POST') return fail(405, 'Method not allowed.');
    if (legacy && r.action !== 'noop') {
      return fail(409, 'This company still reads candidates from the Amaavigo website, so applications are not managed here.');
    }

    switch (r.action) {
      case 'save-settings': {
        const settings = await saveSettings(companyId, await getCompanyName(companyId), {
          allowedOrigins: body.allowedOrigins,
          employeeIdPrefix: body.employeeIdPrefix,
        });
        return ok(settingsView(settings, r.origin));
      }
      case 'rotate-key': {
        const { settings, secret } = await rotateSecret(companyId, await getCompanyName(companyId));
        return ok({ ...settingsView(settings, r.origin), secret });
      }
      case 'add': {
        const { value, error } = normalizeApplicationInput(body);
        if (!value) return fail(400, error || 'Invalid application.');
        const res = await createApplication(companyId, value, 'MANUAL');
        return ok({ ...res });
      }
      case 'import': {
        const rows = Array.isArray(body.rows) ? body.rows : [];
        if (rows.length === 0) return fail(400, 'No rows to import.');
        if (rows.length > MAX_IMPORT_ROWS) return fail(400, `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
        return ok(await importApplications(companyId, rows, 'CSV'));
      }
      case 'update': {
        const done = await updateApplication(companyId, s(body.id), {
          status: body.status,
          interviewDate: body.interviewDate,
          interviewComment: body.interviewComment,
        });
        return done ? ok() : fail(404, 'Application not found.');
      }
      case 'delete': {
        const done = await deleteApplication(companyId, s(body.id));
        return done ? ok() : fail(404, 'Application not found.');
      }
      default:
        return fail(404, `Unknown applications action '${r.action}'.`);
    }
  } catch (err: any) {
    const known = authErrorResponse(err);
    if (known) return { status: known.status, json: known.json };
    console.error('[Applications] error:', err);
    return fail(500, err?.message || 'Applications request failed.');
  }
}

// ------------------------------------------------------------------ the public webhook

/** Which website, if any, may read the response of a browser request to this company's address. */
function corsFor(settings: RecruitmentSettings | null, requestOrigin: string): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Key',
    Vary: 'Origin',
  };
  if (settings && requestOrigin && settings.allowedOrigins.includes(requestOrigin)) base['Access-Control-Allow-Origin'] = requestOrigin;
  return base;
}

export interface ApplyRequest {
  method: string;
  webhookId: string;
  body: any;
  headers: Record<string, any>;
  ip?: string;
}

export async function routeApply(r: ApplyRequest): Promise<Result> {
  try {
    const settings = await settingsByWebhookId(r.webhookId);
    const requestOrigin = header(r.headers, 'origin');

    if (r.method === 'OPTIONS') return { status: 204, json: null, headers: corsFor(settings, requestOrigin) };
    if (!settings) return fail(404, 'Unknown address.');

    if (r.method === 'GET') {
      // Anyone may read a company's open jobs: it is what a careers page shows.
      const openings = await listOpenings(settings.companyId);
      return {
        status: 200,
        json: {
          success: true,
          jobs: openings.map((o) => ({ id: o.id, title: o.designation, department: o.department, vacancies: o.vacancies, description: o.qualification })),
        },
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' },
      };
    }

    if (r.method !== 'POST') return fail(405, 'Use POST to send an application.');

    const cors = corsFor(settings, requestOrigin);
    if (rateLimited(`apply:${settings.webhookId}`, 60) || (r.ip && rateLimited(`apply-ip:${r.ip}`, 20))) {
      return fail(429, 'Too many applications right now. Please try again in a minute.', cors);
    }

    const supplied = s(header(r.headers, 'x-webhook-key')) || header(r.headers, 'authorization').replace(/^Bearer\s+/i, '').trim();
    const fromListedSite = !!requestOrigin && settings.allowedOrigins.includes(requestOrigin);
    if (!secretMatches(settings, supplied) && !fromListedSite) {
      return fail(401, 'Missing or wrong webhook key. Send it as the X-Webhook-Key header, or post from a website listed in your settings.', cors);
    }

    const payload = r.body;
    if (JSON.stringify(payload ?? {}).length > 100_000) return fail(413, 'The application is too large.', cors);
    const { value, error } = normalizeApplicationInput(payload);
    if (!value) return fail(400, error || 'Invalid application.', cors);

    const res = await createApplication(settings.companyId, value, 'WEBHOOK');
    await touchReceived(settings.companyId);
    return { status: res.duplicate ? 200 : 201, json: { success: true, id: res.id, duplicate: res.duplicate }, headers: cors };
  } catch (err: any) {
    console.error('[Apply webhook] error:', err);
    return fail(500, 'Could not save the application. Please try again.');
  }
}
