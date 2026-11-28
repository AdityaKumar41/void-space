'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { formatNumber } from '../../../lib/format';
import { RequirePermission } from '../../../components/permission-gate';
import { PageHead, StatCell, StatRow } from '../../../components/console-kit';
import { Panel } from '../../../components/ui/card';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';
interface LearningReport {
  totals: { publishedReleases: number; studySessions: number; completedSections: number };
  lessons: {
    releaseId: string;
    title: string;
    sessions: number;
    completedSections: number;
    lastStudiedAt: string;
  }[];
}
export default function AnalyticsPage() {
  return (
    <RequirePermission permission="audit:view">
      <LearningAnalytics />
    </RequirePermission>
  );
}
function LearningAnalytics() {
  const report = useQuery({
    queryKey: ['shared-learning-analytics'],
    queryFn: () => apiFetch<LearningReport>('/analytics/cohort'),
  });
  return (
    <div className="space-y-7">
      <PageHead
        title="Learning analytics"
        meta="Shared lessons in this workspace. Private study and private lesson plans are excluded."
      />
      {report.isLoading && <LoadingBlock label="Loading learning analytics" />}
      {report.error && <ErrorNote message={(report.error as Error).message} />}
      {report.data && (
        <>
          <StatRow>
            <StatCell
              label="Shared releases"
              value={formatNumber(report.data.totals.publishedReleases)}
            />
            <StatCell
              label="Study sessions"
              value={formatNumber(report.data.totals.studySessions)}
            />
            <StatCell
              label="Sections completed"
              value={formatNumber(report.data.totals.completedSections)}
            />
          </StatRow>
          <Panel title="Recent shared lesson activity">
            {!report.data.lessons.length ? (
              <p className="px-5 py-6 text-sm text-ink-dim">
                Activity appears here when learners study a shared lesson.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="vs-table">
                  <thead>
                    <tr>
                      <th>Lesson</th>
                      <th>Study sessions</th>
                      <th>Sections completed</th>
                      <th>Last studied</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.lessons.map((r) => (
                      <tr key={r.releaseId}>
                        <td>{r.title}</td>
                        <td>{formatNumber(r.sessions)}</td>
                        <td>{formatNumber(r.completedSections)}</td>
                        <td>{new Date(r.lastStudiedAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
