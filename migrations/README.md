# Database Migrations

## Running the Migration

To enable user plan saving functionality, you need to run the SQL migration in your Supabase database.

### Steps:

1. **Open Supabase SQL Editor**
   - Go to your Supabase Dashboard
   - Navigate to **SQL Editor**

2. **Run the migration**
   - Copy the contents of `create_user_plans.sql`
   - Paste into the SQL Editor
   - Click "Run" or press Cmd/Ctrl + Enter

3. **Verify the table was created**
   - Go to **Table Editor**
   - You should see a new `user_plans` table

### What this creates:

- **`user_plans` table** - Stores saved course plans
  - `id` - Unique plan ID
  - `user_id` - Links to auth.users
  - `plan_name` - Name of the plan
  - `selected_courses` - Array of selected course codes
  - `elective_assignments` - JSON object mapping electives to terms
  - `offterm_courses` - JSON object mapping work-term id (e.g. "W1") to an array
    of course codes taken off-term during a co-op/work term
  - `created_at` / `updated_at` - Timestamps

## Off-term (co-op) courses migration

After the base table exists, run `add_offterm_courses.sql` in the Supabase SQL
Editor to add the `offterm_courses` column. It is idempotent
(`ADD COLUMN IF NOT EXISTS`) and backward-compatible — existing plans default to
an empty object.

- **Row Level Security (RLS)** - Users can only access their own plans
- **Automatic timestamp updates** - `updated_at` updates on plan changes

### Notes:

- The migration is idempotent (safe to run multiple times)
- RLS policies ensure users can only see/modify their own plans
- The table uses `auth.users` from Supabase Auth

