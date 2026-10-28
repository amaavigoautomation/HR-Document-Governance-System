/** Family member records (Employee > Family Details). Shared by the server (checking) and the screen (choices). */
export const FAMILY_TITLES = ['Mr', 'Mrs', 'Ms', 'Master', 'Baby', 'Dr'] as const;
export const FAMILY_GENDERS = ['Male', 'Female', 'Other'] as const;
export const FAMILY_RELATIONS = ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Brother', 'Sister', 'Father-in-law', 'Mother-in-law', 'Grandfather', 'Grandmother', 'Other'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed'] as const;
export const FAMILY_EMPLOYMENT = ['Employed', 'Self-employed', 'Student', 'Homemaker', 'Retired', 'Not employed'] as const;
export const MAX_FAMILY_MEMBERS = 25;

export interface FamilyMember {
  title: string; name: string; gender: string; relation: string; address: string; bloodGroup: string; contactNo: string;
  dob: string; maritalStatus: string; marriageDate: string; employment: string; profession: string; nationality: string;
  insuranceNumber: string; remarks: string; isDependent: boolean; healthInsurance: boolean;
}

const oneOf = (list: readonly string[], v: unknown) => { const s = String(v ?? '').trim(); return list.includes(s) ? s : ''; };
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The clean member, or a plain-words error. `today` is YYYY-MM-DD in the company's time zone. */
export function cleanFamilyMember(raw: any, today: string): { value: FamilyMember } | { error: string } {
  const name = text(raw?.name, 80);
  if (!name) return { error: 'Enter the name.' };
  const relation = oneOf(FAMILY_RELATIONS, raw?.relation);
  if (!relation) return { error: 'Choose how this person is related to you.' };
  for (const [key, list, label] of [['gender', FAMILY_GENDERS, 'gender'], ['title', FAMILY_TITLES, 'title'], ['bloodGroup', BLOOD_GROUPS, 'blood group'], ['maritalStatus', MARITAL_STATUSES, 'marital status'], ['employment', FAMILY_EMPLOYMENT, 'employment']] as const) {
    if (raw?.[key] && !list.includes(String(raw[key]) as never)) return { error: `Choose a valid ${label}.` };
  }
  const contactNo = text(raw?.contactNo, 20);
  if (contactNo && !/^[0-9+()\-\s]{5,20}$/.test(contactNo)) return { error: 'Enter a valid contact number.' };
  const dob = text(raw?.dob, 10);
  const marriageDate = text(raw?.marriageDate, 10);
  if (dob && (!isDay(dob) || dob < '1900-01-01' || dob > today)) return { error: 'Use a valid date of birth.' };
  if (marriageDate && (!isDay(marriageDate) || marriageDate < '1900-01-01' || marriageDate > today)) return { error: 'Use a valid marriage date.' };
  const maritalStatus = oneOf(MARITAL_STATUSES, raw?.maritalStatus);
  const healthInsurance = raw?.healthInsurance === true;
  return {
    value: {
      title: oneOf(FAMILY_TITLES, raw?.title), name, gender: oneOf(FAMILY_GENDERS, raw?.gender), relation, address: text(raw?.address, 300),
      bloodGroup: oneOf(BLOOD_GROUPS, raw?.bloodGroup), contactNo, dob, maritalStatus,
      // A marriage date only makes sense for someone who is (or was) married; an insurance number only when they are insured.
      marriageDate: maritalStatus === 'Married' || maritalStatus === 'Divorced' || maritalStatus === 'Widowed' ? marriageDate : '',
      employment: oneOf(FAMILY_EMPLOYMENT, raw?.employment), profession: text(raw?.profession, 80), nationality: text(raw?.nationality, 60),
      insuranceNumber: healthInsurance ? text(raw?.insuranceNumber, 40) : '', remarks: text(raw?.remarks, 300),
      isDependent: raw?.isDependent === true, healthInsurance,
    },
  };
}
