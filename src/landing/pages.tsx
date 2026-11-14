import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BellRing,
  Building2,
  Check,
  ChevronDown,
  Eye,
  FileClock,
  KeyRound,
  Layers3,
  Lock,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  UserCheck,
  Workflow,
  Zap,
  IndianRupee,
} from 'lucide-react';
import { FAQS, MODULES, STATS, moduleByKey } from './data';
import { CountUp, Link, Reveal, spotlight, useRotation } from './hooks';
import { CtaBand, PageHero, SectionHead, goToLogin } from './Layout';
import {
  AuditTimeline,
  AutomationFlow,
  ChatDemo,
  FlagsDemo,
  HeroScene,
  IsolationDiagram,
  ModuleVisual,
  OrbitHub,
  PermissionChips,
} from './visuals';
import type { ModuleKey } from './routes';

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

const Faq: React.FC = () => {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="lp-faq">
      {FAQS.map((f, i) => (
        <Reveal key={f.q} delay={i * 60} className={`lp-faq-item ${open === i ? 'is-open' : ''}`}>
          <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span>{f.q}</span>
            <ChevronDown size={18} />
          </button>
          <div className="lp-faq-body"><div><p>{f.a}</p></div></div>
        </Reveal>
      ))}
    </div>
  );
};

const Steps: React.FC<{ steps: { title: string; text: string }[] }> = ({ steps }) => (
  <div className="lp-steps">
    <div className="lp-steps-line"><i /></div>
    {steps.map((s, i) => (
      <Reveal key={s.title} delay={i * 140} className="lp-step">
        <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
        <h3>{s.title}</h3>
        <p>{s.text}</p>
      </Reveal>
    ))}
  </div>
);

const ROTATING = ['hiring', 'leave', 'payroll', 'performance', 'policies'];

const Rotor: React.FC = () => {
  const [i] = useRotation(ROTATING.length, 2200, false, 'rotor');
  return <span className="lp-rotor"><span key={ROTATING[i]} className="lp-rotor-word">{ROTATING[i]}</span></span>;
};

const MARQUEE_A = MODULES.map((m) => ({ icon: m.icon, label: m.name }));
const MARQUEE_B = ['Approve a leave request', 'Rank candidates', 'Lock the payroll month', 'Publish a policy', 'Open a review cycle', 'Book an interview', 'Clear an exit', 'Send an offer'];

const Marquee: React.FC = () => (
  <section className="lp-marquee" aria-label="What the platform covers">
    <div className="lp-marquee-row">
      <div className="lp-marquee-track">
        {[...MARQUEE_A, ...MARQUEE_A, ...MARQUEE_A].map((m, i) => {
          const Icon = m.icon;
          return <span key={i} className="lp-pill"><Icon size={15} /> {m.label}</span>;
        })}
      </div>
    </div>
    <div className="lp-marquee-row is-reverse">
      <div className="lp-marquee-track">
        {[...MARQUEE_B, ...MARQUEE_B, ...MARQUEE_B].map((m, i) => <span key={i} className="lp-pill is-soft"><Check size={14} /> {m}</span>)}
      </div>
    </div>
  </section>
);

const WHY = [
  { icon: Layers3, title: 'One workspace for HR', text: 'Hiring, leave, payroll, performance and policies live together, so nobody re-types the same person twice.' },
  { icon: Zap, title: 'Automation does the chasing', text: 'Reminders, approvals, interview links and test marking run on their own. People step in only to decide.' },
  { icon: Building2, title: 'Every company kept separate', text: 'Each company has its own people, roles and data. Add the modules you need and switch off the rest.' },
  { icon: IndianRupee, title: 'Made for Indian payroll', text: 'PF, ESI, professional tax and TDS are built into salary runs, payslips and full-and-final settlements.' },
];

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

