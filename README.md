# HR Portal (multi-tenant)

Companies sign themselves up, wait for approval, then onboard their own employees, departments and
custom roles. Built on Vite + React, Express / Vercel functions, Firestore and Firebase Authentication.

## How it works

- **Sign-up**: a company registers with email + password. It is `PENDING` and can see nothing until a
  platform admin approves it (then it is `ACTIVE` with the modules you enable).
- **Login**: email + password only. The server looks up which company the account belongs to.
- **Roles**: each company gets default roles (Company Admin, Head HR, HR, Approver/Founder, Department
  Head, Employee) and can create its own from a permission checklist. Nobody can grant a permission they
  do not hold themselves.
- **Security**: the server (Firebase Admin "master key") creates logins and writes `cid / cs / perms / adm`
  claims onto the user's ID token. `firestore.rules` and every API route trust only those claims, so one
  company can never read another's data.

## Setup

1. Create a Firebase project with **Authentication (Email/Password)** and **Firestore**; put the web config
   in `firebase-applet-config.json`.
2. Create a service account key (Project settings > Service accounts) and set
   `FIREBASE_SERVICE_ACCOUNT_JSON` (see `.env.example`).
3. Deploy the rules: `firebase deploy --only firestore:rules`.
4. Make yourself platform admin (can approve companies):
   `npx tsx scripts/make-platform-admin.ts you@example.com --create 'a-strong-password'`
5. `npm install && npm run dev` (or deploy to Vercel with the same env vars).

### Migrating the existing single company

`npx tsx scripts/migrate-to-multitenant.ts --company "Amaavigo Group" --admin admin@yourco.com`
(add `--dry-run` first). It prints the company id: set it as `HOME_COMPANY_ID`.

## Leave & Attendance

Sidebar item "Leave & Attendance" (and a tab in the employee portal). Everyone can apply for leave, check in/out
and see their own balances; managers approve their team; HR (`leave.manage`) sets everything up; `leave.report`
gives read-only company reports. Existing roles need `leave.manage` / `leave.report` added in Administration.

- Setup (HR): leave year (calendar or financial or any start month, per leave type if needed), locations with
  weekly offs and holidays (CSV import), leave types, policies (quota, accrual, carry-forward), shift and late rules,
  people (location, policy, manager, join date; CSV import) and opening balances (CSV import).
- Balances are a ledger (credits and debits), so every change is traceable. Daily accrual and the year-end
  carry-forward/lapse are idempotent. Schedule `GET /api/leave/cron?key=$CRON_SECRET` daily (cronjob.org, early
  morning IST); HR can also press "Run accrual now".
- Approvals: manager, or manager then HR, per leave type; reminders to the HR mailboxes in Setup.
- Attendance: web check-in/out (optional IP allow-list), shifts with grace, late marks, missed-swipe corrections
  approved by the manager, monthly report with loss-of-pay days (CSV export). No payroll integration yet.
- Statutory defaults (maternity 26 weeks, state minimums) are starting points; confirm with a labour-law advisor.
- Collections: `leaveSettings`, `leaveProfiles`, `leaveLedger`, `leaveRequests`, `leaveAttendance`,
  `leaveRegularizations` (server-only; deploy the updated `firestore.rules`).

## Employee 360

Employee → Reports → **Employee 360** (Company Admin, `lifecycle.manage` or `leave.manage` only). Searchable list of all employees (filter by department, include former staff, CSV of the basic list). Opening a row shows that person's employment details, identity documents (numbers masked until revealed, photos viewable), personal information, family and qualifications (with certificates) on one read-only page. It reuses the existing profile endpoints, so the server-side permission checks are unchanged.

## Home page

Everyone lands on Home after signing in. It shows a profile card (reporting and approving manager, or the manager covering today), a mood check-in, a leave calendar, online attendance (punch in/out with remarks), quick links and reports, employees on leave, birthdays and anniversaries, important files, CEO speak, announcements, acknowledgements and (for people who manage users) a web/mobile login chart. The old "needs your attention" widgets stay on top.

