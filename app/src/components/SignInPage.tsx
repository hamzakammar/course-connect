import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './SignInPage.css';

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
    <div className="sign-in-page">
      <div className="sign-in-container">
        <h1>Course Connect Planner</h1>
        <p className="sign-in-subtitle">Plan your course schedule with ease</p>
        
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
          
          <p className="sign-in-note">
            Note: University of Waterloo accounts are preferred, but any Google account works.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SignInPage;

