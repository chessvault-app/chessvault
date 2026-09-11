import { beforeEach, describe, expect, it } from 'vitest';
import { parseMaterialSpec } from '@shared/scanMatch';
import { drillable } from '@shared/endgameDrill';
import ENDGAMES from '@/games/endgames.json';
import {
  CUSTOM_CLASS,
  DRILL_PRESETS,
  classLabel,
  positionOf,
  specFor,
  squaresOf,
  writeCustomDraft,
} from './drill';

describe('the drill\'s classes', () => {
  it('offers the presets a seven-man table can hold, by the rule the server applies', () => {
    const ids = DRILL_PRESETS.map((p) => p.id);
    expect(ids).toContain('rook');
    expect(ids).toContain('queen');
    expect(ids).toContain('rook-and-pawns-vs-rook');
    // The list is the file filtered by shared/endgameDrill.ts and nothing
    // else, so a preset the draw would refuse is never offered. Today
    // every preset's minimum fits (the largest, two rooks each, is six
    // men), which is a fact about the file and not about the filter.
    expect(ids).toEqual(
      ENDGAMES.filter((e) => drillable(parseMaterialSpec(JSON.stringify(e.spec))!)).map((e) => e.id),
    );
  });

  it('names a class by its preset label, and the custom class by its own', () => {
    expect(classLabel('rook')).toBe('Rook endgame');
    expect(classLabel(CUSTOM_CLASS)).toBe('Custom material');
    expect(classLabel('nonsense')).toBe('nonsense');
  });

  it('asks the server for the preset\'s own spec, which parses as the server would', () => {
    for (const preset of DRILL_PRESETS) {
      const spec = specFor(preset.id);
      expect(spec, preset.id).not.toBeNull();
      expect(parseMaterialSpec(spec!), preset.id).not.toBeNull();
    }
    expect(specFor('nonsense')).toBeNull();
  });
});

describe('the custom class', () => {
  // The tests run under node, which has no localStorage; the helpers
  // only need get and set.
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    };
  });

  it('has nothing to ask for until a count is picked', () => {
    expect(specFor(CUSTOM_CLASS)).toBeNull();
    writeCustomDraft({ white: { r: '1', p: 'any' }, black: { r: '1' } });
    expect(JSON.parse(specFor(CUSTOM_CLASS)!)).toEqual({ white: { r: [1, 1] }, black: { r: [1, 1] } });
  });
});

describe('positions', () => {
  it('reads a FEN the way the board draws it', () => {
    const pos = positionOf('8/8/8/4k3/8/8/8/K1Q5 w - - 0 1', ['a2', 'a1']);
    expect(pos?.turn).toBe('white');
    expect(pos?.check).toBe(false);
    expect(pos?.lastMove).toEqual(['a2', 'a1']);
    expect(pos?.dests.get('c1')?.length).toBeGreaterThan(0);
    expect(pos?.dests.has('e5')).toBe(false);
  });

  it('refuses what chessops refuses', () => {
    expect(positionOf('garbage')).toBeNull();
    // Kings touching.
    expect(positionOf('8/8/8/4k3/4K3/8/8/8 w - - 0 1')).toBeNull();
  });

  it('reads the two squares off a move', () => {
    expect(squaresOf('e2e4')).toEqual(['e2', 'e4']);
    expect(squaresOf('e7e8q')).toEqual(['e7', 'e8']);
  });
});
