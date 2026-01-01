import React from 'react';
import { CourseNode, ProgramRequirement, CourseSet, ProgramInfo } from '../context/AppDataContext';

interface TermCourseListProps {
  courses: CourseNode[];
  programInfo: ProgramInfo | null; // Overall program details
  programPlan: ProgramRequirement[]; // Array of requirements
  courseSets: CourseSet[];
  onViewCourseDetail: (courseCode: string) => void; 
}

// A helper to map course codes to CourseNode objects for easier lookup
const mapCoursesByCode = (courses: CourseNode[]): Map<string, CourseNode> => {
  const courseMap = new Map<string, CourseNode>();
  courses.forEach(course => courseMap.set(course.code, course));
  return courseMap;
};

const TermCourseList: React.FC<TermCourseListProps> = ({ courses, programInfo, programPlan, courseSets, onViewCourseDetail }) => {
  const courseMap = mapCoursesByCode(courses);
  const courseSetMap = new Map<string, CourseSet>();
  courseSets.forEach(cs => cs.id_hint && courseSetMap.set(cs.id_hint, cs));

  const termRequirements = programPlan.filter(req => req.id.startsWith("req_term"));

  return (
    <div className="term-course-list">
      <h2>{programInfo?.title || "Degree Program Plan"}</h2>
      {
        termRequirements.length === 0 ? (
          <p>No term-based requirements found in program plan.</p>
        ) : (
          termRequirements.map(termReq => {
            const courseSetId = termReq.content as string; 
            const courseSet = courseSetMap.get(courseSetId);
            const termCourses: CourseNode[] = courseSet ? courseSet.courses.map(code => courseMap.get(code)).filter(Boolean) as CourseNode[] : [];
            
            return (
              <div key={termReq.id} className="term-block">
                <h3>{termReq.explanations[0] || `Term: ${courseSet?.title || termReq.id}`}</h3>
                <ul>
                  {termCourses.length === 0 ? (
                    <li>No courses found for this term.</li>
                  ) : (
                    termCourses.map(course => (
                      <li 
                        key={course.id}
                        onClick={(e) => {
                          e.preventDefault();
                          onViewCourseDetail(course.code);
                        }}
                        className="term-course-list-item"
                      >
                        {course.code} - {course.title} ({course.credits} credits)
                      </li>
                    ))
                  )}
                </ul>
              </div>
            );
          })
        )
      }
    </div>
  );
};

export default TermCourseList;