- Routes live under `/api/leave/home-<action>` (they share the leave function to stay within the Vercel Hobby limit of 12 functions). Code: `api/_lib/homeApi.ts`, `shared/home.ts`, `src/components/home/`.
- New permissions `announce.manage` and `home.manage`. Company Admin has them automatically; Head HR gets both, HR and Approver/Founder get `announce.manage` on new companies. **Existing roles must be given these in Administration.**
- New server-only collections (`homeSettings`, `announcements`, `moodCheckins`, `loginDaily`, `personalDates`). Deploy the rules: `firebase deploy --only firestore:rules`.
- Privacy: birth and marriage dates are kept in `personalDates`, never on the employee document. Colleagues see only day and month, marriage only if the person turns it on, mood only as company-wide counts, and leave only as names and dates.
- Attendance: people can punch in and out many times a day (washroom, lunch). Worked time is the sum of the stretches; the gaps are not counted. Records keep `checkIn` (first in) and `checkOut` (last out) plus a `sessions` list; old one-pair records still work. A stretch left open on a past day shows Incomplete until corrected. Any worked time is at least a half day, never Absent.
- Leave & Attendance > Regularization: a full table for one month and one person (own, direct reports for managers, everyone for HR/report viewers): punch in/out, total hours, "less hours worked", approved corrections (AR columns), info panel with every punch, CSV export. The pencil asks for a fix on your own days, or lets HR set the real times for someone else.
- Leave & Attendance > Attendance application: one form for one or more days (route `apply-attendance`). Per day, tick "update time in" and/or "update time out"; unticked parts stay as recorded. Dates go back to the joining date. Each form gets a doc number (AA-...). Employees apply for themselves (manager approves); a manager can apply for a direct report (HR approves); HR can apply for anyone (applied straight away).
- Leave & Attendance > Attendance reports: In Out Activities, Daily Detail Attendance, Absent, Pending Attendance Applications, Detail In Out Summary, Employee Attendance, Late Coming, Early Going, Half Day and Missed Punch. Pick one employee or (managers: their team, HR: everyone), a date range or month, then Generate, Download CSV or Print/PDF. Data from `attendance-report` (max 93 days) and `pending-applications`; the reports are built in `src/components/leave/attendanceReports.ts`. Not built: Rejected Offline Punches and Employee Change Shift (they need biometric machines and per-employee shifts, which this system does not have), selfie images, and the logo layout option.
- Not built yet: Help Desk, Survey, dependent files.

## Job descriptions and candidate scoring

- A role's job description is found automatically, best first: one edited on the evaluation screen, then the JD stored on
  the company's own hiring requisition (open or closed; drafts are ignored), then what the careers website returns. HR with `req.manage_jd` can write or edit one for any role from
  Talent Acquisition > candidate evaluation > "View / edit JD" (or generate a draft with AI). It is stored in the
  server-only `jobDescriptions` collection and takes priority over the source; "Revert" goes back to the source.
- With no job description a role has no criteria, so applicants show "Not scored" instead of a made-up score.
- Applicants are scored from their resume, not from a spreadsheet's Pros/Cons columns: first a free match of the JD
  requirements against the resume text ("Resume match"), then "Evaluate with AI" for a deeper reading ("AI").
  Resume links may be on any public host (https or plain http), or a Google Drive / Docs / Dropbox share link, and may be a
  PDF, .docx or old .doc; a link the server cannot read says why, with the host. Private addresses are refused.
  Resumes are read a few at a time within a time budget (`KEYWORD_PASS_BUDGET_MS`, default 7000); refresh to continue.
- Repeat applications by the same person (same email, else mobile, else name) are merged into their latest one in the
  ranking. The raw Overview counts still show every application.

## Vercel function budget

