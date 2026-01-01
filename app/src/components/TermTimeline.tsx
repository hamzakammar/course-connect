import React from 'react';
import { CourseNode, ProgramInfo, CourseSet, ProgramLists, CourseEdge } from '../context/AppDataContext';
import { meetsPrerequisites, normalizeCode } from '../utils/prerequisites';

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
    <div className="term-timeline">
      <div className="term-timeline-container">
        {termOrder.map((term) => {
          const termCourses = requiredByTerm[term] || [];
          const anyReq = anyReqMap.get(term);
          const electiveCodesForTerm = Object.entries(electiveAssignments)
            .filter(([_, assignedTerm]) => assignedTerm === term)
            .map(([code]) => code);
          const electiveRequirement = programInfo?.elective_requirements_by_term?.[term];
          
          // Calculate selected credits for this term
          const selectedCredits = (() => {
            let total: number = 0.0;
            
            // Count credits from selected required courses
            termCourses.forEach(course => {
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
            <div key={term} className="term-box-wrapper">
              <div className="term-box">
                <div className="term-header">
                  <h3 className="term-label">{term}</h3>
                  <h6 className="term-units">Credits: {selectedCredits.toFixed(2)}</h6>
                </div>
                
                <div className="term-content">
                  {/* Required courses */}
                  {termCourses.length > 0 && (
                    <div className="term-section">
                      <h4 className="term-section-title">Required</h4>
                      <ul className="term-course-list">
                        {termCourses.map((course: { code: string; title: string }) => {
                          const credits = getCourseCredits(course.code);
                          const title = getCourseTitle(course.code) || course.title;
                          const isSelected = selectedCourses.has(course.code);
                          const canTake = meetsPrerequisites(course.code, edges, selectedCourses);
                          return (
                            <li 
                              key={course.code} 
                              className={`term-course-item ${isSelected ? 'course-selected' : ''} ${canTake ? 'course-eligible' : 'course-not-eligible'}`}
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.preventDefault();
                                onViewCourseDetail(course.code);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                                  e.preventDefault();
                                  onViewCourseDetail(course.code);
                                }
                              }}
                            >
                              <div className="course-link">
                                <span className="course-code">{course.code}</span>
                                <span className="course-title">{title}</span>
                                <span className="course-units">{credits.toFixed(2)}</span>
                                {isSelected && <span className="selected-indicator">✓</span>}
                                {canTake && !isSelected && <span style={{ color: '#4caf50', marginLeft: '0.5rem', fontSize: '0.9em' }}>✓ Ready</span>}
                              </div>
                              {onCourseSelect && onCourseDeselect && (
                                <button
                                  className="course-toggle-btn"
                                  disabled={!isSelected && !canTake}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (isSelected) {
                                      onCourseDeselect(course.code, term);
                                    } else if (canTake) {
                                      onCourseSelect(course.code, term);
                                    }
                                  }}
                                  title={!isSelected && !canTake ? 'Prerequisites not met' : ''}
                                >
                                  {isSelected ? 'Deselect' : 'Select'}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  
                  {/* Select one courses (ANY requirements) */}
                  {anyReq && (
                    <div className="term-section term-section-any">
                      <h4 className="term-section-title">Select One</h4>
                      <ul className="term-course-list">
                        {anyReq.courses.map((courseCode: string) => {
                          const credits = getCourseCredits(courseCode);
                          const title = getCourseTitle(courseCode);
                          const isSelected = selectedCourses.has(courseCode);
                          const canTake = meetsPrerequisites(courseCode, edges, selectedCourses);
                          return (
                            <li
                            key={courseCode}
                            className={`term-course-item term-course-any ${isSelected ? 'course-selected' : ''} ${canTake ? 'course-eligible' : 'course-not-eligible'}`}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.preventDefault();
                              onViewCourseDetail(courseCode);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onViewCourseDetail(courseCode);
                              }
                            }}
                            >
                              <div className="course-link">
                                <span className="course-code">{courseCode}</span>
                                <span className="course-title">{title}</span>
                                <span className="course-units">{credits.toFixed(2)}</span>
                                {isSelected && <span className="selected-indicator">✓</span>}
                                {canTake && !isSelected && <span style={{ color: '#4caf50', marginLeft: '0.5rem', fontSize: '0.9em' }}>✓ Ready</span>}
                              </div>
                              {onCourseSelect && onCourseDeselect && (
                                <button
                                  className="course-toggle-btn"
                                  disabled={!isSelected && !canTake}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (isSelected) {
                                      onCourseDeselect(courseCode, term);
                                    } else if (canTake) {
                                      onCourseSelect(courseCode, term);
                                    }
                                  }}
                                  title={!isSelected && !canTake ? 'Prerequisites not met' : ''}
                                >
                                  {isSelected ? 'Deselect' : 'Select'}
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Elective requirements */}
                  {electiveRequirement && (
                    <div className="term-section term-section-electives">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <h4 className="term-section-title">
                          {electiveRequirement.description || 'Approved'} Electives ({electiveCodesForTerm.length}/{electiveRequirement.count})
                        </h4>
                        {electiveCodesForTerm.length < electiveRequirement.count && onCourseSelect && (
                          <button
                            className="add-elective-btn"
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
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.85rem',
                              backgroundColor: '#4CAF50',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            + Add Elective
                          </button>
                        )}
                      </div>
                      {electiveCodesForTerm.length < electiveRequirement.count && (
                        <p style={{ 
                          fontSize: '0.85rem', 
                          color: '#666', 
                          fontStyle: 'italic',
                          marginBottom: '0.5rem'
                        }}>
                          Complete {electiveRequirement.count - electiveCodesForTerm.length} more {electiveRequirement.description || 'approved'} elective{electiveRequirement.count - electiveCodesForTerm.length > 1 ? 's' : ''}
                        </p>
                      )}
                      {electiveCodesForTerm.length > 0 && (
                        <ul className="term-course-list">
                          {electiveCodesForTerm.map(code => {
                            const isSelected = selectedCourses.has(code);
                            const credits = getCourseCredits(code);
                            const title = getCourseTitle(code);
                            return (
                              <li
                                key={code}
                                className={`term-course-item term-course-any ${isSelected ? 'course-selected' : ''}`}
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  e.preventDefault();
                                  onViewCourseDetail(code);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onViewCourseDetail(code);
                                  }
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
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (isSelected) {
                                        onCourseDeselect(code, term);
                                      } else {
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
                      )}
                    </div>
                  )}
                  
                  {/* Legacy: Electives explicitly assigned to this term (if no requirement defined) */}
                  {!electiveRequirement && electiveCodesForTerm.length > 0 && (
                    <div className="term-section term-section-any">
                      <h4 className="term-section-title">Electives</h4>
                      <ul className="term-course-list">
                        {electiveCodesForTerm.map(code => {
                          const isSelected = selectedCourses.has(code);
                          const credits = getCourseCredits(code);
                          const title = getCourseTitle(code);
                          return (
                            <li
                              key={code}
                              className={`term-course-item term-course-any ${isSelected ? 'course-selected' : ''}`}
                            >
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  onViewCourseDetail(code);
                                }}
                                className="course-link"
                              >
                                <span className="course-code">{code}</span>
                                <span className="course-title">{title}</span>
                                <span className="course-units">{credits.toFixed(2)}</span>
                                {isSelected && <span className="selected-indicator">✓</span>}
                              </a>
                              {onCourseSelect && onCourseDeselect && (
                                <button
                                  className="course-toggle-btn"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (isSelected) {
                                      onCourseDeselect(code, term);
                                    } else {
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
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TermTimeline;

