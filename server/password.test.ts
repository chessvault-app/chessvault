import { describe, expect, it } from 'vitest';
import { hashPassword, isHashedPassword, verifyPassword } from './password.ts';

describe('password at rest', () => {
  it('round-trips through the self-describing scrypt form', () => {
    const stored = hashPassword('hunter2');
    expect(stored).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(isHashedPassword(stored)).toBe(true);
    expect(verifyPassword('hunter2', stored)).toBe(true);
    expect(verifyPassword('hunter3', stored)).toBe(false);
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('salts per hash: the same password never stores the same bytes twice', () => {
    expect(hashPassword('hunter2')).not.toBe(hashPassword('hunter2'));
  });

  it('still verifies the plaintext form a pre-migration config holds', () => {
    expect(isHashedPassword('hunter2')).toBe(false);
    expect(verifyPassword('hunter2', 'hunter2')).toBe(true);
    expect(verifyPassword('nope', 'hunter2')).toBe(false);
  });

  it('treats a password that merely looks scrypt-ish as plain', () => {
    // The form is exact (fixed hex lengths); anything else — including a
    // password somebody chose that starts with "scrypt:" — compares as
    // the literal string it is, so it stays enterable.
    const odd = 'scrypt:notreally:apassword';
    expect(isHashedPassword(odd)).toBe(false);
    expect(verifyPassword(odd, odd)).toBe(true);
    expect(verifyPassword('scrypt:notreally:different', odd)).toBe(false);
  });
});
