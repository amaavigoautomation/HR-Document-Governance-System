import React, { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Briefcase,
  Building2,
  CalendarCheck,
  Check,
  ChevronRight,
  FileText,
  IndianRupee,
  KeyRound,
  Layers3,
  ListChecks,
  Lock,
  Menu,
  MessageSquare,
  Network,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import { AmaavigoLogo } from './AmaavigoLogo';

type IconType = React.ComponentType<{ size?: number; strokeWidth?: number }>;

/** Outcome-style reasons, kept short: a headline that states the benefit and one supporting line. */
const reasons: { icon: IconType; title: string; text: string }[] = [
  { icon: Layers3, title: 'One workspace for HR', text: 'Hiring, leave, payroll, performance and policies live together, so nobody re-types the same person twice.' },
  { icon: Zap, title: 'Automation does the chasing', text: 'Reminders, approvals, interview links and test marking run on their own. People step in only to decide.' },
  { icon: Building2, title: 'Every company kept separate', text: 'Each company has its own people, roles and data. Add the modules you need and switch off the rest.' },
  { icon: IndianRupee, title: 'Made for Indian payroll', text: 'PF, ESI, professional tax and TDS are built into salary runs, payslips and full-and-final settlements.' },
];

interface ModuleInfo {
  key: string;
  icon: IconType;
  name: string;
  tagline: string;
  points: string[];
}

const modules: ModuleInfo[] = [
  {
    key: 'hiring',
    icon: Briefcase,
    name: 'Talent acquisition',
    tagline: 'From the first request to the first day, in one flow you can shape for your own company.',
    points: [
      'Hiring requests with budget checks and a final approval',
      'AI-drafted job descriptions, published to your careers page',
      'Candidates ranked against each job, with blind interview scorecards',
      'Interviews with Google Meet links, offers and joining set-up',
    ],
  },
  {
    key: 'leave',
    icon: CalendarCheck,
    name: 'Leave & attendance',
    tagline: 'Policies, balances and approvals that follow your own rules.',
    points: [
      'Leave types, accrual, carry-forward and a year of your choice',
      'Manager approvals with delegation when someone is away',
      'Check-in and check-out, shifts, late marks and corrections',
      'Reports for every view, with CSV export and print',
    ],
  },
  {
    key: 'payroll',
    icon: IndianRupee,
    name: 'Payroll',
    tagline: 'A calm month-end: inputs flow in from attendance, outputs flow out as payslips.',
    points: [
      'Salary structures, revisions and arrears',
      'Payroll runs that you review, approve and lock',
      'PF, ESI, professional tax and TDS with declarations',
      'Expense claims, loans and full-and-final settlement',
    ],
  },
  {
    key: 'performance',
    icon: Target,
    name: 'Performance',
    tagline: 'Reviews that run on a calendar instead of a chase.',
    points: [
      'Goals and measures per role, set up once',
      'Review cycles with self and manager assessments',
      'Evidence collected as work happens',
      'Company-wide views that never expose individual scores',
    ],
  },
  {
    key: 'people',
    icon: Network,
    name: 'People & HR partner',
    tagline: 'The whole employee story, from joining to exit.',
    points: [
      'Employee directory, profiles, identity and qualifications',
      'Org chart, positions and transfers',
      'Onboarding tasks, exit clearance and letters',
      'Pulse surveys, improvement plans and recognition',
    ],
  },
  {
    key: 'docs',
    icon: ScrollText,
    name: 'Policies & documents',
    tagline: 'Every policy has an owner, a version and a record of who has read it.',
    points: [
      'Draft, review, approve and publish with version history',
      'See exactly what changed between versions',
      'Acknowledgements tracked per person',
      'An audit trail of every decision',
    ],
  },
  {
    key: 'tasks',
    icon: ListChecks,
    name: 'Tasks',
    tagline: 'Day-to-day work with boards, owners and due dates.',
    points: [
      'Projects for the whole company or one department',
      'Managers assign work to their own reports',
      'Boards, lists and a dashboard',
      'Attachments on every task',
    ],
  },
];

const aiCards = [
  {
    icon: MessageSquare,
    label: 'ASK HR',
    title: 'Answers from your own data and policies',
    text: 'Employees ask about leave balance, notice period or payday and get an answer from their own record and the published policies.',
  },
  {
    icon: Workflow,
    label: 'HIRING AUTOMATION',
    title: 'A hiring flow that moves itself',
    text: 'Skills tests are written from the job description, sent to candidates, and marked automatically. Interviews and offers follow your steps.',
  },
  {
    icon: BellRing,
    label: 'FLAGS',
    title: 'Early warnings, reviewed by a person',
    text: 'Unusual payroll inputs, repeated late marks and odd leave patterns are flagged for HR to look at. Nothing is decided automatically.',
  },
];

const trust: { icon: IconType; title: string; text: string }[] = [
  { icon: Building2, title: 'Separate company data', text: 'Each company only ever sees its own people, documents and records.' },
  { icon: KeyRound, title: 'Roles and permissions', text: 'Build roles from a checklist. Nobody can hand out access they do not hold themselves.' },
  { icon: Lock, title: 'Private files', text: 'Identity documents and attachments are stored privately and opened through signed links.' },
  { icon: ScrollText, title: 'A record of decisions', text: 'Approvals, changes and acknowledgements leave a trail you can review later.' },
];

const steps = [
  { step: '01', title: 'Set up your company', text: 'Sign up, get approved, and add your departments and locations.' },
  { step: '02', title: 'Add people and roles', text: 'Invite your team and give each person only the access they need.' },
  { step: '03', title: 'Switch on what you need', text: 'Start with one module, such as leave or hiring, and add more when ready.' },
  { step: '04', title: 'Let it run', text: 'Reminders, approvals and checks work in the background while you focus on people.' },
];

const marquee = [
  'Hiring', 'Leave', 'Attendance', 'Payroll', 'Performance', 'Org chart', 'Onboarding', 'Exit clearance',
  'Policies', 'Acknowledgements', 'Surveys', 'Tasks', 'Letters', 'Reports',
];

const footerColumns: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Platform',
    links: [
      { label: 'Why Amaavigo', href: '#why' },
      { label: 'Modules', href: '#modules' },
      { label: 'Smart features', href: '#ai' },
      { label: 'Security', href: '#security' },
    ],
  },
  {
    title: 'Modules',
    links: [
      { label: 'Talent acquisition', href: '#modules' },
      { label: 'Leave & attendance', href: '#modules' },
      { label: 'Payroll', href: '#modules' },
      { label: 'Performance', href: '#modules' },
    ],
  },
  {
    title: 'Get started',
    links: [
      { label: 'How it works', href: '#how' },
      { label: 'Sign in', href: '/login' },
    ],
  },
];

