/**
 * Hiring Flow: pure rules shared by the browser and the API (no I/O).
 *
 * A company's flow is a list of steps that every new applicant walks through, from "applicant received" to "joined" or
 * "rejected". Everything before the job is posted stays fixed in the app; the flow starts when an applicant arrives.
 *
 *  - the step catalogue, with plain-language names and the settings each step asks for
 *  - validateFlow: every problem in words a non-technical person understands (the flow cannot be published until there are none)
 *  - where an applicant goes next (forward only: there are no loops, so an applicant can never go round in circles)
 *  - simulate: "try it out" with a pretend applicant, which sends nothing and changes nothing
 *  - the standard flow, which reproduces how hiring works today
 */

export type StepType = 'ai_score' | 'screen' | 'test' | 'interview' | 'review' | 'condition' | 'approval' | 'offer' | 'wait' | 'email' | 'onboard' | 'reject';

export const MAX_INTERVIEW_ROUNDS = 5;
export const MAX_STEPS = 40;
export const MAX_WAIT_DAYS = 60;

export interface FlowStep {
  id: string;
  type: StepType;
  title: string;
  /** Person who must act on this step (user id). Required for steps a person does. */
  ownerUid?: string;
  ownerName?: string;
  /** Days the owner has before the task is shown as late. */
  deadlineDays?: number;
  settings: Record<string, any>;
  /** What happens when the step does not work out: 'reject' (default), 'hold' (stop and let HR decide) or a later step's id. */
  onFail?: string;
  /** Condition steps only: where to go when the answer is yes / no. 'next' or a later step's id. */
  ifYes?: string;
  ifNo?: string;
}

export interface FlowDoc {
  id: string;
  companyId: string;
  kind: 'flow';
  name: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  steps: FlowStep[];
  /** For drafts: the version this draft was copied from (0 = started from scratch). */
  basedOn?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  activatedAt?: string;
  activatedBy?: string;
}

// ------------------------------------------------------------------ catalogue

export interface SettingField {
  key: string;
  label: string;
  kind: 'text' | 'longtext' | 'number' | 'select' | 'bool';
  options?: { value: string; label: string }[];
  hint?: string;
  required?: boolean;
  min?: number;
  max?: number;
}

export interface StepInfo {
  type: StepType;
  label: string;
  /** One sentence for the picker: what happens at this step. */
  does: string;
  icon: string;
  /** A person acts on this step. */
  manual: boolean;
  /** Can end badly (so "if it doesn't work out" is asked). */
  canFail: boolean;
  fields: SettingField[];
  defaults: { title: string; settings: Record<string, any>; deadlineDays?: number };
  group: 'Check the candidate' | 'Decide' | 'Talk to the candidate' | 'Finish';
}

export const PLACEHOLDERS = ['name', 'position', 'company', 'hrName'] as const;
export const PLACEHOLDER_HELP: Record<string, string> = {
  name: 'the candidate\'s name', position: 'the job they applied for', company: 'your company name', hrName: 'the HR person\'s name',
};

export const CONDITION_FIELDS: { value: string; label: string; kind: 'number' | 'outcome'; hint: string }[] = [
  { value: 'aiScore', label: 'Resume score (out of 100)', kind: 'number', hint: 'The automatic score from the Scoring tab.' },
  { value: 'experienceYears', label: 'Years of experience', kind: 'number', hint: 'From the application or the resume.' },
  { value: 'expectedCtcLpa', label: 'Expected salary (lakhs per year)', kind: 'number', hint: 'What the candidate asked for.' },
  { value: 'interviewAverage', label: 'Interview score (out of 5)', kind: 'number', hint: 'Average of the latest finished interview.' },
  { value: 'screeningOutcome', label: 'Phone screening result', kind: 'outcome', hint: 'Passed, On hold or Failed.' },
];
export const CONDITION_OPS: { value: string; label: string }[] = [
  { value: '>=', label: 'is at least' }, { value: '<=', label: 'is at most' }, { value: '=', label: 'is' }, { value: '!=', label: 'is not' },
];
export const UNKNOWN_CHOICES: { value: 'ask' | 'yes' | 'no'; label: string }[] = [
  { value: 'ask', label: 'Stop and let HR decide' }, { value: 'yes', label: 'Treat it as Yes' }, { value: 'no', label: 'Treat it as No' },
];
export const OUTCOME_WORDS: Record<string, string> = { PASS: 'Passed', HOLD: 'On hold', FAIL: 'Failed' };

