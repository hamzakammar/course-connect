import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export interface SavedPlan {
  id: string;
  user_id: string;
  plan_name: string;
  selected_courses: string[];
  elective_assignments: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export const usePlans = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user) {
      setPlans([]);
      setLoading(false);
      return;
    }

    const fetchPlans = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('user_plans')
          .select('*')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false });

        if (fetchError) {
          console.error('Supabase fetch error:', fetchError);
          // Don't throw on 42P01 (table doesn't exist) - just return empty array
          if (fetchError.code === '42P01') {
            console.warn('Table "user_plans" does not exist. Run the migration.');
            setPlans([]);
            return;
          }
          throw fetchError;
        }

        setPlans(data || []);
      } catch (err) {
        console.error('Error fetching plans:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setLoading(false);
      }
    };

    fetchPlans();
  }, [user]);

  const savePlan = async (
    planName: string,
    selectedCourses: Set<string>,
    electiveAssignments: Record<string, string | undefined>
  ): Promise<SavedPlan | null> => {
    // Filter out undefined values before saving
    const cleaned: Record<string, string> = {};
    Object.entries(electiveAssignments).forEach(([key, value]) => {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    });
    if (!user) {
      throw new Error('Must be logged in to save plans');
    }

    try {
      const { data, error: insertError } = await supabase
        .from('user_plans')
        .insert({
          user_id: user.id,
          plan_name: planName,
          selected_courses: Array.from(selectedCourses),
          elective_assignments: cleaned,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Supabase insert error:', insertError);
        // Provide more helpful error messages
        if (insertError.code === '42P01') {
          throw new Error('Table "user_plans" does not exist. Run the migration: migrations/create_user_plans.sql');
        } else if (insertError.code === '42501') {
          throw new Error('Permission denied. Check RLS policies in Supabase.');
        } else if (insertError.message) {
          throw new Error(insertError.message);
        }
        throw insertError;
      }

      setPlans(prev => [data, ...prev]);
      return data;
    } catch (err) {
      console.error('Error saving plan:', err);
      throw err;
    }
  };

  const updatePlan = async (
    planId: string,
    planName: string,
    selectedCourses: Set<string>,
    electiveAssignments: Record<string, string | undefined>
  ): Promise<SavedPlan | null> => {
    // Filter out undefined values before saving
    const cleaned: Record<string, string> = {};
    Object.entries(electiveAssignments).forEach(([key, value]) => {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    });
    if (!user) {
      throw new Error('Must be logged in to update plans');
    }

    try {
      const { data, error: updateError } = await supabase
        .from('user_plans')
        .update({
          plan_name: planName,
          selected_courses: Array.from(selectedCourses),
          elective_assignments: cleaned,
          updated_at: new Date().toISOString(),
        })
        .eq('id', planId)
        .eq('user_id', user.id)
        .select()
        .single();

      if (updateError) {
        console.error('Supabase update error:', updateError);
        if (updateError.code === '42P01') {
          throw new Error('Table "user_plans" does not exist. Run the migration: migrations/create_user_plans.sql');
        } else if (updateError.code === '42501') {
          throw new Error('Permission denied. Check RLS policies in Supabase.');
        } else if (updateError.message) {
          throw new Error(updateError.message);
        }
        throw updateError;
      }

      setPlans(prev => prev.map(p => p.id === planId ? data : p));
      return data;
    } catch (err) {
      console.error('Error updating plan:', err);
      throw err;
    }
  };

  const deletePlan = async (planId: string): Promise<void> => {
    if (!user) {
      throw new Error('Must be logged in to delete plans');
    }

    try {
      const { error: deleteError } = await supabase
        .from('user_plans')
        .delete()
        .eq('id', planId)
        .eq('user_id', user.id);

      if (deleteError) {
        throw deleteError;
      }

      setPlans(prev => prev.filter(p => p.id !== planId));
    } catch (err) {
      console.error('Error deleting plan:', err);
      throw err;
    }
  };

  return { plans, loading, error, savePlan, updatePlan, deletePlan };
};

