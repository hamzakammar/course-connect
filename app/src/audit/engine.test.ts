import { describe, it, expect } from 'vitest';
import { auditPlan } from './engine';
import { buildRules } from './buildRules';
import { buildAuditReport } from './index';
import type { Requirement } from './types';

const set = (...codes: string[]) => new Set(codes);

describe('auditPlan — all-of requirements', () => {
  const req: Requirement = { id: 'r', title: 'Required 1A', kind: 'all-of', courses: ['CS137', 'MATH115', 'SE101'] };

  it('reports met when every course is completed', () => {
    const { results } = auditPlan([req], { selected: set('CS137', 'MATH115', 'SE101') });
    expect(results[0].status).toBe('met');
    expect(results[0].have).toBe(3);
    expect(results[0].need).toBe(3);
    expect(results[0].missingCourses).toEqual([]);
  });

  it('reports partial when some but not all are completed', () => {
    const { results } = auditPlan([req], { selected: set('CS137') });
    expect(results[0].status).toBe('partial');
    expect(results[0].have).toBe(1);
    expect(results[0].missingCourses).toEqual(['MATH115', 'SE101']);
  });

  it('reports unmet when none are completed', () => {
    const { results } = auditPlan([req], { selected: set('BIOL110') });
    expect(results[0].status).toBe('unmet');
    expect(results[0].have).toBe(0);
    expect(results[0].satisfiedCourses).toEqual([]);
  });

  it('normalizes casing and whitespace on both sides', () => {
    const { results } = auditPlan([req], { selected: set('cs 137', 'math115', 'Se101') });
    expect(results[0].status).toBe('met');
  });
});

describe('auditPlan — choose-n requirements', () => {
  const req: Requirement = { id: 'p', title: 'Natural Science List', kind: 'choose-n', pool: ['BIOL110', 'CHEM123', 'PHYS122', 'EARTH121'], need: 3 };

  it('reports met when at least `need` are completed', () => {
    const { results } = auditPlan([req], { selected: set('BIOL110', 'CHEM123', 'PHYS122', 'EARTH121') });
    expect(results[0].status).toBe('met');
    expect(results[0].have).toBe(4);
    expect(results[0].need).toBe(3);
  });

  it('reports met exactly at the threshold', () => {
    const { results } = auditPlan([req], { selected: set('BIOL110', 'CHEM123', 'PHYS122') });
    expect(results[0].status).toBe('met');
  });

  it('reports partial below the threshold but above zero', () => {
    const { results } = auditPlan([req], { selected: set('BIOL110', 'CHEM123') });
    expect(results[0].status).toBe('partial');
    expect(results[0].have).toBe(2);
  });

  it('reports unmet when none from the pool are completed', () => {
    const { results } = auditPlan([req], { selected: set('CS137') });
    expect(results[0].status).toBe('unmet');
  });

  it('does not count courses outside the pool', () => {
    const { results } = auditPlan([req], { selected: set('BIOL110', 'CS137', 'CS138') });
    expect(results[0].have).toBe(1);
    expect(results[0].status).toBe('partial');
  });

  it('handles a select-one-of set (need = 1)', () => {
    const chooseOne: Requirement = { id: 'a', title: 'Select one from 2A', kind: 'choose-n', pool: ['ECE105', 'PHYS115', 'PHYS121'], need: 1 };
    expect(auditPlan([chooseOne], { selected: set('PHYS121') }).results[0].status).toBe('met');
    expect(auditPlan([chooseOne], { selected: set('CS137') }).results[0].status).toBe('unmet');
  });
});

describe('auditPlan — unit-total requirements', () => {
  const credits = (code: string): number => ({ CS137: 0.5, MATH115: 0.5, SE101: 0.5 } as Record<string, number>)[code] ?? 0;
  const req: Requirement = { id: 'u', title: 'Total Units', kind: 'unit-total', need: 1.0 };

  it('reports met when accumulated units reach the target', () => {
    const { results } = auditPlan([req], { selected: set('CS137', 'MATH115'), credits });
    expect(results[0].status).toBe('met');
    expect(results[0].have).toBe(1.0);
  });

  it('reports partial when below target', () => {
    const { results } = auditPlan([req], { selected: set('CS137'), credits });
    expect(results[0].status).toBe('partial');
    expect(results[0].have).toBe(0.5);
  });

  it('reports unmet when no units are earned', () => {
    const { results } = auditPlan([req], { selected: set('UNKNOWN'), credits });
    expect(results[0].status).toBe('unmet');
  });

  it('reports unverified when no credits lookup is supplied', () => {
    const { results } = auditPlan([req], { selected: set('CS137', 'MATH115') });
    expect(results[0].status).toBe('unverified');
    expect(results[0].note).toBeTruthy();
  });

  it('only counts pool courses when a pool is given', () => {
    const pooled: Requirement = { id: 'u2', title: 'Math units', kind: 'unit-total', need: 0.5, pool: ['MATH115'] };
    const { results } = auditPlan([pooled], { selected: set('CS137', 'MATH115'), credits });
    expect(results[0].have).toBe(0.5);
    expect(results[0].status).toBe('met');
  });
});

