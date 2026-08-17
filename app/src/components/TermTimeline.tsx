import React from 'react';
import { CourseNode, ProgramInfo, CourseSet, ProgramLists, CourseEdge } from '../context/AppDataContext';
import { meetsPrerequisites, normalizeCode } from '../utils/prerequisites';
import { Button, CourseCode, cn } from './ui';

interface TermTimelineProps {
  courses: CourseNode[];
  programInfo: ProgramInfo | null;
  courseSets: CourseSet[];
  selectedCourses: Set<string>;
  onViewCourseDetail: (courseCode: string) => void;
  onCourseSelect?: (courseCode: string, term?: string) => void;
  onCourseDeselect?: (courseCode: string, term?: string) => void;
  electiveAssignments: Record<string, string | undefined>;
  programLists: ProgramLists | null;
  edges?: CourseEdge[];
}

interface CourseRowProps {
  code: string;
  title: string;
  credits: number;
  isSelected: boolean;
  canTake?: boolean;
  onView: () => void;
  onToggle?: () => void;
  toggleDisabled?: boolean;
  toggleTitle?: string;
}

const CourseRow: React.FC<CourseRowProps> = ({
  code,
  title,
  credits,
  isSelected,
  canTake = true,
  onView,
  onToggle,
  toggleDisabled,
  toggleTitle,
}) => (
  <li
    role="button"
    tabIndex={0}
    onClick={(e) => {
      e.preventDefault();
      onView();
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        onView();
      }
    }}
    className={cn(
      'group flex cursor-pointer items-center gap-3 rounded-none border-l-2 py-2 pl-2.5 pr-1 transition-colors',
      isSelected
        ? 'border-text bg-surface-2'
        : canTake
          ? 'border-transparent hover:border-border-strong hover:bg-surface-2'
          : 'border-transparent opacity-55 hover:bg-surface-2'
    )}
  >
    <CourseCode active={isSelected}>{code}</CourseCode>
    <span className="min-w-0 flex-1 truncate text-sm text-muted">{title}</span>
    {canTake && !isSelected && (
      <span className="eyebrow hidden shrink-0 text-accent sm:inline">Ready</span>
    )}
    <span className="shrink-0 font-mono text-xs tabular-nums text-faint">
      {credits.toFixed(2)}
    </span>
    {isSelected && (
      <span className="shrink-0 text-text" aria-label="selected">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )}
    {onToggle && (
      <Button
        size="sm"
        variant={isSelected ? 'secondary' : 'primary'}
        disabled={toggleDisabled}
        title={toggleTitle}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        className="shrink-0"
      >
        {isSelected ? 'Remove' : 'Add'}
      </Button>
    )}
  </li>
);

const SectionTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <h4
    className={cn(
      'mb-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-faint',
      className
    )}
  >
    {children}
  </h4>
);

