/** @type {import('next').NextConfig} */
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig = {
  // Isolated verification builds must not overwrite a running dev server's output.
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  reactStrictMode: true,
  // Workspace packages ship TypeScript source (see README "package strategy"),
  // so Next compiles them alongside the app.
  transpilePackages: ['@void-space/types'],
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
  /**
   * Browser API calls are relative (`/api/v1/...`) because in the deployed stack nginx terminates
   * that prefix and proxies it to the API. When Next is reached *directly* — `next dev` or
   * `next start` on :3000, which is how the app is developed and how the UI audit drives it —
   * nothing sits in front of it, so the same path is answered by Next's own router with a 404 and
   * every interactive surface looks broken: sign-in, catalogue filtering, the console.
   *
   * These rewrites make the bare origin work without changing the deployed path. In the container
   * stack they are never reached, because nginx resolves `/api/*` before the request arrives here.
   */
  async redirects() {
    return [
      {
        source: '/console/notifications',
        destination: '/console/learn/notifications',
        permanent: false,
      },
      { source: '/console/account', destination: '/console/learn/settings', permanent: false },
      { source: '/console/help', destination: '/console/learn/help', permanent: false },
      ...[
        'classes',
        'campus',
        'lessons',
        'simulations',
        'spaces',
        'field-guides',
        'career',
        'ventures',
      ].map((page) => ({
        source: `/console/${page}/:path*`,
        destination: '/console/learn',
        permanent: false,
      })),
      ...['activities', 'programs', 'author'].map((page) => ({
        source: `/console/learn/${page}/:path*`,
        destination: '/console/learn',
        permanent: false,
      })),
      {
        source:
          '/console/learn/:id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})',
        destination: '/console/learn',
        permanent: false,
      },
      { source: '/asset-workspace', destination: '/console/library', permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: '/catalog/:assetId', destination: '/m/:assetId' },
      { source: '/api/:path*', destination: `${API_INTERNAL_URL}/api/:path*` },
    ];
  },

};

export default nextConfig;
