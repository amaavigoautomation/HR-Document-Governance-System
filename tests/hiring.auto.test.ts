import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { routeFlow, advanceRun, __setMailer, buildJobFlows, flowStartHook, __clearJobFlowCache } from '../api/_lib/flowApi.ts';
import { __setJoinerMailer } from '../api/_lib/joinerAuto.ts';
import { createApplication, normalizeApplicationInput } from '../api/_lib/recruitmentData.ts';
import { listItems, getItem } from '../api/_lib/pipelineApi.ts';
import { BUILDER_START, makeStep, stepSentence, validateFlow, type FlowStep } from '../shared/flowEngine.ts';

delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
const fdb = new FakeFirestore();
const users = new Map<string, any>();
__useFakeAdmin({
  db: fdb,
  auth: {
    verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()),
    getUserByEmail: async (e: string) => { const u = [...users.values()].find((x) => x.email === e); if (!u) throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); return u; },
    createUser: async (p: any) => { const uid = `new_${users.size + 1}`; users.set(uid, { uid, email: p.email, claims: {}, disabled: false }); return { uid }; },
    getUser: async (uid: string) => ({ uid, disabled: false, customClaims: users.get(uid)?.claims || {} }),
    setCustomUserClaims: async (uid: string, c: any) => { users.get(uid).claims = c; },
    updateUser: async () => undefined,
    deleteUser: async (uid: string) => { users.delete(uid); },
    generatePasswordResetLink: async () => 'https://hr.test/reset?x=1',
  },
});
const flowMail: any[] = []; const joinMail: any[] = [];
__setMailer(async (p) => { flowMail.push(p); return { ok: true }; });
__setJoinerMailer(async (p) => { joinMail.push(p); return { success: true }; });

const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) => ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['app.manage']); const FOUNDER = tok('u_f', ['req.founder_decide']);
const hire = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHiring({ method, action, headers: h, body, query, origin: 'https://hr.test' }) as Promise<any>;
const flow = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeFlow({ method, action, headers: h, body, query }) as Promise<any>;
const day = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);
const okc = (r: any, m = '') => assert.equal(r.status, 200, `${m} ${JSON.stringify(r.json)}`);

for (const [id, name] of [['u_hr', 'Hana HR'], ['u_f', 'Fay Founder'], ['u_it', 'Ian IT'], ['u_asset', 'Ava Assets']]) fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, title: 'Staff' });
fdb.seed('companies', CID, { id: CID, name: 'Acme', status: 'ACTIVE', modules: [], adminEmail: 'boss@acme.com', employeeIdPrefix: 'AC', nextEmployeeNumber: 9 });
fdb.seed('roles', 'c1_employee', { id: 'c1_employee', companyId: CID, name: 'employee', permissions: [], portal: 'EMPLOYEE', isAdmin: false });
fdb.seed('requisitions', 'rq1', { id: 'rq1', companyId: CID, positionTitle: 'Designer', departmentName: 'Design', status: 'JOB_OPEN', ctcMaxLpa: 10, positionId: 'POS-1', location: 'Mumbai', workMode: 'Hybrid', employmentType: 'Full-time', reportingManager: { id: 'm1', name: 'Mona Manager', email: 'm@acme.com' } });

const newApp = async (name: string, ctc: number | null, requisitionId: string | null = 'rq1') => {
  const { value } = normalizeApplicationInput({ name, email: `${name.toLowerCase()}@mail.com`, designation: 'Designer', experience: '3 years' });
  const r = await createApplication(CID, { ...value!, ...(ctc !== null ? { expectedCtcLpa: ctc } : {}), ...(requisitionId ? { requisitionId } : {}) } as any, 'MANUAL');
  return r.id as string;
};
const offerOf = async (appId: string) => (await listItems(CID, 'offer')).find((o) => o.applicationId === appId) as any;
const runOf = async (appId: string) => (await listItems(CID, 'flowRun')).find((r) => r.applicationId === appId) as any;
const tasksOf = async (appId: string) => (await listItems(CID, 'flowTask')).filter((t) => t.applicationId === appId) as any[];

