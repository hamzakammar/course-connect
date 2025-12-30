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

  // Normalize course codes for matching (remove spaces, uppercase)
  const normalizeCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();

  // Helper functions for prerequisites (must be defined before use)
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

  const meetsPrerequisites = (courseCode: string): boolean => {
    const prereqs = getPrerequisites(courseCode);
    if (prereqs.length === 0) return true; // No prerequisites
    return prereqs.every(prereq => {
      const normalizedPrereq = normalizeCode(prereq.code);
      return Array.from(selectedCourses).some(selected => normalizeCode(selected) === normalizedPrereq);
    });
  };

  const availableElectives = courses.filter(course => {
    // For simplicity, consider any course not in the program plan as a potential elective initially.
    // A more sophisticated approach would involve specific elective course sets from programPlan.
    // Also, filter by search term.
    const normalizedCourseCode = normalizeCode(course.code);
    const isSelected = Array.from(selectedCourses).some(selected => normalizeCode(selected) === normalizedCourseCode);
    
    return !isSelected &&
           (course.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            course.title.toLowerCase().includes(searchTerm.toLowerCase()));
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
      const aPrereqs = getPrerequisites(a.code);
      const bPrereqs = getPrerequisites(b.code);
      const aMissing = aPrereqs.filter(p => {
        const normalizedPrereq = normalizeCode(p.code);
        return !Array.from(selectedCourses).some(selected => normalizeCode(selected) === normalizedPrereq);
      }).length;
      const bMissing = bPrereqs.filter(p => {
        const normalizedPrereq = normalizeCode(p.code);
        return !Array.from(selectedCourses).some(selected => normalizeCode(selected) === normalizedPrereq);
      }).length;
      
      return aMissing - bMissing;
    });
  };

  const sortedElectives = sortCoursesByEligibility(availableElectives);

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
        {sortedElectives.map(course => {
          const canTake = meetsPrerequisites(course.code);
          return (
            <div 
              key={course.id} 
              className={`elective-item ${canTake ? 'elective-eligible' : 'elective-not-eligible'}`}
              onClick={(e) => {
                e.preventDefault();
                onViewCourseDetail(course.code);
              }}
            >
              <div className="elective-main">
                <span>
                  {course.code} - {course.title} ({course.credits} credits)
                  {canTake && <span style={{ color: '#4caf50', marginLeft: '0.5rem', fontWeight: 'bold' }}>✓ Ready to take</span>}
                </span>
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
                  {getPrerequisites(course.code).map((prereq, index, array) => {
                    const normalizedPrereq = normalizeCode(prereq.code);
                    const isCompleted = Array.from(selectedCourses).some(selected => normalizeCode(selected) === normalizedPrereq);
                    return (
                      <React.Fragment key={prereq.id}>
                        <span style={{ color: isCompleted ? 'green' : 'red' }}>
                          {prereq.code}{!isCompleted && ' (Missing)'}
                        </span>
                        {index < array.length - 1 && ', '}
                      </React.Fragment>
                    );
                  })}
                </p>
              )}
              {!meetsPrerequisites(course.code) && (
                <p style={{ color: 'red' }}>Does not meet all prerequisites.</p>
              )}
            </div>
          </div>
        );
        })}
      </div>
    </div>
  );
};

export default ElectiveSelector;
