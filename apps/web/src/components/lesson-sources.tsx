'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch, API_PUBLIC_BASE } from '../lib/api';
import { Panel, Notice, action, control } from './learning-ui';
interface Source {
  id: string;
  title: string;
  mime: string;
  metadata?: { generated?: boolean; reviewed?: boolean };
  status: string;
  error: string | null;
  passages: { id: string; page: number; text: string }[];
}
export function LessonSources({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [title, setTitle] = useState(''),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['learning-sources'],
    queryFn: () => apiFetch<{ sources: Source[] }>('/learning/sources'),
    refetchInterval: (q) =>
      q.state.data?.sources.some((s) => s.status === 'extracting') ? 2000 : false,
  });
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await q.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-xl border border-hairline p-4">
      <summary className="cursor-pointer py-2 font-medium">
        Sources · {selected.length} selected (optional)
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-ink-dim">
          Notes and text PDFs help ground the draft. Originals stay private; only reviewed excerpts
          appear in shared lessons. Scanned PDFs need a text layer.
        </p>
        {error && <Notice error>{error}</Notice>}
        {q.error && <Notice error>{q.error.message}</Notice>}
        <label className="grid gap-2">
          Source title
          <input
            className={control}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="grid gap-2">
          Paste notes
          <textarea
            className={control + ' min-h-28'}
            maxLength={100000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button
          className={action}
          disabled={busy || title.trim().length < 3 || text.trim().length < 20}
          onClick={() =>
            void work(async () => {
              const r = await apiFetch<{ source: Source }>('/learning/sources', {
                method: 'POST',
                body: { title, text },
              });
              onChange([...selected, r.source.id]);
              setTitle('');
              setText('');
            })
          }
        >
          Save private notes
        </button>
        <label className="grid gap-2">
          Upload text PDF or approved image (10 MB maximum)
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void work(async () => {
                const form = new FormData();
                form.append('file', file);
                const r = await fetch(`${API_PUBLIC_BASE}/learning/sources/upload`, {
                  method: 'POST',
                  credentials: 'include',
                  body: form,
                });
                const value = await r.json();
                if (!r.ok) throw new Error(value.message ?? 'Source upload failed');
                onChange([...selected, value.source.id]);
              });
              e.currentTarget.value = '';
            }}
          />
        </label>
        <div className="space-y-2">
          {q.data?.sources.map((s) => (
            <div key={s.id} className="rounded-lg border border-hairline p-3">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  disabled={
                    s.status !== 'ready' || (!selected.includes(s.id) && selected.length >= 5)
                  }
                  checked={selected.includes(s.id)}
                  onChange={() =>
                    onChange(
                      selected.includes(s.id)
                        ? selected.filter((x) => x !== s.id)
                        : [...selected, s.id],
                    )
                  }
                />
                <span>
                  {s.title} · {s.status}
                </span>
              </label>
              {s.mime.startsWith('image/') && s.status === 'ready' && (
                <div className="grid gap-2">
                  <img
                    src={`${API_PUBLIC_BASE}/learning/sources/${s.id}/file`}
                    alt={s.title}
                    className="max-h-56 w-full rounded-lg object-contain"
                  />
                  {s.metadata?.generated && (
                    <p className="text-xs text-ink-dim">
                      AI-generated illustration · check facts and labels before teaching
                    </p>
                  )}
                  <a
                    className="underline text-sm"
                    href={`${API_PUBLIC_BASE}/learning/sources/${s.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open full image
                  </a>
                </div>
              )}
              {s.error && (
                <p role="alert" className="text-sm text-red-400">
                  {s.error}
                </p>
              )}
              {s.status === 'failed' && s.mime === 'application/pdf' && (
                <button
                  className={action}
                  disabled={busy}
                  onClick={() =>
                    void work(async () => {
                      await apiFetch(`/learning/sources/${s.id}/retry`, { method: 'POST' });
                    })
                  }
                >
                  Retry extraction
                </button>
              )}
              {s.passages.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-sm">View source passages</summary>
                  {s.passages.map((p) => (
                    <p key={p.id} className="mt-2 text-sm">
                      {p.id} · page {p.page}: {p.text}
                    </p>
                  ))}
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
