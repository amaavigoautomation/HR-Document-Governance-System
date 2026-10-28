/** Identity documents an employee can record. Pure, shared by the server (validation) and the screen (labels, masking). */
export const IDENTITY_TYPES = [
  { key: 'AADHAAR', label: 'Aadhaar Card Number', hint: '12 digits' },
  { key: 'DRIVING_LICENSE', label: 'Driving License', hint: 'Letters and digits, e.g. MH0120110012345' },
  { key: 'ELECTION_CARD', label: 'Election Card', hint: '3 letters and 7 digits, e.g. ABC1234567' },
  { key: 'PASSPORT', label: 'Passport', hint: '1 letter and 7 digits, e.g. A1234567' },
  { key: 'PAN', label: 'Permanent Account Number', hint: '5 letters, 4 digits, 1 letter, e.g. ABCDE1234F' },
] as const;
export type IdentityType = (typeof IDENTITY_TYPES)[number]['key'];
export const identityTypeKeys = IDENTITY_TYPES.map((t) => t.key) as string[];

/** Upper case, no spaces or dashes. */
export const normalizeIdentity = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');

const RULES: Record<IdentityType, RegExp> = {
  AADHAAR: /^[2-9][0-9]{11}$/,
  DRIVING_LICENSE: /^[A-Z]{2}[0-9A-Z]{6,18}$/,
  ELECTION_CARD: /^[A-Z]{3}[0-9]{7}$/,
  PASSPORT: /^[A-Z][0-9]{7}$/,
  PAN: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
};

/** '' when the number is acceptable, otherwise a plain-words reason. */
export function identityProblem(type: string, raw: unknown): string {
  if (!identityTypeKeys.includes(type)) return 'Unknown identity type.';
  const t = IDENTITY_TYPES.find((x) => x.key === type)!;
  return RULES[type as IdentityType].test(normalizeIdentity(raw)) ? '' : `Enter a valid ${t.label} (${t.hint}).`;
}

/** Shows only the last 4 characters: XXXXXXXX8616. */
export const maskIdentity = (v: string): string => (v.length <= 4 ? v : `${'X'.repeat(v.length - 4)}${v.slice(-4)}`);
