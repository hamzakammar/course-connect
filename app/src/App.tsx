import {useState, useEffect } from 'react';
import { Button, Spinner, ThemeToggle } from './components/ui';
import { useAppData } from './context/AppDataContext.tsx';
import { useAuth } from './context/AuthContext.tsx';
import { useUser } from './hooks/useUser.ts';
import TermTimeline from './components/TermTimeline.tsx';
import RequirementBoxes from './components/RequirementBoxes.tsx';
import AuditPanel from './components/AuditPanel.tsx';
import CourseDetail from './components/CourseDetail.tsx';
import SignInPage from './components/SignInPage.tsx';
import PlanManager from './components/PlanManager.tsx';
import { SavedPlan } from './hooks/usePlans.ts';
// import CourseGraph from './components/CourseGraph.tsx';
import { CourseNode } from './context/AppDataContext.tsx';
import { meetsPrerequisites, getMissingPrerequisites } from './utils/prerequisites.ts';

function App() {
  const { user, guest, isConfigured, loading: authLoading, signOut, signInWithGoogle } = useAuth();
  const { profile } = useUser();
  const { appData, loading: dataLoading, error } = useAppData();
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set());
  const [courseDetail, setCourseDetail] = useState<CourseNode | null>(null);
  const [electiveAssignments, setElectiveAssignments] = useState<Record<string, string | undefined>>({});
  // Off-term courses taken during a co-op/work term, keyed by work-term id (e.g. "W1").
  const [offTermCourses, setOffTermCourses] = useState<Record<string, string[]>>({});

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
    return <FullScreenLoader message="Loading…" />;
  }

  if (!user && !guest) {
    return <SignInPage />;
  }

  if (dataLoading) {
    return <FullScreenLoader message="Loading course data…" />;
  }

  if (error) {
    return <FullScreenError title="Error loading data" message={error} />;
  }

  if (!appData) {
    return (
      <FullScreenError
        title="No data available"
        message="No application data available. Please refresh the page."
      />
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

  const handleAddOffTermCourse = (term: string, courseCode: string) => {
    setOffTermCourses(prev => {
      const existing = prev[term] || [];
      if (existing.includes(courseCode)) return prev;
      return { ...prev, [term]: [...existing, courseCode] };
    });
  };

  const handleRemoveOffTermCourse = (term: string, courseCode: string) => {
    setOffTermCourses(prev => {
      const existing = prev[term];
      if (!existing) return prev;
      const next = existing.filter(code => code !== courseCode);
      const copy = { ...prev };
      if (next.length > 0) {
        copy[term] = next;
      } else {
        delete copy[term];
      }
      return copy;
    });
  };

  const handleViewCourseDetail = (courseCode: string) => {
    const normalizeCode = (code: string) => code.replace(/\s+/g, '').toUpperCase();
    const normalizedCode = normalizeCode(courseCode);
    
    // First, try to find in nodes
    let course = appData?.nodes.find(node => normalizeCode(node.code) === normalizedCode);
    
    // If not found, try to create from programLists
    if (!course && appData?.programLists) {
      const courseLists = appData.programLists.course_lists || {};
      for (const list of Object.values(courseLists)) {
        const courses = Array.isArray(list) ? list : (list as any)?.courses || [];
        const foundCourse = courses.find((c: { code: string }) => 
          normalizeCode(c.code) === normalizedCode
        );
        
        if (foundCourse) {
          // Create a minimal CourseNode from programLists data
          const subjectMatch = foundCourse.code.match(/^([A-Z]+)/);
          const levelMatch = foundCourse.code.match(/(\d+)/);
          const credits = foundCourse.units ? parseFloat(foundCourse.units) : 0.5;
          
          course = {
            id: foundCourse.course_id || foundCourse.code,
            code: foundCourse.code,
            title: foundCourse.title || foundCourse.code,
            credits: credits,
            description: null,
            subject: subjectMatch ? subjectMatch[1] : 'UNKNOWN',
            level: levelMatch ? parseInt(levelMatch[1], 10) : 0,
          };
          break;
        }
      }
    }
    
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
    // Backward-compatible: older plans have no offterm_courses field.
    setOffTermCourses(plan.offterm_courses || {});
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="sticky top-0 z-30 border-b border-border-strong bg-bg">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex items-baseline gap-2.5">
            <span className="h-3.5 w-3.5 shrink-0 translate-y-0.5 bg-accent" aria-hidden />
            <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
              Course Connect
            </h1>
            <span className="eyebrow hidden sm:inline">Degree Planner</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PlanManager
              selectedCourses={selectedCourses}
              electiveAssignments={electiveAssignments}
              offTermCourses={offTermCourses}
              onLoadPlan={handleLoadPlan}
            />
            <ThemeToggle />
            <div className="flex items-center gap-3 border-l border-border pl-4">
              {guest ? (
                <>
                  <span className="eyebrow hidden sm:inline">Guest</span>
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={() => {
                      if (isConfigured) {
                        signInWithGoogle().catch((e) => console.error(e));
                      } else {
                        signOut();
                      }
                    }}
                    title={isConfigured ? 'Sign in to sync your plans' : 'Return to sign-in'}
                  >
                    Sign in to sync
                  </Button>
                </>
              ) : (
                <>
                  <div className="hidden text-right leading-tight sm:block">
                    {profile && profile.name && (
                      <div className="text-sm font-medium text-text">{profile.name}</div>
                    )}
                    {user?.email && (
                      <div className="text-xs text-muted">{user.email}</div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={signOut}>
                    Sign out
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px_340px]">
          <section className="min-w-0">
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
              offTermCourses={offTermCourses}
              onAddOffTermCourse={handleAddOffTermCourse}
              onRemoveOffTermCourse={handleRemoveOffTermCourse}
            />
          </section>

          <section className="min-w-0 space-y-6">
            <RequirementBoxes
              courses={appData.nodes}
              selectedCourses={selectedCourses}
              onViewCourseDetail={handleViewCourseDetail}
              programLists={appData.programLists!}
              onCourseSelect={handleCourseSelect}
              onCourseDeselect={handleCourseDeselect}
              edges={appData.edges}
            />
            <AuditPanel
              programInfo={appData.programInfo}
              courseSets={appData.courseSets}
              programLists={appData.programLists}
              selectedCourses={selectedCourses}
              courses={appData.nodes}
            />
          </section>

          <section className="min-w-0">
            <div className="xl:sticky xl:top-[84px]">
              <CourseDetail
                course={courseDetail}
                edges={appData.edges}
                allCourses={appData.nodes}
                onViewCourseDetail={handleViewCourseDetail}
                selectedCourses={selectedCourses}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function FullScreenLoader({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg text-text">
      <Spinner size={44} />
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}

function FullScreenError({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
      <div className="mb-1 h-8 w-8 bg-accent" aria-hidden />
      <h2 className="font-display text-2xl font-semibold tracking-tight text-text">{title}</h2>
      <p className="max-w-md text-sm text-muted">{message}</p>
    </div>
  );
}

export default App;
