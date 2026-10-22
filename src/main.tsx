import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {CandidateUploadPage} from './components/CandidateUploadPage.tsx';
import {AssessmentPage} from './components/assessment/AssessmentPage.tsx';
import './index.css';

// Public candidate upload page (opened from the onboarding email). Bypasses the HR login.
const isCandidateUpload = window.location.pathname.startsWith('/onboarding/upload');

// Public skill assessment page (opened from the link in the assessment email). Also bypasses the HR login.
const isAssessment = window.location.pathname.startsWith('/assessment');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCandidateUpload ? <CandidateUploadPage /> : isAssessment ? <AssessmentPage /> : <App />}
  </StrictMode>,
);
