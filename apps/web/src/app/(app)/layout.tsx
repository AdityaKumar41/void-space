/**
 * Console layout (server component).
 *
 * This exists only to pin the route-segment configuration: every screen behind it is
 * authenticated and reads the caller's session from cookies, so it must be rendered per
 * request. Without this, Next tries to prerender the console at build time, where there is no
 * request, no session and therefore no query provider context — which is exactly the
 * `useContext` failure the build used to hit.
 *
 * Static prerendering remains appropriate for `/login`, which is the same for everyone.
 */
import { AppShell } from '../../components/app-shell';

export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
