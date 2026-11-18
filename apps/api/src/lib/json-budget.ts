import { AppError } from './errors';

/** Bound validation work before schemas collect an issue for every invalid element. */
export function assertJsonBudget(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const entry = pending.pop()!;
    if (++nodes > 10_000 || entry.depth > 32) reject();
    if (entry.value === null || typeof entry.value !== 'object') continue;
    const keys = Object.keys(entry.value);
    if (keys.length > 1_000) reject();
    for (const key of keys) {
      pending.push({
        value: (entry.value as Record<string, unknown>)[key],
        depth: entry.depth + 1,
      });
    }
  }
}

function reject(): never {
  throw new AppError('JSON payload is too complex; submit smaller collections', {
    statusCode: 413,
    code: 'PAYLOAD_TOO_COMPLEX',
  });
}
