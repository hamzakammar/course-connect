import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface CourseNode {
  id: string;
  code: string;
  title: string;
  credits: number;
  description: string | null;
  subject: string;
  level: number;
  // UWFlow data (optional)
  uwflow_rating_liked?: number;
  uwflow_rating_easy?: number;
  uwflow_rating_useful?: number;
  uwflow_rating_filled_count?: number;
  uwflow_rating_comment_count?: number;
  uwflow_url?: string;
  uwflow_prereqs?: string;
  uwflow_coreqs?: string;
  uwflow_antireqs?: string;
}

export interface CourseEdge {
  source: string;
  target: string;
  type: string;
  logic: string;
}

export interface CourseSet {
  id_hint: string;
  mode: "explicit" | "selector";
  title?: string;
  selector?: Record<string, any>;
  courses: string[]; // by course code, e.g., "CS 137"
}

export interface ProgramRequirement {
  id: string;
  type: string;
  content: any;
  explanations: string[];
}

export interface ProgramLists {
  course_lists: Record<string, {
    list_name: string;
    courses: { course_id: string; code: string; title: string | null; units: string; href: string }[];
  }>;
}

export interface ProgramInfo {
  kind?: string;
  scope?: string;
  title?: string;
  catalog_year_label?: string;
  owning_faculty_code?: string;
  owning_program_codes?: string[];
  total_credits_required?: number;
  policy_ids_hints?: string[];
  root_requirement?: ProgramRequirement; // Or adjust if this is flattened
  required_by_term?: Record<string, Array<{ code: string; title: string }>>;
  course_lists?: Record<string, any>;
}

interface AppData {
  nodes: CourseNode[];
  edges: CourseEdge[];
  programInfo: ProgramInfo | null; // Overall program details
  programPlan: ProgramRequirement[]; // Array of requirements
  constraints: any[]; // Define a proper interface for constraints if needed
  courseSets: CourseSet[];
  programLists: ProgramLists | null;
}

interface AppContextType {
  appData: AppData | null;
  loading: boolean;
  error: string | null;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [appData, setAppData] = useState<AppData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [nodesResponse, edgesResponse, programPlanResponse, constraintsResponse, courseSetsResponse, programListsResponse] = await Promise.all([
          fetch('/data/nodes.json'),
          fetch('/data/edges.json'),
          fetch('/data/program_plan.json'),
          fetch('/data/constraints.json'),
          fetch('/data/course_sets.json'),
          fetch('/data/program_lists.json'),
        ]);

        const nodes: CourseNode[] = await nodesResponse.json();
        const edges: CourseEdge[] = await edgesResponse.json();
        const programPlanData = await programPlanResponse.json();
        const constraints: any[] = await constraintsResponse.json();
        const courseSets: CourseSet[] = await courseSetsResponse.json();
        const programLists: ProgramLists = await programListsResponse.json();

        const programInfo: ProgramInfo | null = programPlanData.program || null;
        const programPlan: ProgramRequirement[] = programPlanData.requirements || [];

        setAppData({ nodes, edges, programInfo, programPlan, constraints, courseSets, programLists });
      } catch (err) {
        setError('Failed to load application data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  return (
    <AppContext.Provider value={{ appData, loading, error }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppData = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppData must be used within an AppProvider');
  }
  return context;
};
