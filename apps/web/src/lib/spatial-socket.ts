/**
 * Spatial room live channel. Falls back silently when the edge does not upgrade WebSockets.
 */
export type SpatialSocketHandlers = {
  onSnapshot?: (payload: unknown) => void;
  onDelta?: (payload: unknown) => void;
  onError?: (message: string) => void;
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'unsupported') => void;
};

export function connectSpatialRoom(
  roomId: string,
  handlers: SpatialSocketHandlers,
): () => void {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
    handlers.onStatus?.('unsupported');
    return () => undefined;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/api/v1/spatial/rooms/${roomId}/live-ws`;
  handlers.onStatus?.('connecting');

  let socket: WebSocket;
  try {
    socket = new WebSocket(url);
  } catch {
    handlers.onStatus?.('unsupported');
    return () => undefined;
  }

  socket.addEventListener('open', () => handlers.onStatus?.('open'));
  socket.addEventListener('close', () => handlers.onStatus?.('closed'));
  socket.addEventListener('message', (event) => {
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
      // ignore
    }
  });

  const ping = window.setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25_000);

  return () => {
    window.clearInterval(ping);
    socket.close();
  };
}
