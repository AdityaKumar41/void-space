'use client';
import { useClientReady } from '../../lib/use-client-ready';

/**
 * Sign-in (FR-2.1, FR-2.2, FR-1.4).
 *
 * Three things this screen has to get right:
 *
 *  1. Credentials go to the API over the edge; tokens come back as httpOnly cookies, so nothing here
 *     ever touches a token (§2.5 constraint).
 *  2. Someone who belongs to several workspaces gets a chooser, not an error (FR-1.4).
 *  3. It is the first impression of the product, so it shows what the platform does rather than asking
 *     for a password in an empty room.
 *
 * `next` is where to land after signing in. It is validated on the server (`safeNextPath`), so this
 * component can treat it as a known-good in-app path: a deep link into the console survives the
 * sign-in detour instead of dumping the user on the overview.
 *
 * Local demo accounts are opt-in and hidden in production; new accounts start with an empty form.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiRequestError, apiFetch, refreshSession } from '../../lib/api';
import { rememberMemberships, type Membership } from '../../lib/session';
import { signInWithEthereum } from '../../lib/siwe';
import { Wordmark } from '../../components/market-shell';
import { Avatar } from '../../components/ui/avatar';

import { ErrorNote } from '../../components/ui/feedback';

interface LoginResponse {
  readonly user?: { readonly tenants: readonly Membership[] };
  readonly requiresTenantSelection?: boolean;
  readonly tenants?: readonly Membership[];
}

const DEMO_ACCOUNTS = [
  { email: 'creator@aurora.dev', role: 'Creator — uploads and submits' },
  { email: 'assessor@aurora.dev', role: 'Assessor — reviews and publishes' },
  { email: 'admin@aurora.dev', role: 'Tenant admin — team and settings' },
  { email: 'viewer@aurora.dev', role: 'Viewer — read-only marketplace' },
  { email: 'priya@void-space.dev', role: 'Member of two workspaces' },
] as const;

const DEMO_PASSWORD = 'VoidSpace!2026';

const GOOGLE_ERRORS: Readonly<Record<string, string>> = {
  GOOGLE_CANCELLED: 'Google sign-in was cancelled.',
  GOOGLE_BAD_CALLBACK: 'Google did not finish the sign-in. Start it again from this page.',
  GOOGLE_STATE_MISMATCH:
    'That Google sign-in did not start on this site, or it expired. Try again.',
  GOOGLE_CODE_REJECTED:
    'Google rejected the sign-in. The redirect URI in Google Cloud must match this site exactly.',
  GOOGLE_PROFILE_FAILED: 'Google did not return a profile.',
  GOOGLE_EMAIL_UNVERIFIED: 'That Google account has no verified email address.',
  GOOGLE_NOT_CONFIGURED: 'Google sign-in is not configured on this server.',
};

export function LoginForm({
  next,
  google,
  wallet,
  error: errorCode,
  showDemo = false,
  resume = false,
}: {
  next: string;
  google: boolean;
  wallet: boolean;
  error?: string;
  showDemo?: boolean;
  resume?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ready = useClientReady();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenants, setTenants] = useState<readonly Membership[] | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(resume);
  useEffect(() => {
    if (!resume) return;
    let active = true;
    void (async () => {
      try {
        if (await refreshSession()) {
          // Verify the new cookie before navigating, preventing a redirect loop
          // if browser cookie settings reject it. No token reaches client storage.
          await apiFetch('/auth/me', { skipRefresh: true });
          if (active) window.location.replace(next);
          return;
        }
      } catch {
        // A revoked/expired refresh session falls through to ordinary sign-in.
      }
      if (active) setRestoring(false);
    })();
    return () => {
      active = false;
    };
  }, [resume, next]);

  async function finishLogin(result: LoginResponse) {
    if (result.requiresTenantSelection) {
      setTenants(result.tenants ?? []);
      return;
    }
    if (result.user?.tenants) rememberMemberships(result.user.tenants);
    await queryClient.cancelQueries({ queryKey: ['session'] });
    await queryClient.fetchQuery({
      queryKey: ['session'],
      queryFn: () => apiFetch('/auth/me'),
      staleTime: 0,
    });
    router.replace(next);
    router.refresh();
  }

  async function submit(tenantId?: string) {
    setBusy(true);
    setError(null);

    try {
      const result = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(tenantId ? { tenantId } : {}) },
      });
      await finishLogin(result);
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setBusy(false);
    }
  }

  async function submitWallet() {
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithEthereum();
      await finishLogin(result);
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({
        message: apiError.message ?? (caught as Error).message,
        code: apiError.code,
      });
    } finally {
      setBusy(false);
    }
  }

  if (restoring)
    return (
      <main id="main" className="grid min-h-screen place-content-center gap-4 p-6 text-center">
        <p role="status">Restoring your session…</p>
        <Link href={`/login?next=${encodeURIComponent(next)}`}>Continue to sign in</Link>
      </main>
    );
  return (
    <main id="main" className="agent-workspace agent-onboarding learning-signin">
      <section className="learning-signin-story" aria-label="Welcome to Void Space">
        <Link href="/" className="text-xl font-semibold">
          void space /
        </Link>
        <div>
          <p>Your next moment of understanding.</p>
          <h2>
            Bring a question.
            <br />
            Make it a lesson.
          </h2>
          <p>Your agent, interactive models and lessons—together in one space.</p>
        </div>
        <img src="/illustrations/learning-world.svg" alt="" width="1440" height="520" />
      </section>
      {/* Right: the form. */}
      <section className="flex items-center justify-center px-6 lg:px-12">
        <div className="learning-login-form-column">
          <div className="mb-8 flex items-center justify-between">
            <Link href="/" aria-label="VOID·SPACE — home">
              <Wordmark />
            </Link>
          </div>

          <div className="relative overflow-hidden rounded-card border border-hairline bg-surface shadow-panel px-6 py-6">
            {tenants ? (
              /*
                FR-1.4 — someone who belongs to more than one workspace picks here rather than after
                landing in the wrong one. The roles are shown next to each, because which workspace you
                want is often decided by what you can do in it.
              */
              <div className="space-y-4">
                <div>
                  <h2 className="font-medium leading-[1.1] tracking-[-0.021em] text-ink text-2xl">
                    Choose a workspace
                  </h2>
                  <p className="text-[12px] tracking-[0.01em] text-ink-faint mt-1.5">
                    {email} belongs to {tenants.length}. You can switch later from the header.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  {tenants.map((tenant) => (
                    <button
                      key={tenant.id}
                      type="button"
                      className="flex w-full items-center gap-3 rounded-control border border-hairline bg-surface p-3 text-left transition-all duration-150 ease-standard hover:border-hairline-strong hover:bg-surface-raised aria-pressed:border-heat-40 aria-pressed:bg-heat-8"
                      onClick={() => void submit(tenant.id)}
                      disabled={busy || !ready}
                    >
                      <Avatar name={tenant.name} />
                      <span className="min-w-0">
                        <b className="block truncate text-[13.5px] font-medium text-ink">
                          {tenant.name}
                        </b>
                        <span className="block truncate font-mono text-[11px] text-ink-faint">
                          {tenant.roles.join(' / ')}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-control border px-4 text-[14px] font-semibold transition-all duration-200 ease-standard hover:bg-veil-12 border-hairline-strong bg-transparent text-ink-dim hover:bg-veil-6 hover:text-ink w-full justify-center"
                  onClick={() => setTenants(null)}
                >
                  Back
                </button>
              </div>
            ) : (
              <form
                method="post"
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <div>
                  <h1 className="font-medium leading-[1.1] tracking-[-0.021em] text-ink text-2xl">
                    Sign in
                  </h1>
                  <p className="text-[12px] tracking-[0.01em] text-ink-faint mt-1.5">
                    Continue to your workspace
                  </p>
                </div>

                {errorCode ? (
                  <ErrorNote
                    message={GOOGLE_ERRORS[errorCode] ?? 'Google sign-in did not complete.'}
                    code={errorCode}
                  />
                ) : null}

                {google || wallet ? (
                  <div className="space-y-3">
                    {google ? (
                      <a
                        href={`/api/v1/auth/google/start?next=${encodeURIComponent(next)}`}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-control border border-hairline-strong bg-surface px-4 text-[14px] font-semibold text-ink transition-all duration-200 ease-standard hover:border-brand hover:bg-surface-raised"
                      >
                        <GoogleMark />
                        Continue with Google
                      </a>
                    ) : null}
                    {wallet ? (
                      <button
                        type="button"
                        disabled={busy || !ready}
                        onClick={() => void submitWallet()}
                        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-control border border-hairline-strong bg-surface px-4 text-[14px] font-semibold text-ink transition-all duration-200 ease-standard hover:border-brand hover:bg-surface-raised disabled:opacity-60"
                      >
                        Continue with wallet
                      </button>
                    ) : null}
                    <p className="text-center text-[12px] tracking-[0.01em] text-ink-faint">
                      or use a password
                    </p>
                  </div>
                ) : null}

                <label className="block">
                  <span className="text-[12px] tracking-[0.01em] text-ink-faint">Email</span>
                  <input
                    disabled={!ready || busy}
                    className="h-10 w-full rounded-control border border-hairline bg-surface px-3 text-[15px] text-ink transition-colors duration-150 ease-standard hover:border-hairline-strong focus:border-brand focus:outline-none mt-1.5"
                    type="email"
                    value={email}
                    autoComplete="username"
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </label>

                <label className="block">
                  <span className="text-[12px] tracking-[0.01em] text-ink-faint">Password</span>
                  <input
                    disabled={!ready || busy}
                    className="h-10 w-full rounded-control border border-hairline bg-surface px-3 text-[15px] text-ink transition-colors duration-150 ease-standard hover:border-hairline-strong focus:border-brand focus:outline-none mt-1.5"
                    type="password"
                    value={password}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>

                {error ? (
                  <ErrorNote
                    message={error.message}
                    code={error.code}
                    hint={showDemo ? `Seed passwords are ${DEMO_PASSWORD}.` : undefined}
                  />
                ) : null}

                <button
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-control border px-4 text-[14px] font-semibold transition-all duration-200 ease-standard border-brand bg-brand text-white shadow-heat hover:border-brand-warm hover:bg-brand-warm w-full justify-center"
                  type="submit"
                  disabled={busy || !ready}
                >
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
                <p className="text-center text-sm text-ink-dim">
                  New here?{' '}
                  <Link
                    className="font-medium text-ink underline underline-offset-4"
                    href={`/learn/signup?next=${encodeURIComponent(next)}`}
                  >
                    Create an account
                  </Link>
                </p>
              </form>
            )}
          </div>

          {showDemo && (
            <details className="lesson-options mt-5">
              <summary>Local demo accounts</summary>
              <div className="text-[12px] tracking-[0.01em] text-ink-faint">Demo accounts</div>
              <ul className="mt-3 flex flex-col gap-1">
                {DEMO_ACCOUNTS.map((account) => (
                  <li key={account.email}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-control border border-transparent bg-transparent p-2 text-left transition-all duration-150 ease-standard hover:border-heat-40 hover:bg-heat-4 aria-pressed:border-heat-40 aria-pressed:bg-heat-8"
                      onClick={() => {
                        setEmail(account.email);
                        setPassword(DEMO_PASSWORD);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-[12px] text-ink-dim block truncate">
                          {account.email}
                        </span>
                        <span className="text-[12px] tracking-[0.01em] text-ink-faint block">
                          {account.role}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] tracking-[0.01em] text-ink-faint mt-3 leading-relaxed">
                Selecting an account fills the form. The password is {DEMO_PASSWORD}.
              </p>
            </details>
          )}
        </div>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
