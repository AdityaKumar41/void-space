'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { Chip } from '../../../components/ui/chip';
import { ErrorNote, EmptyState, LoadingBlock } from '../../../components/ui/feedback';

export default function CareerPage() {
  const profile = useQuery({
    queryKey: ['career-profile'],
    queryFn: () =>
      apiFetch<{
        evidenceCount: number;
        skills: { kind: string; title: string; verifiedAt: string }[];
        recommendations: { role: string; reason: string }[];
      }>('/career/profile'),
  });
  if (profile.isLoading) return <LoadingBlock label="Loading your skill profile" />;
  if (profile.error) return <ErrorNote message={(profile.error as Error).message} />;
  const skills = profile.data?.skills ?? [];
  const roles = profile.data?.recommendations ?? [];
  const records = profile.data?.evidenceCount ?? 0;
  return (
    <div className="space-y-8">
      <header className="border-b border-hairline pb-6">
        <p className="eyebrow">Career</p>
        <h1 className="mt-2 text-ink">Evidence-backed skill profile</h1>
        <p className="mt-3 max-w-[65ch] text-ink-dim">
          Skills appear here only after a recorded pass. A suggested path is a reading of that
          evidence.
        </p>
      </header>
      <section className="learning-stats" aria-label="Skill profile">
        <div className="learning-stat">
          <div>
            <strong>{records}</strong>
            <span>{records === 1 ? 'Verified record' : 'Verified records'}</span>
          </div>
        </div>
        <div className="learning-stat">
          <div>
            <strong>{skills.length}</strong>
            <span>{skills.length === 1 ? 'Verified skill' : 'Verified skills'}</span>
          </div>
        </div>
        <div className="learning-stat">
          <div>
            <strong>{roles.length}</strong>
            <span>{roles.length === 1 ? 'Suggested path' : 'Suggested paths'}</span>
          </div>
        </div>
      </section>
      <div className="learning-columns">
        <section>
          <div className="learning-section-head">
            <h2>Verified skills</h2>
          </div>
          {skills.length ? (
            <div className="learning-list">
              {skills.map((skill) => (
                <div key={`${skill.kind}-${skill.title}`} className="learning-list-row">
                  <div className="min-w-0 flex-1">
                    <h3>{skill.title}</h3>
                    <p>Verified {new Date(skill.verifiedAt).toLocaleDateString()}</p>
                  </div>
                  <Chip tone="live">{skill.kind}</Chip>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No verified skills yet"
              hint="Pass a published lesson assessment, or complete an assessed practice run. The record shows up here after it is stored."
            />
          )}
        </section>
        <section>
          <div className="learning-section-head">
            <h2>Suggested paths</h2>
          </div>
          {roles.length ? (
            <div className="learning-list">
              {roles.map((item) => (
                <div key={item.role} className="learning-list-row items-start">
                  <div className="min-w-0">
                    <h3>{item.role}</h3>
                    <p className="leading-relaxed">{item.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No path yet"
              hint="Paths are suggested from verified records. Complete a lesson or an assessed practice run first."
            />
          )}
        </section>
      </div>
    </div>
  );
}
