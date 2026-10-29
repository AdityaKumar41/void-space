'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';
type Plan = {
  id: string;
  title: string;
  problem: string;
  customer: string;
  solution: string;
  nextMilestone: string;
};
const empty = { title: '', problem: '', customer: '', solution: '', nextMilestone: '' };
export default function VenturesPage() {
  const client = useQueryClient();
  const plans = useQuery({
    queryKey: ['ventures'],
    queryFn: () => apiFetch<{ plans: Plan[] }>('/ventures'),
  });
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (plans.isLoading) return <LoadingBlock label="LOADING VENTURE BUILDER" />;
  if (plans.error) return <ErrorNote message={(plans.error as Error).message} />;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/ventures', { method: 'POST', body: draft });
      setDraft(empty);
      await client.invalidateQueries({ queryKey: ['ventures'] });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">VENTURE BUILDER</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          Turn verified capability into a venture
        </h1>
        <p className="mt-2 max-w-2xl text-ink-dim">
          Capture the customer problem, solution and next measurable milestone in a tenant-scoped
          founder workspace.
        </p>
      </div>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold text-ink">New venture plan</h2>
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Venture title"
          className="w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
        />
        {(['problem', 'customer', 'solution', 'nextMilestone'] as const).map((key) => (
          <textarea
            key={key}
            value={draft[key]}
            onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            placeholder={
              {
                problem: 'Customer problem',
                customer: 'Target customer',
                solution: 'Your solution',
                nextMilestone: 'Next milestone',
              }[key]
            }
            className="min-h-16 w-full rounded-control border border-hairline bg-surface p-3 text-sm text-ink"
          />
        ))}
        <Button
          disabled={busy || Object.values(draft).some((value) => value.trim().length < 3)}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Save venture plan'}
        </Button>
        {error ? <ErrorNote message={error} /> : null}
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {plans.data?.plans.map((plan) => (
          <Card key={plan.id} className="space-y-2 p-5">
            <h2 className="text-xl font-semibold text-ink">{plan.title}</h2>
            <p className="text-sm text-ink-dim">
              <strong>Customer:</strong> {plan.customer}
            </p>
            <p className="text-sm text-ink-dim">
              <strong>Next:</strong> {plan.nextMilestone}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
