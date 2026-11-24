'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { control, action, Notice } from '../../../components/learning-ui';
export default function LearnerSignup() {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState('individual');
  useEffect(() => {
    if (new URLSearchParams(location.search).get('type') === 'institution') setKind('institution');
  }, []);
  return (
    <main id="main" className="agent-workspace agent-onboarding">
      <div className="agent-onboarding-card">
        <Link href="/learn">← Learning at Void Space</Link>
        <h1 className="text-3xl font-semibold">Start your own learning space</h1>
        <p className="text-ink-dim">
          Your personal agent, lessons and private model library. Choose a personal or institution
          workspace. For ages 13 and above.
        </p>
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-3 text-sm font-medium">How will you use Void Space?</legend>
          {[
            ['individual', 'Individual'],
            ['institution', 'Institution'],
          ].map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-14 items-center gap-3 rounded-lg border border-hairline p-3"
            >
              <input
                type="radio"
                name="workspace-kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value!)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const data = new FormData(e.currentTarget);
            try {
              const body = Object.fromEntries(data);
              if (kind === 'institution') delete body.ageBand;
              await apiFetch(kind === 'institution' ? '/auth/register' : '/auth/learners', {
                method: 'POST',
                body,
              });
              localStorage.setItem('void-workspace-mode', 'learning');
              const next = new URLSearchParams(location.search).get('next');
              location.assign(
                next?.startsWith('/console/learn/join?') ? next : '/console/learn/agent',
              );
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          {kind === 'institution' && (
            <label className="grid gap-2">
              Institution name
              <input
                className={control}
                name="organizationName"
                required
                minLength={2}
                maxLength={120}
              />
            </label>
          )}
          <label className="grid gap-2">
            Full name
            <input className={control} name="fullName" autoComplete="name" required minLength={2} />
          </label>
          <label className="grid gap-2">
            Email
            <input className={control} name="email" type="email" autoComplete="email" required />
          </label>
          <label className="grid gap-2">
            Password
            <input
              className={control}
              aria-label="Password"
              aria-describedby="password-help"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
            />
            <span id="password-help" className="text-sm text-ink-dim">
              At least 12 characters, with uppercase, lowercase, a number and a symbol.
            </span>
          </label>
          <label className="grid gap-2">
            Age range
            <select className={control} name="ageBand" required>
              <option value="">Choose your age range</option>
              <option value="13-17">13–17</option>
              <option value="18+">18 or older</option>
            </select>
          </label>
          {error && <Notice error>{error}</Notice>}
          <button className={action} disabled={busy}>
            {busy
              ? 'Creating your space…'
              : kind === 'institution'
                ? 'Create institution workspace'
                : 'Create learner account'}
          </button>
        </form>
        <p>
          Already registered?{' '}
          <Link href="/login?next=/console/learn/agent" className="underline">
            Sign in
          </Link>
        </p>
        <Link className="block underline" href="/learn/join-institution">
          Have an institution invitation?
        </Link>
      </div>
    </main>
  );
}
