import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

interface UserProfile {
  user_id: string;
  email: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export const useUser = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const fetchUserProfile = async () => {
      try {
        setLoading(true);
        setError(null);

        // Try to fetch user profile
        const { data, error: fetchError } = await supabase
          .from('users')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (fetchError) {
          // If user doesn't exist, create one
          if (fetchError.code === 'PGRST116') {
            const { data: newUser, error: insertError } = await supabase
              .from('users')
              .insert({
                user_id: user.id,
                email: user.email || '',
                name: user.user_metadata?.full_name || user.user_metadata?.name || null,
              })
              .select()
              .single();

            if (insertError) {
              throw insertError;
            }

            setProfile(newUser);
          } else {
            throw fetchError;
          }
        } else {
          setProfile(data);
        }
      } catch (err) {
        console.error('Error fetching user profile:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [user]);

  return { profile, loading, error };
};

