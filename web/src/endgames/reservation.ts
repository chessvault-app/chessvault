/**
 * What the endgame picker looked like last visit: its group headings, in
 * order, and how many rows sit under each.
 *
 * The picker waits on nothing — its rows come from `drill.ts`, which
 * filters the material presets down to what a seven-man tablebase can
 * hold — so the only wait it has is its own chunk arriving. Which means
 * the outline that stands in for it cannot ask `drill.ts`: that module
 * pulls chessops, the presets file and the custom-material editor behind
 * it, and an outline that drags the page's own weight in has given up
 * the reason it is a separate chunk (lib/lazyRoute).
 *
 * So the shape is remembered instead, on the same bargain as every other
 * reservation here (home/reservation.ts): a paint hint, never the
 * authority, wrong by at most one visit, corrected by whatever the page
 * draws. It is a property of the BUILD rather than of the vault — the
 * presets are a file in the bundle — so it is right on every visit after
 * the first, on every vault.
 *
 * A device that has never been here reserves nothing and sees the header
 * alone, which is what the outline drew for every visit before this.
 */

export const ENDGAME_SHAPE_KEY = 'vault:endgame-classes';

/** A heading (the English key, as `t()` takes it) and its row count. */
export type EndgameShape = [group: string, rows: number][];

/** Past these a group's tail and the next heading are below every fold. */
const MAX_GROUPS = 12;
const MAX_ROWS = 20;

export function parseEndgameShape(raw: string | null): EndgameShape {
  if (raw === null) return [];
  try {
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(
        (row): row is [string, number] =>
          Array.isArray(row) &&
          typeof row[0] === 'string' &&
          row[0].length > 0 &&
          Number.isInteger(row[1]) &&
          (row[1] as number) > 0,
      )
      .slice(0, MAX_GROUPS)
      .map(([group, rows]) => [group, Math.min(rows, MAX_ROWS)]);
  } catch {
    return [];
  }
}

export const readEndgameShape = (): EndgameShape => {
  try {
    return parseEndgameShape(localStorage.getItem(ENDGAME_SHAPE_KEY));
  } catch {
    // Storage a browser has blocked throws on the read, and a page is
    // not the place to find that out.
    return [];
  }
};

export function writeEndgameShape(shape: EndgameShape): void {
  try {
    localStorage.setItem(ENDGAME_SHAPE_KEY, JSON.stringify(shape));
  } catch {
    // Nothing to reserve next time; the header alone serves.
  }
}
