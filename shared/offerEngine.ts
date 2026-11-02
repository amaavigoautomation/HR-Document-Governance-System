/**
 * Offer and joining: pure rules shared by the browser and the API (no I/O).
 *  - the offer status machine (salary approval, sending, the candidate's answer, joining)
 *  - CTC breakup for the compensation sheet
 *  - the offer pack (offer letter, compensation sheet, joining checklist, NDA, employment agreement)
 *  - which reminders are due today
 *  - hiring cost categories
 */
import { prettyDate, renderTemplate } from './lifecycleEngine.js';

// ------------------------------------------------------------------ status machine

export type OfferStatus =
  | 'DRAFT' | 'PENDING_FOUNDER' | 'APPROVED' | 'REJECTED' | 'SENT' | 'NEGOTIATION'
  | 'ACCEPTED' | 'DECLINED' | 'GHOSTED' | 'EXPIRED' | 'JOINED' | 'WITHDRAWN';

export const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  DRAFT: 'Draft', PENDING_FOUNDER: 'Waiting for founder', APPROVED: 'Approved, not sent', REJECTED: 'Rejected by founder', SENT: 'Offer sent',
  NEGOTIATION: 'Negotiation', ACCEPTED: 'Accepted', DECLINED: 'Declined', GHOSTED: 'No response (ghosted)', EXPIRED: 'Expired', JOINED: 'Joined', WITHDRAWN: 'Withdrawn',
};

export type OfferAction = 'submit' | 'approve' | 'reject' | 'send' | 'accept' | 'decline' | 'negotiate' | 'revise' | 'ghost' | 'expire' | 'join' | 'withdraw';

const FINAL: OfferStatus[] = ['DECLINED', 'GHOSTED', 'EXPIRED', 'JOINED', 'WITHDRAWN'];
export const isFinalOffer = (s: OfferStatus) => FINAL.includes(s);

const TRANSITIONS: Record<OfferAction, { from: OfferStatus[]; to: OfferStatus }> = {
  submit: { from: ['DRAFT', 'REJECTED'], to: 'PENDING_FOUNDER' },
  approve: { from: ['PENDING_FOUNDER'], to: 'APPROVED' },
  reject: { from: ['PENDING_FOUNDER'], to: 'REJECTED' },
  send: { from: ['APPROVED'], to: 'SENT' },
  accept: { from: ['SENT', 'NEGOTIATION'], to: 'ACCEPTED' },
  decline: { from: ['SENT', 'NEGOTIATION', 'ACCEPTED'], to: 'DECLINED' },
  negotiate: { from: ['SENT'], to: 'NEGOTIATION' },
  // Negotiation goes back to salary approval with a new number.
  revise: { from: ['NEGOTIATION'], to: 'DRAFT' },
  ghost: { from: ['SENT', 'NEGOTIATION'], to: 'GHOSTED' },
  expire: { from: ['SENT', 'NEGOTIATION'], to: 'EXPIRED' },
  join: { from: ['ACCEPTED'], to: 'JOINED' },
  withdraw: { from: ['DRAFT', 'PENDING_FOUNDER', 'APPROVED', 'REJECTED', 'SENT', 'NEGOTIATION', 'ACCEPTED'], to: 'WITHDRAWN' },
};

export function offerTransition(from: OfferStatus, action: OfferAction): { ok: true; to: OfferStatus } | { ok: false; error: string } {
  const t = TRANSITIONS[action];
  if (!t) return { ok: false, error: 'Unknown action.' };
  if (!t.from.includes(from)) return { ok: false, error: `This offer is "${OFFER_STATUS_LABEL[from]}", so it cannot be ${actionVerb(action)} now.` };
  return { ok: true, to: t.to };
}

function actionVerb(a: OfferAction): string {
  return ({ submit: 'sent for approval', approve: 'approved', reject: 'rejected', send: 'sent', accept: 'accepted', decline: 'declined', negotiate: 'put into negotiation', revise: 'revised', ghost: 'marked as no response', expire: 'expired', join: 'marked as joined', withdraw: 'withdrawn' } as Record<OfferAction, string>)[a];
}

// ------------------------------------------------------------------ recommended CTC check

