import React, { useState } from 'react';
import {
  X,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  FileEdit,
  GitCompare,
  RotateCcw,
  Check,
  Clock,
  Layers,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { User, UserRole } from '../types';
import { governanceEngine } from '../services/governance';

interface DemoWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  users: User[];
  onSwitchUser: (user: User) => void;
  onRefreshData: () => void;
}

export const DemoWorkflowModal: React.FC<DemoWorkflowModalProps> = ({
  isOpen,
  onClose,
  users,
  onSwitchUser,
  onRefreshData,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [isRunningAuto, setIsRunningAuto] = useState(false);

  if (!isOpen) return null;

  const creator = users.find((u) => u.role === UserRole.CREATOR)!;
  const reviewer = users.find((u) => u.role === UserRole.REVIEWER)!;
  const employee = users.find((u) => u.role === UserRole.EMPLOYEE)!;

  const steps = [
    {
      title: 'Step 1: Creator Submits Initial Document (v1.0)',
      role: 'HR Creator',
      desc: 'HR Creator creates a new Document Master "Work From Home Policy" and submits initial baseline Version 1.0 (IN_REVIEW).',
      action: async () => {
        onSwitchUser(creator);
      },
    },
    {
      title: 'Step 2: Reviewer Approves & Auto-Publishes v1.0',
      role: 'HR Reviewer',
      desc: 'Reviewer inspects v1.0 and approves it. The engine atomically publishes v1.0, calculates SHA-256 hash, locks the file, and dispatches employee notifications.',
      action: async () => {
        onSwitchUser(reviewer);
      },
    },
    {
      title: 'Step 3: Creator Drafts Minor Revision (v1.1)',
      role: 'HR Creator',
      desc: 'Creator selects WFH Policy, selects Minor Revision, and submits v1.1 for reviewer authorization.',
      action: async () => {
        onSwitchUser(creator);
      },
    },
    {
      title: 'Step 4: Reviewer Compares v1.0 vs v1.1 & Rejects with Feedback',
      role: 'HR Reviewer',
      desc: 'Reviewer inspects side-by-side diff against v1.0 baseline and rejects with comment: "Please update the eligibility section and clarify manager approval requirements."',
      action: async () => {
        onSwitchUser(reviewer);
      },
    },
    {
      title: 'Step 5: Creator Inspects Feedback & Creates v2.0 Major Revision',
      role: 'HR Creator',
      desc: 'Creator sees v1.1 REVISION REQUIRED, adds manager approval + $75 broadband stipend, and submits v2.0 (Major Revision). Note: Baseline remains v1.0!',
      action: async () => {
        onSwitchUser(creator);
      },
    },
    {
      title: 'Step 6: Reviewer Approves v2.0 -> Supersedes v1.0 -> Auto-Publishes',
      role: 'HR Reviewer',
      desc: 'Reviewer inspects v1.0 vs v2.0 comparison, approves it. Engine automatically publishes v2.0, marks v1.0 SUPERSEDED, preserves v1.1 rejected history, and broadcasts email notifications.',
      action: async () => {
        onSwitchUser(reviewer);
      },
    },
    {
      title: 'Step 7: Employee Acknowledges Live Policy v2.0',
      role: 'Employee',
      desc: 'Employee logs in, views the live published v2.0 policy, and signs the version-specific compliance acknowledgement.',
      action: async () => {
        onSwitchUser(employee);
      },
    },
  ];

  const handleStepClick = async (index: number) => {
    setCurrentStep(index);
    if (steps[index]) {
      await steps[index].action();
      onRefreshData();
    }
  };

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      await handleStepClick(currentStep + 1);
    }
  };

  const handlePrev = async () => {
    if (currentStep > 0) {
      await handleStepClick(currentStep - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {/* HEADER */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-[#FA7014]/20 border border-[#FA7014]/40 flex items-center justify-center shadow-inner">
              <Sparkles className="w-5 h-5 text-[#FA7014]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">HR Document Governance Specification Demo Walkthrough</h2>
              <p className="text-xs text-slate-400">
                Verifies Section 48 end-to-end test lifecycle: Creation → Review → Rejection → Revisions → Side-by-Side Diff → Auto-Publish → Superseding
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP PROGRESS BAR */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3.5 shrink-0">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-2">
            <span>Workflow Progress: Step {currentStep + 1} of {steps.length}</span>
            <span className="text-[#FA7014] bg-orange-50 border border-orange-200 px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold">
              Active Role: {steps[currentStep].role}
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => handleStepClick(i)}
                className={`h-2 rounded-full transition-all cursor-pointer ${
                  i === currentStep
                    ? 'bg-[#FA7014] ring-2 ring-[#FA7014]/30'
                    : i < currentStep
                    ? 'bg-slate-900'
                    : 'bg-slate-200'
                }`}
                title={s.title}
              />
            ))}
          </div>
        </div>

        {/* ACTIVE STEP CARD */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 space-y-6">
          <div className="bg-white border border-orange-200 rounded-2xl p-5 shadow-xs bg-orange-50/20">
            <div className="flex items-center space-x-2.5 text-slate-900 font-bold text-base mb-1">
              <ShieldCheck className="w-5 h-5 text-[#FA7014] shrink-0" />
              <span>{steps[currentStep].title}</span>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed mt-2">
              {steps[currentStep].desc}
            </p>
          </div>

          {/* SUMMARY OF ALL 7 CORE LIFECYCLE PHASES */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Complete End-to-End Governance Milestones
            </h3>

            <div className="space-y-2.5">
              {steps.map((s, idx) => (
                <div
                  key={idx}
                  onClick={() => handleStepClick(idx)}
                  className={`p-3.5 rounded-xl border text-xs flex items-center justify-between cursor-pointer transition-all ${
                    idx === currentStep
                      ? 'border-[#FA7014] bg-white shadow-xs ring-1 ring-[#FA7014]/30'
                      : idx < currentStep
                      ? 'border-slate-300 bg-white text-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-600'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${
                        idx === currentStep
                          ? 'bg-[#FA7014] text-white font-extrabold'
                          : idx < currentStep
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}
                    >
                      {idx < currentStep ? <Check className="w-3.5 h-3.5" /> : idx + 1}
                    </span>
                    <span className={`font-semibold ${idx === currentStep ? 'text-slate-900' : idx < currentStep ? 'text-slate-900' : 'text-slate-600'}`}>
                      {s.title}
                    </span>
                  </div>

                  <span className="text-[11px] font-medium text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                    {s.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FOOTER ACTIONS */}
        <div className="bg-white px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0">
          <button
            onClick={handlePrev}
            disabled={currentStep === 0}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-30 transition-colors"
          >
            Previous Milestone
          </button>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold px-4 py-2 rounded-xl transition-colors border border-slate-300"
            >
              Resume Testing in App
            </button>

            <button
              onClick={handleNext}
              disabled={currentStep === steps.length - 1}
              className="bg-[#FA7014] hover:bg-[#E65A05] text-white text-xs font-bold px-4 py-2 rounded-xl transition-all flex items-center space-x-1.5 disabled:opacity-40 shadow-sm shadow-[#FA7014]/20"
            >
              <span>Next Milestone</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
