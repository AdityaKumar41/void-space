/**
 * The marketplace's engagement layer, against a real PostgreSQL.
 *
 * The cases pinned here are the ones that would be silently wrong rather than loudly broken:
 *
 *   - a like toggled twice must not become two likes, because the count is public;
 *   - a visitor in one workspace must be able to engage with another workspace's asset, which is the
 *     whole reason these tables sit outside the tenant boundary;
 *   - and a *third* workspace must not be able to moderate it.
 *
 * The last two are the same coin. `asset_likes` and `asset_comments` have no RLS policy — deliberately;
 * see the note on the RLS table list — so nothing in the database stops a cross-tenant write, and the
 * authorization has to be proven at the service layer instead. That is what these tests are for.
 *
 * Fixtures come from `pnpm db:seed`. A throwaway catalogue entry is created for the one case that has
 * to delete what it engages with.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { platformPrisma, prisma } from '../src/client';
import {
  CommentModerationError,
  CommentNotFoundError,
  createComment,
  engagementSummaries,
  engagementSummaryFor,
  hideComment,
  isEngageable,
  listComments,
  moderationLog,
  setLike,
  type SocialActor,
} from '../src/social';
import { withPlatform, withTenant } from '../src/tenant';

/** A seeded workspace, with one of its published catalogue entries to engage with. */
async function loadWorkspace(slug: string) {
  const tenant = await withPlatform((db) => db.tenant.findUnique({ where: { slug } }));
  if (!tenant) throw new Error(`[test] tenant ${slug} not found — run \`pnpm db:seed\` first`);

  const users = await withTenant(tenant.id, (db) =>
    db.user.findMany({ select: { id: true, fullName: true }, take: 1 }),
  );
  const user = users[0];
  if (!user) throw new Error(`[test] tenant ${slug} has no users`);

  const entry = await prisma.publicCatalogEntry.findFirst({
    where: { tenantId: tenant.id },
    select: { assetId: true },
  });

  return { tenantId: tenant.id, tenantName: tenant.name, user, entry };
}

type Workspace = Awaited<ReturnType<typeof loadWorkspace>>;

function actorFor(workspace: Workspace, overrides: Partial<SocialActor> = {}): SocialActor {
  return {
    userId: workspace.user.id,
    tenantId: workspace.tenantId,
    displayName: workspace.user.fullName,
    tenantName: workspace.tenantName,
    canModerate: true,
    isSuperAdmin: false,
    ...overrides,
  };
}

const createdCommentIds: string[] = [];
const createdEntryIds: string[] = [];