export interface CtcCheck { ok: boolean; overBand: boolean; bandMaxLpa: number | null; needsReason: boolean; message: string }

/** A recommended CTC above the requisition's budget band is allowed, but only with a written reason the founder will see. */
export function checkRecommendedCtc(ctcLpa: unknown, bandMaxLpa: number | null, reason: string): CtcCheck {
  const n = Number(ctcLpa);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return { ok: false, overBand: false, bandMaxLpa, needsReason: false, message: 'Enter the recommended CTC in lakhs per year, for example 8.5.' };
  const over = bandMaxLpa !== null && n > bandMaxLpa;
  if (over && !reason.trim()) return { ok: false, overBand: true, bandMaxLpa, needsReason: true, message: `${n} LPA is above the budgeted maximum of ${bandMaxLpa} LPA. Write the reason for the founder.` };
  return { ok: true, overBand: over, bandMaxLpa, needsReason: false, message: over ? `${n} LPA is above the budgeted ${bandMaxLpa} LPA; the founder will see your reason.` : 'Within the budgeted band.' };
}

// ------------------------------------------------------------------ CTC breakup

export interface Breakup { annual: Record<string, number>; monthly: Record<string, number>; total: number }
export const BREAKUP_LABEL: Record<string, string> = {
  basic: 'Basic salary', hra: 'House rent allowance', special: 'Special allowance', employerPf: 'Employer provident fund', gratuity: 'Gratuity',
};

const PF_CEILING_ANNUAL = 21_600; // employer PF is on a wage ceiling of Rs 15,000 a month: 12% of it, for a year

/**
 * An illustrative standard structure: basic 40% of CTC, HRA 50% of basic, employer PF 12% of basic (capped), gratuity 4.81% of basic,
 * and the balance as special allowance, so the parts always add up to the CTC. HR can replace the sheet text before sending.
 */
export function ctcBreakup(ctcLpa: number): Breakup {
  const total = Math.round(ctcLpa * 100000);
  const r = (x: number) => Math.round(x);
  const basic = r(total * 0.4);
  const hra = r(basic * 0.5);
  const employerPf = Math.min(r(basic * 0.12), PF_CEILING_ANNUAL);
  const gratuity = r(basic * 0.0481);
  const special = total - basic - hra - employerPf - gratuity;
  const annual = { basic, hra, special, employerPf, gratuity };
  const monthly = Object.fromEntries(Object.entries(annual).map(([k, v]) => [k, r(v / 12)]));
  return { annual, monthly, total };
}

const inr = (n: number) => `Rs. ${Math.round(n).toLocaleString('en-IN')}`;

export function compensationSheetText(ctcLpa: number, name: string, designation: string): string {
  const b = ctcBreakup(ctcLpa);
  const rows = Object.keys(BREAKUP_LABEL).map((k) => `${(BREAKUP_LABEL[k] + '                              ').slice(0, 30)}${inr(b.annual[k]).padStart(16)}${inr(b.monthly[k]).padStart(16)}`);
  return [
    `COMPENSATION SHEET - ${name}, ${designation}`, '',
    `${'Component'.padEnd(30)}${'Per year'.padStart(16)}${'Per month'.padStart(16)}`, '-'.repeat(62), ...rows, '-'.repeat(62),
    `${'Total cost to company'.padEnd(30)}${inr(b.total).padStart(16)}${inr(b.total / 12).padStart(16)}`, '',
    'Monthly figures are rounded. Income tax and the employee share of provident fund are deducted from your pay as the law requires. Variable pay, if any, is described in your offer letter.',
  ].join('\n');
}

// ------------------------------------------------------------------ the offer pack

export type PackDoc = 'offerLetter' | 'compensation' | 'checklist' | 'nda' | 'agreement';
export const PACK_DOCS: { key: PackDoc; label: string; editable: boolean }[] = [
  { key: 'offerLetter', label: 'Offer letter', editable: true },
  { key: 'compensation', label: 'Compensation sheet', editable: false },
  { key: 'checklist', label: 'Joining checklist', editable: true },
  { key: 'nda', label: 'Non-disclosure agreement', editable: true },
  { key: 'agreement', label: 'Employment agreement', editable: true },
];

