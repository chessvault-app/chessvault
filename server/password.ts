import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * The app password at rest.
 *
 * config.json used to hold the password verbatim, so anything that could
 * read the file — a backup pulled off-box, a config pasted into a bug
 * report — held the password itself. A set password is now stored as
 * `scrypt:<saltHex>:<hashHex>`: self-describing, so a reader can tell the
 * two forms apart, verify either, and rewrite the plaintext form the
 * moment a login proves it out (see migratePlaintextPassword in auth.ts).
 *
 * scrypt rather than a bare sha256 because it is deliberately expensive
 * to brute-force offline, and its parameters are pinned here rather than
 * left to Node's defaults so a hash written today still verifies under a
 * Node that ships different defaults tomorrow. The salt is per-vault and
 * random, so two vaults with the same password store nothing in common.
 */

const SCRYPT_FORM = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/;
/** Node's current defaults, written down on purpose (see above). */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export function isHashedPassword(stored: string): boolean {
  return SCRYPT_FORM.test(stored);
}

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Accepts either form: the hashed one, or the plaintext a not-yet-migrated
 * (or hand-recovered) config still holds. A stored value that merely LOOKS
 * scrypt-ish but does not parse as the exact form falls through to the
 * plain compare, so no choosable password is ever un-enterable. Both
 * branches compare in constant time.
 *
 * Async, and `hashPassword` above is not, which looks inconsistent and is
 * the point. scrypt is expensive ON PURPOSE — that is what makes an
 * offline guess costly — and `scryptSync` spends that cost on the event
 * loop, where nothing else in the process runs meanwhile. Hashing happens
 * once, after someone has already authenticated or at boot. VERIFYING
 * happens on /auth/login, which is the one route reachable with no
 * credential at all: at N=16384 each attempt is tens of milliseconds of
 * solid block, so a stream of wrong passwords stalled every other request
 * the server was serving, including the ones that had nothing to do with
 * auth. The callback form does the work on libuv's pool instead, so the
 * loop keeps turning. The per-IP throttle in auth.ts limits how many any
 * one caller gets; this limits what those cost everybody else.
 */
export function verifyPassword(supplied: string, stored: string): Promise<boolean> {
  const match = SCRYPT_FORM.exec(stored);
  if (!match) {
    const a = Buffer.from(supplied);
    const b = Buffer.from(stored);
    return Promise.resolve(a.length === b.length && timingSafeEqual(a, b));
  }
  return new Promise((resolvePromise) => {
    scrypt(
      supplied,
      Buffer.from(match[1]!, 'hex'),
      KEY_LENGTH,
      SCRYPT_PARAMS,
      (error, hash) => {
        // A scrypt that could not run is not a password that matched.
        resolvePromise(error ? false : timingSafeEqual(hash, Buffer.from(match[2]!, 'hex')));
      },
    );
  });
}
