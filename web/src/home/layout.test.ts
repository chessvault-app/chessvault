import { describe, expect, it } from 'vitest';
import { normaliseHomeLayout } from '@shared/homeLayout';
import {
  chartedMoves,
  DEFAULT_TILES,
  HOME_ENTRY_IDS,
  launcherColumns,
  resolveHomeLayout,
} from './layout.ts';

/** A stand-in catalogue: the resolver only needs ids, and a fixture keeps
    this file clear of the icons the real catalogue carries. */
const CATALOGUE = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (entries: { id: string }[]): string[] => entries.map((e) => e.id);

const layout = (
  tiles: string[],
  hidden: string[] = [],
): NonNullable<ReturnType<typeof normaliseHomeLayout>> => {
  const l = normaliseHomeLayout({ tiles, hidden });
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

  it('draws a hidden entry in neither row, and lists it as hidden', () => {
    const { tiles, launchers, hidden } = resolveHomeLayout(layout(['b'], ['a']), CATALOGUE);
    expect(ids(tiles)).toEqual(['b']);
    expect(ids(launchers)).toEqual(['c', 'd']);
    expect(ids(hidden)).toEqual(['a']);
  });

  it('hides only what was named, so a destination this layout predates still shows', () => {
    // The property that makes hiding safe to ship: a page added later is
    // in neither list, and lands in the launcher row rather than being
    // swept up by an "everything unmentioned" rule.
    const { launchers, hidden } = resolveHomeLayout(layout(['a'], ['b']), CATALOGUE);
    expect(ids(launchers)).toEqual(['c', 'd']);
    expect(ids(hidden)).toEqual(['b']);
  });

  it('puts every entry in exactly one of the three', () => {
    const r = resolveHomeLayout(layout(['d', 'a'], ['c']), CATALOGUE);
    expect([...ids(r.tiles), ...ids(r.launchers), ...ids(r.hidden)].sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });
});

describe('chartedMoves', () => {
  const map = (color: string, root: unknown): unknown => ({ id: color, color, root });

  it('counts the moves under both roots, and neither root', () => {
    // A map you have merely opened has its two roots and nothing else —
    // that is not one move charted, it is none.
    expect(chartedMoves({ maps: [map('white', { children: [] }), map('black', { children: [] })] })).toBe(0);
    expect(
      chartedMoves({
        maps: [
          map('white', { children: [{ san: 'e4', children: [{ san: 'c5', children: [] }] }] }),
          map('black', { children: [{ san: 'd4', children: [] }] }),
        ],
      }),
    ).toBe(3);
  });

  it('reads a document it cannot make sense of as nothing charted', () => {
    for (const junk of [null, undefined, 42, {}, { maps: 'white' }, { maps: [null] }, { maps: [{}] }]) {
      expect(chartedMoves(junk)).toBe(0);
    }
  });
});

describe('launcherColumns', () => {
  it('gives a short row one line', () => {
    for (let n = 1; n <= 5; n++) expect(launcherColumns(n)).toBe(n);
  });

  it('never leaves a single button alone on the last line', () => {
    // The whole point: 5+1 was the shape this row was built to avoid.
    // Every count the catalogue can produce is checked, plus room to grow.
    for (let n = 6; n <= 20; n++) {
      const last = n % launcherColumns(n);
      expect(last === 0 || last >= 2).toBe(true);
    }
  });

  it('prefers five, and drops to four only when five would strand one', () => {
    expect(launcherColumns(6)).toBe(4);
    expect(launcherColumns(7)).toBe(5);
    expect(launcherColumns(11)).toBe(4);
    expect(launcherColumns(12)).toBe(5);
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
