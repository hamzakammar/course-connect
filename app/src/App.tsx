import React, { useState } from 'react';
import './App.css';
import { useAppData } from './context/AppDataContext.tsx';
import TermTimeline from './components/TermTimeline.tsx';
import RequirementBoxes from './components/RequirementBoxes.tsx';
import CourseDetail from './components/CourseDetail.tsx';
// import CourseGraph from './components/CourseGraph.tsx';
import { CourseNode } from './context/AppDataContext.tsx';

function App() {
  const { appData, loading, error } = useAppData();
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [courseDetail, setCourseDetail] = useState<CourseNode | null>(null);

  if (loading) {
    return <div>Loading application data...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (!appData) {
    return <div>No application data available.</div>
  }

  const handleCourseSelect = (courseCode: string) => {
    setSelectedCourses(prev => new Set(prev).add(courseCode));
  };

  const handleCourseDeselect = (courseCode: string) => {
    setSelectedCourses(prev => {
      const newSet = new Set(prev);
      newSet.delete(courseCode);
      return newSet;
    });
  };

  const handleViewCourseDetail = (courseCode: string) => {
    const course = appData?.nodes.find(node => node.code === courseCode);
    if (course) {
      setCourseDetail(course);
    }
  };

  return (
    <div className="App">
      <h1>Course Connect Planner</h1>
      
      <div className="main-content">
        <div className="left-panel">
          <TermTimeline
            courses={appData.nodes}
            programInfo={appData.programInfo}
            courseSets={appData.courseSets}
            selectedCourses={selectedCourses}
            onViewCourseDetail={handleViewCourseDetail}
            onCourseSelect={handleCourseSelect}
            onCourseDeselect={handleCourseDeselect}
          />
        </div>
        
        <div className="right-panel">
          <RequirementBoxes
            courses={appData.nodes}
            courseSets={appData.courseSets}
            programPlan={appData.programPlan}
            selectedCourses={selectedCourses}
            onViewCourseDetail={handleViewCourseDetail}
          />
          
          {courseDetail && (
            <CourseDetail
              course={courseDetail}
              edges={appData.edges}
              allCourses={appData.nodes}
            />
          )}
        </div>
      </div>
      
      {/* <div style={{ marginTop: '40px', clear: 'both' }}>
        <h2>Course Graph Visualization</h2>
        <CourseGraph courses={appData.nodes} edges={appData.edges} />
      </div> */}
    </div>
  );
}

export default App;
