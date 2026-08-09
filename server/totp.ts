import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP, the flavour every authenticator app speaks: HMAC-SHA1,
 * 30-second steps, 6 digits. Implemented on node:crypto directly — a
 * dependency would be larger than the algorithm.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, no padding — the key format authenticator apps import. */
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[\s=]/g, '')) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(key: Uint8Array, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', Buffer.from(key)).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code =
    (((mac[offset]! & 0x7f) << 24) |
      (mac[offset + 1]! << 16) |
      (mac[offset + 2]! << 8) |
      mac[offset + 3]!) %
    10 ** DIGITS;
  return code.toString().padStart(DIGITS, '0');
}

export function totpAt(secret: string, epochMs: number, stepOffset = 0): string | null {
  const key = base32Decode(secret);
  if (!key || key.length === 0) return null;
  return hotp(key, Math.floor(epochMs / 1000 / STEP_SECONDS) + stepOffset);
}

/** Accepts the current step and one step either side — standard clock-drift
    tolerance. Comparison is constant-time; a 6-digit space is small enough
    that the login throttle, not timing, is the real defence. */
export function verifyTotp(secret: string, code: string, epochMs = Date.now()): boolean {
  const given = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return false;
  for (const offset of [0, -1, 1]) {
    const expect = totpAt(secret, epochMs, offset);
    if (expect && timingSafeEqual(Buffer.from(expect), Buffer.from(given))) return true;
  }
  return false;
}

export function otpauthUrl(secret: string, label = 'Chess Vault'): string {
  const name = encodeURIComponent(label);
  return `otpauth://totp/${name}?secret=${secret}&issuer=${name}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
