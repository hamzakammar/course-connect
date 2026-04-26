import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './SignInPage.css';

const SignInPage: React.FC = () => {
  const { signInWithGoogle, signInDemo } = useAuth();
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
    <div className="App">
      <div className="app-header">
        <h1>Course Connect Planner</h1>
      </div>
      
      <div className="main-content">
        <div className="sign-in-container">
          <div className="sign-in-card">
            <h2>Sign In</h2>
            <p className="sign-in-description">
              Sign in with your Google account to save and manage your course plans.
            </p>
            
            {error && (
              <div className="error-message">
                {error}
              </div>
            )}
            
            <button
              className="sign-in-button"
              onClick={handleSignIn}
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in with Google'}
            </button>

            <div className="demo-divider">
              <span>or</span>
            </div>

            <button
              className="demo-button"
              onClick={signInDemo}
            >
              Try Demo Mode
            </button>
            <p className="demo-note">No account needed. Plans won't be saved.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;
