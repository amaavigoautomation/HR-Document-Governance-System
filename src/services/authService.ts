/**
 * Sign-in, sign-up and session loading (Firebase Authentication).
 *
 * Who a user is and what they may do comes from the claims on their ID token, which only the server can
 * write (see api/_lib/tenantAdmin.ts). This file reads them; it never decides them.
 */
import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { apiJson } from './apiClient';
import { firestoreService } from './firestoreService';
import { setTenant } from './tenant';
import { Company, User, UserRole } from '../types';
import { normalizeAuthorizedModules } from '../utils/authorization';
import type { TenantClaims } from '../../shared/permissions';

export type SessionState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'error'; message: string }
  | { kind: 'platformAdmin'; email: string }
  | { kind: 'pending' | 'suspended'; company: Company; email: string }
  | { kind: 'ready'; user: User; company: Company };

const CLEARED_PREFIXES = ['ama_', 'amaavigo_'];

/** Removes everything cached for the previous user so the next sign-in on this browser starts clean. */
export function clearLocalCaches(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (CLEARED_PREFIXES.some((p) => key.startsWith(p))) localStorage.removeItem(key);
    }
    sessionStorage.clear();
  } catch {
    /* storage may be unavailable */
  }
  try {
    // Locally cached uploaded files (see localMediaDb.ts) belong to the previous user too.
    indexedDB.databases?.().then((dbs) => dbs.forEach((d) => d.name && d.name.toLowerCase().includes('ama') && indexedDB.deleteDatabase(d.name)));
  } catch {
    /* best effort */
  }
}

const friendlyAuthError = (err: any): string => {
  const code = String(err?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found') || code.includes('invalid-email')) {
    return 'Incorrect email or password.';
  }
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (code.includes('user-disabled')) return 'This account has been deactivated. Contact your company administrator.';
  if (code.includes('network')) return 'Network problem. Check your connection and try again.';
  return err?.message || 'Could not sign in.';
};

export async function signIn(email: string, password: string): Promise<void> {
  try {
    await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  } catch (err) {
    throw new Error(friendlyAuthError(err));
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth).catch(() => {});
  setTenant(null);
  clearLocalCaches();
}

export async function requestPasswordReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  } catch (err: any) {
    // Do not reveal whether the address has an account.
    if (!String(err?.code || '').includes('user-not-found')) throw new Error(friendlyAuthError(err));
  }
}

export interface CompanySignupInput {
  companyName: string;
  adminName: string;
  email: string;
  password: string;
}

/** Registers a company (it starts as PENDING until a platform admin approves it) and signs the admin in. */
export async function registerCompany(input: CompanySignupInput): Promise<void> {
  await apiJson('/api/tenant/signup', input);
  await signIn(input.email, input.password);
}

async function loadSession(fb: FirebaseUser): Promise<SessionState> {
  // Force-refresh so claim changes (approval, role edits) are picked up immediately.
  const token = await fb.getIdTokenResult(true);
  const claims = token.claims as TenantClaims & Record<string, unknown>;
  const email = (fb.email || '').toLowerCase();

  if (claims.pa === true) return { kind: 'platformAdmin', email };
  if (!claims.cid) {
    return { kind: 'error', message: 'Your account is not linked to a company. Ask your administrator to set it up.' };
  }

  const companySnap = await getDoc(doc(db, 'companies', String(claims.cid)));
  if (!companySnap.exists()) return { kind: 'error', message: 'Your company could not be found.' };
  const company = { ...(companySnap.data() as Company), id: companySnap.id };

  if (company.status === 'PENDING') return { kind: 'pending', company, email };
  if (company.status !== 'ACTIVE') return { kind: 'suspended', company, email };

  setTenant(company.id, company.name);

  const profileSnap = await getDoc(doc(db, 'employees', fb.uid));
  if (!profileSnap.exists()) return { kind: 'error', message: 'Your profile could not be found. Ask your administrator.' };

  const parsed = firestoreService.parseEmployeeDoc(profileSnap);
  const user: User = {
    ...parsed,
    authUid: fb.uid,
    companyId: company.id,
    companyName: company.name,
    perms: Array.isArray(claims.perms) ? claims.perms : [],
    isCompanyAdmin: claims.adm === true,
    authorizedModules: normalizeAuthorizedModules(parsed.authorizedModules),
    // Portal comes from the server-computed role on the profile; fall back to the safest one.
    role: [UserRole.CREATOR, UserRole.REVIEWER, UserRole.EMPLOYEE].includes(parsed.role) ? parsed.role : UserRole.EMPLOYEE,
  };
  if (user.active === false) return { kind: 'error', message: 'This account has been deactivated.' };
  return { kind: 'ready', user, company };
}

/** A short fingerprint of what the session lets the person do, used to tell whether a refresh changed anything. */
function sessionFingerprint(state: SessionState): string {
  if (state.kind !== 'ready') return state.kind;
  return JSON.stringify([
    state.company.status,
    [...(state.company.modules || [])].sort(),
    [...(state.user.perms || [])].sort(),
    state.user.isCompanyAdmin === true,
    state.user.active,
  ]);
}

const FOCUS_REFRESH_MIN_GAP_MS = 60_000;

/**
 * Subscribes to sign-in state. The callback receives every change (sign-in, sign-out, refresh).
 *
 * Permissions live on the ID token, so when a platform admin changes a company's modules or a company admin
 * edits a role, the person would otherwise keep their old access until they sign out and in. To avoid that,
 * whenever the tab regains focus (at most once a minute) the claims are re-read, and the callback fires again
 * only if what the person may do actually changed.
 */
export function onSession(callback: (state: SessionState) => void): () => void {
  let lastFingerprint = '';
  let lastRefreshAt = 0;
  let refreshing = false;

  const emit = (state: SessionState) => {
    lastFingerprint = sessionFingerprint(state);
    lastRefreshAt = Date.now();
    callback(state);
  };

  callback({ kind: 'loading' });

  const stopAuthListener = onAuthStateChanged(auth, async (fb) => {
    if (!fb) {
      setTenant(null);
      emit({ kind: 'signedOut' });
      return;
    }
    try {
      emit(await loadSession(fb));
    } catch (err: any) {
      console.warn('[auth] could not load session:', err);
      emit({ kind: 'error', message: err?.message || 'Could not load your account.' });
    }
  });

  const refreshOnFocus = async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const fb = auth.currentUser;
    if (!fb || refreshing || Date.now() - lastRefreshAt < FOCUS_REFRESH_MIN_GAP_MS) return;
    refreshing = true;
    try {
      const next = await loadSession(fb);
      lastRefreshAt = Date.now();
      if (sessionFingerprint(next) !== lastFingerprint) emit(next);
    } catch (err) {
      // A failed background refresh must never log the person out or show an error; the next focus retries.
      console.warn('[auth] background refresh skipped:', err);
    } finally {
      refreshing = false;
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
  }

  return () => {
    stopAuthListener();
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    }
  };
}

/** Re-reads claims + company status (used by the "check again" button on the pending-approval screen). */
export async function reloadSession(): Promise<SessionState> {
  const fb = auth.currentUser;
  if (!fb) return { kind: 'signedOut' };
  return loadSession(fb);
}
