/**
 * Translate the raw program data into a flat list of structured `Requirement`
 * rules the audit engine can evaluate.
 *
 * This module deliberately builds ON the existing data (program_plan.json,
 * course_sets.json, program_lists.json) rather than restating requirements.
 * Sources used:
 *   - `required_by_term`            -> one `all-of` rule per term (required courses)
 *   - course_sets ending in `_any`  -> `choose-n` "select one of" rules
 *   - named elective pools          -> `choose-n` where the count is known,
 *                                       otherwise surfaced as `unverified`
 *   - `elective_requirements_by_term` -> an aggregated `unverified` rule
 *                                       (the generic "approved elective" pool
 *                                       is not enumerated, so membership cannot
 *                                       be checked)
 *   - `total_credits_required`      -> a `unit-total` rule when a target exists
 */
import { normalizeCode } from '../utils/prerequisites';
import type { Requirement } from './types';

/** Minimal shape of the program metadata this builder reads. */
export interface ProgramInfoLike {
  total_credits_required?: number | null;
  required_by_term?: Record<string, Array<{ code: string; title?: string | null }>> | null;
  elective_requirements_by_term?: Record<string, { count: number; description?: string }> | null;
}

/** Minimal shape of a course set entry. */
export interface CourseSetLike {
  id_hint: string;
  mode?: string;
  title?: string;
  selector?: unknown;
  courses: string[];
}

/** Minimal shape of the program_lists payload. */
export interface ProgramListsLike {
  course_lists?: Record<
    string,
    { list_name?: string; courses: Array<{ code: string }> } | Array<{ code: string }>
  > | null;
}

/**
 * Required elective counts for the named SE pools. These mirror the counts the
 * existing RequirementBoxes component uses; centralizing them here keeps the
 * audit as the single source of truth. Pools not listed here have an unknown
 * required count and are reported as `unverified`.
 */
export const KNOWN_POOL_COUNTS: Record<string, number> = {
  'Undergraduate Communication Requirement': 1,
  'Natural Science List': 3,
  'Technical Electives List': 4,
  'Additional Requirements': 1,
};

function poolCodes(entry: CourseSetLike['courses'] | Array<{ code: string }>): string[] {
  return entry
    .map(c => (typeof c === 'string' ? c : c?.code))
    .filter((c): c is string => Boolean(c))
    .map(normalizeCode);
}

/** Build the ordered list of requirement rules from the program data. */
export function buildRules(
  programInfo: ProgramInfoLike | null | undefined,
  courseSets: CourseSetLike[] | null | undefined,
  programLists: ProgramListsLike | null | undefined,
): Requirement[] {
  const rules: Requirement[] = [];
  const sets = courseSets ?? [];

  // 1. Required courses, one all-of rule per term (canonical source: program_plan).
  const requiredByTerm = programInfo?.required_by_term ?? {};
  for (const [term, courses] of Object.entries(requiredByTerm)) {
    const codes = (courses ?? []).map(c => normalizeCode(c.code));
    if (codes.length === 0) continue;
    rules.push({
      id: `required-${term}`,
      title: `Required ${term}`,
      kind: 'all-of',
      courses: codes,
    });
  }

  // 2. "Select one of" course sets (id_hint ends in _any). need = 1.
  for (const set of sets) {
    if (!set.id_hint?.endsWith('_any')) continue;
    const codes = poolCodes(set.courses);
    if (codes.length === 0) continue;
    rules.push({
      id: `choose-${set.id_hint}`,
      title: set.title || set.id_hint,
      kind: 'choose-n',
      pool: codes,
      need: 1,
    });
  }

  // 3. Named elective pools, deduped by title across course_sets and program_lists.
  const seenPools = new Set<string>();
  const addPool = (title: string, codes: string[]) => {
    const key = title.trim().toLowerCase();
    if (!title || codes.length === 0 || seenPools.has(key)) return;
    seenPools.add(key);
    const need = KNOWN_POOL_COUNTS[title];
    if (typeof need === 'number') {
      rules.push({ id: `pool-${key}`, title, kind: 'choose-n', pool: codes, need });
    } else {
      rules.push({
        id: `pool-${key}`,
        title,
        kind: 'unverified',
        reason: 'Required number of courses for this list is not specified in the program data.',
        courses: codes,
      });
    }
  };

  // Pools declared as `course_list_*` course sets.
  for (const set of sets) {
    if (!set.id_hint?.startsWith('course_list_')) continue;
    addPool(set.title || set.id_hint, poolCodes(set.courses));
  }
  // Pools declared in program_lists.
  const courseLists = programLists?.course_lists ?? {};
  for (const [title, list] of Object.entries(courseLists)) {
    const entry = Array.isArray(list) ? list : list?.courses ?? [];
    const name = (!Array.isArray(list) && list?.list_name) || title;
    addPool(name, poolCodes(entry));
  }

  // 4. Term electives: the "approved elective" pool is not enumerated, so we
  //    cannot verify which selected courses satisfy it. Surface the total as
  //    a single unverified requirement instead of silently passing it.
  const electivesByTerm = programInfo?.elective_requirements_by_term ?? {};
  const electiveEntries = Object.entries(electivesByTerm);
  if (electiveEntries.length > 0) {
    const totalElectives = electiveEntries.reduce((sum, [, v]) => sum + (v?.count ?? 0), 0);
    const perTerm = electiveEntries.map(([term, v]) => `${term}: ${v?.count ?? 0}`).join(', ');
    rules.push({
      id: 'approved-electives',
      title: 'Approved Electives',
      kind: 'unverified',
      reason:
        `${totalElectives} approved elective(s) required across terms (${perTerm}). ` +
        'The approved-elective list is not enumerated in the data, so it cannot be automatically verified.',
    });
  }

  // 5. Total units, when a target is provided (null in the current SE data ->
  //    engine reports it unverified).
  const totalUnits = programInfo?.total_credits_required;
  if (typeof totalUnits === 'number' && totalUnits > 0) {
    rules.push({
      id: 'total-units',
      title: 'Total Units',
      kind: 'unit-total',
      need: totalUnits,
    });
  }

  return rules;
}
