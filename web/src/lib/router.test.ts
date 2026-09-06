import { describe, expect, it } from 'vitest';
import { decodeSegment } from './router.ts';

describe('decodeSegment', () => {
  it('undoes what encodeURIComponent did to an id', () => {
    for (const id of ['Openings/Catalan - the long diagonal', '100% prepared', '노트: 카탈란', 'a+b&c=d']) {
      expect(decodeSegment(encodeURIComponent(id))).toBe(id);
    }
  });

  it('keeps a segment whose percent escapes nothing, rather than throwing', () => {
    // A hand-typed or truncated link. decodeURIComponent throws URIError
    // here, and it used to do so during render.
    expect(() => decodeSegment('100%')).not.toThrow();
    expect(decodeSegment('100%')).toBe('100%');
    expect(decodeSegment('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
