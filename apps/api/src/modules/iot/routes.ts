import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { recordAudit, withTenant, type Prisma } from '@void-space/db';
import {
  createDigitalTwinSchema,
  deviceTelemetrySchema,
  registerIoTDeviceSchema,
} from '@void-space/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { parseBody } from '../../lib/http';

const idParams = z.object({ id: z.string().uuid() });
const deviceHeaders = z.object({
  'x-device-id': z.string().uuid(),
  'x-device-secret': z.string().min(32).max(256),
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function iotRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/iot/devices',
    { preHandler: app.requirePermission('iot:manage') },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw new ForbiddenError('Authentication required', 'UNAUTHENTICATED');
      const input = parseBody(registerIoTDeviceSchema, request.body);
      const secret = randomBytes(32).toString('base64url');
      const device = await withTenant(principal.tenantId, async (db) => {
        const created = await db.ioTDevice.create({
          data: {
            tenantId: principal.tenantId,
            label: input.label,
            metadata: input.metadata as Prisma.InputJsonValue | undefined,
            secretHash: hash(secret),
            createdById: principal.userId,
          },
        });
        await recordAudit(
          {
            action: 'iot.device_registered',
            entityType: 'iot_device',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return created;
      });
      return reply.status(201).send({
        device: { id: device.id, label: device.label, status: device.status },
        deviceSecret: secret,
      });
    },
  );

  app.get('/iot/devices', { preHandler: app.requirePermission('iot:manage') }, async (request) => {
    const principal = request.principal!;
    const devices = await withTenant(principal.tenantId, (db) =>
      db.ioTDevice.findMany({
        where: { tenantId: principal.tenantId },
        orderBy: { updatedAt: 'desc' },
        include: { twins: true },
      }),
    );
    return {
      devices: devices.map((d) => ({
        id: d.id,
        label: d.label,
        status: d.status,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        twins: d.twins.map((t) => ({ id: t.id, label: t.label, state: t.state })),
      })),
    };
  });

  app.get(
    '/iot/devices/:id/telemetry',
    { preHandler: app.requirePermission('iot:manage') },
    async (request) => {
      const principal = request.principal!;
      const { id } = idParams.parse(request.params);
      const telemetry = await withTenant(principal.tenantId, async (db) => {
        const device = await db.ioTDevice.findFirst({
          where: { id, tenantId: principal.tenantId },
          select: { id: true },
        });
        if (!device) throw new NotFoundError('Device');
        return db.deviceTelemetry.findMany({
          where: { tenantId: principal.tenantId, deviceId: id },
          orderBy: { receivedAt: 'desc' },
          take: 200,
        });
      });
      return {
        telemetry: telemetry.map((entry) => ({
          id: entry.id,
          payload: entry.payload,
          eventAt: entry.eventAt?.toISOString() ?? null,
          receivedAt: entry.receivedAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    '/iot/twins',
    { preHandler: app.requirePermission('iot:manage') },
    async (request, reply) => {
      const principal = request.principal!;
      const input = parseBody(createDigitalTwinSchema, request.body);
      const twin = await withTenant(principal.tenantId, async (db) => {
        const device = await db.ioTDevice.findFirst({
          where: { id: input.deviceId, tenantId: principal.tenantId, status: 'active' },
        });
        if (!device) throw new NotFoundError('Active device');
        if (input.assetId) {
          const asset = await db.asset.findFirst({
            where: {
              id: input.assetId,
              tenantId: principal.tenantId,
              status: { in: ['approved', 'published'] },
            },
          });
          if (!asset) throw new ValidationError('Digital twins require approved assets');
        }
        const created = await db.digitalTwin.create({
          data: {
            tenantId: principal.tenantId,
            deviceId: input.deviceId,
            assetId: input.assetId,
            label: input.label,
            state: input.state as Prisma.InputJsonValue,
          },
        });
        await recordAudit(
          {
            action: 'iot.twin_created',
            entityType: 'digital_twin',
            entityId: created.id,
            actorId: principal.userId,
            actorLabel: principal.fullName,
          },
          db,
        );
        return created;
      });
      return reply
        .status(201)
        .send({ twin: { id: twin.id, label: twin.label, state: twin.state } });
    },
  );

  app.post(
    '/iot/telemetry',
    { preHandler: app.requirePermission('iot:manage') },
    async (request, reply) => {
      const principal = request.principal!;
      const headers = deviceHeaders.parse(request.headers);
      const input = parseBody(deviceTelemetrySchema, request.body);
      const supplied = Buffer.from(hash(headers['x-device-secret']), 'utf8');
      const found = await withTenant(principal.tenantId, async (db) => {
        const device = await db.ioTDevice.findFirst({
          where: { id: headers['x-device-id'], tenantId: principal.tenantId, status: 'active' },
          select: { id: true, secretHash: true },
        });
        if (!device) throw new NotFoundError('Active device');
        if (
          supplied.length !== Buffer.byteLength(device.secretHash) ||
          !timingSafeEqual(supplied, Buffer.from(device.secretHash, 'utf8'))
        )
          throw new ForbiddenError('Device credentials rejected', 'DEVICE_AUTH_INVALID');
        const telemetry = await db.deviceTelemetry.create({
          data: {
            tenantId: principal.tenantId,
            deviceId: device.id,
            payload: input.payload as Prisma.InputJsonValue,
            eventAt: input.eventAt ? new Date(input.eventAt) : null,
          },
        });
        await db.ioTDevice.update({
          where: { id: device.id },
          data: { lastSeenAt: telemetry.receivedAt },
        });
        await db.digitalTwin.updateMany({
          where: { tenantId: principal.tenantId, deviceId: device.id },
          data: { state: input.payload as Prisma.InputJsonValue },
        });
        await recordAudit(
          {
            action: 'iot.telemetry_received',
            entityType: 'iot_device',
            entityId: device.id,
            actorLabel: `device:${device.id}`,
            afterState: { telemetryId: telemetry.id },
          },
          db,
        );
        return telemetry;
      });
      return reply
        .status(202)
        .send({ telemetryId: found.id, receivedAt: found.receivedAt.toISOString() });
    },
  );
}