describe('auditPlan — unverified requirements', () => {
  it('always reports unverified and never counts as satisfied', () => {
    const req: Requirement = { id: 'x', title: 'Approved Electives', kind: 'unverified', reason: 'not enumerated' };
    const { results, summary } = auditPlan([req], { selected: set('CS137') });
    expect(results[0].status).toBe('unverified');
    expect(results[0].note).toBe('not enumerated');
    expect(summary.unverified).toBe(1);
    expect(summary.met).toBe(0);
  });
});

describe('auditPlan — summary roll-up', () => {
  it('counts each status bucket and the total', () => {
    const reqs: Requirement[] = [
      { id: '1', title: 'met', kind: 'all-of', courses: ['A'] },
      { id: '2', title: 'partial', kind: 'all-of', courses: ['B', 'C'] },
      { id: '3', title: 'unmet', kind: 'all-of', courses: ['D'] },
      { id: '4', title: 'unverified', kind: 'unverified', reason: 'r' },
    ];
    const { summary } = auditPlan(reqs, { selected: set('A', 'B') });
    expect(summary).toEqual({ met: 1, partial: 1, unmet: 1, unverified: 1, total: 4 });
  });
});

describe('buildRules — derives structured rules from program data', () => {
  const programInfo = {
    total_credits_required: null,
    required_by_term: {
      '1A': [{ code: 'CS137' }, { code: 'MATH115' }],
      '2A': [{ code: 'CS241' }],
    },
    elective_requirements_by_term: {
      '4A': { count: 4, description: 'approved elective' },
      '4B': { count: 4, description: 'approved elective' },
    },
  };
  const courseSets = [
    { id_hint: 'req_term_1a_all', title: 'Required 1A', courses: ['CS137', 'MATH115'] },
    { id_hint: 'req_term_2a_any', title: 'Select one from 2A', courses: ['ECE105', 'PHYS115', 'PHYS121'] },
    { id_hint: 'course_list_technicalelectiveslist', title: 'Technical Electives List', courses: ['CS486', 'CS488'] },
    { id_hint: 'course_list_unknownpool', title: 'Mystery Pool', courses: ['ABC100', 'ABC200'] },
  ];
  const programLists = {
    course_lists: {
      'Natural Science List': { list_name: 'Natural Science List', courses: [{ code: 'BIOL110' }, { code: 'CHEM123' }] },
      'List 1': { list_name: 'List 1', courses: [{ code: 'ANTH100' }] },
    },
  };

  const rules = buildRules(programInfo, courseSets, programLists);
  const byId = (id: string) => rules.find(r => r.id === id);

  it('creates an all-of rule per required term', () => {
    const r = byId('required-1A');
    expect(r?.kind).toBe('all-of');
    expect(r && 'courses' in r && r.courses).toEqual(['CS137', 'MATH115']);
  });

  it('creates a choose-n (need 1) rule for _any sets', () => {
    const r = byId('choose-req_term_2a_any');
    expect(r?.kind).toBe('choose-n');
    expect(r && 'need' in r && r.need).toBe(1);
  });

  it('creates a choose-n rule for a known-count pool', () => {
    const r = rules.find(r => r.title === 'Technical Electives List');
    expect(r?.kind).toBe('choose-n');
    expect(r && 'need' in r && r.need).toBe(4);
  });

  it('marks unknown-count pools as unverified', () => {
    const mystery = rules.find(r => r.title === 'Mystery Pool');
    const list1 = rules.find(r => r.title === 'List 1');
    expect(mystery?.kind).toBe('unverified');
    expect(list1?.kind).toBe('unverified');
  });

  it('does not duplicate a pool that appears in both sources', () => {
    const naturalScience = rules.filter(r => r.title === 'Natural Science List');
    expect(naturalScience).toHaveLength(1);
  });

  it('aggregates approved electives into a single unverified rule', () => {
    const r = byId('approved-electives');
    expect(r?.kind).toBe('unverified');
    expect(r?.kind === 'unverified' && r.reason).toContain('8 approved elective');
  });

  it('omits a total-units rule when no target is provided', () => {
    expect(byId('total-units')).toBeUndefined();
  });

  it('emits a unit-total rule when a target exists', () => {
    const withTotal = buildRules({ ...programInfo, total_credits_required: 20 }, courseSets, programLists);
    expect(withTotal.find(r => r.id === 'total-units')?.kind).toBe('unit-total');
  });
});

describe('buildAuditReport — end-to-end from raw data to statuses', () => {
  it('audits a realistic partial plan', () => {
    const report = buildAuditReport(
      { required_by_term: { '1A': [{ code: 'CS137' }, { code: 'SE101' }] }, elective_requirements_by_term: {}, total_credits_required: null },
      [{ id_hint: 'req_term_2a_any', title: 'Select one from 2A', courses: ['ECE105', 'PHYS121'] }],
      { course_lists: {} },
      set('CS137'),
    );
    const required = report.results.find(r => r.id === 'required-1A');
    const chooseOne = report.results.find(r => r.id === 'choose-req_term_2a_any');
    expect(required?.status).toBe('partial');
    expect(chooseOne?.status).toBe('unmet');
    expect(report.summary.total).toBe(2);
  });
});
