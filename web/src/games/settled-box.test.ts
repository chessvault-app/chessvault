import { describe, expect, it } from 'vitest';
import { settledBoxAsks } from './settled-box';

/**
 * The Databases tab's box, once its debounce fires: the paths that end
 * on it, each as the refs stand when the timer reads them. The timing
 * itself (the fire reading the last commit rather than the keystroke's
 * render) lives in DatabaseGames' settleBox; what is pinned here is the
 * answer every such path depends on.
 */
describe('a settled box with a hunt standing', () => {
  it('re-runs the hunt when the box moved, at any typing speed', () => {
    // The box narrows the hunt: a keystroke, or five inside 250ms,
    // settles into one re-run with the box as it stands.
    expect(settledBoxAsks('adams', '', '')).toBe('hunt');
    expect(settledBoxAsks('player:adams year:2000', 'player:adams', '')).toBe('hunt');
  });

  it('asks nothing when a typo was undone inside the debounce', () => {
    expect(settledBoxAsks('adams', 'adams', '')).toBeNull();
  });

  it('reads the box trimmed, as the hunt request sends it', () => {
    expect(settledBoxAsks('adams ', 'adams', '')).toBeNull();
    expect(settledBoxAsks('  ', '', '')).toBeNull();
  });

  it("leaves the hunt alone when a phone's Cancel empties an empty box", () => {
    // It used to rescan the whole hunt for nothing.
    expect(settledBoxAsks('', '', 'carlsen')).toBeNull();
  });

  it('widens the hunt when Cancel empties a box the hunt had read', () => {
    expect(settledBoxAsks('', 'adams', '')).toBe('hunt');
  });

  it('ignores what the text rows answer, which are not on screen', () => {
    expect(settledBoxAsks('adams', 'adams', 'carlsen')).toBeNull();
    expect(settledBoxAsks('adams', 'carlsen', 'adams')).toBe('hunt');
  });
});

describe('a settled box with no hunt', () => {
  it('searches when the box moved', () => {
    expect(settledBoxAsks('adams', null, '')).toBe('search');
  });

  it('asks nothing when a closed hunt already refetched the box', () => {
    // Closing a hunt searches the box itself when it moved while the
    // hunt had it, so the keystroke that moved it has nothing left.
    expect(settledBoxAsks('adams', null, 'adams')).toBeNull();
  });

  it('asks nothing after the empty state searched the emptied box', () => {
    expect(settledBoxAsks('', null, '')).toBeNull();
  });

  it('asks nothing when a typo was undone, keeping the pages in hand', () => {
    // A fresh search drops every page past the first; asking for the
    // box the rows already answer only cost the reader their place.
    expect(settledBoxAsks('najdorf', null, 'najdorf')).toBeNull();
  });

  it('compares the box as it is, as the text search sends it', () => {
    expect(settledBoxAsks('adams ', null, 'adams')).toBe('search');
  });

  it('asks again after a failed search, whatever the box says', () => {
    expect(settledBoxAsks('adams', null, null)).toBe('search');
    expect(settledBoxAsks('', null, null)).toBe('search');
  });
});
