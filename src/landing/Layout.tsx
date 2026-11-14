import React, { useEffect, useState } from 'react';
import { ArrowRight, ArrowUp, ArrowUpRight, ChevronDown, ChevronRight, Menu, Sparkles, X } from 'lucide-react';
import { AmaavigoLogo } from '../components/AmaavigoLogo';
import { MODULES } from './data';
import { Link, Reveal, useScroll } from './hooks';
import { normalizePath } from './routes';

export const goToLogin = () => {
  window.location.assign('/login');
};

export const SectionHead: React.FC<{ kicker: string; title: React.ReactNode; text?: string; center?: boolean; light?: boolean }> = ({
  kicker,
  title,
  text,
  center = false,
  light = false,
}) => (
  <Reveal className={`lp-sechead ${center ? 'is-center' : ''} ${light ? 'is-light' : ''}`}>
    <div className="lp-kicker">{kicker}</div>
    <h2>{title}</h2>
    {text && <p>{text}</p>}
  </Reveal>
);

export const CtaBand: React.FC<{ title?: React.ReactNode; text?: string }> = ({
  title = <>Give your people team a <span>calmer month.</span></>,
  text = 'Bring hiring, leave, payroll, performance and policies into one connected workspace.',
}) => (
  <section className="lp-cta">
    <div className="lp-cta-blob lp-cta-blob-a" />
    <div className="lp-cta-blob lp-cta-blob-b" />
    <Reveal className="lp-cta-inner">
      <div className="lp-kicker">READY WHEN YOU ARE</div>
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="lp-cta-actions">
        <button type="button" className="lp-btn lp-btn-white" onClick={goToLogin}>Get started <ArrowRight size={17} /></button>
        <Link to="/modules" className="lp-btn lp-btn-outline">Explore the modules</Link>
      </div>
    </Reveal>
  </section>
);

