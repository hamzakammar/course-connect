import React, { useState, useEffect } from 'react';
import { CourseNode, ProgramLists, CourseEdge } from '../context/AppDataContext';

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

  const normalizeCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();

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
  const meetsPrerequisites = (courseCode: string): boolean => {
    if (!edges || edges.length === 0) return true; // No edges means no prerequisite info
    const normalizedTarget = normalizeCode(courseCode);
    const prereqEdges = edges.filter(edge => {
      const normalizedEdgeTarget = normalizeCode(edge.target);
      return normalizedEdgeTarget === normalizedTarget && edge.type === 'PREREQ';
    });
    if (prereqEdges.length === 0) return true; // No prerequisites
    
    // Check if all prerequisites are selected (for now, simple check - could be enhanced for "one of" logic)
    return prereqEdges.every(edge => {
      const normalizedSource = normalizeCode(edge.source);
      return Array.from(selectedCourses).some(selected => normalizeCode(selected) === normalizedSource);
    });
  };

  // Sort courses by eligibility (can take first, then selected)
  const sortCoursesByEligibility = (codes: string[]): string[] => {
    return [...codes].sort((a, b) => {
      const aCanTake = meetsPrerequisites(a);
      const bCanTake = meetsPrerequisites(b);
      
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
    
    // Debug: Log sorting results for first requirement
    if (listName === 'Natural Science List' && sortedCodes.length > 0) {
      const eligibleCount = sortedCodes.filter(c => meetsPrerequisites(c)).length;
      console.log(`[RequirementBoxes] ${listName}: ${eligibleCount}/${sortedCodes.length} eligible, sorted:`, 
        sortedCodes.slice(0, 5).map(c => `${c}(${meetsPrerequisites(c) ? '✓' : '✗'})`).join(', '));
    }
    
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRequirements.map(r => `${r.id}:${r.isFulfilled}`).join(',')]);

  if (allRequirements.length === 0) {
    return (
      <div className="requirement-boxes">
        <h2>Additional Requirements</h2>
        <p>No additional requirements found.</p>
      </div>
    );
  }

  return (
    <div className="requirement-boxes">
      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search courses..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem',
            fontSize: '1rem',
            border: '1px solid #ddd',
            borderRadius: '4px',
            boxSizing: 'border-box'
          }}
        />
      </div>
      
      <div className="requirement-boxes-grid">
        {allRequirements.map(req => {
          // Filter codes by search term
          const filteredCodes = req.codes.filter(code => {
            if (!searchTerm.trim()) return true;
            const title = getCourseTitle(code);
            const searchLower = searchTerm.toLowerCase();
            return code.toLowerCase().includes(searchLower) || 
                   title.toLowerCase().includes(searchLower);
          });
          
          return (
          <div
            key={req.id}
            className={`requirement-box ${req.isFulfilled ? 'requirement-fulfilled' : ''}`}
          >
            <div
              className="requirement-box-header"
              onClick={() => toggleCollapsed(req.id)}
              style={{ cursor: 'pointer' }}
            >
              <div>
                <h3 className="requirement-title">{req.title}</h3>
                <p style={{ fontSize: '0.9em', color: '#666', margin: '0.25rem 0 0 0' }}>
                  {req.selectedCount} / {req.requiredCount} {req.requiredCount === 1 ? 'course' : 'courses'} selected
                </p>
              </div>
              <div className={`requirement-status ${req.isFulfilled ? 'status-fulfilled' : 'status-pending'}`}>
                {req.isFulfilled ? (
                  <span className="status-icon">✓</span>
                ) : (
                  <span className="status-icon">○</span>
                )}
              </div>
            </div>

            {!collapsed[req.id] && (
              <div className="requirement-courses">
                {filteredCodes.length > 0 ? (
                  <ul className="requirement-course-list">
                    {filteredCodes.map((code: string) => {
                      const isSelected = selectedCourses.has(code);
                      const canTake = meetsPrerequisites(code);
                      const credits = getCourseCredits(code);
                      const title = getCourseTitle(code);

                      return (
                        <li
                          key={code}
                          className={`requirement-course-item ${isSelected ? 'course-selected' : ''} ${canTake ? 'course-eligible' : 'course-not-eligible'}`}
                          onClick={e => {
                            e.preventDefault();
                            onViewCourseDetail(code);
                          }}
                        >
                          <div className="course-link">
                            <span className="course-code">{code}</span>
                            <span className="course-title">{title}</span>
                            <span className="course-units">{credits.toFixed(2)}</span>
                            {isSelected && <span className="selected-indicator">✓</span>}
                            {canTake && !isSelected && <span style={{ color: '#4caf50', marginLeft: '0.5rem', fontSize: '0.9em' }}>✓ Ready</span>}
                          </div>
                          {onCourseSelect && onCourseDeselect && (
                            <button
                              className="course-toggle-btn"
                              onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (isSelected) {
                                  onCourseDeselect(code);
                                } else {
                                  const input = window.prompt(
                                    'Assign this course to a term (e.g., 2B):',
                                    '2B'
                                  );
                                  const term = input ? input.trim().toUpperCase() : undefined;
                                  onCourseSelect(code, term);
                                }
                              }}
                            >
                              {isSelected ? 'Deselect' : 'Select'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : searchTerm.trim() ? (
                  <p className="no-courses">No courses match "{searchTerm}"</p>
                ) : (
                  <p className="no-courses">No courses specified</p>
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

