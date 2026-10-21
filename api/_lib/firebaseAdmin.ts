/**
 * Firebase Admin SDK (service account). This is the "master key": it is the only thing that can
 * create login accounts and stamp the company / permission claims onto a user's ID token.
 * It must only ever run on the server (Vercel env vars / local .env) - never in the browser.
 *
 * FIREBASE_SERVICE_ACCOUNT_JSON accepts either the raw JSON or the same JSON base64-encoded
 * (base64 is easier to paste into hosting dashboards).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applicationDefault, cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

const fileConfig: Record<string, any> = (() => {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
  } catch {
    return {};
  }
})();

function readServiceAccount(): Record<string, any> | null {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed.private_key === 'string') parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return parsed;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON (or base64 JSON).');
  }
}

export function isAdminConfigured(): boolean {
  return !!(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
}

let appInstance: App | null = null;

export function adminApp(): App {
  if (appInstance) return appInstance;
  const existing = getApps().find((a) => a.name === 'tenant-admin');
  if (existing) {
    appInstance = getApp('tenant-admin');
    return appInstance;
  }
  const sa = readServiceAccount();
  if (!sa) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not configured. Create a service account key in the Firebase console ' +
        '(Project settings > Service accounts) and set it as an environment variable.'
    );
  }
  appInstance = initializeApp(
    {
      credential: cert(sa),
      projectId: (process.env.FIREBASE_PROJECT_ID || sa.project_id || fileConfig.projectId || '').toString(),
    },
    'tenant-admin'
  );
  return appInstance;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  const databaseId = (process.env.FIREBASE_DATABASE_ID || fileConfig.firestoreDatabaseId || '').toString().trim();
  return databaseId && databaseId !== '(default)' ? getFirestore(adminApp(), databaseId) : getFirestore(adminApp());
}

export { applicationDefault };
