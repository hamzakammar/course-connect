/**
 * Public entry point for the requirement audit engine.
 *
 * Typical usage from the UI layer:
 *   const report = buildAuditReport(programInfo, courseSets, programLists, selected, credits);
 */
export * from './types';
export { auditPlan } from './engine';
export {
  buildRules,
  KNOWN_POOL_COUNTS,
  type ProgramInfoLike,
  type CourseSetLike,
  type ProgramListsLike,
} from './buildRules';

import { auditPlan } from './engine';
import { buildRules, type CourseSetLike, type ProgramInfoLike, type ProgramListsLike } from './buildRules';
import type { AuditReport } from './types';

/** Convenience: build rules from raw program data and audit them in one call. */
export function buildAuditReport(
  programInfo: ProgramInfoLike | null | undefined,
  courseSets: CourseSetLike[] | null | undefined,
  programLists: ProgramListsLike | null | undefined,
  selected: Set<string>,
  credits?: (code: string) => number,
): AuditReport {
  const rules = buildRules(programInfo, courseSets, programLists);
  return auditPlan(rules, { selected, credits });
}
