import React from 'react';
import { CourseNode, CourseEdge } from '../context/AppDataContext';

interface CourseDetailProps {
  course: CourseNode;
  edges: CourseEdge[];
  allCourses: CourseNode[]; // For looking up related course details
}

const CourseDetail: React.FC<CourseDetailProps> = ({ course, edges, allCourses }) => {
  const courseMap = new Map<string, CourseNode>();
  allCourses.forEach(c => courseMap.set(c.code, c));

  const getRelatedCourses = (targetCourseCode: string, relationType: string) => {
    // Edges point FROM the related course TO the target course
    // So for prerequisites of CS241, we want edges where target === CS241
    return edges.filter(edge => edge.target === targetCourseCode && edge.type === relationType)
                .map(edge => courseMap.get(edge.source))
                .filter(Boolean) as CourseNode[];
  };

  const prerequisites = getRelatedCourses(course.code, 'prereq');
  const corequisites = getRelatedCourses(course.code, 'coreq');
  const exclusions = getRelatedCourses(course.code, 'exclusion');

  return (
    <div className="course-detail">
      <h2>{course.code} - {course.title}</h2>
      <p><strong>Credits:</strong> {course.credits}</p>
      <p><strong>Subject:</strong> {course.subject}</p>
      <p><strong>Level:</strong> {course.level}</p>
      <p><strong>Description:</strong> {course.description}</p>

      {prerequisites.length > 0 && (
        <div>
          <h3>Prerequisites:</h3>
          <ul>
            {prerequisites.map(p => <li key={p.id}>{p.code} - {p.title}</li>)}
          </ul>
        </div>
      )}

      {corequisites.length > 0 && (
        <div>
          <h3>Corequisites:</h3>
          <ul>
            {corequisites.map(c => <li key={c.id}>{c.code} - {c.title}</li>)}
          </ul>
        </div>
      )}

      {exclusions.length > 0 && (
        <div>
          <h3>Antirequisites (Exclusions):</h3>
          <ul>
            {exclusions.map(e => <li key={e.id}>{e.code} - {e.title}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CourseDetail;
