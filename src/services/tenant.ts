/**
 * The company the signed-in user belongs to. Every Firestore read is filtered by it and every write
 * is stamped with it. (The Firestore rules enforce the same thing server-side from the ID-token claims,
 * so this is for correctness of queries - it is not what keeps companies apart.)
 */
let currentCompanyId: string | null = null;
let currentCompanyName = '';

export function setTenant(companyId: string | null, companyName = ''): void {
  currentCompanyId = companyId;
  currentCompanyName = companyName;
}

export function getCompanyId(): string {
  if (!currentCompanyId) throw new Error('No company selected - sign in first.');
  return currentCompanyId;
}

export function tryGetCompanyId(): string | null {
  return currentCompanyId;
}

export function getCompanyName(): string {
  return currentCompanyName;
}