async function main() {
  // ---- the step settings and their rules
  const mk = (type: any, over: any = {}) => makeStep(type, [], over);
  const hr = { ownerUid: 'u_hr', ownerName: 'Hana HR' };
  const valid = (steps: FlowStep[]) => validateFlow({ name: 'F', steps } as any).map((p: any) => p.message);
  const o1 = mk('offer', hr); const b1 = mk('onboard', hr);
  assert.equal(o1.settings.mode, 'manual', 'old and untouched steps stay manual');
  assert.deepEqual(valid([mk('screen', hr), o1, b1].map((s, i) => ({ ...s, id: `s${i}` }))).filter((m) => /approves/.test(m)), []);
  assert.equal(BUILDER_START.offer?.mode, 'auto', 'the builder starts new finishing steps in app mode');
  const o2 = { ...mk('offer', hr), id: 'o', settings: { ...o1.settings, mode: 'auto' } };
  assert.ok(valid([o2, { ...b1, id: 'b' }]).some((m) => /Who approves the offer\?/.test(m)), 'an automatic offer needs an approver');
  const o3 = { ...o2, settings: { ...o2.settings, approverUid: 'u_f', approverUidName: 'Fay Founder' } };
  assert.ok(!valid([o3, { ...b1, id: 'b' }]).some((m) => /approves/.test(m)));
  assert.match(stepSentence(o3 as any, { steps: [o3] } as any), /Fay Founder approves/);

  // ---- publish a flow: automatic offer (founder approves) and automatic joining (IT and asset owners)
  const offerStep = { ...mk('offer', hr), settings: { mode: 'auto', approverUid: 'u_f', approverUidName: 'Fay Founder', joiningInDays: 14, probationMonths: 3, validDays: 7 } };
  const onboardStep = { ...mk('onboard', hr), settings: { mode: 'auto', itOwnerUid: 'u_it', assetOwnerUid: 'u_asset' } };
  const saved = await flow(HR, 'POST', 'flow-save', { name: 'Auto hiring', steps: [offerStep, { ...onboardStep, id: 'b2' }].map((s, i) => ({ ...s, id: i ? 'b2' : 'o1' })) });
  okc(saved); assert.deepEqual(saved.json.problems, [], JSON.stringify(saved.json.problems));
  const saved2 = (await flow(HR, 'GET', 'flow-state')).json.draft.steps;
  assert.equal(saved2[0].settings.approverUidName, 'Fay Founder', 'the approver name is stored with the id');
  assert.equal(saved2[1].settings.itOwnerUid, 'u_it');
  okc(await flow(HR, 'POST', 'flow-activate'));

  // ---- 1) expected salary fits the band: it is used. Offer goes to the approver, nobody gets a task
  const a1 = await newApp('Cat', 8);
  await flowStartHook(CID, a1);
  const off1 = await offerOf(a1);
  assert.ok(off1, 'an offer was drafted'); assert.equal(off1.recommendedCtcLpa, 8); assert.equal(off1.status, 'PENDING_FOUNDER');
  assert.equal(off1.autoSend, true); assert.equal(off1.overBand, false);
  assert.equal(off1.joiningDate, day(14)); assert.equal(off1.probationMonths, 3);
  assert.equal((await tasksOf(a1)).length, 0, 'HR gets no task while the app is doing it');
  await advanceRun(CID, (await runOf(a1)).id);
  assert.equal((await listItems(CID, 'offer')).filter((o) => o.applicationId === a1).length, 1, 'never drafted twice');

  // ---- 2) expected salary above the band: the offer is at the top of the band, no reason needed
  const a2 = await newApp('Dan', 15);
  await flowStartHook(CID, a2);
  const off2 = await offerOf(a2);
  assert.equal(off2.recommendedCtcLpa, 10); assert.equal(off2.overBand, false); assert.match(off2.justification, /above the budgeted 10/);

  // ---- 3) nothing to base a salary on: HR gets one task that says why
  const a3 = await newApp('Eve', null, null);
  await flowStartHook(CID, a3);
  assert.equal(await offerOf(a3), undefined);
  const t3 = await tasksOf(a3);
  assert.equal(t3.length, 1); assert.equal(t3[0].ownerUid, 'u_hr'); assert.match(t3[0].instruction, /no salary band/); assert.equal(t3[0].link, 'offers');
  await advanceRun(CID, (await runOf(a3)).id);
  assert.equal((await tasksOf(a3)).length, 1, 'one task, not one per check');

  // ---- approval: only the founder; if the letter cannot go out, it stays approved and HR is told
  assert.equal((await hire(HR, 'POST', 'offer-act', { id: off1.id, action: 'approve' })).status, 403);
  const ap1 = await hire(FOUNDER, 'POST', 'offer-act', { id: off1.id, action: 'approve' });
  okc(ap1);
  assert.equal(ap1.json.item.status, 'APPROVED', 'the company address is not on file, so it could not be sent');
  assert.match(String(ap1.json.item.autoSendError), /company_address/);
  const t1 = await tasksOf(a1);
  assert.equal(t1.length, 1); assert.match(t1[0].instruction, /approved but was not sent/);
  assert.equal((await runOf(a1)).status, 'WAITING');

  // ---- once the address is known, an approved offer goes out by itself
  fdb.seed('payrollSettings', CID, { company: { legalName: 'Acme Pvt Ltd', address: 'Mumbai office' } });
  const ap2 = await hire(FOUNDER, 'POST', 'offer-act', { id: off2.id, action: 'approve' });
  okc(ap2);
  assert.equal(ap2.json.item.status, 'SENT', JSON.stringify(ap2.json.item.autoSendError));
  assert.ok(ap2.json.link.includes('?offer='), 'the candidate link was made');
  assert.equal(ap2.json.item.approvedCtcLpa, 10);

  // ---- the candidate accepts: onboarding starts and the joiner is set up, exactly once
  const token = (await getItem(CID, off2.id, 'offer'))!.token as string;
  okc(await hire({}, 'POST', 'offer-public-respond', { token, response: 'ACCEPT', confirm: true }));
  const run2 = await runOf(a2);
  await advanceRun(CID, run2.id);
  await advanceRun(CID, run2.id);
  assert.equal(fdb.all('onboardings').length, 1);
  const after = await offerOf(a2);
  assert.ok(after.joinerUid, 'a login was created: ' + JSON.stringify(after.joinerNotes));
  assert.equal(users.size, 1, 'one login only');
  assert.equal(fdb.all('employees').filter((e) => e.email === 'dan@mail.com').length, 1);
  assert.equal(fdb.all('employees').find((e) => e.email === 'dan@mail.com')!.roleIds[0], 'c1_employee', 'ordinary employee access only');
  const prof = fdb.all('leaveProfiles').find((p) => p.uid === after.joinerUid);
  assert.equal(prof?.joinDate, off2.joiningDate, 'leave profile carries the joining date');
  assert.equal(fdb.all('hrbpItems').filter((i) => i.kind === 'prob' && i.uid === after.joinerUid).length, 1, 'probation started once');
  const jt = (await listItems(CID, 'flowTask')).filter((t) => t.applicationId === a2) as any[];
  assert.deepEqual(jt.map((t) => t.ownerUid).sort(), ['u_asset', 'u_it']);
  assert.ok(jt.every((t) => t.manualDone && t.status === 'OPEN'));
  assert.ok(joinMail.some((m) => m.to === 'u_it@acme.com') && joinMail.some((m) => m.to === 'u_hr@acme.com'), 'owners and HR were emailed');
  assert.equal((await runOf(a2)).status, 'WAITING', 'not hired until they start');
  assert.ok(after.joinerNotes.some((n: string) => /Payroll is not set up/.test(n)), 'what could not be done is written down');

  // ---- IT marks the task done; only the owner (or HR) may
  const itTask = jt.find((t) => t.ownerUid === 'u_it');
  assert.equal((await flow(tok('u_x'), 'POST', 'flow-task-done', { taskId: itTask.id })).status, 403);
  okc(await flow(tok('u_it'), 'POST', 'flow-task-done', { taskId: itTask.id }));
  assert.equal((await flow(tok('u_it'), 'POST', 'flow-task-done', { taskId: itTask.id })).status, 409);
  assert.equal((await flow(tok('u_it'), 'POST', 'flow-task-done', { taskId: 'nope' })).status, 404);

  // ---- the first day: a punch-in marks them hired and the offer as joined
  fdb.seed('leaveAttendance', `${CID}__${after.joinerUid}__${off2.joiningDate}`, { companyId: CID, uid: after.joinerUid, date: off2.joiningDate, month: off2.joiningDate.slice(0, 7), checkIn: new Date().toISOString() });
  await advanceRun(CID, run2.id);
  assert.equal((await runOf(a2)).status, 'HIRED');
  assert.equal((await offerOf(a2)).status, 'JOINED');
  assert.equal(users.size, 1, 'still one login');

  // ---- a founder cannot reject an offer that is already approved
  const rj = await hire(FOUNDER, 'POST', 'offer-act', { id: off1.id, action: 'reject', note: 'Too high' });
  assert.equal(rj.status, 409, 'an approved offer cannot be rejected');

  // ---- a job with a flow attached: its applicants follow that flow, everyone else follows the default
  const newFam = await flow(HR, 'POST', 'flow-new', { name: 'Design hiring', designations: ['Illustrator'], from: 'standard' });
  okc(newFam);
  const DF = newFam.json.familyId;
  okc(await flow(HR, 'POST', 'flow-activate', { familyId: DF }));
  fdb.seed('requisitions', 'rq9', { id: 'rq9', companyId: CID, positionTitle: 'Brand Designer', departmentName: 'Design', status: 'JOB_OPEN', ctcMaxLpa: 9, flowFamilyId: DF, flowFamilyName: 'Design hiring' });
  const fam = (await flow(HR, 'GET', 'flow-state')).json.families;
  const autoFam = fam.find((f: any) => f.familyId !== DF && f.familyId !== 'default')?.familyId || 'default';
  __clearJobFlowCache();
  const j1 = await newApp('Gus', 8, 'rq9');
  const j2 = await newApp('Hal', 8, 'rq1');
  await flowStartHook(CID, j1); await flowStartHook(CID, j2);
  assert.equal((await runOf(j1)).familyId, DF, 'the job\'s own flow');
  assert.notEqual((await runOf(j2)).familyId, DF, 'another job is unaffected');
  assert.equal(typeof autoFam, 'string');
  const jf = buildJobFlows([{ id: 'rq1', companyId: CID, positionTitle: 'Designer', status: 'JOB_OPEN', flowFamilyId: 'fam_x' } as any]);
  assert.equal(jf.familyFor({ requisitionId: 'rq1', designation: 'Designer' } as any), 'fam_x');
  console.log('hiring.auto tests passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
