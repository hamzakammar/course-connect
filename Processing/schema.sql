-- schema.sql
-- PostgreSQL 14+ recommended

------------------------------
-- Extensions
------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

------------------------------
-- Enums & Domains
------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'program_kind_enum') THEN
    CREATE TYPE program_kind_enum AS ENUM ('degree','major','minor','option','specialization');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scope_enum') THEN
    CREATE TYPE scope_enum AS ENUM ('institution_wide','faculty_scoped','program_scoped');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'relation_kind_enum') THEN
    CREATE TYPE relation_kind_enum AS ENUM ('prereq','coreq','exclusion');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'requirement_type_enum') THEN
    CREATE TYPE requirement_type_enum AS ENUM ('ALL','ANY','N_OF','CREDITS_AT_LEAST','NOT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'course_set_mode_enum') THEN
    CREATE TYPE course_set_mode_enum AS ENUM ('explicit','selector');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'policy_scope_enum') THEN
    CREATE TYPE policy_scope_enum AS ENUM ('institution','faculty','program','program_pair','plan');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'policy_engine_enum') THEN
    CREATE TYPE policy_engine_enum AS ENUM ('jsonlogic','rego','datalog');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enroll_constraint_enum') THEN
    CREATE TYPE enroll_constraint_enum AS ENUM ('program_in','faculty_in','term_at_least','term_in','standing','plan_in','consent_required');
  END IF;
END $$;

-- Waterloo-style academic term codes like 1A..4B
CREATE DOMAIN term_code AS text
  CHECK (VALUE ~ '^[1-4][AB]$');

------------------------------
-- Utility function: term rank
------------------------------
CREATE OR REPLACE FUNCTION term_rank(t term_code)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE substring(t from 1 for 1)
      WHEN '1' THEN 10
      WHEN '2' THEN 20
      WHEN '3' THEN 30
      WHEN '4' THEN 40
    END
    +
    CASE substring(t from 2 for 1)
      WHEN 'A' THEN 0
      WHEN 'B' THEN 1
    END;
$$;

------------------------------
-- Core identity / provenance
------------------------------
CREATE TABLE institutions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          citext NOT NULL UNIQUE,
  timezone      text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_years (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  label          text NOT NULL,                        -- e.g., "2025-2026"
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  UNIQUE (institution_id, label),
  CHECK (start_date < end_date)
);

-- Simple faculties table for scoping options, constraints, etc.
CREATE TABLE faculties (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  code           citext NOT NULL,                      -- e.g., "Mathematics"
  name           text NOT NULL,
  UNIQUE (institution_id, code)
);

-- Sources for provenance & reproducibility
CREATE TABLE sources (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  url           text NOT NULL,
  hash          text,                                  -- content hash of snapshot
  snapshot_path text,                                  -- path in object storage
  fetched_at    timestamptz DEFAULT now()
);

------------------------------
-- Courses & relations
------------------------------
CREATE TABLE courses (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id  uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  code            citext NOT NULL,                     -- e.g., "CS 341"
  title           text NOT NULL,
  credits         numeric(5,2) NOT NULL CHECK (credits > 0),
  level           int NOT NULL CHECK (level BETWEEN 0 AND 999), -- 100..499 typical
  subject         citext NOT NULL,                     -- e.g., "CS","STAT"
  faculties       jsonb,                               -- optional array of faculty IDs
  attributes      jsonb,                               -- e.g., ["lab","communication"]
  effective_from  date,
  effective_to    date,
  source_id       uuid REFERENCES sources(id),
  source_url      text,
  source_hash     text,
  fetched_at      timestamptz,
  confidence      numeric(3,2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, code),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_from <= effective_to)
);

CREATE INDEX idx_courses_subject ON courses(subject);
CREATE INDEX idx_courses_level ON courses(level);
CREATE INDEX idx_courses_attrs_gin ON courses USING gin (attributes);

-- Logical relations like prereqs/coreqs/exclusions expressed as small expr language strings
CREATE TABLE course_relations (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind        relation_kind_enum NOT NULL,
  logic       text NOT NULL,                            -- e.g., "ALL(course:CS-240, ANY(course:STAT-206, course:CO-250))"
  source_span text
);

-- Enrollment constraints for “who/when can enroll”
CREATE TABLE course_enrollment_constraints (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  type        enroll_constraint_enum NOT NULL,
  values      jsonb,                                    -- list of IDs/codes depending on type
  term        term_code,                                -- for term_at_least or explicit term_in
  message     text
);

CREATE INDEX idx_c_enroll_type ON course_enrollment_constraints(type);
CREATE INDEX idx_c_enroll_values_gin ON course_enrollment_constraints USING gin (values);

------------------------------
-- Course sets (explicit/selector)
------------------------------
CREATE TABLE course_sets (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  mode        course_set_mode_enum NOT NULL,
  selector    jsonb,                                    -- e.g., { "subject": ["CS"], "level": {"min":300,"max":499} }
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_set_members (
  set_id      uuid NOT NULL REFERENCES course_sets(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (set_id, course_id)
);

CREATE INDEX idx_course_sets_selector_gin ON course_sets USING gin (selector);

------------------------------
-- Programs & requirements
------------------------------
CREATE TABLE programs (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id     uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  catalog_year_id    uuid NOT NULL REFERENCES catalog_years(id) ON DELETE CASCADE,
  kind               program_kind_enum NOT NULL,
  scope              scope_enum NOT NULL,
  owning_faculty_id  uuid REFERENCES faculties(id),                 -- for options
  owning_program_ids jsonb,                                         -- array of program UUIDs (for specializations)
  title              text NOT NULL,
  total_credits_required numeric(5,2),
  root_requirement_id uuid,                                         -- FK added after requirements insert
  policy_ids         jsonb,                                         -- array of policy UUIDs
  metadata           jsonb,
  source_id          uuid REFERENCES sources(id),
  source_url         text,
  source_hash        text,
  fetched_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind <> 'option') OR owning_faculty_id IS NOT NULL
  ),
  CHECK (
    (kind <> 'specialization') OR owning_program_ids IS NOT NULL
  )
);