const SIGN = '\n\nYours sincerely,\n\n{{signatory_name}}\n{{signatory_title}}\n{{company_name}}';

export const DEFAULT_PACK_TEMPLATES: Record<Exclude<PackDoc, 'compensation'>, string> = {
  offerLetter: `{{company_name}}\n{{company_address}}\n\nDate: {{date}}\n\nDear {{candidate_name}},\n\nWe are pleased to offer you the position of {{designation}} in the {{department}} department at {{company_name}}, with an annual cost to company of Rs. {{ctc}} (see the attached compensation sheet).\n\nYour proposed date of joining is {{join_date}}, and you will report to {{manager_name}}. Your place of work is {{location}} ({{work_mode}}). You will be on probation for {{probation}}.\n\nThis offer is valid till {{offer_valid_till}}. Please accept it using the link in our email, or sign and return a copy. The offer is subject to satisfactory verification of your documents and references.\n\nWe look forward to welcoming you.${SIGN}`,
  checklist: `JOINING CHECKLIST - {{candidate_name}}, {{designation}}\nJoining date: {{join_date}}\n\nBefore you join, please keep these ready and upload them through the link we will send:\n[ ] Passport-size photograph\n[ ] Aadhaar and PAN\n[ ] Address proof\n[ ] Education certificates (highest qualification)\n[ ] Previous employment relieving / experience letter\n[ ] Last 3 months payslips\n[ ] Cancelled cheque or bank passbook first page\n[ ] Emergency contact details\n[ ] Signed copies of the offer letter, NDA and employment agreement\n\nOn your first day: report to {{manager_name}} at {{location}}. HR will issue your laptop and accounts.`,
  nda: `DRAFT TEMPLATE - HAS NOT BEEN REVIEWED BY A LAWYER. Have your legal advisor review and edit before use.\n\nNON-DISCLOSURE AGREEMENT\n\nThis agreement is made on {{date}} between {{company_name}} ("the Company") and {{candidate_name}} ("the Employee").\n\n1. Confidential information means all non-public business, technical, financial, client and personnel information the Employee learns through employment, in any form.\n2. The Employee will use confidential information only for the Company's work and will not disclose it to anyone outside the Company, during employment and for three years after it ends.\n3. This does not cover information that is public through no fault of the Employee, or that the law requires to be disclosed (with prior notice to the Company where the law allows).\n4. On leaving, the Employee will return or delete all confidential information and company property.\n5. This agreement is governed by the laws of India. Disputes are subject to the courts at the Company's registered office.\n\nSigned for the Company: ____________   Signed by the Employee: ____________`,
  agreement: `DRAFT TEMPLATE - HAS NOT BEEN REVIEWED BY A LAWYER. Have your legal advisor review and edit before use.\n\nEMPLOYMENT AGREEMENT\n\nThis agreement is made on {{date}} between {{company_name}}, {{company_address}} ("the Company") and {{candidate_name}} ("the Employee").\n\n1. Position: {{designation}}, {{department}}, reporting to {{manager_name}}, based at {{location}} ({{work_mode}}). Employment type: {{employment_type}}.\n2. Start date: {{join_date}}. Probation: {{probation}}, after which employment is confirmed in writing, or the probation is extended.\n3. Compensation: annual cost to company of Rs. {{ctc}} as set out in the compensation sheet, paid monthly, subject to statutory deductions.\n4. Duties: the Employee will perform the duties of the role and any reasonable related work, follow the Company's policies as updated from time to time, and devote full working time to the Company.\n5. Notice: either side may end employment by giving notice as stated in the Company's policy, or pay in lieu of notice.\n6. Confidentiality and company property are covered by the separate non-disclosure agreement.\n7. This agreement is governed by the laws of India.\n\nSigned for the Company: ____________   Signed by the Employee: ____________`,
};

export interface PackInput {
  companyName: string; companyAddress: string; candidateName: string; designation: string; department: string; managerName: string; location: string;
  workMode: string; employmentType: string; joinDate: string; validTill: string; probationMonths: number; ctcLpa: number; signatoryName: string; signatoryTitle: string; today: string;
}

