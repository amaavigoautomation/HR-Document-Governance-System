/**
 * TEST ONLY. Fills the HR Business Partner and Performance modules with sample data, so every section has something in it.
 *
 * It does the same thing you would do by typing the data in: every record goes through the real API handlers, so the
 * rules (who may do what, what is valid) apply exactly as in the app. No email is sent (SMTP is switched off for this run).
 *
 * Usage (repo root, .env must contain FIREBASE_SERVICE_ACCOUNT_JSON):
 *   npx tsx --env-file=.env scripts/seed-hrbp-performance.ts <companyId>            dry run: shows who plays which role, changes nothing
 *   npx tsx --env-file=.env scripts/seed-hrbp-performance.ts <companyId> --apply    writes the data
 *   --only hrbp | pm        do just one module
 *   --with-transfer         also move one person to another department/manager (this EDITS a real employee record)
 *   --cast boss=a@x.com,hr=b@x.com,asha=c@x.com,bilal=d@x.com,chen=e@x.com,dev=f@x.com,esha=g@x.com
 *                           choose who plays each role (default: the first seven active employees, by email)
 *
 * Safe to run twice: records that already exist are skipped. There is no undo, so use a test company only.
 */
// No email from this script, whatever .env says.
process.env.SMTP_USER = ''; process.env.SMTP_PASS = '';

import { adminDb, __useFakeAdmin } from '../api/_lib/firebaseAdmin.js';
import { routeHrbp } from '../api/_lib/hrbpApi.js';
import { routePm } from '../api/_lib/pmApi.js';

const ROLES = ['boss', 'hr', 'asha', 'bilal', 'chen', 'dev', 'esha'] as const;
type Role = (typeof ROLES)[number];
const APPLY = process.argv.includes('--apply');
const WITH_TRANSFER = process.argv.includes('--with-transfer');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > -1 ? process.argv[i + 1] : ''; })();
const CAST_ARG = (() => { const i = process.argv.indexOf('--cast'); return i > -1 ? process.argv[i + 1] : ''; })();

