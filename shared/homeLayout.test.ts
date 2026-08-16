import { describe, expect, it } from 'vitest';
import { MAX_HOME_TILES, normaliseHomeLayout } from './homeLayout.ts';

describe('normaliseHomeLayout', () => {
  it('accepts a layout and defaults its flags to on', () => {
    expect(normaliseHomeLayout({ tiles: ['games', 'studies'] })).toEqual({
      tiles: ['games', 'studies'],
      continueCard: true,
      checklist: true,
    });
  });

  it('keeps an empty tile list, which is not the same as never having chosen', () => {
    // The distinction the whole feature rests on: null means "this vault
    // has never been customised" and takes the defaults; [] means somebody
    // switched every tile off and gets an empty grid.
    expect(normaliseHomeLayout({ tiles: [] })?.tiles).toEqual([]);
  });

  it('only false turns a flag off', () => {
    expect(normaliseHomeLayout({ tiles: [], checklist: false })?.checklist).toBe(false);
    // A hand-written or truncated config shows the page rather than hiding
    // half of it.
    expect(normaliseHomeLayout({ tiles: [], checklist: 'no' })?.checklist).toBe(true);
    expect(normaliseHomeLayout({ tiles: [], continueCard: 0 })?.continueCard).toBe(true);
  });

  it('drops a repeated id at its later position', () => {
    expect(normaliseHomeLayout({ tiles: ['games', 'notes', 'games'] })?.tiles).toEqual([
      'games',
      'notes',
    ]);
  });

  it('keeps an id this build has never heard of', () => {
    // The server is not the catalogue: a newer client may store a
    // destination this one has no page for, and amputating it here would
    // lose it for the client that does.
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
