import { CourseEdge } from '../context/AppDataContext';

/**
 * Normalize course code for matching (remove spaces, uppercase)
 */
export const normalizeCode = (code: string): string => {
  return code.replace(/\s+/g, '').toUpperCase();
};

/**
 * Check if a course meets all prerequisites
 * @param courseCode - The course code to check
 * @param edges - All course edges (prerequisites, corequisites, etc.)
 * @param selectedCourses - Set of selected course codes
 * @returns true if all prerequisites are met, false otherwise
 */
export const meetsPrerequisites = (
  courseCode: string,
  edges: CourseEdge[],
  selectedCourses: Set<string>
): boolean => {
  if (!edges || edges.length === 0) return true; // No edges means no prerequisite info
  
  const normalizedTarget = normalizeCode(courseCode);
  const prereqEdges = edges.filter(edge => {
    const normalizedEdgeTarget = normalizeCode(edge.target);
    return normalizedEdgeTarget === normalizedTarget && edge.type === 'PREREQ';
  });
  
  if (prereqEdges.length === 0) return true; // No prerequisites

  // Helper: check if a given course code is selected (using normalized comparison)
  const isCourseSelected = (code: string): boolean => {
    const normalizedPrereqCode = normalizeCode(code);
    return Array.from(selectedCourses).some(
      selected => normalizeCode(selected) === normalizedPrereqCode
    );
  };

  // Separate prerequisites into:
  // - "ANY" groups (one-of within each group_id)
  // - mandatory prerequisites (must all be satisfied)
  const anyGroups = new Map<string, typeof prereqEdges>();
  const mandatoryEdges: typeof prereqEdges = [];
  
  for (const edge of prereqEdges) {
    const edgeAny = edge as any;
    const logic = edgeAny.logic as string | undefined;
    const rawGroupId = edgeAny.group_id ?? edgeAny.groupId;
    if (logic === 'ANY' && rawGroupId != null) {
      const groupKey = String(rawGroupId);
      const existingGroup = anyGroups.get(groupKey) || [];
      existingGroup.push(edge);
      anyGroups.set(groupKey, existingGroup);
    } else {
      mandatoryEdges.push(edge);
    }
  }

  // All mandatory prerequisites must be satisfied
  const mandatorySatisfied = mandatoryEdges.every(edge =>
    isCourseSelected(edge.source)
  );
  if (!mandatorySatisfied) {
    return false;
  }

  // For each "ANY" group, at least one prerequisite in the group must be satisfied
  for (const groupEdges of anyGroups.values()) {
    const groupSatisfied = groupEdges.some(edge =>
      isCourseSelected(edge.source)
    );
    if (!groupSatisfied) {
      return false;
    }
  }

  return true;
};

/**
 * Get missing prerequisites for a course
 * @param courseCode - The course code to check
 * @param edges - All course edges
 * @param selectedCourses - Set of selected course codes
 * @returns Array of missing prerequisite course codes
 */
export const getMissingPrerequisites = (
  courseCode: string,
  edges: CourseEdge[],
  selectedCourses: Set<string>
): string[] => {
  if (!edges || edges.length === 0) return [];
  
  const normalizedTarget = normalizeCode(courseCode);
  const prereqEdges = edges.filter(edge => {
    const normalizedEdgeTarget = normalizeCode(edge.target);
    return normalizedEdgeTarget === normalizedTarget && edge.type === 'PREREQ';
  });
  
  if (prereqEdges.length === 0) return [];

  const isCourseSelected = (code: string): boolean => {
    const normalizedPrereqCode = normalizeCode(code);
    return Array.from(selectedCourses).some(
      selected => normalizeCode(selected) === normalizedPrereqCode
    );
  };

  const missing: string[] = [];
  
  // Check mandatory prerequisites
  for (const edge of prereqEdges) {
    const edgeAny = edge as any;
    const logic = edgeAny.logic as string | undefined;
    const rawGroupId = edgeAny.group_id ?? edgeAny.groupId;
    
    // Only check mandatory prerequisites (not ANY groups)
    if (!(logic === 'ANY' && rawGroupId != null)) {
      if (!isCourseSelected(edge.source)) {
        missing.push(edge.source);
      }
    }
  }

  // For ANY groups, check if at least one is selected
  const anyGroups = new Map<string, typeof prereqEdges>();
  for (const edge of prereqEdges) {
    const edgeAny = edge as any;
    const logic = edgeAny.logic as string | undefined;
    const rawGroupId = edgeAny.group_id ?? edgeAny.groupId;
    if (logic === 'ANY' && rawGroupId != null) {
      const groupKey = String(rawGroupId);
      const existingGroup = anyGroups.get(groupKey) || [];
      existingGroup.push(edge);
      anyGroups.set(groupKey, existingGroup);
    }
  }

  for (const groupEdges of anyGroups.values()) {
    const groupSatisfied = groupEdges.some(edge =>
      isCourseSelected(edge.source)
    );
    if (!groupSatisfied) {
      // Add all courses in the group as missing (user needs at least one)
      groupEdges.forEach(edge => {
        if (!missing.includes(edge.source)) {
          missing.push(edge.source);
        }
      });
    }
  }

  return missing;
};

