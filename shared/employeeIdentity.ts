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

/** Photos of an identity document. The browser shrinks every upload to a JPEG that fits these limits. */
export const MAX_IDENTITY_FILES = 2;               // e.g. front and back
export const MAX_IDENTITY_FILE_CHARS = 900_000;    // size of the stored data URL; Firestore documents stop at 1 MiB

/** A JPEG data URL under the size limit, or a plain-words reason. Checks the real file bytes, not just the label. */
export function checkIdentityImage(dataUrl: unknown): string {
  const v = typeof dataUrl === 'string' ? dataUrl : '';
  if (!v.startsWith('data:image/jpeg;base64,')) return 'Upload a photo (JPG or PNG).';
  if (v.length > MAX_IDENTITY_FILE_CHARS) return 'That image is too large. Try a smaller photo.';
  const head = v.slice('data:image/jpeg;base64,'.length, 'data:image/jpeg;base64,'.length + 8);
  const bytes = typeof Buffer !== 'undefined' ? Buffer.from(head, 'base64') : Uint8Array.from(atob(head), (c) => c.charCodeAt(0));
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? '' : 'That file is not a valid image.';
}
