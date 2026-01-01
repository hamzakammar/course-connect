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
  - `created_at` / `updated_at` - Timestamps

- **Row Level Security (RLS)** - Users can only access their own plans
- **Automatic timestamp updates** - `updated_at` updates on plan changes

### Notes:

- The migration is idempotent (safe to run multiple times)
- RLS policies ensure users can only see/modify their own plans
- The table uses `auth.users` from Supabase Auth

