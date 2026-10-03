/**
 * Marketplace engagement over HTTP, against the real app and database.
 *
 * The service layer is covered by `packages/db/test/social.test.ts`. This file is about the things only
 * the HTTP surface can get wrong:
 *
 *   - **`optionalAuth`'s asymmetry.** A missing token must read the public thread; an *invalid* one must
 *     be a 401. Degrading a bad token to anonymous would show a signed-in Creator "not liked" and then
 *     fail their click one request later, where nothing can explain why.
 *   - **The read-only Viewer rule reaches a route that did not exist when it was written.** §3.6 states
 *     it as a property of the token, so it should hold on any new write with no new check — this is the
 *     test that proves the new routes inherit it rather than quietly bypassing it.
 *   - **Cross-tenant moderation, end to end**, including that it is refused for a workspace that is
 *     neither the author nor the page owner.
 */
import { prisma } from '@void-space/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, DEMO, DEMO_TENANT_IDS, login, type TestApp } from './helpers';

describe('marketplace engagement (HTTP)', () => {
  let harness: TestApp;
  let assetId: string;
  let auroraCreator: string;
  let auroraAdmin: string;
  let auroraViewer: string;
  let northwindAdmin: string;

  const createdCommentIds: string[] = [];

  beforeAll(async () => {
    harness = await createTestApp();
    const { app } = harness;

    const entry = await prisma.publicCatalogEntry.findFirst({
      where: { tenantId: DEMO_TENANT_IDS.aurora },
      select: { assetId: true },
    });
    if (!entry) throw new Error('[test] no seeded catalog entry for aurora — run `pnpm db:seed`');
    assetId = entry.assetId;

    // One login per role, because the interesting cases are about which *role* may do what.
    [auroraCreator, auroraAdmin, auroraViewer, northwindAdmin] = await Promise.all([
      login(app, DEMO.users.auroraCreator).then((result) => result.accessToken),
      login(app, DEMO.users.auroraAdmin).then((result) => result.accessToken),
      login(app, DEMO.users.auroraViewer).then((result) => result.accessToken),
      login(app, DEMO.users.northwindAdmin).then((result) => result.accessToken),
    ]);
  });

  afterAll(async () => {
    if (createdCommentIds.length > 0) {
      await prisma.assetComment.deleteMany({ where: { id: { in: createdCommentIds } } });
    }
    await harness.close();
    await prisma.$disconnect();
  });

  /** One comment posted by Northwind against Aurora's asset. Registered for teardown. */
  async function postNorthwindComment(body: string): Promise<string> {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/public/catalog/${assetId}/comments`,
      headers: { authorization: `Bearer ${northwindAdmin}` },
      payload: { body },
    });
    expect(response.statusCode).toBe(201);
    const id = response.json().id as string;
    createdCommentIds.push(id);
    return id;
  }

  it('reads the engagement of a published asset with no token at all', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/public/catalog/${assetId}/engagement`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.assetId).toBe(assetId);
    expect(body.likeCount).toBeGreaterThanOrEqual(0);
    // A stranger has liked nothing, whatever the count says.
    expect(body.likedByViewer).toBe(false);
  });

  it('answers 401 for a *bad* token rather than degrading it to anonymous', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/public/catalog/${assetId}/engagement`,
      headers: { authorization: 'Bearer not.a.real.token' },
    });

    // The whole reason `optionalAuth` is not `try { authenticate() } catch {}`: an expired session must
    // be told it expired at the read, rather than at the write it silently breaks.
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('TOKEN_INVALID');
  });

  it('refuses a like with no session, and records nothing', async () => {
    const before = await prisma.assetLike.count({ where: { assetId } });

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/public/catalog/${assetId}/like`,
    });

    expect(response.statusCode).toBe(401);
    expect(await prisma.assetLike.count({ where: { assetId } })).toBe(before);
  });

  it('refuses a like from a read-only Viewer token (§3.6)', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/public/catalog/${assetId}/like`,
      headers: { authorization: `Bearer ${auroraViewer}` },
    });

    // Asserted against a route written *after* the rule. §3.6 states read-only as a property of the
    // token, so a new write route inherits it with no new check — this is the proof.
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('READ_ONLY_TOKEN');
  });

  it('personalises the engagement read for the signed-in viewer', async () => {
    const like = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/public/catalog/${assetId}/like`,
      headers: { authorization: `Bearer ${auroraCreator}` },
    });
    expect(like.statusCode).toBe(200);
    expect(like.json().likedByViewer).toBe(true);

    // The same asset read two ways: the button state is the viewer's, the number is everyone's.
    const mine = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/public/catalog/${assetId}/engagement`,
      headers: { authorization: `Bearer ${auroraCreator}` },
    });
    const stranger = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/public/catalog/${assetId}/engagement`,
    });

    expect(mine.json().likedByViewer).toBe(true);
    expect(stranger.json().likedByViewer).toBe(false);
    expect(mine.json().likeCount).toBe(stranger.json().likeCount);

    const unlike = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/public/catalog/${assetId}/like`,
      headers: { authorization: `Bearer ${auroraCreator}` },
    });
    expect(unlike.json().likedByViewer).toBe(false);
  });

  it('lets a member of another workspace comment, and shows it to strangers', async () => {
    const id = await postNorthwindComment('Cross-workspace question');

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/public/catalog/${assetId}/comments`,
    });

    expect(response.statusCode).toBe(200);
    const items = response.json().items as { id: string; authorName: string; mine: boolean }[];
    const posted = items.find((comment) => comment.id === id);

    expect(posted).toBeDefined();
    // The snapshotted name is what makes an anonymous read of a cross-tenant thread possible at all.
    expect(posted?.authorName).toBeTruthy();
    // Anonymous, so nothing is "mine".
    expect(posted?.mine).toBe(false);
  });

  it('hides a comment from the public thread when the page owner moderates it', async () => {
    const id = await postNorthwindComment('Off-topic spam');

    const moderation = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/comments/${id}/removal`,
      headers: { authorization: `Bearer ${auroraAdmin}` },
      payload: { reason: 'Off-topic' },
    });
    expect(moderation.statusCode).toBe(200);

    const anonymous = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/public/catalog/${assetId}/comments`,
    });
    expect((anonymous.json().items as { id: string }[]).find((c) => c.id === id)).toBeUndefined();

    // Northwind's own member still sees it, with the reason — removal is explained, not silent.
    const author = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/public/catalog/${assetId}/comments`,
      headers: { authorization: `Bearer ${northwindAdmin}` },
    });
    const own = (
      author.json().items as { id: string; hidden: boolean; hiddenReason: string }[]
    ).find((c) => c.id === id);
    expect(own?.hidden).toBe(true);
    expect(own?.hiddenReason).toBe('Off-topic');
  });

  it('refuses moderation by a workspace that is neither the author nor the page owner', async () => {
    const authored = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/public/catalog/${assetId}/comments`,
      headers: { authorization: `Bearer ${auroraCreator}` },
      payload: { body: 'Aurora’s own words' },
    });
    expect(authored.statusCode).toBe(201);
    const id = authored.json().id as string;
    createdCommentIds.push(id);

    // Northwind is a signed-in member of a different workspace. It may engage; it may not moderate a
    // page it does not own — the rule the missing RLS policy makes the service responsible for.
    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/comments/${id}/removal`,
      headers: { authorization: `Bearer ${northwindAdmin}` },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('NOT_COMMENT_MODERATOR');
  });

  it('lets an author retract their own comment without a moderation role', async () => {
    const id = await postNorthwindComment('Never mind');

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/comments/${id}/removal`,
      headers: { authorization: `Bearer ${northwindAdmin}` },
    });

    // No permission is required at the route, deliberately: an author must be able to retract their own
    // words whatever their role in their own workspace.
    expect(response.statusCode).toBe(200);
  });

  it('refuses an empty comment, and engagement with an asset that is not published', async () => {
    const empty = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/public/catalog/${assetId}/comments`,
      headers: { authorization: `Bearer ${auroraCreator}` },
      payload: { body: '   ' },
    });
    expect(empty.statusCode).toBe(400);

    // A delisted asset is indistinguishable from one that never existed, so a takedown cannot be probed
    // for by watching which ids accept engagement.
    const missing = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/public/catalog/11111111-1111-4111-8111-111111111111/engagement',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('scopes the moderation log to the caller’s own workspace', async () => {
    const aurora = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/moderation/comments',
      headers: { authorization: `Bearer ${auroraAdmin}` },
    });

    expect(aurora.statusCode).toBe(200);
    // Aurora removed at least the comment above. The route takes the workspace from the token and offers
    // no way to ask for another, which is what stops it being a way to read a rival's moderation log.
    expect(aurora.json().total).toBeGreaterThan(0);

    // `asset:upload-own` is the gate, so a read-only Viewer is refused — even though it may read the very
    // thread these removals came from.
    const viewer = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/moderation/comments',
      headers: { authorization: `Bearer ${auroraViewer}` },
    });
    expect(viewer.statusCode).toBe(403);
  });
});
