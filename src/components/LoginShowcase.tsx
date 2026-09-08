import React from 'react';
import hrPolicyShowcaseImg from '../assets/images/hr_policy_showcase_1788517796283.jpg';

export const LoginShowcase: React.FC = () => {
  return (
    <div className="hidden lg:flex w-full lg:w-[45%] xl:w-[44%] h-full max-h-screen relative bg-gradient-to-br from-[#FFF7ED] via-[#FFF9F5] to-[#FFEDD5]/40 flex-col items-center justify-center p-6 xl:p-8 overflow-hidden select-none">
      {/* Organic background curved glow shapes */}
      <div className="absolute -top-24 -right-24 w-80 h-80 bg-gradient-to-br from-[#FA7014]/20 to-orange-200/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-gradient-to-tr from-[#FA7014]/15 to-orange-100/30 rounded-full blur-3xl pointer-events-none" />

      {/* Subtle decorative dot matrix grid matching the uploaded reference */}
      <div className="absolute top-8 right-10 grid grid-cols-5 gap-2.5 opacity-25 pointer-events-none">
        {Array.from({ length: 25 }).map((_, i) => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#FA7014]" />
        ))}
      </div>

      <div className="absolute bottom-8 left-8 grid grid-cols-4 gap-2.5 opacity-20 pointer-events-none">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#FA7014]" />
        ))}
      </div>

      {/* Central Architectural Showcase Container */}
      <div className="relative z-10 w-full max-w-sm xl:max-w-md flex flex-col items-center">
        {/* Main 3D Artwork Stage */}
        <div className="relative w-full max-w-[270px] xl:max-w-[300px] rounded-3xl overflow-visible">
          {/* The 3D Policy Illustration Canvas */}
          <div className="relative rounded-3xl overflow-hidden shadow-2xl shadow-orange-950/15 border-2 border-white/80 bg-white">
            <img
              src={hrPolicyShowcaseImg}
              alt="HR Policy Document Governance Showcase"
              referrerPolicy="no-referrer"
              className="w-full max-h-[38vh] object-cover transform hover:scale-102 transition-transform duration-500"
            />
          </div>
        </div>

        {/* Slogan and Brand Callout matching uploaded image */}
        <div className="mt-5 text-center space-y-2 w-full">
          {/* PEOPLE. PROCESS. PROGRESS. */}
          <div className="inline-flex flex-col items-center">
            <p className="text-xs sm:text-sm font-black tracking-[0.25em] text-slate-800 uppercase">
              PEOPLE. PROCESS. PROGRESS.
            </p>
            <div className="w-12 h-1 bg-[#FA7014] rounded-full mt-1" />
          </div>

          {/* Script typography flourish matching image */}
          <div className="pt-0.5">
            <p className="font-serif italic text-xl xl:text-2xl text-slate-800 font-semibold tracking-wide">
              Together for a Better Tomorrow
            </p>
            <svg className="w-44 h-3 text-[#FA7014] mx-auto mt-0.5" viewBox="0 0 200 12" fill="none">
              <path d="M4 9C55 2 145 2 196 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>

          {/* Feature Pills */}
          <div className="flex items-center justify-center gap-2 pt-1 flex-wrap">
            <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white/90 border border-orange-200/70 text-slate-700 shadow-xs">
              Two-Tier Approval
            </span>
            <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white/90 border border-orange-200/70 text-slate-700 shadow-xs">
              Corporate Governance
            </span>
            <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-white/90 border border-orange-200/70 text-slate-700 shadow-xs">
              Immutable Ledger
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
