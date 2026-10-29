/**
 * First Google sign-in (FR-2.2).
 *
 * The API parks the Google identity in an httpOnly cookie and sends the browser
 * here. This page only asks for the workspace. The email and name already came
 * from Google.
 */
import Link from 'next/link';

import { Wordmark } from '../../../components/market-shell';
import { safeNextPath } from '../../../lib/server-session';
import { GoogleWorkspaceForm } from './workspace-form';

export const metadata = {
  title: 'Create your workspace — VOID·SPACE',
};

export default function GoogleWorkspacePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const next = safeNextPath(searchParams.next);
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-base p-6">
      <div className="w-full max-w-[400px] py-12">
        <div className="mb-8">
          <Link href="/" aria-label="VOID·SPACE — home">
            <Wordmark />
          </Link>
        </div>
        <div className="rounded-card border border-hairline bg-surface px-6 py-6 shadow-panel">
          <h1 className="text-2xl font-medium leading-[1.1] tracking-[-0.021em] text-ink">Create your workspace</h1>
          <p className="mt-1.5 text-[12px] tracking-[0.01em] text-ink-faint">
            This Google account is new here. Name the workspace you will own.
          </p>
          <GoogleWorkspaceForm next={next} />
        </div>
      </div>
    </main>
  );
}
