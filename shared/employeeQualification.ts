/** Education records (Employee > Qualification Details). Shared by the server (checking) and the screen (choices). */
export const QUALIFICATIONS = ['10th (SSC)', '12th (HSC)', 'Diploma', 'Bachelor\'s degree', 'Master\'s degree', 'Doctorate', 'Professional certification', 'Other'] as const;
export const STREAMS = ['Science', 'Commerce', 'Arts', 'Engineering', 'Computer / IT', 'Medical', 'Management', 'Law', 'Other'] as const;
export const COURSE_TYPES = ['Regular', 'Integrated', 'Dual degree', 'Certificate', 'Online'] as const;
export const COURSE_NATURES = ['Full time', 'Part time', 'Distance', 'Online'] as const;
export const QUALIFICATION_STATUSES = ['Completed', 'Pursuing', 'Discontinued'] as const;
export const MAX_QUALIFICATIONS = 20;

export interface Qualification {
  qualification: string; streamType: string; courseType: string; specialization: string; nature: string; status: string;
  instituteName: string; universityName: string; fromDate: string; toDate: string; dateOfPassing: string;
  percentage: string; grade: string; isHighest: boolean; remarks: string;
}

const oneOf = (list: readonly string[], v: unknown) => { const s = String(v ?? '').trim(); return list.includes(s) ? s : ''; };
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** "3 years 2 months" from two dates, or ''. The course length is worked out, not typed. */
export function durationText(from: string, to: string): string {
  if (!isDay(from) || !isDay(to) || to < from) return '';
  const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() >= a.getUTCDate() ? 0 : -1);
  months = Math.max(0, months);
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} year${y > 1 ? 's' : ''}` : '', m ? `${m} month${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ') || 'Less than a month';
}

/** The clean record, or a plain-words error. `today` is YYYY-MM-DD in the company's time zone. */
export function cleanQualification(raw: any, today: string): { value: Qualification } | { error: string } {
  const qualification = oneOf(QUALIFICATIONS, raw?.qualification);
  if (!qualification) return { error: 'Choose the qualification.' };
  const universityName = text(raw?.universityName, 120);
  if (!universityName) return { error: 'Enter the university or board name.' };
  for (const [key, list, label] of [['streamType', STREAMS, 'stream'], ['courseType', COURSE_TYPES, 'course type'], ['nature', COURSE_NATURES, 'nature of course'], ['status', QUALIFICATION_STATUSES, 'status']] as const) {
    if (raw?.[key] && !list.includes(String(raw[key]) as never)) return { error: `Choose a valid ${label}.` };
  }
  const status = oneOf(QUALIFICATION_STATUSES, raw?.status) || 'Completed';
  const fromDate = text(raw?.fromDate, 10), toDate = text(raw?.toDate, 10);
  // Someone still studying has not passed yet, so any passing date sent along is ignored.
  const dateOfPassing = status === 'Pursuing' ? '' : text(raw?.dateOfPassing, 10);
  for (const [v, label] of [[fromDate, 'start date'], [toDate, 'end date'], [dateOfPassing, 'date of passing']] as const) {
    if (v && (!isDay(v) || v < '1950-01-01')) return { error: `Use a valid ${label}.` };
  }
  if (fromDate && toDate && toDate < fromDate) return { error: 'The end date cannot be before the start date.' };
  if (dateOfPassing && dateOfPassing > today) return { error: 'The date of passing cannot be in the future. Choose "Pursuing" for a course still running.' };
  if (status === 'Completed' && !dateOfPassing) return { error: 'Enter the date of passing, or choose "Pursuing".' };
  const percentage = text(raw?.percentage, 6);
  if (percentage && !(/^\d{1,3}(\.\d{1,2})?$/.test(percentage) && Number(percentage) <= 100)) return { error: 'Percentage must be a number from 0 to 100.' };
  return {
    value: {
      qualification, streamType: oneOf(STREAMS, raw?.streamType), courseType: oneOf(COURSE_TYPES, raw?.courseType),
      specialization: text(raw?.specialization, 80), nature: oneOf(COURSE_NATURES, raw?.nature), status,
      instituteName: text(raw?.instituteName, 120), universityName, fromDate, toDate,
      dateOfPassing,
      percentage, grade: text(raw?.grade, 10), isHighest: raw?.isHighest === true, remarks: text(raw?.remarks, 300),
    },
  };
}
