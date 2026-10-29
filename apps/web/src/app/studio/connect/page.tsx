/**
 * Hands the signed-in VOID·SPACE session to VOID·STUDIO.
 *
 * Studio's "Sign in" opens this path. Someone who is already signed in never
 * sees a form: this page mints the editor token and sends the tab to the
 * editor's handoff page, which stores it and closes. Someone who is not
 * signed in is sent through `/login` and returned here afterwards.
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { Wordmark } from '../../../components/market-shell';
import { API_INTERNAL_URL, ApiRequestError, apiFetch } from '../../../lib/api';
import { getServerSession } from '../../../lib/server-session';
import { studioHandoffUrl } from '../../../lib/studio-handoff';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Open Studio — VOID·SPACE',
};

interface StudioTokenResponse {
  readonly token?: string;
  readonly accessToken?: string;
  readonly studioUrl?: string;
}

export default async function StudioConnectPage() {
  const { session } = await getServerSession();
  if (!session) redirect('/login?next=/studio/connect');

  let token: string | null = null;
  let studioUrl: string | undefined;
  let failure = 'Studio could not be opened from this session.';

  try {
    const minted = await apiFetch<StudioTokenResponse>('/auth/studio-token', {
      method: 'POST',
      baseUrl: `${API_INTERNAL_URL}/api/v1`,
      cookieHeader: cookies().toString(),
    });
    token = minted.token ?? minted.accessToken ?? null;
    studioUrl = minted.studioUrl;
  } catch (caught) {
    const apiError = caught as ApiRequestError;
    failure = apiError.message || failure;
  }

  if (token) redirect(studioHandoffUrl(token, studioUrl));

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-base p-6">
      <div className="w-full max-w-[400px]">
        <div className="mb-8">
          <Link href="/" aria-label="VOID·SPACE — home">
            <Wordmark />
          </Link>
        </div>
        <div className="rounded-card border border-hairline bg-surface px-6 py-6 shadow-panel">
          <h1 className="text-2xl font-medium leading-[1.1] tracking-[-0.021em] text-ink">Studio did not open</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{failure}</p>
          <Link
            href="/login?next=/studio/connect"
            className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-control border border-brand bg-brand px-4 text-[14px] font-semibold text-white"
          >
            Sign in again
          </Link>
        </div>
      </div>
    </main>
  );
}
