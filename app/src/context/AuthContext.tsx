import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Handle OAuth callback - Supabase redirects back with hash fragments
    const handleAuthCallback = async () => {
      // Check if we're on the Supabase callback URL (wrong redirect)
      if (window.location.hostname.includes('supabase.co')) {
        // Extract the actual redirect URL from the path
        const pathParts = window.location.pathname.split('/');
        if (pathParts.length > 1) {
          const actualDomain = pathParts[pathParts.length - 1];
          // Redirect to the actual app domain
          window.location.href = `https://${actualDomain}${window.location.hash}`;
          return;
        }
      }

      // Check for hash fragments (OAuth callback)
      if (window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const error = hashParams.get('error');
        
        if (error) {
          console.error('OAuth error:', error);
          setLoading(false);
          return;
        }
        
        if (accessToken) {
          // Supabase will handle the session automatically
          // Clean up the URL by removing hash fragments after processing
          setTimeout(() => {
            window.history.replaceState({}, document.title, window.location.pathname);
          }, 100);
        }
      }
    };

    handleAuthCallback();

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    // Use the current origin as redirect URL
    // Important: This must match the Site URL or be in the Redirect URLs list in Supabase
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    
    console.log('Redirecting to:', redirectTo);
    
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    
    if (error) {
      console.error('Error signing in with Google:', error);
      throw error;
    }
    
    // Note: The browser will redirect to Google for authentication
    // After authentication, Google will redirect back to Supabase's callback URL
    // Supabase will then redirect to the redirectTo URL we specified
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  const value = {
    user,
    session,
    loading,
    signInWithGoogle,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

