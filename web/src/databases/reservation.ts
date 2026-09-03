/**
 * What the Databases page looked like last visit, so this visit can
 * reserve it before /api/refgames answers — on home/reservation.ts's
 * bargain exactly: a paint hint, never the authority, wrong by at most
 * one visit, corrected by whatever the server says.
 *
 * Two facts, because the answer decides two things and the flat guess
 * this replaces got both wrong. WHICH block the page draws: a directory
 * mount gets the manager panel, a single-database mount (the static
 * demo) gets a read-only card, and a server with no database at all a
 * one-line note — and the placeholder drew the panel for all three, so
 * the demo's small card arrived under a panel-sized ghost. And how many
 * rows the panel's list holds: six were drawn for every vault, which
 * stood for one database as readily as for twenty.
 *
 * Kept out of DatabasesPage.tsx and free of React so it can be tested,
 * for the same reason home's module is.
 */

export interface DatabasesShape {
  /** Which block the page settled as. `manager` is the panel; `mounted`
      the read-only card with a count; `none` the one-line note. */
  mount: 'manager' | 'mounted' | 'none';
  /** Rows the manager's list drew. 0 is its centred empty sentence, not
      nothing. Meaningless for the other two mounts and stored as 0. */
  rows: number;
}

/**
 * The most rows worth reserving. The list scrolls inside a panel that
 * takes the page's remaining height, so past a dozen rows the tail is
 * below every fold and a count past this is a layout no-op. Clamped,
 * not dropped (home's MAX_ROWS argument: dropping takes the reservation
 * from the fullest vault, which needs it most).
 */
export const MAX_ROWS = 12;

/**
 * What a device that has never seen this vault reserves: the installed
 * app's own first state, which is a directory mount with nothing built
 * in it yet — the panel over its empty sentence. Not the demo's card:
 * the demo is one deployment, and a device that has been to it stores
 * that fact after one visit.
 */
export const FRESH_DATABASES: DatabasesShape = { mount: 'manager', rows: 0 };

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, MAX_ROWS) : 0;

/**
 * The shape a device stored, or the floor if it stored nothing
 * readable. Absent, unparseable, and a shape from some later version
 * all read as the floor — nothing was learned about this device.
 */
export function parseDatabasesShape(raw: string | null): DatabasesShape {
  if (raw === null) return FRESH_DATABASES;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return FRESH_DATABASES;
  }
  if (typeof stored !== 'object' || stored === null) return FRESH_DATABASES;
  const value = stored as Partial<DatabasesShape>;
  const mount = value.mount === 'mounted' || value.mount === 'none' ? value.mount : 'manager';
  return { mount, rows: mount === 'manager' ? count(value.rows) : 0 };
}

/**
 * The shape a settled answer has: the same three-way reading the page
 * makes of /api/refgames. `databases` present is the directory mount;
 * absent, `ready` says whether anything is mounted at all.
 */
export function databasesShapeOf(meta: { ready: boolean; databases?: unknown[] }): DatabasesShape {
  if (meta.databases) return { mount: 'manager', rows: meta.databases.length };
  return { mount: meta.ready ? 'mounted' : 'none', rows: 0 };
}

/** What a settled page stores for the reader above. Stored uncapped —
    the cap belongs to the reader, so a later version can raise it. */
export const storedDatabasesShape = (shape: DatabasesShape): string => JSON.stringify(shape);