const TermTimeline: React.FC<TermTimelineProps> = ({
  courses,
  programInfo,
  courseSets,
  selectedCourses,
  onViewCourseDetail,
  onCourseSelect,
  onCourseDeselect,
  electiveAssignments,
  programLists,
  edges = []
}) => {
  const courseMap = new Map<string, CourseNode>();
  courses.forEach(course => courseMap.set(course.code, course));

  // Build credits and title fallback maps from programLists
  const creditsFallback = new Map<string, number>();
  const titleFallback = new Map<string, string>();
  if (programLists) {
    Object.values(programLists.course_lists || {}).forEach(list => {
      (list.courses || []).forEach((c: { code: string; units?: string; title?: string | null }) => {
        const normalizedCode = normalizeCode(c.code);
        if (c.units) {
          const units = parseFloat(c.units);
          if (!isNaN(units) && units > 0) {
            creditsFallback.set(normalizedCode, units);
          }
        }
        if (c.title) {
          titleFallback.set(normalizedCode, c.title);
        }
      });
    });
  }

  // Helper to get credits with fallback
  const getCourseCredits = (code: string): number => {
    const course = courseMap.get(code);
    if (course && course.credits > 0) {
      return course.credits;
    }
    return creditsFallback.get(code) || 0;
  };

  // Helper to get title with fallback
  const getCourseTitle = (code: string): string => {
    const course = courseMap.get(code);
    if (course?.title) {
      return course.title;
    }
    return titleFallback.get(code) || '';
  };

  const courseSetMap = new Map<string, CourseSet>();
  courseSets.forEach(cs => {
    if (cs.id_hint) {
      courseSetMap.set(cs.id_hint, cs);
    }
  });

  // Extract term order (1A, 1B, 2A, 2B, 3A, 3B, 4A, 4B)
  const termOrder = ['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'];

  // Get required_by_term from programInfo
  const requiredByTerm = programInfo?.required_by_term || {};

  // Get ANY requirements (select one) from course sets
  const anyRequirements = courseSets.filter(cs =>
    cs.id_hint && cs.id_hint.includes('_any')
  );
  const anyReqMap = new Map<string, CourseSet>();
  anyRequirements.forEach(ar => {
    const termMatch = ar.id_hint.match(/req_term_(\d+[ab])_any/i);
    if (termMatch) {
      const term = termMatch[1].toUpperCase();
      anyReqMap.set(term, ar);
    }
  });

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Term Timeline</h2>
        <span className="text-xs text-muted">Scroll to browse terms →</span>
      </div>
      <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3">
        {termOrder.map((term) => {
          const termCourses = requiredByTerm[term] || [];
          const anyReq = anyReqMap.get(term);

          // Filter out courses from termCourses that are in the ANY requirement (they should only appear in "Select One")
          const anyReqCourseCodes = new Set(anyReq?.courses.map((code: string) => normalizeCode(code)) || []);
          const filteredTermCourses = termCourses.filter((course: { code: string }) =>
            !anyReqCourseCodes.has(normalizeCode(course.code))
          );

          const electiveCodesForTerm = Object.entries(electiveAssignments)
            .filter(([_, assignedTerm]) => assignedTerm === term)
            .map(([code]) => code);
          const electiveRequirement = programInfo?.elective_requirements_by_term?.[term];

          // Calculate selected credits for this term
          const selectedCredits = (() => {
            let total: number = 0.0;

            // Count credits from selected required courses (excluding ANY courses)
            filteredTermCourses.forEach(course => {
              if (selectedCourses.has(course.code)) {
                total += getCourseCredits(course.code);
              }
            });

            // Count credits from selected ANY courses (only count one if multiple are selected)
            if (anyReq) {
              const selectedAnyCourses = anyReq.courses.filter((code: string) => selectedCourses.has(code));
              if (selectedAnyCourses.length > 0) {
                // Only count the first selected ANY course (since it's "select one")
                total += getCourseCredits(selectedAnyCourses[0]);
              }
            }

            // Count credits from electives explicitly assigned to this term
            electiveCodesForTerm.forEach(code => {
              if (selectedCourses.has(code)) {
                total += getCourseCredits(code);
              }
            });

            return total;
          })();

          return (
            <div
              key={term}
              className="flex w-[320px] shrink-0 snap-start flex-col border border-border bg-surface transition-colors hover:border-border-strong"
            >
              <div className="flex items-end justify-between border-b border-border-strong px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-3xl font-semibold leading-none tracking-tight">
                    {term}
                  </span>
                  <span className="eyebrow">Term</span>
                </div>
                <span className="font-mono text-xs tabular-nums text-muted">
                  {selectedCredits.toFixed(2)}<span className="text-faint"> cr</span>
                </span>
              </div>

              <div className="flex flex-col gap-4 p-4">
                {/* Required courses */}
                {filteredTermCourses.length > 0 && (
                  <div>
                    <SectionTitle>Required</SectionTitle>
                    <ul className="flex flex-col gap-1">
                      {filteredTermCourses.map((course: { code: string; title: string }) => {
                        const credits = getCourseCredits(course.code);
                        const title = getCourseTitle(course.code) || course.title;
                        const isSelected = selectedCourses.has(course.code);
                        const canTake = meetsPrerequisites(course.code, edges, selectedCourses);
                        return (
                          <CourseRow
                            key={course.code}
                            code={course.code}
                            title={title}
                            credits={credits}
                            isSelected={isSelected}
                            canTake={canTake}
                            onView={() => onViewCourseDetail(course.code)}
                            onToggle={
                              onCourseSelect && onCourseDeselect
                                ? () => {
                                    if (isSelected) {
                                      onCourseDeselect(course.code, term);
                                    } else if (canTake) {
                                      onCourseSelect(course.code, term);
                                    }
                                  }
                                : undefined
                            }
                            toggleDisabled={!isSelected && !canTake}
                            toggleTitle={!isSelected && !canTake ? 'Prerequisites not met' : ''}
                          />
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Select one courses (ANY requirements) */}
                {anyReq && (
                  <div className="border-t border-dashed border-border pt-3">
                    <SectionTitle>Select One</SectionTitle>
                    <ul className="flex flex-col gap-1">
                      {anyReq.courses.map((courseCode: string) => {
                        const credits = getCourseCredits(courseCode);
                        const title = getCourseTitle(courseCode);
                        const isSelected = selectedCourses.has(courseCode);
                        const canTake = meetsPrerequisites(courseCode, edges, selectedCourses);
                        return (
                          <CourseRow
                            key={courseCode}
                            code={courseCode}
                            title={title}
                            credits={credits}
                            isSelected={isSelected}
                            canTake={canTake}
                            onView={() => onViewCourseDetail(courseCode)}
                            onToggle={
                              onCourseSelect && onCourseDeselect
                                ? () => {
                                    if (isSelected) {
                                      onCourseDeselect(courseCode, term);
                                    } else if (canTake) {
                                      onCourseSelect(courseCode, term);
                                    }
                                  }
                                : undefined
                            }
                            toggleDisabled={!isSelected && !canTake}
                            toggleTitle={!isSelected && !canTake ? 'Prerequisites not met' : ''}
                          />
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Elective requirements */}
                {electiveRequirement && (
                  <div className="border-t border-dashed border-border pt-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <SectionTitle className="mb-0">
                        {electiveRequirement.description || 'Approved'} Electives ({electiveCodesForTerm.length}/{electiveRequirement.count})
                      </SectionTitle>
                      {electiveCodesForTerm.length < electiveRequirement.count && onCourseSelect && (
                        <Button
                          size="sm"
                          variant="success"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const input = window.prompt(
                              `Enter course code for ${electiveRequirement.description || 'approved'} elective:`,
                              ''
                            );
                            if (input && input.trim()) {
                              const courseCode = input.trim().toUpperCase();
                              onCourseSelect(courseCode, term);
                            }
                          }}
                        >
                          + Add
                        </Button>
                      )}
                    </div>
                    {electiveCodesForTerm.length < electiveRequirement.count && (
                      <p className="mb-1.5 text-xs italic text-muted">
                        Complete {electiveRequirement.count - electiveCodesForTerm.length} more {electiveRequirement.description || 'approved'} elective{electiveRequirement.count - electiveCodesForTerm.length > 1 ? 's' : ''}
                      </p>
                    )}
                    {electiveCodesForTerm.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {electiveCodesForTerm.map(code => {
                          const isSelected = selectedCourses.has(code);
                          const credits = getCourseCredits(code);
                          const title = getCourseTitle(code);
                          return (
                            <CourseRow
                              key={code}
                              code={code}
                              title={title}
                              credits={credits}
                              isSelected={isSelected}
                              onView={() => onViewCourseDetail(code)}
                              onToggle={
                                onCourseSelect && onCourseDeselect
                                  ? () => {
                                      if (isSelected) {
                                        onCourseDeselect(code, term);
                                      } else {
                                        onCourseSelect(code, term);
                                      }
                                    }
                                  : undefined
                              }
                            />
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                {/* Legacy: Electives explicitly assigned to this term (if no requirement defined) */}
                {!electiveRequirement && electiveCodesForTerm.length > 0 && (
                  <div className="border-t border-dashed border-border pt-3">
                    <SectionTitle>Electives</SectionTitle>
                    <ul className="flex flex-col gap-1">
                      {electiveCodesForTerm.map(code => {
                        const isSelected = selectedCourses.has(code);
                        const credits = getCourseCredits(code);
                        const title = getCourseTitle(code);
                        const canTake = meetsPrerequisites(code, edges, selectedCourses);
                        return (
                          <CourseRow
                            key={code}
                            code={code}
                            title={title}
                            credits={credits}
                            isSelected={isSelected}
                            canTake={canTake}
                            onView={() => onViewCourseDetail(code)}
                            onToggle={
                              onCourseSelect && onCourseDeselect
                                ? () => {
                                    if (isSelected) {
                                      onCourseDeselect(code, term);
                                    } else if (canTake) {
                                      onCourseSelect(code, term);
                                    }
                                  }
                                : undefined
                            }
                            toggleDisabled={!isSelected && !canTake}
                            toggleTitle={!isSelected && !canTake ? 'Prerequisites not met' : ''}
                          />
                        );
                      })}
                    </ul>
                  </div>
                )}

                {filteredTermCourses.length === 0 && !anyReq && !electiveRequirement && electiveCodesForTerm.length === 0 && (
                  <p className="py-6 text-center text-sm italic text-faint">
                    No requirements for this term.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TermTimeline;