const TITLE = (t: string) => ({ title: t });
export const STEP_INFO: Record<StepType, StepInfo> = {
  ai_score: {
    type: 'ai_score', label: 'Score the resume automatically', does: 'The app reads the application and gives a score out of 100. Nobody has to do anything.', icon: '🤖', manual: false, canFail: false, group: 'Check the candidate',
    fields: [], defaults: { ...TITLE('Score the resume'), settings: {} },
  },
  screen: {
    type: 'screen', label: 'Phone screening', does: 'One person calls the candidate and records how it went (Pass, On hold or Fail).', icon: '📞', manual: true, canFail: true, group: 'Check the candidate',
    fields: [{ key: 'instruction', label: 'What should they check on the call?', kind: 'longtext', hint: 'Shown to the person in their task list.' }],
    defaults: { ...TITLE('Phone screening'), settings: { instruction: 'Call the candidate, confirm salary expectation, notice period and interest, then record the result.' }, deadlineDays: 2 },
  },
  test: {
    type: 'test', label: 'Skills test', does: 'The candidate is given a test. The step finishes when someone scores it.', icon: '📝', manual: true, canFail: true, group: 'Check the candidate',
    fields: [{ key: 'instruction', label: 'What should the person do?', kind: 'longtext' }],
    defaults: { ...TITLE('Skills test'), settings: { instruction: 'Send the test, then enter the score when you have marked it.' }, deadlineDays: 5 },
  },
  interview: {
    type: 'interview', label: 'Interview', does: 'An interview is scheduled and the panel gives blind feedback. The step finishes when everyone has submitted.', icon: '🗣️', manual: true, canFail: true, group: 'Check the candidate',
    fields: [
      { key: 'round', label: 'Name of this round', kind: 'text', hint: 'For example "Technical round".', required: true },
      { key: 'minAverage', label: 'Lowest average score that passes (1 to 5)', kind: 'number', min: 1, max: 5, hint: 'Candidates below this are sent down the "does not work out" path.' },
    ],
    defaults: { ...TITLE('Interview'), settings: { round: 'Interview', minAverage: 3 }, deadlineDays: 5 },
  },
  review: {
    type: 'review', label: 'Someone reviews the candidate', does: 'A person looks at the candidate and answers Yes or No.', icon: '👀', manual: true, canFail: true, group: 'Decide',
    fields: [{ key: 'question', label: 'What should they decide?', kind: 'text', required: true, hint: 'For example "Is this candidate worth interviewing?"' }],
    defaults: { ...TITLE('Review the candidate'), settings: { question: 'Should this candidate move forward?' }, deadlineDays: 2 },
  },
  condition: {
    type: 'condition', label: 'Choose a path (If ... then ...)', does: 'The app checks a fact about the candidate and sends them one way or another. Nobody has to do anything.', icon: '🔀', manual: false, canFail: false, group: 'Decide',
    fields: [],
    defaults: { ...TITLE('Check the candidate'), settings: { field: 'aiScore', op: '>=', value: 60, ifUnknown: 'ask' } },
  },
  approval: {
    type: 'approval', label: 'Ask someone to approve', does: 'A named person says Approve or Do not approve (for example the department head).', icon: '✅', manual: true, canFail: true, group: 'Decide',
    fields: [{ key: 'question', label: 'What are they approving?', kind: 'text', required: true }],
    defaults: { ...TITLE('Approval'), settings: { question: 'Do you approve moving this candidate to the next stage?' }, deadlineDays: 2 },
  },
  offer: {
    type: 'offer', label: 'Offer', does: 'HR prepares the offer, the founder approves the salary, the offer is sent and the candidate answers. The step finishes when the candidate accepts.', icon: '💼', manual: true, canFail: true, group: 'Finish',
    fields: [],
    defaults: { ...TITLE('Make the offer'), settings: {}, deadlineDays: 7 },
  },
  wait: {
    type: 'wait', label: 'Wait', does: 'Pause for a number of days, then carry on by itself.', icon: '⏳', manual: false, canFail: false, group: 'Talk to the candidate',
    fields: [{ key: 'days', label: 'How many days?', kind: 'number', min: 1, max: MAX_WAIT_DAYS, required: true }],
    defaults: { ...TITLE('Wait'), settings: { days: 2 } },
  },
  email: {
    type: 'email', label: 'Send an email', does: 'The candidate gets an email. Nobody has to do anything.', icon: '✉️', manual: false, canFail: false, group: 'Talk to the candidate',
    fields: [
      { key: 'subject', label: 'Subject', kind: 'text', required: true },
      { key: 'body', label: 'Message', kind: 'longtext', required: true, hint: 'You can use {{name}}, {{position}}, {{company}} and {{hrName}}.' },
    ],
    defaults: { ...TITLE('Send an email'), settings: { subject: 'Update on your application for {{position}}', body: 'Hi {{name}},\n\nThank you for applying for {{position}} at {{company}}. We will be in touch shortly with the next step.\n\nRegards,\n{{hrName}}' } },
  },
  onboard: {
    type: 'onboard', label: 'Start joining and onboarding', does: 'The joining checklist, IT setup and welcome kit start. The applicant is marked as hired.', icon: '🎉', manual: true, canFail: false, group: 'Finish',
    fields: [],
    defaults: { ...TITLE('Joining and onboarding'), settings: {}, deadlineDays: 3 },
  },
  reject: {
    type: 'reject', label: 'Reject the candidate', does: 'The application is marked Rejected. You choose whether the candidate also gets an email.', icon: '🚫', manual: false, canFail: false, group: 'Finish',
    fields: [
      { key: 'sendEmail', label: 'Send the candidate an email', kind: 'bool' },
      { key: 'subject', label: 'Subject', kind: 'text' },
      { key: 'body', label: 'Message', kind: 'longtext', hint: 'You can use {{name}}, {{position}}, {{company}} and {{hrName}}.' },
    ],
    defaults: { ...TITLE('Reject the candidate'), settings: { sendEmail: false, subject: 'Your application for {{position}}', body: 'Hi {{name}},\n\nThank you for your interest in {{position}} at {{company}}. After careful consideration we will not be taking your application forward.\n\nWe wish you all the best.\n\n{{hrName}}' } },
  },
};