const pad = (n: number) => String(n).padStart(2, '0');
const ist = (offsetDays = 0) => { const d = new Date(Date.now() + 5.5 * 3600_000 + offsetDays * 86400_000); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const quarter = () => { const d = ist(); return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`; };

let CID = '';
const tok = (uid: string, email: string, perms: string[] = [], adm = false) => ({
  authorization: `Bearer ${Buffer.from(JSON.stringify({ uid, email, cid: CID, cs: 'ACTIVE', perms, adm })).toString('base64')}`,
});

let ok = 0, skipped = 0, failed = 0;
function report(label: string, res: { status: number; json: any } | null, note = '') {
  if (!res) { skipped++; console.log(`  skip  ${label}${note ? ` (${note})` : ''}`); return null; }
  if (res.status >= 200 && res.status < 300 && res.json?.success !== false) { ok++; console.log(`  ok    ${label}`); return res.json; }
  if (res.status === 409 || /already/i.test(String(res.json?.error))) { skipped++; console.log(`  skip  ${label} (already there)`); return null; }
  failed++; console.log(`  FAIL  ${label}: ${res.json?.error || res.status}`);
  return null;
}

async function main() {
  CID = process.argv[2] || '';
  if (!CID || CID.startsWith('--')) { console.error('Usage: seed-hrbp-performance.ts <companyId> [--apply] [--only hrbp|pm] [--with-transfer] [--cast role=email,...]'); process.exit(1); }
  const real = adminDb();
  const company = await real.collection('companies').doc(CID).get();
  if (!company.exists) { console.error(`No company with id "${CID}".`); process.exit(1); }
  console.log(`Company: ${company.get('name')} (${CID})  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  // ---- who plays whom
  const snap = await real.collection('employees').where('companyId', '==', CID).get();
  const people = snap.docs.map((d) => ({ uid: String(d.get('authUid') || d.id), email: String(d.get('email') || '').toLowerCase(), name: String(d.get('name') || d.get('email') || ''), title: String(d.get('title') || d.get('designation') || ''), dept: String(d.get('departmentName') || ''), active: d.get('active') !== false }))
    .filter((p) => p.active && p.email).sort((a, b) => a.email.localeCompare(b.email));
  const cast = {} as Record<Role, (typeof people)[number]>;
  const named = Object.fromEntries(CAST_ARG.split(',').filter(Boolean).map((x) => x.split('=').map((s) => s.trim().toLowerCase())));
  for (const r of ROLES) if (named[r]) { const p = people.find((x) => x.email === named[r]); if (!p) { console.error(`--cast ${r}: no active employee ${named[r]}`); process.exit(1); } cast[r] = p; }
  const used = new Set(Object.values(cast).map((p) => p.uid));
  for (const r of ROLES) if (!cast[r]) { const p = people.find((x) => !used.has(x.uid)); if (!p) { console.error(`Need at least ${ROLES.length} active employees with an email; found ${people.length}.`); process.exit(1); } cast[r] = p; used.add(p.uid); }
  console.log('\nCast:');
  const blurb: Record<Role, string> = { boss: 'founder / business head', hr: 'HR and HRBP (does the admin steps)', asha: 'software engineer, over-allocated', bilal: 'software engineer, on the bench', chen: 'sales executive', dev: 'sales manager', esha: 'new joiner on probation' };
  for (const r of ROLES) console.log(`  ${r.padEnd(6)} ${cast[r].name} <${cast[r].email}>  — ${blurb[r]}`);
  if (!APPLY) { console.log('\nDry run: nothing written. Re-run with --apply to write the data.'); return; }

  // ---- run the real handlers against the real database, with identities we make up from the cast
  __useFakeAdmin({ db: real, auth: { verifyIdToken: async (t: string) => JSON.parse(Buffer.from(t, 'base64').toString()) } });
  const H = tok(cast.hr.uid, cast.hr.email, ['hrbp.manage', 'pm.manage', 'pm.approve'], true);
  const as = (r: Role) => tok(cast[r].uid, cast[r].email);
  const hrbp = (h: any, method: 'GET' | 'POST', action: string, body: any = {}, query: any = {}) => routeHrbp({ method, action, headers: h, body, query });
  const pm = (h: any, method: 'GET' | 'POST', action: string, body: any = {}, query: any = {}) => routePm({ method, action, headers: h, body, query });
  const exists = async (listAction: string, test: (i: any) => boolean) => { const r = await hrbp(H, 'GET', listAction); return (r.json?.items || []).some(test); };
  const U = (r: Role) => cast[r].uid;

  if (ONLY !== 'pm') {
    console.log('\nHR Business Partner');
    // 1 business units
    for (const bu of [{ name: 'Delivery', headUid: U('boss'), defaultHrbpUid: U('hr'), description: 'Software projects (sample data)' }, { name: 'Sales', headUid: U('dev'), defaultHrbpUid: U('hr'), description: 'Sales (sample data)' }]) {
      report(`business unit ${bu.name}`, await hrbp(H, 'POST', 'bu-save', bu));
    }
    // 2 mapping
    const maps: any[] = [
      { employeeUid: U('asha'), businessUnit: 'Delivery', costCentre: 'CC-10', billable: true, clientAllocation: [{ client: 'Acme', percent: 60 }, { client: 'Beta', percent: 50 }], hrbpUid: U('hr') },
      { employeeUid: U('bilal'), businessUnit: 'Delivery', costCentre: 'CC-10', billable: true, clientAllocation: [] },
      { employeeUid: U('chen'), businessUnit: 'Sales', costCentre: 'CC-20', billable: false },
    ];
    for (const m of maps) report(`mapping ${cast[(Object.keys(cast) as Role[]).find((k) => cast[k].uid === m.employeeUid)!].name}`, await hrbp(H, 'POST', 'map-save', m));
    // 3 positions
    for (const p of [{ title: 'Head of Sales', department: 'Sales', businessUnit: 'Sales', reportsToUid: U('boss'), critical: true, status: 'VACANT' }, { title: 'Delivery Lead', department: 'Delivery', businessUnit: 'Delivery', reportsToUid: U('boss'), critical: false, status: 'FILLED', incumbentUid: U('asha') }]) {
      report(`position ${p.title}`, (await exists('pos-list', (i) => i.title === p.title)) ? null : await hrbp(H, 'POST', 'pos-save', p), 'already there');
    }
    // 4 transfer (edits a real employee, so only when asked)
    if (WITH_TRANSFER) report('transfer: Chen to Delivery under Asha', await hrbp(H, 'POST', 'transfer-save', { employeeUid: U('chen'), department: 'Delivery', businessUnit: 'Delivery', managerUid: U('asha'), reason: 'Moved to the Acme project (sample data)' }));
    else report('transfer', null, 'left out: add --with-transfer; it edits a real employee');
    // 6 talent review
    for (const [r, perf, pot, fr, notes] of [['asha', 3, 3, 'HIGH', 'Poaching risk'], ['bilal', 2, 2, 'LOW', ''], ['chen', 1, 2, 'MEDIUM', '']] as const) {
      report(`talent review ${cast[r].name}`, await hrbp(H, 'POST', 'talent-save', { employeeUid: U(r), quarter: quarter(), performance: perf, potential: pot, flightRisk: fr, notes }));
    }
    // 7 KPIs
    for (const k of [
      { scope: 'EMPLOYEE', employeeUid: U('asha'), name: 'Tickets closed', target: 40, actual: 38, direction: 'HIGHER', period: quarter() },
      { scope: 'EMPLOYEE', employeeUid: U('chen'), name: 'Revenue booked (lakh)', target: 20, actual: 9, direction: 'HIGHER', period: quarter() },
      { scope: 'DEPARTMENT', department: cast.asha.dept || 'Delivery', name: 'Bugs per release', target: 5, actual: 8, direction: 'LOWER', period: quarter() },
    ]) report(`KPI ${k.name}`, (await exists('kpi-list', (i) => i.name === k.name && i.period === k.period)) ? null : await hrbp(H, 'POST', 'kpi-save', k), 'already there');
    // 8 probation
    report(`probation for ${cast.esha.name}`, await hrbp(H, 'POST', 'prob-start', { uid: U('esha'), joinDate: ist(0) }));
    // 9 OKRs
    const existingOkrs = (await hrbp(H, 'GET', 'okr-list')).json?.items || [];
    let companyOkr = existingOkrs.find((o: any) => o.title === 'Make delivery predictable' && o.level === 'COMPANY');
    if (!companyOkr) { const r = report('OKR company: Make delivery predictable', await hrbp(H, 'POST', 'okr-save', { level: 'COMPANY', quarter: quarter(), title: 'Make delivery predictable', keyResults: [{ title: 'Releases on time', start: 60, target: 90, unit: '%' }, { title: 'Bugs per release', start: 12, target: 5, unit: '' }] })); companyOkr = r?.item; }
    else report('OKR company', null, 'already there');
    if (companyOkr && !existingOkrs.some((o: any) => o.title === 'Delivery team: ship every sprint')) {
      report('OKR team: Delivery', await hrbp(H, 'POST', 'okr-save', { level: 'TEAM', teamName: 'Delivery', quarter: quarter(), parentId: companyOkr.id, title: 'Delivery team: ship every sprint', keyResults: [{ title: 'Sprints shipped', start: 0, target: 6, unit: '' }] }));
    }
    // 10 improvement plan (left as a draft for you to send)
    report(`improvement plan for ${cast.chen.name} (draft)`, await hrbp(H, 'POST', 'pip-save', { employeeUid: U('chen'), startOn: ist(0), endOn: ist(60), reason: 'Revenue well below target for the quarter (sample data).', goals: [{ text: 'Book 10 demos', dueOn: ist(30) }, { text: 'Update CRM daily', dueOn: ist(30) }, { text: 'Close 2 deals', dueOn: ist(60) }] }));
    // 11 training needs
    for (const n of [{ employeeUid: U('bilal'), skill: 'System design', source: 'MANAGER', priority: 'MEDIUM' }, { employeeUid: U('chen'), skill: 'Negotiation', source: 'REVIEW', priority: 'HIGH' }]) {
      report(`training need: ${n.skill}`, (await exists('need-list', (i) => i.skill === n.skill && i.employeeUid === n.employeeUid)) ? null : await hrbp(H, 'POST', 'need-save', n), 'already there');
    }
    // 12 learning path + assignment
    let path = ((await hrbp(H, 'GET', 'path-list')).json?.items || []).find((p: any) => p.name === 'New engineer onboarding');
    if (!path) path = report('learning path', await hrbp(H, 'POST', 'path-save', { name: 'New engineer onboarding', role: 'Software Engineer', steps: [{ title: 'Git basics', type: 'COURSE', hours: 4 }, { title: 'Code review standards', type: 'READING', hours: 2 }] }))?.item;
    else report('learning path', null, 'already there');
    if (path) report('assign path to Esha and Bilal', await hrbp(H, 'POST', 'path-assign', { pathId: path.id, employeeUids: [U('esha'), U('bilal')], dueOn: ist(45) }));
    // 13 certificates
    for (const c of [{ employeeUid: U('asha'), name: 'AWS Cloud Practitioner', issuedOn: '2025-01-10', expiresOn: ist(25), mandatory: true }, { employeeUid: U('bilal'), name: 'Security awareness training', issuedOn: '2025-10-01', expiresOn: ist(-40), mandatory: true }]) {
      report(`certificate ${c.name}`, (await exists('cert-list', (i) => i.name === c.name && i.employeeUid === c.employeeUid)) ? null : await hrbp(H, 'POST', 'cert-save', c), 'already there');
    }
    // 14 retention, 15 succession
    report('retention plan for Asha', await hrbp(H, 'POST', 'retention-save', { employeeUid: U('asha'), risk: 'HIGH', reasons: 'Competing offer', actions: 'Discuss growth path and review pay', ownerUid: U('hr'), status: 'OPEN', reviewOn: ist(30) }));
    report('succession: Head of Sales', await hrbp(H, 'POST', 'succ-save', { role: 'Head of Sales', critical: true, successors: [{ employeeUid: U('chen'), readiness: 'THREE_PLUS_YEARS' }] }));
    // 16 survey, answered by six people so the results show
    let survey = ((await hrbp(H, 'GET', 'survey-list')).json?.items || []).find((s: any) => s.title === 'November pulse');
    if (!survey) {
      survey = report('survey November pulse', await hrbp(H, 'POST', 'survey-save', { title: 'November pulse', closesOn: ist(14), questions: [{ text: 'I know what is expected of me', type: 'scale' }, { text: 'I would recommend working here', type: 'scale' }, { text: 'What one thing should we improve?', type: 'text' }] }))?.item;
      if (survey) {
        const answers: Record<string, [number, number, string]> = { boss: [5, 5, 'Planning'], hr: [4, 4, 'Tools'], asha: [3, 4, 'Workload'], bilal: [4, 3, 'Training'], chen: [2, 3, 'Targets'], dev: [4, 4, 'Hiring'] };
        for (const [r, [a, b, t]] of Object.entries(answers)) report(`  survey answer (${r})`, await hrbp(as(r as Role), 'POST', 'survey-respond', { surveyId: survey.id, answers: { q1: a, q2: b, q3: t } }));
      }
    } else report('survey November pulse', null, 'already there');
    // 17 wellness, 18 recognition
    const well = ((await hrbp(H, 'GET', 'well-list')).json?.items || []).find((w: any) => w.title === 'Yoga Friday')
      || report('wellness: Yoga Friday', await hrbp(H, 'POST', 'well-save', { title: 'Yoga Friday', type: 'EVENT', date: ist(7), description: 'Sample data' }))?.item;
    if (well?.id) report('Chen joins Yoga Friday', await hrbp(as('chen'), 'POST', 'well-join', { id: well.id }));
    if (!(await exists('recog-list', (i) => i.toUid === U('bilal') && /release/i.test(i.message)))) report('recognition: Chen thanks Bilal', await hrbp(as('chen'), 'POST', 'recog-give', { toUid: U('bilal'), value: 'Ownership', message: 'Stayed late to fix the release.' }));
    else report('recognition', null, 'already there');
    // 19 quarterly round
    report(`quarterly round ${quarter()}`, await hrbp(H, 'POST', 'qc-open', { quarter: quarter() }));
    // 20 promotion: proposed and recommended; the founder step is left for you
    const havePromo = (await hrbp(H, 'GET', 'promo-list')).json?.items?.some((p: any) => p.uid === U('bilal') && p.toTitle === 'Senior Software Engineer');
    const promo = report('promotion: Bilal to Senior Software Engineer', havePromo ? null : await hrbp(H, 'POST', 'promo-propose', { uid: U('bilal'), toTitle: 'Senior Software Engineer', effectiveDate: ist(30), newCtcLpa: 14, justification: 'Led two releases and mentored the newest engineer this quarter (sample data).' }), 'already there');
    if (promo?.item?.id) report('  HR recommends it (founder decision left for you)', await hrbp(H, 'POST', 'promo-act', { id: promo.item.id, action: 'recommend', note: 'Strong quarter.' }));
  }

  if (ONLY !== 'hrbp') {
    console.log('\nPerformance');
    const setup = (await pm(H, 'GET', 'setup')).json;
    if (setup?.settings?.setupDone) report('setup wizard', null, 'already finished for this company; leaving it alone');
    else {
      report('weights 60/25/15', await pm(H, 'POST', 'setup-save', { step: 'weights', weights: { results: 60, behaviour: 25, sop: 15 } }));
      report('behaviours (standard 12 + manager extras)', await pm(H, 'POST', 'setup-save', { step: 'behaviours', competencies: setup?.settings?.competencies, managerExtras: true }));
      // SOPs: up to two published documents already in Document Governance
      const docs = (await real.collection('documents').where('companyId', '==', CID).get()).docs.filter((d) => d.get('currentPublishedVersionId')).slice(0, 2);
      if (docs.length) report(`SOPs (${docs.length} published document${docs.length > 1 ? 's' : ''})`, await pm(H, 'POST', 'setup-save', { step: 'sops', sops: docs.map((d) => ({ documentId: String(d.get('documentId') || d.id), departments: [], designations: [] })) }));
      else report('SOPs', null, 'no published documents found, so none picked');
      const k = (id: string, kra: string, kpi: string, measure: string, weight: number) => ({ id, kra, kpi, measure, weight });
      const tpls: Record<string, any[]> = {
        'Software Engineer': [k('k1', 'Delivery', 'Tickets closed on time', 'Task tracker', 40), k('k2', 'Quality', 'Bugs found after release', 'Bug tracker', 35), k('k3', 'Teamwork', 'Code reviews done', 'Repository', 25)],
        'Sales Executive': [k('s1', 'Revenue', 'Deals closed value', 'CRM', 50), k('s2', 'Pipeline', 'Demos booked', 'CRM', 30), k('s3', 'Hygiene', 'CRM updated daily', 'CRM', 20)],
      };
      // Anyone whose real job title has no sample template gets a simple one, so their plan can start.
      for (const r of ROLES) { const t = cast[r].title; if (t && !tpls[t]) tpls[t] = [k('g1', 'Core work', 'Goals delivered on time', 'Manager review', 60), k('g2', 'Quality', 'Work accepted without rework', 'Manager review', 40)]; }
      for (const [designation, kpis] of Object.entries(tpls)) report(`KRA/KPI template: ${designation}`, await pm(H, 'POST', 'tpl-save', { designation, kpis }));
      report('timing (defaults)', await pm(H, 'POST', 'setup-save', { step: 'timing', timing: { selfDays: 7, managerDays: 7, hrDays: 5, publishDelayDays: 2, remindEvery: 3, escalateAfter: 7 } }));
      report('finish setup', await pm(H, 'POST', 'setup-save', { step: 'finish' }));
    }
    report('start plans (daily job)', await pm(H, 'POST', 'run-daily'));
    // Targets: set by each person's own manager, approved by HR. Only where a manager already exists.
    const plans: any[] = (await pm(H, 'GET', 'plans')).json?.items || [];
    const castUids = new Set(ROLES.map((r) => cast[r].uid));
    const profile = async (uid: string) => (await real.collection('leaveProfiles').doc(`${CID}__${uid}`).get()).get('managerUid') as string | undefined;
    for (const p of plans.filter((x) => castUids.has(x.uid) && x.status === 'SET_TARGETS')) {
      const mUid = await profile(p.uid);
      const m = people.find((x) => x.uid === mUid);
      if (!m) { report(`targets for ${p.name}`, null, 'no manager set in Leave & Attendance; set targets as the manager'); continue; }
      const targets = p.kpis.map((kp: any) => ({ id: kp.id, target: /ticket|deal|revenue/i.test(kp.kpi) ? '40 per quarter' : /bug/i.test(kp.kpi) ? 'Fewer than 3' : '90% or better' }));
      const set = report(`targets for ${p.name} (by ${m.name})`, await pm(tok(m.uid, m.email), 'POST', 'plan-targets', { id: p.id, kpis: targets, send: true }));
      if (set) report(`  HR approves ${p.name}'s targets`, await pm(H, 'POST', 'plan-approve', { id: p.id }));
    }
    console.log('\n  Left for you to do by hand (that is the point): open the quarterly review cycle, then self-review, manager review, HR approval, Needs attention and Reports.');
  }

  console.log(`\nDone: ${ok} written, ${skipped} skipped, ${failed} failed.`);
  if (failed) console.log('A FAIL line usually means a rule was not met (see its message); nothing half-written is left behind for that step.');
}

main().catch((e) => { console.error(e); process.exit(1); });
