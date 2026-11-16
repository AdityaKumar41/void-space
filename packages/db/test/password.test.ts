import { describe, expect, it } from 'vitest';
import { bcryptCostOf, BCRYPT_COST, hashPassword, verifyPassword } from '../src/password';

describe('password verification', () => {
  it('hashes demo-policy passwords with the configured bcrypt cost and verifies them', async () => {
    const hash = await hashPassword('VoidSpace!2026');

    expect(hash).not.toBe('VoidSpace!2026');
    expect(bcryptCostOf(hash)).toBe(BCRYPT_COST);
    await expect(verifyPassword('VoidSpace!2026', hash)).resolves.toBe(true);
    await expect(verifyPassword('WrongPassword!123', hash)).resolves.toBe(false);
  });

  it('rejects absent and malformed stored hashes without authenticating', async () => {
    await expect(verifyPassword('VoidSpace!2026', null)).resolves.toBe(false);
    await expect(verifyPassword('VoidSpace!2026', 'not-a-bcrypt-hash')).resolves.toBe(false);
    expect(bcryptCostOf('not-a-bcrypt-hash')).toBe(0);
  });
});