CREATE INDEX idx_programs_kind ON programs(kind);
CREATE INDEX idx_programs_scope ON programs(scope);
CREATE INDEX idx_programs_catalog_year ON programs(catalog_year_id);

-- Requirements: store the tree as a single JSONB node per requirement id
CREATE TABLE requirements (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id   uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  node         jsonb NOT NULL,                                     -- RequirementNode payload
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Backfill FK from program.root_requirement_id to requirements(id) when ready
ALTER TABLE programs
  ADD CONSTRAINT fk_program_root_requirement
  FOREIGN KEY (root_requirement_id) REFERENCES requirements(id) ON DELETE SET NULL;

CREATE INDEX idx_requirements_program ON requirements(program_id);
CREATE INDEX idx_requirements_node_gin ON requirements USING gin (node);

------------------------------
-- Policies / rules
------------------------------
CREATE TABLE policies (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  scope     policy_scope_enum NOT NULL,
  engine    policy_engine_enum NOT NULL,
  args      jsonb,
  logic     jsonb NOT NULL,
  message   text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_policies_scope ON policies(scope);
CREATE INDEX idx_policies_engine ON policies(engine);

------------------------------
-- Optional: Student plan (minimal to support audits/planning)
------------------------------
CREATE TABLE students (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  user_ref       citext,                      -- external user id/email if you have one
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE student_plans (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id       uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  catalog_year_id  uuid NOT NULL REFERENCES catalog_years(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Which programs a student is pursuing on a given plan
CREATE TABLE student_plan_programs (
  plan_id     uuid NOT NULL REFERENCES student_plans(id) ON DELETE CASCADE,
  program_id  uuid NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
  PRIMARY KEY (plan_id, program_id)
);

-- Courses the student has taken/plans to take (planned term, grade etc.)
CREATE TABLE student_plan_courses (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id     uuid NOT NULL REFERENCES student_plans(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  term        term_code,                        -- e.g., "2A"
  planned     boolean NOT NULL DEFAULT true,
  grade       text,                             -- store letter/percent as received
  source_note text,
  UNIQUE (plan_id, course_id, term, planned)
);

CREATE INDEX idx_spc_plan ON student_plan_courses(plan_id);
CREATE INDEX idx_spc_term ON student_plan_courses(term);

------------------------------
-- Useful constraints & triggers
------------------------------
-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_courses_updated_at
BEFORE UPDATE ON courses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_programs_updated_at
BEFORE UPDATE ON programs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

------------------------------
-- Integrity helpers
------------------------------
-- Ensure course_sets(mode='explicit') have members; selector may be NULL for explicit but then members must exist (cannot enforce cross-table here, rely on app or periodic checks).

-- Ensure JSONB columns are objects/arrays as expected
ALTER TABLE courses
  ADD CONSTRAINT chk_courses_attributes_json CHECK (attributes IS NULL OR jsonb_typeof(attributes) IN ('array','object'));

ALTER TABLE course_sets
  ADD CONSTRAINT chk_course_sets_selector_json CHECK (selector IS NULL OR jsonb_typeof(selector) = 'object');

ALTER TABLE programs
  ADD CONSTRAINT chk_programs_policy_ids_json CHECK (policy_ids IS NULL OR jsonb_typeof(policy_ids) = 'array');

ALTER TABLE programs
  ADD CONSTRAINT chk_programs_owning_program_ids_json CHECK (owning_program_ids IS NULL OR jsonb_typeof(owning_program_ids) = 'array');

ALTER TABLE requirements
  ADD CONSTRAINT chk_requirements_node_json CHECK (jsonb_typeof(node) = 'object');

ALTER TABLE policies
  ADD CONSTRAINT chk_policies_args_json CHECK (args IS NULL OR jsonb_typeof(args) = 'object');

------------------------------
-- Indexing for search & analytics
------------------------------
CREATE INDEX idx_courses_title_gin ON courses USING gin (to_tsvector('english', title));
CREATE INDEX idx_programs_title_gin ON programs USING gin (to_tsvector('english', title));

-- Fast lookup by code within an institution
CREATE UNIQUE INDEX ux_courses_institution_code ON courses (institution_id, code);

------------------------------
-- Comments (self-doc)
------------------------------
COMMENT ON TABLE course_relations IS 'Logical prereq/coreq/exclusion expressions in a tiny expression language (e.g., ALL(course:CS-240, ANY(course:STAT-206, course:CO-250))).';
COMMENT ON TABLE course_enrollment_constraints IS 'Enrollment/admission constraints: program/faculty membership, term standing, consent, etc.';
COMMENT ON DOMAIN term_code IS 'Waterloo-style academic term codes: 1A,1B,2A,2B,3A,3B,4A,4B.';
COMMENT ON FUNCTION term_rank(term_code) IS 'Maps term code to a sortable integer: 1A=10, 1B=11, 2A=20, ... 4B=41.';