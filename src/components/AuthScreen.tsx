import React, { useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, User as UserIcon } from 'lucide-react';
import { LoginShowcase } from './LoginShowcase';
import { registerCompany, requestPasswordReset, signIn } from '../services/authService';

type Mode = 'signin' | 'signup' | 'forgot';

const field =
  'w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#FA7014] focus:outline-none focus:ring-2 focus:ring-[#FA7014]/20';

const Field: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="relative">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>
    {children}
  </div>
);

/**
 * One sign-in form for everyone. Which portal opens (HR, Approver, Employee) and what each person may do
 * comes from their company roles, not from a tab they pick here.
 */
export const AuthScreen: React.FC = () => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setNotice('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        if (!email.trim() || !password) throw new Error('Enter your email and password.');
        await signIn(email, password);
      } else if (mode === 'signup') {
        if (companyName.trim().length < 2) throw new Error('Enter your company name.');
        if (adminName.trim().length < 2) throw new Error('Enter your name.');
        if (!email.trim()) throw new Error('Enter your work email.');
        if (password.length < 8) throw new Error('Choose a password of at least 8 characters.');
        await registerCompany({ companyName, adminName, email, password });
      } else {
        if (!email.trim()) throw new Error('Enter your email.');
        await requestPasswordReset(email);
        setNotice('If an account exists for that email, a reset link is on its way.');
      }
    } catch (err: any) {
      setError(err?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#F8FAFC] lg:h-screen lg:flex-row lg:overflow-hidden">
      <div className="relative flex w-full flex-col items-center justify-center overflow-y-auto px-4 py-8 sm:px-8 lg:h-full lg:w-[58%] xl:w-[60%]">
        <div className="pointer-events-none absolute left-1/2 top-1/4 h-96 w-96 -translate-x-1/2 rounded-full bg-[#FA7014]/5 blur-3xl" />

        <div className="relative z-10 w-full max-w-[460px]">
          <div className="mb-5 text-center">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">HR AI Agent</h1>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
              Workforce automation, talent acquisition &amp; policy governance for your company.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-lg shadow-slate-200/50">
            <div>
              <h2 className="text-base font-black text-slate-900">
                {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Register your company' : 'Reset your password'}
              </h2>
              <p className="text-xs text-slate-500">
                {mode === 'signin' && 'Use the email and password for your company account.'}
                {mode === 'signup' && 'Create your company workspace. We review new companies before activating them.'}
                {mode === 'forgot' && 'We will email you a link to choose a new password.'}
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs font-medium text-rose-700">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
              </div>
            )}
            {notice && (
              <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {notice}
              </div>
            )}

            {mode === 'signup' && (
              <>
                <Field icon={<Building2 className="h-4 w-4" />}>
                  <input className={field} placeholder="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" />
                </Field>
                <Field icon={<UserIcon className="h-4 w-4" />}>
                  <input className={field} placeholder="Your full name" value={adminName} onChange={(e) => setAdminName(e.target.value)} autoComplete="name" />
                </Field>
              </>
            )}

            <Field icon={<Mail className="h-4 w-4" />}>
              <input
                className={field}
                type="email"
                placeholder="Work email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </Field>

            {mode !== 'forgot' && (
              <Field icon={<Lock className="h-4 w-4" />}>
                <input
                  className={`${field} pr-10`}
                  type={showPassword ? 'text' : 'password'}
                  placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </Field>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#FA7014] py-2.5 text-sm font-bold text-white transition hover:bg-[#E65A05] disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Register company' : 'Send reset link'}
            </button>

            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              {mode === 'signin' ? (
                <>
                  <button type="button" className="hover:text-[#FA7014]" onClick={() => switchMode('forgot')}>
                    Forgot password?
                  </button>
                  <button type="button" className="hover:text-[#FA7014]" onClick={() => switchMode('signup')}>
                    Register a company
                  </button>
                </>
              ) : (
                <button type="button" className="hover:text-[#FA7014]" onClick={() => switchMode('signin')}>
                  Back to sign in
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
      <LoginShowcase />
    </div>
  );
};
