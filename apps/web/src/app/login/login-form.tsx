'use client';

/**
 * Sign-in (FR-2.1, FR-2.2, FR-1.4).
 *
 * Three things this screen has to get right:
 *
 *  1. Credentials go to the API over the edge; tokens come back as httpOnly cookies, so nothing here
 *     ever touches a token (§2.5 constraint).
 *  2. Someone who belongs to several workspaces gets a chooser, not an error (FR-1.4).
 *  3. It is the first impression of the product, so it shows what the platform does rather than
 *     asking for a password in an empty room.
 *
 * `next` is where to land after signing in. It is validated on the server (`safeNextPath`), so
 * this component can treat it as a known-good in-app path: a deep link into the console survives
 * the sign-in detour instead of dumping the user on the overview.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiRequestError, apiFetch } from '../../lib/api';
import { rememberMemberships, type Membership } from '../../lib/session';
import { ErrorNote } from '../../components/ui-kit';

interface LoginResponse {
  readonly user?: { readonly tenants: readonly Membership[] };
  readonly requiresTenantSelection?: boolean;
  readonly tenants?: readonly Membership[];
}

const HIGHLIGHTS = [
  {
    title: 'Ingest anything',
    body: 'GLB, GLTF, OBJ, FBX, STL and BLEND up to 200 MB, streamed to disk and measured on arrival.',
  },
  {
    title: 'Stored by content',
    body: 'Every version is pinned to IPFS, so the catalogue link is the file — verifiable, not a guess.',
  },
  {
    title: 'Licensed on-chain',
    body: 'Publishing mints an ERC-721 licence. Takedowns flag the token and keep the history.',
  },
] as const;

const DEMO_ACCOUNTS = [
  { email: 'creator@aurora.dev', role: 'Creator — uploads and submits' },
  { email: 'assessor@aurora.dev', role: 'Assessor — reviews and publishes' },
  { email: 'admin@aurora.dev', role: 'Tenant admin — team and settings' },
  { email: 'viewer@aurora.dev', role: 'Viewer — read-only marketplace' },
  { email: 'priya@void-space.dev', role: 'Member of two workspaces' },
] as const;

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('creator@aurora.dev');
  const [password, setPassword] = useState('VoidSpace!2026');
  const [tenants, setTenants] = useState<readonly Membership[] | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(tenantId?: string) {
    setBusy(true);
    setError(null);

    try {
      const result = await apiFetch<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(tenantId ? { tenantId } : {}) },
      });

      if (result.requiresTenantSelection) {
        setTenants(result.tenants ?? []);
        return;
      }

      if (result.user?.tenants) rememberMemberships(result.user.tenants);
      router.replace(next);
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative z-10 grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      {/* Left: what the product is. Hidden on small screens so the form leads. */}
      <section className="hidden flex-col justify-between px-12 py-14 lg:flex">
        <div className="vs-display text-lg" style={{ fontWeight: 800 }}>
          VOID<span className="vs-accent">·</span>SPACE
        </div>

        <div className="vs-enter max-w-xl">
          <h1 className="vs-macro">
            The marketplace for
            <br />
            <span
              style={{
                background: 'linear-gradient(100deg, var(--vs-accent-warm), var(--vs-accent-2))',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              licensed 3D assets
            </span>
          </h1>
          <p className="vs-prose mt-6 text-[15px]">
            Upload a model, let it be classified, have it reviewed by a person, watch it pinned to
            IPFS and minted as an on-chain licence. Every step is recorded in a ledger you can read.
          </p>

          <dl className="mt-10 grid gap-6 sm:grid-cols-3">
            {HIGHLIGHTS.map((item, index) => (
              <div key={item.title} className={`vs-enter vs-enter-${index + 1}`}>
                <dt className="text-sm font-semibold">{item.title}</dt>
                <dd className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--vs-fg-faint)' }}>
                  {item.body}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="vs-label">Multi-tenant · RBAC · append-only audit</div>
      </section>

      {/* Right: the form. */}
      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="vs-enter w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <div className="vs-display text-xl" style={{ fontWeight: 800 }}>
              VOID<span className="vs-accent">·</span>SPACE
            </div>
          </div>

          <div className="vs-panel p-6 sm:p-7">
            {tenants ? (
              <div className="space-y-4">
                <div>
                  <h2 className="vs-display text-xl">Choose a workspace</h2>
                  <p className="vs-label mt-1.5">You belong to more than one</p>
                </div>
                <div className="space-y-2">
                  {tenants.map((tenant) => (
                    <button
                      key={tenant.id}
                      type="button"
                      className="vs-btn w-full justify-between"
                      onClick={() => void submit(tenant.id)}
                      disabled={busy}
                    >
                      <span>{tenant.name}</span>
                      <span className="vs-card-meta">{tenant.roles.join(' / ')}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="vs-btn vs-btn-quiet w-full justify-center" onClick={() => setTenants(null)}>
                  Back
                </button>
              </div>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <div>
                  <h2 className="vs-display text-2xl">Sign in</h2>
                  <p className="vs-label mt-1.5">Continue to your workspace</p>
                </div>

                <label className="block">
                  <span className="vs-label">Email</span>
                  <input
                    className="vs-input mt-1.5"
                    type="email"
                    value={email}
                    autoComplete="username"
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </label>

                <label className="block">
                  <span className="vs-label">Password</span>
                  <input
                    className="vs-input mt-1.5"
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
                    hint="Demo passwords are VoidSpace!2026"
                  />
                ) : null}

                <button className="vs-btn vs-btn-primary w-full justify-center" type="submit" disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            )}
          </div>

          <div className="vs-panel mt-4 p-4">
            <div className="vs-label">Demo accounts · password VoidSpace!2026</div>
            <ul className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword('VoidSpace!2026');
                    }}
                  >
                    <span className="vs-data block transition-colors hover:text-[var(--vs-accent-warm)]">
                      {account.email}
                    </span>
                    <span className="vs-label">{account.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
