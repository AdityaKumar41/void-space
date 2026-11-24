'use client';

import { AgentWorkspaceShell } from './agent-workspace-shell';
import { SessionProvider, useSession } from '../lib/session';
import type { SessionView } from '../lib/session-types';
import { ErrorNote } from './ui/feedback';
export { VoidStudioLaunchButton } from './studio-launch';

function Shell({ children }: { children: React.ReactNode }) {
  const { session, isLoading, error } = useSession();
  const status = (error as { status?: number } | null)?.status;
  if (isLoading || status === 401)
    return (
      <div className="workspace-session" role="status">
        Opening your workspace…
      </div>
    );
  if (!session)
    return (
      <div className="workspace-session">
        <ErrorNote
          message="Your workspace could not be opened."
          hint="Check the connection and try signing in again."
        />
        <a href="/login" className="agent-pill">
          Go to sign in
        </a>
      </div>
    );
  return (
    <AgentWorkspaceShell key={`${session.tenant.id}:${session.user.id}`}>
      {children}
    </AgentWorkspaceShell>
  );
}

export function AppShell({
  children,
  initialSession,
}: {
  children: React.ReactNode;
  initialSession?: SessionView | null;
}) {
  return (
    <SessionProvider initialSession={initialSession} requireAuth>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
