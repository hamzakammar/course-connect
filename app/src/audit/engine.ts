/**
 * Pure requirement-audit engine.
 *
 * `auditPlan` takes a list of structured `Requirement` rules plus a student's
 * plan and returns a per-requirement status (met / partial / unmet /
 * unverified) with counts. It has no dependency on React or the data-loading
 * layer, so it can be exercised directly in unit tests.
 */
import { normalizeCode } from '../utils/prerequisites';
import type {
  AuditContext,
  AuditReport,
  AuditSummary,
  Requirement,
  RequirementResult,
  RequirementStatus,
} from './types';

/** Normalize a set of course codes for order-independent membership checks. */
function normalizeSelected(selected: Set<string>): Set<string> {
  const out = new Set<string>();
  selected.forEach(code => out.add(normalizeCode(code)));
  return out;
}

/** Derive met/partial/unmet from how much of a countable requirement is satisfied. */
function statusFromCounts(have: number, need: number): RequirementStatus {
  if (need <= 0) return 'met'; // nothing required -> vacuously satisfied
  if (have >= need) return 'met';
  if (have <= 0) return 'unmet';
  return 'partial';
}

function auditRequirement(req: Requirement, selected: Set<string>, credits?: (code: string) => number): RequirementResult {
  const base = { id: req.id, title: req.title, kind: req.kind };

  switch (req.kind) {
    case 'all-of': {
      const courses = req.courses.map(normalizeCode);
      const satisfied = courses.filter(code => selected.has(code));
      const missing = courses.filter(code => !selected.has(code));
      return {
        ...base,
        status: statusFromCounts(satisfied.length, courses.length),
        have: satisfied.length,
        need: courses.length,
        satisfiedCourses: satisfied,
        missingCourses: missing,
      };
    }

    case 'choose-n': {
      const pool = req.pool.map(normalizeCode);
      const satisfied = pool.filter(code => selected.has(code));
      return {
        ...base,
        status: statusFromCounts(satisfied.length, req.need),
        have: satisfied.length,
        need: req.need,
        satisfiedCourses: satisfied,
        missingCourses: [],
      };
    }

    case 'unit-total': {
      // Cannot be verified without a units lookup or a sensible target.
      if (!credits || !(req.need > 0)) {
        return {
          ...base,
          status: 'unverified',
          have: 0,
          need: req.need,
          satisfiedCourses: [],
          missingCourses: [],
          note: !credits
            ? 'No unit information available to verify this total.'
            : 'No unit total specified for this program.',
        };
      }
      const pool = req.pool?.map(normalizeCode);
      const counted = Array.from(selected).filter(code => (pool ? pool.includes(code) : true));
      const have = counted.reduce((sum, code) => sum + (credits(code) || 0), 0);
      // Round to avoid floating-point noise from 0.25/0.50-unit courses.
      const roundedHave = Math.round(have * 100) / 100;
      return {
        ...base,
        status: statusFromCounts(roundedHave, req.need),
        have: roundedHave,
        need: req.need,
        satisfiedCourses: counted,
        missingCourses: [],
      };
    }

    case 'unverified':
    default: {
      const courses = req.kind === 'unverified' ? (req.courses ?? []).map(normalizeCode) : [];
      return {
        ...base,
        kind: 'unverified',
        status: 'unverified',
        have: 0,
        need: 0,
        satisfiedCourses: courses.filter(code => selected.has(code)),
        missingCourses: [],
        note: req.kind === 'unverified' ? req.reason : 'Unrecognized requirement kind.',
      };
    }
  }
}

/** Evaluate every requirement against the plan and roll up a summary. */
export function auditPlan(requirements: Requirement[], context: AuditContext): AuditReport {
  const selected = normalizeSelected(context.selected);
  const results = requirements.map(req => auditRequirement(req, selected, context.credits));

  const summary: AuditSummary = {
    met: 0,
    partial: 0,
    unmet: 0,
    unverified: 0,
    total: results.length,
  };
  for (const r of results) {
    summary[r.status] += 1;
  }

  return { results, summary };
}
