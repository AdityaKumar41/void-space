/**
 * The marketplace's engagement layer (§6.1's Public Catalog, made social).
 *
 * Two rules shape every function here, and both come from where these tables sit — outside the tenant
 * boundary, alongside `public_catalog_entries`. See the section note in `schema.prisma` and the one
 * on the RLS table list for why that placement is correct.
 *
 *   1. **The actor comes from the session, never from the caller's payload.** These tables have no
 *      tenant policy, so the only thing standing between "a like" and "a like attributed to whoever
 *      you claim to be" is that no function here accepts a `userId` the caller invented. Every write
 *      takes a `SocialActor` the API built from the verified token.
 *   2. **Moderation is a cross-tenant authorization rule, so it is written out explicitly.** The
 *      workspace that owns an asset moderates its own page; the author moderates their own words; a
 *      SuperAdmin moderates anything. Expressing that as three named cases rather than a permission
 *      check is deliberate — a permission check would need an RLS-scoped row to check against, and
 *      these rows are readable by design.
 *
 * Reads go through the plain runtime client rather than a tenant transaction because there is no
 * tenant context to establish: `withTenant` would set a session variable that no policy on these
 * tables consults.
 */
import { prisma } from './client';

/** Who is acting, as established by the API from the verified session. */
export interface SocialActor {
  readonly userId: string;
  /** The actor's workspace. Recorded for attribution — not an isolation key. */
  readonly tenantId: string;
  /** Snapshotted onto a comment at write time; see the column's comment in `schema.prisma`. */
  readonly displayName: string;
  readonly tenantName: string;
  /** Whether this actor may moderate content (§3.6's `review:decide` and above). */
  readonly canModerate: boolean;
  /** Platform administration. Moderates anything, in any workspace. */
  readonly isSuperAdmin: boolean;
}

export interface EngagementSummary {
  readonly assetId: string;
  readonly likeCount: number;
  readonly commentCount: number;
  readonly likedByViewer: boolean;
}

export interface CommentView {
  readonly id: string;
  readonly assetId: string;
  readonly body: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly authorTenantName: string;
  readonly createdAt: string;
  /** True when the reader wrote it, so the UI can offer a delete rather than a report. */
  readonly mine: boolean;
  /** True when this reader may hide it — the author, the owning workspace, or a SuperAdmin. */
  readonly canHide: boolean;
  /**
   * Set only for a comment the reader is allowed to see despite it being hidden — that is, their own.
   * A hidden comment is invisible to everyone else, which is what makes hiding work rather than
   * merely marking.
   */
  readonly hidden: boolean;
  readonly hiddenReason: string | null;
}

/** 404-shaped: an unpublished or delisted asset must not be engageable, or a takedown leaves a thread. */
export async function isEngageable(assetId: string): Promise<boolean> {
  const entry = await prisma.publicCatalogEntry.findUnique({
    where: { assetId },
    select: { assetId: true },
  });
  return entry !== null;
}

/** The three numbers a catalogue card or an asset page needs, in one round trip. */
export async function engagementSummaryFor(
  assetId: string,
  viewerUserId?: string | undefined,
): Promise<EngagementSummary> {
  const [likeCount, commentCount, mine] = await Promise.all([
    prisma.assetLike.count({ where: { assetId } }),
    // Hidden comments are excluded from the public count: a removed comment that still shows in the
    // number is a moderation failure a visitor can see.
    prisma.assetComment.count({ where: { assetId, hiddenAt: null } }),
    viewerUserId === undefined
      ? Promise.resolve(0)
      : prisma.assetLike.count({ where: { assetId, userId: viewerUserId } }),
  ]);

  return { assetId, likeCount, commentCount, likedByViewer: mine > 0 };
}

/**
 * Engagement for many assets at once, for a catalogue page.
 *
 * Batched because the alternative is what makes a marketplace feel slow: a 24-item page issuing 48
 * counts is 48 round trips for numbers that are decoration until someone clicks. `groupBy` makes it a
 * fixed handful of queries regardless of page size.
 */
