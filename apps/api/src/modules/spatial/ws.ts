/**
 * WebSocket fan-out for spatial rooms: `/api/v1/spatial/rooms/:id/live-ws`
 * Clients still heartbeat over HTTP; this channel pushes roster/world snapshots.
 */
import websocket from '@fastify/websocket';
import { withTenant } from '@void-space/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { publishRoom, subscribeRoom } from './hub';

const paramsSchema = z.object({ id: z.string().uuid() });

export async function spatialWebsocketPlugin(app: FastifyInstance): Promise<void> {
  await app.register(websocket);

  app.get(
    '/spatial/rooms/:id/live-ws',
    { websocket: true, preHandler: app.requirePermission('spatial:join') },
    (socket, request) => {
      const principal = request.principal;
      if (!principal) {
        socket.close(4401, 'unauthenticated');
        return;
      }

      let roomId: string;
      try {
        roomId = paramsSchema.parse(request.params).id;
      } catch {
        socket.close(4400, 'invalid room');
        return;
      }

      const unsubscribe = subscribeRoom(roomId, {
        socket,
        userId: principal.userId,
        tenantId: principal.tenantId,
      });

      const pushSnapshot = async () => {
        if (socket.readyState !== 1) return;
        try {
          // A long-lived connection must not outlive a revoked session or role.
          await app.authenticate(request);
          const snapshot = await withTenant(principal.tenantId, async (db) => {
            const room = await db.spatialRoom.findFirst({
              where: { id: roomId, tenantId: principal.tenantId, status: 'live' },
              include: {
                participants: {
                  where: { lastSeenAt: { gt: new Date(Date.now() - 90_000) } },
                  include: { user: { select: { id: true, fullName: true } } },
                },
              },
            });
            if (!room) return null;
            return {
              id: room.id,
              title: room.title,
              status: room.status,
              worldState: room.worldState,
              participants: room.participants.map((entry) => ({
                userId: entry.user.id,
                fullName: entry.user.fullName,
                pose: entry.pose,
                lastSeenAt: entry.lastSeenAt.toISOString(),
              })),
            };
          });
          if (socket.readyState !== 1) return;
          if (!snapshot) {
            socket.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
            socket.close(4404, 'not found');
            return;
          }
          socket.send(JSON.stringify({ type: 'room.snapshot', roomId, payload: snapshot }));
        } catch {
          if (socket.readyState !== 1) return;
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'The room connection could not be verified. Rejoin the space.',
            }),
          );
          socket.close(1011, 'snapshot unavailable');
        }
      };

      void pushSnapshot();
      const timer = setInterval(() => void pushSnapshot(), 5_000);

      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[] | string) => {
        try {
          const parsed = JSON.parse(String(raw)) as { type?: string };
          if (parsed.type === 'ping') {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
          if (parsed.type === 'refresh') void pushSnapshot();
        } catch {
          // ignore malformed client frames
        }
      });

      socket.on('close', () => {
        clearInterval(timer);
        unsubscribe();
      });
      socket.on('error', () => {
        clearInterval(timer);
        unsubscribe();
        socket.close();
      });
    },
  );
}

/** Call after world/heartbeat mutations so connected peers refresh promptly. */
export function notifySpatialRoom(tenantId: string, roomId: string, payload: unknown): void {
  publishRoom(tenantId, roomId, { type: 'room.delta', roomId, payload });
}