export const STEP_ORDER: StepType[] = ['ai_score', 'screen', 'test', 'interview', 'review', 'condition', 'approval', 'email', 'wait', 'offer', 'onboard', 'reject'];
export const stepInfo = (t: string): StepInfo | null => (STEP_INFO as Record<string, StepInfo>)[t] || null;

// ------------------------------------------------------------------ small helpers

export const newStepId = (steps: FlowStep[]): string => {
  let n = steps.length + 1;
  const used = new Set(steps.map((s) => s.id));
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
};

export function makeStep(type: StepType, steps: FlowStep[], over: Partial<FlowStep> = {}): FlowStep {
  const info = STEP_INFO[type];
  return {
    id: newStepId(steps), type, title: info.defaults.title, settings: JSON.parse(JSON.stringify(info.defaults.settings)),
    ...(info.defaults.deadlineDays ? { deadlineDays: info.defaults.deadlineDays } : {}),
    ...(info.canFail ? { onFail: 'reject' } : {}),
    ...(type === 'condition' ? { ifYes: 'next', ifNo: 'next' } : {}),
    ...over,
  };
}

export function renderText(tpl: string, vars: Record<string, string>): string {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Placeholder names in a text that the app does not know about. */
export function unknownPlaceholders(text: string): string[] {
  const bad = new Set<string>();
  for (const m of String(text || '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)) if (!(PLACEHOLDERS as readonly string[]).includes(m[1])) bad.add(m[1]);
  // A stray "{{" that never closes will show up in the email as it is.
  if (/\{\{(?![^}]*\}\})/.test(text || '')) bad.add('{{');
  return [...bad];
}

export const stepNumber = (flow: Pick<FlowDoc, 'steps'>, id: string) => flow.steps.findIndex((s) => s.id === id) + 1;

/** How many interview steps come at or before this one (so "Interview 2" is the second interview in the list). */
export const interviewRound = (flow: Pick<FlowDoc, 'steps'>, id: string) => {
  let n = 0;
  for (const s of flow.steps) { if (s.type === 'interview') n++; if (s.id === id) return n; }
  return n;
};

// ------------------------------------------------------------------ routing

export type Target = { to: string } | { end: 'HIRED' | 'REJECTED' | 'HOLD' | 'FELL_OFF' };
export type Result = 'done' | 'fail' | 'yes' | 'no';

/** Where an applicant goes after a step. Forward only. */
export function nextTarget(flow: Pick<FlowDoc, 'steps'>, stepId: string, result: Result): Target {
  const i = flow.steps.findIndex((s) => s.id === stepId);
  if (i < 0) return { end: 'HOLD' };
  const s = flow.steps[i];
  const after = (): Target => (flow.steps[i + 1] ? { to: flow.steps[i + 1].id } : { end: 'FELL_OFF' });
  const jump = (t: string | undefined, dflt: 'next' | 'reject'): Target => {
    const want = t || dflt;
    if (want === 'next') return after();
    if (want === 'reject') {
      const rej = flow.steps.find((x, j) => j > i && x.type === 'reject');
      return rej ? { to: rej.id } : { end: 'REJECTED' };
    }
    if (want === 'hold') return { end: 'HOLD' };
    const j = flow.steps.findIndex((x) => x.id === want);
    return j > i ? { to: flow.steps[j].id } : { end: 'HOLD' };
  };
  if (s.type === 'reject') return { end: 'REJECTED' };
  if (s.type === 'onboard' && result === 'done') return { end: 'HIRED' };
  if (s.type === 'condition') return result === 'yes' ? jump(s.ifYes, 'next') : jump(s.ifNo, 'next');
  if (result === 'fail') return jump(s.onFail, 'reject');
  return after();
}

// ------------------------------------------------------------------ conditions

export interface Facts { aiScore?: number | null; experienceYears?: number | null; expectedCtcLpa?: number | null; interviewAverage?: number | null; screeningOutcome?: string | null }

/** true / false, or null when the fact is not known yet (the applicant then waits and HR is told). */
export function evalCondition(settings: { field?: string; op?: string; value?: any }, facts: Facts): boolean | null {
  const f = CONDITION_FIELDS.find((x) => x.value === settings.field);
  if (!f) return null;
  const have = (facts as any)[f.value];
  if (have === null || have === undefined || have === '') return null;
  if (f.kind === 'outcome') {
    const eq = String(have) === String(settings.value);
    return settings.op === '!=' ? !eq : eq;
  }
  const a = Number(have); const b = Number(settings.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  switch (settings.op) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '=': return a === b;
    case '!=': return a !== b;
    default: return null;
  }
}

export function conditionSentence(s: { field?: string; op?: string; value?: any }): string {
  const f = CONDITION_FIELDS.find((x) => x.value === s.field);
  const op = CONDITION_OPS.find((x) => x.value === s.op);
  if (!f || !op) return 'Pick what to check';
  const val = f.kind === 'outcome' ? OUTCOME_WORDS[String(s.value)] || '...' : String(s.value ?? '...');
  return `${f.label} ${op.label} ${val}`;
}

// ------------------------------------------------------------------ validation

export interface Problem { stepId?: string; message: string }

/** Everything that stops a flow from being published, in plain words. Empty list = ready. */
export function validateFlow(flow: Pick<FlowDoc, 'name' | 'steps'>): Problem[] {
  const out: Problem[] = [];
  const steps = flow.steps || [];
  if (!String(flow.name || '').trim()) out.push({ message: 'Give the flow a name at the top.' });
  if (steps.length === 0) { out.push({ message: 'The flow has no steps yet. Press "Add a step" to start.' }); return out; }
  if (steps.length > MAX_STEPS) out.push({ message: `A flow can have at most ${MAX_STEPS} steps. Remove a few.` });

  const ids = new Set<string>();
  const label = (s: FlowStep, i: number) => `Step ${i + 1} (${s.title || STEP_INFO[s.type]?.label || 'untitled'})`;
  steps.forEach((s, i) => {
    const info = stepInfo(s.type);
    if (!info) { out.push({ stepId: s.id, message: `${label(s, i)} is a kind of step this app does not know. Delete it.` }); return; }
    if (ids.has(s.id)) out.push({ stepId: s.id, message: `${label(s, i)} has the same internal id as another step. Delete it and add it again.` });
    ids.add(s.id);
    if (!String(s.title || '').trim()) out.push({ stepId: s.id, message: `${label(s, i)} needs a name.` });
    if (info.manual && s.type !== 'onboard' && s.type !== 'offer' && !s.ownerUid) out.push({ stepId: s.id, message: `${label(s, i)}: choose the person who does this step.` });
    if ((s.type === 'offer' || s.type === 'onboard') && !s.ownerUid) out.push({ stepId: s.id, message: `${label(s, i)}: choose the person responsible (usually HR).` });
    if (s.deadlineDays !== undefined && (!Number.isFinite(Number(s.deadlineDays)) || Number(s.deadlineDays) < 1 || Number(s.deadlineDays) > 90)) out.push({ stepId: s.id, message: `${label(s, i)}: the time allowed must be between 1 and 90 days.` });
    for (const f of info.fields) {
      const v = s.settings?.[f.key];
      if (f.required && (v === undefined || v === null || String(v).trim() === '')) out.push({ stepId: s.id, message: `${label(s, i)}: fill in "${f.label}".` });
      if (f.kind === 'number' && v !== undefined && v !== '' && v !== null) {
        const n = Number(v);
        if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) out.push({ stepId: s.id, message: `${label(s, i)}: "${f.label}" must be a number from ${f.min ?? 0} to ${f.max ?? 1000}.` });
      }
      if ((f.kind === 'text' || f.kind === 'longtext') && v) {
        const bad = unknownPlaceholders(String(v));
        if (bad.length) out.push({ stepId: s.id, message: `${label(s, i)}: "${bad.map((b) => (b === '{{' ? '{{' : `{{${b}}}`)).join(', ')}" is not something the app can fill in. Use only ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}.` });
      }
    }
    if (s.type === 'reject' && s.settings?.sendEmail && (!String(s.settings.subject || '').trim() || !String(s.settings.body || '').trim())) out.push({ stepId: s.id, message: `${label(s, i)}: you chose to send an email, so write its subject and message.` });
    if (s.type === 'condition') {
      const f = CONDITION_FIELDS.find((x) => x.value === s.settings?.field);
      if (!f) out.push({ stepId: s.id, message: `${label(s, i)}: choose what to check.` });
      else if (!CONDITION_OPS.some((o) => o.value === s.settings?.op)) out.push({ stepId: s.id, message: `${label(s, i)}: choose how to compare.` });
      else if (f.kind === 'outcome' ? !OUTCOME_WORDS[String(s.settings?.value)] : !Number.isFinite(Number(s.settings?.value)) || s.settings?.value === '' || s.settings?.value === null) out.push({ stepId: s.id, message: `${label(s, i)}: type the value to compare with.` });
      if (i === steps.length - 1) out.push({ stepId: s.id, message: `${label(s, i)}: a choice cannot be the last step. Add what happens after it.` });
    }
    const checkTarget = (t: string | undefined, what: string) => {
      if (!t || t === 'next' || t === 'reject' || t === 'hold') return;
      const j = steps.findIndex((x) => x.id === t);
      if (j < 0) out.push({ stepId: s.id, message: `${label(s, i)}: ${what} points to a step that no longer exists. Pick another.` });
      else if (j <= i) out.push({ stepId: s.id, message: `${label(s, i)}: ${what} goes back to an earlier step. Steps can only go forward.` });
    };
    if (info.canFail) checkTarget(s.onFail, 'the "if it does not work out" choice');
    if (s.type === 'condition') { checkTarget(s.ifYes, 'the "yes" path'); checkTarget(s.ifNo, 'the "no" path'); }
  });

  const rounds = steps.filter((s) => s.type === 'interview').length;
  if (rounds > MAX_INTERVIEW_ROUNDS) out.push({ message: `You have ${rounds} interview steps. The most allowed is ${MAX_INTERVIEW_ROUNDS}.` });

  const lastIdx = steps.length - 1;
  const last = steps[lastIdx];
  if (last && last.type !== 'onboard' && last.type !== 'reject') out.push({ stepId: last.id, message: `The last step must be "Start joining and onboarding" or "Reject the candidate", so every applicant ends up somewhere. Add one at the end.` });

  const offerIdx = steps.findIndex((s) => s.type === 'offer');
  const onbIdx = steps.findIndex((s) => s.type === 'onboard');
  if (onbIdx >= 0 && offerIdx < 0) out.push({ stepId: steps[onbIdx].id, message: 'There is no Offer step before joining. Add an Offer step so the candidate has accepted before onboarding starts.' });
  if (onbIdx >= 0 && offerIdx > onbIdx) out.push({ stepId: steps[offerIdx].id, message: 'The Offer step comes after joining. Move it before "Start joining and onboarding".' });
  if (steps.filter((s) => s.type === 'offer').length > 1) out.push({ stepId: steps[steps.findIndex((s, i) => s.type === 'offer' && i > offerIdx)].id, message: 'Only one Offer step is allowed.' });
  if (steps.filter((s) => s.type === 'onboard').length > 1) out.push({ message: 'Only one "Start joining and onboarding" step is allowed.' });
  if (offerIdx < 0 && onbIdx < 0) out.push({ message: 'Nobody can ever be hired with this flow. Add an Offer step and a "Start joining and onboarding" step.' });

  // Steps nobody can reach (because a path jumps over them).
  const reach = reachable(steps);
  steps.forEach((s, i) => { if (!reach.has(s.id) && stepInfo(s.type)) out.push({ stepId: s.id, message: `Step ${i + 1} (${s.title}) can never be reached because a choice above jumps over it. Change the jump or delete the step.` }); });
  return out;
}

export function reachable(steps: FlowStep[]): Set<string> {
  const seen = new Set<string>();
  const stack = steps.length ? [steps[0].id] : [];
  const flow = { steps };
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = steps.find((x) => x.id === id);
    if (!s) continue;
    const results: Result[] = s.type === 'condition' ? ['yes', 'no'] : stepInfo(s.type)?.canFail ? ['done', 'fail'] : ['done'];
    for (const r of results) { const t = nextTarget(flow, id, r); if ('to' in t) stack.push(t.to); }
  }
  return seen;
}

