import { describe, expect, it } from 'vitest';
import { shareFileName } from './share-doc';

describe('shareFileName', () => {
  it('keeps an ordinary name and adds the extension', () => {
    expect(shareFileName('Najdorf notes', '.pgn')).toBe('Najdorf notes.pgn');
  });

  it('takes the characters a file name cannot hold out of it', () => {
    // A document may be called anything; a share target may not.
    expect(shareFileName('Kaspárov: 1/2', '.pgn')).toBe('Kaspárov 1 2.pgn');
  });

  it('leaves room for the extension inside the byte limit', () => {
    // 255 UTF-8 bytes is the cap a name has to fit; the extension is
    // part of what has to fit, which is what the reserve is for.
    const long = '가'.repeat(200);
    const out = shareFileName(long, '.md');
    expect(out.endsWith('.md')).toBe(true);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(255);
  });

  it('falls back rather than returning a bare extension', () => {
    expect(shareFileName('...', '.md')).toBe('Untitled.md');
  });
});
