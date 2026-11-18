/**
 * In-process fan-out for spatial room presence and world state.
 * Replaces exclusive reliance on 3s client polling when WebSocket clients are connected.
 */

export interface SpatialSocketMessage {
  readonly type: 'room.snapshot' | 'room.delta' | 'ping' | 'error';
  readonly roomId?: string;
  readonly payload?: unknown;
  readonly message?: string;
}

/** Minimal socket surface so we do not depend on the `ws` package types at compile time. */
export interface SpatialSocket {
  readonly readyState: number;
  send(data: string): void;
}

type RoomClient = {
  readonly socket: SpatialSocket;
  readonly userId: string;
  readonly tenantId: string;
};

const rooms = new Map<string, Set<RoomClient>>();

export function subscribeRoom(roomId: string, client: RoomClient): () => void {
  const key = `${client.tenantId}:${roomId}`;
  let set = rooms.get(key);
  if (!set) {
    set = new Set();
    rooms.set(key, set);
  }
  set.add(client);
  return () => {
    set?.delete(client);
    if (set && set.size === 0) rooms.delete(key);
  };
}

export function publishRoom(tenantId: string, roomId: string, message: SpatialSocketMessage): void {
  const set = rooms.get(`${tenantId}:${roomId}`);
  if (!set) return;
  const raw = JSON.stringify(message);
  for (const client of set) {
    if (client.socket.readyState === 1) {
      try {
        client.socket.send(raw);
      } catch {
        set.delete(client);
      }
    }
  }
  if (!set.size) rooms.delete(`${tenantId}:${roomId}`);
}

export function roomSubscriberCount(tenantId: string, roomId: string): number {
  return rooms.get(`${tenantId}:${roomId}`)?.size ?? 0;
}