Vercel's Hobby plan allows 12 serverless functions. The app uses 8: `[...catchall]` (also answers `/api/health`), `apply/[webhookId]`,
`email/[action]`, `hrbp/[action]`, `leave/[action]`, `onboarding/[action]`, `recruitment/[action]` and `tenant/[action]`.
All hiring routes share `recruitment/[action]` through `api/_lib/hiringRouter.ts`, told apart by the action name:
`app-<action>` (candidate applications, was `/api/applications/<action>`), `careers-publish` (was `/api/careers/publish`),
`generate-jd` (was `/api/requisitions/generate-jd`), plus the overview and job-description actions.
**Add new hiring features as actions in `hiringRouter.ts`, not as new files under `api/`.**

## Hiring pipeline (Talent Acquisition)

Everything below is native to the app (no n8n) and per company. Server code is in `api/_lib/`, pure rules in `shared/`, screens in `src/components/hiring/`.

| Step | What it does | Where |
| --- | --- | --- |
| Requisition fields, budget, Position ID | Work mode, reporting manager, CTC band; department budget check; founder approval issues `POS-<CO>-<YEAR>-<NNN>` (a reason is required outside budget) | `hiringBudgetApi.ts`, `shared/hiringBudget.ts` |
| JD library, posting tracker, referrals | Reusable JDs; paste-ready posts per job board plus a tracker (only the careers site is published automatically); employee referral page (**Referrals & interviews**) | `pipelineApi.ts` |
| Candidate score | Out of 100: Skills 30, Experience 25, Portfolio 15, Communication 10, Stability 10, Salary fit 10 (weights editable per company). A part nobody has judged is "pending", never zero | `shared/hiringScore.ts` |
| Screening, assessments | HR screening call with pass / hold / fail (moves the stage); tests with a pass mark | `interviewApi.ts` |
| Interviews | Scheduling with `.ics` invites by email, clash warning for interviewers, reminders (24 h and 1 h), reschedule and cancel | `interviewApi.ts`, `shared/interviewEngine.ts` |
| Interview feedback | Blind scorecards: an interviewer sees only their own card until the whole panel has submitted; a summary is made after that | `interviewApi.ts` |

Data lives in the server-only collection `hiringItems` (told apart by `kind`). Resume reading handles text-based PDF/DOCX; scanned images need OCR, which is not set up.
Reminders run from a Vercel cron (`vercel.json`, once a day on the Hobby plan, so the 1-hour reminder is best-effort there); set `CRON_SECRET` so the cron call is accepted, or press "send reminders" as HR.
WhatsApp reminders and real calendar sync (Google / Microsoft) are not built; the invite is a standard `.ics` attachment.

## HR Business Partner (Phase 3)

`/api/hrbp/<action>` (`api/_lib/hrbpApi.ts`, rules in `shared/hrbpEngine.ts`, screens in `src/components/hrbp/`, sidebar item **HR Business Partner**).
Permissions: `hrbp.manage` (run the toolkit) and `hrbp.view` (leadership dashboard). Data lives in the server-only collection `hrbpItems`.

Employee business mapping (HRBP-001), org structure, headcount against approved numbers and resource planning (HRBP-002 to 004), quarterly talent review with the 9-box (HRBP-005),
KPI governance (HRBP-006), performance improvement plans (HRBP-007), anonymous pulse surveys (HRBP-008, results hidden below 5 answers), recognition (HRBP-009), wellness (HRBP-010),
training needs (HRBP-011), learning paths (HRBP-012), certificate tracker (HRBP-013), retention planning, succession planning and the leadership dashboard.
Existing companies need `hrbp.manage` / `hrbp.view` / `hiring.budget.manage` granted to the right roles (new companies get them from the role templates).

## Offers, joining, probation, growth, AI and the founder dashboard

All of this is built inside the existing functions (still 9 of 12 on Vercel). Hiring routes are actions of `/api/recruitment/<action>`; probation, OKRs and promotions are actions of `/api/hrbp/<action>`.

