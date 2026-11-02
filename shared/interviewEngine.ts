/**
 * Interview helpers: calendar invites (.ics), reminder times and blind scorecards.
 *
 * Blind scorecards: while an interview is open, an interviewer only ever sees their own scorecard. The others (and the
 * average) appear only once that interviewer has submitted their own, so nobody is swayed by a colleague's marks.
 */

export interface Scorecard {
  interviewerId: string;
  interviewerName: string;
  /** criterion -> 1..5 */
  ratings: Record<string, number>;
  recommendation: 'STRONG_YES' | 'YES' | 'NO' | 'STRONG_NO';
  strengths: string;
  concerns: string;
  submittedAt: string;
}

export const DEFAULT_CRITERIA = ['Technical skills', 'Problem solving', 'Communication', 'Culture fit', 'Role knowledge'] as const;

export const RECOMMENDATION_LABEL: Record<Scorecard['recommendation'], string> = {
  STRONG_YES: 'Strong yes',
  YES: 'Yes',
  NO: 'No',
  STRONG_NO: 'Strong no',
};

const RECO_POINTS: Record<Scorecard['recommendation'], number> = { STRONG_YES: 2, YES: 1, NO: -1, STRONG_NO: -2 };

export function validateScorecard(input: any, criteria: readonly string[]): { value?: Omit<Scorecard, 'interviewerId' | 'interviewerName' | 'submittedAt'>; error?: string } {
  if (!input || typeof input !== 'object') return { error: 'Scorecard is required.' };
  const ratings: Record<string, number> = {};
  for (const c of criteria) {
    const n = Number(input.ratings?.[c]);
    if (!Number.isInteger(n) || n < 1 || n > 5) return { error: `Rate "${c}" from 1 to 5.` };
    ratings[c] = n;
  }
  const rec = String(input.recommendation || '');
  if (!(rec in RECO_POINTS)) return { error: 'Choose a recommendation.' };
  const strengths = String(input.strengths || '').trim().slice(0, 2000);
  const concerns = String(input.concerns || '').trim().slice(0, 2000);
  if (!strengths && !concerns) return { error: 'Add at least one comment (strengths or concerns).' };
  return { value: { ratings, recommendation: rec as Scorecard['recommendation'], strengths, concerns } };
}

export function averageRating(card: Pick<Scorecard, 'ratings'>): number {
  const v = Object.values(card.ratings);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : 0;
}

export interface BlindView {
  /** Cards this viewer may see. */
  visible: Scorecard[];
  /** How many scorecards exist that this viewer cannot see yet. */
  hiddenCount: number;
  submittedCount: number;
  expectedCount: number;
  /** Panel average over all submitted cards; shown only to people who may see everything. */
  summary: { average: number; recommendation: string; split: Record<string, number> } | null;
}

/**
 * What `viewerId` may see. Until every interviewer on the panel has submitted, a person sees only their own card (or none).
 * Once the panel is complete, everyone who submitted and HR (`hrCanSeeAll`) see all cards and the panel summary.
 */
export function blindView(cards: Scorecard[], expectedInterviewerIds: string[], viewerId: string, hrCanSeeAll: boolean): BlindView {
  const mine = cards.find((c) => c.interviewerId === viewerId);
  const panelDone = expectedInterviewerIds.length > 0 && expectedInterviewerIds.every((id) => cards.some((c) => c.interviewerId === id));
  const unlocked = panelDone && (hrCanSeeAll || !!mine);
  const visible = unlocked ? cards : mine ? [mine] : [];
  const summary = unlocked && cards.length ? summarise(cards) : null;
  return { visible, hiddenCount: cards.length - visible.length, submittedCount: cards.length, expectedCount: expectedInterviewerIds.length, summary };
}

export function summarise(cards: Scorecard[]): { average: number; recommendation: string; split: Record<string, number> } {
  const avg = Math.round((cards.reduce((a, c) => a + averageRating(c), 0) / cards.length) * 100) / 100;
  const split: Record<string, number> = {};
  let pts = 0;
  for (const c of cards) {
    split[RECOMMENDATION_LABEL[c.recommendation]] = (split[RECOMMENDATION_LABEL[c.recommendation]] || 0) + 1;
    pts += RECO_POINTS[c.recommendation];
  }
  const mean = pts / cards.length;
  const recommendation = mean >= 1.25 ? 'Strong yes' : mean >= 0.25 ? 'Lean yes' : mean > -0.75 ? 'Split / lean no' : 'No';
  return { average: avg, recommendation, split };
}

// ---------------------------------------------------------------- calendar invite

const pad = (n: number) => String(n).padStart(2, '0');
const icsDate = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 characters as the iCalendar format requires. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  out.push(rest);
  return out.join('\r\n');
}

export interface InviteInput {
  uid: string;
  startIso: string;
  durationMinutes: number;
  title: string;
  description: string;
  location: string;
  organizerName: string;
  organizerEmail: string;
  attendees: { name: string; email: string }[];
  sequence?: number;
  cancel?: boolean;
  now?: string;
}

export function buildIcs(i: InviteInput): string {
  const start = new Date(i.startIso);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid interview start time.');
  const end = new Date(start.getTime() + Math.max(5, i.durationMinutes) * 60000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Amaavigo//HR Hiring//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${i.cancel ? 'CANCEL' : 'REQUEST'}`,
    'BEGIN:VEVENT',
    `UID:${i.uid}`,
    `DTSTAMP:${icsDate(new Date(i.now || Date.now()))}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SEQUENCE:${i.sequence || 0}`,
    `STATUS:${i.cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${esc(i.title)}`,
    `DESCRIPTION:${esc(i.description)}`,
    `LOCATION:${esc(i.location)}`,
    `ORGANIZER;CN=${esc(i.organizerName)}:mailto:${i.organizerEmail}`,
    ...i.attendees.map((a) => `ATTENDEE;CN=${esc(a.name)};ROLE=REQ-PARTICIPANT:mailto:${a.email}`),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** When reminder emails are due: 24 hours and 1 hour before. Past times are dropped. */
export function reminderTimes(startIso: string, nowIso: string): { kind: '24h' | '1h'; at: string }[] {
  const start = new Date(startIso).getTime();
  const now = new Date(nowIso).getTime();
  const out: { kind: '24h' | '1h'; at: string }[] = [];
  for (const [kind, ms] of [['24h', 86400000], ['1h', 3600000]] as const) {
    const at = start - ms;
    if (at > now) out.push({ kind, at: new Date(at).toISOString() });
  }
  return out;
}
