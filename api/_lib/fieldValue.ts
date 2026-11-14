/**
 * `FieldValue` that matches whichever database is in use: MongoDB's adapter understands its own sentinels,
 * Firestore only understands its own. Import this instead of `firebase-admin/firestore`.
 */
import { FieldValue as FirestoreFieldValue } from 'firebase-admin/firestore';
import { isMongoConfigured, MongoFieldValues } from './mongoFirestore.js';

const pick = () => (isMongoConfigured() ? MongoFieldValues : FirestoreFieldValue);

export const FieldValue = {
  arrayUnion: (...items: any[]) => (pick().arrayUnion as (...a: any[]) => any)(...items),
  arrayRemove: (...items: any[]) => (pick().arrayRemove as (...a: any[]) => any)(...items),
  increment: (n: number) => (pick().increment as (n: number) => any)(n),
  delete: () => (pick().delete as () => any)(),
  serverTimestamp: () => (pick().serverTimestamp as () => any)(),
};
