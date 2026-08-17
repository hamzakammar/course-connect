-- Migration: add off-term (co-op) courses to user_plans
--
-- Adds a JSONB column that stores courses a student takes OFF-TERM during a
-- co-op / work term. The value is an object keyed by work-term id (e.g. "W1")
-- mapping to an array of course codes:
--
--   { "W1": ["CS 245"], "W3": ["STAT 231"] }
--
-- Idempotent and backward-compatible: existing plans default to an empty
-- object, so plans saved before this feature keep working unchanged.

ALTER TABLE public.user_plans
  ADD COLUMN IF NOT EXISTS offterm_courses jsonb NOT NULL DEFAULT '{}'::jsonb;
