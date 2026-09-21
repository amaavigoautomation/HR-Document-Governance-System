import React from 'react';
import { Sparkles, Bot, ShieldCheck, Zap } from 'lucide-react';
import hrAIAgentShowcaseImg from '../assets/images/hr_ai_agent_showcase_1789457077569.jpg';

export const LoginShowcase: React.FC = () => {
  return (
    <div className="hidden lg:flex w-full lg:w-[42%] xl:w-[40%] h-full max-h-screen relative bg-gradient-to-br from-[#FFF7ED] via-[#FFF9F5] to-[#FFEDD5]/40 flex-col items-center justify-center p-4 xl:p-6 overflow-hidden select-none">
      {/* Organic background curved glow shapes */}
      <div className="absolute -top-24 -right-24 w-80 h-80 bg-gradient-to-br from-[#FA7014]/20 to-orange-200/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-gradient-to-tr from-[#FA7014]/15 to-orange-100/30 rounded-full blur-3xl pointer-events-none" />

      {/* Subtle decorative dot matrix grid matching the reference */}
      <div className="absolute top-6 right-8 grid grid-cols-5 gap-2 opacity-25 pointer-events-none">
        {Array.from({ length: 25 }).map((_, i) => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#FA7014]" />
        ))}
      </div>

      <div className="absolute bottom-6 left-8 grid grid-cols-4 gap-2 opacity-20 pointer-events-none">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#FA7014]" />
        ))}
      </div>

      {/* Central Architectural Showcase Container */}
      <div className="relative z-10 w-full max-w-xs xl:max-w-sm flex flex-col items-center">
        {/* Main 3D Artwork Stage */}
        <div className="relative w-full max-w-[220px] xl:max-w-[250px] rounded-2xl sm:rounded-3xl overflow-visible">
          {/* The 3D HR AI Agent Illustration Canvas */}
          <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden shadow-xl shadow-orange-950/15 border-2 border-white/80 bg-white group">
            <img
              src={hrAIAgentShowcaseImg}
              alt="Amaavigo HR AI Agent Platform"
              referrerPolicy="no-referrer"
              className="w-full max-h-[26vh] xl:max-h-[30vh] object-cover transform hover:scale-102 transition-transform duration-500"
            />
            {/* Ambient AI Engine Badge */}
            <div className="absolute top-2.5 right-2.5 bg-slate-900/85 backdrop-blur-md border border-white/20 text-white text-[9px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FA7014] animate-pulse" />
              <span>Amaavigo AI Agent</span>
            </div>
          </div>
        </div>

        {/* Slogan and Brand Callout tailored to Amaavigo and HR AI Agent */}
        <div className="mt-3.5 text-center space-y-1.5 w-full">
          {/* PEOPLE. INTELLIGENCE. PROGRESS. */}
          <div className="inline-flex flex-col items-center">
            <p className="text-[11px] font-black tracking-[0.22em] text-slate-800 uppercase">
              PEOPLE • INTELLIGENCE • PROGRESS
            </p>
            <div className="w-10 h-0.5 bg-[#FA7014] rounded-full mt-1" />
          </div>

          {/* Script typography flourish combining Amaavigo tagline with HR AI Agent */}
          <div className="pt-0.5">
            <p className="font-serif italic text-lg xl:text-xl text-slate-800 font-semibold tracking-wide">
              Where Talent &amp; Intelligence Take Flight
            </p>
            <svg className="w-40 h-2.5 text-[#FA7014] mx-auto mt-0.5" viewBox="0 0 200 12" fill="none">
              <path d="M4 9C55 2 145 2 196 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>

          {/* Feature Pills tailored to HR AI Agent capabilities */}
          <div className="flex items-center justify-center gap-1.5 pt-0.5 flex-wrap">
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/90 border border-orange-200/70 text-slate-700 shadow-2xs flex items-center gap-1">
              <Bot className="w-3 h-3 text-[#FA7014]" />
              Autonomous HR Agent
            </span>
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/90 border border-orange-200/70 text-slate-700 shadow-2xs flex items-center gap-1">
              <Zap className="w-3 h-3 text-[#FA7014]" />
              Talent Acquisition
            </span>
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-white/90 border border-orange-200/70 text-slate-700 shadow-2xs flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              Policy Governance
            </span>
          </div>

          {/* Descriptive mission text */}
          <p className="text-[10px] text-slate-500 max-w-xs mx-auto leading-normal">
            Automating hiring pipelines, enterprise policy compliance, and workforce intelligence.
          </p>
        </div>
      </div>
    </div>
  );
};
