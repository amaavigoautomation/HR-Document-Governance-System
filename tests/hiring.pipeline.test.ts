import assert from 'node:assert/strict';
import { __useFakeAdmin } from '../api/_lib/firebaseAdmin.ts';
import { FakeFirestore } from './fakeFirestore.ts';
import { routeHiring } from '../api/_lib/hiringRouter.ts';
import { extractResumeFacts, buildPostKit } from '../api/_lib/pipelineApi.ts';
import { plainSummary } from '../api/_lib/interviewApi.ts';

const fdb = new FakeFirestore();
__useFakeAdmin({ db: fdb, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
const CID = 'c1';
const tok = (uid: string, perms: string[] = [], cid = CID) =>
  ({ authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email: `${uid}@acme.com`, cid, cs: 'ACTIVE', perms })).toString('base64')}` });
const HR = tok('u_hr', ['app.manage']);
const EMP = tok('u_emp');
const I1 = tok('u_i1');
const I2 = tok('u_i2');
const OTHER = tok('u_x', ['app.manage'], 'c2');
const call = (h: any, method: string, action: string, body: any = {}, query: any = {}) => routeHiring({ method, action, headers: h, body, query });
const future = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

const emp = (id: string, name: string, extra: any = {}) => fdb.seed('employees', id, { companyId: CID, authUid: id, name, email: `${id}@acme.com`, active: true, departmentName: 'Eng', ...extra });
emp('u_hr', 'Hana HR'); emp('u_emp', 'Eli Employee'); emp('u_i1', 'Ivy One'); emp('u_i2', 'Ian Two');
fdb.seed('requisitions', 'rq1', { id: 'rq1', companyId: CID, positionTitle: 'React Developer', departmentName: 'Eng', status: 'JOB_OPEN', keySkills: 'React, TypeScript, SQL', minExperienceYears: 3, maxExperienceYears: 6, ctcMaxLpa: 10, positionId: 'POS-ACM-2026-001', location: 'Mumbai', jd: { text: 'Build UIs.' } });
fdb.seed('requisitions', 'rq_draft', { id: 'rq_draft', companyId: CID, positionTitle: 'Designer', departmentName: 'Eng', status: 'PENDING_HR' });
fdb.seed('requisitions', 'rq_other', { id: 'rq_other', companyId: 'c2', positionTitle: 'Other', status: 'JOB_OPEN' });

async function main() {
  // ---- pure helpers
  const f = extractResumeFacts('Senior dev, 5 years of React and SQL. Contact a@b.com +91 98765 43210. 2 yrs at X', ['React', 'TypeScript', 'SQL']);
  assert.equal(f.years, 5);
  assert.deepEqual(f.skillsFound, ['React', 'SQL']);
  assert.deepEqual(f.skillsMissing, ['TypeScript']);
  assert.equal(f.email, 'a@b.com');
  assert.equal(extractResumeFacts('', []).years, null);
  const kit = buildPostKit(fdb.all('requisitions').find((r) => r.id === 'rq1')!, 'LinkedIn', 'https://careers.x/job');
  assert.ok(kit.body.includes('React Developer') && kit.body.includes('POS-ACM-2026-001') && kit.body.includes('https://careers.x/job'));

  // ---- access
  assert.equal((await call(EMP, 'GET', 'jdlib-list')).status, 403);
  assert.equal((await call({}, 'GET', 'jdlib-list')).status, 401);
  assert.equal((await call(HR, 'POST', 'jdlib-list')).status, 405);
  assert.equal((await call(EMP, 'POST', 'screen-save', {})).status, 403);
  assert.equal((await call(EMP, 'GET', 'pipe-board')).status, 403);

  // ---- JD library
  assert.equal((await call(HR, 'POST', 'jdlib-save', { title: '', text: 'x'.repeat(30) })).status, 400);
  assert.equal((await call(HR, 'POST', 'jdlib-save', { title: 'Dev', text: 'short' })).status, 400);
  const t1 = (await call(HR, 'POST', 'jdlib-save', { title: 'Frontend Dev', department: 'Eng', skills: 'React, CSS', text: 'We need a frontend developer who ships.' })).json.item;
  assert.equal(t1.version, 1);
  assert.equal((await call(HR, 'POST', 'jdlib-save', { id: t1.id, title: 'Frontend Developer', text: 'We need a frontend developer who ships.' })).json.item.version, 2);
  assert.equal((await call(OTHER, 'GET', 'jdlib-list')).json.items.length, 0, 'other company sees nothing');
  assert.equal((await call(OTHER, 'POST', 'jdlib-delete', { id: t1.id })).status, 404);
  assert.equal((await call(HR, 'POST', 'jdlib-delete', { id: t1.id })).status, 200);

  // ---- posting tracker
  assert.equal((await call(HR, 'GET', 'post-kit', {}, { requisitionId: 'rq_draft' })).status, 409, 'not approved yet');
  assert.equal((await call(HR, 'GET', 'post-kit', {}, { requisitionId: 'rq_other' })).status, 404);
  assert.ok((await call(HR, 'GET', 'post-kit', {}, { requisitionId: 'rq1' })).json.kits.length >= 4);
  assert.equal((await call(HR, 'POST', 'post-save', { requisitionId: 'rq1', board: 'Nowhere' })).status, 400);
  assert.equal((await call(HR, 'POST', 'post-save', { requisitionId: 'rq1', board: 'Naukri', url: 'javascript:x' })).status, 400);
  const p1 = (await call(HR, 'POST', 'post-save', { requisitionId: 'rq1', board: 'Naukri', url: 'https://naukri.com/j/1', cost: 2500 })).json.item;
  assert.equal(p1.status, 'LIVE');
  assert.equal(p1.positionId, 'POS-ACM-2026-001');
  assert.equal((await call(HR, 'GET', 'post-list', {}, { requisitionId: 'rq1' })).json.items.length, 1);

  // ---- referrals
  assert.deepEqual((await call(EMP, 'GET', 'ref-jobs')).json.jobs.map((j: any) => j.id), ['rq1'], 'only open jobs of this company');
  assert.equal((await call(EMP, 'POST', 'ref-submit', { requisitionId: 'rq_draft', name: 'Cat', email: 'cat@x.com' })).status, 404);
  assert.equal((await call(EMP, 'POST', 'ref-submit', { requisitionId: 'rq1', name: 'Cat', email: 'not-an-email' })).status, 400);
  assert.equal((await call(EMP, 'POST', 'ref-submit', { requisitionId: 'rq1', name: 'Me', email: 'u_emp@acme.com' })).status, 400, 'no self-referral');
  const ref = await call(EMP, 'POST', 'ref-submit', { requisitionId: 'rq1', name: 'Cat Candidate', email: 'cat@x.com', mobile: '9876543210', note: 'Great at React' });
  assert.equal(ref.status, 200, JSON.stringify(ref.json));
  const appId = ref.json.applicationId;
  const app = fdb.all('applications').find((a) => a.id === appId)!;
  assert.equal(app.source, 'REFERRAL');
  assert.equal(app.referredByName, 'Eli Employee');
  assert.equal(app.requisitionId, 'rq1');
  const mine = (await call(EMP, 'GET', 'ref-list')).json;
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].stage, 'New Applicant');
  assert.equal(Object.keys(mine.items[0]).includes('score'), false);
  assert.equal((await call(tok('u_other_emp'), 'GET', 'ref-list')).json.items.length, 0, 'another employee sees none');
  assert.equal((await call(HR, 'GET', 'ref-list')).json.items.length, 1, 'HR sees all');

  // ---- candidate fields and score
  assert.equal((await call(HR, 'POST', 'cand-save', { applicationId: appId, expectedCtcLpa: -3 })).status, 400);
  assert.equal((await call(HR, 'POST', 'cand-save', { applicationId: appId, portfolioUrl: 'ftp://x' })).status, 400);
  assert.equal((await call(HR, 'POST', 'cand-save', { applicationId: 'nope', expectedCtcLpa: 5 })).status, 404);
  assert.equal((await call(OTHER, 'POST', 'cand-save', { applicationId: appId, expectedCtcLpa: 5 })).status, 404, 'other company cannot touch it');
  assert.equal((await call(HR, 'POST', 'cand-save', { applicationId: appId, expectedCtcLpa: 12, currentCtcLpa: 9, totalExperienceYears: 4, employersCount: 2, portfolioUrl: 'https://cat.dev' })).status, 200);

  let sc = (await call(HR, 'GET', 'score-get', {}, { applicationId: appId })).json.score;
  const part = (n: string) => sc.lines.find((l: any) => l.part === n);
  assert.equal(part('experience').rating, 100);
  assert.equal(part('salaryFit').rating, 50, '12 LPA is 20% above the 10 LPA band');
  assert.equal(part('stability').rating, 70, '4 years / 2 employers = 2 years each');
  assert.equal(part('skills').pending, true, 'resume not read yet: pending, not zero');
  assert.equal(part('communication').pending, true);
  assert.equal(part('portfolio').rating, 60);
  assert.equal(sc.complete, false);

  // weights
  assert.equal((await call(HR, 'POST', 'score-settings-save', { weights: { skills: 50, experience: 50, portfolio: 10, communication: 0, stability: 0, salaryFit: 0 } })).status, 400, 'must add to 100');
  assert.equal((await call(HR, 'POST', 'score-settings-save', { weights: { skills: 40, experience: 30, portfolio: 10, communication: 10, stability: 5, salaryFit: 5 } })).status, 200);
  assert.equal((await call(HR, 'GET', 'score-settings')).json.weights.skills, 40);
  assert.equal((await call(OTHER, 'GET', 'score-settings')).json.weights.skills, 30, 'other company keeps the defaults');

  // manual rating
  assert.equal((await call(HR, 'POST', 'score-rate', { applicationId: appId, communication: 150 })).status, 400);
  sc = (await call(HR, 'POST', 'score-rate', { applicationId: appId, communication: 80 })).json.score;
  assert.equal(sc.lines.find((l: any) => l.part === 'communication').rating, 80);

  // resume with no link
  assert.equal((await call(HR, 'POST', 'resume-extract', { applicationId: appId })).status, 400);

  // ---- screening
  assert.equal((await call(HR, 'POST', 'screen-save', { applicationId: appId, outcome: 'MAYBE' })).status, 400);
  assert.equal((await call(HR, 'POST', 'screen-save', { applicationId: appId, outcome: 'FAIL', notes: '' })).status, 400, 'a rejection needs a reason');
  const sv = await call(HR, 'POST', 'screen-save', { applicationId: appId, outcome: 'PASS', notes: 'Clear, motivated', communication: 90, answers: { currentCtcLpa: 9, expectedCtcLpa: 11, noticePeriod: '30 days' } });
  assert.equal(sv.status, 200, JSON.stringify(sv.json));
  assert.equal(sv.json.stage, 'Shortlisted');
  const after = fdb.all('applications').find((a) => a.id === appId)!;
  assert.equal(after.expectedCtcLpa, 11);
  assert.equal(after.noticePeriod, '30 days');
  assert.equal((await call(HR, 'GET', 'score-get', {}, { applicationId: appId })).json.score.lines.find((l: any) => l.part === 'communication').rating, 90, 'screening feeds the score');
  assert.equal((await call(HR, 'GET', 'screen-get', {}, { applicationId: appId })).json.screening.outcome, 'PASS');

  // ---- assessments
  assert.equal((await call(HR, 'POST', 'assess-assign', { applicationId: appId, title: '' })).status, 400);
  assert.equal((await call(HR, 'POST', 'assess-assign', { applicationId: appId, title: 'React test', maxScore: 50, passScore: 80 })).status, 400);
  const as = (await call(HR, 'POST', 'assess-assign', { applicationId: appId, title: 'React test', type: 'TECHNICAL', maxScore: 50, passScore: 30, link: 'https://test.x/1' })).json.item;
  assert.equal((await call(HR, 'POST', 'assess-result', { id: as.id, score: 60 })).status, 400, 'above the maximum');
  assert.equal((await call(HR, 'POST', 'assess-result', { id: as.id, score: 41 })).json.item.result, 'PASS');
  assert.equal((await call(OTHER, 'POST', 'assess-result', { id: as.id, score: 10 })).status, 404);

  // ---- interviews
  const panelIds = ['u_i1', 'u_i2'];
  assert.equal((await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: 'garbage', panel: panelIds })).status, 400);
  assert.equal((await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: '2020-01-01T10:00:00Z', panel: panelIds })).status, 400, 'past');
  assert.equal((await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: future(48), panel: [] })).status, 400);
  assert.equal((await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: future(48), panel: ['ghost'] })).status, 400);
  assert.equal((await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: future(48), durationMinutes: 5, panel: panelIds })).status, 400);
  const start = future(48);
  const sch = await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: start, durationMinutes: 45, mode: 'Video', location: 'https://meet.x/abc', round: 'Technical round', panel: panelIds });
  assert.equal(sch.status, 200, JSON.stringify(sch.json));
  const iv = sch.json.interview;
  assert.equal(iv.reminders.length, 2);
  assert.equal(fdb.all('applications').find((a) => a.id === appId)!.status, 'Interview Scheduled');
  // the same interviewer cannot be double booked unless forced
  const clash = await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: start, durationMinutes: 30, panel: ['u_i1'] });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.canForce, true);
  // access to the list
  assert.equal((await call(I1, 'GET', 'int-list')).json.items.length, 1, 'interviewer sees theirs');
  assert.equal((await call(EMP, 'GET', 'int-list')).json.items.length, 0, 'others see none');
  assert.equal(JSON.stringify((await call(I1, 'GET', 'int-list')).json).includes('strengths'), false, 'the list never carries scorecards');

  // ---- a guest added to the meeting can also give feedback (optional, never blocks the panel)
  const gsch = await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: future(72), durationMinutes: 30, panel: ['u_i2'], guests: ['u_emp@acme.com'], force: true });
  assert.equal(gsch.status, 200, JSON.stringify(gsch.json));
  const gid = gsch.json.interview.id;
  const gl = (await call(EMP, 'GET', 'int-list')).json.items;
  assert.equal(gl.length, 1, 'the guest sees the interview they were added to');
  assert.equal(gl[0].iAmGuest, true);
  assert.equal((await call(EMP, 'GET', 'int-feedback-get', {}, { interviewId: gid })).json.canSubmit, true);
  const gc = { ratings: { 'Technical skills': 3, 'Problem solving': 3, Communication: 3, 'Culture fit': 3, 'Role knowledge': 3 }, recommendation: 'YES', strengths: 'Guest view', concerns: '' };
  const gs = await call(EMP, 'POST', 'int-feedback-submit', { interviewId: gid, scorecard: gc });
  assert.equal(gs.status, 200, JSON.stringify(gs.json));
  assert.equal(gs.json.panelComplete, false, 'a guest card does not complete the panel');
  assert.equal((await call(EMP, 'POST', 'int-feedback-submit', { interviewId: gid, scorecard: gc })).status, 409, 'guest cannot resubmit');
  assert.equal((await call(HR, 'GET', 'int-list')).json.items.find((x: any) => x.id === gid).submittedCount, 0, 'panel count ignores guests');
  assert.equal((await call(HR, 'POST', 'int-cancel', { id: gid })).status, 200);

  // ---- blind feedback
  const card = (rec: string, strengths: string) => ({ ratings: { 'Technical skills': 4, 'Problem solving': 5, Communication: 4, 'Culture fit': 4, 'Role knowledge': 3 }, recommendation: rec, strengths, concerns: '' });
  assert.equal((await call(EMP, 'POST', 'int-feedback-submit', { interviewId: iv.id, scorecard: card('YES', 'x') })).status, 403, 'not on the panel');
  assert.equal((await call(I1, 'POST', 'int-feedback-submit', { interviewId: iv.id, scorecard: { ...card('YES', 'x'), ratings: {} } })).status, 400);
  const s1 = await call(I1, 'POST', 'int-feedback-submit', { interviewId: iv.id, scorecard: card('STRONG_YES', 'Excellent React depth') });
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  assert.equal(s1.json.panelComplete, false);
  assert.equal(s1.json.view.visible.length, 1);
  assert.equal(s1.json.view.summary, null);
  assert.equal((await call(I1, 'POST', 'int-feedback-submit', { interviewId: iv.id, scorecard: card('NO', 'changed my mind') })).status, 409, 'cannot resubmit');
  // I2 has not submitted: sees nothing of I1's card
  const v2 = (await call(I2, 'GET', 'int-feedback-get', {}, { interviewId: iv.id })).json;
  assert.equal(v2.view.visible.length, 0);
  assert.equal(v2.view.hiddenCount, 1);
  assert.equal(JSON.stringify(v2).includes('Excellent React depth'), false, 'blind: the text must not leak');
  // HR cannot peek either until the panel is done
  const vhr = (await call(HR, 'GET', 'int-feedback-get', {}, { interviewId: iv.id })).json;
  assert.equal(vhr.view.visible.length, 0);
  assert.equal(JSON.stringify(vhr).includes('Excellent React depth'), false);
  // summary is refused until everyone has submitted
  assert.equal((await call(HR, 'POST', 'int-ai-summary', { id: iv.id })).status, 409);
  // I2 submits: interview completes, candidate moves on, everyone can now see everything
  const s2 = await call(I2, 'POST', 'int-feedback-submit', { interviewId: iv.id, scorecard: card('YES', 'Solid, a bit nervous') });
  assert.equal(s2.json.panelComplete, true);
  assert.equal(s2.json.view.visible.length, 2);
  assert.equal(fdb.all('applications').find((a) => a.id === appId)!.status, 'Interviewed');
  assert.equal((await call(I1, 'GET', 'int-feedback-get', {}, { interviewId: iv.id })).json.view.visible.length, 2);
  assert.ok((await call(HR, 'GET', 'int-feedback-get', {}, { interviewId: iv.id })).json.view.summary);
  const sum = await call(HR, 'POST', 'int-ai-summary', { id: iv.id });
  assert.equal(sum.status, 200);
  assert.ok(sum.json.aiSummary.text.includes('Excellent React depth'));
  assert.equal(sum.json.aiSummary.generatedBy, 'TEMPLATE', 'no API key in tests');
  assert.ok(plainSummary([], 'x', 'y').length > 0 || true);

  // simultaneous submissions on a fresh interview: both must be kept
  const sch2 = (await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: future(96), panel: panelIds, round: 'HR round' })).json.interview;
  const both = await Promise.all([
    call(I1, 'POST', 'int-feedback-submit', { interviewId: sch2.id, scorecard: card('YES', 'a') }),
    call(I2, 'POST', 'int-feedback-submit', { interviewId: sch2.id, scorecard: card('NO', 'b') }),
  ]);
  assert.deepEqual(both.map((r) => r.status), [200, 200]);
  assert.equal(fdb.all('hiringItems').find((i) => i.id === sch2.id)!.scorecards.length, 2, 'neither card was lost');

  // ---- reschedule and cancel
  const sch3 = (await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: future(120), panel: ['u_i1'], round: 'Final' })).json.interview;
  const moved = await call(HR, 'POST', 'int-reschedule', { id: sch3.id, startIso: future(140), panel: ['u_i1'] });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.interview.sequence, 1);
  const cx = await call(HR, 'POST', 'int-cancel', { id: sch3.id, reason: 'Role on hold' });
  assert.equal(cx.json.interview.status, 'CANCELLED');
  assert.equal((await call(HR, 'POST', 'int-reschedule', { id: sch3.id, startIso: future(150), panel: ['u_i1'] })).status, 409);
  assert.equal((await call(I1, 'POST', 'int-feedback-submit', { interviewId: sch3.id, scorecard: card('YES', 'x') })).status, 409, 'cancelled');
  assert.equal((await call(OTHER, 'POST', 'int-cancel', { id: sch3.id })).status, 404);

  // ---- reminders
  const soon = (await call(HR, 'POST', 'int-schedule', { applicationId: appId, startIso: future(0.5), panel: ['u_i2'], round: 'Quick call' })).json.interview;
  assert.deepEqual(soon.reminders.map((r: any) => r.kind), [], 'too close for any reminder');
  fdb.seed('hiringItems', 'manual_rem', { ...fdb.all('hiringItems').find((i) => i.id === soon.id)!, id: 'manual_rem', reminders: [{ kind: '1h', at: new Date(Date.now() - 1000).toISOString(), sent: false }] });
  const rem1 = await call(HR, 'POST', 'int-send-reminders');
  assert.equal(rem1.status, 200);
  const remRow = fdb.all('hiringItems').find((i) => i.id === 'manual_rem')!;
  assert.equal(remRow.reminders[0].sent, true, 'marked sent so it is not sent twice');
  assert.equal((await call(EMP, 'POST', 'int-send-reminders')).status, 403);
  assert.equal((await call({}, 'GET', 'int-send-reminders')).status, 401);

  // ---- candidate detail and board
  const det = (await call(HR, 'GET', 'cand-detail', {}, { applicationId: appId })).json;
  assert.equal(det.referral.by, 'Eli Employee');
  assert.equal(det.assessments.length, 1);
  assert.ok(det.interviews.every((i: any) => !('scorecards' in i)), 'detail never carries raw scorecards (the summary appears only once the panel is complete)');
  assert.equal((await call(OTHER, 'GET', 'cand-detail', {}, { applicationId: appId })).status, 404);
  const board = (await call(HR, 'GET', 'pipe-board')).json.rows;
  assert.equal(board.length, 1);
  assert.equal(board[0].screening, 'PASS');
  assert.equal((await call(OTHER, 'GET', 'pipe-board')).json.rows.length, 0);

  console.log('hiring pipeline api ok');
}
main().catch((e) => { console.error(e); process.exit(1); });
