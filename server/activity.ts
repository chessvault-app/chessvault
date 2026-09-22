import { Hono } from 'hono';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { VAULT } from './paths.ts';
import {
  ACTIVITY_KINDS,
  isActivityKind,
  type ActivityDayTally,
  type ActivityEvent,
  type ActivityKind,
  type ActivityReport,
} from '../shared/activity.ts';

/**
 * What this vault did, by day: one answer over every kind of work.
 *
 * Three sources, not one, because two of the six kinds were already
 * being written down before this file existed and their logs reach back
 * months. Throwing that away to start a clean log would have emptied the
 * home page's grid of the only history it had.
 *
 *  - `vault/activity.jsonl`, appended here. The four kinds nothing was
 *    recording: studies, notes, games and books.
 *  - `vault/puzzles/history.jsonl`, the puzzle trainer's own attempt log.
 *  - `vault/repertoire/history.jsonl`, the repertoire drill's.
 *
 * Read and tallied here rather than shipped out raw. A year of a busy
 * vault is tens of thousands of attempts, and the page's question is a
 * count per day: the tally is a few hundred rows whatever the vault
 * holds, so the grid stopped needing the 500-attempt cap it used to be
 * drawn behind - and with the cap went the hollow square that admitted
 * to it, since all three files are append-only and nothing here reads
 * only part of one.
 *
 * Whole files, then, and what that costs was measured rather than
 * assumed: 31ms for a year of heavy use (11,000 attempts, 1.3 MB) and
 * 241ms for ten years of it (110,000, 13 MB). Home asks eleven routes at
 * once, so the first is free; the second is a vault nobody has yet, and
 * `dayKeyIn` below says what to do about it if somebody does.
 *
 * WHICH DAY. The caller's, not this machine's. `?tz=` carries the
 * browser's own zone and every timestamp is bucketed in it, because a
 * day on that grid is the day the person had; a server in another
 * country bucketing by its own midnight would slide a whole vault's
 * evening work onto the wrong squares. An absent or unknown zone falls
 * back to this machine's, which is right for the desktop app and is the
 * only answer available anyway.
 */

/** The log's own file. Its three readers agree on this one path. */
export const activityLogPath = (vaultDir: string = VAULT): string =>
  resolve(vaultDir, 'activity.jsonl');

/**
 * Add a line, or do not.
 *
 * Never throws and never reports. Every caller is a route whose actual
 * job is to save a document or bring in a book, and a full disk or a
 * read-only vault must not turn a successful save into a failure over
 * the bookkeeping beside it. A lost line costs one square a shade.
 *
 * `id` makes it once a day: a study saved twelve times in an afternoon
 * is one document touched, for the reason `ActivityEvent.id` gives. The
 * check reads the log to find out, which is a whole-file read on every
 * save - affordable because the puzzle attempts, the only thing here
 * that arrives in thousands, are NOT in this file; what is left is
 * documents and imports, a few thousand lines a year.
 *
 * Today is this machine's today, not the caller's. The reader buckets by
 * the browser's zone, so a save near midnight can land on a day this
 * check called something else and count twice. That is the right way
 * round: the cost is one square a shade, where sharing the reader's zone
 * would let a client ask for its own line to be suppressed.
 */
