import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase client
export const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Use the designated Firestore Database ID
export const db: Firestore = getFirestore(
  firebaseApp,
  firebaseConfig.firestoreDatabaseId || undefined
);