// ------------------------------------------------------------------ the one-sentence summary of a step

export function stepSentence(s: FlowStep, flow: Pick<FlowDoc, 'steps'>): string {
  const who = s.ownerName || 'Someone';
  const fail = () => (s.onFail === 'hold' ? 'If it does not work out, the applicant waits for HR to decide.' : s.onFail && s.onFail !== 'reject' ? `If it does not work out, the applicant skips to step ${stepNumber(flow, s.onFail)}.` : 'If it does not work out, the applicant is rejected.');
  switch (s.type) {
    case 'ai_score': return 'The app scores the resume out of 100.';
    case 'screen': return `${who} phones the candidate and records Pass, On hold or Fail. ${fail()}`;
    case 'test': return `${who} sends a test and enters the score. ${fail()}`;
    case 'interview': return `${s.settings?.round || 'Interview'}: ${who} arranges it and the panel scores the candidate. An average below ${s.settings?.minAverage ?? 3} out of 5 does not pass. ${fail()}`;
    case 'review': return `${who} answers Yes or No: "${s.settings?.question || '...'}". ${fail()}`;
    case 'approval': return `${who} approves or does not approve: "${s.settings?.question || '...'}". ${fail()}`;
    case 'condition': {
      const t = (x?: string) => (!x || x === 'next' ? 'carries on to the next step' : x === 'reject' ? 'is rejected' : x === 'hold' ? 'waits for HR' : `skips to step ${stepNumber(flow, x)}`);
      return `If ${conditionSentence(s.settings)}: yes, the applicant ${t(s.ifYes)}; no, the applicant ${t(s.ifNo)}.`;
    }
    case 'offer': return `${who} makes the offer. The step is done when the candidate accepts. ${fail()}`;
    case 'wait': return `Wait ${s.settings?.days ?? '?'} day(s), then carry on.`;
    case 'email': return `Email the candidate: "${s.settings?.subject || '...'}".`;
    case 'onboard': return `${who} starts the joining checklist. The applicant is marked as hired.`;
    case 'reject': return s.settings?.sendEmail ? 'Mark the applicant Rejected and send them an email.' : 'Mark the applicant Rejected (no email is sent).';
    default: return '';
  }
}

