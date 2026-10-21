/**
 * Makes an existing Firebase user a platform admin (can approve / suspend companies).
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON='...' npx tsx scripts/make-platform-admin.ts you@example.com
 *
 * The user must already exist (sign up once, or create them in the Firebase console). They need to sign
 * out and in again to pick up the new claim. Add --create to create the user with a password:
 *   npx tsx scripts/make-platform-admin.ts you@example.com --create 'a-strong-password'
 */
import { adminAuth } from '../api/_lib/firebaseAdmin';

async function main() {
  const [email, flag, password] = process.argv.slice(2);
  if (!email) throw new Error('Usage: make-platform-admin.ts <email> [--create <password>]');
  const auth = adminAuth();
  let user;
  try {
    user = await auth.getUserByEmail(email.toLowerCase());
  } catch (err: any) {
    if (err?.code !== 'auth/user-not-found' || flag !== '--create' || !password) throw err;
    user = await auth.createUser({ email: email.toLowerCase(), password, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { pa: true });
  await auth.revokeRefreshTokens(user.uid);
  console.log(`${email} is now a platform admin (uid ${user.uid}). Sign out and back in.`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
