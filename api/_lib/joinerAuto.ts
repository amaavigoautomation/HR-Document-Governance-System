/**
 * Automatic joining (the "Start joining and onboarding" flow step in "app does it" mode).
 *
 * Once the candidate has accepted and onboarding exists, this runs ONCE per offer and:
 *   1. creates the login and employee record from the offer (or reuses the one with the same email) and emails the invite
 *   2. gives them a salary structure from the approved CTC
 *   3. gives them a leave profile with the joining date (location and policy only when the company has exactly one of each)
 *   4. starts the 30/60/90-day probation reviews from the joining date
 *   5. starts the company's joining checklist
 *   6. gives the IT person and the asset person a task each
 * Every part is best effort and independent: whatever could not be done is written down for HR instead of stopping the rest.
 * The step then finishes when the joining checklist is done or the person punches in on or after the joining date.
 */
import { adminDb } from './firebaseAdmin.js';
import { dispatchLiveEmail } from './serverEmail.js';
import { getItem, putItem, type Item } from './pipelineApi.js';
import { loadPeople, loadSettings, profileId, profileOf } from './leaveCore.js';
import { createJoinerAccount } from './tenantAdmin.js';
import { createStructureFromOffer } from './payrollApi.js';
import { startChecklist } from './lifecycleApi.js';
import { startProbation } from './talentCycleApi.js';

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const str = (v: unknown, max = 300) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim().slice(0, max));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let mailer: (m: { to: string; recipientName?: string; subject: string; body: string; fromName?: string }) => Promise<any> = dispatchLiveEmail as any;
/** Tests replace the mail sender. */
export const __setJoinerMailer = (fn: typeof mailer | null) => { mailer = fn || (dispatchLiveEmail as any); };

async function safeMail(to: string, name: string, subject: string, body: string): Promise<void> {
  if (!EMAIL_RE.test(to || '')) return;
  try { await mailer({ to, recipientName: name, subject, body }); } catch { /* the note already tells HR */ }
}

/** Only one engine may run the setup: whoever flips the flag inside the transaction does the work. */
async function claim(offerId: string): Promise<Item | null> {
  const ref = db().collection('hiringItems').doc(offerId);
  let mine: Item | null = null;
  await db().runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const cur = snap.data() as Item;
    if (cur.joinerSetupAt) return;
    mine = { ...cur, joinerSetupAt: nowIso() };
    tx.set(ref, clean(mine));
  });
  return mine;
}

async function personTask(cid: string, offer: Item, key: 'it' | 'asset', ownerUid: string, people: Awaited<ReturnType<typeof loadPeople>>): Promise<string> {
  const owner = people.find((p) => p.uid === ownerUid && p.active);
  const label = key === 'it' ? 'IT setup' : 'Asset request';
  if (!ownerUid) return `${label}: nobody was chosen in the flow, so no task was created.`;
  if (!owner) return `${label}: the chosen person is no longer an active employee, so no task was created.`;
  const id = `joinertask_${offer.id}_${key}`;
  if (await getItem(cid, id, 'flowTask')) return `${label}: task already exists for ${owner.name}.`;
  const what = key === 'it'
    ? `Set up the official email, Microsoft 365 and attendance for ${offer.candidateName}.`
    : `Arrange the laptop and other assets for ${offer.candidateName}.`;
  const due = offer.joiningDate && offer.joiningDate > nowIso().slice(0, 10) ? offer.joiningDate : nowIso().slice(0, 10);
  await putItem({
    id, companyId: cid, kind: 'flowTask', runId: `joiner_${offer.id}`, applicationId: offer.applicationId, candidateName: offer.candidateName, designation: offer.designation,
    stepId: key, stepType: 'joiner', stepTitle: label, ownerUid: owner.uid, ownerName: owner.name, instruction: `${what} They join on ${offer.joiningDate}.`, question: '',
    decide: false, manualDone: true, link: '', dueOn: due, status: 'OPEN', createdAt: nowIso(),
  });
  await safeMail(owner.email, owner.name, `Task: ${label} for ${offer.candidateName}`, `Hi ${owner.name},\n\n${what}\n\nThey join on ${offer.joiningDate}. Please finish it by then.\nOpen Hiring > My tasks and press "Mark done" when it is finished.\n`);
  return `${label}: task given to ${owner.name}.`;
}

/**
 * Runs the one-time setup for an accepted offer. Returns the notes (empty when it had already run).
 * `settings` are the onboard step's settings (itOwnerUid, assetOwnerUid).
 */
