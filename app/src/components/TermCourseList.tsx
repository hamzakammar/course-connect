import React from 'react';
import { CourseNode, ProgramRequirement, CourseSet, ProgramInfo } from '../context/AppDataContext';
import { CourseCode } from './ui';

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
    <div>
      <h2 className="mb-4 text-lg font-semibold tracking-tight">
        {programInfo?.title || "Degree Program Plan"}
      </h2>
      {
        termRequirements.length === 0 ? (
          <p className="text-sm text-muted">No term-based requirements found in program plan.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {termRequirements.map(termReq => {
              const courseSetId = termReq.content as string;
              const courseSet = courseSetMap.get(courseSetId);
              const termCourses: CourseNode[] = courseSet ? courseSet.courses.map(code => courseMap.get(code)).filter(Boolean) as CourseNode[] : [];

              return (
                <div key={termReq.id} className="rounded-lg border border-border bg-surface p-4 shadow-e1">
                  <h3 className="mb-2 text-sm font-semibold text-text">
                    {termReq.explanations[0] || `Term: ${courseSet?.title || termReq.id}`}
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {termCourses.length === 0 ? (
                      <li className="text-sm italic text-faint">No courses found for this term.</li>
                    ) : (
                      termCourses.map(course => (
                        <li
                          key={course.id}
                          onClick={(e) => {
                            e.preventDefault();
                            onViewCourseDetail(course.code);
                          }}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-2"
                        >
                          <CourseCode>{course.code}</CourseCode>
                          <span className="min-w-0 flex-1 truncate text-sm text-muted">{course.title}</span>
                          <span className="shrink-0 font-mono text-xs text-faint">{course.credits} cr</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
};

export default TermCourseList;
