import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CandidateUploadPage} from './components/CandidateUploadPage.tsx';
import './index.css';

// Public candidate upload page (opened from the onboarding email). Bypasses the HR login.
const isCandidateUpload = window.location.pathname.startsWith('/onboarding/upload');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCandidateUpload ? <CandidateUploadPage /> : <App />}
  </StrictMode>,
);
