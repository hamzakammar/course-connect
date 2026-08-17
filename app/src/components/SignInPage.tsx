import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button, ThemeToggle } from './ui';

const SignInPage: React.FC = () => {
  const { signInWithGoogle, continueAsGuest, isConfigured } = useAuth();
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
    <div className="flex min-h-screen flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border-strong px-4 py-3 sm:px-6">
        <div className="flex items-baseline gap-2.5">
          <span className="h-3.5 w-3.5 shrink-0 translate-y-0.5 bg-accent" aria-hidden />
          <span className="font-display text-xl font-semibold tracking-tight">
            Course Connect
          </span>
        </div>
        <ThemeToggle />
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <div className="grid gap-12 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          {/* Editorial masthead */}
          <div>
            <p className="eyebrow mb-5">University of Waterloo · Degree Planner</p>
            <h1 className="font-display text-[2.75rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl">
              Plan your degree,
              <br />
              <span className="italic text-accent">term by term.</span>
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted">
              Map requirements, track prerequisites, and see every term at a
              glance. Start immediately as a guest — no account needed — or sign
              in to sync across devices.
            </p>

            <dl className="mt-10 grid max-w-md grid-cols-3 border-y border-border">
              {[
                ['8', 'Terms'],
                ['1:1', 'Prereq graph'],
                ['0', 'Setup required'],
              ].map(([stat, label]) => (
                <div key={label} className="border-r border-border px-4 py-4 last:border-r-0">
                  <div className="font-display text-2xl font-semibold tabular-nums">{stat}</div>
                  <div className="eyebrow mt-1">{label}</div>
                </div>
              ))}
            </dl>
          </div>

          {/* Entry panel */}
          <div className="border border-border-strong bg-surface p-8">
            <h2 className="font-display text-2xl font-semibold tracking-tight">Get started</h2>
            <p className="mt-1.5 text-sm text-muted">
              Choose how you'd like to begin.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-5 border-l-2 border-accent bg-accent-soft px-3.5 py-2.5 text-sm text-accent-soft-fg"
              >
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3">
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={continueAsGuest}
                trailingIcon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              >
                Continue as guest
              </Button>

              {isConfigured ? (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={handleSignIn}
                  disabled={loading}
                  leadingIcon={
                    !loading && (
                      <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden>
                        <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.5 2.4-2.5 3.7-5.35 3.7A5.78 5.78 0 0 1 6.22 12 5.78 5.78 0 0 1 12 6.22c1.4 0 2.67.5 3.66 1.32l2.14-2.14A8.9 8.9 0 0 0 12 3a9 9 0 1 0 0 18c4.5 0 8.6-3.27 8.6-9 0-.6-.08-1.26-.25-1.9Z" />
                      </svg>
                    )
                  }
                >
                  {loading ? 'Signing in…' : 'Sign in with Google'}
                </Button>
              ) : (
                <p className="border border-border px-3.5 py-2.5 text-xs leading-relaxed text-muted">
                  Google sign-in is unavailable in this preview (no backend
                  configured). Guest mode saves your plans to this browser.
                </p>
              )}
            </div>

            <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-faint">
              Guest plans persist locally on this device. Sign in any time to
              sync them to your account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
