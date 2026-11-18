import { expect, it, vi } from 'vitest';
import { publishRoom, subscribeRoom, roomSubscriberCount } from '../src/modules/spatial/hub';
it('isolates room fan-out by tenant, even while a subscription awaits its first snapshot', () => {
  const own = { readyState: 1, send: vi.fn() };
  const stranger = { readyState: 1, send: vi.fn() };
  const closeOwn = subscribeRoom('room', { socket: own, tenantId: 'owner', userId: 'a' });
  const closeOther = subscribeRoom('room', { socket: stranger, tenantId: 'other', userId: 'b' });
  try {
    publishRoom('owner', 'room', { type: 'room.delta', payload: { private: 'value' } });
    expect(own.send).toHaveBeenCalledTimes(1);
    expect(stranger.send).not.toHaveBeenCalled();
  } finally {
    closeOwn();
    closeOther();
  }
  expect(roomSubscriberCount('owner', 'room')).toBe(0);
});
it('keeps delivering when a disconnected peer throws while sending', () => {
  const failing = {
    readyState: 1,
    send: vi.fn(() => {
      throw new Error('disconnected');
    }),
  };
  const healthy = { readyState: 1, send: vi.fn() };
  const closeA = subscribeRoom('race', { socket: failing, tenantId: 'owner', userId: 'a' });
  const closeB = subscribeRoom('race', { socket: healthy, tenantId: 'owner', userId: 'b' });
  try {
    expect(() => publishRoom('owner', 'race', { type: 'ping' })).not.toThrow();
    expect(healthy.send).toHaveBeenCalledTimes(1);
    expect(roomSubscriberCount('owner', 'race')).toBe(1);
  } finally {
    closeA();
    closeB();
  }
});
