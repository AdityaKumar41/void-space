/**
 * Marketplace engagement (FR-5.2's Public Catalog, §6.1).
 *
 *   GET    /public/catalog/:assetId/engagement   counts + "did I like this"   (optional auth)
 *   POST   /public/catalog/:assetId/like         like                         (signed in)
 *   DELETE /public/catalog/:assetId/like         unlike                       (signed in)
 *   GET    /public/catalog/:assetId/comments     the thread, oldest first     (optional auth)
 *   POST   /public/catalog/:assetId/comments     post a comment               (signed in)
 *   POST   /comments/:commentId/removal          remove a comment             (author / owner / admin)
 *   GET    /moderation/comments                  what this workspace removed  (asset:upload-own)
 *
 * Three decisions are worth reading before changing anything here.
 *
 * **Reads allow a stranger; writes require a session.** The counts and the thread are part of a public
 * page, so they answer anonymously — §6.1's rule that a marketplace behind a sign-in wall cannot be
 * linked to or indexed. `optionalAuth` (see the auth plugin) is what lets the same route personalise
 * for a signed-in visitor, which is the difference between a like *count* and a like *button*.
 *
 * **The actor is taken from the principal and never from the body.** These rows live outside the tenant
 * boundary — see the notes in `schema.prisma` and `rls.sql` for why they have to — so the session is the
 * only thing establishing who is acting. A `userId` in the request payload would be an impersonation
 * hole with no database policy behind it.
 *
 * **Removal is `POST`, not `DELETE`.** Removing a comment records *who* removed it and *why*, and that
 * record is shown to the author — so it is an action with an audit outcome rather than a resource
 * deletion. `DELETE` also discourages a request body, which is exactly where the reason has to travel; a
 * version of this that used `DELETE` silently dropped every moderator's explanation.
 *
 * **Writing requires a session that is not read-only.** `catalog:view` is the permission every member
 * role holds, and `assertPermission` already refuses a non-GET for §3.6's read-only Viewer token — so
 * one check expresses "any signed-in member, except a read-only one". Comment removal is deliberately
 * *not* gated on a permission at the route, because an author must be able to remove their own words
 * whatever their role; the rule lives in `hideComment`, which knows whether the caller is the author.
 */
import {
  CommentModerationError,
  CommentNotFoundError,
  createComment,
  engagementSummaryFor,
  hideComment,
  isEngageable,
  listComments,
  moderationLog,
  setLike,
  type SocialActor,
} from '@void-space/db';
import type { AuthPrincipal } from '@void-space/types';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { parseBody, parseParams, parseQuery } from '../../lib/http';

const assetParams = z.object({ assetId: z.string().uuid('A catalog id is a UUID') });
const commentParams = z.object({ commentId: z.string().uuid() });

const commentBody = z.object({
  body: z.string().trim().min(1, 'Say something').max(2_000),
});

/**
 * The reason is optional, and its absence is meaningful rather than empty: a moderator who gives none
 * gets a generic sentence recorded instead, and an author removing their own words records no reason at
 * all. See `hideComment`.
 */
const removalBody = z.object({
  reason: z.string().trim().max(200).optional(),
});

const threadQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const moderationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * The acting identity, as the service needs it.
 *
 * `canModerate` is the §3.6 answer to "may this member curate their own workspace's pages?" —
 * `asset:upload-own`, which is the matrix's *publish* permission rather than an invented one. It is
 * only ever combined with a workspace match inside `hideComment`, so a Creator in one workspace cannot
 * moderate another's page. Widening this to `catalog:view` would let any Visitor who could comment also
 * delete everyone else's comments, which is why it is not that.
 */
function actorFrom(principal: AuthPrincipal): SocialActor {
  return {
    userId: principal.userId,
    tenantId: principal.tenantId,
    displayName: principal.fullName,
    tenantName: principal.tenantName,
    canModerate: principal.permissions.includes('asset:upload-own'),
    isSuperAdmin: principal.isSuperAdmin,
  };
}

/** The viewer, when there is one. Anonymous reads pass `undefined`. */
function viewerFrom(request: FastifyRequest): SocialActor | undefined {
  const principal = request.principal;
  return principal ? actorFrom(principal) : undefined;
}

