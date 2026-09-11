import { describe, expect, it } from 'vitest';
import { entryGameId, keyEntry, keyEntryHi, keyEntryLo, low16Bounds } from './keyIndex.ts';

describe('key index entries', () => {
  it('composes so numeric order is (low16, gameId, ply) order', () => {
    expect(keyEntry(0x0001ffff, 1, 0) > keyEntry(0x0001fffe, 0xffffffff, 65535)).toBe(true);
    expect(keyEntry(7, 2, 0) > keyEntry(7, 1, 65535)).toBe(true);
    expect(keyEntry(7, 1, 70000)).toBe(keyEntry(7, 1, 65535));
    expect(entryGameId(keyEntry(0xabcd1234, 0xfffffffe, 9))).toBe(0xfffffffe);
    const { lo, hi } = low16Bounds(0xabcd1234);
    expect(keyEntry(0xabcd1234, 0, 0) >= lo && keyEntry(0xabcd1234, 0xffffffff, 65535) < hi).toBe(true);
  });

  it('splits into the same two little-endian words the fill loop writes', () => {
    // keyEntry is the definition; the words are what the index pass
    // writes into the entry buffer, so they must agree bit for bit.
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    for (let i = 0; i < 20000; i += 1) {
      const key32 = Math.floor(rnd() * 0x100000000) >>> 0;
      const gameId = Math.floor(rnd() * 0x100000000) >>> 0;
      const ply = Math.floor(rnd() * 70000);
      const words = (BigInt(keyEntryHi(key32, gameId)) << 32n) | BigInt(keyEntryLo(gameId, ply));
      expect(words).toBe(keyEntry(key32, gameId, ply));
    }
    expect(keyEntryLo(0xffffffff, 65535)).toBe(0xffffffff);
    expect(keyEntryHi(0xffff, 0xffffffff)).toBe(0xffffffff);
  });
});
