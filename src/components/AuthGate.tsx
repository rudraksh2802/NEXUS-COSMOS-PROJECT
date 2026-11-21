import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { signInWithGooglePopup } from '../lib/firebase';
import {
  resendSupabaseVerification,
  signInWithSupabaseEmail,
  signUpWithSupabaseEmail,
} from '../lib/supabase';

interface AuthGateProps {
  onAuthenticated: () => void;
  onContinuePreview: () => void;
  initialNotice?: string | null;
}

export function AuthGate({
  onAuthenticated,
  onContinuePreview,
  initialNotice = null,
}: AuthGateProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(initialNotice);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setErrorMsg('Enter a valid Gmail or institutional email address.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setStatusNotice(null);

    try {
      if (mode === 'signup') {
        const { data, error } = await signUpWithSupabaseEmail(trimmedEmail, password);
        if (error) {
          throw new Error(error.message);
        }

        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setErrorMsg('An account with this email already exists. Switch to Sign In.');
          setIsSubmitting(false);
          return;
        }

        if (data.session) {
          onAuthenticated();
        } else {
          setVerificationSentTo(trimmedEmail);
          setStatusNotice(
            `Verification link dispatched to ${trimmedEmail}. Confirm your email inbox to activate cloud sync.`
          );
        }
      } else {
        const { data, error } = await signInWithSupabaseEmail(trimmedEmail, password);
        if (error) {
          if (error.message.toLowerCase().includes('email not confirmed')) {
            setVerificationSentTo(trimmedEmail);
            throw new Error(
              'Email address is not verified yet. Check your inbox or resend the verification link below.'
            );
          }
          throw new Error(error.message);
        }
        if (data.session) {
          onAuthenticated();
        }
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = verificationSentTo || email.trim();
    if (!targetEmail) return;
    setIsResending(true);
    setErrorMsg(null);
    try {
      const { error } = await resendSupabaseVerification(targetEmail);
      if (error) throw new Error(error.message);
      setStatusNotice(`Verification email re-sent to ${targetEmail}. Check Inbox and Spam.`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not resend verification email.');
    } finally {
      setIsResending(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setErrorMsg(null);
    setStatusNotice(null);
    try {
      await signInWithGooglePopup();
      onAuthenticated();
    } catch (err: any) {
      const msg = err?.message || 'Google sign-in failed.';
      setErrorMsg(
        msg.includes('popup-closed')
          ? 'Google sign-in popup was closed before completing.'
          : msg
      );
    } finally {
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0d11] text-slate-100 flex flex-col">
      {/* Top Mission Bar */}
      <header className="bg-[#0e1116] text-slate-100 border-b border-[#232936] px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-block w-2.5 h-2.5 bg-brand-400 rounded-xs shrink-0" />
          <span className="font-display font-extrabold tracking-tight text-base text-white shrink-0">
            TERRASIGHT
          </span>
          <span className="hidden md:inline text-xs font-medium italic text-slate-400 truncate">
            “Analyse the future before building one”
          </span>
        </div>
        <button
          type="button"
          onClick={onContinuePreview}
          className="text-xs font-semibold text-brand-400 hover:text-brand-300 transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          Open Public Workbench <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </header>

      {/* Main Split Architectural Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12">
        {/* Left Briefing Panel */}
        <section className="lg:col-span-7 border-b lg:border-b-0 lg:border-r border-[#232936] p-8 sm:p-12 lg:p-16 flex flex-col justify-between bg-[#0e1116] bg-[radial-gradient(ellipse_at_top_left,_rgba(92,153,238,0.10),_transparent_55%)] text-slate-100">
          <div className="max-w-xl space-y-6">
            <div className="text-xs font-mono font-bold uppercase tracking-widest text-brand-400">
              Sustainable Urban Planning &amp; Site Intelligence
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-display font-extrabold tracking-tight text-white leading-[1.08]">
              Analyse the future before building one.
            </h1>
            <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
              Evaluate residential townships, industrial parks, medical centres, commercial hubs, agricultural land, and green infrastructure against live CMIP6 climate warming, Copernicus 90m terrain, air quality, flood peaks, and 10-year internet intelligence before spending construction capital.
            </p>
          </div>

          <div className="mt-10 pt-8 border-t border-[#232936] grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
            <div className="bg-[#141820] border border-[#232936] rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-brand-400">
                CLIMATE OUTLOOK
              </div>
              <div className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                10–25 Years
              </div>
              <div className="text-xs text-slate-400 mt-0.5">CMCC-CM2 VHR4 + Live Web</div>
            </div>
            <div className="bg-[#141820] border border-[#232936] rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-sky-400">
                TERRAIN &amp; HYDROLOGY
              </div>
              <div className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                90m DEM + GloFAS
              </div>
              <div className="text-xs text-slate-400 mt-0.5">5×5 parcel elevation grid</div>
            </div>
            <div className="bg-[#141820] border border-[#232936] rounded-lg p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-amber-400">
                WORKSPACE SYNC
              </div>
              <div className="text-lg font-mono font-bold text-brand-400 mt-1">
                Verified Cloud
              </div>
              <div className="text-xs text-slate-400 mt-0.5">Supabase Auth + PostgreSQL</div>
            </div>
          </div>
        </section>

        {/* Right Authentication Form Panel */}
        <section className="lg:col-span-5 p-6 sm:p-10 lg:p-12 flex items-center justify-center bg-[#0b0d11]">
          <div className="w-full max-w-md bg-[#141820] border border-[#232936] rounded-lg p-6 sm:p-8 space-y-6 shadow-2xl">
            <div>
              <h2 className="text-2xl font-display font-extrabold text-white tracking-tight">
                {mode === 'signin' ? 'Organization Sign In' : 'Create Planner Account'}
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {mode === 'signin'
                  ? 'Access saved site dossiers, 10-year projections, and cost models.'
                  : 'Register with your Gmail or organization email. An email verification link will be sent automatically.'}
              </p>
            </div>

            {/* Mode Switcher */}
            <div className="grid grid-cols-2 border border-[#232936] bg-[#0e1116] p-1 rounded-md">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setErrorMsg(null);
                }}
                className={`py-2 text-xs font-bold rounded-sm transition-colors ${
                  mode === 'signin'
                    ? 'bg-brand-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setErrorMsg(null);
                }}
                className={`py-2 text-xs font-bold rounded-sm transition-colors ${
                  mode === 'signup'
                    ? 'bg-brand-500 text-slate-950'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Create Account
              </button>
            </div>

            {statusNotice && (
              <div className="p-3.5 bg-brand-950/40 border border-brand-500/40 rounded-md text-xs text-brand-200 space-y-2">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                  <span>{statusNotice}</span>
                </div>
                {verificationSentTo && (
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={isResending}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-300 hover:underline disabled:opacity-50"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    {isResending ? 'Sending verification email...' : 'Resend verification email'}
                  </button>
                )}
              </div>
            )}

            {errorMsg && (
              <div className="p-3.5 bg-amber-950/40 border border-amber-500/40 rounded-md text-xs text-amber-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
                {verificationSentTo && (
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={isResending}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-300 underline disabled:opacity-50"
                  >
                    {isResending ? 'Resending...' : `Resend verification to ${verificationSentTo}`}
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="auth-email" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Email Address (Gmail / Work)
                </label>
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="planner@gmail.com"
                  className="w-full px-3 py-2.5 text-sm bg-[#0e1116] border border-[#2a3140] rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-3 pr-10 py-2.5 text-sm bg-[#0e1116] border border-[#2a3140] rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-brand-500 hover:bg-brand-300 disabled:opacity-60 text-slate-950 text-xs font-bold uppercase tracking-wider rounded-md transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {mode === 'signup' ? 'Registering & Sending Verification...' : 'Signing In...'}
                  </>
                ) : mode === 'signup' ? (
                  'Create Account & Send Verification'
                ) : (
                  'Sign In with Email'
                )}
              </button>
            </form>

            <div className="relative flex items-center py-1">
              <div className="flex-1 border-t border-[#232936]" />
              <span className="px-3 text-[11px] font-mono uppercase text-slate-500">or</span>
              <div className="flex-1 border-t border-[#232936]" />
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isGoogleLoading}
              className="w-full py-2.5 px-4 bg-[#1a1f29] hover:bg-[#232936] border border-[#2a3140] hover:border-brand-500/50 text-white text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-2.5 disabled:opacity-60"
            >
              {isGoogleLoading ? (
                <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M12 10.2v3.9h5.5c-.2 1.2-1.5 3.6-5.5 3.6-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z"
                  />
                </svg>
              )}
              Continue with Google Account
            </button>

            <div className="pt-3 flex items-center justify-between text-[11px] text-slate-400 border-t border-[#232936]">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-brand-400" />
                Supabase Email Verification Enforced
              </span>
              <button
                type="button"
                onClick={onContinuePreview}
                className="font-semibold text-brand-400 hover:text-brand-300 hover:underline underline-offset-2"
              >
                Continue as Guest
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