export function packValues(i: PackInput): Record<string, string> {
  return {
    date: prettyDate(i.today), company_name: i.companyName, company_address: i.companyAddress, candidate_name: i.candidateName, designation: i.designation,
    department: i.department, manager_name: i.managerName, location: i.location, work_mode: i.workMode, employment_type: i.employmentType,
    join_date: prettyDate(i.joinDate), offer_valid_till: prettyDate(i.validTill), probation: `${i.probationMonths} month${i.probationMonths === 1 ? '' : 's'}`,
    ctc: Math.round(i.ctcLpa * 100000).toLocaleString('en-IN'), signatory_name: i.signatoryName, signatory_title: i.signatoryTitle,
  };
}

/** Renders the five documents. `missing` lists merge fields that had no value, so HR fills them before sending. */
export function buildPack(i: PackInput, templates: Partial<Record<Exclude<PackDoc, 'compensation'>, string>> = {}): { pack: Record<PackDoc, string>; missing: string[] } {
  const values = packValues(i);
  const missing = new Set<string>();
  const render = (key: Exclude<PackDoc, 'compensation'>) => {
    const r = renderTemplate(templates[key]?.trim() ? templates[key]! : DEFAULT_PACK_TEMPLATES[key], values);
    r.missing.forEach((m) => missing.add(m));
    return r.text;
  };
  return {
    pack: { offerLetter: render('offerLetter'), compensation: compensationSheetText(i.ctcLpa, i.candidateName, i.designation), checklist: render('checklist'), nda: render('nda'), agreement: render('agreement') },
    missing: [...missing],
  };
}

// ------------------------------------------------------------------ dates and reminders

const DAY = 86_400_000;
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const addDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const GHOST_AFTER_DAYS = 7;

export type ReminderType = 'expire' | 'ghost' | 'respond' | 'joining_7' | 'joining_1' | 'joining_overdue';
export interface DueReminder { type: ReminderType; key: string }

/**
 * What to do today for one offer. Each reminder has a key that is saved after it is sent, so the daily job never repeats one.
 *  - waiting for an answer: remind every 2 days; mark ghosted after 7 days of silence; mark expired once the offer is past its date
 *  - accepted: remind the candidate 7 days and 1 day before joining; tell HR when the joining date has passed and nobody marked it
 */
export function dueReminders(o: { status: OfferStatus; sentAt?: string; validTill?: string; joiningDate?: string; remindersSent?: string[] }, today: string): DueReminder[] {
  const sent = new Set(o.remindersSent || []);
  const out: DueReminder[] = [];
  const add = (type: ReminderType, key: string) => { if (!sent.has(key)) out.push({ type, key }); };
  if (o.status === 'SENT' || o.status === 'NEGOTIATION') {
    const since = o.sentAt ? dayDiff(o.sentAt.slice(0, 10), today) : 0;
    if (o.validTill && isDay(o.validTill) && today > o.validTill) { add('expire', 'expire'); return out; }
    if (o.status === 'SENT' && since >= GHOST_AFTER_DAYS) { add('ghost', 'ghost'); return out; }
    if (o.status === 'SENT' && since >= 2 && since % 2 === 0) add('respond', `respond:${today}`);
  }
  if (o.status === 'ACCEPTED' && o.joiningDate && isDay(o.joiningDate)) {
    const left = dayDiff(today, o.joiningDate);
    if (left === 7) add('joining_7', 'joining_7');
    if (left === 1) add('joining_1', 'joining_1');
    if (left < 0) add('joining_overdue', `joining_overdue:${today}`);
  }
  return out;
}

// ------------------------------------------------------------------ hiring costs

export const COST_CATEGORIES = ['JOB_BOARD', 'ADS', 'AGENCY_FEE', 'REFERRAL_BONUS', 'ASSESSMENT', 'TRAVEL', 'OTHER'] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];
export const COST_LABEL: Record<CostCategory, string> = {
  JOB_BOARD: 'Job board', ADS: 'Advertising', AGENCY_FEE: 'Agency fee', REFERRAL_BONUS: 'Referral bonus', ASSESSMENT: 'Assessment tool', TRAVEL: 'Candidate travel', OTHER: 'Other',
};
