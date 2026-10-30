'use client';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2, Wrench } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { Button, buttonVariants } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { ErrorNote, LoadingBlock } from '../../../components/ui/feedback';
interface Step {
  id: string;
  instruction: string;
  safetyNote?: string;
}
interface Guide {
  id: string;
  title: string;
  description: string;
  steps: Step[];
  status: 'draft' | 'published';
  lessonId: string | null;
}
const field = 'mt-2 w-full rounded-control border border-hairline bg-surface p-3 text-sm text-ink';
const newStep = (): Step => ({ id: crypto.randomUUID(), instruction: '' });
export default function FieldGuidesPage() {
  const { can } = useSession();
  const cache = useQueryClient();
  const params = useSearchParams();
  const guides = useQuery({
    queryKey: ['field-guides'],
    queryFn: () => apiFetch<{ guides: Guide[] }>('/field-guides'),
  });
  const lessons = useQuery({
    queryKey: ['field-guide-lessons'],
    queryFn: () => apiFetch<{ lessons: { id: string; title: string }[] }>('/lessons'),
    enabled: can('learning:manage'),
  });
  const [active, setActive] = useState<Guide | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const id = params.get('guide');
    const guide = guides.data?.guides.find((g) => g.id === id && g.status === 'published');
    if (guide) setActive(guide);
  }, [params, guides.data]);
  function begin(guide?: Guide) {
    setEditing(guide?.id ?? null);
    setTitle(guide?.title ?? '');
    setDescription(guide?.description ?? '');
    setLessonId(guide?.lessonId ?? '');
    setSteps(guide?.steps ?? [newStep()]);
    setCreating(true);
    setError(null);
    setNotice('');
  }
  function reorder(index: number, delta: number) {
    setSteps((current) => {
      const copy = [...current];
      [copy[index], copy[index + delta]] = [copy[index + delta]!, copy[index]!];
      return copy;
    });
  }
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ guide: Guide }>(
        editing ? `/field-guides/${editing}` : '/field-guides',
        {
          method: editing ? 'PATCH' : 'POST',
          body: {
            title,
            description,
            ...(lessonId ? { lessonId } : {}),
            steps: steps.map((step) => ({
              ...step,
              safetyNote: step.safetyNote?.trim() || undefined,
            })),
          },
        },
      );
      setEditing(result.guide.id);
      setNotice('Draft saved. Review each instruction and safety note before publishing.');
      await cache.invalidateQueries({ queryKey: ['field-guides'] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish(guide: Guide) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/field-guides/${guide.id}/publish`, { method: 'POST' });
      await cache.invalidateQueries({ queryKey: ['field-guides'] });
      setCreating(false);
      setNotice('Field guide published.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function share(guide: Guide) {
    try {
      await navigator.clipboard.writeText(
        `${location.origin}/console/field-guides?guide=${guide.id}`,
      );
      setNotice('Guide link copied. Recipients must sign in to this workspace.');
    } catch {
      setError('The browser could not copy the link. Open the guide and copy its address.');
    }
  }
  if (guides.isLoading) return <LoadingBlock label="Loading field guides" />;
  if (guides.error) return <ErrorNote message={(guides.error as Error).message} />;
  if (active) return <GuideRun guide={active} close={() => setActive(null)} />;
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Field guides</p>
          <h1 className="mt-2">Guidance at the point of work</h1>
          <p className="mt-3 max-w-[65ch] text-sm leading-7 text-ink-dim">
            A field guide is a short procedure tied to a released lesson. Completing it records that
            you acknowledged each step. A passing assessment still comes from a lesson or a practice
            run.
          </p>
        </div>
        {can('learning:manage') ? (
          <Button variant="primary" onClick={() => begin()}>
            <Plus size={16} />
            Create a field guide
          </Button>
        ) : null}
      </header>
      {error ? <ErrorNote message={error} /> : null}
      {notice ? (
        <p role="status" className="text-sm text-brand">
          {notice}
        </p>
      ) : null}
      {creating ? (
        <Card className="space-y-5 p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{editing ? 'Edit draft' : 'New field guide'}</h2>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Close authoring
            </Button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs text-ink-dim">
              Guide title
              <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="text-xs text-ink-dim">
              Published source lesson
              <select
                aria-label="Published source lesson"
                className={field}
                value={lessonId}
                onChange={(e) => setLessonId(e.target.value)}
              >
                <option value="">Choose a released lesson</option>
                {lessons.data?.lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {lessons.error ? <ErrorNote message={(lessons.error as Error).message} /> : null}
          <label className="block text-xs text-ink-dim">
            Context and intended outcome
            <textarea
              className={field}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="space-y-4">
            {steps.map((step, index) => (
              <section key={step.id} className="rounded-xl border border-hairline bg-deeper p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Step {index + 1}</h3>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Move step ${index + 1} earlier`}
                      disabled={!index}
                      onClick={() => reorder(index, -1)}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Move step ${index + 1} later`}
                      disabled={index === steps.length - 1}
                      onClick={() => reorder(index, 1)}
                    >
                      <ArrowDown size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove step ${index + 1}`}
                      disabled={steps.length === 1}
                      onClick={() => setSteps((current) => current.filter((s) => s.id !== step.id))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
                <label className="block text-xs text-ink-dim">
                  Instruction {index + 1}
                  <textarea
                    className={field}
                    value={step.instruction}
                    onChange={(e) =>
                      setSteps((current) =>
                        current.map((s) =>
                          s.id === step.id ? { ...s, instruction: e.target.value } : s,
                        ),
                      )
                    }
                  />
                </label>
                <label className="mt-3 block text-xs text-ink-dim">
                  Safety note {index + 1} (optional)
                  <input
                    className={field}
                    value={step.safetyNote ?? ''}
                    onChange={(e) =>
                      setSteps((current) =>
                        current.map((s) =>
                          s.id === step.id ? { ...s, safetyNote: e.target.value } : s,
                        ),
                      )
                    }
                  />
                </label>
              </section>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={steps.length >= 100}
              onClick={() => setSteps((current) => [...current, newStep()])}
            >
              <Plus size={15} />
              Add a step
            </Button>
            <Button
              variant="primary"
              disabled={
                busy ||
                title.trim().length < 3 ||
                description.trim().length < 20 ||
                !lessonId ||
                steps.some((s) => s.instruction.trim().length < 3)
              }
              onClick={save}
            >
              {busy ? 'Saving…' : 'Save guide draft'}
            </Button>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-5 md:grid-cols-2">
        {guides.data?.guides.map((guide) => (
          <Card key={guide.id} className="flex flex-col p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="learning-stat-icon">
                <Wrench size={21} />
              </span>
              <span className="text-xs text-ink-faint">
                {guide.status === 'published' ? 'Ready to use' : 'Private draft'} ·{' '}
                {guide.steps.length} steps
              </span>
            </div>
            <h2 className="text-xl font-semibold">{guide.title}</h2>
            <p className="mt-3 text-sm leading-7 text-ink-dim">{guide.description}</p>
            {guide.steps[0] ? (
              <p className="mb-6 mt-4 border-l-2 border-brand pl-3 text-sm leading-6 text-ink">
                Starts with: {guide.steps[0].instruction}
              </p>
            ) : (
              <div className="mb-6" />
            )}
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {guide.status === 'published' ? (
                <>
                  <Link
                    href={`/console/field-guides?guide=${guide.id}`}
                    className={buttonVariants({ variant: 'primary', size: 'sm' })}
                    onClick={() => setActive(guide)}
                  >
                    Start guidance
                  </Link>
                  <Button size="sm" variant="ghost" onClick={() => share(guide)}>
                    <Copy size={13} />
                    Copy link
                  </Button>
                </>
              ) : can('learning:manage') ? (
                <>
                  <Button size="sm" onClick={() => begin(guide)}>
                    Edit draft
                  </Button>
                  <Button size="sm" onClick={() => setActive(guide)}>
                    Preview
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy}
                    onClick={() => publish(guide)}
                  >
                    Publish guide
                  </Button>
                </>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
      {!guides.data?.guides.length ? (
        <div className="learning-section-empty">
          No field guides have been published.{' '}
          {can('learning:manage')
            ? 'Create a guide from a released lesson, review it and publish it for your team.'
            : 'Your team’s released guides will appear here.'}
        </div>
      ) : null}
    </div>
  );
}
function GuideRun({ guide, close }: { guide: Guide; close: () => void }) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<string[]>([]);
  const [result, setResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = guide.steps[step]!;
  async function advance() {
    const next = done.includes(current.id) ? done : [...done, current.id];
    setDone(next);
    if (step < guide.steps.length - 1) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/field-guides/${guide.id}/runs`, {
        method: 'POST',
        body: { completedStepIds: next, device: 'web' },
      });
      setResult(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" onClick={close}>
        ← All field guides
      </Button>
      <div>
        <p className="eyebrow">
          {guide.status === 'draft' ? 'Author preview' : 'Guided procedure'}
        </p>
        <h1 className="mt-2">{guide.title}</h1>
        <p className="mt-3 max-w-[65ch] text-sm leading-7 text-ink-dim">{guide.description}</p>
        <div className="mt-5 max-w-md">
          <div className="learn-progress" aria-hidden>
            <span
              style={{
                width: `${Math.round(((result ? guide.steps.length : step) / guide.steps.length) * 100)}%`,
              }}
            />
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            {result
              ? 'All steps acknowledged'
              : `Step ${step + 1} of ${guide.steps.length}`}
          </p>
        </div>
      </div>
      {guide.lessonId ? (
        <Link
          className="inline-flex text-xs font-semibold text-brand"
          href={`/console/lessons?lesson=${guide.lessonId}`}
        >
          Open the source lesson ↗
        </Link>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      <Card className="p-6 sm:p-9">
        {result ? (
          <div role="status">
            <span className="learning-stat-icon">
              <Check size={24} />
            </span>
            <h2 className="mt-5 text-2xl font-semibold">Guide completed</h2>
            <p className="mt-3 text-sm leading-7 text-ink-dim">
              Your acknowledgement of all {guide.steps.length} steps has been recorded. This is a
              procedure completion record, not an assessed skill credential.
            </p>
            <Button className="mt-6" onClick={close}>
              Back to field guides
            </Button>
          </div>
        ) : (
          <>
            <ol className="mb-6 space-y-2" aria-label="Procedure steps">
              {guide.steps.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`learn-step ${index === step ? 'is-current' : ''}`}
                    disabled={index > done.length}
                    onClick={() => setStep(index)}
                  >
                    <span className="mr-2 font-mono text-[11px] text-ink-faint">{index + 1}</span>
                    {item.instruction}
                  </button>
                </li>
              ))}
            </ol>
            {current.safetyNote ? (
              <div className="mt-6 rounded-lg border border-heat-40 bg-heat-8 p-4">
                <strong className="text-sm text-brand">Before you continue</strong>
                <p className="mt-2 text-sm leading-7 text-ink">{current.safetyNote}</p>
              </div>
            ) : null}
            <p className="mt-7 text-xs leading-6 text-ink-faint">
              Continue only after you have read and carried out this instruction. Stop and ask your
              facilitator if the instruction does not match your situation.
            </p>
            <div className="mt-6 flex flex-wrap justify-between gap-3">
              <Button variant="ghost" disabled={!step || busy} onClick={() => setStep(step - 1)}>
                Previous step
              </Button>
              {guide.status === 'published' ? (
                <Button variant="primary" disabled={busy} onClick={advance}>
                  {busy
                    ? 'Recording…'
                    : step === guide.steps.length - 1
                      ? 'Acknowledge and complete'
                      : 'Acknowledge and continue'}
                </Button>
              ) : (
                <Button
                  disabled={step === guide.steps.length - 1}
                  onClick={() => setStep(step + 1)}
                >
                  Next preview step
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
