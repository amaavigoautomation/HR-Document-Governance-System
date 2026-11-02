import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { sweepOffers } from '../api/_lib/offerApi.ts';
import { GHOST_AFTER_DAYS, addDay, buildPack, checkRecommendedCtc, ctcBreakup, dueReminders, offerTransition } from '../shared/offerEngine.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['app.manage']);
const FOUNDER = tok('u_f', ['req.founder_decide']);
const EMP = tok('u_emp');
const OTHER_HR = tok('u_x', ['app.manage'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHiring({ method, action, headers: h, body, query, origin: 'https://hr.test' });
const day = (n: number) => new Date(Date.now() + 5.5 * 3600_000 + n * 86400_000).toISOString().slice(0, 10);

fdb.seed('employees', 'u_hr', { companyId: CID, authUid: 'u_hr', name: 'Hana HR', email: 'u_hr@acme.com', active: true });
fdb.seed('employees', 'u_f', { companyId: CID, authUid: 'u_f', name: 'Fay Founder', email: 'u_f@acme.com', active: true });
fdb.seed('employees', 'u_emp', { companyId: CID, authUid: 'u_emp', name: 'Eli Employee', email: 'u_emp@acme.com', active: true });
fdb.seed('requisitions', 'rq1', { id: 'rq1', companyId: CID, positionTitle: 'React Developer', departmentName: 'Eng', status: 'JOB_OPEN', keySkills: 'React', ctcMaxLpa: 10, positionId: 'POS-ACM-2026-001', location: 'Mumbai', workMode: 'Hybrid', employmentType: 'Full-time', reportingManager: { id: 'm1', name: 'Mona Manager', email: 'm@acme.com' }, jd: { text: 'Build UIs.' } });
fdb.seed('requisitions', 'rq2', { id: 'rq2', companyId: CID, positionTitle: 'Tester', departmentName: 'QA', status: 'JOB_OPEN', ctcMaxLpa: 6, positionId: 'POS-ACM-2026-002' });

async function main() {
  // ---- pure rules
  const b = ctcBreakup(12);
  assert.equal(Object.values(b.annual).reduce((a, c) => a + c, 0), 1_200_000, 'parts add up to the CTC');
  assert.ok(b.annual.employerPf <= 21_600 && b.annual.special > 0);
  assert.equal(checkRecommendedCtc('abc', 10, '').ok, false);
  assert.equal(checkRecommendedCtc(11, 10, '').needsReason, true);
  assert.equal(checkRecommendedCtc(11, 10, 'Rare skill').ok, true);
  assert.equal(checkRecommendedCtc(9, 10, '').overBand, false);
  assert.equal(checkRecommendedCtc(50, null, '').ok, true, 'no band set means nothing to exceed');
  assert.equal(offerTransition('DRAFT', 'approve').ok, false);
  assert.equal(offerTransition('SENT', 'accept').ok, true);
  assert.equal(offerTransition('JOINED', 'withdraw').ok, false);
  assert.equal(offerTransition('NEGOTIATION', 'revise').ok && (offerTransition('NEGOTIATION', 'revise') as any).to, 'DRAFT');
  const built = buildPack({ companyName: 'Acme', companyAddress: '', candidateName: 'Cat', designation: 'Dev', department: 'Eng', managerName: '', location: 'Mumbai', workMode: 'Office', employmentType: 'Full-time', joinDate: day(30), validTill: day(7), probationMonths: 3, ctcLpa: 8, signatoryName: 'Fay', signatoryTitle: 'Founder', today: day(0) });
  assert.ok(built.missing.includes('manager_name') && built.missing.includes('company_address'), 'unfilled fields are reported');
  assert.ok(built.pack.compensation.includes('Total cost to company'));
  const sentAt = new Date(Date.now() - 8 * 86400000).toISOString();
  assert.deepEqual(dueReminders({ status: 'SENT', sentAt, validTill: day(5) }, day(0)).map((r) => r.type), ['ghost']);
  assert.deepEqual(dueReminders({ status: 'SENT', sentAt: new Date(Date.now() - 2 * 86400000).toISOString(), validTill: day(5) }, day(0)).map((r) => r.type), ['respond']);
  assert.deepEqual(dueReminders({ status: 'SENT', sentAt, validTill: day(-1) }, day(0)).map((r) => r.type), ['expire']);
  assert.deepEqual(dueReminders({ status: 'ACCEPTED', joiningDate: addDay(day(0), 7) }, day(0)).map((r) => r.type), ['joining_7']);
  assert.deepEqual(dueReminders({ status: 'ACCEPTED', joiningDate: addDay(day(0), 1), remindersSent: ['joining_1'] }, day(0)), [], 'a reminder is never repeated');
  assert.equal(GHOST_AFTER_DAYS, 7);

  // ---- a candidate to make an offer to
  const ref = await call(EMP, 'POST', 'ref-submit', { requisitionId: 'rq1', name: 'Cat Candidate', email: 'cat@x.com', mobile: '9876543210' });
  assert.equal(ref.status, 200, JSON.stringify(ref.json));
  const appId = ref.json.applicationId;

  // ---- access
  assert.equal((await call(EMP, 'GET', 'offer-list')).status, 403);
  assert.equal((await call({}, 'GET', 'offer-list')).status, 401);
  assert.equal((await call(HR, 'POST', 'offer-list')).status, 405);
  assert.equal((await call(EMP, 'POST', 'offer-create', { applicationId: appId })).status, 403);

  // ---- create: validation
  assert.equal((await call(HR, 'POST', 'offer-create', { applicationId: 'nope', recommendedCtcLpa: 8, joiningDate: day(30) })).status, 404);
  assert.equal((await call(HR, 'POST', 'offer-create', { applicationId: appId, recommendedCtcLpa: 8, joiningDate: day(-3) })).status, 400, 'joining date in the past');
  const over = await call(HR, 'POST', 'offer-create', { applicationId: appId, recommendedCtcLpa: 12, joiningDate: day(30) });
  assert.equal(over.status, 400);
  assert.equal(over.json.needsReason, true);
  assert.equal((await call(OTHER_HR, 'POST', 'offer-create', { applicationId: appId, recommendedCtcLpa: 8, joiningDate: day(30) })).status, 404, 'other company cannot see the candidate');
  const c = await call(HR, 'POST', 'offer-create', { applicationId: appId, recommendedCtcLpa: 12, justification: 'Rare skill and a competing offer', joiningDate: day(30), probationMonths: 3 });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const id = c.json.item.id;
  assert.equal(c.json.item.overBand, true);
  assert.equal(c.json.item.status, 'DRAFT');
  assert.equal(c.json.item.token, undefined);
  assert.equal((await call(HR, 'POST', 'offer-create', { applicationId: appId, recommendedCtcLpa: 8, joiningDate: day(30) })).status, 409, 'one offer in progress per candidate');

  // ---- approval
  assert.equal((await call(FOUNDER, 'POST', 'offer-act', { id, action: 'approve' })).status, 409, 'must be submitted first');
  assert.equal((await call(HR, 'POST', 'offer-act', { id, action: 'submit' })).status, 200);
  assert.equal((await call(HR, 'POST', 'offer-act', { id, action: 'approve' })).status, 403, 'HR cannot approve');
  assert.equal((await call(FOUNDER, 'POST', 'offer-act', { id, action: 'reject' })).status, 400, 'a reason is required');
  assert.equal((await call(FOUNDER, 'POST', 'offer-act', { id, action: 'reject', note: 'Too high' })).status, 200);
  assert.equal((await call(HR, 'POST', 'offer-act', { id, action: 'submit' })).status, 200, 'rejected offers can be resubmitted');
  const [a1, a2] = await Promise.all([
    call(FOUNDER, 'POST', 'offer-act', { id, action: 'approve', approvedCtcLpa: 10.5, note: 'Counter at 10.5' }),
    call(FOUNDER, 'POST', 'offer-act', { id, action: 'approve', approvedCtcLpa: 11 }),
  ]);
  assert.deepEqual([a1.status, a2.status].sort(), [200, 409], 'two founders cannot both approve');
  const approved = (await call(HR, 'GET', 'offer-get', {}, { id })).json.item;
  assert.equal(approved.status, 'APPROVED');
  assert.equal(approved.countered, true);
  assert.ok(Object.keys(approved.pack).length === 5);

  // ---- the documents must be complete before sending
  assert.equal((await call(HR, 'POST', 'offer-act', { id, action: 'send' })).status, 400, 'company_address is missing');
  const fix = (t: string) => t.replace(/\{\{company_address\}\}/g, 'Mumbai office');
  const saved = await call(HR, 'POST', 'offer-pack-save', { id, docs: { offerLetter: fix(approved.pack.offerLetter), agreement: fix(approved.pack.agreement), nda: fix(approved.pack.nda), checklist: fix(approved.pack.checklist) } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.missing, []);

  // ---- send
  const sent = await call(HR, 'POST', 'offer-act', { id, action: 'send' });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.item.status, 'SENT');
  assert.ok(sent.json.link.startsWith('https://hr.test/?offer='));
  assert.equal(fdb.all('applications').find((a) => a.id === appId)!.status, 'Selected');
  assert.equal((await call(HR, 'POST', 'offer-pack-save', { id, docs: { nda: 'x' } })).status, 409, 'cannot edit after sending');
  const token = fdb.all('hiringItems').find((o) => o.id === id)!.token as string;
  assert.match(token, /^[a-f0-9]{48}$/);

  // ---- the candidate's page
  assert.equal((await call({}, 'GET', 'offer-public-get', {}, { token: 'bad' })).status, 404);
  const pub = await call({}, 'GET', 'offer-public-get', {}, { token });
  assert.equal(pub.status, 200);
  assert.equal(pub.json.canRespond, true);
  assert.equal(pub.json.ctcLpa, 10.5);
  assert.ok(pub.json.pack.nda.includes('NON-DISCLOSURE'));
  assert.equal(pub.json.pack.id, undefined);
  assert.equal(JSON.stringify(pub.json).includes('justification'), false, 'internal notes are not shown to the candidate');
  assert.equal((await call({}, 'POST', 'offer-public-respond', { token, response: 'MAYBE' })).status, 400);
  assert.equal((await call({}, 'POST', 'offer-public-respond', { token, response: 'NEGOTIATE' })).status, 400, 'say what to change');
  const neg = await call({}, 'POST', 'offer-public-respond', { token, response: 'NEGOTIATE', note: 'Can we do 11.5?', expectedCtcLpa: 11.5 });
  assert.equal(neg.json.status, 'NEGOTIATION');

  // ---- negotiation goes back to salary approval
  const rev = await call(HR, 'POST', 'offer-act', { id, action: 'revise', recommendedCtcLpa: 11, justification: 'Meet in the middle' });
  assert.equal(rev.json.item.status, 'DRAFT');
  assert.equal(fdb.all('hiringItems').find((o) => o.id === id)!.token, null, 'the old link stops working');
  assert.equal((await call({}, 'GET', 'offer-public-get', {}, { token })).status, 404);
  await call(HR, 'POST', 'offer-act', { id, action: 'submit' });
  await call(FOUNDER, 'POST', 'offer-act', { id, action: 'approve' });
  const again = (await call(HR, 'GET', 'offer-get', {}, { id })).json.item;
  assert.equal(again.approvedCtcLpa, 11);
  const p2 = Object.fromEntries(Object.entries(again.pack).map(([k, v]) => [k, String(v).replace(/\{\{company_address\}\}/g, 'Mumbai office')]));
  await call(HR, 'POST', 'offer-pack-save', { id, docs: p2 });
  await call(HR, 'POST', 'offer-act', { id, action: 'send' });
  const token2 = fdb.all('hiringItems').find((o) => o.id === id)!.token as string;

  // ---- acceptance starts onboarding exactly once, even if the candidate double-clicks
  assert.equal((await call({}, 'POST', 'offer-public-respond', { token: token2, response: 'ACCEPT' })).status, 400, 'must confirm');
  const [r1, r2] = await Promise.all([
    call({}, 'POST', 'offer-public-respond', { token: token2, response: 'ACCEPT', confirm: true }),
    call({}, 'POST', 'offer-public-respond', { token: token2, response: 'ACCEPT', confirm: true }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const final = fdb.all('hiringItems').find((o) => o.id === id)!;
  assert.equal(final.status, 'ACCEPTED');
  assert.ok(final.onboardingId, 'onboarding was started automatically: ' + JSON.stringify(final.onboardingError));
  assert.equal(fdb.all('onboardings').length, 1);
  assert.equal(fdb.all('onboardings')[0].onboardingDate, again.joiningDate);

  // ---- after acceptance: HR marks the joining
  assert.equal((await call(HR, 'POST', 'offer-act', { id, action: 'send' })).status, 409);
  assert.equal((await call(HR, 'POST', 'offer-act', { id, action: 'join', joinedOn: 'soon' })).status, 400);
  assert.equal((await call(HR, 'POST', 'offer-act', { id, action: 'join' })).json.item.status, 'JOINED');
  assert.equal((await call(HR, 'POST', 'offer-act', { id, action: 'withdraw' })).status, 409, 'a joined offer is final');

  // ---- hiring costs
  assert.equal((await call(HR, 'POST', 'hcost-save', { category: 'JOB_BOARD', amount: -1 })).status, 400);
  assert.equal((await call(HR, 'POST', 'hcost-save', { category: 'NOPE', amount: 100 })).status, 400);
  assert.equal((await call(HR, 'POST', 'hcost-save', { category: 'JOB_BOARD', amount: 100, requisitionId: 'rq_other' })).status, 404);
  const cost = await call(HR, 'POST', 'hcost-save', { category: 'JOB_BOARD', amount: 12500, requisitionId: 'rq1', note: 'Naukri' });
  assert.equal(cost.status, 200);
  assert.equal((await call(HR, 'GET', 'hcost-list', {}, { requisitionId: 'rq1' })).json.items.length, 1);
  assert.equal((await call(OTHER_HR, 'POST', 'hcost-delete', { id: cost.json.item.id })).status, 404);
  assert.equal((await call(EMP, 'GET', 'hcost-list')).status, 403);

  // ---- templates
  assert.equal((await call(HR, 'GET', 'offer-tpl-list')).json.items.length, 4);
  assert.equal((await call(HR, 'POST', 'offer-tpl-save', { docKey: 'bogus', body: 'x' })).status, 400);
  await call(HR, 'POST', 'offer-tpl-save', { docKey: 'nda', body: 'Our NDA for {{candidate_name}}' });
  assert.equal((await call(HR, 'GET', 'offer-tpl-list')).json.items.find((t: any) => t.docKey === 'nda').custom, true);
  await call(HR, 'POST', 'offer-tpl-save', { docKey: 'nda', body: '' });
  assert.equal((await call(HR, 'GET', 'offer-tpl-list')).json.items.find((t: any) => t.docKey === 'nda').custom, false, 'empty text resets to the default');

  // ---- daily sweep: a second candidate who never answers is marked ghosted, once
  const ref2 = await call(EMP, 'POST', 'ref-submit', { requisitionId: 'rq1', name: 'Dan Ghost', email: 'dan@x.com' });
  const c2 = (await call(HR, 'POST', 'offer-create', { applicationId: ref2.json.applicationId, recommendedCtcLpa: 8, joiningDate: day(40) })).json.item;
  await call(HR, 'POST', 'offer-act', { id: c2.id, action: 'submit' });
  await call(FOUNDER, 'POST', 'offer-act', { id: c2.id, action: 'approve' });
  const g = (await call(HR, 'GET', 'offer-get', {}, { id: c2.id })).json.item;
  await call(HR, 'POST', 'offer-pack-save', { id: c2.id, docs: Object.fromEntries(Object.entries(g.pack).map(([k, v]) => [k, String(v).replace(/\{\{company_address\}\}/g, 'Mumbai')])) });
  await call(HR, 'POST', 'offer-act', { id: c2.id, action: 'send' });
  const raw = fdb.all('hiringItems').find((o) => o.id === c2.id)!;
  fdb.seed('hiringItems', c2.id, { ...raw, id: c2.id, sentAt: new Date(Date.now() - 9 * 86400000).toISOString() });
  const sw = await sweepOffers();
  assert.equal(sw.closed, 1);
  assert.equal(fdb.all('hiringItems').find((o) => o.id === c2.id)!.status, 'GHOSTED');
  assert.equal((await sweepOffers()).closed, 0, 'nothing happens twice');

  console.log('hiring offer ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
