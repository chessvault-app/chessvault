import { describe, expect, it } from 'vitest';
import { chunkBytes, decodeWarm, encodeWarm, PDF_RANGE_CHUNK } from './pdfWarm.ts';

describe('warm set', () => {
  const length = PDF_RANGE_CHUNK * 3 + 100;
  const fill = (i: number) => new Uint8Array(chunkBytes(PDF_RANGE_CHUNK, length, i)).fill(i + 1);

  it('round-trips, in ascending order, with a short last chunk', () => {
    const chunks = new Map([
      [3, fill(3)],
      [0, fill(0)],
      [2, fill(2)],
    ]);
    const back = decodeWarm(encodeWarm({ chunk: PDF_RANGE_CHUNK, length, mtimeMs: 1234.5, chunks }));
    expect(back.chunk).toBe(PDF_RANGE_CHUNK);
    expect(back.length).toBe(length);
    expect(back.mtimeMs).toBe(1234.5);
    expect([...back.chunks.keys()]).toEqual([0, 2, 3]);
    expect(back.chunks.get(3)!.length).toBe(100);
    expect(back.chunks.get(2)![5]).toBe(3);
  });

  it('refuses a chunk of the wrong size, and bytes that are not a set', () => {
    const chunks = new Map([[0, new Uint8Array(10)]]);
    expect(() => encodeWarm({ chunk: PDF_RANGE_CHUNK, length, mtimeMs: 0, chunks })).toThrow(/chunk 0/);
    expect(() => decodeWarm(new Uint8Array(40))).toThrow(/not a warm set/);
    expect(() => decodeWarm(new Uint8Array(3))).toThrow(/truncated/);
  });
});