export async function runJoinerSetup(cid: string, offerId: string, settings: Record<string, any>, hrUid: string, origin?: string): Promise<string[]> {
  const offer = await claim(offerId);
  if (!offer) return [];
  const notes: string[] = [];
  const by = 'Automation';
  const joinDate = str(offer.joiningDate, 10);
  let uid = '';
  const people0 = await loadPeople(cid);

  // 1. login and employee record
  try {
    const r = await createJoinerAccount(cid, { name: offer.candidateName, email: offer.email, title: offer.designation }, origin);
    uid = r.uid;
    notes.push(r.created
      ? (r.emailed ? 'Login created and the invitation email was sent.' : r.inviteLink ? `Login created, but the invitation email could not be sent. Share this link with them: ${r.inviteLink}` : `Login created, but no invitation went out (${r.inviteError || 'unknown problem'}). Resend it from Administration > Users.`)
      : 'This person already has a login in your company, so it was reused.');
  } catch (e: any) {
    notes.push(`Login not created: ${e?.message || 'unknown problem'}. Add them in Administration > Users, then start payroll and probation by hand.`);
  }

  if (uid) {
    // 2. payroll
    notes.push((await createStructureFromOffer(cid, uid, Number(offer.approvedCtcLpa), by)).note);

    // 3. leave profile
    try {
      const { settings: ls, configured } = await loadSettings(cid);
      const prev = await profileOf(cid, uid);
      const next: any = { ...(prev || {}), uid, companyId: cid, joinDate: prev?.joinDate || joinDate, updatedAt: nowIso() };
      const single = configured && ls.locations.length === 1 && ls.policies.length === 1;
      if (single) { next.locationId = prev?.locationId || ls.locations[0].id; next.policyId = prev?.policyId || ls.policies[0].id; }
      await db().collection('leaveProfiles').doc(profileId(cid, uid)).set(clean(next));
      notes.push(single ? 'Leave profile created with the joining date, location and policy.' : 'Leave profile created with the joining date. Choose their location and leave policy in Leave > People.');
    } catch (e: any) {
      notes.push(`Leave profile not created: ${e?.message || 'unknown problem'}.`);
    }

    // 4. probation
    const months = Number(offer.probationMonths ?? 0);
    if (months >= 1 && months <= 12) {
      try {
        const pr = await startProbation(cid, uid, { joinDate, months, by });
        notes.push(pr.status === 200 ? `Probation reviews scheduled from ${joinDate} (${months} months).` : pr.status === 409 ? 'Probation was already running.' : `Probation not started: ${pr.json?.error || 'unknown reason'}.`);
      } catch (e: any) { notes.push(`Probation not started: ${e?.message || 'unknown problem'}.`); }
    } else notes.push('No probation on this offer.');

    // 5. joining checklist
    try {
      const c = await startChecklist(cid, uid, { joinDate });
      notes.push(c.created ? `Joining checklist started (${c.created} tasks).` : 'Joining checklist already existed.');
    } catch (e: any) { notes.push(`Joining checklist not started: ${e?.message || 'unknown problem'}.`); }
  }

  // 6. IT and asset tasks
  const people = uid ? await loadPeople(cid) : people0;
  notes.push(await personTask(cid, offer, 'it', str(settings.itOwnerUid, 128), people));
  notes.push(await personTask(cid, offer, 'asset', str(settings.assetOwnerUid, 128), people));

  await putItem({ ...offer, joinerSetupAt: offer.joinerSetupAt, joinerUid: uid, joinerNotes: notes });
  const hr = people.find((p) => p.uid === hrUid);
  if (hr) await safeMail(hr.email, hr.name, `${offer.candidateName} is joining: what the app set up`, `Hi ${hr.name},\n\n${offer.candidateName} accepted the offer and joins on ${joinDate}. Here is what was done automatically:\n\n${notes.map((n) => `- ${n}`).join('\n')}\n`);
  return notes;
}

/** True once the person has finished the joining checklist or punched in on or after the joining date. */
export async function joinerHasJoined(cid: string, offer: Item): Promise<{ joined: boolean; why: string }> {
  const uid = str(offer.joinerUid, 128);
  if (!uid) return { joined: false, why: '' };
  const tasks = await db().collection('lifecycleTasks').where('companyId', '==', cid).where('uid', '==', uid).get();
  const list = tasks.docs.map((d: any) => d.data());
  if (list.length && list.every((t: any) => t.status === 'DONE' || t.status === 'SKIPPED')) return { joined: true, why: 'The joining checklist is finished.' };
  const join = str(offer.joiningDate, 10);
  if (join) {
    const att = await db().collection('leaveAttendance').where('companyId', '==', cid).where('uid', '==', uid).get();
    const punch = att.docs.map((d: any) => d.data()).find((r: any) => r.checkIn && String(r.date) >= join);
    if (punch) return { joined: true, why: `${offer.candidateName} punched in on ${punch.date}.` };
  }
  return { joined: false, why: '' };
}
