import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Whether a Supabase backend is configured. When false, the app still boots
 * and runs fully in guest mode (plans persist to the browser). We deliberately
 * do NOT throw at module load — a missing env must not white-screen the app.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let client: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  client = createClient(supabaseUrl as string, supabaseAnonKey as string);
} else if (import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.info(
    '[course-connect] Supabase env vars not set — running in guest-only mode.'
  );
}

/**
 * The Supabase client, or `null` when no backend is configured.
 * Always guard usage: `if (!supabase) return;`
 */
export const supabase = client;
