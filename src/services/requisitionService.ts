import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { auditService } from './audit';
import { defaultEmailProvider } from './email';
import { governanceEngine } from './governance';
import {
  AuditAction,
  HrLevel,
  Requisition,
  RequisitionAttachment,
  RequisitionDecision,
  RequisitionEvent,
  RequisitionPerson,
  RequisitionUrgency,
  User,
  UserRole,
} from '../types';
import { can, isFounder, isHr } from '../utils/requisitionPermissions';
import { publishToCareers, requisitionToCareersInput } from './careersService';

const REQUISITIONS_COLLECTION = 'requisitions';
const EMPLOYEES_COLLECTION = 'employees';

/** Firestore documents are capped at 1 MiB, so attachments are stored inline only up to this size. */
export const MAX_ATTACHMENT_BYTES = 700 * 1024;

function clean<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(clean) as unknown as T;
  if (typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
      if (v !== undefined) out[k] = clean(v);
    }
    return out;
  }
  return obj;
}

const nowIso = () => new Date().toISOString();

const toPerson = (u: User): RequisitionPerson => ({
  id: u.id,
  name: u.name,
  email: u.email,
  title: u.title,
});

function event(actor: User, action: string, note?: string): RequisitionEvent {
  return { at: nowIso(), action, byId: actor.id, byName: actor.name, note: note?.trim() || undefined };
}

function assertAllowed(allowed: boolean, message: string): void {
  if (!allowed) throw new Error(`Not permitted: ${message}`);
}

async function persist(req: Requisition): Promise<Requisition> {
  const next = { ...req, updatedAt: nowIso() };
  // Surface Firestore errors (e.g. security rules not deployed) to the UI instead of swallowing them.
  await setDoc(doc(db, REQUISITIONS_COLLECTION, next.id), clean(next));
  return next;
}

function audit(action: AuditAction, actor: User, req: Requisition, reason: string, newValue?: string): void {
  auditService.logEvent(action, actor, {
    documentId: req.reqNo,
    documentMasterId: req.id,
    newValue,
    reason,
    source: 'HIRING_REQUISITION',
  });
}

/** Fire-and-forget email; a mail failure must never block a workflow transition. */
function notify(to: RequisitionPerson | undefined, subject: string, body: string, req: Requisition): void {
  if (!to?.email || !to.email.includes('@')) return;
  defaultEmailProvider
    .sendEmail(to.email, to.name, subject, body, {
      documentId: req.reqNo,
      documentTitle: req.positionTitle,
      versionNumber: '1.0',
      documentVersionId: req.id,
      acknowledgementRequired: false,
    })
    .catch((e) => console.warn('[Requisitions] Email notification note:', e));
}

const mail = (greetingName: string, lines: string[]) =>
  `Dear ${greetingName},\n\n${lines.join('\n')}\n\nSincerely,\nAmaavigo HR Hiring Workflow`;

const summaryLine = (r: Requisition) =>
  `${r.reqNo} - ${r.positionTitle} (${r.departmentName}, ${r.vacancies} opening${r.vacancies === 1 ? '' : 's'})`;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function subscribeToRequisitions(callback: (items: Requisition[]) => void): () => void {
  return onSnapshot(
    collection(db, REQUISITIONS_COLLECTION),
    (snap) => {
      const items = snap.docs.map((d) => ({ ...(d.data() as Requisition), id: d.id }));
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      callback(items);
    },
    (error) => {
      console.warn('[Requisitions] Subscription offline/retry note:', error?.message || error);
    }
  );
}

