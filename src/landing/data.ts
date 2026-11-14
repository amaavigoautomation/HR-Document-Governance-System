import {
  BellRing,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  FileClock,
  FileText,
  GitBranch,
  IndianRupee,
  KanbanSquare,
  LayoutList,
  LineChart,
  ListChecks,
  Mail,
  Network,
  Paperclip,
  Receipt,
  ScrollText,
  Target,
  UserPlus,
  Users,
  Video,
  Wallet,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { ModuleKey } from './routes';

export type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
export type Tone = 'violet' | 'green' | 'amber' | 'blue' | 'rose' | 'teal' | 'slate';

export interface Highlight {
  icon: IconType;
  title: string;
  text: string;
}

export interface ModuleDef {
  key: ModuleKey;
  tone: Tone;
  icon: IconType;
  name: string;
  short: string;
  tagline: string;
  headline: string;
  intro: string;
  points: string[];
  highlights: Highlight[];
  steps: { title: string; text: string }[];
}

export const MODULES: ModuleDef[] = [
  {
    key: 'hiring',
    tone: 'violet',
    icon: Briefcase,
    name: 'Talent acquisition',
    short: 'Requests to joining, on autopilot',
    tagline: 'From the first request to the first day, in one flow you can shape for your own company.',
    headline: 'Hire faster without the follow-up.',
    intro: 'Managers raise a request, the right people approve it, and the platform handles the job post, the ranking, the tests, the interviews and the offer.',
    points: [
      'Hiring requests with budget checks and a final approval',
      'AI-drafted job descriptions, published to your careers page',
      'Candidates ranked against each job, with blind interview scorecards',
      'Interviews with Google Meet links, offers and joining set-up',
    ],
    highlights: [
      { icon: ClipboardCheck, title: 'Requests that approve themselves along the way', text: 'A manager asks, HR reviews, the founder gives the final nod. Departments stay within their approved headcount and budget.' },
      { icon: LineChart, title: 'Candidates ranked, not just collected', text: 'Each applicant is scored against the job from their resume, so the best matches come to the top instead of the latest.' },
      { icon: Video, title: 'Interviews without the back-and-forth', text: 'Meet links are created for you, invites go out by email, and interviewers submit blind scorecards before seeing each other’s views.' },
      { icon: Mail, title: 'Offers that send on approval', text: 'Once the founder approves, the offer goes to the candidate. Acceptance flows straight into joining and onboarding.' },
    ],
    steps: [
      { title: 'Request', text: 'A manager raises a hiring request.' },
      { title: 'Approve', text: 'HR and the founder decide.' },
      { title: 'Post and rank', text: 'The job goes live and applicants are scored.' },
      { title: 'Interview and offer', text: 'Tests, interviews and the offer follow your flow.' },
    ],
  },
  {
    key: 'leave',
    tone: 'green',
    icon: CalendarCheck,
    name: 'Leave & attendance',
    short: 'Policies, balances and approvals',
    tagline: 'Policies, balances and approvals that follow your own rules.',
    headline: 'Leave and attendance that run to your rules.',
    intro: 'Set your leave year, types and policies once. Balances build up on their own, managers approve from one place, and every change leaves a trace.',
    points: [
      'Leave types, accrual, carry-forward and a year of your choice',
      'Manager approvals with delegation when someone is away',
      'Check-in and check-out, shifts, late marks and corrections',
      'Reports for every view, with CSV export and print',
    ],
    highlights: [
      { icon: CalendarClock, title: 'A leave year that fits you', text: 'Calendar year, financial year or any start month, with locations, weekly offs and holidays set per place.' },
      { icon: Users, title: 'Approvals that never stall', text: 'Requests go to the manager, then HR if the leave type needs it. When a manager is away, a delegate steps in.' },
      { icon: ListChecks, title: 'Attendance you can trust', text: 'People can punch in and out through the day. Worked time adds up, late marks follow your shift rules, and missed punches are corrected with approval.' },
      { icon: FileClock, title: 'Ten ready-made reports', text: 'Daily detail, absent, late coming, early going, half day, missed punch and more, for one person or a whole team.' },
    ],
    steps: [
      { title: 'Set the rules', text: 'Leave types, policies, shifts and holidays.' },
      { title: 'Balances build', text: 'Accrual and carry-forward run daily.' },
      { title: 'Request and approve', text: 'Employees ask, managers decide.' },
      { title: 'Report', text: 'Attendance and leave flow into reports and payroll inputs.' },
    ],
  },
  {
    key: 'payroll',
    tone: 'amber',
    icon: IndianRupee,
    name: 'Payroll',
    short: 'Salary runs built for India',
    tagline: 'A calm month-end: inputs flow in from attendance, outputs flow out as payslips.',
    headline: 'Payroll that closes without the scramble.',
    intro: 'Attendance and leave feed the month’s inputs. You review the run, approve and lock it, and payslips reach everyone.',
    points: [
      'Salary structures, revisions and arrears',
      'Payroll runs that you review, approve and lock',
      'PF, ESI, professional tax and TDS with declarations',
      'Expense claims, loans and full-and-final settlement',
    ],
    highlights: [
      { icon: Wallet, title: 'Structures you define', text: 'Build salary structures with earnings and deductions, revise them later, and let arrears work themselves out.' },
      { icon: Receipt, title: 'Indian statutory rules built in', text: 'PF, ESI, professional tax and TDS, with employee declarations and an annual tax statement.' },
      { icon: LineChart, title: 'Review before you lock', text: 'See the whole run, compare it with last month, and lock it only when you are happy.' },
      { icon: FileText, title: 'Claims, loans and final settlements', text: 'Employees file expense claims, loans are tracked, and exits produce a full-and-final statement.' },
    ],
    steps: [
      { title: 'Collect inputs', text: 'Attendance and leave feed in automatically.' },
      { title: 'Run', text: 'Salaries and deductions are calculated.' },
      { title: 'Review and lock', text: 'Compare, approve and lock the month.' },
      { title: 'Pay out', text: 'Payslips are available to every employee.' },
    ],
  },
  {
    key: 'performance',
    tone: 'rose',
    icon: Target,
    name: 'Performance',
    short: 'Goals and reviews on a calendar',
    tagline: 'Reviews that run on a calendar instead of a chase.',
    headline: 'Performance reviews that run themselves.',
    intro: 'Define goals per role once, then let review cycles open on time, gather evidence as work happens, and prompt managers when it is their turn.',
    points: [
      'Goals and measures per role, set up once',
      'Review cycles with self and manager assessments',
      'Evidence collected as work happens',
      'Company-wide views that never expose individual scores',
    ],
    highlights: [
      { icon: Target, title: 'Goals set once, reused', text: 'Create measures per role and department, and attach them to people automatically.' },
      { icon: ClipboardCheck, title: 'Cycles on a calendar', text: 'Self and manager assessments open and close on dates you choose, with reminders that do the nagging.' },
      { icon: ListChecks, title: 'Evidence, not memory', text: 'Work from the Tasks module and attendance feeds into reviews, so conversations start from facts.' },
      { icon: LineChart, title: 'Views that protect privacy', text: 'Company-wide dashboards are grouped, never individual. Managers see their own teams.' },
    ],
    steps: [
      { title: 'Set goals', text: 'Measures per role and department.' },
      { title: 'Open a cycle', text: 'Self and manager reviews start on schedule.' },
      { title: 'Gather evidence', text: 'Work and attendance flow in.' },
      { title: 'Review and close', text: 'Managers finalise and HR signs off.' },
    ],
  },
  {
    key: 'people',
    tone: 'blue',
    icon: Network,
    name: 'People & HR partner',
    short: 'Joining, growing, leaving',
    tagline: 'The whole employee story, from joining to exit.',
    headline: 'The whole employee story in one place.',
    intro: 'Profiles, org charts, onboarding and exits, plus the tools an HR business partner needs to look after teams.',
    points: [
      'Employee directory, profiles, identity and qualifications',
      'Org chart, positions and transfers',
      'Onboarding tasks, exit clearance and letters',
      'Pulse surveys, improvement plans and recognition',
    ],
    highlights: [
      { icon: Users, title: 'A profile for every person', text: 'Personal details, family, qualifications and identity documents, with sensitive numbers masked until revealed.' },
      { icon: Network, title: 'Org chart that updates itself', text: 'Reporting lines, positions and span of control follow the people you confirm and the transfers you approve.' },
      { icon: UserPlus, title: 'Joining and leaving, checklisted', text: 'Onboarding tasks for new joiners, exit clearance for leavers, and letters generated for both.' },
      { icon: BellRing, title: 'Care for teams', text: 'Anonymous pulse surveys, improvement plans, recognition and a leadership view for HR partners.' },
    ],
    steps: [
      { title: 'Join', text: 'Onboarding tasks and documents.' },
      { title: 'Map', text: 'Place them on the org chart.' },
      { title: 'Grow', text: 'Surveys, recognition and plans.' },
      { title: 'Exit', text: 'Clearance, settlement and letters.' },
    ],
  },
  {
    key: 'policies',
    tone: 'teal',
    icon: ScrollText,
    name: 'Policies & documents',
    short: 'Versions, reviews, acknowledgements',
    tagline: 'Every policy has an owner, a version and a record of who has read it.',
    headline: 'Policies everyone has actually read.',
    intro: 'Draft, review and publish with a clear version history. See what changed between versions, and track who has acknowledged each one.',
    points: [
      'Draft, review, approve and publish with version history',
      'See exactly what changed between versions',
      'Acknowledgements tracked per person',
      'An audit trail of every decision',
    ],
    highlights: [
      { icon: GitBranch, title: 'Versions that make sense', text: 'Every revision is kept. Compare two versions side by side and see exactly what changed.' },
      { icon: ClipboardCheck, title: 'Review before it goes live', text: 'Creators draft, reviewers approve or ask for changes, and only approved versions are published.' },
      { icon: Users, title: 'Acknowledgements tracked', text: 'Share a policy with the right people, remind those who have not read it, and see completion at a glance.' },
      { icon: FileClock, title: 'A trail you can review', text: 'Key events and decisions are recorded, so you can answer “who approved this and when”.' },
    ],
    steps: [
      { title: 'Draft', text: 'Write or upload the document.' },
      { title: 'Review', text: 'Route it to an approver.' },
      { title: 'Publish', text: 'Share with the intended audience.' },
      { title: 'Track', text: 'Follow acknowledgements and revisions.' },
    ],
  },
  {
    key: 'tasks',
    tone: 'slate',
    icon: KanbanSquare,
    name: 'Tasks',
    short: 'Boards, owners and due dates',
    tagline: 'Day-to-day work with boards, owners and due dates.',
    headline: 'Everyday work, organised.',
    intro: 'Projects, boards and a dashboard for the work that happens between the big HR processes, and a source of evidence for reviews.',
    points: [
      'Projects for the whole company or one department',
      'Managers assign work to their own reports',
      'Boards, lists and a dashboard',
      'Attachments on every task',
    ],
    highlights: [
      { icon: KanbanSquare, title: 'Boards and lists', text: 'See work as a board or a list, move it along, and keep every task’s history in one place.' },
      { icon: Users, title: 'Assignment that respects structure', text: 'Managers assign work to their own reports. Projects can be company-wide or just one department.' },
      { icon: Paperclip, title: 'Files on the task', text: 'Attach documents and images where the work happens, instead of in a separate thread.' },
      { icon: LayoutList, title: 'A dashboard that shows load', text: 'See what is due, what is late and who is overloaded, without a status meeting.' },
    ],
    steps: [
      { title: 'Create', text: 'Make a project and add tasks.' },
      { title: 'Assign', text: 'Managers hand work to their reports.' },
      { title: 'Track', text: 'Move work across the board.' },
      { title: 'Review', text: 'Feed results into performance.' },
    ],
  },
];

export const moduleByKey = (key: ModuleKey): ModuleDef => MODULES.find((m) => m.key === key) || MODULES[0];

export const FAQS: { q: string; a: string }[] = [
  {
    q: 'Do I have to use every module?',
    a: 'No. Switch on only what you need, such as leave first or hiring first, and add the rest later. They share the same people and roles, so nothing has to be entered twice.',
  },
  {
    q: 'Who can see salary information?',
    a: 'Only people you give payroll access to, and each person sees their own payslips. Payroll permissions are not part of any default role except the company admin, so they are handed out on purpose.',
  },
  {
    q: 'Does the AI make decisions about people?',
    a: 'No. It drafts, summarises and flags. Candidate ranking, anomaly flags and policy drafts are for a person to review, and nothing is rejected, paid or changed automatically without a human step.',
  },
  {
    q: 'Can several companies use it?',
    a: 'Yes. Each company has its own people, roles, documents and settings, and only sees its own data. New companies are approved before they can start.',
  },
  {
    q: 'Is payroll only for India?',
    a: 'The statutory side, with PF, ESI, professional tax and TDS, is built for India. Leave, hiring, performance and the other modules are not tied to a country.',
  },
];

export const STATS = [
  { value: 7, label: 'connected modules' },
  { value: 35, suffix: '+', label: 'permissions to shape roles' },
  { value: 6, label: 'ready-made roles' },
  { value: 10, label: 'attendance reports' },
];
