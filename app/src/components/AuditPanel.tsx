import React, { useMemo } from 'react';
import { CourseNode, ProgramInfo, CourseSet, ProgramLists } from '../context/AppDataContext';
import { normalizeCode } from '../utils/prerequisites';
import { buildAuditReport, type RequirementResult, type RequirementStatus } from '../audit';
import { Badge, type BadgeTone } from './ui';

interface AuditPanelProps {
  programInfo: ProgramInfo | null;
  courseSets: CourseSet[];
  programLists: ProgramLists | null;
  selectedCourses: Set<string>;
  courses: CourseNode[];
}

// Requirement states expressed through the restrained token palette — met is
// ink emphasis, partial/unmet recede, unverified is neutral. No candy trio.
const STATUS_META: Record<RequirementStatus, { label: string; tone: BadgeTone }> = {
  met: { label: 'Met', tone: 'met' },
  partial: { label: 'Partial', tone: 'partial' },
  unmet: { label: 'Unmet', tone: 'unmet' },
  unverified: { label: 'Unverified', tone: 'neutral' },
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
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Requirement Audit</h2>
        <span className="font-mono text-xs tabular-nums text-muted">
          {summary.met}/{summary.total} met
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Badge tone="met" dot>{summary.met} Met</Badge>
        <Badge tone="partial" dot>{summary.partial} Partial</Badge>
        <Badge tone="unmet" dot>{summary.unmet} Unmet</Badge>
        {summary.unverified > 0 && (
          <Badge tone="neutral" dot>{summary.unverified} Unverified</Badge>
        )}
      </div>

      {results.length === 0 ? (
        <p className="border border-border bg-surface px-4 py-6 text-center text-sm italic text-faint">
          No requirements found to audit.
        </p>
      ) : (
        <ul className="border border-border bg-surface">
          {results.map(r => {
            const meta = STATUS_META[r.status];
            return (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2.5">
                    <Badge tone={meta.tone} dot className="shrink-0">
                      {meta.label}
                    </Badge>
                    <span className="text-sm text-text">{r.title}</span>
                  </div>
                  {r.status === 'partial' && r.missingCourses.length > 0 && (
                    <p className="mt-1 pl-0.5 text-xs text-faint">
                      Missing <span className="font-mono tabular-nums">{r.missingCourses.join(', ')}</span>
                    </p>
                  )}
                  {r.note && (
                    <p className="mt-1 pl-0.5 text-xs text-faint">{r.note}</p>
                  )}
                </div>
                <span className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-muted">
                  {renderCounts(r)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AuditPanel;
