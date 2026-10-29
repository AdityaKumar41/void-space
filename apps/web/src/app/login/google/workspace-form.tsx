'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ErrorNote } from '../../../components/ui/feedback';
import { ApiRequestError, apiFetch } from '../../../lib/api';
import { rememberMemberships, type Membership } from '../../../lib/session';

interface CompleteResponse {
  readonly user?: { readonly tenants: readonly Membership[] };
}

export function GoogleWorkspaceForm({ next }: { next: string }) {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<CompleteResponse>('/auth/google/complete', {
        method: 'POST',
        body: { organizationName },
      });
      if (result.user?.tenants) rememberMemberships(result.user.tenants);
      router.replace(next);
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({
        message:
          apiError.code === 'ONBOARDING_EXPIRED'
            ? 'This Google sign-in expired. Start it again from the sign-in page.'
            : apiError.message,
        code: apiError.code,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-5 space-y-5" onSubmit={(event) => void submit(event)}>
      <label className="block">
        <span className="text-[12px] tracking-[0.01em] text-ink-faint">Workspace name</span>
        <input
          className="mt-1.5 h-10 w-full rounded-control border border-hairline bg-surface px-3 text-[15px] text-ink transition-colors duration-150 ease-standard hover:border-hairline-strong focus:border-brand focus:outline-none"
          value={organizationName}
          onChange={(event) => setOrganizationName(event.target.value)}
          minLength={2}
          maxLength={120}
          required
          autoFocus
        />
      </label>
      {error ? <ErrorNote message={error.message} code={error.code} /> : null}
      <button
        className="inline-flex h-10 w-full items-center justify-center rounded-control border border-brand bg-brand px-4 text-[14px] font-semibold text-white shadow-heat transition-all duration-200 ease-standard hover:border-brand-warm hover:bg-brand-warm"
        type="submit"
        disabled={busy}
      >
        {busy ? 'Creating…' : 'Create workspace'}
      </button>
    </form>
  );
}
