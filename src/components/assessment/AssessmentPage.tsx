import React from 'react';
import { TestRunner } from './TestRunner';

/** Public page opened from the link in the assessment email. No login; the private token in the link is the credential. */
export const AssessmentPage: React.FC = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  return (
    <div className="min-h-screen bg-slate-50 flex justify-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-4">
        <div className="text-center">
          <h1 className="text-sm font-black tracking-wide text-slate-900 uppercase">Skill assessment</h1>
        </div>
        {token ? (
          <TestRunner testRef={{ token }} />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm font-bold text-slate-700">
            This assessment link is not valid. Please use the link from your email.
          </div>
        )}
      </div>
    </div>
  );
};
