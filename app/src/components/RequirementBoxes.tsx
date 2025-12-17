import React from 'react';
import { CourseNode, CourseSet, ProgramRequirement } from '../context/AppDataContext';

interface RequirementBoxesProps {
  courses: CourseNode[];
  courseSets: CourseSet[];
  programPlan: ProgramRequirement[];
  selectedCourses: Set<string>;
  onViewCourseDetail: (courseCode: string) => void;
}

const RequirementBoxes: React.FC<RequirementBoxesProps> = ({
  courses,
  courseSets,
  programPlan,
  selectedCourses,
  onViewCourseDetail
}) => {
  const courseMap = new Map<string, CourseNode>();
  courses.forEach(course => courseMap.set(course.code, course));

  const courseSetMap = new Map<string, CourseSet>();
  courseSets.forEach(cs => {
    if (cs.id_hint) {
      courseSetMap.set(cs.id_hint, cs);
    }
  });

  // Filter out term-based requirements, keep only course list requirements
  const courseListRequirements = programPlan.filter(req => {
    // Exclude term-based requirements
    if (req.id.startsWith('req_term_') || req.id.startsWith('term_req_')) {
      return false;
    }
    // Include course list requirements (those with courseSet content)
    const courseSetId = req.content as string;
    const courseSet = courseSetMap.get(courseSetId);
    return courseSet && courseSet.title && !courseSet.title.includes('Term');
  });

  // If no course list requirements, check courseSets directly
  const courseListSets = courseSets.filter(cs => {
    if (!cs.id_hint) return false;
    // Exclude term-based course sets
    if (cs.id_hint.startsWith('req_term_')) return false;
    return true;
  });

  // Determine if a requirement is fulfilled
  const isRequirementFulfilled = (requirement: ProgramRequirement): boolean => {
    const courseSetId = requirement.content as string;
    const courseSet = courseSetMap.get(courseSetId);
    
    if (!courseSet) return false;

    if (requirement.type === 'ALL') {
      // ALL: all courses must be selected
      return courseSet.courses.every(code => selectedCourses.has(code));
    } else if (requirement.type === 'ANY') {
      // ANY: at least one course must be selected
      return courseSet.courses.some(code => selectedCourses.has(code));
    }
    
    return false;
  };

  const isCourseSetFulfilled = (courseSet: CourseSet): boolean => {
    // For course sets without explicit requirements, check if all courses are selected
    return courseSet.courses.every(code => selectedCourses.has(code));
  };

  // Combine requirements and course sets
  const allRequirements = [
    ...courseListRequirements.map(req => ({
      id: req.id,
      title: courseSetMap.get(req.content as string)?.title || req.explanations[0] || 'Requirement',
      courseSet: courseSetMap.get(req.content as string),
      requirement: req,
      isFulfilled: isRequirementFulfilled(req)
    })),
    ...courseListSets
      .filter(cs => !courseListRequirements.some(req => req.content === cs.id_hint))
      .map(cs => ({
        id: cs.id_hint,
        title: cs.title || 'Course List',
        courseSet: cs,
        requirement: null,
        isFulfilled: isCourseSetFulfilled(cs)
      }))
  ];

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
      <h2>Additional Requirements</h2>
      <div className="requirement-boxes-grid">
        {allRequirements.map(req => {
          const coursesInSet = req.courseSet?.courses || [];
          
          return (
            <div 
              key={req.id} 
              className={`requirement-box ${req.isFulfilled ? 'requirement-fulfilled' : ''}`}
            >
              <div className="requirement-box-header">
                <h3 className="requirement-title">{req.title}</h3>
                <div className={`requirement-status ${req.isFulfilled ? 'status-fulfilled' : 'status-pending'}`}>
                  {req.isFulfilled ? (
                    <span className="status-icon">✓</span>
                  ) : (
                    <span className="status-icon">○</span>
                  )}
                </div>
              </div>
              
              {req.requirement && (
                <p className="requirement-description">
                  {req.requirement.explanations[0] || ''}
                </p>
              )}
              
              <div className="requirement-courses">
                {coursesInSet.length > 0 ? (
                  <ul className="requirement-course-list">
                    {coursesInSet.map(courseCode => {
                      const course = courseMap.get(courseCode);
                      const isSelected = selectedCourses.has(courseCode);
                      
                      return (
                        <li 
                          key={courseCode} 
                          className={`requirement-course-item ${isSelected ? 'course-selected' : ''}`}
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
                            <span className="course-title">{course?.title || ''}</span>
                            {isSelected && <span className="selected-indicator">✓</span>}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="no-courses">No courses specified</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RequirementBoxes;

