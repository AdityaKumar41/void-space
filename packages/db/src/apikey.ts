/**
 * API key generation and hashing (SRS FR-12.3, NFR-SEC.7).
 *
 * Keys are shown to the user exactly once, at creation; only a salted scrypt
 * hash is persisted. Stored format:
 *
 *   v1$scrypt$<salt-base64>$<derived-key-base64>
 *
 * The version prefix leaves room to rotate the algorithm without a data
 * migration. Both the seed script and the Developer-facing API use these
 * helpers, so the format can never drift between them.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const API_KEY_PREFIX = 'vs_';
export const API_KEY_HASH_VERSION = 'v1';
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** scrypt cost parameters (N=2^15) — deliberately slow for an offline attack. */
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export interface GeneratedApiKey {
  /** The raw key — return it to the caller once, then forget it. */
  readonly key: string;
  /** Short public identifier for the UI and logs (never secret). */
  readonly prefix: string;
  /** What gets stored in ApiKey.hashedKey. */
  readonly hashedKey: string;
}

function scrypt(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_BYTES, SCRYPT_OPTIONS);
}

export function hashApiKey(rawKey: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scrypt(rawKey, salt);
  return [
    API_KEY_HASH_VERSION,
    'scrypt',
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export function verifyApiKey(rawKey: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 4) return false;

  const [version, algorithm, saltB64, hashB64] = parts;
  if (version !== API_KEY_HASH_VERSION || algorithm !== 'scrypt' || !saltB64 || !hashB64) {
    return false;
  }

  const expected = Buffer.from(hashB64, 'base64');
  const candidate = scrypt(rawKey, Buffer.from(saltB64, 'base64'));
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

/**
 * Creates a new key. `labelPrefix` is embedded so a key is recognisable in logs,
 * e.g. `vs_dev_ab12…`.
 */
export function generateApiKey(labelPrefix = 'dev'): GeneratedApiKey {
  const random = randomBytes(24).toString('base64url');
  const key = `${API_KEY_PREFIX}${labelPrefix}_${random}`;
  return {
    key,
    prefix: key.slice(0, 16),
    hashedKey: hashApiKey(key),
  };
}
