/**
 * Types for the requirement audit engine.
 *
 * The engine is intentionally decoupled from the raw data shapes: `buildRules`
 * (see ./buildRules.ts) translates the program data (program_plan.json,
 * course_sets.json, program_lists.json) into a flat list of `Requirement`
 * rules, and `auditPlan` (see ./engine.ts) evaluates those rules against a
 * student's selected courses. Keeping the two steps separate means the pure
 * evaluation logic can be unit-tested without any real data files.
 */

/** Outcome of evaluating a single requirement against a plan. */
export type RequirementStatus = 'met' | 'partial' | 'unmet' | 'unverified';

/** Rule kinds the engine knows how to evaluate. */
export type RequirementKind = 'all-of' | 'choose-n' | 'unit-total' | 'unverified';

interface BaseRequirement {
  /** Stable, unique id used as a React key and for de-duplication. */
  id: string;
  /** Human-readable label, e.g. "Required 2A" or "Natural Science List". */
  title: string;
  kind: RequirementKind;
}

/** Every listed course must be completed (e.g. the required courses in a term). */
export interface AllOfRequirement extends BaseRequirement {
  kind: 'all-of';
  courses: string[];
}

/** At least `need` courses must be completed from `pool` (electives, "select one of"). */
export interface ChooseNRequirement extends BaseRequirement {
  kind: 'choose-n';
  pool: string[];
  need: number;
}

/**
 * At least `need` units must be completed. If `pool` is provided only those
 * courses count toward the total; otherwise every selected course counts.
 * Requires a `credits` lookup in the audit context — without one the engine
 * reports the requirement as `unverified` rather than guessing.
 */
export interface UnitTotalRequirement extends BaseRequirement {
  kind: 'unit-total';
  need: number;
  pool?: string[];
}

/**
 * A requirement the engine could not structure into one of the checkable kinds.
 * Surfaced explicitly so it is never silently treated as satisfied.
 */
export interface UnverifiedRequirement extends BaseRequirement {
  kind: 'unverified';
  reason: string;
  /** Optional associated courses, purely informational. */
  courses?: string[];
}

export type Requirement =
  | AllOfRequirement
  | ChooseNRequirement
  | UnitTotalRequirement
  | UnverifiedRequirement;

/** Result of evaluating one requirement. `have`/`need` are counts, or units for unit-total. */
export interface RequirementResult {
  id: string;
  title: string;
  kind: RequirementKind;
  status: RequirementStatus;
  have: number;
  need: number;
  /** Courses from this requirement the student has completed. */
  satisfiedCourses: string[];
  /** For `all-of`: the still-missing courses. Empty for pool-style rules. */
  missingCourses: string[];
  /** Extra context, e.g. why a requirement is unverified. */
  note?: string;
}

export interface AuditSummary {
  met: number;
  partial: number;
  unmet: number;
  unverified: number;
  total: number;
}

export interface AuditReport {
  results: RequirementResult[];
  summary: AuditSummary;
}

/** Inputs the engine needs beyond the rules themselves. */
export interface AuditContext {
  /** Completed / selected course codes. Normalized internally, so any casing/spacing is fine. */
  selected: Set<string>;
  /** Optional units lookup, required only for `unit-total` rules. */
  credits?: (code: string) => number;
}
