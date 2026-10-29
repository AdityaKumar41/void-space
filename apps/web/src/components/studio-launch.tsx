'use client';

/**
 * Void Studio Launch Action (FR-14.3, FR-15.2).
 *
 * Mints a short-lived bearer token from VOID·SPACE and launches the VOID·STUDIO
 * web editor with authentication and optional scene/asset context.
 */
import React, { useState } from 'react';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/cn';
import { useToast } from './toast';
import { SparklesIcon } from './ui/icons';

export interface VoidStudioLaunchButtonProps {
  readonly assetId?: string;
  readonly name?: string;
  readonly modelUrl?: string;
  readonly format?: string;
  readonly filename?: string;
  readonly variant?: 'nav' | 'action' | 'outline' | 'ghost' | 'primary' | 'secondary';
  readonly size?: 'sm' | 'md' | 'lg' | 'icon';
  readonly className?: string;
  readonly children?: React.ReactNode;
}

export function VoidStudioLaunchButton({
  assetId,
  name,
  modelUrl,
  format,
  filename,
  variant = 'action',
  size = 'md',
  className,
  children,
}: VoidStudioLaunchButtonProps) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const handleLaunch = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);

    // Open during the click. Waiting for the token first drops the user gesture,
    // and the browser then blocks the window with no message on the button.
    const pending = window.open('about:blank', '_blank');
    if (!pending) {
      setBusy(false);
      toast.failure('Studio did not open', 'Allow pop-ups for this site, then try again.');
      return;
    }

    let token: string | null = null;
    let handoffStudioUrl: string | null = null;
    let sessionNote: string | null = null;
    try {
      const res = await apiFetch<{ token?: string; accessToken?: string; expiresIn: number; studioUrl?: string }>(
        '/auth/studio-token',
        { method: 'POST' },
      );
      token = res.token ?? res.accessToken ?? null;
      if (res.studioUrl) {
        handoffStudioUrl = res.studioUrl;
      }
      if (!token) {
        sessionNote = 'Studio opened without a signed-in session. Publishing from the editor will ask you to sign in.';
      }
    } catch (err) {
      console.warn('Could not mint studio handoff token; launching without auth session', err);
      sessionNote = 'Studio opened without a signed-in session. Publishing from the editor will ask you to sign in.';
    }

    const studioBase =
      process.env.NEXT_PUBLIC_STUDIO_URL ||
      (handoffStudioUrl && !handoffStudioUrl.includes('localhost:8443') ? handoffStudioUrl : null) ||
      'http://localhost:5007';
    const params = new URLSearchParams();

    if (token) {
      params.set('token', token);
    }
    if (assetId) {
      params.set('assetId', assetId);
    }
    if (name) {
      params.set('name', name);
    }
    if (format) {
      params.set('format', format.startsWith('.') ? format : `.${format}`);
    }
    if (filename) {
      params.set('filename', filename);
    }
    if (modelUrl) {
      const absoluteModelUrl = modelUrl.startsWith('http')
        ? modelUrl
        : `${window.location.origin}${modelUrl.startsWith('/') ? '' : '/'}${modelUrl}`;
      params.set('modelUrl', absoluteModelUrl);
    }

    const query = params.toString();
    const finalUrl = query.length > 0 ? `${studioBase}/?${query}` : studioBase;

    try {
      pending.location.href = finalUrl;
      try {
        pending.opener = null;
      } catch {
        // Some browsers lock the opened window as soon as it navigates.
      }
      if (sessionNote) {
        toast.info('Studio opened', sessionNote);
      }
    } catch (err) {
      console.warn('Could not navigate the Studio window', err);
      pending.close();
      toast.failure('Studio did not open', 'Check that the editor is running, then try again.');
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'nav') {
    return (
      <button
        type="button"
        onClick={handleLaunch}
        disabled={busy}
        title="Open VOID·STUDIO 3D Editor & AI Copilot"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-1.5 text-[12px] font-semibold text-brand-warm transition-all duration-150 ease-standard hover:border-brand hover:bg-brand/20 hover:text-white disabled:opacity-50',
          className,
        )}
      >
        <SparklesIcon className={cn('h-3.5 w-3.5 text-brand', busy && 'animate-spin')} />
        <span>{busy ? 'Launching…' : children || 'Studio 3D'}</span>
      </button>
    );
  }

  const isOutline = variant === 'outline';
  const isPrimary = variant === 'primary';
  const isGhost = variant === 'ghost';

  return (
    <button
      type="button"
      onClick={handleLaunch}
      disabled={busy}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold transition-all duration-200 ease-standard disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        size === 'icon' && 'h-9 w-9 px-0',
        isPrimary &&
          'border border-brand bg-brand text-white shadow-heat hover:-translate-y-px hover:bg-brand-warm hover:border-brand-warm active:translate-y-0 active:scale-[0.995]',
        isOutline &&
          'border border-hairline-strong bg-transparent text-ink-dim hover:border-hairline hover:bg-veil-6 hover:text-ink',
        isGhost && 'border border-transparent bg-transparent text-ink-dim hover:bg-veil-6 hover:text-ink',
        !isPrimary &&
          !isOutline &&
          !isGhost &&
          'border border-veil-8 bg-veil-6 text-ink hover:bg-veil-12',
        className,
      )}
    >
      <SparklesIcon className={cn('h-4 w-4 text-brand', busy && 'animate-spin')} />
      <span>{busy ? 'Opening Studio…' : children || 'Edit in Void Studio'}</span>
    </button>
  );
}
