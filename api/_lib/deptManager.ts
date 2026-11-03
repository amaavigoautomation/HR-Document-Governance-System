/**
 * Department head = default manager.
 *
 * A person who belongs to a department reports to that department's head, unless someone has picked a manager for them by hand.
 * A hand-picked manager (leaveProfiles.managerManual === true) is never touched here. Profiles written before this rule existed
 * have a manager but no flag: those were picked by hand, so they count as manual too. Only a profile this file wrote carries an
 * explicit `managerManual: false`.
 */
import { adminDb } from './firebaseAdmin.js';
import { loadProfiles, profileId, type Profile } from './leaveCore.js';
import { wouldCycle } from '../../shared/lifecycleEngine.js';

export const isManualManager = (p?: Profile): boolean => !!p && (p.managerManual === true || (p.managerManual === undefined && !!p.managerUid));

interface Scope {
  /** Everyone in this department. */
  departmentId?: string;
  /** These people only. */
  uids?: string[];
  /** Everyone in the company. */
  all?: boolean;
  /** People whose hand-picked manager is dropped, so the department head applies again. */
  resetManual?: string[];
}

/** Brings managers in line with department heads for the people in `scope`. Returns how many people changed. */
export async function syncDepartmentManagers(companyId: string, scope: Scope): Promise<number> {
  const db = adminDb();
  const [deptSnap, empSnap, profiles] = await Promise.all([
    db.collection('departments').where('companyId', '==', companyId).get(),
    db.collection('employees').where('companyId', '==', companyId).get(),
    loadProfiles(companyId),
  ]);
  const heads = new Map<string, string>(); // departmentId -> head's employee doc id
  deptSnap.docs.forEach((d: any) => heads.set(d.id, String(d.data().headUserId || '')));
  const people = empSnap.docs.map((d: any) => {
    const x = d.data() as any;
    return { docId: d.id, uid: String(x.authUid || d.id), departmentId: String(x.departmentId || ''), active: x.active !== false };
  });
  const uidOfDoc = new Map(people.map((p) => [p.docId, p]));
  const reset = new Set(scope.resetManual || []);
  const wanted = new Set(scope.uids || []);

  const org = people.map((p) => ({ uid: p.uid, name: p.uid, managerUid: profiles.get(p.uid)?.managerUid || '' }));
  const mgrOf = new Map(org.map((o) => [o.uid, o.managerUid]));
  const setOrg = (uid: string, mgr: string) => { mgrOf.set(uid, mgr); const o = org.find((x) => x.uid === uid); if (o) o.managerUid = mgr; };

  const write = async (uid: string, managerUid: string) => {
    const prev: any = profiles.get(uid) || { uid };
    const next: any = { ...prev, uid, companyId, managerUid, managerManual: false, updatedAt: new Date().toISOString() };
    await db.collection('leaveProfiles').doc(profileId(companyId, uid)).set(next);
    profiles.set(uid, next);
    setOrg(uid, managerUid);
  };

  let changed = 0;
  for (const p of people) {
    if (!p.active || !p.departmentId) continue;
    if (!scope.all && p.departmentId !== scope.departmentId && !wanted.has(p.uid)) continue;
    if (!reset.has(p.uid) && isManualManager(profiles.get(p.uid))) continue;

    const head = uidOfDoc.get(heads.get(p.departmentId) || '');
    const headUid = head && head.active ? head.uid : '';
    if (headUid === p.uid) continue; // the head keeps whatever reporting line they have
    const current = mgrOf.get(p.uid) || '';

    let desired = headUid;
    if (desired && wouldCycle(org, p.uid, desired)) {
      // The head currently reports (directly or not) to this person, for example the previous head. An automatic line is dropped to break the loop.
      const headProfile = profiles.get(desired);
      if (!isManualManager(headProfile) && (mgrOf.get(desired) || '')) { await write(desired, ''); changed++; }
      if (wouldCycle(org, p.uid, desired)) desired = '';
    }
    const settled = profiles.get(p.uid)?.managerManual === false || (!profiles.has(p.uid) && !desired);
    if (current === desired && settled) continue; // already right
    await write(p.uid, desired);
    changed++;
  }
  return changed;
}

/** Best effort: the change that triggered it has already been saved. */
export async function syncDepartmentManagersQuietly(companyId: string, scope: Scope): Promise<void> {
  try { await syncDepartmentManagers(companyId, scope); } catch (e: any) { console.warn('[tenant] could not update managers from department heads:', e?.message || e); }
}
