import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { initializeFirestore, getFirestore, Firestore } from 'firebase/firestore';
import fileConfig from '../../firebase-applet-config.json';

// Each deployment can point at its own Firebase project without touching the repo: set the VITE_FIREBASE_*
// variables (build-time) and they win over firebase-applet-config.json, which stays the default.
const env = import.meta.env as Record<string, string | undefined>;
const pick = (key: string, fallback: string) => (env[`VITE_FIREBASE_${key}`] || fallback || '').trim();

const firebaseConfig = {
  ...fileConfig,
  apiKey: pick('API_KEY', fileConfig.apiKey),
  authDomain: pick('AUTH_DOMAIN', fileConfig.authDomain),
  projectId: pick('PROJECT_ID', fileConfig.projectId),
  appId: pick('APP_ID', fileConfig.appId),
  storageBucket: pick('STORAGE_BUCKET', fileConfig.storageBucket),
  messagingSenderId: pick('MESSAGING_SENDER_ID', fileConfig.messagingSenderId),
  // A project override without a database override means the new project's default database; the old
  // project's named database would not exist there.
  firestoreDatabaseId: env.VITE_FIREBASE_PROJECT_ID
    ? (env.VITE_FIREBASE_DATABASE_ID || '').trim()
    : pick('DATABASE_ID', fileConfig.firestoreDatabaseId),
};
const databaseId = firebaseConfig.firestoreDatabaseId === '(default)' ? undefined : firebaseConfig.firestoreDatabaseId || undefined;

// Initialize Firebase client
export const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Use the designated Firestore Database ID with robust long-polling auto-detection for cloud container/sandboxed environments
let firestoreInstance: Firestore;
try {
  firestoreInstance = initializeFirestore(
    firebaseApp,
    {
      experimentalAutoDetectLongPolling: true,
    },
    (firebaseConfig.firestoreDatabaseId === '(default)' ? '' : firebaseConfig.firestoreDatabaseId) || undefined
  );
} catch {
  firestoreInstance = getFirestore(firebaseApp, databaseId);
}

export const db: Firestore = firestoreInstance;

export const auth: Auth = getAuth(firebaseApp);
