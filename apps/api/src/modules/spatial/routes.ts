/**
 * Device-neutral spatial delivery API. Clients poll a short-lived presence
 * projection today; the persisted room/world contract is also the durable seam
 * for a WebSocket or managed realtime fan-out adapter without changing XR
 * clients or sacrificing tenancy enforcement.
 */
import { recordAudit, withTenant, type Prisma } from '@void-space/db';
import {
  createSpatialRoomSchema,
  spatialHeartbeatSchema,
  spatialWorldStateSchema,
  storedExperienceSchema,
} from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';

const paramsSchema = z.object({ id: z.string().uuid() });
const PRESENCE_TTL_MS = 90_000;

function roomView(room: {
  id: string;
  title: string;
  status: string;
  lessonId: string | null;
  assetId: string | null;
  worldState: unknown;
  lesson?: {
    assetVersion: {
      id: string;
      ipfsCid: string | null;
      format: string;
      polycount: number | null;
    } | null;
  } | null;
  asset?: {
    currentVersion: {
      id: string;
      ipfsCid: string | null;
      format: string;
      polycount: number | null;
    } | null;
  } | null;
  participants?: readonly {
    user: { id: string; fullName: string };
    pose: unknown;
    lastSeenAt: Date;
  }[];
}) {
  const version = room.lesson?.assetVersion ?? room.asset?.currentVersion;
  return {
    media: version
      ? {
          versionId: version.id,
          cid: version.ipfsCid,
          format: version.format,
          polycount: version.polycount,
        }
      : null,
    id: room.id,
    title: room.title,
    status: room.status,
    lessonId: room.lessonId,
    assetId: room.assetId,
    worldState: room.worldState,
    participants:
      room.participants?.map((entry) => ({
        userId: entry.user.id,
        fullName: entry.user.fullName,
        pose: entry.pose,
        lastSeenAt: entry.lastSeenAt.toISOString(),
      })) ?? [],
  };
}

