import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { initializeFirestore, getFirestore, Firestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

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
    firebaseConfig.firestoreDatabaseId || undefined
  );
} catch {
  firestoreInstance = getFirestore(
    firebaseApp,
    firebaseConfig.firestoreDatabaseId || undefined
  );
}

export const db: Firestore = firestoreInstance;

export const auth: Auth = getAuth(firebaseApp);
