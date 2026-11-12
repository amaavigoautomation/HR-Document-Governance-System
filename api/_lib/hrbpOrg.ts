/**
 * HR Business Partner: keeping the people mapping (HRBP-001) in step with what happens to a person.
 *
 * Other modules call these when someone joins, is confirmed or starts an exit. They never throw: the event that
 * triggered them (a confirmation, an onboarding) must not fail because the mapping could not be updated.
 *
 * A "draft" mapping is one the system made for HR to complete: it has the person's manager and employment status,
 * but no business unit, cost centre or HRBP yet. Saving the mapping in People mapping clears the draft flag.
 */
import { adminDb } from './firebaseAdmin.js';
import { loadPeople, loadProfiles } from './leaveCore.js';

type Status = 'PROBATION' | 'CONFIRMED' | 'NOTICE' | 'CONTRACT';

const db = () => adminDb();
const nowIso = () => new Date().toISOString();
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

async function mappingOf(cid: string, uid: string): Promise<Record<string, any> | null> {
  const s = await db().collection('hrbpItems').where('companyId', '==', cid).where('kind', '==', 'mapping').get();
  return s.docs.map((d: any) => d.data()).find((m: any) => m.employeeUid === uid) || null;
}

/** Makes a draft mapping for this person when they have none. Returns true when one was created. */
export async function ensureDraftMapping(cid: string, uid: string, status: Status): Promise<boolean> {
  try {
    if (await mappingOf(cid, uid)) return false;
    const [people, profiles] = await Promise.all([loadPeople(cid), loadProfiles(cid)]);
    const p = people.find((x) => x.uid === uid);
    if (!p || !p.active) return false;
    const id = db().collection('hrbpItems').doc().id;
    await db().collection('hrbpItems').doc(id).set(clean({
      id, companyId: cid, kind: 'mapping', employeeUid: p.uid, employeeName: p.name, businessUnit: '', costCentre: '', clientAllocation: [], billable: false,
      hrbpUid: '', hrbpName: '', employmentStatus: status, managerUid: profiles.get(uid)?.managerUid || '', notes: '', draft: true, autoCreated: true,
      createdAt: nowIso(), createdBy: 'System', updatedAt: nowIso(), updatedBy: 'System',
    }));
    return true;
  } catch (err) {
    console.error('[HRBP] could not create a draft mapping:', err);
    return false;
  }
}

/** Sets the employment status on the person's mapping, when they have one. */
export async function setMappingStatus(cid: string, uid: string, status: Status): Promise<void> {
  try {
    const m = await mappingOf(cid, uid);
    if (m && m.employmentStatus !== status) await db().collection('hrbpItems').doc(m.id).set(clean({ ...m, employmentStatus: status, updatedAt: nowIso(), updatedBy: 'System' }));
  } catch (err) {
    console.error('[HRBP] could not update the mapping status:', err);
  }
}