- **Offers** (`api/_lib/offerApi.ts`, `shared/offerEngine.ts`): HR raises an offer from a candidate; a CTC above the job's band needs a written reason; the founder approves (or counters); the offer pack (letter, compensation breakup, joining checklist, NDA, employment agreement) is built from editable templates; the candidate answers on a private page (`/?offer=<token>`); accepting starts onboarding automatically. Reminders every 2 days, "no response" after 7 days, expiry on the valid-till date, joining reminders at 7 days and 1 day. **The NDA and employment agreement are generic drafts and must be reviewed by a lawyer.**
- **Joining board** (`joiningApi.ts`): documents and emergency contact status, welcome kit, IT setup (email, Microsoft 365, Google, Teams, ClickUp, attendance, payroll) and an asset register with unique tags.
- **Probation, OKRs, promotions, quarterly round** (`talentCycleApi.ts`, `shared/talentCycle.ts`): 30/60/90-day manager reviews with reminders, HR decision (confirm, extend, end); OKRs at company, team and individual level; promotion flow manager -> HR -> founder -> applied; one quarterly checklist. Applying a promotion changes the designation only; the salary revision is created by hand in Payroll. Probation KPI achievement is entered by the manager.
- **AI** (`aiHiringApi.ts`, `openaiHelper.ts`, `shared/resumeAi.ts`): resume reading (including scanned PDFs and photos), employment gaps and stability, duplicate detection and merge, candidate comparison, hiring recommendation, follow-up email drafts and a dashboard summary. The model only reads and writes language; scores and verdicts are fixed rules. Names are never sent to the AI and interview feedback counts only once the whole panel has submitted. With no key every feature falls back to rules.
- **Founder dashboard** (`analyticsApi.ts`, `shared/hiringAnalytics.ts`): vacancies, pipeline, time to hire, offer acceptance, cost per hire, upcoming joinings, budget vs actual, source effectiveness, attrition. Visible to company admins, the founder permission, `hrbp.view` and `hrbp.manage`.
- **Candidate screening link** (`screeningLinkApi.ts`): the candidate fills a short form and picks time slots on `/?screen=<token>`; status is Pending, Completed, Reschedule or No response (after 3 days).
- **Outside connections** (`integrations.ts`): Microsoft Teams meeting links and WhatsApp reminders switch on when their variables are set; Google Meet and ClickUp are manual. Everything works without them.
- **Daily job**: one cron, `/api/recruitment/hiring-daily` (needs `CRON_SECRET`), runs offer reminders and expiry, probation and quarterly reminders, interview reminders and the screening-link sweep.

Environment variables: `OPENAI_API_KEY`, `OPENAI_HIRING_MODEL` (optional, default gpt-4o-mini), `AI_MONTHLY_CALLS` (optional limit per company), `APP_BASE_URL` (the public address used in emailed links), `CRON_SECRET`, and optionally `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_ORGANIZER_UPN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`.
Existing roles need the permissions `hrbp.manage`, `hrbp.view` and `hiring.budget.manage` granted where HR and the founder should use these screens.

## Known limits

- Talent Acquisition, onboarding and AI candidate evaluation are per company. Companies other than
  `HOME_COMPANY_ID` take applications through their own webhook (`/api/apply/<id>`), manual entry or CSV import,
  and open jobs come from their requisitions. The home company keeps the original website and Google Sheet
  sources. Leave `HOME_COMPANY_ID` empty only if every company should use the built-in data.
- Webhook candidates give a resume link (no file upload). The webhook rate limit is per server instance.
- Onboarding records created before multi-company support have no `companyId`; they are treated as the home
  company's. Run `npx tsx scripts/backfill-onboarding-company.ts --company <id>` to tag them.
- Email is sent from one shared SMTP account for all companies.
- Leave: festival holidays must be added or imported each year; leave years anchored to each person's joining date,
  hourly leave, and days-worked earned leave are not built yet.
- Some screens and document stamps still say "Amaavigo".
- Old uploaded-file links have no signature; set `LEGACY_OPEN_STORAGE=true` while migrating, then off.
- Requisition step-by-step workflow rules are enforced in the app; the Firestore rules enforce tenant and
  permission checks only.
