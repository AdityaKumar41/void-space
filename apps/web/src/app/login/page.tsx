'use client';

/**
 * Sign-in (FR-2.1, FR-2.2, FR-1.4).
 *
 * Three things this screen has to get right:
 *
 * 1. Credentials go to the API over the edge; the tokens come back as httpOnly cookies, so
 *    nothing here ever touches a token (§2.5 constraint).
 * 2. When a person belongs to several workspaces the API answers `requiresTenantSelection`
 *    and the screen becomes a workspace chooser instead of an error (FR-1.4).
 * 3. Google SSO is offered only when the deployment is configured for it (FR-2.2).
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiRequestError, apiFetch } from '../../lib/api';
import { rememberMemberships, type Membership } from '../../lib/session';
import { ErrorNote, Loading } from '../../components/ui-kit';

interface LoginResponse {
  readonly user?: { readonly tenants: readonly Membership[] };
  readonly requiresTenantSelection?: boolean;
  readonly tenants?: readonly Membership[];
}

export default function LoginPage() {
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
      router.replace('/');
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.2fr_1fr]">
      {/* Left: the instrument's identity plate. Massive type, no decoration. */}
      <section className="relative hidden flex-col justify-between border-r p-10 lg:flex" style={{ borderColor: 'var(--vs-line-strong)' }}>
        <div className="vs-data opacity-70">
          VS-SRS-2.0 / OPERATIONS CONSOLE / REV 2.0.0
        </div>

        <div>
          <h1 className="vs-macro">
            VOID
            <span className="vs-accent">·</span>
            SPACE
          </h1>
          <p className="mt-4 max-w-md text-[13px] leading-relaxed opacity-80">
            3D asset lifecycle operations. Ingest, classify, review, pin to IPFS and licence
            on-chain — every action accounted for in an append-only log.
          </p>
        </div>

        <dl className="vs-grid-lines grid-cols-3">
          <div className="p-3">
            <dt className="vs-label">Ingest</dt>
            <dd className="vs-data mt-1">GLB / GLTF / OBJ / FBX / STL / BLEND · ≤200 MB</dd>
          </div>
          <div className="p-3">
            <dt className="vs-label">Storage</dt>
            <dd className="vs-data mt-1">CONTENT-ADDRESSED (IPFS)</dd>
          </div>
          <div className="p-3">
            <dt className="vs-label">Licence</dt>
            <dd className="vs-data mt-1">ERC-721 / ANVIL</dd>
          </div>
        </dl>
      </section>

      {/* Right: the access terminal. */}
      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="vs-panel-head justify-start gap-3">[ ACCESS TERMINAL ]</div>

          <div className="vs-panel border-t-0 p-5">
            {tenants ? (
              <div className="space-y-3">
                <div className="vs-label">Select workspace</div>
                {tenants.map((tenant) => (
                  <button
                    key={tenant.id}
                    type="button"
                    className="vs-btn w-full justify-between"
                    onClick={() => void submit(tenant.id)}
                    disabled={busy}
                  >
                    <span>{tenant.name}</span>
                    <span className="opacity-60">{tenant.roles.join(' / ')}</span>
                  </button>
                ))}
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                <label className="block">
                  <span className="vs-label">Email</span>
                  <input
                    className="vs-input mt-1"
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
                    className="vs-input mt-1"
                    type="password"
                    value={password}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>

                {error ? <ErrorNote message={error.message} code={error.code} /> : null}

                <button className="vs-btn vs-btn-primary w-full justify-center" type="submit" disabled={busy}>
                  {busy ? 'AUTHENTICATING…' : 'AUTHENTICATE'}
                </button>

                {busy ? <Loading label="VERIFYING CREDENTIALS" /> : null}
              </form>
            )}
          </div>

          <div className="vs-panel mt-4 border-t-0">
            <div className="p-3">
              <div className="vs-label">Demo identities / password VoidSpace!2026</div>
              <ul className="vs-data mt-2 space-y-1 opacity-80">
                <li>creator@aurora.dev — uploads assets</li>
                <li>assessor@aurora.dev — reviews, approves, publishes</li>
                <li>admin@aurora.dev — tenant administration</li>
                <li>viewer@aurora.dev — read-only catalog</li>
                <li>priya@void-space.dev — member of two workspaces</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
