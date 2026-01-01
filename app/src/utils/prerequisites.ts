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
  // - "ALL" groups that should be split into "ANY" subgroups (incorrectly grouped data)
  // - mandatory prerequisites (must all be satisfied)
  const anyGroups = new Map<string, typeof prereqEdges>();
  const allGroups = new Map<string, typeof prereqEdges>();
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
    } else if (logic === 'ALL' && rawGroupId != null) {
      const groupKey = String(rawGroupId);
      const existingGroup = allGroups.get(groupKey) || [];
      existingGroup.push(edge);
      allGroups.set(groupKey, existingGroup);
    } else {
      mandatoryEdges.push(edge);
    }
  }

  // Handle "ALL" groups that should be split (e.g., CS349 with CS241/CS241E and MATH options)
  for (const [groupId, items] of allGroups.entries()) {
    if (items.length <= 1) {
      // Single item in ALL group - treat as mandatory
      mandatoryEdges.push(...items);
      continue;
    }

    // Group by subject code prefix (e.g., CS, MATH)
    const bySubject = new Map<string, typeof items>();
    for (const item of items) {
      const subject = item.source.match(/^[A-Z]+/)?.[0] || 'OTHER';
      if (!bySubject.has(subject)) {
        bySubject.set(subject, []);
      }
      bySubject.get(subject)!.push(item);
    }

    // If multiple subjects, split into "ANY" groups
    if (bySubject.size > 1) {
      let groupIndex = 0;
      for (const [, subjectItems] of bySubject.entries()) {
        if (subjectItems.length > 1) {
          // Multiple courses in same subject - create "ANY" group
          const newGroupKey = `${groupId}_any_${groupIndex++}`;
          anyGroups.set(newGroupKey, subjectItems);
        } else if (subjectItems.length === 1) {
          // Single course in subject - treat as mandatory
          mandatoryEdges.push(subjectItems[0]);
        }
      }
    } else if (items.length > 2) {
      // Same subject but multiple courses - check if they look like alternatives
      const numbers = items.map(item => item.source.match(/\d+/)?.[0]).filter(Boolean);
      const uniqueNumbers = new Set(numbers);
      
      // If courses have similar numbers, treat as "ANY" group
      if (uniqueNumbers.size <= 2 || numbers.length > 2) {
        const newGroupKey = `${groupId}_any_0`;
        anyGroups.set(newGroupKey, items);
      } else {
        // Different numbers - treat as mandatory
        mandatoryEdges.push(...items);
      }
    } else {
      // Small ALL group - treat as mandatory
      mandatoryEdges.push(...items);
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
  
  // Use the same grouping logic as meetsPrerequisites
  const anyGroups = new Map<string, typeof prereqEdges>();
  const allGroups = new Map<string, typeof prereqEdges>();
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
    } else if (logic === 'ALL' && rawGroupId != null) {
      const groupKey = String(rawGroupId);
      const existingGroup = allGroups.get(groupKey) || [];
      existingGroup.push(edge);
      allGroups.set(groupKey, existingGroup);
    } else {
      mandatoryEdges.push(edge);
    }
  }

  // Handle "ALL" groups that should be split (same logic as meetsPrerequisites)
  for (const [groupId, items] of allGroups.entries()) {
    if (items.length <= 1) {
      mandatoryEdges.push(...items);
      continue;
    }

    const bySubject = new Map<string, typeof items>();
    for (const item of items) {
      const subject = item.source.match(/^[A-Z]+/)?.[0] || 'OTHER';
      if (!bySubject.has(subject)) {
        bySubject.set(subject, []);
      }
      bySubject.get(subject)!.push(item);
    }

    if (bySubject.size > 1) {
      let groupIndex = 0;
      for (const [, subjectItems] of bySubject.entries()) {
        if (subjectItems.length > 1) {
          const newGroupKey = `${groupId}_any_${groupIndex++}`;
          anyGroups.set(newGroupKey, subjectItems);
        } else if (subjectItems.length === 1) {
          mandatoryEdges.push(subjectItems[0]);
        }
      }
    } else if (items.length > 2) {
      const numbers = items.map(item => item.source.match(/\d+/)?.[0]).filter(Boolean);
      const uniqueNumbers = new Set(numbers);
      if (uniqueNumbers.size <= 2 || numbers.length > 2) {
        const newGroupKey = `${groupId}_any_0`;
        anyGroups.set(newGroupKey, items);
      } else {
        mandatoryEdges.push(...items);
      }
    } else {
      mandatoryEdges.push(...items);
    }
  }
  
  // Check mandatory prerequisites
  for (const edge of mandatoryEdges) {
    if (!isCourseSelected(edge.source)) {
      missing.push(edge.source);
    }
  }

  // For ANY groups, check if at least one is selected
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

