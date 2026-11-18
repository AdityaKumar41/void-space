import { expect, it } from 'vitest';
import { assertJsonBudget } from '../src/lib/json-budget';

it('accepts normal nested learning and spatial payloads', () => {
  expect(() =>
    assertJsonBudget({
      steps: Array.from({ length: 100 }, () => ({ id: 'step', choices: [1, 2, 3] })),
    }),
  ).not.toThrow();
});

it('rejects oversized arrays, records, deeply nested and aggregate payloads before schema validation', () => {
  let nested: unknown = null;
  for (let i = 0; i < 34; i++) nested = { nested };
  for (const value of [
    Array(1001).fill(null),
    Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [i, null])),
    nested,
    Array.from({ length: 100 }, () => Array(100).fill(null)),
  ]) {
    expect(() => assertJsonBudget(value)).toThrow('JSON payload is too complex');
  }
});
