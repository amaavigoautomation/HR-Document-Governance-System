/**
 * Verified request identity. Replaces the old spoofable `x-user-role` header.
 * The browser sends `Authorization: Bearer <Firebase ID token>`; we verify the signature with the
 * Admin SDK and read the company / permission claims that only the server can write.
 */
import { adminAuth } from './firebaseAdmin.js';
import { hasPerm, type TenantClaims } from '../../shared/permissions.js';

export interface AuthContext {
  uid: string;
  email: string;
  companyId: string | null;
  companyStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | null;
  perms: string[];
  isCompanyAdmin: boolean;
  isPlatformAdmin: boolean;
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function header(headers: Record<string, any> | undefined, name: string): string {
  if (!headers) return '';
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? String(v[0] || '') : String(v || '');
}

export async function authenticate(headers: Record<string, any> | undefined): Promise<AuthContext> {
  const raw = header(headers, 'authorization');
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new AuthError(401, 'Sign in required.');

  let decoded: any;
  try {
    decoded = await adminAuth().verifyIdToken(token);
  } catch {
    throw new AuthError(401, 'Your session has expired. Please sign in again.');
  }

  const claims = decoded as TenantClaims & Record<string, any>;
  return {
    uid: decoded.uid,
    email: String(decoded.email || '').toLowerCase(),
    companyId: claims.cid ? String(claims.cid) : null,
    companyStatus: (claims.cs as AuthContext['companyStatus']) || null,
    perms: Array.isArray(claims.perms) ? claims.perms.map(String) : [],
    isCompanyAdmin: claims.adm === true,
    isPlatformAdmin: claims.pa === true,
  };
}

/** Requires a signed-in user whose company is approved and active. Platform admins pass without a company. */
export async function requireActiveTenant(headers: Record<string, any> | undefined): Promise<AuthContext> {
  const ctx = await authenticate(headers);
  if (ctx.isPlatformAdmin) return ctx;
  if (!ctx.companyId) throw new AuthError(403, 'Your account is not linked to a company.');
  if (ctx.companyStatus === 'PENDING') throw new AuthError(403, 'Your company is awaiting approval.');
  if (ctx.companyStatus !== 'ACTIVE') throw new AuthError(403, 'Your company account is not active.');
  return ctx;
}

export async function requirePermission(headers: Record<string, any> | undefined, ...anyOf: string[]): Promise<AuthContext> {
  const ctx = await requireActiveTenant(headers);
  if (ctx.isCompanyAdmin) return ctx;
  if (!anyOf.some((p) => hasPerm(ctx.perms, p))) {
    throw new AuthError(403, 'You do not have permission to do this.');
  }
  return ctx;
}

export async function requirePlatformAdmin(headers: Record<string, any> | undefined): Promise<AuthContext> {
  const ctx = await authenticate(headers);
  if (!ctx.isPlatformAdmin) throw new AuthError(403, 'Platform administrators only.');
  return ctx;
}

export function authErrorResponse(err: unknown): { status: number; json: { success: false; error: string } } | null {
  if (err instanceof AuthError) return { status: err.status, json: { success: false, error: err.message } };
  return null;
}

/**
 * Features backed by ONE global configuration (the Google Sheet, the amaavigo.com careers API,
 * the candidate onboarding collections) are only available to the "home" company until those
 * settings become per-company. Set HOME_COMPANY_ID to the company id that owns them.
 */
export function assertHomeTenant(ctx: AuthContext): void {
  if (ctx.isPlatformAdmin) return;
  const home = (process.env.HOME_COMPANY_ID || '').trim();
  if (!home || ctx.companyId !== home) {
    throw new AuthError(
      403,
      home
        ? 'This feature is not connected for your company yet. It runs on shared integrations (candidate source, onboarding, careers) that are only set up for the main company.'
        : 'This feature is not set up on the server yet: HOME_COMPANY_ID is empty. Set it to the id of the company that owns the shared integrations, then restart.'
    );
  }
}

export async function requireHomeTenantPermission(headers: Record<string, any> | undefined, ...anyOf: string[]): Promise<AuthContext> {
  const ctx = await requirePermission(headers, ...anyOf);
  assertHomeTenant(ctx);
  return ctx;
}