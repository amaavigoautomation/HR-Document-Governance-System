/**
 * Personal information fields (Employee > Personal Information). One list drives the server (what may be saved, how it is
 * checked) and the screen (labels, grouping), so they cannot drift apart.
 */
export type PersonalKind = 'text' | 'phone' | 'email' | 'date' | 'long' | 'bool';
export interface PersonalField { key: string; label: string; kind: PersonalKind; max?: number; group: string }
export type PersonalTab = 'general' | 'contact' | 'emergency';

const f = (group: string, key: string, label: string, kind: PersonalKind = 'text', max = 80): PersonalField => ({ group, key, label, kind, max });

export const PERSONAL_GROUPS: { tab: PersonalTab; group: string; title: string }[] = [
  { tab: 'general', group: 'employment', title: 'Employment and residence' },
  { tab: 'general', group: 'languages', title: 'Languages' },
  { tab: 'general', group: 'addresses', title: 'Addresses' },
  { tab: 'contact', group: 'contact', title: 'Permanent contact' },
  { tab: 'emergency', group: 'first', title: 'First person' },
  { tab: 'emergency', group: 'second', title: 'Second person' },
];

const person = (g: string, p: string) => [
  f(g, `${p}Name`, 'Name'), f(g, `${p}Relationship`, 'Relationship'), f(g, `${p}Mobile1`, 'Mobile 1', 'phone', 20),
  f(g, `${p}Mobile2`, 'Mobile 2', 'phone', 20), f(g, `${p}Address`, 'Address', 'long', 300), f(g, `${p}Landline`, 'Land line', 'phone', 20),
];

export const PERSONAL_FIELDS: PersonalField[] = [
  f('employment', 'offerLetterNo', 'Offer letter no.'), f('employment', 'residentCardNo', 'Resident card / civil no.'),
  f('employment', 'residentCardDesignation', 'Resident card designation'), f('employment', 'manpowerId', 'Manpower ID'),
  f('employment', 'stateOfResidence', 'State of residence'), f('employment', 'accommodation', 'Accommodation details', 'long', 300),
  f('employment', 'airPassage', 'Eligible for air passage', 'bool'),
  f('languages', 'firstLanguage', 'First language'), f('languages', 'secondLanguage', 'Second language'),
  f('addresses', 'permanentAddress', 'Permanent address', 'long', 300), f('addresses', 'postalAddress', 'Postal address', 'long', 300),
  f('contact', 'contactPerson', 'Contact person'), f('contact', 'contactLocation', 'Contact location'), f('contact', 'contactCity', 'Contact city'),
  f('contact', 'contactCountry', 'Contact country'), f('contact', 'contactLandline', 'Contact no. (land line)', 'phone', 20),
  f('contact', 'personalNo', 'Personal no.', 'phone', 20), f('contact', 'personalEmail', 'Personal email', 'email', 120), f('contact', 'officialGsm', 'Official GSM', 'phone', 20),
  ...person('first', 'emg1'), ...person('second', 'emg2'),
];

const PHONE = /^[0-9+()\-\s]{5,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The clean value, or an error in plain words. Empty text is allowed (it clears the field). */
export function checkPersonalField(fd: PersonalField, raw: unknown): { value: string | boolean } | { error: string } {
  if (fd.kind === 'bool') return { value: raw === true };
  const v = String(raw ?? '').trim().slice(0, fd.max || 80);
  if (v && fd.kind === 'phone' && !PHONE.test(v)) return { error: `${fd.label}: enter a valid phone number.` };
  if (v && fd.kind === 'email' && !EMAIL.test(v)) return { error: `${fd.label}: enter a valid email address.` };
  return { value: v };
}
