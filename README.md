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

## Job descriptions and candidate scoring

- A role's job description is found automatically, best first: one edited on the evaluation screen, then the JD stored on
  the company's own hiring requisition (open or closed; drafts are ignored), then what the careers website returns. HR with `req.manage_jd` can write or edit one for any role from
  Talent Acquisition > candidate evaluation > "View / edit JD" (or generate a draft with AI). It is stored in the
  server-only `jobDescriptions` collection and takes priority over the source; "Revert" goes back to the source.
- With no job description a role has no criteria, so applicants show "Not scored" instead of a made-up score.
- Applicants are scored from their resume, not from a spreadsheet's Pros/Cons columns: first a free match of the JD
  requirements against the resume text ("Resume match"), then "Evaluate with AI" for a deeper reading ("AI").
  Resumes are read a few at a time within a time budget (`KEYWORD_PASS_BUDGET_MS`, default 7000); refresh to continue.
- Repeat applications by the same person (same email, else mobile, else name) are merged into their latest one in the
  ranking. The raw Overview counts still show every application.

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
