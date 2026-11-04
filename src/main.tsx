import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CandidateUploadPage} from './components/CandidateUploadPage.tsx';
import {OfferResponsePage} from './components/OfferResponsePage.tsx';
import {ScreeningLinkPage} from './components/ScreeningLinkPage.tsx';
import {SkillTestPage} from './components/SkillTestPage.tsx';
import './index.css';

// Public candidate upload page (opened from the onboarding email). Bypasses the HR login.
const isCandidateUpload = window.location.pathname.startsWith('/onboarding/upload');
// Public offer page (opened from the offer email): /?offer=<token>.
const isOfferPage = new URLSearchParams(window.location.search).has('offer');
// Public screening page (opened from the screening email): /?screen=<token>.
const isScreenPage = new URLSearchParams(window.location.search).has('screen');
// Public skills test page (opened from the test email): /?test=<token>.
const isTestPage = new URLSearchParams(window.location.search).has('test');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCandidateUpload ? <CandidateUploadPage /> : isOfferPage ? <OfferResponsePage /> : isScreenPage ? <ScreeningLinkPage /> : isTestPage ? <SkillTestPage /> : <App />}
  </StrictMode>,
);
