'use client';
import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Box, Check, Search, X, ArrowUpRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { action } from './learning-ui';
interface Item {
  reference: string;
  title: string;
  origin: 'private' | 'workspace';
  ownerLabel: string;
  license: string | null;
}
export function ModelPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (reference: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [source, setSource] = useState<'private' | 'workspace'>('private'),
    [search, setSearch] = useState(''),
    [term, setTerm] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  const selected = useQuery({
    queryKey: ['model-picker-selected', value],
    enabled: !!value,
    retry: false,
    queryFn: ({ signal }) =>
      apiFetch<{ item: Item }>(
        `/learning/model-picker/selected?reference=${encodeURIComponent(value)}`,
        { signal },
      ),
  });
  const models = useInfiniteQuery({
    queryKey: ['model-picker', source, term],
    enabled: open,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      apiFetch<{ items: Item[]; nextCursor: string | null }>(
        `/learning/model-picker?source=${source}&q=${encodeURIComponent(term)}${pageParam ? `&cursor=${pageParam}` : ''}`,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = models.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <button
        className="agent-compose-tool model-picker-trigger"
        type="button"
        aria-label="Choose a model for the agent"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Box size={16} />
        <span>{selected.data?.item.title ?? (value ? 'Selected model' : 'Choose a model')}</span>
        <Search size={14} />
      </button>
      <dialog
        ref={dialog}
        className="model-picker-dialog"
        aria-label="Choose a learning model"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <header>
          <div>
            <h2>Choose a model</h2>
            <p>Find a model you can use in this workspace.</p>
          </div>
          <button
            className={action}
            type="button"
            aria-label="Close model picker"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </header>
        <div className="model-picker-search">
          <Search size={18} />
          <input
            autoFocus
            aria-label="Search models"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={120}
            placeholder="Search by model name…"
          />
        </div>
        <div className="model-picker-tabs" role="group" aria-label="Model source">
          <button
            className={action}
            type="button"
            aria-pressed={source === 'private'}
            onClick={() => setSource('private')}
          >
            My private models
          </button>
          <button
            className={action}
            type="button"
            aria-pressed={source === 'workspace'}
            onClick={() => setSource('workspace')}
          >
            Workspace models
          </button>
        </div>
        {selected.error && value && (
          <p role="status">
            The previous model is unavailable in this workspace. Choose another or remove it.
          </p>
        )}
        {models.isPending && <p role="status">Finding your models…</p>}
        {models.error && (
          <p role="alert">
            Models could not load.{' '}
            <button className={action} type="button" onClick={() => void models.refetch()}>
              Try again
            </button>
          </p>
        )}
        {!models.isPending && !models.error && items.length === 0 && (
          <div className="model-picker-empty">
            <Box size={32} />
            <h3>{term ? 'No matching models' : 'No models here yet'}</h3>
            <p>
              {term
                ? 'Try another name or model source.'
                : source === 'private'
                  ? 'Add a model to your library or find one on Sketchfab.'
                  : 'Workspace models appear here after review and approval.'}
            </p>
          </div>
        )}
        <div className="model-picker-results">
          {items.map((item) => (
            <button
              type="button"
              key={item.reference}
              aria-pressed={value === item.reference}
              onClick={() => {
                onChange(item.reference);
                setOpen(false);
              }}
            >
              <span className="model-picker-icon">
                <Box size={26} strokeWidth={1.3} />
              </span>
              <strong>{item.title}</strong>
              <span>{item.ownerLabel}</span>
              {item.license && <small>{item.license}</small>}
              {value === item.reference && <Check size={18} aria-label="Selected" />}
            </button>
          ))}
        </div>
        {models.hasNextPage && (
          <button
            className={action}
            type="button"
            disabled={models.isFetchingNextPage}
            onClick={() => void models.fetchNextPage()}
          >
            {models.isFetchingNextPage ? 'Loading…' : 'Load more models'}
          </button>
        )}
        <footer>
          <Link href="/console/learn/library">
            Open library <ArrowUpRight size={15} />
          </Link>
          <Link href="/console/models">
            Find on Sketchfab <ArrowUpRight size={15} />
          </Link>
          <Link href="/console/catalog">
            Browse marketplace <ArrowUpRight size={15} />
          </Link>
          {value && (
            <button
              className={action}
              type="button"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Remove model
            </button>
          )}
        </footer>
      </dialog>
    </>
  );
}
