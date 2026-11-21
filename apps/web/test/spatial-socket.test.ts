import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectSpatialRoom } from '../src/lib/spatial-socket';
import { apiFetch } from '../src/lib/api';
vi.mock('../src/lib/api', () => ({ apiFetch: vi.fn().mockResolvedValue({}) }));
class Socket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 0;
  send = vi.fn();
  constructor(readonly url: string) {
    super();
    Socket.instances.push(this);
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { location: { protocol: 'https:', host: 'space.test' } }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('renews authentication and reconnects after an interruption, then cancels on unmount', async () => {
  const status = vi.fn();
  const close = connectSpatialRoom('room', { onStatus: status });
  Socket.instances[0]!.open();
  Socket.instances[0]!.drop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(apiFetch).toHaveBeenCalledWith('/auth/me');
  expect(Socket.instances).toHaveLength(2);
  Socket.instances[1]!.open();
  close();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});
it('does not reconnect to an ended room and ignores frames after cleanup', async () => {
  const onSnapshot = vi.fn();
  const close = connectSpatialRoom('room', { onSnapshot });
  Socket.instances[0]!.drop(4404);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Socket.instances).toHaveLength(1);
  close();
  Socket.instances[0]!.dispatchEvent(
    Object.assign(new Event('message'), {
      data: JSON.stringify({ type: 'room.snapshot', payload: {} }),
    }),
  );
  expect(onSnapshot).not.toHaveBeenCalled();
});

it('does not create two sockets when network recovery overlaps an authentication retry', async () => {
  let renew: (value: unknown) => void = () => undefined;
  vi.mocked(apiFetch).mockReturnValueOnce(
    new Promise((resolve) => {
      renew = resolve;
    }),
  );
  const close = connectSpatialRoom('room', {});
  Socket.instances[0]!.open();
  Socket.instances[0]!.drop();
  await vi.advanceTimersByTimeAsync(1000);
  window.dispatchEvent(new Event('online'));
  expect(Socket.instances).toHaveLength(2);
  renew({});
  await Promise.resolve();
  await Promise.resolve();
  expect(Socket.instances).toHaveLength(2);
  close();
});
