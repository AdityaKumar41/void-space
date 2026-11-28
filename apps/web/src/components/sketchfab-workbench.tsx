'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Box, Play } from 'lucide-react';
import { sketchfabEmbedUrl, sketchfabModelId, type SketchfabModel } from '@void-space/types';
import { apiFetch, apiDownload } from '../lib/api';
import { useSession } from '../lib/session';
import { Button } from './ui/button';

const field = 'w-full rounded-control border border-hairline bg-base p-3 text-sm text-ink';

function SearchPreview({ model }: { model: SketchfabModel }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="sketchfab-result-preview">
      {model.thumbnail && !failed ? (
        // Third-party thumbnails use the browser directly; no server image proxy is needed.
        <img
          src={model.thumbnail}
          alt={model.name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="sketchfab-preview-missing">
          <Box size={32} aria-hidden="true" />
          Preview unavailable
        </span>
      )}
      <span className="sketchfab-preview-action">
        <Play size={14} aria-hidden="true" />
        View in 3D
      </span>
    </span>
  );
}

/** Shared exploration surface. No assessment state or answers enter this component. */
export function SketchfabWorkbench({
  initialLink = '',
  compact = false,
}: {
  initialLink?: string;
  compact?: boolean;
}) {
  const { can } = useSession();
  const router = useRouter();
  const canImportPrivate = can('learning:generate-private') || can('learning:manage');
  const [input, setInput] = useState(initialLink);
  const [model, setModel] = useState<SketchfabModel | null>(null);
  const [results, setResults] = useState<SketchfabModel[]>([]);
  const [status, setStatus] = useState<{
    configured: boolean;
    connected: boolean;
  } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerMode, setAnswerMode] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [frameVersion, setFrameVersion] = useState(0);
  const sequence = useRef(0);
  const viewer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (model && results.length)
      viewer.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [model?.uid, results.length]);
  useEffect(() => {
    if (compact) return;
    let active = true;
    apiFetch<{ configured: boolean; connected: boolean }>('/tools/sketchfab/status')
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, [compact]);
  useEffect(() => {
    const uid = sketchfabModelId(initialLink);
    if (!uid) return;
    let active = true;
    apiFetch<{ model: SketchfabModel }>(`/tools/sketchfab/models/${uid}`)
      .then((value) => {
        if (active) setModel(value.model);
      })
      .catch(() => {
        // A public embed still works while the Space API is unavailable; retain an honest attribution link.
        if (active)
          setModel({
            uid,
            name: 'Sketchfab model',
            author: 'See model page',
            license: 'See model page',
            downloadable: false,
            thumbnail: null,
            url: `https://sketchfab.com/3d-models/${uid}`,
          });
      });
    return () => {
      active = false;
    };
  }, [initialLink]);

  async function search() {
    if (busy) return;
    const request = ++sequence.current;
    setBusy(true);
    setError('');
    setAnswer('');
    setResults([]);
    setModel(null);
    setLoaded(false);
    try {
      const uid = sketchfabModelId(input);
      if (!uid && (/^https?:/i.test(input.trim()) || /^[a-z]+:\/\//i.test(input)))
        throw new Error(
          'Use a full https://sketchfab.com/3d-models/… link. Short links and other websites are not accepted.',
        );
      if (uid) {
        const data = await apiFetch<{ model: SketchfabModel }>(
          `/tools/sketchfab/models/${uid}`,
        ).catch(() => ({
          model: {
            uid,
            name: 'Sketchfab model',
            author: 'See model page',
            license: 'See model page',
            downloadable: false,
            thumbnail: null,
            url: `https://sketchfab.com/3d-models/${uid}`,
          },
        }));
        if (request === sequence.current) {
          setModel(data.model);
          setResults([]);
          setLoaded(false);
        }
      } else {
        if (!input.trim()) throw new Error('Enter a model link or search words.');
        const data = await apiFetch<{ models: SketchfabModel[] }>(
          `/tools/sketchfab/find?q=${encodeURIComponent(input.trim())}`,
        );
        if (request === sequence.current) {
          setResults(data.models);
          if (!data.models.length)
            setError('No downloadable models matched. Try different words or paste a shared link.');
        }
      }
    } catch (caught) {
      if (request === sequence.current)
        setError(caught instanceof Error ? caught.message : 'Sketchfab could not be reached.');
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  async function connect() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch<{ url: string }>('/tools/sketchfab/connect', {
        method: 'POST',
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect');
      setBusy(false);
    }
  }
  async function download() {
    if (!model || busy) return;
    setBusy(true);
    setError('');
    try {
      const blob = await apiDownload(`/tools/sketchfab/models/${model.uid}/download`);
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `sketchfab-${model.uid}.glb`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setAnswer(
        `Downloaded ${model.name}. Use a compatible 3D editor to edit it. Attribution: ${model.name} by ${model.author}, ${model.license}, ${model.url}. Keep this attribution with your project and follow the license.`,
      );
      setAnswerMode('Download');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Download failed');
    } finally {
      setBusy(false);
    }
  }
  async function ask() {
    if (!model || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch<{ answer: string; mode: string }>('/tools/sketchfab/mentor', {
        method: 'POST',
        body: { uid: model.uid, question },
      });
      setAnswer(result.answer);
      setAnswerMode(
        result.mode === 'ai' ? 'AI exploration guide · metadata only' : 'Reference guide',
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Guide unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Sketchfab model exploration"
      className="space-y-4 rounded-card border border-hairline bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Explore Sketchfab models</h2>
          <p className="mt-1 text-sm text-ink-dim">
            View shared models, inspect them from different angles, and keep author credit.
          </p>
        </div>
        {!compact && (
          <div className="flex flex-wrap gap-2">
            {status?.connected ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  try {
                    await apiFetch('/tools/sketchfab/disconnect', { method: 'POST' });
                    setStatus((value) => (value ? { ...value, connected: false } : null));
                  } catch {
                    setError('Could not disconnect. Try again.');
                  }
                }}
              >
                Disconnect Sketchfab
              </Button>
            ) : (
              <Button variant="outline" disabled={busy || !status?.configured} onClick={connect}>
                Connect Sketchfab
              </Button>
            )}
          </div>
        )}
      </div>
      {!compact && status && !status.configured && (
        <p className="text-sm text-ink-dim">
          Shared links work now. Account connection and editable downloads become available after
          Sketchfab approves this application.
        </p>
      )}
      {!compact && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <label className="min-w-[220px] flex-1">
            <span className="sr-only">Sketchfab model link or search</span>
            <input
              className={field}
              value={input}
              maxLength={1000}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste a Sketchfab model link or search models"
            />
          </label>
          <Button disabled={busy || !input.trim()} type="submit">
            {busy ? 'Working…' : 'Find model'}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-state-rejected">
          {error}
        </p>
      )}
      {!compact && !status && (
        <p className="text-xs text-ink-dim">
          Account status is unavailable. Shared model links still work; reconnect to Void Space to
          use account features.
        </p>
      )}
      {results.length > 0 && (
        <ul className="sketchfab-results" aria-label="Sketchfab search results">
          {results.map((result) => (
            <li key={result.uid}>
              <button
                type="button"
                disabled={busy}
                className="sketchfab-result-card"
                aria-label={`Preview ${result.name}`}
                aria-pressed={model?.uid === result.uid}
                onClick={() => {
                  sequence.current++;
                  setBusy(false);
                  setModel(result);
                  setLoaded(false);
                  setAnswer('');
                  setError('');
                }}
              >
                <SearchPreview key={`${result.uid}:${result.thumbnail}`} model={result} />
                <span className="sketchfab-result-caption">
                  <strong>{result.name}</strong>
                  <span>
                    {result.author} · {result.license}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {model && (
        <>
          <div
            className="overflow-hidden rounded-control border border-hairline bg-deeper"
            ref={viewer}
          >
            <iframe
              key={`${model.uid}-${frameVersion}`}
              title={`${model.name} — interactive Sketchfab viewer`}
              src={sketchfabEmbedUrl(model.uid)}
              loading="lazy"
              allow="fullscreen; xr-spatial-tracking"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="h-[440px] max-h-[65vh] w-full border-0"
              onLoad={() => setLoaded(true)}
            />
          </div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">{model.name}</p>
              <p className="text-sm text-ink-dim">
                By {model.author} · {model.license}
              </p>
              <a
                className="text-sm text-brand underline"
                href={model.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Original model, license and author
              </a>
              <p className="mt-1 text-xs text-ink-dim">
                {loaded
                  ? 'Drag to orbit; scroll to zoom. Available inspection modes and annotations depend on the model.'
                  : 'Opening interactive viewer… If it stays blank, use the original model link.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setLoaded(false);
                  setFrameVersion((value) => value + 1);
                }}
              >
                Reset view
              </Button>
              {!compact && model.downloadable && (
                <>
                  {canImportPrivate && (
                    <Button
                      disabled={busy || !status?.connected}
                      onClick={async () => {
                        if (!model) return;
                        setBusy(true);
                        setError('');
                        try {
                          const result = await apiFetch<{ model: { id: string } }>(
                            `/tools/sketchfab/models/${model.uid}/import`,
                            { method: 'POST' },
                          );
                          router.push(`/console/learn/library?model=${result.model.id}`);
                        } catch (error) {
                          setError((error as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Import to my private library
                    </Button>
                  )}
                  {can('asset:upload-own') && (
                    <Button disabled={busy || !status?.connected} onClick={download}>
                      Download editable GLB
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
          {!compact && (
            <>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask();
                }}
              >
                <label className="min-w-[200px] flex-1">
                  <span className="sr-only">Ask the exploration guide</span>
                  <input
                    className={field}
                    maxLength={1500}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="Ask how to inspect or reuse this model"
                  />
                </label>
                <Button
                  variant="outline"
                  type="submit"
                  disabled={busy || question.trim().length < 2}
                >
                  Ask guide
                </Button>
              </form>
              <p className="text-xs text-ink-dim">
                The guide uses model metadata and exploration instructions. It cannot see this
                model’s geometry. Use the lesson mentor for lesson content.
              </p>
            </>
          )}
          {answer && (
            <div
              role="status"
              className="rounded-control border border-hairline p-3 text-sm text-ink"
            >
              <p className="mb-1 text-xs text-ink-dim">{answerMode}</p>
              <p className="whitespace-pre-wrap">{answer}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