export function recordActivity(
  kind: ActivityKind,
  what: { id?: string; n?: number } = {},
  vaultDir: string = VAULT,
): void {
  try {
    const path = activityLogPath(vaultDir);
    if (what.id !== undefined && alreadyToday(path, kind, what.id)) return;
    const event: ActivityEvent = {
      at: new Date().toISOString(),
      kind,
      ...(what.id !== undefined && { id: what.id }),
      // Only when it says something the event count does not.
      ...(typeof what.n === 'number' &&
        Number.isFinite(what.n) &&
        what.n > 1 && { n: Math.round(what.n) }),
    };
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`);
  } catch {
    // Deliberately silent. See above.
  }
}

/** This machine's calendar day for an instant, `YYYY-MM-DD`. */
const localDay = (when: Date): string =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    when,
  );

/** Whether this exact thing is already down for this machine's today. */
function alreadyToday(path: string, kind: ActivityKind, id: string): boolean {
  const today = localDay(new Date());
  for (const event of readLog(path)) {
    if (event.kind !== kind || event.id !== id) continue;
    const when = new Date(event.at);
    if (!Number.isNaN(when.getTime()) && localDay(when) === today) return true;
  }
  return false;
}

/**
 * Lines to events, damage tolerated.
 *
 * The same rule the puzzle trainer's history reads under: appendFileSync
 * can leave half a line behind a crash or a full disk, and one such line
 * must not 500 the home page until somebody edits the vault by hand -
 * which would need a shell, and the house rules call that a bug. A line
 * that does not parse, or parses to a kind this build has never heard
 * of, is dropped.
 */
function readLog(path: string): ActivityEvent[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const out: ActivityEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const row = parsed as Partial<ActivityEvent>;
    if (typeof row.at !== 'string' || !isActivityKind(row.kind)) continue;
    out.push({
      at: row.at,
      kind: row.kind,
      ...(typeof row.id === 'string' && { id: row.id }),
      ...(typeof row.n === 'number' && Number.isFinite(row.n) && row.n > 1 && { n: row.n }),
    });
  }
  return out;
}

/**
 * The two trainers' logs, read for their timestamps and nothing else.
 *
 * A puzzle attempt counts when it was a clean first pass (`win`, and not
 * `counted: false`), which is the rule `web/src/puzzles/today.ts` counts
 * one day by and the rule this grid has always used: a review or a
 * replay is training, but it is not progress through unseen puzzles, and
 * counting it would let one puzzle darken two squares.
 *
 * A drill counts when it was recalled (`hit`). A `miss` is an attempt
 * and a `gap` is not an attempt at all - it is the field walking out of
 * the study, fixed by editing rather than by drilling (server/
 * repertoire.ts) - so neither fills a square, on the same principle.
 *
 * A line that does not count is still read and still parsed, because
 * `counted` is the caller's question and not this reader's: keeping the
 * rule in one place above is what makes it quotable in a test.
 */
function readTrainerLog(
  path: string,
  counts: (row: Record<string, unknown>) => boolean,
): { at: string; counted: boolean }[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return [];
  }
  const out: { at: string; counted: boolean }[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const row = parsed as Record<string, unknown>;
    if (typeof row.at !== 'string') continue;
    out.push({ at: row.at, counted: counts(row) });
  }
  return out;
}

const puzzleCounts = (row: Record<string, unknown>): boolean =>
  row.win === true && row.counted !== false;

const drillCounts = (row: Record<string, unknown>): boolean => row.result === 'hit';

/**
 * A day-key formatter for a zone, or this machine's if the zone is not
 * one.
 *
 * `en-CA` is asked for because its short date IS `YYYY-MM-DD`, which is
 * the shape every other day key in this app has and sorts as a string.
 * The zone is whatever the browser said, so it is validated by trying:
 * an unknown one throws here rather than anywhere further in.
 *
 * One formatter call per timestamp, which is the obvious way and is the
 * way it stays. The clever version - work the zone's offset out once per
 * UTC day, fall back to the formatter on the two days a year a
 * transition makes that unsafe - was written and measured: it took a
 * ten-year vault from 251ms to 241ms, because the two `formatToParts`
 * calls it costs per UTC day very nearly pay back the formats it saves.
 * Sixty lines and a DST argument for four per cent is the wrong trade.
 * Should a vault ever make this matter, the cheap answer is to hold the
 * report against the three files' mtimes rather than to compute it
 * faster: it is the same answer until one of them is written to.
 */
function dayKeyIn(tz: string | undefined): (iso: string) => string | null {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', { ...options, ...(tz && { timeZone: tz }) });
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', options);
  }
  return (iso: string): string | null => {
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return null;
    return fmt.format(when);
  };
}

/** Everything the three logs hold, as days. Exported for the tests. */
export function tallyActivity(
  events: readonly ActivityEvent[],
  puzzles: readonly { at: string; counted: boolean }[],
  drills: readonly { at: string; counted: boolean }[],
  tz?: string,
): ActivityReport {
  const key = dayKeyIn(tz);
  const byDay = new Map<string, ActivityDayTally>();
  // Today in the caller's zone, which is where a log that has recorded
  // nothing yet begins: everything in view is then a day the four
  // document kinds could not have been written down on, which is true.
  let logSince = key(new Date().toISOString()) ?? '9999-12-31';

  const day = (date: string): ActivityDayTally => {
    let found = byDay.get(date);
    if (!found) {
      found = { date, counts: {} };
      byDay.set(date, found);
    }
    return found;
  };

  for (const event of events) {
    const date = key(event.at);
    if (date === null) continue;
    if (date < logSince) logSince = date;
    const tally = day(date);
    tally.counts[event.kind] = (tally.counts[event.kind] ?? 0) + 1;
    // Summed over EVERY event of the kind, bulk or not, so this is
    // simply how many things the day moved; the two are compared below
    // and the pair is dropped where they agree.
    const moved = (tally.moved ??= {});
    moved[event.kind] = (moved[event.kind] ?? 0) + (event.n ?? 1);
  }

  const trainer = (rows: readonly { at: string; counted: boolean }[], kind: ActivityKind): void => {
    for (const row of rows) {
      const date = key(row.at);
      if (date === null) continue;
      if (!row.counted) continue;
      const tally = day(date);
      tally.counts[kind] = (tally.counts[kind] ?? 0) + 1;
    }
  };
  trainer(puzzles, 'puzzle');
  trainer(drills, 'drill');

  // A kind that moved exactly as many things as it had events says
  // nothing the counts do not, so it goes; a day of ordinary work then
  // carries no `moved` at all and the page has nothing extra to read.
  for (const tally of byDay.values()) {
    if (!tally.moved) continue;
    for (const kind of ACTIVITY_KINDS) {
      if (tally.moved[kind] === (tally.counts[kind] ?? 0)) delete tally.moved[kind];
    }
    if (Object.keys(tally.moved).length === 0) delete tally.moved;
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  // A day whose every attempt failed has a tally with nothing in it, and
  // stays out: the grid draws a quiet day for anything it is not given,
  // which is what a day of nothing but misses was.
  return { days: days.filter((d) => Object.keys(d.counts).length > 0), logSince };
}

export function activityApi(vaultDir: string = VAULT): Hono {
  const api = new Hono();

  api.get('/activity', (c) => {
    const tz = c.req.query('tz');
    const report = tallyActivity(
      readLog(activityLogPath(vaultDir)),
      readTrainerLog(resolve(vaultDir, 'puzzles', 'history.jsonl'), puzzleCounts),
      readTrainerLog(resolve(vaultDir, 'repertoire', 'history.jsonl'), drillCounts),
      tz,
    );
    return c.json(report satisfies ActivityReport);
  });

  return api;
}