describe('marketplace engagement', () => {
  afterAll(async () => {
    // Comments cascade from their catalogue entry, but these were posted against *seeded* entries, so
    // they are removed explicitly. The throwaway entry takes its own engagement with it.
    if (createdCommentIds.length > 0) {
      await prisma.assetComment.deleteMany({ where: { id: { in: createdCommentIds } } });
    }
    if (createdEntryIds.length > 0) {
      await prisma.publicCatalogEntry.deleteMany({ where: { assetId: { in: createdEntryIds } } });
    }
    await prisma.$disconnect();
    await platformPrisma.$disconnect();
  });

  it('has an asset-owning workspace and a second one to visit it (precondition)', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const northwind = await loadWorkspace('northwind-safety');

    // Aurora publishes; Northwind only has people in it.
    expect(aurora.entry).not.toBeNull();

    /*
     * Northwind owning no catalog entry is not incidental — it is what makes it the fixture the rest of
     * this file needs. Every cross-tenant case below relies on an actor whose workspace has nothing to
     * do with the page being engaged with, so the "owning workspace" and "visiting workspace" halves of
     * each rule are genuinely different tenants. A second workspace that also published would let a
     * wrong implementation pass by accidentally matching the page owner.
     */
    expect(northwind.user.id).toBeTruthy();
    expect(aurora.tenantId).not.toBe(northwind.tenantId);
  });

  it('counts a like once however many times the button is pressed', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const assetId = aurora.entry!.assetId;
    const actor = actorFor(aurora);

    const before = await engagementSummaryFor(assetId, actor.userId);

    const first = await setLike(assetId, actor, true);
    expect(first.likeCount).toBe(before.likeCount + 1);
    expect(first.likedByViewer).toBe(true);

    // The unique key on (assetId, userId) is what makes this hold. Without it a double-click or a
    // retried request would inflate a number the whole marketplace can see.
    const second = await setLike(assetId, actor, true);
    expect(second.likeCount).toBe(before.likeCount + 1);

    const removed = await setLike(assetId, actor, false);
    expect(removed.likeCount).toBe(before.likeCount);
    expect(removed.likedByViewer).toBe(false);

    // Unliking something never liked is not an error — the requested state already holds.
    const again = await setLike(assetId, actor, false);
    expect(again.likeCount).toBe(before.likeCount);
  });

  it('reports the viewer’s own like, and not another visitor’s', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const northwind = await loadWorkspace('northwind-safety');
    const assetId = aurora.entry!.assetId;

    await setLike(assetId, actorFor(aurora), true);

    // Same asset, two viewers: the count is shared and the button state is not.
    const mine = await engagementSummaryFor(assetId, aurora.user.id);
    const theirs = await engagementSummaryFor(assetId, northwind.user.id);

    expect(mine.likeCount).toBeGreaterThan(0);
    expect(mine.likedByViewer).toBe(true);
    expect(theirs.likeCount).toBe(mine.likeCount);
    expect(theirs.likedByViewer).toBe(false);

    await setLike(assetId, actorFor(aurora), false);
  });

  it('batches engagement for a page of assets in one pass', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const entries = await prisma.publicCatalogEntry.findMany({
      select: { assetId: true },
      take: 10,
    });
    const ids = entries.map((entry) => entry.assetId);

    const summaries = await engagementSummaries(ids, aurora.user.id);

    // Every requested asset gets a summary, including the ones nobody has engaged with — a missing key
    // would render as a blank card rather than a zero.
    expect(summaries.size).toBe(ids.length);
    for (const id of ids) {
      const summary = summaries.get(id);
      expect(summary?.assetId).toBe(id);
      expect(summary?.likeCount).toBeGreaterThanOrEqual(0);
    }
    // An empty page must not issue a query at all.
    expect((await engagementSummaries([])).size).toBe(0);
  });

  it('lets a visitor from another workspace post a comment, and names them', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const northwind = await loadWorkspace('northwind-safety');
    const assetId = aurora.entry!.assetId;

    // The cross-tenant write the missing RLS policy permits. A marketplace where you can only discuss
    // your own workspace's assets is not a marketplace.
    const id = await createComment(assetId, actorFor(northwind), 'Does this come in 2m?');
    createdCommentIds.push(id);

    const thread = await listComments(assetId, { limit: 50, offset: 0, viewer: actorFor(aurora) });
    const posted = thread.items.find((comment) => comment.id === id);

    expect(posted).toBeDefined();
    // Snapshotted at write time, because `users` is RLS-protected and this read cannot join to it.
    expect(posted?.authorName).toBe(northwind.user.fullName);
    expect(posted?.authorTenantName).toBe(northwind.tenantName);
    expect(posted?.body).toBe('Does this come in 2m?');
    expect(posted?.mine).toBe(false);
    // Aurora owns the page, so Aurora may moderate it — but this comment is not Aurora's to delete.
    expect(posted?.canHide).toBe(true);
  });

  it('hides a comment from everyone but its author', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const northwind = await loadWorkspace('northwind-safety');
    const assetId = aurora.entry!.assetId;

    const id = await createComment(assetId, actorFor(northwind), 'to be removed');
    createdCommentIds.push(id);

    await hideComment(id, actorFor(northwind));

    const byStranger = await listComments(assetId, {
      limit: 50,
      offset: 0,
      viewer: actorFor(aurora),
    });
    expect(byStranger.items.find((comment) => comment.id === id)).toBeUndefined();

    // The author still sees it, with the reason. Removal is not a silent disappearance: the person
    // whose words were removed is told, and everyone else simply sees a shorter thread.
    const byAuthor = await listComments(assetId, {
      limit: 50,
      offset: 0,
      viewer: actorFor(northwind),
    });
    const own = byAuthor.items.find((comment) => comment.id === id);
    expect(own?.hidden).toBe(true);
    // Self-removal records no reason — there is nobody to explain it to.
    expect(own?.hiddenReason).toBeNull();

    const anonymous = await listComments(assetId, { limit: 50, offset: 0 });
    expect(anonymous.items.find((comment) => comment.id === id)).toBeUndefined();
  });

  it('lets the publishing workspace moderate a comment on its own page — across tenants', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const northwind = await loadWorkspace('northwind-safety');
    const assetId = aurora.entry!.assetId;

    // Northwind authors it; Aurora owns the page and removes it. This is the cross-tenant act, and it
    // is why the rule is written out in `hideComment` rather than left to a database policy.
    const id = await createComment(assetId, actorFor(northwind), 'spam link here');
    createdCommentIds.push(id);

    await hideComment(id, actorFor(aurora), 'Off-topic');

    const byNorthwind = await listComments(assetId, {
      limit: 50,
      offset: 0,
      viewer: actorFor(northwind),
    });
    const removed = byNorthwind.items.find((comment) => comment.id === id);

    expect(removed?.hidden).toBe(true);
    // The moderator's reason, not the generic fallback: the author is shown this text.
    expect(removed?.hiddenReason).toBe('Off-topic');
  });

  it('refuses moderation by a workspace that neither wrote it nor owns the page', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const northwind = await loadWorkspace('northwind-safety');
    const assetId = aurora.entry!.assetId;

    const id = await createComment(assetId, actorFor(northwind), 'northwind wrote this');
    createdCommentIds.push(id);

    // A third actor who holds the moderation permission but belongs to neither the author's workspace
    // nor the page's. `canModerate` alone must not be sufficient — the tenant match is what bounds it.
    const thirdParty = actorFor(northwind, {
      userId: aurora.user.id,
      tenantId: '00000000-0000-4000-8000-000000000001',
      canModerate: true,
      isSuperAdmin: false,
    });

    await expect(hideComment(id, thirdParty)).rejects.toBeInstanceOf(CommentModerationError);

    const thread = await listComments(assetId, { limit: 50, offset: 0, viewer: actorFor(aurora) });
    expect(thread.items.find((comment) => comment.id === id)?.hidden).toBe(false);
  });

  it('lets a platform administrator moderate anywhere', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const northwind = await loadWorkspace('northwind-safety');
    const assetId = aurora.entry!.assetId;

    const id = await createComment(assetId, actorFor(northwind), 'remove me');
    createdCommentIds.push(id);

    const admin = actorFor(northwind, {
      tenantId: '00000000-0000-4000-8000-000000000000',
      isSuperAdmin: true,
      // Set false on purpose: platform administration must not depend on holding a publishing
      // permission inside a workspace the administrator does not belong to.
      canModerate: false,
    });

    await expect(hideComment(id, admin, 'Abuse')).resolves.toMatchObject({ id });
  });

  it('is idempotent about moderating twice, keeping the first removal’s timestamp', async () => {
    const aurora = await loadWorkspace('aurora-industrial');
    const northwind = await loadWorkspace('northwind-safety');
    const assetId = aurora.entry!.assetId;

    const id = await createComment(assetId, actorFor(northwind), 'twice removed');
    createdCommentIds.push(id);

    const first = await hideComment(id, actorFor(aurora), 'First');
    const second = await hideComment(id, actorFor(aurora), 'Second');

    // A retry is not an edit: the record shows when it was actually removed, and why it was then.
    expect(second.hiddenAt).toBe(first.hiddenAt);
    const log = await moderationLog(aurora.tenantId, 200);
    expect(log.find((entry) => entry.id === id)?.hiddenReason).toBe('First');
  });

  it('reports a missing comment rather than pretending to have removed it', async () => {
    const aurora = await loadWorkspace('aurora-industrial');

    await expect(
      hideComment('11111111-1111-4111-8111-111111111111', actorFor(aurora)),
    ).rejects.toBeInstanceOf(CommentNotFoundError);
  });

  it('lists only what a workspace removed from its own pages', async () => {
    const aurora = await loadWorkspace('aurora-industrial');

    const log = await moderationLog(aurora.tenantId, 200);

    /*
     * Keyed by the *page owner*, not by the author — which is the bug that the column rename
     * (`tenant_id` → `author_tenant_id`) exists to prevent. Every entry here was removed from an Aurora
     * page, whoever wrote it. A log filtered on the author's workspace would have looked plausible and
     * answered a different question entirely.
     */
    for (const entry of log) {
      const owner = await prisma.publicCatalogEntry.findUnique({
        where: { assetId: entry.assetId },
        select: { tenantId: true },
      });
      expect(owner?.tenantId).toBe(aurora.tenantId);
    }
  });

  it('refuses to engage with an asset that is not published', async () => {
    // A takedown deletes the projection, so "unpublished" and "never existed" are one answer. Anything
    // else would let a stranger probe for takedowns by watching which ids accept a like.
    expect(await isEngageable('11111111-1111-4111-8111-111111111111')).toBe(false);
  });

  it('takes a delisted asset’s likes and comments with it (§3.9.2 takedown)', async () => {
    const aurora = await loadWorkspace('aurora-industrial');

    // A throwaway entry rather than a seeded one: this case deletes the row it engages with, and the
    // seeded marketplace is not the place to demonstrate that.
    const assetId = crypto.randomUUID();
    await prisma.publicCatalogEntry.create({
      data: {
        assetId,
        tenantId: aurora.tenantId,
        tenantName: aurora.tenantName,
        name: 'Throwaway',
        category: 'Prop',
        tags: [],
        format: 'glb',
        sizeBytes: 1n,
        ipfsCid: `bafythrowaway${assetId.slice(0, 8)}`,
        licenseType: 'CC-BY',
        publishedAt: new Date(),
      },
    });
    createdEntryIds.push(assetId);

    const commentId = await createComment(assetId, actorFor(aurora), 'on a doomed asset');
    await setLike(assetId, actorFor(aurora), true);
    expect(await isEngageable(assetId)).toBe(true);

    await prisma.publicCatalogEntry.delete({ where: { assetId } });

    // The foreign key's ON DELETE CASCADE is the guarantee: a takedown cannot leave a thread pointing at
    // an asset that no longer exists, because a dangling public record is worse than no record.
    expect(await prisma.assetLike.count({ where: { assetId } })).toBe(0);
    expect(await prisma.assetComment.count({ where: { assetId } })).toBe(0);
    expect(await prisma.assetComment.count({ where: { id: commentId } })).toBe(0);
    expect(await isEngageable(assetId)).toBe(false);
  });
});
