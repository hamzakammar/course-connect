import React, { useMemo } from 'react';
import { CourseNode, ProgramInfo, CourseSet, ProgramLists } from '../context/AppDataContext';
import { normalizeCode } from '../utils/prerequisites';
import { buildAuditReport, type RequirementResult, type RequirementStatus } from '../audit';

interface AuditPanelProps {
  programInfo: ProgramInfo | null;
  courseSets: CourseSet[];
  programLists: ProgramLists | null;
  selectedCourses: Set<string>;
  courses: CourseNode[];
}

// Minimal, self-contained styling only. Visual polish lives on the design-system branch.
const STATUS_META: Record<RequirementStatus, { label: string; icon: string; color: string }> = {
  met: { label: 'Met', icon: '✓', color: '#2e7d32' },
  partial: { label: 'Partial', icon: '◐', color: '#ed6c02' },
  unmet: { label: 'Unmet', icon: '○', color: '#c62828' },
  unverified: { label: 'Unverified', icon: '?', color: '#6b7280' },
};

const AuditPanel: React.FC<AuditPanelProps> = ({
  programInfo,
  courseSets,
  programLists,
  selectedCourses,
  courses,
}) => {
  // Units lookup from course nodes, falling back to program_lists units strings.
  const credits = useMemo(() => {
    const byCode = new Map<string, number>();
    courses.forEach(c => {
      if (c.credits > 0) byCode.set(normalizeCode(c.code), c.credits);
    });
    Object.values(programLists?.course_lists || {}).forEach(list => {
      const entries = Array.isArray(list) ? list : (list as any)?.courses || [];
      entries.forEach((c: { code: string; units?: string }) => {
        const code = normalizeCode(c.code);
        if (!byCode.has(code) && c.units) {
          const u = parseFloat(c.units);
          if (!isNaN(u) && u > 0) byCode.set(code, u);
        }
      });
    });
    return (code: string) => byCode.get(normalizeCode(code)) ?? 0;
  }, [courses, programLists]);

  const report = useMemo(
    () => buildAuditReport(programInfo, courseSets, programLists, selectedCourses, credits),
    [programInfo, courseSets, programLists, selectedCourses, credits],
  );

  const { summary, results } = report;

  const renderCounts = (r: RequirementResult): string => {
    if (r.kind === 'unit-total') return `${r.have} / ${r.need} units`;
    if (r.kind === 'unverified') return '—';
    return `${r.have} / ${r.need}`;
  };

  return (
    <div className="audit-panel">
      <h2>Requirement Audit</h2>
      <p style={{ fontSize: '0.9em', color: '#555', margin: '0 0 0.75rem 0' }}>
        {summary.met} met · {summary.partial} partial · {summary.unmet} unmet · {summary.unverified} unverified
        {' '}({summary.total} total)
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {results.map(r => {
          const meta = STATUS_META[r.status];
          return (
            <li
              key={r.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: '0.5rem',
                padding: '0.4rem 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span style={{ color: meta.color, fontWeight: 600, marginRight: '0.4rem' }} title={meta.label}>
                  {meta.icon}
                </span>
                <span>{r.title}</span>
                {r.status === 'partial' && r.missingCourses.length > 0 && (
                  <div style={{ fontSize: '0.8em', color: '#777', marginLeft: '1.4rem' }}>
                    Missing: {r.missingCourses.join(', ')}
                  </div>
                )}
                {r.note && (
                  <div style={{ fontSize: '0.8em', color: '#777', marginLeft: '1.4rem' }}>{r.note}</div>
                )}
              </div>
              <span style={{ whiteSpace: 'nowrap', color: meta.color, fontSize: '0.85em' }}>
                {renderCounts(r)}
              </span>
            </li>
          );
        })}
      </ul>

      {results.length === 0 && <p>No requirements found to audit.</p>}
    </div>
  );
};

export default AuditPanel;
