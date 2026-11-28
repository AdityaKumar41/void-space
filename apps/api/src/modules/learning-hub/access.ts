import type { AuthPrincipal, LearningActivity } from '@void-space/types';
import type { TenantClient, Prisma } from '@void-space/db';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
export const isTeacher = (p: AuthPrincipal) => p.permissions.includes('learning:manage');
export function requireTeacher(p: AuthPrincipal) {
  if (!isTeacher(p))
    throw new ForbiddenError(
      'Only an authorized teacher or author can publish or assign learning content',
    );
}
export async function readableActivity(
  db: TenantClient,
  p: AuthPrincipal,
  id: string,
): Promise<Prisma.SimulationScenarioGetPayload<Record<string, never>>> {
  const row = await db.simulationScenario.findFirst({
    where: {
      id,
      OR: [{ createdById: p.userId }, { status: 'published', learningScope: 'workspace' }],
    },
  });
  if (!row) throw new NotFoundError('Learning activity');
  return row;
}
export async function validateActivitySources(
  db: TenantClient,
  p: AuthPrincipal,
  a: LearningActivity,
): Promise<void> {
  if (a.scene.kind === 'model' && a.scene.privateModelId)
    throw new ValidationError(
      'Use private library models inside personal lesson plans. Graded experiences require a reviewed workspace model.',
    );
  const refs = [
    ...a.blocks.flatMap((x) => x.sourceRefs),
    ...a.targets.flatMap((x) => x.sourceRefs),
    ...a.steps.flatMap((x) => x.sourceRefs),
  ];
  const ids = [
    ...new Set(refs.map((x) => x.sourceId)),
    ...(a.scene.kind === 'diagram' && a.scene.imageSourceId ? [a.scene.imageSourceId] : []),
  ];
  const sources = await db.learningSource.findMany({
    where: { id: { in: ids }, ownerId: p.userId, status: 'ready' },
  });
  if (sources.length !== new Set(ids).size)
    throw new ValidationError('Use ready sources that belong to you');
  for (const ref of refs) {
    const source = sources.find((s) => s.id === ref.sourceId);
    const passages = source?.passages as { id: string }[];
    if (!passages?.some((x) => x.id === ref.passageId))
      throw new ValidationError('A source passage is missing');
  }
  if (a.scene.kind === 'model' && a.scene.assetId) {
    const asset = await db.asset.findFirst({
      where: { id: a.scene.assetId, status: { in: ['approved', 'published'] } },
      include: { currentVersion: true },
    });
    if (
      !asset?.currentVersion?.ipfsCid ||
      a.scene.media?.versionId !== asset.currentVersion.id ||
      a.scene.media.cid !== asset.currentVersion.ipfsCid ||
      a.scene.media.format !== asset.currentVersion.format
    )
      throw new ValidationError('Confirm the current reviewed model version before publishing');
    const meta = asset.currentVersion.meshMetadata as Record<string, unknown> | null;
    if (
      a.steps.some((s) => s.kind === 'operate' && s.operation !== 'assemble') &&
      (typeof meta?.meshCount !== 'number' || meta.meshCount < 2)
    )
      throw new ValidationError('This model has no separate component meshes');
  }
  return;
}
export function publicActivity(a: LearningActivity) {
  return {
    ...a,
    steps: a.steps.map((step) => {
      const { explanation, ...rest } = step;
      const safe: Record<string, unknown> = { ...rest };
      if (step.kind === 'order')
        safe.items = [...step.items].sort((a, b) => a.id.localeCompare(b.id));
      for (const key of ['correctIds', 'correctOrder', 'pairs', 'targetId']) delete safe[key];
      return safe;
    }),
  };
}

export function requirePrivateAuthor(p: AuthPrincipal) {
  if (!isTeacher(p) && !p.permissions.includes('learning:generate-private'))
    throw new ForbiddenError(
      'A learner or author membership is required to generate private practice',
    );
}
