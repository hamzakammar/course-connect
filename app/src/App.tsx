import {useState, useEffect } from 'react';
import './App.css';
import { useAppData } from './context/AppDataContext.tsx';
import { useAuth } from './context/AuthContext.tsx';
import { useUser } from './hooks/useUser.ts';
import TermTimeline from './components/TermTimeline.tsx';
import RequirementBoxes from './components/RequirementBoxes.tsx';
import CourseDetail from './components/CourseDetail.tsx';
import SignInPage from './components/SignInPage.tsx';
import PlanManager from './components/PlanManager.tsx';
import { SavedPlan } from './hooks/usePlans.ts';
// import CourseGraph from './components/CourseGraph.tsx';
import { CourseNode } from './context/AppDataContext.tsx';
import { meetsPrerequisites, getMissingPrerequisites } from './utils/prerequisites.ts';

function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile } = useUser();
  const { appData, loading: dataLoading, error } = useAppData();
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [courseDetail, setCourseDetail] = useState<CourseNode | null>(null);
  const [electiveAssignments, setElectiveAssignments] = useState<Record<string, string | undefined>>({});

  // On initial load, pre-select all required courses from the program plan
  useEffect(() => {
    if (!appData || !appData.programInfo) return;
    setSelectedCourses(prev => {
      // Don't overwrite if user has already made selections
      if (prev.size > 0) return prev;

      const next = new Set<string>(prev);
      const requiredByTerm = appData.programInfo!.required_by_term as
        | Record<string, { code: string }[]>
        | undefined;

      if (!requiredByTerm) return prev;

      Object.values(requiredByTerm).forEach(termCourses => {
        termCourses.forEach(course => {
          if (course?.code) {
            next.add(course.code);
          }
        });
      });

      return next;
    });
  }, [appData]);

  // Show sign in page if not authenticated
  if (authLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <SignInPage />;
  }

  if (dataLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading course data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h2>Error Loading Data</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!appData) {
    return (
      <div className="error-container">
        <h2>No Data Available</h2>
        <p>No application data available. Please refresh the page.</p>
      </div>
    );
  }

  const getCourseCredits = (courseCode: string): number => {
    const course = appData?.nodes.find(node => node.code === courseCode);
    if (course && course.credits > 0) {
      return course.credits;
    }
    // Fallback to programLists if course not found or has 0 credits
    if (appData?.programLists) {
      const normalizeCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();
      const normalizedCode = normalizeCode(courseCode);
      for (const list of Object.values(appData.programLists.course_lists || {})) {
        for (const c of list.courses || []) {
          if (normalizeCode(c.code) === normalizedCode && c.units) {
            const units = parseFloat(c.units);
            if (!isNaN(units) && units > 0) {
              return units;
            }
          }
        }
      }
    }
    return 0;
  };

  const computeTermCredits = (term: string, selected: Set<string>): number => {
    if (!appData || !appData.programInfo) return 0;

    let total = 0;
    const requiredByTerm = appData.programInfo.required_by_term || {};

    // Required courses in term
    (requiredByTerm[term] || []).forEach(course => {
      if (selected.has(course.code)) {
        total += getCourseCredits(course.code);
      }
    });

    // ANY requirements in term (count just one selected)
    const anySets = appData.courseSets.filter(cs =>
      cs.id_hint && cs.id_hint.match(new RegExp(`^req_term_${term.toLowerCase()}_any`))
    );
    anySets.forEach(cs => {
      const selectedAny = cs.courses.find(code => selected.has(code));
      if (selectedAny) {
        total += getCourseCredits(selectedAny);
      }
    });

    // Electives explicitly assigned to this term
    Object.entries(electiveAssignments).forEach(([code, assignedTerm]) => {
      if (assignedTerm === term && selected.has(code)) {
        total += getCourseCredits(code);
      }
    });

    return total;
  };

  const handleCourseSelect = (courseCode: string, term?: string) => {
    // Check prerequisites before allowing selection
    if (!meetsPrerequisites(courseCode, appData.edges, selectedCourses)) {
      const missing = getMissingPrerequisites(courseCode, appData.edges, selectedCourses);
      const missingList = missing.length > 0 
        ? missing.slice(0, 5).join(', ') + (missing.length > 5 ? '...' : '')
        : 'prerequisites';
      window.alert(
        `Cannot select ${courseCode}: Prerequisites not met.\n\nMissing: ${missingList}\n\nPlease select the required prerequisites first.`
      );
      return;
    }

    setSelectedCourses(prev => {
      const next = new Set(prev);
      if (next.has(courseCode)) return prev;
      next.add(courseCode);

      if (term && appData) {
        // Check if this course is a required course (ALL requirement) for this term
        const requiredByTerm = appData.programInfo?.required_by_term || {};
        const termRequiredCourses = requiredByTerm[term] || [];
        const isRequiredCourse = termRequiredCourses.some(c => c.code === courseCode);
        
        // Check if this course is part of an ANY requirement for this term
        const anySets = appData.courseSets.filter(cs =>
          cs.id_hint && cs.id_hint.match(new RegExp(`^req_term_${term.toLowerCase()}_any`))
        );
        const isAnyRequirement = anySets.some(cs => cs.courses.includes(courseCode));
        
        // Only add to electiveAssignments if it's NOT a required course and NOT an ANY requirement
        if (!isRequiredCourse && !isAnyRequirement) {
          const termCreditsBefore = computeTermCredits(term, prev);
          const addedCredits = getCourseCredits(courseCode);
          if (termCreditsBefore + addedCredits > 3.0 + 1e-6) {
            window.alert(`Cannot add ${courseCode} to ${term}: this would exceed 3.0 credits in that term.`);
            return prev;
          }
          setElectiveAssignments(prevAssign => ({
            ...prevAssign,
            [courseCode]: term,
          }));
        } else {
          // If it's a required course or ANY requirement, ensure it's NOT in electiveAssignments
          setElectiveAssignments(prevAssign => {
            if (courseCode in prevAssign) {
              const copy = { ...prevAssign };
              delete copy[courseCode];
              return copy;
            }
            return prevAssign;
          });
        }
      }

      return next;
    });
  };

  const handleCourseDeselect = (courseCode: string, _term?: string) => {
    setSelectedCourses(prev => {
      const next = new Set(prev);
      next.delete(courseCode);
      return next;
    });
    setElectiveAssignments(prev => {
      if (!(courseCode in prev)) return prev;
      const copy = { ...prev };
      delete copy[courseCode];
      return copy;
    });
  };

  const handleViewCourseDetail = (courseCode: string) => {
    const normalizeCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();
    const normalizedCode = normalizeCode(courseCode);
    const course = appData?.nodes.find(node => normalizeCode(node.code) === normalizedCode);
    if (course) {
      setCourseDetail(course);
    } else {
      console.warn(`Course not found: ${courseCode} (normalized: ${normalizedCode})`);
    }
  };

  const handleLoadPlan = (plan: SavedPlan) => {
    setSelectedCourses(new Set(plan.selected_courses));
    // Convert to Record<string, string | undefined> format
    const converted: Record<string, string | undefined> = {};
    Object.entries(plan.elective_assignments).forEach(([key, value]) => {
      converted[key] = value;
    });
    setElectiveAssignments(converted);
  };

  return (
    <div className="App">
      <div className="app-header">
        <h1>Course Connect Planner</h1>
        <div className="header-right">
          <div className="plan-manager-compact">
            <PlanManager
              selectedCourses={selectedCourses}
              electiveAssignments={electiveAssignments}
              onLoadPlan={handleLoadPlan}
            />
          </div>
          <div className="user-info">
            {profile && profile.name && (
              <span className="user-name">{profile.name}</span>
            )}
            <span className="user-email">{user.email}</span>
            <button className="sign-out-button" onClick={signOut}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
      
      <div className="main-content">
        <div className="content-panels">
          <div className="left-panel">
          <TermTimeline
            courses={appData.nodes}
            programInfo={appData.programInfo}
            courseSets={appData.courseSets}
            selectedCourses={selectedCourses}
            onViewCourseDetail={handleViewCourseDetail}
            onCourseSelect={handleCourseSelect}
            onCourseDeselect={handleCourseDeselect}
            electiveAssignments={electiveAssignments}
            programLists={appData.programLists}
            edges={appData.edges}
          />
          </div>
          
          <div className="middle-panel">
            <RequirementBoxes
              courses={appData.nodes}
              selectedCourses={selectedCourses}
              onViewCourseDetail={handleViewCourseDetail}
              programLists={appData.programLists!}
              onCourseSelect={handleCourseSelect}
              onCourseDeselect={handleCourseDeselect}
              edges={appData.edges}
            />
          </div>
          
          <div className="rightmost-panel">
            <CourseDetail
              course={courseDetail}
              edges={appData.edges}
              allCourses={appData.nodes}
              onViewCourseDetail={handleViewCourseDetail}
              selectedCourses={selectedCourses}
            />
          </div>
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
