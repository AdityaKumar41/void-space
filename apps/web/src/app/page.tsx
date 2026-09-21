import type { HealthResponse } from '@void-space/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@void-space/ui';

import { apiFetch } from '@/lib/api';

/**
 * Phase-0 landing surface: proves the full stack is talking to itself —
 * web (server component) -> Fastify API -> Postgres / IPFS / Anvil.
 *
 * The authenticated dashboards (Creator, Assessor, Admin) replace this in the
 * UI phases; see the roadmap card below for the build order.
 */
export const dynamic = 'force-dynamic';

const DEPENDENCY_LABELS: Record<string, string> = {
  postgres: 'PostgreSQL 16 (RLS)',
  ipfs: 'IPFS node (Kubo)',
  anvil: 'Anvil local EVM chain',
  claude: 'Claude API (AI enrichment)',
  contract: 'AssetLicenseRegistry.sol',
};

function statusClasses(status: string): string {
  switch (status) {
    case 'up':
      return 'bg-status-approved/15 text-status-approved border-status-approved/30';
    case 'down':
      return 'bg-status-rejected/15 text-status-rejected border-status-rejected/30';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export default async function HomePage() {
  const health = await apiFetch<HealthResponse>('/api/v1/health');

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-[0.35em] text-signal-muted">VOID·SPACE</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Multi-tenant 3D asset management with on-chain licensing
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Built to VS-SRS-2.0 §3: Next.js + Fastify + Prisma/PostgreSQL (row-level-security
          tenancy), IPFS content-addressed storage, and an ERC-721 licence registry running on a
          local Anvil chain — all brought up with <code className="hash">pnpm dev:up</code>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            Platform health
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                health.ok
                  ? statusClasses(health.data?.status === 'ok' ? 'up' : 'degraded')
                  : statusClasses('down')
              }`}
            >
              {health.ok ? (health.data?.status ?? 'unknown') : 'unreachable'}
            </span>
          </CardTitle>
          <CardDescription>
            {health.ok
              ? `API v${health.data?.version} · up ${health.data?.uptimeSeconds}s`
              : `Could not reach the API (${health.error ?? 'unknown error'}). Run \`pnpm dev:up\` and \`pnpm dev\`.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {health.ok
            ? Object.entries(health.data?.dependencies ?? {}).map(([name, dependency]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-md border border-border bg-void-900/60 px-4 py-3"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      {DEPENDENCY_LABELS[name] ?? name}
                    </span>
                    {dependency.detail ? (
                      <span className="hash text-muted-foreground">{dependency.detail}</span>
                    ) : null}
                  </div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${statusClasses(
                      dependency.status,
                    )}`}
                  >
                    {dependency.status}
                  </span>
                </div>
              ))
            : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Build status</CardTitle>
          <CardDescription>
            Phases 0–2 (monorepo + local stack, licensing contract, data layer with RLS) are
            implemented and verified. API feature modules and the UI follow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            <li>✅ Phase 0 — monorepo, Docker stack, edge proxy, dev scripts</li>
            <li>✅ Phase 1 — AssetLicenseRegistry.sol (35 forge tests)</li>
            <li>✅ Phase 2 — Prisma schema, RLS policies, seed, isolation tests</li>
            <li>⏳ Phase 3 — API core: auth, RBAC, tenancy (next)</li>
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