// ------------------------------------------------------------------ try it out

export interface SimLine { stepId: string; text: string; ask?: { options: { value: Result; label: string }[] } }
export interface SimOutput { lines: SimLine[]; ended: string | null; waitingOn: string | null }

export const SAMPLE_VARS: Record<string, string> = { name: 'Sample Candidate', position: 'Sample Position', company: 'Your Company', hrName: 'Your HR' };

/** Walks a pretend applicant through the flow using the answers given so far. Sends nothing, stores nothing. */
export function simulate(flow: Pick<FlowDoc, 'steps'>, answers: Record<string, Result>): SimOutput {
  const lines: SimLine[] = [];
  let cur: string | null = flow.steps[0]?.id || null;
  let guard = 0;
  while (cur && guard++ < 100) {
    const s = flow.steps.find((x) => x.id === cur)!;
    const n = stepNumber(flow, s.id);
    const info = STEP_INFO[s.type];
    let result: Result | null = null;
    if (s.type === 'condition') {
      const a = answers[s.id];
      lines.push({ stepId: s.id, text: `Step ${n}: ${s.title}. The app checks: ${conditionSentence(s.settings)}.`, ask: a ? undefined : { options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] } });
      if (!a) return { lines, ended: null, waitingOn: s.id };
      result = a;
    } else if (info?.canFail) {
      const a = answers[s.id];
      lines.push({ stepId: s.id, text: `Step ${n}: ${s.title}. ${stepSentence(s, flow).split(' If it does not')[0]}`, ask: a ? undefined : { options: [{ value: 'done', label: s.type === 'offer' ? 'Candidate accepts' : s.type === 'interview' || s.type === 'screen' || s.type === 'test' ? 'Passes' : s.type === 'review' || s.type === 'approval' ? 'Yes' : 'Done' }, { value: 'fail', label: s.type === 'offer' ? 'Candidate says no' : s.type === 'interview' || s.type === 'screen' || s.type === 'test' ? 'Does not pass' : 'No' }] } });
      if (!a) return { lines, ended: null, waitingOn: s.id };
      result = a === 'yes' ? 'done' : a === 'no' ? 'fail' : a;
    } else {
      let text = `Step ${n}: ${s.title}. ${stepSentence(s, flow)}`;
      if (s.type === 'email') text += ` The email would say: "${renderText(String(s.settings?.body || ''), SAMPLE_VARS).slice(0, 160)}"`;
      if (s.type === 'reject' && s.settings?.sendEmail) text += ` The email would say: "${renderText(String(s.settings?.body || ''), SAMPLE_VARS).slice(0, 160)}"`;
      lines.push({ stepId: s.id, text });
      result = 'done';
    }
    const t = nextTarget(flow, s.id, result);
    if ('end' in t) {
      const word = t.end === 'HIRED' ? 'The applicant is hired and joining begins.' : t.end === 'REJECTED' ? 'The applicant is rejected.' : t.end === 'HOLD' ? 'The applicant waits here for HR to decide.' : 'The flow ends without a final step. Fix this before publishing.';
      lines.push({ stepId: s.id, text: `End: ${word}` });
      return { lines, ended: t.end, waitingOn: null };
    }
    cur = t.to;
  }
  return { lines, ended: null, waitingOn: null };
}

// ------------------------------------------------------------------ the standard flow

/** Reproduces how hiring works without a custom flow: score, phone screen, interview, offer, joining. */
export function standardSteps(hrUid = '', hrName = ''): FlowStep[] {
  const out: FlowStep[] = [];
  const add = (type: StepType, over: Partial<FlowStep> = {}) => { out.push(makeStep(type, out, over)); };
  const owner = hrUid ? { ownerUid: hrUid, ownerName: hrName } : {};
  add('ai_score');
  add('screen', owner);
  add('interview', { ...owner, settings: { round: 'Interview', minAverage: 3 } });
  add('offer', owner);
  add('onboard', owner);
  return out;
}

/** Plain-language state of an applicant for the monitor. */
export const RUN_STATUS_WORDS: Record<string, string> = {
  RUNNING: 'Moving along', WAITING: 'Waiting for someone', STUCK: 'Needs HR attention', HIRED: 'Hired', REJECTED: 'Rejected', STOPPED: 'Stopped by HR',
};