export async function engagementSummaries(
  assetIds: readonly string[],
  viewerUserId?: string | undefined,
): Promise<Map<string, EngagementSummary>> {
  const summaries = new Map<string, EngagementSummary>();
  if (assetIds.length === 0) return summaries;

  const scope = { assetId: { in: [...assetIds] } };

  const [likes, comments, mine] = await Promise.all([
    prisma.assetLike.groupBy({ by: ['assetId'], where: scope, _count: { _all: true } }),
    prisma.assetComment.groupBy({
      by: ['assetId'],
      where: { ...scope, hiddenAt: null },
      _count: { _all: true },
    }),
    viewerUserId === undefined
      ? Promise.resolve([] as { assetId: string }[])
      : prisma.assetLike.findMany({
          where: { ...scope, userId: viewerUserId },
          select: { assetId: true },
        }),
  ]);

  const likedByViewer = new Set(mine.map((row) => row.assetId));
  const likeCounts = new Map(likes.map((row) => [row.assetId, row._count._all]));
  const commentCounts = new Map(comments.map((row) => [row.assetId, row._count._all]));

  for (const assetId of assetIds) {
    summaries.set(assetId, {
      assetId,
      likeCount: likeCounts.get(assetId) ?? 0,
      commentCount: commentCounts.get(assetId) ?? 0,
      likedByViewer: likedByViewer.has(assetId),
    });
  }

  return summaries;
}

/**
 * Likes or unlikes, idempotently.
 *
 * `upsert`/`deleteMany` rather than insert/delete so pressing the button twice — a double-click, a
 * retried request, two tabs — converges on the same row instead of failing on the unique key. The
 * count is then re-read rather than incremented for the same reason: an arithmetic `increment` drifts
 * the moment any write is skipped, and this number is shown to the world.
 */
export async function setLike(
  assetId: string,
  actor: SocialActor,
  liked: boolean,
): Promise<EngagementSummary> {
  if (liked) {
    await prisma.assetLike.upsert({
      where: { assetId_userId: { assetId, userId: actor.userId } },
      create: { assetId, userId: actor.userId, likerTenantId: actor.tenantId },
      // A re-like is a no-op rather than a rewrite: the original timestamp is when the visitor
      // actually liked it, and moving it would reorder a "liked by" list nobody edited.
      update: {},
    });
  } else {
    await prisma.assetLike.deleteMany({ where: { assetId, userId: actor.userId } });
  }

  return engagementSummaryFor(assetId, actor.userId);
}

/**
 * Posts a comment.
 *
 * The author's display name and workspace name are copied in rather than referenced, because the
 * public read cannot join `users` — see the column comment in `schema.prisma`.
 */
export async function createComment(
  assetId: string,
  actor: SocialActor,
  body: string,
): Promise<string> {
  const comment = await prisma.assetComment.create({
    data: {
      assetId,
      authorTenantId: actor.tenantId,
      authorId: actor.userId,
      authorName: actor.displayName,
      authorTenantName: actor.tenantName,
      body,
    },
    select: { id: true },
  });

  return comment.id;
}

/**
 * The thread, oldest first.
 *
 * A hidden comment is visible **to its author and nobody else**, so removal is not a silent
 * disappearance: the person whose words were removed can see that they were, and why. Everyone else
 * sees a shorter thread, which is the point of hiding.
 */
export async function listComments(
  assetId: string,
  options: {
    readonly limit: number;
    readonly offset: number;
    readonly viewer?: SocialActor | undefined;
  },
): Promise<{ readonly total: number; readonly items: CommentView[] }> {
  const entry = await prisma.publicCatalogEntry.findUnique({
    where: { assetId },
    select: { tenantId: true },
  });
  if (entry === null) return { total: 0, items: [] };

  const viewer = options.viewer;
  const where = {
    assetId,
    ...(viewer === undefined
      ? { hiddenAt: null }
      : { OR: [{ hiddenAt: null }, { authorId: viewer.userId }] }),
  };

  const [total, rows] = await Promise.all([
    prisma.assetComment.count({ where }),
    prisma.assetComment.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: options.limit,
      skip: options.offset,
      select: {
        id: true,
        assetId: true,
        body: true,
        authorId: true,
        authorName: true,
        authorTenantName: true,
        createdAt: true,
        hiddenAt: true,
        hiddenReason: true,
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      assetId: row.assetId,
      body: row.body,
      authorId: row.authorId,
      authorName: row.authorName,
      authorTenantName: row.authorTenantName,
      createdAt: row.createdAt.toISOString(),
      mine: viewer?.userId === row.authorId,
      canHide:
        viewer !== undefined &&
        (viewer.userId === row.authorId ||
          viewer.isSuperAdmin ||
          (viewer.canModerate && viewer.tenantId === entry.tenantId)),
      hidden: row.hiddenAt !== null,
      hiddenReason: row.hiddenReason,
    })),
  };
}

