/** Reconnect the live channel while HTTP polling remains available during interruptions. */
import { apiFetch } from './api';
export type SpatialSocketHandlers = {
  onSnapshot?: (payload: unknown) => void;
  onDelta?: (payload: unknown) => void;
  onError?: (message: string) => void;
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'unsupported') => void;
};
export function connectSpatialRoom(roomId: string, handlers: SpatialSocketHandlers): () => void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
    handlers.onStatus?.('unsupported');
    return () => undefined;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/api/v1/spatial/rooms/${encodeURIComponent(roomId)}/live-ws`;
  let disposed = false;
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  function clearPing() {
    if (ping !== undefined) clearInterval(ping);
    ping = undefined;
  }
  function connect() {
    if (disposed || stopped) return;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;
    handlers.onStatus?.('connecting');
    try {
      socket = new WebSocket(url);
    } catch {
      handlers.onStatus?.('unsupported');
      return;
    }
    const current = socket;
    current.addEventListener('open', () => {
      if (disposed) {
        current.close();
        return;
      }
      attempt = 0;
      handlers.onStatus?.('open');
      clearPing();
      ping = setInterval(() => {
        if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'ping' }));
      }, 25_000);
    });
    current.addEventListener('error', () => {
      /* close handles recovery */
    });
    current.addEventListener('close', (event) => {
      clearPing();
      if (disposed) return;
      handlers.onStatus?.('closed');
      if (event.code === 4404 || event.code === 4403 || event.code === 4400) {
        stopped = true;
        return;
      }
      retry = setTimeout(
        async () => {
          // A socket retains the opening token; renew an expired cookie before reconnecting.
          try {
            await apiFetch('/auth/me');
          } catch {
            /* HTTP polling reports persistent auth failures. */
          }
          connect();
        },
        Math.min(1000 * 2 ** attempt++, 15_000),
      );
    });
    current.addEventListener('message', (event) => {
      if (disposed) return;
      try {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          payload?: unknown;
          message?: string;
        };
        if (message.type === 'room.snapshot') handlers.onSnapshot?.(message.payload);
        if (message.type === 'room.delta') handlers.onDelta?.(message.payload);
        if (message.type === 'error' && message.message) handlers.onError?.(message.message);
      } catch {
        /* Ignore malformed frames; the HTTP room remains authoritative. */
      }
    });
  }
  function online() {
    if (!disposed && !stopped && (!socket || socket.readyState === WebSocket.CLOSED)) {
      if (retry !== undefined) clearTimeout(retry);
      connect();
    }
  }
  window.addEventListener('online', online);
  connect();
  return () => {
    disposed = true;
    if (retry !== undefined) clearTimeout(retry);
    clearPing();
    window.removeEventListener('online', online);
    socket?.close();
  };
}
