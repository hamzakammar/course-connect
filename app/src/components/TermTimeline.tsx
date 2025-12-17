import React from 'react';
import { CourseNode, ProgramInfo, CourseSet } from '../context/AppDataContext';

interface TermTimelineProps {
  courses: CourseNode[];
  programInfo: ProgramInfo | null;
  courseSets: CourseSet[];
  selectedCourses: Set<string>;
  onViewCourseDetail: (courseCode: string) => void;
  onCourseSelect?: (courseCode: string) => void;
  onCourseDeselect?: (courseCode: string) => void;
}

const TermTimeline: React.FC<TermTimelineProps> = ({ 
  courses, 
  programInfo, 
  courseSets,
  selectedCourses,
  onViewCourseDetail,
  onCourseSelect,
  onCourseDeselect
}) => {
  const courseMap = new Map<string, CourseNode>();
  courses.forEach(course => courseMap.set(course.code, course));

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
      <h2>{programInfo?.title || "Degree Program Plan"}</h2>
      <div className="term-timeline-container">
        {termOrder.map((term, index) => {
          const termCourses = requiredByTerm[term] || [];
          const anyReq = anyReqMap.get(term);
          
          // Calculate selected credits for this term
          const selectedCredits = (() => {
            let total: number = 0.0;
            
            // Count credits from selected required courses
            termCourses.forEach(course => {
              if (selectedCourses.has(course.code)) {
                const fullCourse = courseMap.get(course.code);
                const credits = typeof fullCourse?.credits === 'number' 
                  ? fullCourse.credits 
                  : parseFloat(String(fullCourse?.credits || '0'));
                total += credits;
              }
            });
            
            // Count credits from selected ANY courses (only count one if multiple are selected)
            if (anyReq) {
              const selectedAnyCourses = anyReq.courses.filter((code: string) => selectedCourses.has(code));
              if (selectedAnyCourses.length > 0) {
                // Only count the first selected ANY course (since it's "select one")
                const firstSelected = courseMap.get(selectedAnyCourses[0]);
                const credits = typeof firstSelected?.credits === 'number'
                  ? firstSelected.credits
                  : parseFloat(String(firstSelected?.credits || '0'));
                total += credits;
              }
            }
            
            return total;
          })();
          
          return (
            <div key={term} className="term-box-wrapper">
              {/* Connector line (except for first term) */}
              {index > 0 && <div className="term-connector" />}
              
              <div className="term-box">
                <div className="term-header">
                  <h3 className="term-label">{term}</h3>
                  <h6 className="term-units">Credits: {selectedCredits}</h6>
                </div>
                
                <div className="term-content">
                  {/* Required courses */}
                  {termCourses.length > 0 && (
                    <div className="term-section">
                      <h4 className="term-section-title">Required</h4>
                      <ul className="term-course-list">
                        {termCourses.map((course: { code: string; title: string }) => {
                          const fullCourse = courseMap.get(course.code);
                          return (
                            <li 
                              key={course.code} 
                              className={`term-course-item ${selectedCourses.has(course.code) ? 'course-selected' : ''}`}
                            >
                              <a 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  onViewCourseDetail(course.code);
                                }}
                                className="course-link"
                              >
                                <span className="course-code">{course.code}</span>
                                <span className="course-title">{course.title || fullCourse?.title || ''}</span>
                                <span className="course-units">{fullCourse?.credits || '0.0'}</span>
                                {selectedCourses.has(course.code) && <span className="selected-indicator">✓</span>}
                              </a>
                              {onCourseSelect && onCourseDeselect && (
                                <button
                                  className="course-toggle-btn"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (selectedCourses.has(course.code)) {
                                      onCourseDeselect(course.code);
                                    } else {
                                      onCourseSelect(course.code);
                                    }
                                  }}
                                >
                                  {selectedCourses.has(course.code) ? 'Deselect' : 'Select'}
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
                          const fullCourse = courseMap.get(courseCode);
                          return (
                            <li 
                              key={courseCode} 
                              className={`term-course-item term-course-any ${selectedCourses.has(courseCode) ? 'course-selected' : ''}`}
                            >
                              <a 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  onViewCourseDetail(courseCode);
                                }}
                                className="course-link"
                              >
                                <span className="course-code">{courseCode}</span>
                                <span className="course-title">{fullCourse?.title || ''}</span>
                                <span className="course-units">{fullCourse?.credits || '0.0'}</span>
                                {selectedCourses.has(courseCode) && <span className="selected-indicator">✓</span>}
                              </a>
                              {onCourseSelect && onCourseDeselect && (
                                <button
                                  className="course-toggle-btn"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (selectedCourses.has(courseCode)) {
                                      onCourseDeselect(courseCode);
                                    } else {
                                      onCourseSelect(courseCode);
                                    }
                                  }}
                                >
                                  {selectedCourses.has(courseCode) ? 'Deselect' : 'Select'}
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