function nextReqNo(existing: Requisition[]): string {
  const year = new Date().getFullYear();
  const re = new RegExp(`^REQ-${year}-(\\d+)$`);
  let max = 0;
  for (const r of existing) {
    const m = r.reqNo?.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `REQ-${year}-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Workflow actions
// ---------------------------------------------------------------------------

export interface NewRequisitionInput {
  positionTitle: string;
  departmentName: string;
  vacancies: number;
  employmentType: Requisition['employmentType'];
  location: string;
  minExperienceYears: number;
  maxExperienceYears: number;
  urgency: RequisitionUrgency;
  expectedJoiningDate?: string;
  budgetRange?: string;
  justification: string;
  keySkills: string;
  /** The department head the request is on behalf of. Defaults to the actor when they are a department head. */
  requestedBy?: User;
}

export async function createRequisition(
  actor: User,
  input: NewRequisitionInput,
  existing: Requisition[]
): Promise<Requisition> {
  assertAllowed(can(actor, 'create'), 'you cannot raise hiring requisitions.');

  if (!input.positionTitle.trim()) throw new Error('Position title is required.');
  if (!input.departmentName.trim()) throw new Error('Department is required.');
  if (!(input.vacancies >= 1)) throw new Error('Number of vacancies must be at least 1.');
  if (!input.justification.trim()) throw new Error('A business justification is required.');
  if (input.maxExperienceYears && input.maxExperienceYears < input.minExperienceYears) {
    throw new Error('Maximum experience cannot be lower than minimum experience.');
  }

  const requester = input.requestedBy || actor;
  const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const onBehalf = requester.id !== actor.id;

  const req: Requisition = {
    id,
    reqNo: nextReqNo(existing),
    positionTitle: input.positionTitle.trim(),
    departmentName: input.departmentName.trim(),
    vacancies: Math.floor(input.vacancies),
    employmentType: input.employmentType,
    location: input.location.trim(),
    minExperienceYears: input.minExperienceYears || 0,
    maxExperienceYears: input.maxExperienceYears || 0,
    urgency: input.urgency,
    expectedJoiningDate: input.expectedJoiningDate || undefined,
    budgetRange: input.budgetRange?.trim() || undefined,
    justification: input.justification.trim(),
    keySkills: input.keySkills.trim(),
    status: 'PENDING_ASSIGNMENT',
    requestedBy: toPerson(requester),
    raisedBy: toPerson(actor),
    events: [
      event(actor, onBehalf ? `Raised on behalf of ${requester.name}` : 'Raised hiring requisition'),
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const saved = await persist(req);
  audit(AuditAction.REQUISITION_CREATED, actor, saved, `Raised ${summaryLine(saved)}${onBehalf ? ` on behalf of ${requester.name}` : ''}`);

  // Tell every Head HR (fall back to the founder if none is configured yet)
  const headHrs = governanceEngine.getUsers().filter((u) => u.active !== false && isHr(u) && u.hrLevel === 'HEAD');
  const founders = governanceEngine.getUsers().filter((u) => u.active !== false && isFounder(u));
  const recipients = headHrs.length ? headHrs : founders;
  for (const r of recipients) {
    notify(
      toPerson(r),
      `[Action Required] New hiring requisition ${saved.reqNo}: ${saved.positionTitle}`,
      mail(r.name, [
        `${requester.name} (${requester.departmentName}) has requested a new hire:`,
        '',
        `- ${summaryLine(saved)}`,
        `- Urgency: ${saved.urgency}`,
        `- Justification: ${saved.justification}`,
        '',
        'Please open Talent Acquisition > Requisitions and assign it to an HR owner.',
      ]),
      saved
    );
  }
  return saved;
}

export async function assignRequisition(actor: User, req: Requisition, hr: User, note?: string): Promise<Requisition> {
  assertAllowed(can(actor, 'assign', req), 'only Head HR (or the founder) can assign a requisition.');
  assertAllowed(isHr(hr) && hr.active !== false, 'the assignee must be an active HR user.');

  const previous = req.ownerHr;
  if (previous?.id === hr.id) throw new Error(`${hr.name} already owns this requisition.`);

  // Reassigning mid-flow keeps the current stage; first assignment moves it to PENDING_HR.
  const status = req.status === 'PENDING_ASSIGNMENT' ? 'PENDING_HR' : req.status;
  const label = previous ? `Reassigned from ${previous.name} to ${hr.name}` : `Assigned to ${hr.name}`;

  const saved = await persist({
    ...req,
    status,
    ownerHr: toPerson(hr),
    assignedById: actor.id,
    assignedByName: actor.name,
    assignedAt: nowIso(),
    events: [...req.events, event(actor, label, note)],
  });
  audit(AuditAction.REQUISITION_ASSIGNED, actor, saved, `${label} (${summaryLine(saved)})`, hr.id);

  notify(
    saved.ownerHr,
    `[Action Required] Hiring requisition ${saved.reqNo} assigned to you`,
    mail(hr.name, [
      `${actor.name} has assigned you ${summaryLine(saved)}.`,
      note ? `Note: ${note}` : '',
      '',
      'You now own every step of this hire: your approval, forwarding to the founder, the job description and the posting.',
    ].filter(Boolean)),
    saved
  );
  if (previous) {
    notify(
      previous,
      `Hiring requisition ${saved.reqNo} reassigned`,
      mail(previous.name, [`${saved.reqNo} (${saved.positionTitle}) was reassigned to ${hr.name} by ${actor.name}.`]),
      saved
    );
  }
  return saved;
}

export function readAttachment(file: File): Promise<RequisitionAttachment> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error(`Attachment is ${(file.size / 1024).toFixed(0)} KB. Please attach a file of ${MAX_ATTACHMENT_BYTES / 1024} KB or less.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the attached file.'));
    reader.onload = () =>
      resolve({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        fileUrl: String(reader.result),
      });
    reader.readAsDataURL(file);
  });
}

