import { afterEach, describe, expect, it, vi } from 'vitest';
import { startForegroundTime } from '../src/lib/foreground-time';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('foreground study timer', () => {
  it('sends heartbeats only while visible and stops cleanly', () => {
    vi.useFakeTimers();
    let visibilityListener: (() => void) | undefined;
    const documentMock = {
      visibilityState: 'visible',
      addEventListener: (_type: string, listener: () => void) => {
        visibilityListener = listener;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('document', documentMock);
    vi.stubGlobal('window', {
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    });
    const heartbeat = vi.fn();
    const stop = startForegroundTime(heartbeat, 15_000);

    expect(heartbeat).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(15_000);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    documentMock.visibilityState = 'hidden';
    visibilityListener?.();
    expect(heartbeat).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(30_000);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    documentMock.visibilityState = 'visible';
    visibilityListener?.();
    expect(heartbeat).toHaveBeenCalledTimes(4);
    stop();
    vi.advanceTimersByTime(30_000);
    expect(heartbeat).toHaveBeenCalledTimes(5);
    expect(documentMock.removeEventListener).toHaveBeenCalledOnce();
  });
});
