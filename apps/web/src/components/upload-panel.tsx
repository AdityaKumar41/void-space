'use client';

/**
 * Asset intake (SRS FR-3.1, FR-3.2, FR-3.3, NFR-SEC.3).
 *
 * The client enforces the same rules the API does — allowed extension, 200 MB ceiling, and the
 * tenant's allowed categories (FR-14.3) — so an operator gets told *before* a 200 MB upload
 * starts rather than after it fails. The server re-validates everything regardless: this is
 * feedback, not a security boundary.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ALLOWED_ASSET_EXTENSIONS, MAX_ASSET_SIZE_BYTES, SOURCE_TOOLS } from '@void-space/types';

import { ApiRequestError, apiUpload } from '../lib/api';
import { formatBytes } from '../lib/format';
import { ErrorNote } from './ui-kit';

const EXTENSIONS: readonly string[] = ALLOWED_ASSET_EXTENSIONS;

export function UploadPanel({ categories }: { categories: readonly string[] }) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(categories[0] ?? 'Other');
  const [tags, setTags] = useState('');
  const [sourceTool, setSourceTool] = useState<string>('Blender');
  const [submitForReview, setSubmitForReview] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function chooseFile(next: File | null) {
    setError(null);
    setDone(null);

    if (!next) {
      setFile(null);
      return;
    }

    const extension = `.${next.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (!EXTENSIONS.includes(extension)) {
      setError({ message: `Unsupported type ${extension}. Allowed: ${EXTENSIONS.join(', ')}`, code: 'VALIDATION_ERROR' });
      setFile(null);
      return;
    }
    if (next.size > MAX_ASSET_SIZE_BYTES) {
      setError({
        message: `File is ${formatBytes(next.size)}; the ceiling is ${formatBytes(MAX_ASSET_SIZE_BYTES)}`,
        code: 'PAYLOAD_TOO_LARGE',
      });
      setFile(null);
      return;
    }

    setFile(next);
    if (name.trim().length === 0) {
      setName(next.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
    }
  }

  async function upload() {
    if (!file) return;

    setError(null);
    setProgress(0);

    const form = new FormData();
    // Field order matters: the API streams the file last, after it has the metadata.
    form.append('name', name.trim());
    form.append('category', category);
    form.append('tags', tags);
    form.append('sourceTool', sourceTool);
    form.append('submitForReview', submitForReview ? 'true' : 'false');
    form.append('file', file);

    try {
      await apiUpload('/assets', form, setProgress);
      setDone(`${name.trim()} ingested${submitForReview ? ' and queued for review' : ' as a draft'}`);
      setFile(null);
      setName('');
      setTags('');
      if (inputRef.current) inputRef.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (caught) {
      const apiError = caught as ApiRequestError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="p-3">
      <div
        className="border border-dashed p-4"
        style={{ borderColor: file ? 'var(--vs-accent)' : 'var(--vs-line-strong)' }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          chooseFile(event.dataTransfer.files[0] ?? null);
        }}
      >
        <div className="vs-label">Drop a model here, or</div>
        <input
          ref={inputRef}
          type="file"
          accept={EXTENSIONS.join(',')}
          className="vs-data mt-2 block w-full text-[11px]"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
        />
        <div className="vs-label mt-2">
          {EXTENSIONS.join(' ')} / MAX {formatBytes(MAX_ASSET_SIZE_BYTES)}
        </div>
        {file ? (
          <div className="vs-data mt-3 flex justify-between">
            <span className="truncate">{file.name}</span>
            <span>{formatBytes(file.size)}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className="vs-label">Name</span>
          <input className="vs-input mt-1" value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        <label className="block">
          <span className="vs-label">Category {categories.length > 0 ? '(tenant-restricted)' : ''}</span>
          <select className="vs-select mt-1" value={category} onChange={(event) => setCategory(event.target.value)}>
            {(categories.length > 0 ? categories : ['Other']).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="vs-label">Source tool</span>
          <select className="vs-select mt-1" value={sourceTool} onChange={(event) => setSourceTool(event.target.value)}>
            {SOURCE_TOOLS.map((tool) => (
              <option key={tool} value={tool}>
                {tool}
              </option>
            ))}
          </select>
        </label>

        <label className="block md:col-span-2">
          <span className="vs-label">Tags (comma separated)</span>
          <input className="vs-input mt-1" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="helmet, safety, ppe" />
        </label>

        <label className="vs-data flex items-center gap-2 md:col-span-2">
          <input
            type="checkbox"
            checked={submitForReview}
            onChange={(event) => setSubmitForReview(event.target.checked)}
          />
          SUBMIT FOR REVIEW ON UPLOAD
        </label>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorNote message={error.message} code={error.code} />
        </div>
      ) : null}

      {done ? <div className="vs-data vs-signal mt-3">&gt;&gt;&gt; {done}</div> : null}

      {progress !== null ? (
        <div className="mt-3">
          <div className="vs-label">Uploading {progress}%</div>
          <div className="mt-1 h-1 w-full" style={{ background: 'var(--vs-line-strong)' }}>
            <div className="h-1" style={{ width: `${progress}%`, background: 'var(--vs-accent)' }} />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="vs-btn vs-btn-primary mt-4 w-full justify-center"
        disabled={!file || progress !== null || name.trim().length === 0}
        onClick={() => void upload()}
      >
        {progress !== null ? 'TRANSMITTING…' : 'INGEST ASSET'}
      </button>
    </div>
  );
}
