import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, ThemeToggle } from './ui';

const SignInPage: React.FC = () => {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign in');
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-bg text-text">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-e1">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v13H6.5A2.5 2.5 0 0 0 4 19.5V6.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20v3H6.5A2.5 2.5 0 0 1 4 19.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-base font-semibold tracking-tight">Course Connect</span>
        </div>
        <ThemeToggle />
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-border bg-surface p-8 shadow-e3">
            <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-met" />
              UWaterloo Degree Planner
            </span>

            <h1 className="text-2xl font-semibold tracking-tight">
              Plan your degree with clarity
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Sign in with Google to build term-by-term plans, track
              prerequisites, and save your progress across sessions.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-5 rounded-md border border-unmet-border bg-unmet-soft px-3.5 py-2.5 text-sm text-unmet-fg"
              >
                {error}
              </div>
            )}

            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="mt-6"
              onClick={handleSignIn}
              disabled={loading}
              leadingIcon={
                !loading && (
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                    <path fill="#FFC107" d="M21.35 11.1H12v2.98h5.35c-.5 2.4-2.5 3.7-5.35 3.7A5.78 5.78 0 0 1 6.22 12 5.78 5.78 0 0 1 12 6.22c1.4 0 2.67.5 3.66 1.32l2.14-2.14A8.9 8.9 0 0 0 12 3a9 9 0 1 0 0 18c4.5 0 8.6-3.27 8.6-9 0-.6-.08-1.26-.25-1.9Z" />
                  </svg>
                )
              }
            >
              {loading ? 'Signing in…' : 'Continue with Google'}
            </Button>

            <p className="mt-4 text-center text-xs text-faint">
              Your plans are private and tied to your Google account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
