import { describe, expect, it } from 'vitest';
import { findWikiMentions, resolveWikiLink, type LinkIndex } from './wikiLinks.ts';

const index = (over: Partial<LinkIndex> = {}): LinkIndex => ({
  notes: [],
  studies: [],
  games: [],
  ...over,
});

describe('resolveWikiLink', () => {
  it('takes an exact id', () => {
    expect(resolveWikiLink('Najdorf', index({ notes: ['Najdorf'] }))).toEqual({
      section: 'notes',
      id: 'Najdorf',
    });
  });

  it('ignores case', () => {
    expect(resolveWikiLink('NAJDORF', index({ notes: ['Najdorf'] }))).toEqual({
      section: 'notes',
      id: 'Najdorf',
    });
  });

  it('trims the target as written', () => {
    expect(resolveWikiLink('  Najdorf  ', index({ notes: ['Najdorf'] }))).toEqual({
      section: 'notes',
      id: 'Najdorf',
    });
  });

  it('takes a unique last segment', () => {
    expect(resolveWikiLink('Najdorf', index({ studies: ['openings/sicilian/Najdorf'] }))).toEqual({
      section: 'studies',
      id: 'openings/sicilian/Najdorf',
    });
  });

  it('refuses to guess between two documents sharing a last segment', () => {
    expect(resolveWikiLink('Najdorf', index({ studies: ['a/Najdorf', 'b/Najdorf'] }))).toBe(
      'ambiguous',
    );
  });

  it('reports a target that names nothing as broken', () => {
    expect(resolveWikiLink('Nothing', index({ notes: ['Najdorf'] }))).toBe('broken');
  });

  it('treats an empty target as broken rather than matching everything', () => {
    expect(resolveWikiLink('   ', index({ notes: ['Najdorf'] }))).toBe('broken');
  });

  it('searches notes, then studies, then games', () => {
    const both = index({ notes: ['Shared'], studies: ['Shared'], games: ['Shared'] });
    expect(resolveWikiLink('Shared', both)).toEqual({ section: 'notes', id: 'Shared' });
    expect(resolveWikiLink('Shared', index({ studies: ['Shared'], games: ['Shared'] }))).toEqual({
      section: 'studies',
      id: 'Shared',
    });
  });

  it('prefers an exact match in a later section over an ambiguous earlier one', () => {
    // The alternative is reporting "ambiguous" while a document plainly
    // named that exists, which would hide a link that works when clicked.
    const mixed = index({ notes: ['a/Najdorf', 'b/Najdorf'], studies: ['Najdorf'] });
    expect(resolveWikiLink('Najdorf', mixed)).toEqual({ section: 'studies', id: 'Najdorf' });
  });

  it('prefers an exact match over a unique tail in the same section', () => {
    const both = index({ notes: ['Najdorf', 'openings/Najdorf'] });
    expect(resolveWikiLink('Najdorf', both)).toEqual({ section: 'notes', id: 'Najdorf' });
  });
});

describe('findWikiMentions', () => {
  it('finds each link with the text around it', () => {
    const found = findWikiMentions('The rook lift I keep missing shows up in [[Najdorf]] again.');
    expect(found).toHaveLength(1);
    expect(found[0]!.target).toBe('Najdorf');
    expect(found[0]!.context).toBe('The rook lift I keep missing shows up in Najdorf again.');
  });

  it('finds several in one body', () => {
    const found = findWikiMentions('See [[One]] and also [[Two]].');
    expect(found.map((m) => m.target)).toEqual(['One', 'Two']);
  });

  it('reports where the link sits, so two mentions of one target stay apart', () => {
    const found = findWikiMentions('[[Same]] and later [[Same]]');
    expect(found).toHaveLength(2);
    expect(found[0]!.at).toBeLessThan(found[1]!.at);
  });

  it('drops the brackets from the context so it reads as prose', () => {
    expect(findWikiMentions('a [[B]] c')[0]!.context).toBe('a B c');
  });

  it('collapses newlines so a mention is one line', () => {
    expect(findWikiMentions('line one\n[[B]]\nline two')[0]!.context).toBe('line one B line two');
  });

  it('reads a heading in the window back as prose', () => {
    expect(findWikiMentions('## Related\nSee [[Najdorf]] for more.')[0]!.context).toBe(
      'Related See Najdorf for more.',
    );
  });

  it('drops bullets, quotes, emphasis and code marks', () => {
    expect(findWikiMentions('- **See** `this`: [[Najdorf]]')[0]!.context).toBe('See this: Najdorf');
    expect(findWikiMentions('> quoted [[Najdorf]]')[0]!.context).toBe('quoted Najdorf');
  });

  it('leaves a stray asterisk mid-sentence alone', () => {
    expect(findWikiMentions('a * b [[C]]')[0]!.context).toBe('a * b C');
  });

  it('finds nothing in a body with no links', () => {
    expect(findWikiMentions('Just prose, and a lone [ bracket.')).toEqual([]);
  });

  it('does not match across a bracket', () => {
    expect(findWikiMentions('[[a]b]]')).toEqual([]);
  });

  it('starts at the sentence the link is in, not mid-clause before it', () => {
    const body =
      'The board above is live, step through it. Related: see [[Najdorf]] for the attacking side.';
    expect(findWikiMentions(body)[0]!.context).toBe(
      'Related: see Najdorf for the attacking side.',
    );
  });

  it('keeps the full stop so the line does not read as truncated', () => {
    expect(findWikiMentions('One. See [[B]]. Two.')[0]!.context).toBe('See B.');
  });

  it('stops at a blank line, so a heading above does not bleed in', () => {
    const body = 'The board above is live.\n\n## Related\n\nSee [[Najdorf]] for the attack.';
    expect(findWikiMentions(body)[0]!.context).toBe('See Najdorf for the attack.');
  });

  it('keeps the neighbouring lines for a link written alone on its own line', () => {
    // How a list of links is written. Confining this to the link's own line
    // would leave a context of nothing but the link's name.
    const body = 'Openings to revise:\n- [[Najdorf]]\n- [[Dragon]]';
    expect(findWikiMentions(body)[0]!.context).toBe('Openings to revise: Najdorf Dragon');
  });

  it('falls back to the window when a paragraph has no sentence end', () => {
    const body = `${'word '.repeat(60)}[[Target]]${' more'.repeat(60)}`;
    const context = findWikiMentions(body)[0]!.context;
    expect(context).toContain('Target');
    expect(context.length).toBeLessThan(220);
  });

  it('keeps the context to a window rather than the whole document', () => {
    const body = `${'x '.repeat(400)}[[Target]]${' y'.repeat(400)}`;
    expect(findWikiMentions(body)[0]!.context.length).toBeLessThan(220);
  });
});