export const LandingPage: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModule, setActiveModule] = useState(0);

  const goToLogin = () => {
    window.location.assign('/login');
  };

  const closeMenu = () => setMenuOpen(false);
  const current = modules[activeModule];
  const CurrentIcon = current.icon;

  return (
    <div className="ama-landing min-h-screen bg-white text-slate-900">
      <div className="ama-strip">
        <Sparkles size={13} />
        <span>New: hiring automation and the Ask HR assistant are now part of the platform.</span>
        <a href="#ai">See what’s new <ChevronRight size={13} /></a>
      </div>

      <header className="ama-nav-wrap">
        <nav className="ama-nav" aria-label="Main navigation">
          <a href="#top" className="ama-brand" aria-label="Amaavigo home" onClick={closeMenu}>
            <AmaavigoLogo size="md" variant="full" theme="light" height={38} align="left" />
          </a>

          <div className={`ama-nav-links ${menuOpen ? 'is-open' : ''}`}>
            <a href="#why" onClick={closeMenu}>Why Amaavigo</a>
            <a href="#modules" onClick={closeMenu}>Modules</a>
            <a href="#ai" onClick={closeMenu}>Smart features</a>
            <a href="#security" onClick={closeMenu}>Security</a>
            <a href="#how" onClick={closeMenu}>How it works</a>
            <button className="ama-mobile-login" onClick={goToLogin}>Sign in <ArrowUpRight size={15} /></button>
          </div>

          <div className="ama-nav-actions">
            <button className="ama-nav-cta" onClick={goToLogin}>Sign in</button>
            <button className="ama-nav-cta ama-nav-cta-solid" onClick={goToLogin}>Get started <ArrowRight size={14} /></button>
          </div>
          <button
            className="ama-menu-toggle"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </nav>
      </header>

      <main id="top">
        <section className="ama-hero">
          <div className="ama-hero-grid" aria-hidden="true" />
          <div className="ama-hero-inner">
            <div className="ama-hero-copy">
              <div className="ama-eyebrow"><span className="ama-eyebrow-dot" /> THE HR PLATFORM FOR GROWING TEAMS</div>
              <h1>Run every people process in <span>one place.</span></h1>
              <p className="ama-hero-lede">
                Hire, manage leave, run payroll, review performance and keep policies current without juggling tools. Amaavigo handles the follow-ups so your team can focus on people.
              </p>
              <div className="ama-hero-actions">
                <button className="ama-button-primary" onClick={goToLogin}>Get started <ArrowRight size={17} /></button>
                <a className="ama-button-ghost" href="#modules">Explore the modules</a>
              </div>
              <div className="ama-hero-proof">
                <span><Check size={14} /> Seven connected modules</span>
                <span><Check size={14} /> Roles and permissions per company</span>
                <span><Check size={14} /> Built for Indian payroll</span>
              </div>
            </div>

            <div className="ama-hero-visual" aria-label="Illustration of the Amaavigo workspace">
              <div className="ama-orbit ama-orbit-one" />
              <div className="ama-orbit ama-orbit-two" />
              <div className="ama-float-tag ama-tag-top"><span className="ama-tag-icon"><Zap size={16} /></span><span><b>Automation</b><small>Follow-ups run themselves</small></span></div>
              <div className="ama-dashboard">
                <div className="ama-dashboard-top">
                  <div className="ama-window-dots"><i /><i /><i /></div>
                  <span>WORKSPACE OVERVIEW</span>
                  <span className="ama-live-indicator"><i /> SAMPLE VIEW</span>
                </div>
                <div className="ama-dashboard-body">
                  <div className="ama-dashboard-heading">
                    <div><small>GOOD MORNING</small><h3>People operations</h3></div>
                    <div className="ama-avatar-stack"><i>HR</i><i>OP</i><i>+4</i></div>
                  </div>
                  <div className="ama-stat-grid">
                    <div className="ama-stat-card"><span className="ama-stat-icon accent"><Briefcase size={16} /></span><small>Open roles</small><strong>6</strong><em>38 applicants ranked</em></div>
                    <div className="ama-stat-card"><span className="ama-stat-icon green"><CalendarCheck size={16} /></span><small>Leave requests</small><strong>4</strong><em>Waiting for approval</em></div>
                    <div className="ama-stat-card"><span className="ama-stat-icon blue"><Users size={16} /></span><small>People</small><strong>246</strong><em>Across 8 teams</em></div>
                  </div>
                  <div className="ama-activity-head"><b>Today in your workspace</b><span>View all <ArrowUpRight size={12} /></span></div>
                  <div className="ama-activity-row"><span className="ama-file-icon"><Briefcase size={15} /></span><div><b>Product designer</b><small>Skills test marked · 3 shortlisted</small></div><span className="ama-status published">On track</span></div>
                  <div className="ama-activity-row"><span className="ama-file-icon"><IndianRupee size={15} /></span><div><b>Monthly payroll</b><small>Inputs ready from attendance</small></div><span className="ama-status review">To review</span></div>
                  <div className="ama-activity-row"><span className="ama-file-icon"><FileText size={15} /></span><div><b>Leave policy</b><small>Version 1.8 · 62 acknowledged</small></div><span className="ama-status published">Published</span></div>
                </div>
              </div>
              <div className="ama-float-tag ama-tag-bottom"><span className="ama-check-ring"><Check size={15} /></span><span><b>Approved</b><small>Offer sent to the candidate</small></span></div>
            </div>
          </div>
        </section>

        <section className="ama-marquee" aria-label="What the platform covers">
          <div className="ama-marquee-label">ONE PLATFORM FOR</div>
          <div className="ama-marquee-viewport">
            <div className="ama-marquee-track">
              {[...marquee, ...marquee].map((item, index) => (
                <span key={`${item}-${index}`}><i /> {item}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="ama-why-section" id="why">
          <div className="ama-section-heading">
            <div><div className="ama-section-kicker">WHY AMAAVIGO</div><h2>Less chasing. More <span>doing.</span></h2></div>
            <p>HR work is mostly follow-ups. We built the platform around removing them.</p>
          </div>
          <div className="ama-reason-grid">
            {reasons.map((reason) => {
              const Icon = reason.icon;
              return (
                <article className="ama-reason-card" key={reason.title}>
                  <span className="ama-feature-icon"><Icon size={19} strokeWidth={1.8} /></span>
                  <h3>{reason.title}</h3>
                  <p>{reason.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="ama-modules-section" id="modules">
          <div className="ama-section-heading">
            <div><div className="ama-section-kicker">THE MODULES</div><h2>Start with one. Add the <span>rest</span> when you’re ready.</h2></div>
            <p>Every module shares the same people, roles and records, so nothing has to be entered twice.</p>
          </div>
          <div className="ama-module-showcase">
            <div className="ama-module-tabs" role="tablist" aria-label="Modules">
              {modules.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    role="tab"
                    aria-selected={index === activeModule}
                    className={`ama-module-tab ${index === activeModule ? 'is-active' : ''}`}
                    onClick={() => setActiveModule(index)}
                  >
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{item.name}</span>
                    <ChevronRight size={15} />
                  </button>
                );
              })}
            </div>
            <div className="ama-module-panel" role="tabpanel" key={current.key}>
              <span className="ama-feature-icon ama-module-icon"><CurrentIcon size={22} strokeWidth={1.8} /></span>
              <h3>{current.name}</h3>
              <p>{current.tagline}</p>
              <ul>
                {current.points.map((point) => (
                  <li key={point}><span><Check size={13} /></span>{point}</li>
                ))}
              </ul>
              <button className="ama-text-link ama-module-link" onClick={goToLogin}>Open this module <ArrowRight size={14} /></button>
            </div>
          </div>
        </section>

        <section className="ama-ai-section" id="ai">
          <div className="ama-section-heading">
            <div><div className="ama-section-kicker">SMART FEATURES</div><h2>Automation that <span>earns your trust.</span></h2></div>
            <p>Smart where it helps, human where it matters. People review and decide, and the platform does the legwork.</p>
          </div>
          <div className="ama-ai-grid">
            {aiCards.map((card, index) => {
              const Icon = card.icon;
              return (
                <article className="ama-ai-card" key={card.label}>
                  <div className="ama-ai-visual" aria-hidden="true">
                    {index === 0 && (
                      <div className="ama-chat">
                        <div className="ama-chat-q">How many leave days do I have left?</div>
                        <div className="ama-chat-a">You have 11 days of annual leave left this year.</div>
                      </div>
                    )}
                    {index === 1 && (
                      <div className="ama-flow">
                        {['Applied', 'Skills test', 'Interview', 'Offer'].map((stage, i) => (
                          <span key={stage} className={i < 2 ? 'is-done' : ''}>{stage}</span>
                        ))}
                      </div>
                    )}
                    {index === 2 && (
                      <div className="ama-flags">
                        <div><i /> Late marks above usual · 3 people</div>
                        <div><i /> Payroll input changed by 18%</div>
                        <div className="is-quiet"><i /> Awaiting HR review</div>
                      </div>
                    )}
                  </div>
                  <div className="ama-ai-label"><Icon size={14} /> {card.label}</div>
                  <h3>{card.title}</h3>
                  <p>{card.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="ama-security-section" id="security">
          <div className="ama-security-copy">
            <div className="ama-section-kicker">SECURITY AND CONTROL</div>
            <h2>Sensitive people data, <span>handled carefully.</span></h2>
            <p>HR holds some of the most private information in a company. Access is limited by role, files stay private, and important actions are recorded.</p>
            <div className="ama-security-badge"><ShieldCheck size={18} /> Access is checked on the server for every request</div>
          </div>
          <div className="ama-trust-grid">
            {trust.map((item) => {
              const Icon = item.icon;
              return (
                <article className="ama-trust-card" key={item.title}>
                  <span className="ama-feature-icon"><Icon size={18} strokeWidth={1.8} /></span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="ama-workflow-section" id="how">
          <div className="ama-workflow-copy">
            <div className="ama-section-kicker">HOW IT WORKS</div>
            <h2>From sign-up to <span>running smoothly.</span></h2>
            <p>Begin small and grow at your own pace. Each step has a clear owner and a clear result.</p>
            <button className="ama-button-dark" onClick={goToLogin}>Enter your workspace <ArrowRight size={17} /></button>
          </div>
          <div className="ama-workflow-list">
            {steps.map((item, index) => (
              <div className="ama-workflow-step" key={item.step}>
                <div className="ama-step-number">{item.step}</div>
                <div><h3>{item.title}</h3><p>{item.text}</p></div>
                {index < steps.length - 1 && <div className="ama-step-connector" />}
              </div>
            ))}
          </div>
        </section>

        <section className="ama-cta-section">
          <div className="ama-cta-mark"><Layers3 size={22} /></div>
          <div className="ama-section-kicker">READY WHEN YOU ARE</div>
          <h2>Give your people team a <span>calmer month.</span></h2>
          <p>Bring hiring, leave, payroll, performance and policies into one connected workspace.</p>
          <div className="ama-cta-actions">
            <button className="ama-button-primary" onClick={goToLogin}>Get started <ArrowRight size={17} /></button>
            <a className="ama-button-ghost" href="#modules">Review the modules</a>
          </div>
        </section>
      </main>

      <footer className="ama-footer">
        <div className="ama-footer-top">
          <div className="ama-footer-about">
            <a href="#top" className="ama-footer-brand"><AmaavigoLogo size="md" variant="full" theme="dark" height={34} align="left" /></a>
            <p>People, processes and progress, moving together.</p>
          </div>
          {footerColumns.map((column) => (
            <div className="ama-footer-col" key={column.title}>
              <b>{column.title}</b>
              {column.links.map((link) => (
                <a key={link.label} href={link.href}>{link.label}</a>
              ))}
            </div>
          ))}
        </div>
        <div className="ama-footer-bottom">
          <span>© {new Date().getFullYear()} Amaavigo. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
