import React from 'react';
import { CourseNode, CourseEdge } from '../context/AppDataContext';

interface CourseDetailProps {
  course: CourseNode | null;
  edges: CourseEdge[];
  allCourses: CourseNode[]; // For looking up related course details
}

const CourseDetail: React.FC<CourseDetailProps> = ({ course, edges, allCourses }) => {
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

  const courseMap = new Map<string, CourseNode>();
  allCourses.forEach(c => courseMap.set(c.code, c));

  const getRelatedCourses = (targetCourseCode: string, relationType: string) => {
    // Edges point FROM the related course TO the target course
    // So for prerequisites of CS241, we want edges where target === CS241
    return edges.filter(edge => edge.target === targetCourseCode && edge.type === relationType)
                .map(edge => courseMap.get(edge.source))
                .filter(Boolean) as CourseNode[];
  };

  const prerequisites = getRelatedCourses(course.code, 'PREREQ');
  const corequisites = getRelatedCourses(course.code, 'COREQ');
  const exclusions = getRelatedCourses(course.code, 'ANTIREQ');

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
      {hasRatings && (
        <div>
          <h3>UWFlow Ratings</h3>
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
        </div>
      )}

      {prerequisites.length > 0 && (
        <div>
          <h3>Prerequisites:</h3>
          <ul>
            {prerequisites.map(p => <li key={p.id}>{p.code} - {p.title}</li>)}
          </ul>
        </div>
      )}
      {prerequisites.length === 0 && (
        <div>
          <h3>Prerequisites:</h3>
          <p>No prerequisites found</p>
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
