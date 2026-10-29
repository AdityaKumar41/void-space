'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../../lib/api';
import { Card } from '../../../components/ui/card';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';
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
  if (profile.isLoading) return <LoadingBlock label="BUILDING SKILL PROFILE" />;
  if (profile.error) return <ErrorNote message={(profile.error as Error).message} />;
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">CAREER COMPASS</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          Evidence-backed skill profile
        </h1>
        <p className="mt-2 text-ink-dim">
          {profile.data?.evidenceCount ?? 0} verified{' '}
          {(profile.data?.evidenceCount ?? 0) === 1 ? 'record' : 'records'} across learning,
          simulations and field work.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold text-ink">Verified skills</h2>
          {profile.data?.skills.map((skill) => (
            <p key={`${skill.kind}-${skill.title}`} className="text-sm text-ink-dim">
              <span className="font-mono text-brand">{skill.kind.toUpperCase()}</span> ·{' '}
              {skill.title}
              <span className="mt-0.5 block text-xs text-ink-faint">
                Verified {new Date(skill.verifiedAt).toLocaleDateString()}
              </span>
            </p>
          ))}
        </Card>
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold text-ink">Role paths</h2>
          {profile.data?.recommendations.map((item) => (
            <div key={item.role}>
              <p className="text-ink">{item.role}</p>
              <p className="text-sm text-ink-dim">{item.reason}</p>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
