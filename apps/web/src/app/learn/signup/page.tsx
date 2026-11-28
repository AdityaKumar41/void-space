'use client';
import { useClientReady } from '../../../lib/use-client-ready';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { control, action, Notice } from '../../../components/learning-ui';
export default function LearnerSignup() {
  const ready = useClientReady();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState('individual'),
    [institutionRole, setInstitutionRole] = useState('student');
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
                disabled={!ready || busy}
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
        {kind === 'institution' && (
          <section className="grid gap-3" aria-label="Your institution role">
            <label className="grid gap-2">
              I’m joining as
              <select
                disabled={!ready || busy}
                className={control}
                value={institutionRole}
                onChange={(e) => setInstitutionRole(e.target.value)}
              >
                <option value="student">A student</option>
                <option value="teacher">A teacher</option>
                <option value="owner">The person setting up an institution</option>
              </select>
            </label>
            {institutionRole !== 'owner' && (
              <>
                <p>
                  Your institution’s invitation confirms your{' '}
                  {institutionRole === 'teacher' ? 'teaching' : 'student'} access. Use the email
                  address it was sent to; an email domain alone does not grant a role.
                </p>
                <Link className={action} href="/learn/join-institution">
                  Use my institution invitation
                </Link>
                <Link className="underline" href="/login?next=/console/learn/agent">
                  Already a member? Sign in
                </Link>
              </>
            )}
          </section>
        )}
        {(kind === 'individual' || institutionRole === 'owner') && (
          <form
            method="post"
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
                  disabled={!ready || busy}
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
              <input
                disabled={!ready || busy}
                className={control}
                name="fullName"
                autoComplete="name"
                required
                minLength={2}
              />
            </label>
            <label className="grid gap-2">
              Email
              <input
                disabled={!ready || busy}
                className={control}
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </label>
            <label className="grid gap-2">
              Password
              <input
                disabled={!ready || busy}
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
            {kind === 'individual' && (
              <label className="grid gap-2">
                Age range
                <select className={control} name="ageBand" required>
                  <option value="">Choose your age range</option>
                  <option value="13-17">13–17</option>
                  <option value="18+">18 or older</option>
                </select>
              </label>
            )}
            {error && <Notice error>{error}</Notice>}
            <button className={action} disabled={busy || !ready}>
              {busy
                ? 'Creating your space…'
                : kind === 'institution'
                  ? 'Create institution workspace'
                  : 'Create learner account'}
            </button>
          </form>
        )}
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