export async function hrDecide(
  actor: User,
  req: Requisition,
  payload: { decision: 'APPROVED' | 'REJECTED'; comments: string; attachment?: RequisitionAttachment }
): Promise<Requisition> {
  assertAllowed(can(actor, 'hrDecide', req), 'only the assigned HR can decide at this stage.');

  const comments = payload.comments.trim();
  if (payload.decision === 'REJECTED' && !comments) throw new Error('Please give a reason for rejecting.');
  if (payload.decision === 'APPROVED' && !payload.attachment) {
    throw new Error('Attach a supporting document before forwarding to the founder.');
  }

  const decision: RequisitionDecision = {
    decision: payload.decision,
    byId: actor.id,
    byName: actor.name,
    at: nowIso(),
    comments,
  };

  if (payload.decision === 'REJECTED') {
    const saved = await persist({
      ...req,
      status: 'REJECTED',
      hrDecision: decision,
      events: [...req.events, event(actor, 'HR rejected the requisition', comments)],
    });
    audit(AuditAction.REQUISITION_HR_REJECTED, actor, saved, `HR rejected ${summaryLine(saved)}: ${comments}`);
    notify(
      saved.requestedBy,
      `Hiring requisition ${saved.reqNo} was not approved by HR`,
      mail(saved.requestedBy.name, [`${summaryLine(saved)} was rejected by ${actor.name}.`, `Reason: ${comments}`]),
      saved
    );
    return saved;
  }

  const saved = await persist({
    ...req,
    status: 'PENDING_FOUNDER',
    hrDecision: decision,
    hrAttachment: payload.attachment,
    events: [...req.events, event(actor, 'HR approved and forwarded to founder', comments)],
  });
  audit(AuditAction.REQUISITION_HR_APPROVED, actor, saved, `HR approved ${summaryLine(saved)} and forwarded to founder`);

  const founders = governanceEngine.getUsers().filter((u) => u.active !== false && isFounder(u));
  for (const f of founders) {
    notify(
      toPerson(f),
      `[Action Required] Approval needed for hiring requisition ${saved.reqNo}`,
      mail(f.name, [
        `${actor.name} (HR) has approved and forwarded ${summaryLine(saved)}.`,
        comments ? `HR comments: ${comments}` : '',
        `Supporting document: ${payload.attachment?.fileName}`,
        '',
        'Please open Talent Acquisition > Requisitions to approve or reject.',
      ].filter(Boolean)),
      saved
    );
  }
  return saved;
}

