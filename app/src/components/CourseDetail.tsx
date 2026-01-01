import React from 'react';
import { CourseNode, CourseEdge } from '../context/AppDataContext';

interface CourseDetailProps {
  course: CourseNode | null;
  edges: CourseEdge[];
  allCourses: CourseNode[]; // For looking up related course details
  onViewCourseDetail?: (courseCode: string) => void; // Optional callback to view related courses
  selectedCourses?: Set<string>; // Courses that are selected/completed
}

const CourseDetail: React.FC<CourseDetailProps> = ({ course, edges, allCourses, onViewCourseDetail, selectedCourses = new Set() }) => {
  // Show placeholder if no course is selected
  if (!course) {
    return (
      <div className="course-detail">
        <h2>Course Details</h2>
        <p style={{ color: '#666', fontStyle: 'italic' }}>
          Select a course to view details, prerequisites, and ratings.
        </p>
      </div>
    );
  }
  // Debug: log course data to see if UWFlow fields are present
  console.log('CourseDetail - course data:', {
    code: course.code,
    hasLiked: 'uwflow_rating_liked' in course,
    liked: course.uwflow_rating_liked,
    hasEasy: 'uwflow_rating_easy' in course,
    easy: course.uwflow_rating_easy,
  });

  // Normalize course codes for matching (remove spaces, uppercase)
  const normalizeCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();
  
  // Helper function to check if a course is selected, normalizing both sides for comparison
  const isCourseSelected = (courseCode: string): boolean => {
    const normalizedCode = normalizeCode(courseCode);
    return Array.from(selectedCourses).some(
      selected => normalizeCode(selected) === normalizedCode
    );
  };
  
  // Create normalized maps for lookups
  const courseMap = new Map<string, CourseNode>();
  const normalizedCourseMap = new Map<string, CourseNode>();
  allCourses.forEach(c => {
    courseMap.set(c.code, c);
    normalizedCourseMap.set(normalizeCode(c.code), c);
  });

  interface RelatedCourseWithEdge {
    course: CourseNode | { code: string; title: string; id: string };
    logic?: string;
    groupId?: string;
  }

  const getRelatedCourses = (targetCourseCode: string, relationType: string): RelatedCourseWithEdge[] => {
    // Normalize the target course code for matching
    const normalizedTarget = normalizeCode(targetCourseCode);
    
    // Edges point FROM the related course TO the target course
    // So for prerequisites of CS241, we want edges where target === CS241
    // Normalize both edge.target and edge.source for matching
    const matchingEdges = edges.filter(edge => 
      normalizeCode(edge.target) === normalizedTarget && 
      edge.type === relationType
    );
    
    // Try to find full course details, but also include codes we can't find
    const relatedCourses: RelatedCourseWithEdge[] = [];
    const foundCodes = new Set<string>();
    
    for (const edge of matchingEdges) {
      const normalizedSource = normalizeCode(edge.source);
      const course = normalizedCourseMap.get(normalizedSource);
      
      if (!foundCodes.has(normalizedSource)) {
        let courseData: CourseNode;
        if (course) {
          courseData = course;
        } else {
          // Include course code even if we don't have full details
          courseData = {
            code: edge.source,
            title: edge.source, // Fallback to code as title
            id: `missing-${edge.source}`,
          } as CourseNode;
        }
        
        relatedCourses.push({
          course: courseData,
          logic: edge.logic,
          groupId: edge.group_id,
        });
        foundCodes.add(normalizedSource);
      }
    }
    
    return relatedCourses;
  };

  const prerequisites = getRelatedCourses(course.code, 'PREREQ');
  const corequisites = getRelatedCourses(course.code, 'COREQ');
  const exclusions = getRelatedCourses(course.code, 'ANTIREQ');
  
  // Use corequisites as-is (data should be correct)
  const filteredCorequisites = corequisites;

  // Group related courses by group_id when logic is "ANY" (one of)
  // Also handle "ALL" groups that should be split (e.g., CS349 with CS241/CS241E and MATH options)
  const groupRelatedCourses = (relatedCourses: RelatedCourseWithEdge[]) => {
    const groups: Map<string, RelatedCourseWithEdge[]> = new Map();
    const ungrouped: RelatedCourseWithEdge[] = [];
    
    // First pass: group by "ANY" logic
    for (const item of relatedCourses) {
      if (item.logic === 'ANY' && item.groupId) {
        if (!groups.has(item.groupId)) {
          groups.set(item.groupId, []);
        }
        groups.get(item.groupId)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }
    
    // Second pass: detect "ALL" groups that should be split into "ANY" subgroups
    // This handles cases like CS349 where prerequisites are incorrectly all in one "ALL" group
    // Pattern: if an "ALL" group has courses with similar codes (e.g., CS241/CS241E, MATH115/MATH136/MATH146),
    // split them into logical "ANY" groups
    const allGroups = new Map<string, RelatedCourseWithEdge[]>();
    for (const item of ungrouped) {
      if (item.logic === 'ALL' && item.groupId) {
        if (!allGroups.has(item.groupId)) {
          allGroups.set(item.groupId, []);
        }
        allGroups.get(item.groupId)!.push(item);
      }
    }
    
      // Try to intelligently split "ALL" groups
      for (const [groupId, items] of allGroups.entries()) {
        // Group by subject code prefix (e.g., CS, MATH)
        const bySubject = new Map<string, RelatedCourseWithEdge[]>();
        for (const item of items) {
          const subject = item.course.code.match(/^[A-Z]+/)?.[0] || 'OTHER';
          if (!bySubject.has(subject)) {
            bySubject.set(subject, []);
          }
          bySubject.get(subject)!.push(item);
        }
        
        // If we have multiple subjects or courses that look like alternatives (similar numbers),
        // create "ANY" groups for each subject set
        if (bySubject.size > 1) {
          // Multiple subjects - create separate "ANY" groups
          let groupIndex = 0;
          const itemsToRemove = new Set<RelatedCourseWithEdge>();
          for (const [, subjectItems] of bySubject.entries()) {
            if (subjectItems.length > 1) {
              // Multiple courses in same subject - likely alternatives
              const newGroupId = `${groupId}_any_${groupIndex++}`;
              groups.set(newGroupId, subjectItems);
              subjectItems.forEach(item => itemsToRemove.add(item));
            }
          }
          // Remove grouped items from ungrouped
          itemsToRemove.forEach(item => {
            const idx = ungrouped.indexOf(item);
            if (idx >= 0) ungrouped.splice(idx, 1);
          });
        } else if (items.length > 2) {
          // Same subject but multiple courses - check if they look like alternatives
          // (e.g., CS241/CS241E or MATH115/136/146)
          const numbers = items.map(item => item.course.code.match(/\d+/)?.[0]).filter(Boolean);
          const uniqueNumbers = new Set(numbers);
          
          // If all have same number base or are sequential, treat as "ANY" group
          if (uniqueNumbers.size <= 2 || numbers.length > 2) {
            const newGroupId = `${groupId}_any_0`;
            groups.set(newGroupId, items);
            // Remove from ungrouped
            items.forEach(item => {
              const idx = ungrouped.indexOf(item);
              if (idx >= 0) ungrouped.splice(idx, 1);
            });
          }
        }
      }
    
    return { groups, ungrouped };
  };

  const prereqGroups = groupRelatedCourses(prerequisites);
  const coreqGroups = groupRelatedCourses(filteredCorequisites);

  const formatRating = (rating: number | undefined) => {
    if (rating === undefined || rating === null) return 'N/A';
    return `${(rating * 100).toFixed(0)}%`;
  };

  // Check if course has UWFlow ratings
  const hasRatings = course.uwflow_rating_liked != null || 
                     course.uwflow_rating_easy != null || 
                     course.uwflow_rating_useful != null;

  return (
    <div className="course-detail">
      <h2>{course.code} - {course.title}</h2>
      <p><strong>Credits:</strong> {course.credits}</p>
      <p><strong>Subject:</strong> {course.subject}</p>
      <p><strong>Level:</strong> {course.level}</p>
      {course.description && (
        <p><strong>Description:</strong> {course.description}</p>
      )}

      {/* UWFlow Ratings */}
      <div>
        <h3>UWFlow Ratings</h3>
        {hasRatings ? (
          <>
            {course.uwflow_rating_liked != null && (
              <p>
                <strong>Liked:</strong> {formatRating(course.uwflow_rating_liked)}
                {course.uwflow_rating_filled_count != null && (
                  <span style={{ color: '#666', fontSize: '0.9em' }}>
                    {' '}({course.uwflow_rating_filled_count} responses)
                  </span>
                )}
              </p>
            )}
            {course.uwflow_rating_easy != null && (
              <p>
                <strong>Easy:</strong> {formatRating(course.uwflow_rating_easy)}
              </p>
            )}
            {course.uwflow_rating_useful != null && (
              <p>
                <strong>Useful:</strong> {formatRating(course.uwflow_rating_useful)}
              </p>
            )}
            {course.uwflow_url && (
              <p>
                <a href={course.uwflow_url} target="_blank" rel="noopener noreferrer" style={{ color: '#0066cc' }}>
                  View on UWFlow →
                </a>
              </p>
            )}
          </>
        ) : (
          <p style={{ color: '#666', fontStyle: 'italic' }}>
            No UWFlow ratings available for this course.
          </p>
        )}
      </div>

      <div>
        <h3>Prerequisites:</h3>
        {prerequisites.length > 0 || prereqGroups.groups.size > 0 ? (
          <ul>
            {/* Render "one of" groups */}
            {Array.from(prereqGroups.groups.entries()).map(([groupId, groupItems]) => {
              // Check if any course in this "one of" group is completed
              const isFulfilled = groupItems.some(item => isCourseSelected(item.course.code));
              return (
              <li key={groupId} style={{ marginBottom: '0.5rem' }}>
                <strong style={{ 
                  color: isFulfilled ? '#4caf50' : '#4a90e2', 
                  backgroundColor: isFulfilled ? '#e8f5e9' : 'transparent', 
                  padding: isFulfilled ? '0.2rem 0.5rem' : '0',
                  borderRadius: isFulfilled ? '4px' : '0',
                  display: isFulfilled ? 'inline-block' : 'inline',
                  fontWeight: isFulfilled ? 'bold' : 'normal'
                }}>
                  One of:{isFulfilled && ' ✓'}
                </strong>
                <ul style={{ marginTop: '0.25rem', marginLeft: '1.5rem', listStyle: 'disc' }}>
                  {groupItems.map((item, idx) => {
                    const isCompleted = isCourseSelected(item.course.code);
                    return (
                      <li key={`${groupId}-${idx}`}>
                        {onViewCourseDetail ? (
                          <a 
                            href="#" 
                            onClick={(e) => {
                              e.preventDefault();
                              onViewCourseDetail(item.course.code);
                            }}
                            style={{ 
                              color: isCompleted ? '#4caf50' : '#0066cc', 
                              textDecoration: 'underline', 
                              cursor: 'pointer',
                              fontWeight: isCompleted ? 'bold' : 'normal'
                            }}
                          >
                            {item.course.code} - {item.course.title}
                            {isCompleted && ' ✓'}
                          </a>
                        ) : (
                          <span style={{ color: isCompleted ? '#4caf50' : 'inherit', fontWeight: isCompleted ? 'bold' : 'normal' }}>
                            {item.course.code} - {item.course.title}
                            {isCompleted && ' ✓'}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            )}
            )}
            {/* Render ungrouped prerequisites */}
            {prereqGroups.ungrouped.map(p => {
              const isCompleted = isCourseSelected(p.course.code);
              return (
                <li key={p.course.id}>
                  {onViewCourseDetail ? (
                    <a 
                      href="#" 
                      onClick={(e) => {
                        e.preventDefault();
                        onViewCourseDetail(p.course.code);
                      }}
                      style={{ 
                        color: isCompleted ? '#4caf50' : '#0066cc', 
                        textDecoration: 'underline', 
                        cursor: 'pointer',
                        fontWeight: isCompleted ? 'bold' : 'normal'
                      }}
                    >
                      {p.course.code} - {p.course.title}
                      {isCompleted && ' ✓'}
                    </a>
                  ) : (
                    <span style={{ color: isCompleted ? '#4caf50' : 'inherit', fontWeight: isCompleted ? 'bold' : 'normal' }}>
                      {p.course.code} - {p.course.title}
                      {isCompleted && ' ✓'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p style={{ color: '#666', fontStyle: 'italic' }}>No prerequisites found</p>
        )}
      </div>

      <div>
        <h3>Corequisites:</h3>
        {filteredCorequisites.length > 0 || coreqGroups.groups.size > 0 ? (
          <ul>
            {/* Render "one of" groups */}
            {Array.from(coreqGroups.groups.entries()).map(([groupId, groupItems]) => {
              // Check if any course in this "one of" group is completed
              const isFulfilled = groupItems.some(item => isCourseSelected(item.course.code));
              return (
              <li key={groupId} style={{ marginBottom: '0.5rem' }}>
                <strong style={{ 
                  color: isFulfilled ? '#4caf50' : '#4a90e2', 
                  backgroundColor: isFulfilled ? '#e8f5e9' : 'transparent', 
                  padding: isFulfilled ? '0.2rem 0.5rem' : '0',
                  borderRadius: isFulfilled ? '4px' : '0',
                  display: isFulfilled ? 'inline-block' : 'inline',
                  fontWeight: isFulfilled ? 'bold' : 'normal'
                }}>
                  One of:{isFulfilled && ' ✓'}
                </strong>
                <ul style={{ marginTop: '0.25rem', marginLeft: '1.5rem', listStyle: 'disc' }}>
                  {groupItems.map((item, idx) => (
                    <li key={`${groupId}-${idx}`}>
                      {onViewCourseDetail ? (
                        <a 
                          href="#" 
                          onClick={(e) => {
                            e.preventDefault();
                            onViewCourseDetail(item.course.code);
                          }}
                          style={{ color: '#0066cc', textDecoration: 'underline', cursor: 'pointer' }}
                        >
                          {item.course.code} - {item.course.title}
                        </a>
                      ) : (
                        <span>{item.course.code} - {item.course.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            )}
            )}
            {/* Render ungrouped corequisites */}
            {coreqGroups.ungrouped.map(c => (
              <li key={c.course.id}>
                {onViewCourseDetail ? (
                  <a 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault();
                      onViewCourseDetail(c.course.code);
                    }}
                    style={{ color: '#0066cc', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {c.course.code} - {c.course.title}
                  </a>
                ) : (
                  <span>{c.course.code} - {c.course.title}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#666', fontStyle: 'italic' }}>No corequisites found</p>
        )}
      </div>

      <div>
        <h3>Antirequisites (Exclusions):</h3>
        {exclusions.length > 0 ? (
          <ul>
            {/* Antirequisites are always shown as a flat list (no "one of" grouping) */}
            {exclusions.map(excl => (
              <li key={excl.course.id}>
                {onViewCourseDetail ? (
                  <a 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault();
                      onViewCourseDetail(excl.course.code);
                    }}
                    style={{ color: '#0066cc', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {excl.course.code} - {excl.course.title}
                  </a>
                ) : (
                  <span>{excl.course.code} - {excl.course.title}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: '#666', fontStyle: 'italic' }}>No antirequisites found</p>
        )}
      </div>
    </div>
  );
};

export default CourseDetail;
