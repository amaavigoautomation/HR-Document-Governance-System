import React, { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileClock,
  FileText,
  GitBranch,
  Layers3,
  LockKeyhole,
  Menu,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { AmaavigoLogo } from './AmaavigoLogo';

const features = [
  {
    icon: FileText,
    number: '01',
    title: 'One source of truth',
    description: 'Keep policies, handbooks and internal documents organised in one place, with clear ownership and visibility.',
  },
  {
    icon: GitBranch,
    number: '02',
    title: 'Version control that makes sense',
    description: 'See what changed, when it changed and which version is current. Keep document history easy to follow.',
  },
  {
    icon: ClipboardCheck,
    number: '03',
    title: 'Structured approvals',
    description: 'Move documents through creator and reviewer workflows before they are published to your teams.',
  },
  {
    icon: Users,
    number: '04',
    title: 'Employee acknowledgement',
    description: 'Share published policies with the right people and track required acknowledgements in one view.',
  },
  {
    icon: FileClock,
    number: '05',
    title: 'A clear audit trail',
    description: 'Make document activity easier to review with a record of key governance events and decisions.',
  },
  {
    icon: Workflow,
    number: '06',
    title: 'Connected HR workflows',
    description: 'Bring document governance alongside talent acquisition and the wider people operations workflow.',
  },
];

const steps = [
  { step: '01', title: 'Create', text: 'Draft a policy or upload an existing document.' },
  { step: '02', title: 'Review', text: 'Route it to the right approver before publication.' },
  { step: '03', title: 'Publish', text: 'Share the approved version with its intended audience.' },
  { step: '04', title: 'Track', text: 'Follow acknowledgements, revisions and document activity.' },
];

export const LandingPage: React.FC = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  const goToLogin = () => {
    window.location.assign('/login');
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="ama-landing min-h-screen bg-white text-slate-900">
      <header className="ama-nav-wrap">
        <nav className="ama-nav" aria-label="Main navigation">
          <a href="#top" className="ama-brand" aria-label="Amaavigo home" onClick={closeMenu}>
            <AmaavigoLogo size="md" variant="full" theme="light" height={38} align="left" />
          </a>

          <div className={`ama-nav-links ${menuOpen ? 'is-open' : ''}`}>
            <a href="#platform" onClick={closeMenu}>Platform</a>
            <a href="#capabilities" onClick={closeMenu}>Capabilities</a>
            <a href="#workflow" onClick={closeMenu}>How it works</a>
            <button className="ama-mobile-login" onClick={goToLogin}>Sign in <ArrowUpRight size={15} /></button>
          </div>

          <button className="ama-nav-cta" onClick={goToLogin}>
            Sign in <ArrowUpRight size={15} />
          </button>
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
              <div className="ama-eyebrow"><span className="ama-eyebrow-dot" /> PEOPLE OPERATIONS, WITH CLARITY</div>
              <h1>Bring clarity to every <span>people process.</span></h1>
              <p className="ama-hero-lede">
                A more organised way to manage HR documents, approvals and employee compliance — built to keep your people and processes moving together.
              </p>
              <div className="ama-hero-actions">
                <button className="ama-button-primary" onClick={goToLogin}>Explore the platform <ArrowRight size={17} /></button>
                <a className="ama-text-link" href="#platform">Discover what’s inside <ChevronRight size={16} /></a>
              </div>
              <div className="ama-hero-proof">
                <span><Check size={14} /> Structured document workflows</span>
                <span><Check size={14} /> Clear ownership and accountability</span>
              </div>
            </div>

            <div className="ama-hero-visual" aria-label="Illustration of an HR document governance dashboard">
              <div className="ama-orbit ama-orbit-one" />
              <div className="ama-orbit ama-orbit-two" />
              <div className="ama-float-tag ama-tag-top"><span className="ama-tag-icon"><ShieldCheck size={16} /></span><span><b>Governance</b><small>Clear and accountable</small></span></div>
              <div className="ama-dashboard">
                <div className="ama-dashboard-top">
                  <div className="ama-window-dots"><i /><i /><i /></div>
                  <span>WORKSPACE OVERVIEW</span>
                  <span className="ama-live-indicator"><i /> LIVE VIEW</span>
                </div>
                <div className="ama-dashboard-body">
                  <div className="ama-dashboard-heading">
                    <div><small>GOOD MORNING</small><h3>People operations</h3></div>
                    <div className="ama-avatar-stack"><i>HR</i><i>OP</i><i>+4</i></div>
                  </div>
                  <div className="ama-stat-grid">
                    <div className="ama-stat-card"><span className="ama-stat-icon accent"><FileText size={16} /></span><small>Documents</small><strong>128</strong><em>Across your workspace</em></div>
                    <div className="ama-stat-card"><span className="ama-stat-icon green"><ClipboardCheck size={16} /></span><small>Approvals</small><strong>12</strong><em>In review</em></div>
                    <div className="ama-stat-card"><span className="ama-stat-icon blue"><Users size={16} /></span><small>Employees</small><strong>246</strong><em>Team directory</em></div>
                  </div>
                  <div className="ama-activity-head"><b>Recent document activity</b><span>View all <ArrowUpRight size={12} /></span></div>
                  <div className="ama-activity-row"><span className="ama-file-icon"><FileText size={15} /></span><div><b>Employee handbook</b><small>Version 2.4 · Updated today</small></div><span className="ama-status published">Published</span></div>
                  <div className="ama-activity-row"><span className="ama-file-icon"><FileText size={15} /></span><div><b>Leave policy</b><small>Version 1.8 · Updated yesterday</small></div><span className="ama-status review">In review</span></div>
                  <div className="ama-activity-row"><span className="ama-file-icon"><FileText size={15} /></span><div><b>Code of conduct</b><small>Version 3.1 · Updated 2 days ago</small></div><span className="ama-status published">Published</span></div>
                </div>
              </div>
              <div className="ama-float-tag ama-tag-bottom"><span className="ama-check-ring"><Check size={15} /></span><span><b>Version history</b><small>Every change has a place</small></span></div>
            </div>
          </div>
          <div className="ama-hero-bottom"><span>BUILT FOR THE WAY TEAMS WORK</span><div><i /> DOCUMENT GOVERNANCE <i /> HR WORKFLOWS <i /> EMPLOYEE EXPERIENCE</div></div>
        </section>

        <section className="ama-intro-section" id="platform">
          <div className="ama-section-kicker">THE AMAAVIGO APPROACH</div>
          <div className="ama-intro-grid">
            <h2>Good people operations start with <span>good foundations.</span></h2>
            <div>
              <p>When policies live in different places and approvals happen over scattered conversations, even simple HR work becomes harder than it needs to be.</p>
              <p>Amaavigo brings structure to the everyday work behind your workforce — so teams can spend less time chasing information and more time moving forward.</p>
            </div>
          </div>
          <div className="ama-principles">
            <div><span>01</span><b>Clarity over complexity</b><small>Keep information easy to find and understand.</small></div>
            <div><span>02</span><b>Process with purpose</b><small>Give every review and approval a clear next step.</small></div>
            <div><span>03</span><b>People at the centre</b><small>Make policies and HR processes work for employees.</small></div>
          </div>
        </section>

        <section className="ama-capabilities-section" id="capabilities">
          <div className="ama-section-heading">
            <div><div className="ama-section-kicker">WHAT YOU CAN DO</div><h2>Everything in its <span>right place.</span></h2></div>
            <p>Practical tools for the work that keeps an organisation aligned, informed and accountable.</p>
          </div>
          <div className="ama-feature-grid">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article className="ama-feature-card" key={feature.number}>
                  <div className="ama-feature-top"><span className="ama-feature-icon"><Icon size={19} strokeWidth={1.8} /></span><span>{feature.number}</span></div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                  <div className="ama-feature-line" />
                </article>
              );
            })}
          </div>
        </section>

        <section className="ama-workflow-section" id="workflow">
          <div className="ama-workflow-copy">
            <div className="ama-section-kicker">A BETTER WAY TO WORK</div>
            <h2>From first draft to <span>team-wide clarity.</span></h2>
            <p>Bring consistency to the full document lifecycle. Each step has a purpose, an owner and a clear outcome.</p>
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
          <div className="ama-section-kicker">MAKE WORKFLOW WORK FOR YOU</div>
          <h2>Build a more connected <span>workplace.</span></h2>
          <p>Bring your people processes, policies and everyday decisions into better alignment.</p>
          <button className="ama-button-primary" onClick={goToLogin}>Go to your workspace <ArrowRight size={17} /></button>
        </section>
      </main>

      <footer className="ama-footer">
        <a href="#top" className="ama-footer-brand"><AmaavigoLogo size="md" variant="full" theme="light" height={34} align="left" /></a>
        <p>People, processes and progress — moving together.</p>
        <span>© {new Date().getFullYear()} Amaavigo. All rights reserved.</span>
      </footer>
    </div>
  );
};

export default LandingPage;
