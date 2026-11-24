'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '../lib/api';
import { LearningLayout, Panel, Notice, action, control } from './learning-ui';
export function LessonJoin() {
  const router = useRouter(),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setCode(new URLSearchParams(location.search).get('code') ?? '');
  }, []);
  return (
    <LearningLayout
      title="Open a lesson"
      description="Use the link or code your educator shared. Your answers and learning progress stay individual."
    >
      <Panel>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            void apiFetch<{ releaseId: string; tenantId: string }>('/learning/lesson-plans/join', {
              method: 'POST',
              body: { code: code.trim() },
            })
              .then((r) =>
                router.replace(`/console/learn/lessons/${r.releaseId}?tenant=${r.tenantId}`),
              )
              .catch((e) => {
                setError(e.message);
                setBusy(false);
              });
          }}
        >
          <label className="grid gap-2">
            Lesson code
            <input
              className={control + ' w-full'}
              value={code}
              autoComplete="off"
              onChange={(e) => setCode(e.target.value)}
              required
              maxLength={160}
            />
          </label>
          <button className={action} disabled={busy || !code.trim()}>
            {busy ? 'Opening…' : 'Open lesson'}
          </button>
          {error && <Notice error>{error}</Notice>}
        </form>
      </Panel>
    </LearningLayout>
  );
}
