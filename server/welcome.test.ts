import { describe, expect, it } from 'vitest';
import { mainlineFrom } from '../shared/tree.ts';
import { pgnToChapters, studyNameFromPgn } from '../shared/pgn.ts';
import { WELCOME_NOTE, WELCOME_STUDY } from './welcome.ts';

/**
 * The welcome documents are the first thing a new vault shows, so they
 * must parse through exactly the code paths a user's own documents take —
 * a welcome study that opens broken teaches precisely the wrong lesson.
 */
describe('welcome study', () => {
  it('parses into its three named chapters', () => {
    const chapters = pgnToChapters(WELCOME_STUDY);
    expect(chapters.map((c) => c.name)).toEqual([
      'A study, in chapters',
      'Make it yours',
      'Where things live',
    ]);
  });

  it('names the study so an import would title itself', () => {
    expect(studyNameFromPgn(WELCOME_STUDY)).toBe('Welcome to Chess Vault');
  });

  it('every chapter carries legal moves, and the first a side line', () => {
    const chapters = pgnToChapters(WELCOME_STUDY);
    for (const chapter of chapters) {
      expect(mainlineFrom(chapter.tree, chapter.tree.rootId).length).toBeGreaterThan(0);
    }
    // The Ruy chapter demonstrates variations: some node must branch.
    const first = chapters[0]!.tree;
    expect(Object.values(first.nodes).some((n) => n.children.length > 1)).toBe(true);
  });
});

describe('welcome note', () => {
  it('embeds a board whose PGN parses with a variation', () => {
    const fence = /```chess\n([\s\S]*?)```/.exec(WELCOME_NOTE)?.[1];
    expect(fence).toBeTruthy();
    const [game] = pgnToChapters(fence!);
    expect(game).toBeTruthy();
    expect(Object.values(game!.tree.nodes).some((n) => n.children.length > 1)).toBe(true);
  });
});
