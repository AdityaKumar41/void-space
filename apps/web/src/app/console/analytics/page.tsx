'use client';

import { useQuery } from '@tanstack/react-query';

import { apiFetch } from '../../../lib/api';
import { formatNumber } from '../../../lib/format';
import { RequirePermission } from '../../../components/permission-gate';
import { PageHead, StatCell, StatRow } from '../../../components/console-kit';
import { Panel } from '../../../components/ui/card';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';

interface CohortReport {
  readonly generatedAt: string;
  readonly totals: {
    readonly lessonsPublished: number;
    readonly attempts: number;
    readonly passedAttempts: number;
    readonly passRate: number;
    readonly credentialsIssued: number;
    readonly credentialsMintedOnChain: number;
    readonly courses: number;
    readonly enrollments: number;
    readonly completedEnrollments: number;
    readonly fieldGuideRuns: number;
  };
  readonly lessons: readonly {
    readonly lessonId: string;
    readonly title: string;
    readonly published: boolean;
    readonly attempts: number;
    readonly averageScore: number | null;
  }[];
}

export default function AnalyticsPage() {
  return (
    <RequirePermission permission="audit:view">
      <CohortAnalytics />
    </RequirePermission>
  );
}

function CohortAnalytics() {
  const report = useQuery({
    queryKey: ['analytics-cohort'],
    queryFn: () => apiFetch<CohortReport>('/analytics/cohort'),
  });

  return (
    <div className="space-y-7">
      <PageHead
        title="Learning analytics"
        meta={
          report.data
            ? `Cohort report · generated ${new Date(report.data.generatedAt).toLocaleString()}`
            : 'Querying assessment and credential evidence'
        }
      />

      {report.isLoading ? <LoadingBlock label="Loading cohort analytics" /> : null}
      {report.error ? <ErrorNote message={(report.error as Error).message} /> : null}

      {report.data ? (
        <>
          <StatRow>
            <StatCell
              label="Published lessons"
              value={formatNumber(report.data.totals.lessonsPublished)}
            />
            <StatCell label="Attempts" value={formatNumber(report.data.totals.attempts)} />
            <StatCell
              label="Pass rate"
              value={`${report.data.totals.passRate}%`}
              tone={report.data.totals.passRate >= 70 ? 'plain' : 'heat'}
            />
            <StatCell
              label="Credentials"
              value={`${formatNumber(report.data.totals.credentialsIssued)} / ${formatNumber(report.data.totals.credentialsMintedOnChain)} on-chain`}
            />
          </StatRow>

          <StatRow>
            <StatCell label="Courses" value={formatNumber(report.data.totals.courses)} />
            <StatCell label="Enrollments" value={formatNumber(report.data.totals.enrollments)} />
            <StatCell
              label="Completed programs"
              value={formatNumber(report.data.totals.completedEnrollments)}
            />
            <StatCell
              label="Field guide runs"
              value={formatNumber(report.data.totals.fieldGuideRuns)}
            />
          </StatRow>

          <Panel
            title="Per-lesson assessment"
            right={`${report.data.lessons.length} lessons with attempts`}
          >
            {report.data.lessons.length === 0 ? (
              <div className="px-5 py-6 text-[13.5px]" style={{ color: 'var(--vs-fg-faint)' }}>
                No assessment attempts recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="vs-table">
                  <thead>
                    <tr>
                      <th>Lesson</th>
                      <th>State</th>
                      <th className="text-right">Attempts</th>
                      <th className="text-right">Avg score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.lessons.map((row) => (
                      <tr key={row.lessonId}>
                        <td>{row.title}</td>
                        <td>
                          <span className="chip">{row.published ? 'Published' : 'Draft'}</span>
                        </td>
                        <td className="text-right font-mono text-[12px]">
                          {formatNumber(row.attempts)}
                        </td>
                        <td className="text-right font-mono text-[12px]">
                          {row.averageScore === null ? '—' : `${row.averageScore}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
