import { describe, expect, it } from 'vitest';
import { readAliases, splitFrontMatter, writeAliases } from './frontMatter.ts';

describe('splitFrontMatter', () => {
  it('takes a block that opens the file', () => {
    const { front, body } = splitFrontMatter('---\naliases: [A]\n---\nBody.');
    expect(front).toBe('---\naliases: [A]\n---\n');
    expect(body).toBe('Body.');
  });

  it('leaves a file with no front matter alone', () => {
    expect(splitFrontMatter('Just a body.')).toEqual({ front: '', body: 'Just a body.' });
  });

  it('does not take a lone horizontal rule as an unclosed block', () => {
    const { front } = splitFrontMatter('---\n\nBody after a rule.');
    expect(front).toBe('');
  });

  // --- the three the two old implementations disagreed on ----------------

  it('takes an EMPTY block, which the editor s regex used to miss', () => {
    // Missing it meant the fences parsed as horizontal rules and the next
    // autosave wrote them back as content.
    const { front, body } = splitFrontMatter('---\n---\nBody.');
    expect(front).toBe('---\n---\n');
    expect(body).toBe('Body.');
  });

  it('refuses an INDENTED fence, which the server used to accept', () => {
    // No markdown tool treats an indented `---` as front matter.
    expect(splitFrontMatter('  ---\naliases: [A]\n  ---\nBody.').front).toBe('');
  });

  it('returns the block exactly as written, inventing no trailing newline', () => {
    // The editor puts `front` back on every save; a newline invented here
    // would be a diff nobody made.
    expect(splitFrontMatter('---\naliases: [A]\n---').front).toBe('---\naliases: [A]\n---');
  });

  it('handles CRLF', () => {
    expect(splitFrontMatter('---\r\naliases: [A]\r\n---\r\nBody.').body).toBe('Body.');
  });

  it('closes on the FIRST fence, so a later rule is body', () => {
    const { body } = splitFrontMatter('---\na: 1\n---\nBody\n\n---\n\nMore.');
    expect(body).toBe('Body\n\n---\n\nMore.');
  });
});

describe('readAliases', () => {
  it('reads an inline list', () => {
    expect(readAliases('---\naliases: [Najdorf, B90]\n---\n')).toEqual(['Najdorf', 'B90']);
  });

  it('reads a single bare value', () => {
    expect(readAliases('---\naliases: Najdorf\n---\n')).toEqual(['Najdorf']);
  });

  it('reads a block list', () => {
    expect(readAliases('---\naliases:\n  - Najdorf\n  - B90\n---\n')).toEqual(['Najdorf', 'B90']);
  });

  it('unquotes values', () => {
    expect(readAliases('---\naliases: ["Sicilian Defence", \'B90\']\n---\n')).toEqual([
      'Sicilian Defence',
      'B90',
    ]);
  });

  it('finds nothing when the key is absent', () => {
    expect(readAliases('---\ntags: [endgame]\n---\n')).toEqual([]);
  });

  it('finds nothing in an empty block', () => {
    expect(readAliases('')).toEqual([]);
  });

  it('stops the block list at the first line that is not an item', () => {
    expect(readAliases('---\naliases:\n  - Najdorf\ntags: [x]\n  - B90\n---\n')).toEqual(['Najdorf']);
  });

  it('drops empty entries rather than answering to an empty name', () => {
    expect(readAliases('---\naliases: [Najdorf, , ""]\n---\n')).toEqual(['Najdorf']);
  });
});

describe('writeAliases', () => {
  it('adds the key to a block that has none, under the opening fence', () => {
    expect(writeAliases('---\ntags: [x]\n---\n', ['Najdorf'])).toBe(
      '---\naliases: [Najdorf]\ntags: [x]\n---\n',
    );
  });

  it('replaces an existing inline list', () => {
    expect(writeAliases('---\naliases: [Old]\ntags: [x]\n---\n', ['New'])).toBe(
      '---\naliases: [New]\ntags: [x]\n---\n',
    );
  });

  it('replaces an existing block list, taking all of its items', () => {
    expect(writeAliases('---\naliases:\n  - Old\n  - Older\ntags: [x]\n---\n', ['New'])).toBe(
      '---\naliases: [New]\ntags: [x]\n---\n',
    );
  });

  it('creates the whole block for a note that had none', () => {
    expect(writeAliases('', ['Najdorf'])).toBe('---\naliases: [Najdorf]\n---\n');
  });

  it('removes the key rather than writing an empty list', () => {
    expect(writeAliases('---\naliases: [Old]\ntags: [x]\n---\n', [])).toBe('---\ntags: [x]\n---\n');
  });

  it('writes nothing at all when a note with no front matter clears its aliases', () => {
    expect(writeAliases('', [])).toBe('');
  });

  it('leaves the rest of the block untouched', () => {
    const front = '---\ntags: [endgame]\ncssclass: wide\n---\n';
    expect(writeAliases(front, ['A'])).toContain('cssclass: wide');
  });

  it('round-trips through readAliases', () => {
    const front = writeAliases('', ['Najdorf', 'B90']);
    expect(readAliases(front)).toEqual(['Najdorf', 'B90']);
  });
});
