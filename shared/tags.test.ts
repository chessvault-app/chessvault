import { describe, expect, it } from 'vitest';
import {
  MAX_TAGS,
  formatTagLine,
  frontMatterWithTags,
  normaliseTags,
  pgnHeadersWithTags,
  tagsFromFrontMatter,
  tagsFromPgnHeaders,
  tagsFromPgnText,
} from './tags.ts';

describe('tag rules', () => {
  it('lower-cases, trims and de-duplicates', () => {
    expect(normaliseTags([' Endgame ', 'endgame', '#rook', 'ROOK'])).toEqual(['endgame', 'rook']);
  });

  it('drops what cannot round trip through either format', () => {
    // A comma would split the note's inline list; a newline would end it.
    expect(normaliseTags(['a,b', 'c\nd', '', '   '])).toEqual(['a b', 'c d']);
    expect(normaliseTags(['x'.repeat(25)])).toEqual([]);
  });

  it('is bounded', () => {
    const many = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    expect(normaliseTags(many)).toHaveLength(MAX_TAGS);
  });
});

describe('front matter', () => {
  it('reads the inline form and the block list', () => {
    expect(tagsFromFrontMatter('---\ntags: Opening, Sicilian\n---\n')).toEqual([
      'opening',
      'sicilian',
    ]);
    expect(tagsFromFrontMatter('---\ntags:\n  - endgame\n  - "rook"\n---\n')).toEqual([
      'endgame',
      'rook',
    ]);
    expect(tagsFromFrontMatter('')).toEqual([]);
    expect(tagsFromFrontMatter('---\ntitle: x\n---\n')).toEqual([]);
  });

  it('writes a block where there was none', () => {
    expect(frontMatterWithTags('', ['Endgame', 'rook'])).toBe('---\ntags: endgame, rook\n---\n');
  });

  it('leaves every other key exactly as its author wrote it', () => {
    const front = '---\naliases:\n  - Lucena\ncssclass: wide\ntags: old\n---\n';
    expect(frontMatterWithTags(front, ['new'])).toBe(
      '---\ntags: new\naliases:\n  - Lucena\ncssclass: wide\n---\n',
    );
  });

  it('replaces a block list rather than appending to it', () => {
    const front = '---\ntags:\n  - a\n  - b\ntitle: x\n---\n';
    expect(frontMatterWithTags(front, ['c'])).toBe('---\ntags: c\ntitle: x\n---\n');
  });

  it('removes the block when the last tag goes and nothing else is in it', () => {
    expect(frontMatterWithTags('---\ntags: a\n---\n', [])).toBe('');
    // But not when it holds something else.
    expect(frontMatterWithTags('---\ntags: a\ntitle: x\n---\n', [])).toBe('---\ntitle: x\n---\n');
  });

  it('round-trips', () => {
    const front = frontMatterWithTags('', ['endgame', 'rook']);
    expect(tagsFromFrontMatter(front)).toEqual(['endgame', 'rook']);
  });
});

describe('pgn headers', () => {
  it('round-trips through a header', () => {
    const headers = pgnHeadersWithTags({ Event: 'x' }, ['Endgame', 'rook']);
    expect(headers).toEqual({ Event: 'x', Tags: 'endgame, rook' });
    expect(tagsFromPgnHeaders(headers)).toEqual(['endgame', 'rook']);
  });

  it('removes the header rather than leaving it empty', () => {
    expect(pgnHeadersWithTags({ Event: 'x', Tags: 'a' }, [])).toEqual({ Event: 'x' });
  });

  it('reads off raw text without parsing the game', () => {
    const pgn = '[Event "Study: Chapter 1"]\n[Tags "endgame, rook"]\n[Result "*"]\n\n*\n';
    expect(tagsFromPgnText(pgn)).toEqual(['endgame', 'rook']);
    expect(tagsFromPgnText('[Event "x"]\n\n*\n')).toEqual([]);
  });

  it('formats what it stores', () => {
    expect(formatTagLine([' A ', 'a', 'B'])).toBe('a, b');
  });
});
