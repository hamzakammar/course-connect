import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export interface SavedPlan {
  id: string;
  user_id: string;
  plan_name: string;
  selected_courses: string[];
  elective_assignments: Record<string, string>;
  // Courses taken off-term during a co-op/work term, keyed by work-term id (e.g. "W1").
  // Optional for backward-compatibility with plans saved before this feature existed.
  offterm_courses?: Record<string, string[]>;
  created_at: string;
  updated_at: string;
}

const GUEST_PLANS_KEY = 'cc-guest-plans';

// ---- Guest (localStorage) persistence helpers ----

function readGuestPlans(): SavedPlan[] {
  try {
    const raw = localStorage.getItem(GUEST_PLANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedPlan[]) : [];
  } catch {
    return [];
  }
}

function writeGuestPlans(plans: SavedPlan[]) {
  try {
    localStorage.setItem(GUEST_PLANS_KEY, JSON.stringify(plans));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `guest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function cleanAssignments(
  electiveAssignments: Record<string, string | undefined>
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  Object.entries(electiveAssignments).forEach(([key, value]) => {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  });
  return cleaned;
}

export const usePlans = () => {
  const { user, guest } = useAuth();
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Guest mode: load plans from the browser, no network.
    if (guest && !user) {
      setPlans(readGuestPlans());
      setLoading(false);
      setError(null);
      return;
    }

    if (!user || !supabase) {
      setPlans([]);
      setLoading(false);
      return;
    }

    const fetchPlans = async () => {
      if (!supabase) return;
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
  }, [user, guest]);

  const savePlan = async (
    planName: string,
    selectedCourses: Set<string>,
    electiveAssignments: Record<string, string | undefined>,
    offTermCourses: Record<string, string[]> = {}
  ): Promise<SavedPlan | null> => {
    const cleaned = cleanAssignments(electiveAssignments);

    // Guest mode: persist to localStorage.
    if (guest && !user) {
      const now = new Date().toISOString();
      const plan: SavedPlan = {
        id: makeId(),
        user_id: 'guest',
        plan_name: planName,
        selected_courses: Array.from(selectedCourses),
        elective_assignments: cleaned,
        created_at: now,
        updated_at: now,
      };
      setPlans(prev => {
        const next = [plan, ...prev];
        writeGuestPlans(next);
        return next;
      });
      return plan;
    }

    if (!user || !supabase) {
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
          offterm_courses: offTermCourses,
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
    electiveAssignments: Record<string, string | undefined>,
    offTermCourses: Record<string, string[]> = {}
  ): Promise<SavedPlan | null> => {
    const cleaned = cleanAssignments(electiveAssignments);

    // Guest mode: update in localStorage.
    if (guest && !user) {
      let updated: SavedPlan | null = null;
      setPlans(prev => {
        const next = prev.map(p => {
          if (p.id !== planId) return p;
          updated = {
            ...p,
            plan_name: planName,
            selected_courses: Array.from(selectedCourses),
            elective_assignments: cleaned,
            updated_at: new Date().toISOString(),
          };
          return updated;
        });
        writeGuestPlans(next);
        return next;
      });
      return updated;
    }

    if (!user || !supabase) {
      throw new Error('Must be logged in to update plans');
    }

    try {
      const { data, error: updateError } = await supabase
        .from('user_plans')
        .update({
          plan_name: planName,
          selected_courses: Array.from(selectedCourses),
          elective_assignments: cleaned,
          offterm_courses: offTermCourses,
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
    // Guest mode: delete from localStorage.
    if (guest && !user) {
      setPlans(prev => {
        const next = prev.filter(p => p.id !== planId);
        writeGuestPlans(next);
        return next;
      });
      return;
    }

    if (!user || !supabase) {
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