const ModuleShowcase: React.FC = () => {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useRotation(MODULES.length, 6000, hover, 'showcase');
  const m = MODULES[active];
  const Icon = m.icon;
  return (
    <div className="lp-showcase" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="lp-showcase-tabs" role="tablist" aria-label="Modules">
        {MODULES.map((item, i) => {
          const TabIcon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              className={`lp-stab ${i === active ? 'is-active' : ''} ${hover ? 'is-paused' : ''}`}
              onClick={() => setActive(i)}
            >
              <span className={`lp-iconbadge tone-${item.tone}`}><TabIcon size={16} /></span>
              <span>{item.name}</span>
              <i className="lp-stab-progress" />
            </button>
          );
        })}
      </div>
      <div className="lp-showcase-panel" key={m.key}>
        <div className="lp-showcase-copy">
          <span className={`lp-iconbadge is-large tone-${m.tone}`}><Icon size={22} /></span>
          <h3>{m.name}</h3>
          <p>{m.tagline}</p>
          <ul>
            {m.points.map((p) => <li key={p}><span><Check size={12} /></span>{p}</li>)}
          </ul>
          <Link to={`/modules/${m.key}`} className="lp-textlink">Explore {m.name.toLowerCase()} <ArrowRight size={15} /></Link>
        </div>
        <div className="lp-showcase-visual"><ModuleVisual k={m.key} /></div>
      </div>
    </div>
  );
};

export const HomePage: React.FC = () => (
  <>
    <section className="lp-hero">
      <div className="lp-grid-bg" aria-hidden="true" />
      <div className="lp-hero-inner">
        <div className="lp-hero-copy">
          <div className="lp-eyebrow"><span className="lp-dot" /> THE HR PLATFORM FOR GROWING TEAMS</div>
          <h1>All your <Rotor /> in <span>one place.</span></h1>
          <p className="lp-lede">
            Hire, manage leave, run payroll, review performance and keep policies current without juggling tools. Amaavigo handles the follow-ups so your team can focus on people.
          </p>
          <div className="lp-hero-actions">
            <button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>Get started <ArrowRight size={17} /></button>
            <Link to="/modules" className="lp-btn lp-btn-outline">Explore the modules</Link>
          </div>
          <div className="lp-proof">
            <span><Check size={14} /> Seven connected modules</span>
            <span><Check size={14} /> Roles and permissions per company</span>
            <span><Check size={14} /> Built for Indian payroll</span>
          </div>
        </div>
        <HeroScene />
      </div>
    </section>

    <Marquee />

    <section className="lp-stats">
      <div className="lp-stats-inner">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 100} className="lp-stat">
            <strong><CountUp value={s.value} suffix={s.suffix} /></strong>
            <span>{s.label}</span>
          </Reveal>
        ))}
      </div>
    </section>

    <section className="lp-section">
      <SectionHead kicker="WHY AMAAVIGO" title={<>Less chasing. More <span>doing.</span></>} text="HR work is mostly follow-ups. We built the platform around removing them." />
      <div className="lp-why">
        {WHY.map((w, i) => {
          const Icon = w.icon;
          return (
            <Reveal key={w.title} delay={i * 90} className="lp-card lp-spot" {...spotlight}>
              <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
              <h3>{w.title}</h3>
              <p>{w.text}</p>
            </Reveal>
          );
        })}
      </div>
    </section>

    <section className="lp-section lp-section-tint">
      <SectionHead kicker="THE MODULES" title={<>Start with one. Add the <span>rest</span> when you’re ready.</>} text="Every module shares the same people, roles and records, so nothing has to be entered twice." />
      <Reveal variant="zoom"><ModuleShowcase /></Reveal>
    </section>

    <section className="lp-dark">
      <div className="lp-dark-glow" aria-hidden="true" />
      <div className="lp-dark-inner">
        <SectionHead light kicker="AUTOMATION IN ACTION" title={<>The follow-ups happen <span>on their own.</span></>} text="Take hiring. Once a request is approved, every step after it moves forward without a reminder or a spreadsheet." />
        <Reveal variant="zoom"><AutomationFlow /></Reveal>
        <Reveal className="lp-dark-links">
          <Link to="/smart-features" className="lp-btn lp-btn-white">See the smart features <ArrowRight size={16} /></Link>
          <Link to="/modules/hiring" className="lp-btn lp-btn-outline-light">Explore hiring</Link>
        </Reveal>
      </div>
    </section>

    <section className="lp-section">
      <SectionHead kicker="SMART FEATURES" title={<>Smart where it helps, <span>human where it matters.</span></>} text="The platform drafts, answers and flags. People review and decide." />
      <div className="lp-two">
        <Reveal variant="left"><ChatDemo /></Reveal>
        <Reveal variant="right"><FlagsDemo /></Reveal>
      </div>
      <Reveal className="lp-center-link"><Link to="/smart-features" className="lp-textlink">All smart features <ArrowRight size={15} /></Link></Reveal>
    </section>

    <section className="lp-section lp-section-tint">
      <div className="lp-split-section">
        <div>
          <SectionHead kicker="SECURITY AND CONTROL" title={<>Sensitive people data, <span>handled carefully.</span></>} text="Access is limited by role, each company only sees its own data, files stay private and important actions are recorded." />
          <Reveal><Link to="/security" className="lp-textlink">How access works <ArrowRight size={15} /></Link></Reveal>
        </div>
        <Reveal variant="right"><IsolationDiagram /></Reveal>
      </div>
    </section>

    <section className="lp-section">
      <SectionHead kicker="HOW IT WORKS" title={<>From sign-up to <span>running smoothly.</span></>} center />
      <Steps
        steps={[
          { title: 'Set up your company', text: 'Sign up, get approved, and add your departments and locations.' },
          { title: 'Add people and roles', text: 'Invite your team and give each person only the access they need.' },
          { title: 'Switch on what you need', text: 'Start with one module and add more when ready.' },
          { title: 'Let it run', text: 'Reminders, approvals and checks work in the background.' },
        ]}
      />
    </section>

    <section className="lp-section lp-section-tint">
      <SectionHead kicker="QUESTIONS" title={<>Questions teams <span>ask first.</span></>} center />
      <Faq />
    </section>

    <CtaBand />
  </>
);

