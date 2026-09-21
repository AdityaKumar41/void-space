/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (see README "package strategy"),
  // so Next compiles them alongside the app.
  transpilePackages: ['@void-space/ui', '@void-space/types'],
  experimental: {
    // 200 MB asset uploads go through the API, not Next's actions, so keep the
    // default body limit; this only affects server actions.
    serverActions: { bodySizeLimit: '2mb' },
  },
  // The browser talks to the API through the nginx edge (§3.1); server-side
  // renders use the internal URL so they never need TLS locally.
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api/v1',
  },
  eslint: {
    // Lint is run from the monorepo root (`pnpm lint`).
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
