import React, { useEffect, useState } from 'react';
import './landing.css';
import { Footer, Header } from './Layout';
import { HomePage, HowItWorksPage, ModuleDetailPage, ModulesPage, SecurityPage, SmartFeaturesPage } from './pages';
import { NAVIGATE_EVENT, isMarketingPath, moduleKeyFromPath, normalizePath } from './routes';

const TITLES: Record<string, string> = {
  '/': 'Amaavigo: the HR platform for growing teams',
  '/modules': 'Modules · Amaavigo',
  '/smart-features': 'Smart features · Amaavigo',
  '/security': 'Security and control · Amaavigo',
  '/how-it-works': 'How it works · Amaavigo',
};

/**
 * The public marketing site: several pages, one shell. It keeps its own current path and moves
 * between pages with the History API, so going from page to page never reloads the app.
 */
export const MarketingSite: React.FC = () => {
  const [path, setPath] = useState(() => normalizePath(window.location.pathname));

  useEffect(() => {
    const sync = () => {
      const next = normalizePath(window.location.pathname);
      // A path that is not a marketing page belongs to the app (sign-in); let the app take over.
      if (!isMarketingPath(next)) {
        window.location.reload();
        return;
      }
      setPath(next);
    };
    window.addEventListener('popstate', sync);
    window.addEventListener(NAVIGATE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(NAVIGATE_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const key = moduleKeyFromPath(path);
    document.title = key ? `${key.charAt(0).toUpperCase()}${key.slice(1)} · Amaavigo` : TITLES[path] || TITLES['/'];
  }, [path]);

  const moduleKey = moduleKeyFromPath(path);
  let page: React.ReactNode;
  if (moduleKey) page = <ModuleDetailPage k={moduleKey} />;
  else if (path === '/modules') page = <ModulesPage />;
  else if (path === '/smart-features') page = <SmartFeaturesPage />;
  else if (path === '/security') page = <SecurityPage />;
  else if (path === '/how-it-works') page = <HowItWorksPage />;
  else page = <HomePage />;

  return (
    <div className="lp-root">
      <Header path={path} />
      <main key={path} className="lp-page">{page}</main>
      <Footer />
    </div>
  );
};

export default MarketingSite;