/** A signed-in actor, or a 401. Used by the write routes after `requirePermission` has already run. */
function requireActor(request: FastifyRequest): SocialActor {
  const principal = request.principal;
  if (!principal) throw new ForbiddenError('Authentication required', 'UNAUTHENTICATED');
  return actorFrom(principal);
}

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  /** 404 rather than "unpublished": a delisted asset must be indistinguishable from a missing one. */
  const requireEngageable = async (assetId: string): Promise<void> => {
    if (!(await isEngageable(assetId))) throw new NotFoundError('Catalog entry');
  };

  app.get(
    '/public/catalog/:assetId/engagement',
    { preHandler: app.optionalAuth },
    async (request: FastifyRequest) => {
      const { assetId } = parseParams(assetParams, request.params);
      await requireEngageable(assetId);

      // The viewer's own id is passed only when there is a session, so an anonymous read cannot
      // accidentally report somebody else's like as the visitor's.
      return engagementSummaryFor(assetId, request.principal?.userId);
    },
  );

  app.post(
    '/public/catalog/:assetId/like',
    { preHandler: app.requirePermission('catalog:view') },
    async (request: FastifyRequest) => {
      const { assetId } = parseParams(assetParams, request.params);
      await requireEngageable(assetId);
      return setLike(assetId, requireActor(request), true);
    },
  );

  app.delete(
    '/public/catalog/:assetId/like',
    { preHandler: app.requirePermission('catalog:view') },
    async (request: FastifyRequest) => {
      const { assetId } = parseParams(assetParams, request.params);
      await requireEngageable(assetId);
      return setLike(assetId, requireActor(request), false);
    },
  );

  app.get(
    '/public/catalog/:assetId/comments',
    { preHandler: app.optionalAuth },
    async (request: FastifyRequest) => {
      const { assetId } = parseParams(assetParams, request.params);
      const { limit, offset } = parseQuery(threadQuery, request.query);
      await requireEngageable(assetId);

      const page = await listComments(assetId, { limit, offset, viewer: viewerFrom(request) });
      return { ...page, limit, offset };
    },
  );

  app.post(
    '/public/catalog/:assetId/comments',
    { preHandler: app.requirePermission('catalog:view') },
    async (request: FastifyRequest, reply) => {
      const { assetId } = parseParams(assetParams, request.params);
      const { body } = parseBody(commentBody, request.body);
      await requireEngageable(assetId);

      const id = await createComment(assetId, requireActor(request), body);
      // 201 with the id: the client needs it to offer "remove" on the comment it just posted, and
      // re-reading the whole thread to find out would be a second round trip for a known answer.
      return reply.status(201).send({ id, assetId });
    },
  );

  app.post(
    '/comments/:commentId/removal',
    { preHandler: app.requirePermission('catalog:view') },
    async (request: FastifyRequest) => {
      const { commentId } = parseParams(commentParams, request.params);
      // The body is optional — a removal with no explanation is legitimate — so an absent body parses
      // as an absent reason rather than as a validation error.
      const { reason } = parseBody(removalBody, request.body ?? {});

      try {
        return await hideComment(commentId, requireActor(request), reason);
      } catch (error) {
        // Translated here rather than in the service, so `@void-space/db` stays free of HTTP concepts
        // and can be called from a worker or a script without importing a status code.
        if (error instanceof CommentNotFoundError) throw new NotFoundError('Comment');
        if (error instanceof CommentModerationError) {
          throw new ForbiddenError(error.message, 'NOT_COMMENT_MODERATOR');
        }
        throw error;
      }
    },
  );

  /**
   * What this workspace has removed from its own pages.
   *
   * Scoped to the caller's own workspace rather than taking a tenant id, because a moderation log that
   * could be pointed at someone else's workspace would be a way to read their moderation decisions —
   * and `asset:upload-own` is a publishing permission, not an administrative one.
   */
  app.get(
    '/moderation/comments',
    { preHandler: app.requirePermission('asset:upload-own') },
    async (request: FastifyRequest) => {
      const principal = request.principal;
      if (!principal) throw new ForbiddenError('Authentication required', 'UNAUTHENTICATED');

      const { limit } = parseQuery(moderationQuery, request.query);
      const items = await moderationLog(principal.tenantId, limit);
      return { total: items.length, items };
    },
  );
}
