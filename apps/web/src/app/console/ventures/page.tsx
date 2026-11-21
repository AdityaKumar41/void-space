'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { apiFetch } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useToast } from '../../../components/toast';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ErrorNote, EmptyState, LoadingBlock } from '../../../components/ui/feedback';

type Draft = {
  title: string;
  problem: string;
  customer: string;
  solution: string;
  nextMilestone: string;
};
type Plan = Draft & { id: string; createdById: string };
const empty: Draft = { title: '', problem: '', customer: '', solution: '', nextMilestone: '' };
const fields = [
  { key: 'problem', label: 'Customer problem', min: 10, max: 4000 },
  { key: 'customer', label: 'Target customer', min: 3, max: 2000 },
  { key: 'solution', label: 'Your solution', min: 10, max: 4000 },
  { key: 'nextMilestone', label: 'Next milestone', min: 3, max: 1000 },
] as const;

export default function VenturesPage() {
  const client = useQueryClient();
  const { session } = useSession();
  const toast = useToast();
  const titleInput = useRef<HTMLInputElement>(null);
  const plans = useQuery({
    queryKey: ['ventures'],
    queryFn: () => apiFetch<{ plans: Plan[] }>('/ventures'),
  });
  const [draft, setDraft] = useState<Draft>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (plans.isLoading) return <LoadingBlock label="Loading venture plans" />;
  if (plans.error) return <ErrorNote message={(plans.error as Error).message} />;
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(editing ? `/ventures/${editing}` : '/ventures', {
        method: editing ? 'PUT' : 'POST',
        body: draft,
      });
      setDraft(empty);
      setEditing(null);
      await client.invalidateQueries({ queryKey: ['ventures'] });
      toast.success(editing ? 'Venture plan updated' : 'Venture plan saved');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function edit(plan: Plan) {
    setEditing(plan.id);
    setDraft({
      title: plan.title,
      problem: plan.problem,
      customer: plan.customer,
      solution: plan.solution,
      nextMilestone: plan.nextMilestone,
    });
    setError(null);
    titleInput.current?.focus();
    titleInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Venture builder</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">
          Turn verified capability into a venture
        </h1>
        <p className="mt-2 max-w-2xl text-ink-dim">
          Describe the problem, customer and next milestone. Your team can read saved plans; you can
          keep updating your own.
        </p>
      </header>
      <Card className="p-5">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h2 className="font-semibold text-ink">
            {editing ? 'Edit venture plan' : 'New venture plan'}
          </h2>
          <fieldset disabled={busy} className="space-y-3">
            <label className="block text-sm text-ink">
              Venture title
              <input
                ref={titleInput}
                required
                minLength={3}
                maxLength={200}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                className="mt-1 w-full rounded-control border border-hairline bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            {fields.map(({ key, label, min, max }) => (
              <label key={key} className="block text-sm text-ink">
                {label}
                <textarea
                  aria-label={label}
                  required
                  minLength={min}
                  maxLength={max}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  className="mt-1 min-h-20 w-full rounded-control border border-hairline bg-surface p-3 text-sm text-ink"
                />
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                busy ||
                draft.title.trim().length < 3 ||
                fields.some(({ key, min }) => draft[key].trim().length < min)
              }
            >
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Save venture plan'}
            </Button>
            {editing ? (
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setDraft(empty);
                  setError(null);
                }}
              >
                Cancel editing
              </Button>
            ) : null}
          </div>
          {error ? <ErrorNote message={error} /> : null}
        </form>
      </Card>
      {plans.data?.plans.length === 0 ? (
        <EmptyState
          title="No venture plans yet"
          hint="Start with a customer problem using the form above. Saved plans remain available to your workspace."
        />
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {plans.data?.plans.map((plan) => (
          <Card key={plan.id} className="min-w-0 space-y-4 p-5">
            <h2 className="break-words text-xl font-semibold text-ink">{plan.title}</h2>
            <dl className="space-y-3">
              {fields.map(({ key, label }) => (
                <div key={key}>
                  <dt className="text-xs font-semibold text-ink">{label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-dim">
                    {plan[key]}
                  </dd>
                </div>
              ))}
            </dl>
            {plan.createdById === session?.user.id ? (
              <Button onClick={() => edit(plan)}>Edit plan</Button>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
