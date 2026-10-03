'use client';

/**
 * Marketplace Engagement UI (FR-5.2, §6.1).
 *
 * Full-fidelity interactive component for:
 * 1. Liking models with live count and optimistic toggle.
 * 2. Reading public comments with author identity & workspace badges.
 * 3. Adding comments (authenticated members, max 2000 chars).
 * 4. Author retraction and workspace moderator removals with reasons.
 */
import Link from 'next/link';
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch, ApiRequestError } from '../lib/api';
import { formatRelative, formatNumber } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from './toast';
import { Avatar } from './ui/avatar';
import { HeartIcon, ChatBubbleIcon } from './ui/icons';
import { cn } from '../lib/cn';

export interface CommentView {
  readonly id: string;
  readonly assetId: string;
  readonly body: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorTenantName: string;
  readonly createdAt: string;
  readonly mine: boolean;
  readonly canHide: boolean;
  readonly hidden: boolean;
  readonly hiddenReason: string | null;
}

export interface EngagementSummary {
  readonly assetId: string;
  readonly likes: number;
  readonly comments: number;
  readonly viewerLiked: boolean;
}

export function MarketplaceEngagement({ assetId }: { assetId: string }) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const toast = useToast();

  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [moderatingId, setModeratingId] = useState<string | null>(null);
  const [moderationReason, setModerationReason] = useState('');
  const [inFlightLike, setInFlightLike] = useState(false);

  // Engagement counts & like status
  const engagementQuery = useQuery<EngagementSummary>({
    queryKey: ['marketplace-engagement', assetId],
    queryFn: () => apiFetch<EngagementSummary>(`/public/catalog/${assetId}/engagement`),
  });

  // Comments list
  const commentsQuery = useQuery<{ total: number; items: CommentView[] }>({
    queryKey: ['marketplace-comments', assetId],
    queryFn: () => apiFetch<{ total: number; items: CommentView[] }>(`/public/catalog/${assetId}/comments?limit=100`),
  });

  const summary = engagementQuery.data;
  const comments = commentsQuery.data?.items ?? [];
  const totalComments = commentsQuery.data?.total ?? summary?.comments ?? 0;
  const likesCount = summary?.likes ?? 0;
  const isLiked = summary?.viewerLiked ?? false;

  const handleToggleLike = async () => {
    if (!session) {
      toast.failure('Sign in required', 'Please sign in to like this model.');
      return;
    }

    if (inFlightLike) return;
    setInFlightLike(true);

    const nextLiked = !isLiked;
    const nextCount = Math.max(0, likesCount + (nextLiked ? 1 : -1));

    // Optimistic cache update
    queryClient.setQueryData(['marketplace-engagement', assetId], (prev: EngagementSummary | undefined) => {
      if (!prev) return prev;
      return {
        ...prev,
        viewerLiked: nextLiked,
        likes: nextCount,
      };
    });

    try {
      if (nextLiked) {
        await apiFetch(`/public/catalog/${assetId}/like`, { method: 'POST' });
      } else {
        await apiFetch(`/public/catalog/${assetId}/like`, { method: 'DELETE' });
      }
      await queryClient.invalidateQueries({ queryKey: ['marketplace-engagement', assetId] });
    } catch (err) {
      // Revert optimistic update
      await queryClient.invalidateQueries({ queryKey: ['marketplace-engagement', assetId] });
      const apiErr = err as ApiRequestError;
      toast.failure('Action failed', apiErr.message || 'Could not update like.');
    } finally {
      setInFlightLike(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = commentText.trim();
    if (!text) return;

    if (!session) {
      toast.failure('Sign in required', 'Please sign in to join the discussion.');
      return;
    }

    setSubmittingComment(true);
    try {
      await apiFetch<{ id: string; assetId: string }>(`/public/catalog/${assetId}/comments`, {
        method: 'POST',
        body: { body: text },
      });
      setCommentText('');
      toast.success('Comment posted');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['marketplace-comments', assetId] }),
        queryClient.invalidateQueries({ queryKey: ['marketplace-engagement', assetId] }),
      ]);
    } catch (err) {
      const apiErr = err as ApiRequestError;
      toast.failure('Failed to post comment', apiErr.message || 'Error creating comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleRemoveComment = async (commentId: string, reason?: string) => {
    try {
      await apiFetch(`/comments/${commentId}/removal`, {
        method: 'POST',
        body: { reason: reason?.trim() || undefined },
      });
      toast.success('Comment removed');
      setModeratingId(null);
      setModerationReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['marketplace-comments', assetId] }),
        queryClient.invalidateQueries({ queryKey: ['marketplace-engagement', assetId] }),
      ]);
    } catch (err) {
      const apiErr = err as ApiRequestError;
      toast.failure('Could not remove comment', apiErr.message || 'Moderation error');
    }
  };

  return (
    <section className="mt-8 overflow-hidden rounded-card border border-hairline bg-surface shadow-panel">
      {/* Header bar with Likes and Comments counters */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleToggleLike}
            disabled={inFlightLike}
            title={session ? (isLiked ? 'Unlike this model' : 'Like this model') : 'Sign in to like'}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-all duration-150 ease-standard active:scale-95',
              isLiked
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 hover:border-rose-500'
                : 'border-hairline bg-surface-raised text-ink-dim hover:border-hairline-strong hover:text-ink',
            )}
          >
            <HeartIcon
              filled={isLiked}
              className={cn(
                'h-4 w-4 transition-transform duration-200',
                isLiked ? 'scale-110 text-rose-500' : 'text-ink-faint',
              )}
            />
            <span>{formatNumber(likesCount)}</span>
            <span className="hidden sm:inline font-normal text-ink-faint">
              {likesCount === 1 ? 'like' : 'likes'}
            </span>
          </button>

          <div className="inline-flex items-center gap-2 text-[13px] text-ink-dim pl-1">
            <ChatBubbleIcon className="h-4 w-4 text-ink-faint" />
            <span>{formatNumber(totalComments)}</span>
            <span className="hidden sm:inline font-normal text-ink-faint">
              {totalComments === 1 ? 'comment' : 'comments'}
            </span>
          </div>
        </div>

        <div className="text-[12px] font-mono text-ink-faint">
          Verified Community Thread
        </div>
      </div>

      <div className="p-6">
        {/* Comments stream */}
        {comments.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-[14px] text-ink-dim">No comments yet.</p>
            <p className="mt-1 text-[12.5px] text-ink-faint">
              Be the first to leave feedback, ask technical questions, or share compatibility notes.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className={cn(
                  'rounded-control border p-4 transition-colors',
                  comment.hidden
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-hairline bg-surface-raised/40 hover:bg-surface-raised/60',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={comment.authorName} size="sm" />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-ink">
                          {comment.authorName}
                        </span>
                        {comment.authorTenantName ? (
                          <span className="rounded-[4px] border border-hairline bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-ink-dim">
                            {comment.authorTenantName}
                          </span>
                        ) : null}
                        {comment.mine ? (
                          <span className="rounded-[4px] border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand-warm">
                            You
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11.5px] text-ink-faint">
                        {formatRelative(comment.createdAt)}
                      </div>
                    </div>
                  </div>

                  {/* Actions (Retract or Moderate) */}
                  {comment.canHide && !comment.hidden ? (
                    <div>
                      {comment.mine ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveComment(comment.id)}
                          className="text-[11.5px] font-medium text-ink-faint hover:text-state-rejected transition-colors"
                        >
                          Retract
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setModeratingId(moderatingId === comment.id ? null : comment.id)}
                          className="text-[11.5px] font-medium text-ink-faint hover:text-state-rejected transition-colors"
                        >
                          Moderate
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>

                {comment.hidden ? (
                  <div className="mt-2 text-[12.5px] text-amber-500 italic">
                    This comment was removed by workspace moderation
                    {comment.hiddenReason ? `: "${comment.hiddenReason}"` : '.'}
                  </div>
                ) : (
                  <p className="mt-2.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">
                    {comment.body}
                  </p>
                )}

                {/* Moderation reason form drawer */}
                {moderatingId === comment.id ? (
                  <div className="mt-3 rounded-control border border-hairline bg-surface p-3 animate-fade-in">
                    <label className="block text-[11.5px] font-medium text-ink-dim mb-1">
                      Reason for removal (shown to author):
                    </label>
                    <input
                      type="text"
                      value={moderationReason}
                      onChange={(e) => setModerationReason(e.target.value)}
                      placeholder="e.g. Inappropriate language, off-topic, spam"
                      maxLength={200}
                      className="w-full h-8 rounded-control border border-hairline bg-surface-raised px-2.5 text-[12.5px] text-ink focus:border-brand focus:outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setModeratingId(null);
                          setModerationReason('');
                        }}
                        className="h-7 px-2.5 text-[12px] text-ink-dim hover:text-ink"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveComment(comment.id, moderationReason)}
                        className="h-7 px-3 rounded-control bg-state-rejected text-white text-[12px] font-medium hover:brightness-110"
                      >
                        Confirm Removal
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {/* Comment input form */}
        <div className="mt-6 pt-5 border-t border-hairline">
          {session ? (
            <form onSubmit={handlePostComment}>
              <div className="relative">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Leave technical feedback, ask questions, or share compatibility notes…"
                  rows={3}
                  maxLength={2000}
                  className="w-full resize-y rounded-control border border-hairline bg-surface-raised px-3.5 py-2.5 text-[13.5px] text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none transition-colors"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-ink-faint">
                    {commentText.length}/2000
                  </span>
                  <button
                    type="submit"
                    disabled={!commentText.trim() || submittingComment}
                    className="inline-flex h-9 items-center justify-center rounded-control border border-brand bg-brand px-4 text-[13px] font-semibold text-white shadow-heat transition-all duration-150 hover:bg-brand-warm disabled:pointer-events-none disabled:opacity-50"
                  >
                    {submittingComment ? 'Posting…' : 'Post Comment'}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-control border border-hairline bg-surface-raised/40 p-4">
              <span className="text-[13px] text-ink-dim text-center sm:text-left">
                Sign in to like this model or join the discussion.
              </span>
              <Link
                href="/login"
                className="inline-flex h-8 items-center justify-center rounded-control border border-hairline-strong bg-surface px-3.5 text-[12.5px] font-semibold text-ink hover:bg-surface-raised transition-colors shrink-0"
              >
                Sign in to VOID·SPACE
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
