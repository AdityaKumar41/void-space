/**
 * FR-2.4's quota arithmetic, tested without a database.
 *
 * The interesting case is not "over quota is refused" — it is that the *decision* is
 * about the projected total rather than the current one. A check that looks only at
 * what is already stored can never refuse the upload that crosses the line, which is
 * the only upload it exists to stop.
 */
import { describe, expect, it } from 'vitest';

import { evaluateStudioQuota, formatBytes, type StudioStorageUsage } from '../src/quota';

const GIB = 1024n * 1024n * 1024n;

function usage(meshBytes: bigint, textureBytes: bigint): StudioStorageUsage {
  return { meshBytes, textureBytes, usedBytes: meshBytes + textureBytes };
}

describe('studio storage quota (FR-2.4)', () => {
  it('allows an upload that keeps the tenant under quota', () => {
    const decision = evaluateStudioQuota(usage(100n, 200n), GIB, 50n);

    expect(decision.allowed).toBe(true);
    expect(decision.message).toBe('');
    expect(decision.remainingBytes).toBe(GIB - 300n);
  });

  it('refuses the upload that crosses the line, not the one after it', () => {
    // 10 bytes free, uploading 11. The old total is *under* quota, so a check against
    // `usedBytes` alone would have allowed it.
    const decision = evaluateStudioQuota(usage(GIB - 10n, 0n), GIB, 11n);

    expect(decision.allowed).toBe(false);
    expect(decision.message).toMatch(/quota/i);
  });

  it('allows an upload that lands exactly on the quota', () => {
    // The boundary: `<=` rather than `<`, so a tenant can use exactly what it is
    // granted rather than being left one byte short forever.
    const decision = evaluateStudioQuota(usage(GIB - 1n, 0n), GIB, 1n);

    expect(decision.allowed).toBe(true);
    expect(decision.remainingBytes).toBe(1n);
  });

  it('ignores a negative incoming size rather than crediting the tenant', () => {
    const decision = evaluateStudioQuota(usage(GIB, 0n), GIB, -500n);

    expect(decision.allowed).toBe(true);
    expect(decision.remainingBytes).toBe(0n);
  });

  it('reports a zero remainder when already over quota', () => {
    // Over-quota is reachable by lowering a quota after the fact, so the arithmetic
    // must not go negative — a negative "free space" reads as a bug in the UI.
    const decision = evaluateStudioQuota(usage(GIB * 2n, 0n), GIB, 0n);

    expect(decision.allowed).toBe(false);
    expect(decision.remainingBytes).toBe(0n);
  });

  it('charges mesh and texture bytes together', () => {
    const decision = evaluateStudioQuota(usage(600n, 500n), 1024n, 0n);

    expect(decision.usedBytes).toBe(1100n);
    expect(decision.allowed).toBe(false);
  });

  it('formats bytes for the message a Creator reads', () => {
    expect(formatBytes(0n)).toBe('0 B');
    expect(formatBytes(512n)).toBe('512 B');
    expect(formatBytes(1024n)).toBe('1.0 KB');
    expect(formatBytes(1024n * 1024n)).toBe('1.0 MB');
    expect(formatBytes(GIB)).toBe('1.0 GB');
  });
});
