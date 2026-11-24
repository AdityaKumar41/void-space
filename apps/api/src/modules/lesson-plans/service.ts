import { createHash } from 'node:crypto';
import {
  withTenant,
  getPublicCatalogListing,
  type Prisma,
  type TenantClient,
} from '@void-space/db';
import { lessonPlanSchema, type AuthPrincipal, type LessonPlan } from '@void-space/types';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
export const json = (value: unknown) => value as Prisma.InputJsonValue;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function ownedPlan(db: TenantClient, p: AuthPrincipal, id: string) {
  const row = await db.lessonPlan.findFirst({ where: { id, ownerId: p.userId } });
  if (!row) throw new NotFoundError('Lesson draft');
  return row;
}
export async function lessonAsset(
  p: AuthPrincipal,
  assetId: string,
): Promise<Prisma.AssetGetPayload<{ include: { currentVersion: true } }>> {
  const local = await withTenant(p.tenantId, (db) =>
    db.asset.findFirst({
      where: { id: assetId, status: { in: ['approved', 'published'] } },
      include: { currentVersion: true },
    }),
  );
  if (local?.currentVersion?.ipfsCid) return local;
  const grant = await withTenant(p.tenantId, (db) =>
    db.entitlement.findFirst({ where: { userId: p.userId, assetId, revokedAt: null } }),
  );
  const listing = grant ? await getPublicCatalogListing(assetId) : null;
  if (!listing || listing.tenantId !== grant?.sellerTenantId)
    throw new ForbiddenError('Choose a reviewed library model or obtain marketplace access first.');
  const external = await withTenant(listing.tenantId, (db) =>
    db.asset.findFirst({
      where: { id: assetId, status: 'published' },
      include: { currentVersion: true },
    }),
  );
  if (!external?.currentVersion?.ipfsCid) throw new NotFoundError('Available model');
  return external;
}
export async function validatePlan(p: AuthPrincipal, plan: LessonPlan) {
  const asset = plan.assetId ? await lessonAsset(p, plan.assetId) : null;
  const privateModel = plan.privateModelId
    ? await withTenant(p.tenantId, (db) =>
        db.learningSource.findFirst({
          where: {
            id: plan.privateModelId,
            ownerId: p.userId,
            status: 'ready',
            mime: 'model/gltf-binary',
          },
        }),
      )
    : null;
  if (plan.privateModelId && !privateModel)
    throw new ValidationError('Choose your own available private model.');
  if (asset && asset.currentVersion?.id !== plan.assetVersionId)
    throw new ValidationError(
      'The selected model version changed. Re-select and review it before publishing.',
    );
  const refs = [
    ...plan.sections.flatMap((s) => s.sourceRefs),
    ...plan.sections.flatMap((s) =>
      s.activity
        ? [...s.activity.blocks, ...s.activity.targets, ...s.activity.steps].flatMap(
            (n) => n.sourceRefs,
          )
        : [],
    ),
  ];
  if (refs.some((r) => !plan.sourceIds.includes(r.sourceId)))
    throw new ValidationError('A citation is not in the lesson source list.');
  const sources = await withTenant(p.tenantId, (db) =>
    db.learningSource.findMany({
      where: { id: { in: plan.sourceIds }, ownerId: p.userId, status: 'ready' },
    }),
  );
  if (sources.length !== new Set(plan.sourceIds).size)
    throw new ValidationError('Choose ready sources belonging to you.');
  const excerpts: {
    sourceId: string;
    passageId: string;
    title: string;
    page: number;
    text: string;
  }[] = [];
  for (const ref of refs) {
    const source = sources.find((x) => x.id === ref.sourceId);
    const passage = (source?.passages as { id: string; page: number; text: string }[])?.find(
      (x) => x.id === ref.passageId,
    );
    if (!passage) throw new ValidationError('A cited source passage no longer exists.');
    if (!excerpts.some((x) => x.sourceId === ref.sourceId && x.passageId === ref.passageId))
      excerpts.push({
        sourceId: ref.sourceId,
        passageId: ref.passageId,
        title: source!.title,
        ...passage,
      });
  }
  for (const section of plan.sections)
    if (section.activity) {
      const a = section.activity;
      if (a.scene.kind === 'model' && a.scene.privateModelId) {
        if (!privateModel || a.scene.privateModelId !== privateModel.id)
          throw new ValidationError('The activity must use the selected private model.');
        const meta = privateModel.metadata as { parts: { key: string }[]; labelsReviewed: boolean };
        if (a.targets.some((t) => t.meshKey && !meta.parts.some((p) => p.key === t.meshKey)))
          throw new ValidationError('A component label references an unknown model mesh.');
        if (
          meta.parts.length < 2 &&
          a.steps.some((q) => q.kind === 'operate' && q.operation !== 'assemble')
        )
          throw new ValidationError(
            'This is a single-mesh model; use whole-model exploration or annotations.',
          );
      }
      if (a.scene.kind === 'model' && !a.scene.builtin && !a.scene.privateModelId) {
        if (
          !asset?.currentVersion ||
          !a.scene.media ||
          a.scene.assetId !== asset.id ||
          a.scene.media?.versionId !== asset.currentVersion?.id ||
          a.scene.media.cid !== asset.currentVersion.ipfsCid ||
          a.scene.media.format !== asset.currentVersion.format
        )
          throw new ValidationError('The activity must use the lesson’s selected model version.');
        const count =
          (asset.currentVersion.meshMetadata as { meshCount?: number } | null)?.meshCount ?? 0;
        if (count < 2 && a.steps.some((s) => s.kind === 'operate' && s.operation !== 'assemble'))
          throw new ValidationError(
            'This model does not have confirmed separate component meshes. Use hotspots or whole-model exploration.',
          );
      }
      if (
        a.scene.kind === 'model' &&
        a.scene.builtin &&
        a.targets.some((t) => !['box', 'sphere', 'cylinder'].includes(t.meshKey ?? ''))
      )
        throw new ValidationError(
          'Built-in geometry supports only box, sphere and cylinder components.',
        );
      const imageId = a.scene.kind === 'diagram' ? a.scene.imageSourceId : undefined;
      if (
        imageId &&
        !sources.some(
          (s) => s.id === imageId && ['image/png', 'image/jpeg', 'image/webp'].includes(s.mime),
        )
      )
        throw new ValidationError(
          'Choose a ready private image included in the lesson source list.',
        );
    }
  return excerpts;
}
/** Cross-tenant access is an explicit lesson grant, never an email-based identity match. */
export async function accessibleRelease(p: AuthPrincipal, tenantId: string, id: string) {
  const grants = await withTenant(p.tenantId, (db) =>
    db.lessonGrant.findMany({
      where: { ownerId: p.userId, releaseTenantId: tenantId, releaseId: id },
    }),
  );
  return withTenant(tenantId, async (db) => {
    const release = await db.lessonPlanRelease.findUnique({ where: { id } });
    if (!release) throw new NotFoundError('Lesson release');
    if (release.ownerId !== p.userId) {
      if (
        release.reviewed &&
        release.visibility === 'public' &&
        (await db.publicLessonEntry.findUnique({ where: { id } }))
      )
        return release;
      if (release.reviewed && release.visibility === 'institution' && p.tenantId === tenantId)
        return release;
      if (release.visibility !== 'private') throw new NotFoundError('Lesson access');
      if (
        !release.reviewed ||
        !grants.length ||
        !(await db.lessonShare.findFirst({
          where: { id: { in: grants.map((g) => g.shareId) }, releaseId: id, revokedAt: null },
        }))
      )
        throw new NotFoundError('Lesson access');
    }
    return release;
  });
}
export const parsePlan = (value: unknown) => lessonPlanSchema.parse(value);

/** Find any still-active invitation, including replacement links for the same lesson. */
export async function activeLessonShareId(p: AuthPrincipal, tenantId: string, id: string) {
  const grants = await withTenant(p.tenantId, (db) =>
    db.lessonGrant.findMany({
      where: { ownerId: p.userId, releaseTenantId: tenantId, releaseId: id },
      select: { shareId: true },
    }),
  );
  if (!grants.length) return null;
  return withTenant(
    tenantId,
    async (db) =>
      (
        await db.lessonShare.findFirst({
          where: { id: { in: grants.map((g) => g.shareId) }, releaseId: id, revokedAt: null },
          select: { id: true },
        })
      )?.id ?? null,
  );
}
