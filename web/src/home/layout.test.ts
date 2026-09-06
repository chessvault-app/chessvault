import { describe, expect, it } from 'vitest';
import {
  cardOn,
  chartedMoves,
  DEFAULT_HIDDEN,
  DEFAULT_TILES,
  HOME_CARDS,
  HOME_ENTRY_IDS,
  launcherColumns,
  MAX_HOME_TILES,
  normaliseHomeLayout,
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

describe('normaliseHomeLayout', () => {
  it('accepts a layout and reads absent lists as empty', () => {
    expect(normaliseHomeLayout({ tiles: ['games', 'studies'] })).toEqual({
      tiles: ['games', 'studies'],
      hidden: [],
      off: [],
    });
  });

  it('reads a layout stored before hiding existed as hiding nothing', () => {
    // Absent is empty, not invalid: rejecting the field's absence would
    // reset every page arranged before it shipped.
    expect(normaliseHomeLayout({ tiles: ['games'] })?.hidden).toEqual([]);
  });

  it('keeps a hidden list, and holds it to the shape the tiles are held to', () => {
    expect(normaliseHomeLayout({ tiles: [], hidden: ['games', 'notes'] })?.hidden).toEqual([
      'games',
      'notes',
    ]);
    expect(normaliseHomeLayout({ tiles: [], hidden: 'games' })).toBeNull();
    expect(normaliseHomeLayout({ tiles: [], hidden: ['has space'] })).toBeNull();
    expect(
      normaliseHomeLayout({ tiles: [], hidden: Array.from({ length: 41 }, (_, i) => `t${i}`) }),
    ).toBeNull();
  });

  it('keeps the cards switched off, on the same terms', () => {
    expect(normaliseHomeLayout({ tiles: [], off: ['training', 'work'] })?.off).toEqual([
      'training',
      'work',
    ]);
    expect(normaliseHomeLayout({ tiles: [], off: 'training' })).toBeNull();
    expect(normaliseHomeLayout({ tiles: [], off: ['Training'] })).toBeNull();
  });

  it('reads the two flags a layout used to carry as cards switched off', () => {
    // What every device stored before the cards were a list. Only an
    // exact false ever turned a card off, so only that carries over.
    expect(normaliseHomeLayout({ tiles: [], continueCard: false, checklist: false })?.off).toEqual([
      'continue',
      'checklist',
    ]);
    expect(normaliseHomeLayout({ tiles: [], checklist: false, off: ['checklist'] })?.off).toEqual([
      'checklist',
    ]);
    expect(normaliseHomeLayout({ tiles: [], checklist: 'no', continueCard: 0 })?.off).toEqual([]);
  });

  it('lets a tile win over hiding the same id', () => {
    // Both is a value somebody edited by hand, and a tile is the more
    // visible of the two answers.
    const l = normaliseHomeLayout({ tiles: ['games'], hidden: ['games', 'notes'] });
    expect(l?.tiles).toEqual(['games']);
    expect(l?.hidden).toEqual(['notes']);
  });

  it('keeps an empty tile list, which is not the same as never having chosen', () => {
    // The distinction the whole feature rests on: null means "this device
    // has never customised home" and takes the defaults; [] means somebody
    // switched every tile off and gets an empty grid.
    expect(normaliseHomeLayout({ tiles: [] })?.tiles).toEqual([]);
  });

  it('drops a repeated id at its later position', () => {
    expect(normaliseHomeLayout({ tiles: ['games', 'notes', 'games'] })?.tiles).toEqual([
      'games',
      'notes',
    ]);
  });

  it('keeps an id this build has never heard of', () => {
    // The normaliser is not the catalogue: a newer build may store a
    // destination this one has no page for, and amputating it here would
    // lose it for the build that does.
    expect(normaliseHomeLayout({ tiles: ['tv'] })?.tiles).toEqual(['tv']);
  });

  it('refuses anything that is not a layout', () => {
    expect(normaliseHomeLayout(null)).toBeNull();
    expect(normaliseHomeLayout('games')).toBeNull();
    expect(normaliseHomeLayout(42)).toBeNull();
    expect(normaliseHomeLayout({})).toBeNull();
    expect(normaliseHomeLayout({ tiles: 42 })).toBeNull();
    expect(normaliseHomeLayout({ tiles: [7] })).toBeNull();
  });

  it('refuses ids that are not ids, and lists that are not lists of them', () => {
    expect(normaliseHomeLayout({ tiles: ['has space'] })).toBeNull();
    expect(normaliseHomeLayout({ tiles: ['../etc'] })).toBeNull();
    expect(normaliseHomeLayout({ tiles: ['Games'] })).toBeNull();
    expect(normaliseHomeLayout({ tiles: ['x'.repeat(65)] })).toBeNull();
    expect(normaliseHomeLayout({ tiles: Array.from({ length: MAX_HOME_TILES + 1 }, () => 'a') })).toBeNull();
  });
});

describe('cardOn', () => {
  it('draws every card for a device that never chose, and every card not named off', () => {
    expect(cardOn(null, 'training')).toBe(true);
    expect(cardOn(layout([]), 'training')).toBe(true);
    // A card this layout predates is drawn: off is opt-in and by name.
    expect(cardOn(normaliseHomeLayout({ tiles: [], off: ['training'] }), 'work')).toBe(true);
    expect(cardOn(normaliseHomeLayout({ tiles: [], off: ['training'] }), 'training')).toBe(false);
  });
});

describe('resolveHomeLayout', () => {
  it('takes the defaults when the vault has never been customised', () => {
    const { tiles, launchers } = resolveHomeLayout(null, CATALOGUE, ['b', 'a'], []);
    expect(ids(tiles)).toEqual(['b', 'a']);
    expect(ids(launchers)).toEqual(['c', 'd']);
  });

  it('keeps the default hidden set off a never-customised page, and lists it', () => {
    const { tiles, launchers, hidden } = resolveHomeLayout(null, CATALOGUE, ['b'], ['d']);
    expect(ids(tiles)).toEqual(['b']);
    expect(ids(launchers)).toEqual(['a', 'c']);
    expect(ids(hidden)).toEqual(['d']);
  });

  it('does not apply the default hidden set to a stored layout', () => {
    // Hiding is opt-in and by name once a vault has spoken: a stored
    // layout that never mentions 'd' draws it in the row.
    const { launchers, hidden } = resolveHomeLayout(layout(['b']), CATALOGUE, ['b'], ['d']);
    expect(ids(launchers)).toEqual(['a', 'c', 'd']);
    expect(hidden).toEqual([]);
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
    for (const id of DEFAULT_HIDDEN) expect(HOME_ENTRY_IDS).toContain(id);
  });

  it('never defaults an id to both the grid and hidden', () => {
    for (const id of DEFAULT_TILES) expect(DEFAULT_HIDDEN).not.toContain(id);
  });

  it('has no repeated id', () => {
    expect(new Set(HOME_ENTRY_IDS).size).toBe(HOME_ENTRY_IDS.length);
    expect(new Set(HOME_CARDS.map((c) => c.id)).size).toBe(HOME_CARDS.length);
  });

  it('draws every card somewhere', () => {
    for (const card of HOME_CARDS) expect(card.phone || card.desktop).toBe(true);
  });
});
