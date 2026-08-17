import React from 'react';
import { CourseNode, CourseEdge } from '../context/AppDataContext';
import { Badge, CourseCode, cn } from './ui';

interface CourseDetailProps {
  course: CourseNode | null;
  edges: CourseEdge[];
  allCourses: CourseNode[]; // For looking up related course details
  onViewCourseDetail?: (courseCode: string) => void; // Optional callback to view related courses
  selectedCourses?: Set<string>; // Courses that are selected/completed
}

const Panel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded-lg border border-border bg-surface shadow-e1">{children}</div>
);

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-faint">
    {children}
  </h3>
);

const CourseDetail: React.FC<CourseDetailProps> = ({ course, edges, allCourses, onViewCourseDetail, selectedCourses = new Set() }) => {
  // Show placeholder if no course is selected
  if (!course) {
    return (
      <Panel>
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v13H6.5A2.5 2.5 0 0 0 4 19.5V6.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-text">Course details</h2>
          <p className="mt-1 max-w-[240px] text-sm text-muted">
            Select a course to view its details, prerequisites, and ratings.
          </p>
        </div>
      </Panel>
    );
  }

  // Normalize course codes for matching (remove spaces, uppercase)
  const normalizeCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();

  // Helper function to check if a course is selected, normalizing both sides for comparison
  const isCourseSelected = (courseCode: string): boolean => {
    const normalizedCode = normalizeCode(courseCode);
    return Array.from(selectedCourses).some(
      selected => normalizeCode(selected) === normalizedCode
    );
  };

  // Create normalized maps for lookups
  const courseMap = new Map<string, CourseNode>();
  const normalizedCourseMap = new Map<string, CourseNode>();
  allCourses.forEach(c => {
    courseMap.set(c.code, c);
    normalizedCourseMap.set(normalizeCode(c.code), c);
  });

  interface RelatedCourseWithEdge {
    course: CourseNode | { code: string; title: string; id: string };
    logic?: string;
    groupId?: string;
  }

  const getRelatedCourses = (targetCourseCode: string, relationType: string): RelatedCourseWithEdge[] => {
    // Normalize the target course code for matching
    const normalizedTarget = normalizeCode(targetCourseCode);

    // Edges point FROM the related course TO the target course
    // So for prerequisites of CS241, we want edges where target === CS241
    // Normalize both edge.target and edge.source for matching
    const matchingEdges = edges.filter(edge =>
      normalizeCode(edge.target) === normalizedTarget &&
      edge.type === relationType
    );

    // Try to find full course details, but also include codes we can't find
    const relatedCourses: RelatedCourseWithEdge[] = [];
    const foundCodes = new Set<string>();

    for (const edge of matchingEdges) {
      const normalizedSource = normalizeCode(edge.source);
      const course = normalizedCourseMap.get(normalizedSource);

      if (!foundCodes.has(normalizedSource)) {
        let courseData: CourseNode;
        if (course) {
          courseData = course;
        } else {
          // Include course code even if we don't have full details
          courseData = {
            code: edge.source,
            title: edge.source, // Fallback to code as title
            id: `missing-${edge.source}`,
          } as CourseNode;
        }

        relatedCourses.push({
          course: courseData,
          logic: edge.logic,
          groupId: edge.group_id,
        });
        foundCodes.add(normalizedSource);
      }
    }

    return relatedCourses;
  };

  const prerequisites = getRelatedCourses(course.code, 'PREREQ');
  const corequisites = getRelatedCourses(course.code, 'COREQ');
  const exclusions = getRelatedCourses(course.code, 'ANTIREQ');

  // Use corequisites as-is (data should be correct)
  const filteredCorequisites = corequisites;

  // Group related courses by group_id when logic is "ANY" (one of)
  // Also handle "ALL" groups that should be split (e.g., CS349 with CS241/CS241E and MATH options)
  const groupRelatedCourses = (relatedCourses: RelatedCourseWithEdge[]) => {
    const groups: Map<string, RelatedCourseWithEdge[]> = new Map();
    const ungrouped: RelatedCourseWithEdge[] = [];

    // First pass: group by "ANY" logic
    for (const item of relatedCourses) {
      if (item.logic === 'ANY' && item.groupId) {
        if (!groups.has(item.groupId)) {
          groups.set(item.groupId, []);
        }
        groups.get(item.groupId)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }

    // Second pass: detect "ALL" groups that should be split into "ANY" subgroups
    // This handles cases like CS349 where prerequisites are incorrectly all in one "ALL" group
    // Pattern: if an "ALL" group has courses with similar codes (e.g., CS241/CS241E, MATH115/MATH136/MATH146),
    // split them into logical "ANY" groups
    const allGroups = new Map<string, RelatedCourseWithEdge[]>();
    for (const item of ungrouped) {
      if (item.logic === 'ALL' && item.groupId) {
        if (!allGroups.has(item.groupId)) {
          allGroups.set(item.groupId, []);
        }
        allGroups.get(item.groupId)!.push(item);
      }
    }

    // Try to intelligently split "ALL" groups
    for (const [groupId, items] of allGroups.entries()) {
      // Group by subject code prefix (e.g., CS, MATH)
      const bySubject = new Map<string, RelatedCourseWithEdge[]>();
      for (const item of items) {
        const subject = item.course.code.match(/^[A-Z]+/)?.[0] || 'OTHER';
        if (!bySubject.has(subject)) {
          bySubject.set(subject, []);
        }
        bySubject.get(subject)!.push(item);
      }

      // If we have multiple subjects or courses that look like alternatives (similar numbers),
      // create "ANY" groups for each subject set
      if (bySubject.size > 1) {
        // Multiple subjects - create separate "ANY" groups
        let groupIndex = 0;
        const itemsToRemove = new Set<RelatedCourseWithEdge>();
        for (const [, subjectItems] of bySubject.entries()) {
          if (subjectItems.length > 1) {
            // Multiple courses in same subject - likely alternatives
            const newGroupId = `${groupId}_any_${groupIndex++}`;
            groups.set(newGroupId, subjectItems);
            subjectItems.forEach(item => itemsToRemove.add(item));
          }
        }
        // Remove grouped items from ungrouped
        itemsToRemove.forEach(item => {
          const idx = ungrouped.indexOf(item);
          if (idx >= 0) ungrouped.splice(idx, 1);
        });
      } else if (items.length > 2) {
        // Same subject but multiple courses - check if they look like alternatives
        // (e.g., CS241/CS241E or MATH115/136/146)
        const numbers = items.map(item => item.course.code.match(/\d+/)?.[0]).filter(Boolean);
        const uniqueNumbers = new Set(numbers);

        // If all have same number base or are sequential, treat as "ANY" group
        if (uniqueNumbers.size <= 2 || numbers.length > 2) {
          const newGroupId = `${groupId}_any_0`;
          groups.set(newGroupId, items);
          // Remove from ungrouped
          items.forEach(item => {
            const idx = ungrouped.indexOf(item);
            if (idx >= 0) ungrouped.splice(idx, 1);
          });
        }
      }
    }

    return { groups, ungrouped };
  };

  const prereqGroups = groupRelatedCourses(prerequisites);
  const coreqGroups = groupRelatedCourses(filteredCorequisites);

  const formatRating = (rating: number | undefined) => {
    if (rating === undefined || rating === null) return 'N/A';
    return `${(rating * 100).toFixed(0)}%`;
  };

  // Check if course has UWFlow ratings
  const hasRatings = course.uwflow_rating_liked != null ||
                     course.uwflow_rating_easy != null ||
                     course.uwflow_rating_useful != null;

  const RelatedItem: React.FC<{ code: string; title: string; completed?: boolean }> = ({
    code,
    title,
    completed,
  }) => (
    <li className="flex items-center gap-2 py-1">
      <button
        type="button"
        disabled={!onViewCourseDetail}
        onClick={(e) => {
          e.preventDefault();
          onViewCourseDetail?.(code);
        }}
        className={cn(
          'group inline-flex min-w-0 items-center gap-2 text-left',
          onViewCourseDetail && 'cursor-pointer'
        )}
      >
        <CourseCode active={completed}>{code}</CourseCode>
        <span
          className={cn(
            'truncate text-sm',
            completed ? 'font-medium text-met-fg' : 'text-muted',
            onViewCourseDetail && 'group-hover:text-text group-hover:underline'
          )}
        >
          {title}
        </span>
      </button>
      {completed && (
        <span className="shrink-0 text-met" aria-label="completed">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </li>
  );

  const RelatedGroups: React.FC<{
    groups: Map<string, RelatedCourseWithEdge[]>;
    ungrouped: RelatedCourseWithEdge[];
    checkCompleted: boolean;
    emptyLabel: string;
    hasAny: boolean;
  }> = ({ groups, ungrouped, checkCompleted, emptyLabel, hasAny }) => {
    if (!hasAny) {
      return <p className="text-sm italic text-faint">{emptyLabel}</p>;
    }
    return (
      <div className="flex flex-col gap-3">
        {Array.from(groups.entries()).map(([groupId, groupItems]) => {
          const isFulfilled = checkCompleted && groupItems.some(item => isCourseSelected(item.course.code));
          return (
            <div key={groupId} className="rounded-md border border-border bg-surface-2 p-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <Badge tone={isFulfilled ? 'met' : 'primary'}>
                  One of{isFulfilled ? ' ✓' : ''}
                </Badge>
              </div>
              <ul className="pl-0.5">
                {groupItems.map((item, idx) => {
                  const completed = checkCompleted && isCourseSelected(item.course.code);
                  return (
                    <RelatedItem
                      key={`${groupId}-${idx}`}
                      code={item.course.code}
                      title={item.course.title}
                      completed={completed}
                    />
                  );
                })}
              </ul>
            </div>
          );
        })}
        {ungrouped.length > 0 && (
          <ul>
            {ungrouped.map(p => (
              <RelatedItem
                key={p.course.id}
                code={p.course.code}
                title={p.course.title}
                completed={checkCompleted && isCourseSelected(p.course.code)}
              />
            ))}
          </ul>
        )}
      </div>
    );
  };

  const ratings: { label: string; value: number | undefined }[] = [
    { label: 'Liked', value: course.uwflow_rating_liked },
    { label: 'Easy', value: course.uwflow_rating_easy },
    { label: 'Useful', value: course.uwflow_rating_useful },
  ];

  return (
    <Panel>
      <div className="border-b border-border p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <CourseCode active={isCourseSelected(course.code)} className="text-sm">
            {course.code}
          </CourseCode>
          {isCourseSelected(course.code) && <Badge tone="met" dot>In plan</Badge>}
        </div>
        <h2 className="text-lg font-semibold leading-snug text-text">{course.title}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="neutral">{course.credits} credits</Badge>
          <Badge tone="neutral">{course.subject}</Badge>
          <Badge tone="neutral">Level {course.level}</Badge>
        </div>
      </div>

      <div className="max-h-[calc(85vh-160px)] space-y-5 overflow-y-auto p-5">
        {course.description && (
          <div>
            <SectionHeading>Description</SectionHeading>
            <p className="text-sm leading-relaxed text-muted">{course.description}</p>
          </div>
        )}

        {/* UWFlow Ratings */}
        <div>
          <SectionHeading>UWFlow Ratings</SectionHeading>
          {hasRatings ? (
            <div className="flex flex-col gap-2.5">
              {ratings.map(({ label, value }) =>
                value != null ? (
                  <div key={label}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-text">{label}</span>
                      <span className="font-mono text-muted">{formatRating(value)}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round(value * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : null
              )}
              {course.uwflow_rating_liked != null && course.uwflow_rating_filled_count != null && (
                <p className="text-xs text-faint">
                  Based on {course.uwflow_rating_filled_count} responses
                </p>
              )}
              {course.uwflow_url && (
                <a
                  href={course.uwflow_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  View on UWFlow →
                </a>
              )}
            </div>
          ) : (
            <p className="text-sm italic text-faint">
              No UWFlow ratings available for this course.
            </p>
          )}
        </div>

        <div>
          <SectionHeading>Prerequisites</SectionHeading>
          <RelatedGroups
            groups={prereqGroups.groups}
            ungrouped={prereqGroups.ungrouped}
            checkCompleted
            emptyLabel="No prerequisites found"
            hasAny={prerequisites.length > 0 || prereqGroups.groups.size > 0}
          />
        </div>

        <div>
          <SectionHeading>Corequisites</SectionHeading>
          <RelatedGroups
            groups={coreqGroups.groups}
            ungrouped={coreqGroups.ungrouped}
            checkCompleted={false}
            emptyLabel="No corequisites found"
            hasAny={filteredCorequisites.length > 0 || coreqGroups.groups.size > 0}
          />
        </div>

        <div>
          <SectionHeading>Antirequisites (Exclusions)</SectionHeading>
          {exclusions.length > 0 ? (
            <ul>
              {exclusions.map(excl => (
                <RelatedItem key={excl.course.id} code={excl.course.code} title={excl.course.title} />
              ))}
            </ul>
          ) : (
            <p className="text-sm italic text-faint">No antirequisites found</p>
          )}
        </div>
      </div>
    </Panel>
  );
};

export default CourseDetail;
