import React, { useState } from 'react';
import { CourseNode, CourseEdge } from '../context/AppDataContext';

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

  const availableElectives = courses.filter(course => {
    // For simplicity, consider any course not in the program plan as a potential elective initially.
    // A more sophisticated approach would involve specific elective course sets from programPlan.
    // Also, filter by search term.
    return !selectedCourses.has(course.code) &&
           course.title.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const getPrerequisites = (courseCode: string): CourseNode[] => {
    const prereqEdges = edges.filter(edge => edge.target === courseCode && edge.type === 'PREREQ');
    const prereqCourseCodes = prereqEdges.map(edge => edge.source);
    return prereqCourseCodes.map(code => courses.find(c => c.code === code)).filter(Boolean) as CourseNode[];
  };

  const meetsPrerequisites = (courseCode: string): boolean => {
    const prereqs = getPrerequisites(courseCode);
    if (prereqs.length === 0) return true; // No prerequisites
    return prereqs.every(prereq => selectedCourses.has(prereq.code));
  };

  return (
    <div className="elective-selector">
      <h2>Select Electives</h2>
      <input
        type="text"
        placeholder="Search electives..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
      <div className="elective-list">
        {availableElectives.map(course => (
          <div 
            key={course.id} 
            className="elective-item"
            onClick={(e) => {
              e.preventDefault();
              onViewCourseDetail(course.code);
            }}
          >
            <div className="elective-main">
              <span>{course.code} - {course.title} ({course.credits} credits)</span>
            </div>
            <button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCourseSelect(course.code);
              }}
            >
              Add
            </button>
            <div className="prerequisites">
              {getPrerequisites(course.code).length > 0 && (
                <p>Prerequisites: 
                  {getPrerequisites(course.code).map((prereq, index, array) => (
                    <React.Fragment key={prereq.id}>
                      <span style={{ color: selectedCourses.has(prereq.code) ? 'green' : 'red' }}>
                        {prereq.code}{!selectedCourses.has(prereq.code) && ' (Missing)'}
                      </span>
                      {index < array.length - 1 && ', '}
                    </React.Fragment>
                  ))}
                </p>
              )}
              {!meetsPrerequisites(course.code) && (
                <p style={{ color: 'red' }}>Does not meet all prerequisites.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ElectiveSelector;
