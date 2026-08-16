import { describe, expect, it } from 'vitest';
import { normaliseHomeLayout } from '@shared/homeLayout';
import { DEFAULT_TILES, HOME_ENTRY_IDS, resolveHomeLayout } from './layout.ts';

/** A stand-in catalogue: the resolver only needs ids, and a fixture keeps
    this file clear of the icons the real catalogue carries. */
const CATALOGUE = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (entries: { id: string }[]): string[] => entries.map((e) => e.id);

const layout = (tiles: string[]): NonNullable<ReturnType<typeof normaliseHomeLayout>> => {
  const l = normaliseHomeLayout({ tiles });
  if (!l) throw new Error('fixture is not a layout');
  return l;
};

describe('resolveHomeLayout', () => {
  it('takes the defaults when the vault has never been customised', () => {
    const { tiles, launchers } = resolveHomeLayout(null, CATALOGUE, ['b', 'a']);
    expect(ids(tiles)).toEqual(['b', 'a']);
    expect(ids(launchers)).toEqual(['c', 'd']);
  });

  it('honours the stored order, and demotes rather than loses', () => {
    const { tiles, launchers } = resolveHomeLayout(layout(['d', 'b']), CATALOGUE);
    expect(ids(tiles)).toEqual(['d', 'b']);
    // 'a' and 'c' were tiles by default and are not gone — they are in the
    // row underneath, in catalogue order. Nothing on home can be hidden.
    expect(ids(launchers)).toEqual(['a', 'c']);
  });

  it('drops an id this build has no page for', () => {
    const { tiles, launchers } = resolveHomeLayout(layout(['a', 'tv', 'c']), CATALOGUE);
    expect(ids(tiles)).toEqual(['a', 'c']);
    expect(ids(launchers)).toEqual(['b', 'd']);
  });

  it('puts a destination the stored layout predates into the launcher row', () => {
    // The version-drift case: the config was written when the app had
    // three destinations, and this build has four.
    const { tiles, launchers } = resolveHomeLayout(layout(['a', 'b', 'c']), CATALOGUE);
    expect(ids(tiles)).toEqual(['a', 'b', 'c']);
    expect(ids(launchers)).toEqual(['d']);
  });

  it('draws no tiles for a layout that asked for none', () => {
    const { tiles, launchers } = resolveHomeLayout(layout([]), CATALOGUE);
    expect(tiles).toEqual([]);
    expect(ids(launchers)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('round-trips what the customise sheet saves', () => {
    // What is on screen, saved and reloaded, is the same page — the sheet
    // stores exactly the tile ids in their drawn order.
    const first = resolveHomeLayout(layout(['c', 'a']), CATALOGUE);
    const again = resolveHomeLayout(layout(ids(first.tiles)), CATALOGUE);
    expect(ids(again.tiles)).toEqual(ids(first.tiles));
    expect(ids(again.launchers)).toEqual(ids(first.launchers));
  });

  it('never puts an entry in both rows, whatever it is given', () => {
    const { tiles, launchers } = resolveHomeLayout(layout(['b', 'b', 'd']), CATALOGUE);
    expect(ids(tiles)).toEqual(['b', 'd']);
    expect(ids(launchers)).toEqual(['a', 'c']);
  });
});

describe('the catalogue itself', () => {
  it('defaults to ids that exist', () => {
    for (const id of DEFAULT_TILES) expect(HOME_ENTRY_IDS).toContain(id);
  });

  it('has no repeated id', () => {
    expect(new Set(HOME_ENTRY_IDS).size).toBe(HOME_ENTRY_IDS.length);
  });
});
