import React, { useState } from 'react';
import { CourseNode, CourseEdge } from '../context/AppDataContext';
import { meetsPrerequisites as meetsPrerequisitesUtil, getMissingPrerequisites, normalizeCode } from '../utils/prerequisites';
import { Input, Button, CourseCode, Badge, cn } from './ui';

interface ElectiveSelectorProps {
  courses: CourseNode[];
  edges: CourseEdge[];
  selectedCourses: Set<string>; // Courses already in the plan
  onCourseSelect: (courseCode: string) => void;
  onCourseDeselect: (courseCode: string) => void;
  onViewCourseDetail: (courseCode: string) => void; // New prop
}

const ElectiveSelector: React.FC<ElectiveSelectorProps> = ({
  courses,
  edges,
  selectedCourses,
  onCourseSelect,
  onCourseDeselect: _onCourseDeselect, // Unused but kept for interface compatibility
  onViewCourseDetail,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Helper function to get prerequisite courses for display
  const getPrerequisites = (courseCode: string): CourseNode[] => {
    const normalizedTarget = normalizeCode(courseCode);
    const prereqEdges = edges.filter(edge => {
      const normalizedEdgeTarget = normalizeCode(edge.target);
      return normalizedEdgeTarget === normalizedTarget && edge.type === 'PREREQ';
    });
    const prereqCourseCodes = prereqEdges.map(edge => edge.source);
    return prereqCourseCodes.map(code => {
      const normalizedPrereqCode = normalizeCode(code);
      return courses.find(c => normalizeCode(c.code) === normalizedPrereqCode);
    }).filter(Boolean) as CourseNode[];
  };

  // Use the utility function that properly handles "ANY" logic groups
  const meetsPrerequisites = (courseCode: string): boolean => {
    return meetsPrerequisitesUtil(courseCode, edges, selectedCourses);
  };

  const availableElectives = courses.filter(course => {
    // For simplicity, consider any course not in the program plan as a potential elective initially.
    // A more sophisticated approach would involve specific elective course sets from programPlan.
    // Also, filter by search term (searches both code and title, handles spaces).
    const normalizedCourseCode = normalizeCode(course.code);
    const isSelected = Array.from(selectedCourses).some(selected => normalizeCode(selected) === normalizedCourseCode);
    
    if (isSelected) return false;
    
    if (!searchTerm.trim()) return true;
    
    const searchLower = searchTerm.toLowerCase().trim();
    // Normalize search term (remove spaces) for better matching
    const normalizedSearch = searchLower.replace(/\s+/g, '');
    const normalizedTitle = course.title.toLowerCase();
    
    // Search in: normalized code, original code, and title
    return normalizedCourseCode.includes(normalizedSearch) ||
           course.code.toLowerCase().includes(searchLower) ||
           normalizedTitle.includes(searchLower);
  });

  // Sort courses by eligibility (can take first, then by number of missing prerequisites)
  const sortCoursesByEligibility = (courses: CourseNode[]): CourseNode[] => {
    return [...courses].sort((a, b) => {
      const aCanTake = meetsPrerequisites(a.code);
      const bCanTake = meetsPrerequisites(b.code);
      
      // First, sort by eligibility (can take first)
      if (aCanTake && !bCanTake) return -1;
      if (!aCanTake && bCanTake) return 1;
      
      // If both have same eligibility, sort by number of missing prerequisites
      // Use getMissingPrerequisites for accurate counting (handles ANY groups properly)
      const aMissing = getMissingPrerequisites(a.code, edges, selectedCourses).length;
      const bMissing = getMissingPrerequisites(b.code, edges, selectedCourses).length;
      
      return aMissing - bMissing;
    });
  };

  const sortedElectives = sortCoursesByEligibility(availableElectives);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Select Electives</h2>
      <div className="mb-4">
        <Input
          type="text"
          placeholder="Search electives…"
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
      <div className="flex flex-col gap-2">
        {sortedElectives.map(course => {
          const canTake = meetsPrerequisites(course.code);
          const prereqs = getPrerequisites(course.code);
          return (
            <div
              key={course.id}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                onViewCourseDetail(course.code);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onViewCourseDetail(course.code);
                }
              }}
              className={cn(
                'cursor-pointer border border-l-2 bg-surface p-3 transition-colors',
                canTake
                  ? 'border-border border-l-text hover:border-border-strong'
                  : 'border-border border-l-border-strong opacity-70 hover:opacity-100'
              )}
            >
              <div className="flex items-center gap-3">
                <CourseCode>{course.code}</CourseCode>
                <span className="min-w-0 flex-1 truncate text-sm text-text">
                  {course.title}
                  <span className="ml-1 tabular-nums text-muted">({course.credits} cr)</span>
                </span>
                {canTake && <Badge tone="accent" dot>Ready</Badge>}
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCourseSelect(course.code);
                  }}
                  className="shrink-0"
                >
                  Add
                </Button>
              </div>
              {prereqs.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                  <span className="eyebrow">Prereqs</span>
                  {prereqs.map((prereq, index, array) => {
                    const normalizedPrereq = normalizeCode(prereq.code);
                    const isCompleted = Array.from(selectedCourses).some(selected => normalizeCode(selected) === normalizedPrereq);
                    return (
                      <React.Fragment key={prereq.id}>
                        <span className={cn('font-mono', isCompleted ? 'text-text' : 'text-accent-soft-fg')}>
                          {prereq.code}{!isCompleted && ' (missing)'}
                        </span>
                        {index < array.length - 1 && <span className="text-faint">·</span>}
                      </React.Fragment>
                    );
                  })}
                </p>
              )}
              {!canTake && (
                <p className="mt-1.5 text-xs text-muted">
                  Does not meet all prerequisites.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ElectiveSelector;
