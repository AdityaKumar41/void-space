'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { action, control, Notice } from '../../../components/learning-ui';
export default function Page() {
  const [token, setToken] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    setToken(new URLSearchParams(location.search).get('token') ?? '');
  }, []);
  return (
    <main id="main" className="agent-workspace agent-onboarding">
      <div className="agent-onboarding-card">
        <h1 className="text-3xl font-semibold">Join your institution</h1>
        <p className="text-ink-dim">
          Use the private invitation your institution sent you. This grants only the role specified
          in that invitation.
        </p>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const f = new FormData(e.currentTarget);
            try {
              await apiFetch('/auth/invite/accept', {
                method: 'POST',
                body: { token, fullName: f.get('fullName'), password: f.get('password') },
              });
              location.assign('/console/learn/institution');
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          <label className="grid gap-2">
            Invitation token
            <input
              className={control}
              value={token}
              required
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <label className="grid gap-2">
            Full name
            <input className={control} name="fullName" required minLength={2} />
          </label>
          <label className="grid gap-2">
            Set a password
            <input className={control} type="password" name="password" required minLength={12} />
            <span className="text-xs text-ink-dim">
              At least 12 characters, with uppercase, lowercase, a number and a symbol.
            </span>
          </label>
          {error && <Notice error>{error}</Notice>}
          <button className={action} disabled={busy}>
            {busy ? 'Joining…' : 'Accept invitation'}
          </button>
        </form>
      </div>
    </main>
  );
}