export async function spatialRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/spatial/rooms',
    { preHandler: app.requirePermission('spatial:manage') },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new ForbiddenError('Authentication required', 'UNAUTHENTICATED');
      const input = parseBody(createSpatialRoomSchema, request.body);
      const room = await withTenant(principal.tenantId, async (db) => {
        if (input.lessonId) {
          const lesson = await db.lesson.findFirst({
            where: { id: input.lessonId, tenantId: principal.tenantId, isPublished: true },
            select: { id: true },
          });
          if (!lesson)
            throw new ValidationError(
              'Spatial rooms may reference only published workspace lessons',
            );
        }
        if (input.assetId) {
          const asset = await db.asset.findFirst({
            where: {
              id: input.assetId,
              tenantId: principal.tenantId,
              status: { in: ['approved', 'published'] },
            },
            select: { id: true },
          });
          if (!asset)
            throw new ValidationError('Spatial rooms may reference only approved workspace assets');
        }
        const experienceId =
          input.experienceId ??
          (typeof input.worldState.experienceId === 'string'
            ? input.worldState.experienceId
            : undefined);
        if (experienceId) {
          const experience = await db.simulationScenario.findFirst({
            where: { id: experienceId, tenantId: principal.tenantId, status: 'published' },
            select: { experience: true },
          });
          if (!experience || !storedExperienceSchema.safeParse(experience.experience).success)
            throw new ValidationError(
              'Select a published interactive experience in this workspace',
            );
        }
        const created = await db.spatialRoom.create({
          data: {
            tenantId: principal.tenantId,
            title: input.title,
            lessonId: input.lessonId,
            assetId: input.assetId,
            worldState: {
              ...input.worldState,
              ...(experienceId ? { experienceId } : {}),
            } as Prisma.InputJsonValue,
            createdById: principal.userId,
          },
        });
        await recordAudit(
          {
            action: 'spatial.room_created',
            entityType: 'spatial_room',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
            afterState: { lessonId: created.lessonId, assetId: created.assetId },
          },
          db,
        );
        return created;
      });
      return reply.status(201).send({ room: roomView(room) });
    },
  );

  app.get(
    '/spatial/rooms',
    { preHandler: app.requirePermission('spatial:join') },
    async (request) => {
      const principal = request.principal!;
      const rooms = await withTenant(principal.tenantId, (db) =>
        db.spatialRoom.findMany({
          where: { tenantId: principal.tenantId, status: 'live' },
          orderBy: { updatedAt: 'desc' },
          include: {
            participants: {
              where: { lastSeenAt: { gte: new Date(Date.now() - PRESENCE_TTL_MS) } },
              include: { user: { select: { id: true, fullName: true } } },
            },
          },
        }),
      );
      return { rooms: rooms.map(roomView) };
    },
  );

  app.post(
    '/spatial/rooms/:id/live',
    { preHandler: app.requirePermission('spatial:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const room = await withTenant(principal.tenantId, async (db) => {
        const updated = await db.spatialRoom.updateMany({
          where: { id, tenantId: principal.tenantId },
          data: { status: 'live' },
        });
        if (!updated.count) throw new NotFoundError('Spatial room not found');
        await recordAudit(
          {
            action: 'spatial.room_live',
            entityType: 'spatial_room',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return db.spatialRoom.findUniqueOrThrow({ where: { id } });
      });
      return { room: roomView(room) };
    },
  );

  app.get(
    '/spatial/rooms/:id',
    { preHandler: app.requirePermission('spatial:join') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
      const room = await withTenant(principal.tenantId, (db) =>
        db.spatialRoom.findFirst({
          where: { id, tenantId: principal.tenantId, status: 'live' },
          include: {
            lesson: {
              select: {
                assetVersion: {
                  select: { id: true, ipfsCid: true, format: true, polycount: true },
                },
              },
            },
            asset: {
              select: {
                currentVersion: {
                  select: { id: true, ipfsCid: true, format: true, polycount: true },
                },
              },
            },
            participants: {
              where: { lastSeenAt: { gte: cutoff } },
              include: { user: { select: { id: true, fullName: true } } },
              orderBy: { lastSeenAt: 'desc' },
            },
          },
        }),
      );
      if (!room) throw new NotFoundError('Live spatial room not found');
      return { room: roomView(room), presenceTtlSeconds: PRESENCE_TTL_MS / 1000 };
    },
  );

  app.post(
    '/spatial/rooms/:id/heartbeat',
    { preHandler: app.requirePermission('spatial:join') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const input = parseBody(spatialHeartbeatSchema, request.body);
      const participant = await withTenant(principal.tenantId, async (db) => {
        const room = await db.spatialRoom.findFirst({
          where: { id, tenantId: principal.tenantId, status: 'live' },
          select: { id: true },
        });
        if (!room) throw new NotFoundError('Live spatial room not found');
        return db.spatialParticipant.upsert({
          where: { roomId_userId: { roomId: id, userId: principal.userId } },
          create: {
            tenantId: principal.tenantId,
            roomId: id,
            userId: principal.userId,
            pose: input.pose,
          },
          update: { pose: input.pose, lastSeenAt: new Date() },
        });
      });
      return {
        participant: { id: participant.id, lastSeenAt: participant.lastSeenAt.toISOString() },
      };
    },
  );

  app.post(
    '/spatial/rooms/:id/archive',
    { preHandler: app.requirePermission('spatial:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      await withTenant(principal.tenantId, async (db) => {
        const updated = await db.spatialRoom.updateMany({
          where: { id, tenantId: principal.tenantId },
          data: { status: 'archived' },
        });
        if (!updated.count) throw new NotFoundError('Spatial room');
        await db.spatialParticipant.deleteMany({
          where: { roomId: id, tenantId: principal.tenantId },
        });
        await recordAudit(
          {
            action: 'spatial.room_archived',
            entityType: 'spatial_room',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
      });
      return { archived: true };
    },
  );

  app.post(
    '/spatial/rooms/:id/leave',
    { preHandler: app.requirePermission('spatial:join') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      await withTenant(principal.tenantId, async (db) => {
        const room = await db.spatialRoom.findFirst({
          where: { id, tenantId: principal.tenantId },
          select: { id: true },
        });
        if (!room) throw new NotFoundError('Spatial room');
        await db.spatialParticipant.deleteMany({
          where: { roomId: id, userId: principal.userId, tenantId: principal.tenantId },
        });
      });
      return { left: true };
    },
  );

  app.patch(
    '/spatial/rooms/:id/world',
    { preHandler: app.requirePermission('spatial:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = paramsSchema.parse(request.params);
      const input = parseBody(spatialWorldStateSchema, request.body);
      if (input.worldState.experienceId !== undefined) {
        const experienceId = z.string().uuid().parse(input.worldState.experienceId);
        const valid = await withTenant(principal.tenantId, (db) =>
          db.simulationScenario.findFirst({
            where: { id: experienceId, tenantId: principal.tenantId, status: 'published' },
            select: { experience: true },
          }),
        );
        if (!valid || !storedExperienceSchema.safeParse(valid.experience).success)
          throw new ValidationError('Select a published interactive experience in this workspace');
      }
      const room = await withTenant(principal.tenantId, async (db) => {
        const updated = await db.spatialRoom.updateMany({
          where: { id, tenantId: principal.tenantId, status: { in: ['draft', 'live'] } },
          data: { worldState: input.worldState as Prisma.InputJsonValue },
        });
        if (!updated.count) throw new NotFoundError('Spatial room not found');
        await recordAudit(
          {
            action: 'spatial.world_updated',
            entityType: 'spatial_room',
            entityId: id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return db.spatialRoom.findUniqueOrThrow({ where: { id } });
      });
      return { room: roomView(room) };
    },
  );
}
