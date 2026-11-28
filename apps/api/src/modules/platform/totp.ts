import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function newTotpSecret() {
  let bits = 0,
    value = 0,
    result = '';
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return result;
}
function decode(secret: string) {
  const bytes: number[] = [];
  let bits = 0,
    value = 0;
  for (const char of secret) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error('Invalid authenticator secret');
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
export function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const bytes = createHmac('sha1', decode(secret)).update(counter).digest();
  const offset = bytes[19]! & 15;
  return String((bytes.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function totpStep(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate >= 0 && timingSafeEqual(Buffer.from(totp(secret, candidate)), Buffer.from(code)))
      return candidate;
  }
  return null;
}
