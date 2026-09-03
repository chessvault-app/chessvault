import { describe, expect, it } from 'vitest';
import {
  MAX_SHELF_CARDS,
  MAX_SHELF_FOLDERS,
  parseShelfShape,
  shelfHasShape,
  shelfShapeOf,
  storedShelfShape,
  WELCOME_SHELF,
} from './shelf-reservation';

describe('parseShelfShape', () => {
  it('reads the welcome floor for a device that has never been here', () => {
    expect(parseShelfShape(null)).toEqual(WELCOME_SHELF);
  });

  it('reads the floor for anything unreadable', () => {
    expect(parseShelfShape('nope')).toEqual(WELCOME_SHELF);
    expect(parseShelfShape('{"root":"3","folders":[]}')).toEqual(WELCOME_SHELF);
    expect(parseShelfShape('{"root":3}')).toEqual(WELCOME_SHELF);
  });

  it('round-trips a stored shape', () => {
    const shape = { root: 2, folders: [3, 0, 5] };
    expect(parseShelfShape(storedShelfShape(shape))).toEqual(shape);
  });

  it('keeps a seen-empty shelf distinct from never-seen', () => {
    const empty = parseShelfShape('{"root":0,"folders":[]}');
    expect(empty).toEqual({ root: 0, folders: [] });
    expect(shelfHasShape(empty)).toBe(false);
    expect(shelfHasShape(WELCOME_SHELF)).toBe(true);
  });

  it('keeps an empty collection as a real zero entry', () => {
    expect(parseShelfShape('{"root":0,"folders":[0]}')).toEqual({ root: 0, folders: [0] });
  });

  it('clamps counts and folder tails rather than dropping the shape', () => {
    const shape = parseShelfShape(
      storedShelfShape({ root: 99, folders: Array.from({ length: 20 }, () => 99) }),
    );
    expect(shape.root).toBe(MAX_SHELF_CARDS);
    expect(shape.folders).toHaveLength(MAX_SHELF_FOLDERS);
    expect(shape.folders.every((n) => n === MAX_SHELF_CARDS)).toBe(true);
  });
});

describe('shelfShapeOf', () => {
  it('splits root documents from filed ones the way the grouped list does', () => {
    // Alphabetical: endgames (1) before openings (2).
    expect(shelfShapeOf(['a', 'openings/b', 'openings/c', 'endgames/d'], [])).toEqual({
      root: 1,
      folders: [1, 2],
    });
  });

  it('keeps an empty collection', () => {
    expect(shelfShapeOf(['a'], ['openings'])).toEqual({ root: 1, folders: [0] });
  });

  it('orders collections alphabetically, root apart', () => {
    const shape = shelfShapeOf(['z/1', 'a/1', 'a/2'], []);
    expect(shape.folders).toEqual([2, 1]);
  });
});

describe('heights', () => {
  const shape = { root: 1, folders: [2, 0] };

  it('rides along only when there is one per card', () => {
    expect(parseShelfShape(storedShelfShape(shape, [110, 86, 86])).heights).toEqual([110, 86, 86]);
    // Two heights for three cards: a card mid-mount, or another shape.
    expect(parseShelfShape(storedShelfShape(shape, [110, 86])).heights).toBeUndefined();
    expect(parseShelfShape(storedShelfShape(shape)).heights).toBeUndefined();
  });

  it('drops a list that is not all heights, and keeps the counts', () => {
    const parsed = parseShelfShape(JSON.stringify({ ...shape, heights: [110, 'tall', 86] }));
    expect(parsed).toEqual(shape);
    expect(parseShelfShape(JSON.stringify({ ...shape, heights: [110, 0, 86] })).heights).toBeUndefined();
    expect(parseShelfShape(JSON.stringify({ ...shape, heights: [110, 86, 9000] })).heights).toBeUndefined();
  });

  it('stores a tenth of a pixel, which is what a layout can differ by', () => {
    expect(JSON.parse(storedShelfShape(shape, [110.4, 86.25, 86])).heights).toEqual([110.4, 86.3, 86]);
  });
});
