'use client';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { UploadCloud, Link2, NotebookPen } from 'lucide-react';
import { apiFetch, API_PUBLIC_BASE } from '../lib/api';
import { Notice, action, control } from './learning-ui';
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
  standalone = false,
}: {
  standalone?: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [title, setTitle] = useState(''),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [links, setLinks] = useState(''),
    [uploads, setUploads] = useState<string[]>([]),
    [method, setMethod] = useState<'files' | 'links' | 'notes'>('files'),
    [open, setOpen] = useState(true),
    [adding, setAdding] = useState(false),
    [search, setSearch] = useState('');
  const attach = (ids: string[]) => {
    const next = [...new Set([...selected, ...ids])];
    if (next.length > 20)
      setError(
        'Up to 20 sources can be attached. Additional saved sources remain available in My sources.',
      );
    onChange(next.slice(0, 20));
  };
  const q = useQuery({
    queryKey: ['learning-sources'],
    queryFn: () => apiFetch<{ sources: Source[] }>('/learning/sources'),
    refetchInterval: (q) =>
      q.state.data?.sources.some((s) => s.status === 'extracting') ? 2000 : false,
  });
  const collections = useQuery({
    queryKey: ['learning-source-collections'],
    queryFn: () =>
      apiFetch<{ collections: { id: string; title: string; sourceIds: string[] }[] }>(
        '/learning/source-collections',
      ),
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
    <SourceContainer
      standalone={standalone}
      open={open}
      onToggle={setOpen}
      selected={selected.length}
    >
      {standalone && (
        <div className="source-library-heading">
          <div>
            <h2>Saved material</h2>
            <p>Select sources to use together in a lesson.</p>
          </div>
          <button className={action} aria-expanded={adding} onClick={() => setAdding(!adding)}>
            {adding ? 'Close add material' : 'Add material'}
          </button>
        </div>
      )}
      <div className="mt-4 space-y-4">
        <div className="source-add-material" hidden={standalone && !adding}>
          <p className="text-sm text-ink-dim">
            Attach notes, documents and public links to ground your drafts. Originals stay private;
            only reviewed excerpts appear in shared lessons. Scanned PDFs need a text layer.
          </p>
          {error && <Notice error>{error}</Notice>}

          <div className="flex flex-wrap gap-2" role="group" aria-label="Add source method">
            {(['files', 'links', 'notes'] as const).map((m) => (
              <button
                key={m}
                className={action}
                aria-pressed={method === m}
                disabled={busy}
                onClick={() => setMethod(m)}
              >
                {m === 'files' ? (
                  <UploadCloud size={16} aria-hidden="true" />
                ) : m === 'links' ? (
                  <Link2 size={16} aria-hidden="true" />
                ) : (
                  <NotebookPen size={16} aria-hidden="true" />
                )}
                {m === 'files' ? 'Upload files' : m === 'links' ? 'Add links' : 'Write notes'}
              </button>
            ))}
          </div>
          <section hidden={method !== 'notes'} className="space-y-4" aria-label="Add notes">
            <label className="grid gap-2">
              Source title (optional)
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
              disabled={busy || text.trim().length < 20}
              onClick={() =>
                void work(async () => {
                  const r = await apiFetch<{ source: Source }>('/learning/sources', {
                    method: 'POST',
                    body: {
                      title: title.trim() || text.trim().split('\n')[0]!.slice(0, 100),
                      text,
                    },
                  });
                  attach([r.source.id]);
                  setTitle('');
                  setText('');
                })
              }
            >
              Save private notes
            </button>
          </section>
          <section
            hidden={method !== 'files'}
            className="space-y-4"
            aria-label="Upload source files"
          >
            <label className="source-upload-target">
              <UploadCloud size={28} aria-hidden="true" />
              <strong>Bring your learning material</strong>
              <span>Choose documents and images from your device</span>
              <small>PDF · Word · PowerPoint · text · images · 10 MB per file</small>
              <input
                aria-label="Add documents and images · 10 MB per file"
                type="file"
                multiple
                accept=".pdf,.docx,.pptx,.txt,image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 20) {
                    setError('Choose at most 20 files per batch.');
                    e.currentTarget.value = '';
                    return;
                  }
                  e.currentTarget.value = '';
                  if (!files.length) return;
                  void work(async () => {
                    const attached: string[] = [];
                    const failures: string[] = [];
                    for (const file of files) {
                      setUploads([`Uploading ${file.name}`]);
                      try {
                        if (file.size > 10 * 1024 * 1024) throw new Error('Exceeds 10 MB');
                        const form = new FormData();
                        form.append('file', file);
                        const r = await fetch(`${API_PUBLIC_BASE}/learning/sources/upload`, {
                          method: 'POST',
                          credentials: 'include',
                          body: form,
                        });
                        const value = await r.json();
                        if (!r.ok) throw new Error(value.message ?? 'Upload failed');
                        attached.push(value.source.id);
                      } catch (error) {
                        failures.push(`${file.name}: ${(error as Error).message}`);
                      }
                    }
                    setUploads([]);
                    attach(attached);
                    if (failures.length) setError(failures.join(' · '));
                  });
                }}
              />
            </label>
            <p className="text-xs text-ink-dim">
              PDF, Word, PowerPoint, text and images. Up to 20 selected sources. Scanned PDFs need a
              text layer.
            </p>
          </section>
          <section
            hidden={method !== 'links'}
            className="space-y-4"
            aria-label="Import source links"
          >
            <label className="grid gap-2">
              Public links · one per line
              <textarea
                className={control}
                value={links}
                onChange={(e) => setLinks(e.target.value)}
                placeholder="https://example.org/study-notes"
                rows={3}
              />
            </label>
            <button
              className={action}
              disabled={busy || !links.trim()}
              onClick={() =>
                void work(async () => {
                  const urls = links.split(/\s+/).filter(Boolean);
                  if (urls.length > 20) throw new Error('Add at most 20 links at a time.');
                  const result = await apiFetch<{
                    results: { sourceId?: string; error?: string; url: string }[];
                  }>('/learning/sources/links', { method: 'POST', body: { urls } });
                  attach(result.results.flatMap((r) => (r.sourceId ? [r.sourceId] : [])));
                  setLinks(
                    result.results
                      .filter((r) => r.error)
                      .map((r) => r.url)
                      .join('\n'),
                  );
                  const errors = result.results.filter((r) => r.error);
                  if (errors.length)
                    setError(errors.map((r) => `${r.url}: ${r.error}`).join(' · '));
                })
              }
            >
              Import links
            </button>
          </section>
          {uploads.map((text) => (
            <p key={text} role="status" className="text-sm">
              {text}
            </p>
          ))}
        </div>
        {error && standalone && !adding && <Notice error>{error}</Notice>}
        {(!!collections.data?.collections.length || selected.length > 0) && (
          <div className="source-collections">
            {' '}
            <div className="flex flex-wrap gap-3">
              <label className="grid gap-2 text-sm">
                Reuse a source collection
                <select
                  className={control}
                  value=""
                  onChange={(e) => {
                    const collection = collections.data?.collections.find(
                      (c) => c.id === e.target.value,
                    );
                    if (collection) attach(collection.sourceIds);
                  }}
                >
                  <option value="">Choose saved sources…</option>
                  {collections.data?.collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {c.sourceIds.length} sources
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={action}
                disabled={busy || !selected.length}
                onClick={() =>
                  void work(async () => {
                    const names =
                      q.data?.sources.filter((s) => selected.includes(s.id)).map((s) => s.title) ??
                      [];
                    await apiFetch('/learning/source-collections', {
                      method: 'POST',
                      body: {
                        title: names.join(', ').slice(0, 200) || 'My sources',
                        sourceIds: selected,
                      },
                    });
                    await collections.refetch();
                  })
                }
              >
                Save selection as collection
              </button>
            </div>
          </div>
        )}
        {q.error && (
          <Notice error>
            {q.error.message} <button onClick={() => void q.refetch()}>Retry</button>
          </Notice>
        )}
        <label className="source-library-search">
          Search saved material
          <input
            className={control}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find notes, documents or images…"
          />
        </label>
        {q.isPending && <p role="status">Loading your material…</p>}
        {q.data?.sources.length === 0 && (
          <div className="source-library-empty">
            <UploadCloud size={28} aria-hidden="true" />
            <h3>Your material belongs here</h3>
            <p>
              Add a document, paste notes or save links. Then select what your agent should use.
            </p>
          </div>
        )}
        {q.data &&
          q.data.sources.length > 0 &&
          !q.data.sources.some((s) => s.title.toLowerCase().includes(search.toLowerCase())) && (
            <p role="status">No sources match “{search}”. Try another search.</p>
          )}
        <div className="source-library-list">
          {q.data?.sources
            .filter((s) => s.title.toLowerCase().includes(search.toLowerCase()))
            .map((s) => (
              <div key={s.id} className="source-library-item">
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={`${s.title} · ${s.status}`}
                    disabled={
                      s.status !== 'ready' || (!selected.includes(s.id) && selected.length >= 20)
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
                  <span className="source-item-title">
                    <strong>{s.title}</strong>
                    <small>
                      {s.status === 'ready'
                        ? 'Ready to use'
                        : s.status === 'extracting'
                          ? 'Preparing material…'
                          : s.status === 'failed'
                            ? 'Needs attention'
                            : s.status}
                    </small>
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
                {s.status === 'failed' && !s.mime.startsWith('image/') && (
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
                        Page {p.page}: {p.text}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            ))}
        </div>
      </div>
    </SourceContainer>
  );
}

function SourceContainer({
  standalone,
  open,
  onToggle,
  selected,
  children,
}: {
  standalone: boolean;
  open: boolean;
  onToggle: (open: boolean) => void;
  selected: number;
  children: ReactNode;
}) {
  if (standalone) return <section className="source-library">{children}</section>;
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
      className="rounded-xl border border-hairline p-4"
    >
      <summary className="cursor-pointer py-2 font-medium">
        Sources · {selected} selected (optional)
      </summary>
      {children}
    </details>
  );
}