export const Header: React.FC<{ path: string }> = ({ path }) => {
  const { y, progress } = useScroll();
  const [menu, setMenu] = useState(false);
  const [mega, setMega] = useState(false);
  const [mobileModules, setMobileModules] = useState(false);

  useEffect(() => {
    setMenu(false);
    setMega(false);
  }, [path]);

  const active = (to: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

  return (
    <>
      <div className="lp-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></div>
      <div className="lp-strip">
        <Sparkles size={13} />
        <span>New: hiring automation and the Ask HR assistant are now part of the platform.</span>
        <Link to="/smart-features">See what’s new <ChevronRight size={13} /></Link>
      </div>
      <header className={`lp-header ${y > 8 ? 'is-scrolled' : ''}`}>
        <nav className="lp-nav" aria-label="Main navigation" onMouseLeave={() => setMega(false)}>
          <Link to="/" className="lp-brand" aria-label="Amaavigo home">
            <AmaavigoLogo size="md" variant="full" theme="light" height={36} align="left" />
          </Link>

          <div className={`lp-links ${menu ? 'is-open' : ''}`}>
            <div className={`lp-link-group ${mega ? 'is-open' : ''}`} onMouseEnter={() => setMega(true)}>
              <Link
                to="/modules"
                className={`lp-link ${active('/modules') ? 'is-active' : ''}`}
                onFocus={() => setMega(true)}
                aria-haspopup="true"
                aria-expanded={mega}
              >
                Modules <ChevronDown size={14} className="lp-caret-icon" />
              </Link>
              <button type="button" className="lp-mobile-toggle" onClick={() => setMobileModules((v) => !v)} aria-label="Show modules">
                <ChevronDown size={16} style={{ transform: mobileModules ? 'rotate(180deg)' : 'none' }} />
              </button>
              <div className={`lp-mega ${mobileModules ? 'is-mobile-open' : ''}`}>
                <div className="lp-mega-grid">
                  {MODULES.map((m) => {
                    const Icon = m.icon;
                    return (
                      <Link key={m.key} to={`/modules/${m.key}`} className="lp-mega-item" onClick={() => setMega(false)}>
                        <span className={`lp-iconbadge tone-${m.tone}`}><Icon size={17} /></span>
                        <span><b>{m.name}</b><small>{m.short}</small></span>
                      </Link>
                    );
                  })}
                </div>
                <Link to="/modules" className="lp-mega-promo" onClick={() => setMega(false)}>
                  <b>See how they connect</b>
                  <small>Seven modules, one record per person.</small>
                  <span>All modules <ArrowRight size={14} /></span>
                </Link>
              </div>
            </div>
            <Link to="/smart-features" className={`lp-link ${active('/smart-features') ? 'is-active' : ''}`}>Smart features</Link>
            <Link to="/security" className={`lp-link ${active('/security') ? 'is-active' : ''}`}>Security</Link>
            <Link to="/how-it-works" className={`lp-link ${active('/how-it-works') ? 'is-active' : ''}`}>How it works</Link>
            <button type="button" className="lp-btn lp-btn-ghost lp-mobile-signin" onClick={goToLogin}>Sign in <ArrowUpRight size={15} /></button>
          </div>

          <div className="lp-nav-actions">
            <button type="button" className="lp-btn lp-btn-ghost" onClick={goToLogin}>Sign in</button>
            <button type="button" className="lp-btn lp-btn-solid" onClick={goToLogin}>Get started <ArrowRight size={15} /></button>
          </div>
          <button
            type="button"
            className="lp-menu-toggle"
            aria-label={menu ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            {menu ? <X size={21} /> : <Menu size={21} />}
          </button>
        </nav>
      </header>
    </>
  );
};

export const Footer: React.FC = () => {
  const { y } = useScroll();
  return (
    <>
      <footer className="lp-footer">
        <div className="lp-footer-top">
          <div className="lp-footer-about">
            <Link to="/" aria-label="Amaavigo home"><AmaavigoLogo size="md" variant="full" theme="dark" height={34} align="left" /></Link>
            <p>People, processes and progress, moving together.</p>
            <button type="button" className="lp-btn lp-btn-solid" onClick={goToLogin}>Sign in <ArrowUpRight size={15} /></button>
          </div>
          <div className="lp-footer-col">
            <b>Platform</b>
            <Link to="/modules">All modules</Link>
            <Link to="/smart-features">Smart features</Link>
            <Link to="/security">Security</Link>
            <Link to="/how-it-works">How it works</Link>
          </div>
          <div className="lp-footer-col">
            <b>Modules</b>
            {MODULES.slice(0, 4).map((m) => <Link key={m.key} to={`/modules/${m.key}`}>{m.name}</Link>)}
          </div>
          <div className="lp-footer-col">
            <b>More modules</b>
            {MODULES.slice(4).map((m) => <Link key={m.key} to={`/modules/${m.key}`}>{m.name}</Link>)}
          </div>
        </div>
        <div className="lp-footer-bottom"><span>© {new Date().getFullYear()} Amaavigo. All rights reserved.</span></div>
      </footer>
      <button
        type="button"
        className={`lp-totop ${y > 700 ? 'is-visible' : ''}`}
        aria-label="Back to top"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <ArrowUp size={18} />
      </button>
    </>
  );
};

export const PageHero: React.FC<{
  crumbs?: { label: string; to?: string }[];
  kicker: string;
  title: React.ReactNode;
  text: string;
  visual?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ crumbs, kicker, title, text, visual, actions }) => (
  <section className="lp-pagehero">
    <div className="lp-grid-bg" aria-hidden="true" />
    <div className="lp-blob lp-blob-a" aria-hidden="true" />
    <div className={`lp-pagehero-inner ${visual ? 'has-visual' : ''}`}>
      <div className="lp-pagehero-copy">
        {crumbs && (
          <nav className="lp-crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <React.Fragment key={c.label}>
                {i > 0 && <ChevronRight size={12} />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
              </React.Fragment>
            ))}
          </nav>
        )}
        <div className="lp-eyebrow"><span className="lp-dot" /> {kicker}</div>
        <h1>{title}</h1>
        <p className="lp-lede">{text}</p>
        {actions}
      </div>
      {visual && <div className="lp-pagehero-visual">{visual}</div>}
    </div>
  </section>
);

export const isActivePath = (path: string, to: string) => normalizePath(path) === normalizePath(to);