/** Raised when the caller may not hide this comment. Distinct so the route answers 403, not 404. */
export class CommentModerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommentModerationError';
  }
}

export class CommentNotFoundError extends Error {
  constructor() {
    super('Comment not found');
    this.name = 'CommentNotFoundError';
  }
}

/**
 * Hides a comment, and this is where moderation's cross-tenant rule lives.
 *
 * Three cases, in the order they are checked, and the order is deliberate: the author is checked
 * before the workspace, because an author removing their own words is not a moderation action and
 * should not be recorded as one.
 *
 *   1. **The author.** Self-removal. No reason recorded, because there is nobody to explain it to.
 *   2. **A SuperAdmin.** Platform administration, any workspace.
 *   3. **The workspace that owns the asset**, and only with a moderation permission. This is the case
 *      worth reading twice: the actor is in a *different* tenant from the author, which is precisely
 *      the cross-tenant act the missing RLS policy permits. It is not a hole because it is written out
 *      here, takes the owning workspace from the asset rather than from the request, and requires
 *      `review:decide` or above (§3.6).
 */
export async function hideComment(
  commentId: string,
  actor: SocialActor,
  reason?: string | undefined,
): Promise<{ readonly id: string; readonly hiddenAt: string }> {
  const comment = await prisma.assetComment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      authorId: true,
      hiddenAt: true,
      asset: { select: { tenantId: true } },
    },
  });

  if (comment === null) throw new CommentNotFoundError();

  const isAuthor = comment.authorId === actor.userId;
  const ownsThePage = actor.canModerate && comment.asset.tenantId === actor.tenantId;

  if (!isAuthor && !ownsThePage && !actor.isSuperAdmin) {
    throw new CommentModerationError(
      'Only the author, the workspace that published this asset, or a platform administrator can remove a comment.',
    );
  }

  // Hiding twice is not an error: the second request may be a retry, and the outcome the caller asked
  // for already holds. The original timestamp is kept so the record shows the first removal.
  if (comment.hiddenAt !== null) {
    return { id: comment.id, hiddenAt: comment.hiddenAt.toISOString() };
  }

  const hiddenAt = new Date();
  await prisma.assetComment.update({
    where: { id: comment.id },
    data: {
      hiddenAt,
      hiddenById: actor.userId,
      /*
       * A reason is recorded only when one was given. A moderator who did not type one gets the
       * generic sentence rather than a blank, because the author is shown this text and "removed for
       * no stated reason" is more useful than an empty field.
       */
      hiddenReason: isAuthor
        ? null
        : reason?.trim() || 'Removed by the workspace that published this asset.',
    },
  });

  return { id: comment.id, hiddenAt: hiddenAt.toISOString() };
}

/**
 * How many comments this workspace has had removed.
 *
 * For the moderation view. Hidden rows are the audit trail, which is why this counts them rather than
 * reading a denormalized counter — the counter could not say *who* removed what.
 */
export async function hiddenCommentCount(ownerTenantId: string): Promise<number> {
  return prisma.assetComment.count({
    where: { hiddenAt: { not: null }, asset: { tenantId: ownerTenantId } },
  });
}

/** Everything a workspace has had removed from its own published pages, newest first. */
export async function moderationLog(
  ownerTenantId: string,
  limit = 50,
): Promise<
  readonly {
    readonly id: string;
    readonly assetId: string;
    readonly body: string;
    readonly authorName: string;
    readonly hiddenAt: string;
    readonly hiddenReason: string | null;
  }[]
> {
  const rows = await prisma.assetComment.findMany({
    where: { hiddenAt: { not: null }, asset: { tenantId: ownerTenantId } },
    orderBy: { hiddenAt: 'desc' },
    take: limit,
    select: {
      id: true,
      assetId: true,
      body: true,
      authorName: true,
      hiddenAt: true,
      hiddenReason: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    assetId: row.assetId,
    body: row.body,
    authorName: row.authorName,
    // Non-null by the `where` above; the assertion is here rather than a `??` so a future relaxation
    // of the filter fails loudly instead of shipping an epoch timestamp.
    hiddenAt: (row.hiddenAt as Date).toISOString(),
    hiddenReason: row.hiddenReason,
  }));
}