export async function founderDecide(
  actor: User,
  req: Requisition,
  payload: { decision: 'APPROVED' | 'REJECTED'; comments: string }
): Promise<Requisition> {
  assertAllowed(can(actor, 'founderDecide', req), 'only the founder can decide at this stage.');
  const comments = payload.comments.trim();
  if (payload.decision === 'REJECTED' && !comments) throw new Error('Please give a reason for rejecting.');

  const decision: RequisitionDecision = {
    decision: payload.decision,
    byId: actor.id,
    byName: actor.name,
    at: nowIso(),
    comments,
  };
  const approved = payload.decision === 'APPROVED';

  const saved = await persist({
    ...req,
    status: approved ? 'JD_DRAFT' : 'REJECTED',
    founderDecision: decision,
    events: [...req.events, event(actor, approved ? 'Founder approved the requisition' : 'Founder rejected the requisition', comments)],
  });
  audit(
    approved ? AuditAction.REQUISITION_FOUNDER_APPROVED : AuditAction.REQUISITION_FOUNDER_REJECTED,
    actor,
    saved,
    `Founder ${approved ? 'approved' : 'rejected'} ${summaryLine(saved)}${comments ? `: ${comments}` : ''}`
  );

  const subject = approved
    ? `Hiring requisition ${saved.reqNo} approved - prepare the job description`
    : `Hiring requisition ${saved.reqNo} rejected by founder`;
  const lines = approved
    ? [`${actor.name} approved ${summaryLine(saved)}.`, comments ? `Comments: ${comments}` : '', 'You can now generate and publish the job description.']
    : [`${actor.name} rejected ${summaryLine(saved)}.`, `Reason: ${comments}`];
  notify(saved.ownerHr, subject, mail(saved.ownerHr?.name || 'HR', lines.filter(Boolean)), saved);
  notify(saved.requestedBy, subject, mail(saved.requestedBy.name, lines.filter(Boolean)), saved);
  return saved;
}

export async function generateJd(actor: User, req: Requisition): Promise<Requisition> {
  assertAllowed(can(actor, 'editJd', req) && req.status === 'JD_DRAFT', 'only the owning HR can generate the JD while it is in draft.');

  const res = await fetch('/api/requisitions/generate-jd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      positionTitle: req.positionTitle,
      departmentName: req.departmentName,
      employmentType: req.employmentType,
      location: req.location,
      minExperienceYears: req.minExperienceYears,
      maxExperienceYears: req.maxExperienceYears,
      vacancies: req.vacancies,
      keySkills: req.keySkills,
      justification: req.justification,
      companyName: actor.companyName,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `JD generation failed (HTTP ${res.status}).`);
  }

  const saved = await persist({
    ...req,
    jd: { text: data.text, generatedBy: data.generatedBy, updatedAt: nowIso(), updatedByName: actor.name },
    events: [...req.events, event(actor, data.generatedBy === 'AI' ? 'AI generated the job description' : 'Template job description generated', data.note)],
  });
  audit(AuditAction.JD_GENERATED, actor, saved, `Job description generated (${data.generatedBy}) for ${summaryLine(saved)}`);
  return saved;
}

export async function saveJd(actor: User, req: Requisition, text: string): Promise<Requisition> {
  assertAllowed(can(actor, 'editJd', req), 'only the owning HR can edit the JD.');
  if (!text.trim()) throw new Error('The job description cannot be empty.');
  if (text.length > 20000) throw new Error('The job description is too long (limit 20,000 characters).');

  const saved = await persist({
    ...req,
    jd: { text, generatedBy: req.jd?.text === text ? req.jd.generatedBy : 'MANUAL', updatedAt: nowIso(), updatedByName: actor.name },
    events: [...req.events, event(actor, 'Job description edited')],
  });
  audit(AuditAction.JD_UPDATED, actor, saved, `Job description edited for ${summaryLine(saved)}`);
  return saved;
}

