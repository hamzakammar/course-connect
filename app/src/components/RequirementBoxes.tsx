import React, { useState } from 'react';
import { CourseNode, ProgramLists } from '../context/AppDataContext';

interface RequirementBoxesProps {
  courses: CourseNode[];
  selectedCourses: Set<string>;
  onViewCourseDetail: (courseCode: string) => void;
  programLists: ProgramLists;
  onCourseSelect?: (courseCode: string, term?: string) => void;
  onCourseDeselect?: (courseCode: string, term?: string) => void;
}

const RequirementBoxes: React.FC<RequirementBoxesProps> = ({
  courses,
  selectedCourses,
  onViewCourseDetail,
  programLists,
  onCourseSelect,
  onCourseDeselect,
}) => {
  const courseMap = new Map<string, CourseNode>();
  courses.forEach(course => courseMap.set(course.code, course));

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCollapsed = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const normalizeCode = (code: string) => code.replace(/\s+/g, '');

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

  // Handle both formats: Record<string, Array<{code, title}>> and Record<string, {list_name, courses}>
  const allRequirements = Object.entries(programLists?.course_lists || {}).map(([listName, list]) => {
    // Check if list is an array (direct format) or an object with courses property
    const courses = Array.isArray(list) 
      ? list 
      : (list as any)?.courses || [];
    
    const codes = courses.map((c: { code: string }) => normalizeCode(c.code));
    const isFulfilled = codes.some((code: string) => selectedCourses.has(code));

    return {
      id: listName,
      title: listName,
      codes,
      isFulfilled,
    };
  });

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
      <div className="requirement-boxes-grid">
        {allRequirements.map(req => (
          <div
            key={req.id}
            className={`requirement-box ${req.isFulfilled ? 'requirement-fulfilled' : ''}`}
          >
            <div
              className="requirement-box-header"
              onClick={() => toggleCollapsed(req.id)}
              style={{ cursor: 'pointer' }}
            >
              <h3 className="requirement-title">{req.title}</h3>
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
                {req.codes.length > 0 ? (
                  <ul className="requirement-course-list">
                    {req.codes.map((code: string) => {
                      const isSelected = selectedCourses.has(code);
                      const credits = getCourseCredits(code);
                      const title = getCourseTitle(code);

                      return (
                        <li
                          key={code}
                          className={`requirement-course-item ${isSelected ? 'course-selected' : ''}`}
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
                ) : (
                  <p className="no-courses">No courses specified</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default RequirementBoxes;