/* ------------------------------------------------------------------ */
/* Modules index                                                       */
/* ------------------------------------------------------------------ */

export const ModulesPage: React.FC = () => (
  <>
    <PageHero
      kicker="THE MODULES"
      title={<>Seven modules. <span>One record</span> per person.</>}
      text="Every module reads from the same people, roles and documents, so a change in one place shows up everywhere it matters."
      visual={<OrbitHub />}
      actions={<div className="lp-hero-actions"><button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>Get started <ArrowRight size={17} /></button></div>}
    />
    <section className="lp-section">
      <div className="lp-modgrid">
        {MODULES.map((m, i) => {
          const Icon = m.icon;
          return (
            <Reveal key={m.key} delay={(i % 3) * 90} className={`lp-card lp-spot lp-modcard tone-${m.tone}`} {...spotlight}>
              <Link to={`/modules/${m.key}`} className="lp-modcard-link" aria-label={m.name}>
                <span className={`lp-iconbadge is-large tone-${m.tone}`}><Icon size={20} /></span>
                <h3>{m.name}</h3>
                <p>{m.tagline}</p>
                <ul>{m.points.slice(0, 3).map((p) => <li key={p}><Check size={13} />{p}</li>)}</ul>
                <span className="lp-textlink">Explore <ArrowRight size={15} /></span>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </section>
    <section className="lp-section lp-section-tint">
      <SectionHead kicker="WORKS TOGETHER" title={<>Change it once. <span>It updates everywhere.</span></>} center />
      <div className="lp-why is-three">
        {[
          { icon: UserCheck, title: 'Join once', text: 'A new joiner is added once and appears in leave, payroll, performance and the org chart.' },
          { icon: Workflow, title: 'Feed each other', text: 'Attendance and leave feed payroll inputs. Tasks and attendance feed performance evidence.' },
          { icon: KeyRound, title: 'One set of roles', text: 'Give access once and it applies across modules, so permissions are never out of step.' },
        ].map((w, i) => {
          const Icon = w.icon;
          return (
            <Reveal key={w.title} delay={i * 100} className="lp-card lp-spot" {...spotlight}>
              <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
              <h3>{w.title}</h3>
              <p>{w.text}</p>
            </Reveal>
          );
        })}
      </div>
    </section>
    <CtaBand />
  </>
);

/* ------------------------------------------------------------------ */
/* Module detail                                                       */
/* ------------------------------------------------------------------ */

export const ModuleDetailPage: React.FC<{ k: ModuleKey }> = ({ k }) => {
  const m = moduleByKey(k);
  const Icon = m.icon;
  const others = MODULES.filter((x) => x.key !== m.key);
  return (
    <>
      <PageHero
        crumbs={[{ label: 'Home', to: '/' }, { label: 'Modules', to: '/modules' }, { label: m.name }]}
        kicker={m.name.toUpperCase()}
        title={m.headline}
        text={m.intro}
        visual={<div className="lp-hero-visual-wrap"><div className="lp-hero-visual-glow" /><ModuleVisual k={m.key} /></div>}
        actions={
          <div className="lp-hero-actions">
            <button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>Get started <ArrowRight size={17} /></button>
            <Link to="/modules" className="lp-btn lp-btn-outline">All modules</Link>
          </div>
        }
      />
      <section className="lp-section">
        <SectionHead kicker="WHAT YOU GET" title={<>Built for the way <span>{m.name.toLowerCase()}</span> really works.</>} />
        <div className="lp-why is-two">
          {m.highlights.map((h, i) => {
            const HIcon = h.icon;
            return (
              <Reveal key={h.title} delay={(i % 2) * 100} className="lp-card lp-spot" {...spotlight}>
                <span className={`lp-iconbadge is-large tone-${m.tone}`}><HIcon size={20} /></span>
                <h3>{h.title}</h3>
                <p>{h.text}</p>
              </Reveal>
            );
          })}
        </div>
      </section>
      <section className="lp-section lp-section-tint">
        <SectionHead kicker="HOW IT FLOWS" title={<>From start to <span>done.</span></>} center />
        <Steps steps={m.steps} />
      </section>
      <section className="lp-section">
        <div className="lp-split-section">
          <div>
            <SectionHead kicker="WHAT’S INSIDE" title={<>Everything {m.name.toLowerCase()} needs.</>} />
            <ul className="lp-checklist">
              {m.points.map((p, i) => (
                <Reveal as="li" key={p} delay={i * 90} variant="left"><span><Check size={13} /></span>{p}</Reveal>
              ))}
            </ul>
          </div>
          <Reveal variant="zoom" className={`lp-feature-card tone-${m.tone}`}>
            <span className={`lp-iconbadge is-large tone-${m.tone}`}><Icon size={22} /></span>
            <h3>{m.name}</h3>
            <p>{m.tagline}</p>
            <button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>Open this module <ArrowRight size={16} /></button>
          </Reveal>
        </div>
      </section>
      <section className="lp-section lp-section-tint">
        <SectionHead kicker="WORKS WITH" title={<>Pairs well with <span>the rest.</span></>} center />
        <div className="lp-related">
          {others.map((o, i) => {
            const OIcon = o.icon;
            return (
              <Reveal key={o.key} delay={i * 60} variant="zoom">
                <Link to={`/modules/${o.key}`} className="lp-related-item">
                  <span className={`lp-iconbadge tone-${o.tone}`}><OIcon size={17} /></span>
                  <span><b>{o.name}</b><small>{o.short}</small></span>
                  <ArrowRight size={15} />
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>
      <CtaBand />
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Smart features                                                      */
/* ------------------------------------------------------------------ */

export const SmartFeaturesPage: React.FC = () => (
  <>
    <PageHero
      kicker="SMART FEATURES"
      title={<>Automation that <span>earns your trust.</span></>}
      text="Smart where it helps, human where it matters. The platform does the legwork, and people review and decide."
      visual={<div className="lp-hero-visual-wrap"><div className="lp-hero-visual-glow" /><ChatDemo /></div>}
    />

    <section className="lp-section">
      <div className="lp-split-section is-top">
        <Reveal variant="left">
          <div className="lp-kicker"><MessageSquare size={14} /> ASK HR</div>
          <h2 className="lp-h2">Answers from your own data and policies.</h2>
          <p className="lp-p">Employees ask about leave balance, notice period or payday and get an answer from their own record and the published policies. It starts read-only, so nothing is changed by a question.</p>
          <ul className="lp-checklist">
            {['Answers use only that person’s own data', 'Policy answers come from published versions', 'Every question can be reviewed by HR'].map((t) => <li key={t}><span><Check size={13} /></span>{t}</li>)}
          </ul>
        </Reveal>
        <Reveal variant="right"><ChatDemo /></Reveal>
      </div>
    </section>

    <section className="lp-dark">
      <div className="lp-dark-glow" aria-hidden="true" />
      <div className="lp-dark-inner">
        <SectionHead light kicker="HIRING AUTOMATION" title={<>A hiring flow that <span>moves itself.</span></>} text="Skills tests are written from the job description, sent to candidates and marked automatically. Interviews and offers follow the steps you define." />
        <Reveal variant="zoom"><AutomationFlow /></Reveal>
        <div className="lp-why is-three is-dark">
          {[
            { icon: Workflow, title: 'Your own steps', text: 'Define the order of steps per company, and a separate flow per designation if you need one.' },
            { icon: Zap, title: 'Tests that mark themselves', text: 'Questions are drafted from the job description. You edit them once, and results are recorded as candidates finish.' },
            { icon: Eye, title: 'You choose how strict', text: 'Per step, auto-reject below the pass mark or leave the decision to HR.' },
          ].map((w, i) => {
            const Icon = w.icon;
            return (
              <Reveal key={w.title} delay={i * 100} className="lp-card lp-spot" {...spotlight}>
                <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
                <h3>{w.title}</h3>
                <p>{w.text}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>

    <section className="lp-section">
      <div className="lp-split-section is-top is-flip">
        <Reveal variant="left"><FlagsDemo /></Reveal>
        <Reveal variant="right">
          <div className="lp-kicker"><BellRing size={14} /> FLAGS</div>
          <h2 className="lp-h2">Early warnings, reviewed by a person.</h2>
          <p className="lp-p">Unusual payroll inputs, repeated late marks and odd leave patterns are flagged for HR to look at. Flags are prompts for a conversation, never a verdict.</p>
          <ul className="lp-checklist">
            {['Compared against the person’s and team’s own history', 'Reviewed and cleared by HR', 'Nothing is changed or paid automatically'].map((t) => <li key={t}><span><Check size={13} /></span>{t}</li>)}
          </ul>
        </Reveal>
      </div>
    </section>

    <section className="lp-section lp-section-tint">
      <SectionHead kicker="OUR RULES" title={<>People stay <span>in control.</span></>} center />
      <div className="lp-why is-three">
        {[
          { icon: UserCheck, title: 'A person decides', text: 'Drafts, rankings and flags support a decision. They never replace one.' },
          { icon: Lock, title: 'Your data stays yours', text: 'Answers use each company’s own records and policies, kept separate from every other company.' },
          { icon: FileClock, title: 'Everything is recorded', text: 'Important actions leave a trail, so you can see what happened and who approved it.' },
        ].map((w, i) => {
          const Icon = w.icon;
          return (
            <Reveal key={w.title} delay={i * 100} className="lp-card lp-spot" {...spotlight}>
              <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
              <h3>{w.title}</h3>
              <p>{w.text}</p>
            </Reveal>
          );
        })}
      </div>
    </section>
    <CtaBand />
  </>
);

/* ------------------------------------------------------------------ */
/* Security                                                            */
/* ------------------------------------------------------------------ */

const ShieldArt: React.FC = () => (
  <div className="lp-shield" aria-hidden="true">
    <div className="lp-shield-ring lp-shield-ring-1" />
    <div className="lp-shield-ring lp-shield-ring-2" />
    <div className="lp-shield-ring lp-shield-ring-3" />
    <div className="lp-shield-core"><ShieldCheck size={54} strokeWidth={1.4} /></div>
    <span className="lp-shield-dot lp-sd-1"><Lock size={14} /></span>
    <span className="lp-shield-dot lp-sd-2"><KeyRound size={14} /></span>
    <span className="lp-shield-dot lp-sd-3"><ScrollText size={14} /></span>
  </div>
);

export const SecurityPage: React.FC = () => (
  <>
    <PageHero
      kicker="SECURITY AND CONTROL"
      title={<>Sensitive people data, <span>handled carefully.</span></>}
      text="HR holds some of the most private information in a company. Access is limited by role, files stay private, and important actions are recorded."
      visual={<ShieldArt />}
    />

    <section className="lp-section">
      <div className="lp-split-section">
        <Reveal variant="left">
          <div className="lp-kicker"><Building2 size={14} /> SEPARATE COMPANIES</div>
          <h2 className="lp-h2">Each company sees only its own data.</h2>
          <p className="lp-p">Every company has its own people, documents and settings. New companies are approved before they can start, and access is checked on the server for every request, not just in the screen.</p>
        </Reveal>
        <Reveal variant="right"><IsolationDiagram /></Reveal>
      </div>
    </section>

    <section className="lp-section lp-section-tint">
      <div className="lp-split-section is-flip">
        <Reveal variant="left">
          <PermissionChips />
        </Reveal>
        <Reveal variant="right">
          <div className="lp-kicker"><KeyRound size={14} /> ROLES AND PERMISSIONS</div>
          <h2 className="lp-h2">Give people exactly the access they need.</h2>
          <p className="lp-p">Start from ready-made roles or build your own from a checklist of permissions. Nobody can hand out access they do not hold themselves, and payroll access is never part of a default role except the admin’s.</p>
        </Reveal>
      </div>
    </section>

    <section className="lp-section">
      <div className="lp-split-section is-top">
        <Reveal variant="left">
          <div className="lp-kicker"><FileClock size={14} /> A RECORD OF DECISIONS</div>
          <h2 className="lp-h2">Know who approved what, and when.</h2>
          <p className="lp-p">Approvals, changes and acknowledgements leave a trail you can review later, so audits start from facts instead of memory.</p>
        </Reveal>
        <Reveal variant="right"><AuditTimeline /></Reveal>
      </div>
    </section>

    <section className="lp-section lp-section-tint">
      <SectionHead kicker="MORE PROTECTION" title={<>The details <span>that matter.</span></>} center />
      <div className="lp-why">
        {[
          { icon: Lock, title: 'Private files', text: 'Identity documents and attachments are stored privately and opened through signed links.' },
          { icon: Eye, title: 'Numbers masked', text: 'Sensitive identity numbers are masked until someone with access chooses to reveal them.' },
          { icon: UserCheck, title: 'Privacy in the middle', text: 'Birthdays show only day and month, mood shows only as company-wide counts, and survey results stay hidden for very small groups.' },
          { icon: ShieldCheck, title: 'Checked on every request', text: 'The server verifies who is asking and what they may do before it returns anything.' },
        ].map((w, i) => {
          const Icon = w.icon;
          return (
            <Reveal key={w.title} delay={i * 90} className="lp-card lp-spot" {...spotlight}>
              <span className="lp-iconbadge is-large tone-violet"><Icon size={20} /></span>
              <h3>{w.title}</h3>
              <p>{w.text}</p>
            </Reveal>
          );
        })}
      </div>
    </section>
    <CtaBand />
  </>
);

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

export const HowItWorksPage: React.FC = () => {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStage((s) => (s + 1) % 4), 2600);
    return () => window.clearInterval(id);
  }, []);
  const rows = [
    { title: 'Set up your company', text: 'Sign up with your work email. A platform administrator approves your company, and you get a company admin account.', items: ['Add departments and locations', 'Choose which modules to switch on', 'Set your leave year and holidays'] },
    { title: 'Add people and roles', text: 'Invite people one by one or import a list. Each person gets a role that decides what they can see and do.', items: ['Start from six ready-made roles', 'Create your own from a permission checklist', 'Set reporting lines and approvers'] },
    { title: 'Switch on what you need', text: 'Begin with a single module and add more as your team is ready. They all use the same people and roles.', items: ['Leave and attendance first, or hiring first', 'Payroll when the attendance data is steady', 'Performance, tasks and policies as you grow'] },
    { title: 'Let it run', text: 'Reminders, accruals, approvals and checks run in the background. You step in only when a decision is needed.', items: ['Daily accrual and reminders', 'Approvals with delegation', 'Flags for HR to review'] },
  ];
  return (
    <>
      <PageHero
        kicker="HOW IT WORKS"
        title={<>From sign-up to <span>running smoothly.</span></>}
        text="Begin small and grow at your own pace. Each step has a clear owner and a clear result."
        actions={<div className="lp-hero-actions"><button type="button" className="lp-btn lp-btn-primary" onClick={goToLogin}>Get started <ArrowRight size={17} /></button></div>}
      />
      <section className="lp-section">
        <div className="lp-how">
          <div className="lp-how-rail" aria-hidden="true">
            {rows.map((r, i) => (
              <span key={r.title} className={`lp-how-dot ${i <= stage ? 'is-on' : ''}`}>{i + 1}</span>
            ))}
            <i className="lp-how-fill" style={{ height: `${(stage / 3) * 100}%` }} />
          </div>
          <div className="lp-how-list">
            {rows.map((r, i) => (
              <Reveal key={r.title} delay={80} className={`lp-how-card ${i === stage ? 'is-current' : ''}`}>
                <span className="lp-step-num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{r.title}</h3>
                <p>{r.text}</p>
                <ul>{r.items.map((t) => <li key={t}><Check size={14} />{t}</li>)}</ul>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      <section className="lp-section lp-section-tint">
        <SectionHead kicker="QUESTIONS" title={<>Questions teams <span>ask first.</span></>} center />
        <Faq />
      </section>
      <CtaBand />
    </>
  );
};
