import React, { useState } from 'react';
import './App.css';
import { useAppData } from './context/AppDataContext.tsx';
import TermCourseList from './components/TermCourseList.tsx';
import ElectiveSelector from './components/ElectiveSelector.tsx';
import CourseDetail from './components/CourseDetail.tsx';
import CourseGraph from './components/CourseGraph.tsx';
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
      <div style={{ display: 'flex', justifyContent: 'space-around' }}>
        <TermCourseList
          courses={appData.nodes}
          programInfo={appData.programInfo}
          programPlan={appData.programPlan}
          courseSets={appData.courseSets}
          onViewCourseDetail={handleViewCourseDetail}
        />
        <ElectiveSelector
          courses={appData.nodes}
          edges={appData.edges}
          selectedCourses={selectedCourses}
          onCourseSelect={handleCourseSelect}
          onCourseDeselect={handleCourseDeselect}
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
      <div style={{ marginTop: '20px' }}>
        <h2>Course Graph Visualization</h2>
        <CourseGraph courses={appData.nodes} edges={appData.edges} />
      </div>
    </div>
  );
}

export default App;
