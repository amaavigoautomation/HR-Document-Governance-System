import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase client. Only Firebase Authentication is used in the browser: all data lives in MongoDB and is
// read and written through the server (see dataStore.ts), so there is no Firestore connection here any more.
export const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

/**
 * Placeholder for the database handle that the Firestore functions used to take as their first argument.
 * The functions in dataStore.ts accept it and ignore it, which keeps every existing call site unchanged.
 */
export const db: object = {};

export const auth: Auth = getAuth(firebaseApp);
