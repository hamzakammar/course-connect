import React, { useState, useEffect } from 'react';
import { CourseNode, ProgramLists, CourseEdge } from '../context/AppDataContext';
import { meetsPrerequisites, normalizeCode } from '../utils/prerequisites';
import { Input, Button, CourseCode, Badge, cn } from './ui';

interface RequirementBoxesProps {
  courses: CourseNode[];
  selectedCourses: Set<string>;
  onViewCourseDetail: (courseCode: string) => void;
  programLists: ProgramLists;
  onCourseSelect?: (courseCode: string, term?: string) => void;
  onCourseDeselect?: (courseCode: string, term?: string) => void;
  edges?: CourseEdge[]; // Add edges for prerequisite checking
}

const RequirementBoxes: React.FC<RequirementBoxesProps> = ({
  courses,
  selectedCourses,
  onViewCourseDetail,
  programLists,
  onCourseSelect,
  onCourseDeselect,
  edges = [],
}) => {
  const courseMap = new Map<string, CourseNode>();
  courses.forEach(course => courseMap.set(course.code, course));

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');

  const toggleCollapsed = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Define requirement counts for each list (based on typical SE requirements)
  const requirementCounts: Record<string, number> = {
    'Undergraduate Communication Requirement': 1,
    'Natural Science List': 3,
    'Technical Electives List': 4, // Typically 4 technical electives
    'Additional Requirements': 1, // Usually 1 additional requirement
  };

  // Build credits and title fallback maps from programLists
  // Handle both formats: Record<string, Array<{code, title}>> and Record<string, {list_name, courses}>
  const creditsFallback = new Map<string, number>();
  const titleFallback = new Map<string, string>();
  Object.values(programLists?.course_lists || {}).forEach(list => {
    // Check if list is an array (direct format) or an object with courses property
    const courses = Array.isArray(list)
      ? list
      : (list as any)?.courses || [];

    courses.forEach((c: { code: string; units?: string; title?: string | null }) => {
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

  // Helper to check if prerequisites are met for a course
  const checkMeetsPrerequisites = (courseCode: string): boolean => {
    return meetsPrerequisites(courseCode, edges, selectedCourses);
  };

  // Sort courses by eligibility (can take first, then selected)
  const sortCoursesByEligibility = (codes: string[]): string[] => {
    return [...codes].sort((a, b) => {
      const aCanTake = checkMeetsPrerequisites(a);
      const bCanTake = checkMeetsPrerequisites(b);

      // Eligible courses first
      if (aCanTake && !bCanTake) return -1;
      if (!aCanTake && bCanTake) return 1;

      // Then by selected status (selected first)
      const aSelected = selectedCourses.has(a);
      const bSelected = selectedCourses.has(b);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;

      // Finally, sort alphabetically for consistency
      return a.localeCompare(b);
    });
  };

  // Handle both formats: Record<string, Array<{code, title}>> and Record<string, {list_name, courses}>
  const allRequirements = Object.entries(programLists?.course_lists || {}).map(([listName, list]) => {
    // Check if list is an array (direct format) or an object with courses property
    const courses = Array.isArray(list)
      ? list
      : (list as any)?.courses || [];

    const codes = courses.map((c: { code: string }) => normalizeCode(c.code));

    // Sort courses by eligibility
    const sortedCodes = sortCoursesByEligibility(codes);

    // Count how many courses from this list are selected
    const selectedCount = codes.filter((code: string) => selectedCourses.has(code)).length;

    // Get required count (default to 1 if not specified)
    const requiredCount = requirementCounts[listName] || 1;

    // Check if requirement is fulfilled
    const isFulfilled = selectedCount >= requiredCount;

    // Note: Auto-collapse handled separately below

    return {
      id: listName,
      title: listName,
      codes: sortedCodes, // Use sorted codes
      selectedCount,
      requiredCount,
      isFulfilled,
    };
  });

  // Auto-collapse fulfilled requirements
  useEffect(() => {
    allRequirements.forEach(req => {
      if (req.isFulfilled && collapsed[req.id] !== true) {
        setCollapsed(prev => ({ ...prev, [req.id]: true }));
      }
    });
  }, [programLists, selectedCourses, edges]);

  if (allRequirements.length === 0) {
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold tracking-tight">Additional Requirements</h2>
        <p className="text-sm text-muted">No additional requirements found.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Requirements</h2>
      <div className="mb-4">
        <Input
          type="text"
          placeholder="Search courses…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          leadingIcon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      <div className="flex flex-col gap-4">
        {allRequirements.map(req => {
          // Filter codes by search term (searches both code and title, handles spaces)
          const filteredCodes = req.codes.filter((code: string) => {
            if (!searchTerm.trim()) return true;
            const title = getCourseTitle(code);
            const searchLower = searchTerm.toLowerCase().trim();
            // Normalize both search term and course code for better matching (remove spaces)
            const normalizedSearch = searchLower.replace(/\s+/g, '');
            const normalizedCode = normalizeCode(code);
            const normalizedTitle = title.toLowerCase();

            // Search in: normalized code, original code, and title
            return normalizedCode.includes(normalizedSearch) ||
                   code.toLowerCase().includes(searchLower) ||
                   normalizedTitle.includes(searchLower);
          });

          const isCollapsed = collapsed[req.id];

          return (
            <div
              key={req.id}
              className={cn(
                'relative overflow-hidden border bg-surface transition-colors',
                req.isFulfilled ? 'border-border-strong' : 'border-border'
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-y-0 left-0 w-[3px]',
                  req.isFulfilled ? 'bg-accent' : 'bg-transparent'
                )}
              />
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                onClick={() => toggleCollapsed(req.id)}
                aria-expanded={!isCollapsed}
              >
                <div className="min-w-0">
                  <h3 className="truncate font-display text-base font-semibold text-text">{req.title}</h3>
                  <p className="mt-0.5 text-xs tabular-nums text-muted">
                    {req.selectedCount} / {req.requiredCount} {req.requiredCount === 1 ? 'course' : 'courses'} selected
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <Badge tone={req.isFulfilled ? 'accent' : 'neutral'} dot>
                    {req.isFulfilled ? 'Complete' : 'In progress'}
                  </Badge>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                    className={cn('text-faint transition-transform', isCollapsed ? '' : 'rotate-180')}
                  >
                    <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>

              {!isCollapsed && (
                <div className="border-t border-border px-3 py-3">
                  {filteredCodes.length > 0 ? (
                    <ul className="flex flex-col gap-1">
                      {filteredCodes.map((code: string) => {
                        const isSelected = selectedCourses.has(code);
                        const canTake = checkMeetsPrerequisites(code);
                        const credits = getCourseCredits(code);
                        const title = getCourseTitle(code);

                        return (
                          <li
                            key={code}
                            role="button"
                            tabIndex={0}
                            onClick={e => {
                              if ((e.target as HTMLElement).closest('.course-toggle-btn')) {
                                return;
                              }
                              e.preventDefault();
                              e.stopPropagation();
                              if (onViewCourseDetail) {
                                onViewCourseDetail(code);
                              }
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (onViewCourseDetail) {
                                  onViewCourseDetail(code);
                                }
                              }
                            }}
                            className={cn(
                              'flex cursor-pointer items-center gap-3 rounded-none border-l-2 py-2 pl-2.5 pr-1 transition-colors',
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
                            <span className="shrink-0 font-mono text-xs tabular-nums text-faint">{credits.toFixed(2)}</span>
                            {isSelected && (
                              <span className="shrink-0 text-text" aria-label="selected">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </span>
                            )}
                            {onCourseSelect && onCourseDeselect && (
                              <Button
                                size="sm"
                                variant={isSelected ? 'secondary' : 'primary'}
                                disabled={!isSelected && !canTake}
                                title={!isSelected && !canTake ? 'Prerequisites not met' : ''}
                                className="course-toggle-btn shrink-0"
                                onClick={e => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (isSelected) {
                                    onCourseDeselect(code);
                                  } else if (canTake) {
                                    const input = window.prompt(
                                      'Assign this course to a term (e.g., 2B):',
                                      '2B'
                                    );
                                    const term = input ? input.trim().toUpperCase() : undefined;
                                    onCourseSelect(code, term);
                                  }
                                }}
                              >
                                {isSelected ? 'Remove' : 'Add'}
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : searchTerm.trim() ? (
                    <p className="px-2 py-3 text-center text-sm italic text-faint">No courses match "{searchTerm}"</p>
                  ) : (
                    <p className="px-2 py-3 text-center text-sm italic text-faint">No courses specified</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RequirementBoxes;