export async function publishJob(actor: User, req: Requisition): Promise<Requisition> {
  assertAllowed(can(actor, 'publish', req), 'only the owning HR can publish, and a JD must exist.');

  // Post to the live careers page first. If that fails we throw, the requisition stays in JD_DRAFT
  // and HR can simply retry. An id from an earlier successful post is reused so retries never double-post.
  let careersPostingId = req.careersPostingId;
  if (!careersPostingId) {
    const posted = await publishToCareers(requisitionToCareersInput(req), actor.role);
    if (!posted.success) {
      throw new Error(`Could not publish to the careers page: ${posted.error || 'unknown error'}`);
    }
    careersPostingId = posted.postingId;
  }

  const jobId = `JOB-${req.reqNo.replace(/^REQ-/, '')}`;
  const saved = await persist({
    ...req,
    status: 'JOB_OPEN',
    jobId,
    careersPostingId,
    publishedAt: nowIso(),
    events: [
      ...req.events,
      event(actor, `Published as ${jobId} and posted to the careers page`, careersPostingId ? `Careers opening #${careersPostingId}` : undefined),
    ],
  });
  audit(AuditAction.JOB_PUBLISHED, actor, saved, `Published ${jobId} for ${summaryLine(saved)}`, jobId);
  notify(
    saved.requestedBy,
    `Job opened for ${saved.positionTitle} (${jobId})`,
    mail(saved.requestedBy.name, [`${summaryLine(saved)} is now open for applications as ${jobId}.`]),
    saved
  );
  return saved;
}

export async function closeRequisition(actor: User, req: Requisition, reason: string): Promise<Requisition> {
  assertAllowed(can(actor, 'close', req), 'only the owning HR can close an open job.');
  if (!reason.trim()) throw new Error('Please give a reason for closing.');
  const saved = await persist({
    ...req,
    status: 'CLOSED',
    closedReason: reason.trim(),
    events: [...req.events, event(actor, 'Closed the job', reason)],
  });
  audit(AuditAction.REQUISITION_CLOSED, actor, saved, `Closed ${summaryLine(saved)}: ${reason.trim()}`);
  return saved;
}

// ---------------------------------------------------------------------------
// Role assignment (Head HR / department heads)
// ---------------------------------------------------------------------------

async function patchEmployee(userId: string, patch: Partial<User>): Promise<void> {
  // merge:true keeps every other field; id is included so the security rule's required-field check passes
  await setDoc(doc(db, EMPLOYEES_COLLECTION, userId), clean({ id: userId, ...patch, updatedAt: nowIso() }), { merge: true });
  // Mirror into the in-memory directory so the UI reflects it immediately
  const target = governanceEngine.getUserById(userId);
  if (target) Object.assign(target, patch);
}

export async function setHrLevel(actor: User, target: User, level: HrLevel, allUsers: User[]): Promise<void> {
  // Appointing or removing a Head HR is a founder-level decision
  assertAllowed(isFounder(actor), 'only the founder can appoint or change a Head HR.');
  assertAllowed(isHr(target), 'HR level can only be set on HR users.');

  const wasHead = target.hrLevel === 'HEAD';
  if (wasHead && level !== 'HEAD') {
    const otherHeads = allUsers.filter((u) => isHr(u) && u.hrLevel === 'HEAD' && u.active !== false && u.id !== target.id);
    if (otherHeads.length === 0) throw new Error('There must always be at least one Head HR. Appoint another before demoting.');
  }

  await patchEmployee(target.id, { hrLevel: level });
  auditService.logEvent(AuditAction.ROLE_CHANGED, actor, {
    reason: `${target.name} HR level changed from ${target.hrLevel || 'STANDARD'} to ${level}`,
    newValue: level,
    source: 'HIRING_REQUISITION',
  });
}

export async function setDepartmentHead(actor: User, target: User, isHead: boolean): Promise<void> {
  assertAllowed(can(actor, 'manageRoles'), 'only the founder or Head HR can assign department heads.');
  assertAllowed(target.role === UserRole.EMPLOYEE, 'only employees can be department heads.');

  await patchEmployee(target.id, { isDepartmentHead: isHead });
  auditService.logEvent(AuditAction.ROLE_CHANGED, actor, {
    reason: `${target.name} ${isHead ? 'appointed head of' : 'removed as head of'} ${target.departmentName}`,
    newValue: isHead ? 'DEPARTMENT_HEAD' : 'EMPLOYEE',
    source: 'HIRING_REQUISITION',
  });
}