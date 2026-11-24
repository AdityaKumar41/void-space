'use client';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { useSession } from './session';
export function useLearningProfile() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['learning-profile', session?.tenant.id, session?.user.id],
    enabled: !!session,
    queryFn: () =>
      apiFetch<{
        workspace: { id: string; name: string; kind: string };
        persona: 'individual' | 'teacher' | 'student';
      }>('/learning/workspace/profile'),
    staleTime: 30000,
  });
}
