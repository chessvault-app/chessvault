/**
 * Home's activity grid: at least half a year of training, as squares.
 *
 * The arithmetic and the geometry both, and no React in either, for the
 * reason `layout.ts` gives next door: vitest runs over `.ts` in a node
 * environment, so the only way this can be tested is to keep the picture
 * out of it. `HomePage.tsx` draws it; this file decides what there is to
 * draw, how wide a square is, and how many weeks a panel this wide has
 * room for.
 *
 * What it counts is everything the vault records as a day's work, in one
 * answer off `/api/activity`: puzzles solved, repertoire positions
 * recalled, studies and notes written, games brought in, books started.
 * The rules for which of those count are the SERVER's (server/
 * activity.ts) and are not repeated here - this file is handed days and
 * tallies and draws them.
 *
 * A square's tone is the day's tally added up, over every kind, and its
 * tip is the breakdown. One quantity, because that is the grammar the
 * five tones already had: a legend to decode is what a picture on a home
 * page must not need. No rating is read here and none could be.
 */

import {
  ACTIVITY_KINDS,
  dayTotal,
  type ActivityDayTally,
  type ActivityKind,
  type ActivityReport,
} from '@shared/activity';

/**
 * The FEWEST week columns any panel draws. Twenty-six is half a year,
 * which is the shortest window where a habit is visible rather than a
 * fortnight's mood, and at the square size below it is 310px wide - the
 * width a 390px phone has room for.
 *
 * It is a floor and not the number, because 310px is not the width this
 * card gets. The desktop dashboard is one column under `lg` and two
 * above it, and the card's own room measured 648, 480 and 482px at
 * viewport widths of 900, 1280 and 1600 - so a fixed half year left 338,
 * 170 and 172px of blank card beside it, and the picture stopped in the
 * middle of its own panel. `weeksForWidth` spends that room on more
 * weeks rather than on nothing.
 */
export const ACTIVITY_WEEKS = 26;

/**
 * The MOST, whatever the room.
 *
 * A year is where this picture stops being about a habit and starts
 * being an archive, and `ACTIVITY_LIMIT` attempts is the tail the route
 * hands back anyway: past a year most columns would be drawn hollow,
 * which is a wide picture of what this page does not know.
 */
export const ACTIVITY_MAX_WEEKS = 52;

/**
 * One column's width: the square plus the gutter, which is what
 * `ACTIVITY_CELL` and `ACTIVITY_GAP` below spell in Tailwind's units
 * (10px and 2px). Stated as a number here because the arithmetic that
 * decides how many columns fit cannot read a class name.
 */
export const ACTIVITY_PITCH = 12;

/**
 * How many weeks a panel this wide draws.
 *
 * The last column carries no gutter after it, so n columns need
 * `n * PITCH - 2` pixels; turned around, that is `(px + 2) / PITCH`.
 *
 * Between the floor and the cap, and the floor is what keeps this honest
 * about the rule it replaces. That rule was "the same period at every
 * width", and its point was that a phone must not be handed a shorter
 * memory than the desktop beside it - which the floor keeps, since no
 * width shows less than the half year. What changes is only that a
 * wider panel may show MORE, instead of leaving the difference blank.
 * A panel narrower than the floor keeps all twenty-six and scrolls
 * sideways, exactly as it did.
 */
export function weeksForWidth(px: number): number {
  if (!Number.isFinite(px) || px <= 0) return ACTIVITY_WEEKS;
  const fits = Math.floor((px + 2) / ACTIVITY_PITCH);
  return Math.min(ACTIVITY_MAX_WEEKS, Math.max(ACTIVITY_WEEKS, fits));
}

export interface ActivityDay {
  /** The local calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Everything done that day, added up. */
  count: number;
  /** What made it up, for the day's tip. Empty on a day with nothing. */
  counts: Partial<Record<ActivityKind, number>>;
  /** What those events moved, where it is more than the events
      themselves - a 412-game import. Words only; see shared/activity.ts. */
  moved?: Partial<Record<ActivityKind, number>>;
  /**
   * A day older than the log, so the two trainers are all it can hold.
   *
   * It is the day's own tip that says so, and NOT a line under the card,
   * which is where this went first: that line exists only once the
   * answer lands, so the card was one line taller loaded than waiting and
   * moved everything under it 20px on a desktop and 44 on a phone
   * (`check:skeletons` caught it). Hanging it on the day is also simply
   * more accurate - it is true of those days and of no others - and it
   * is the one place where the claim actually needed retracting: a quiet
   * square here does not mean a quiet day, it means a day whose studies
   * and games nothing was writing down.
   */
  partial?: true;
  /**
   * `day` is a day this page knows about, tally and all. `future` is the
   * rest of the week containing today, drawn as nothing at all rather
   * than as an idle day that has not happened.
   *
   * There used to be a third, `unknown`, drawn hollow for a day older
   * than the 500-attempt tail this grid was handed - because a blank
   * square is a claim, and the claim it must not make is that an active
   * week was an idle one. The server reads whole files now and the tail
   * is gone, so a day it did not report is a day that held nothing, and
   * there is no longer anything this page cannot see.
   */
  kind: 'day' | 'future';
}

export interface ActivityGrid {
  /** Week columns, oldest first; seven days each, Sunday at the top. */
  weeks: ActivityDay[][];
  /** Everything inside the window, over the days this page knows about. */
  total: number;
  /** The same over the seven days ending today - what the line under the
      grid says, because a week is the span a habit is felt over. */
  last7: number;
  /** How many days in the window carry at least one. */
  days: number;
  /**
   * The day the log began, when the window reaches back past it - and
   * null when it does not.
   *
   * It is `report.logSince` itself and not the first day in view: what
   * is worth naming is the day the four document kinds STARTED being
   * written down, where the window's own left edge is a fact about how
   * wide the panel happens to be. The picture's alternative text says it
   * once; the days it applies to carry `partial`.
   */
  logFrom: string | null;
}

/** Local midnight, since a day on this grid is the day the solver had,
    not the day UTC was having. */
const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

const addDays = (d: Date, n: number): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` in local time. Not `toISOString().slice(0,10)`, which is
    UTC's answer and is a day out for anyone east of Greenwich after
    teatime - the hour most of this app's training happens in. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Which of five steps a day's count is drawn at.
 *
 * Fixed thresholds, not quantiles of the window. A relative scale
 * repaints the whole grid when one heavy day lands, so last month's
 * squares change colour because of something that happened today, and
 * two people's grids cannot be read the same way. Fixed steps mean a
 * colour is a quantity.
 */
export function activityStep(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

/**
 * A vault's report, as the grid home draws.
 *
 * `now` is passed in rather than read, so the tests are not a bet on what
 * day they run.
 *
 * The server's days are keyed in the browser's own zone (it is told
 * which), so a date out of the report and a date off `dayKey` here are
 * the same day and can simply be compared as strings.
 */
export function activityGrid(
  report: ActivityReport | null,
  now: Date,
  weeks: number = ACTIVITY_WEEKS,
): ActivityGrid {
  const byDate = new Map<string, ActivityDayTally>();
  for (const day of report?.days ?? []) byDate.set(day.date, day);

  const today = startOfDay(now);
  const todayKey = dayKey(today);
  // The Sunday that opens the week today is in, then back to the first
  // column. A week column is a week, so the grid's right edge is this
  // week and today sits in it wherever the week has got to.
  const firstSunday = addDays(today, -today.getDay() - 7 * (weeks - 1));

  const out: ActivityDay[][] = [];
  let total = 0;
  let days = 0;
  let last7 = 0;
  let logFrom: string | null = null;
  const last7From = dayKey(addDays(today, -6));
  for (let w = 0; w < weeks; w += 1) {
    const column: ActivityDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = dayKey(addDays(firstSunday, w * 7 + d));
      if (date > todayKey) {
        column.push({ date, count: 0, counts: {}, kind: 'future' });
        continue;
      }
      // Before the log existed, so the trainers are all this day can
      // hold. Drawn as an ordinary day, because it is one and its counts
      // are real; what it carries is a flag for its own tip.
      const partial = report !== null && date < report.logSince;
      if (partial) logFrom = report.logSince;
      const tally = byDate.get(date);
      const count = tally ? dayTotal(tally) : 0;
      total += count;
      if (count > 0) days += 1;
      if (date >= last7From) last7 += count;
      column.push({
        date,
        count,
        counts: tally?.counts ?? {},
        ...(tally?.moved && { moved: tally.moved }),
        ...(partial && { partial: true }),
        kind: 'day',
      });
    }
    out.push(column);
  }
  return { weeks: out, total, last7, days, logFrom };
}

/**
 * The square, stated once.
 *
 * Ten pixels with a two-pixel gutter, which is the size at which the
 * half year fits a 390px phone without scrolling and a day is still a
 * thing the eye can land on. The size is fixed and the COLUMN COUNT
 * flexes (`weeksForWidth`), not the other way round: a wider panel
 * filled by growing the square would draw the same six months as a wall
 * of 25px blocks, and a square's size is not supposed to mean anything.
 * `ACTIVITY_PITCH` above is these two numbers added up. It lives here
 * because
 * the grid is drawn twice - once as itself and once while the answer is
 * in the air - and a placeholder that measured its own square would be
 * the drift `check:skeletons` exists to catch. Nothing else reads it.
 *
 * The 2px corner is fitted to the 10px square, off the radius knob on
 * purpose: the ladder's smallest rung is 6px, which makes a day a dot.
 */
export const ACTIVITY_CELL = 'size-2.5 rounded-[2px]';
export const ACTIVITY_GAP = 'gap-[2px]';

/**
 * Five steps of `good`, the colour grammar's word for something done.
 *
 * Step 0 is the page's own empty well and carries no green at all: an
 * idle day is the absence of the thing, not the faintest amount of it.
 * The four above it are the one colour at rising strength, so the grid
 * reads as one quantity and not as a legend to decode.
 */
export const ACTIVITY_TONES = [
  'bg-muted',
  'bg-good/25',
  'bg-good/45',
  'bg-good/70',
  'bg-good',
] as const;


/**
 * Whatever `/api/activity` answered, as a report, or null.
 *
 * Null means the route did not answer, and the page draws no card at all
 * rather than an empty one. A SHAPE check and nothing more: the kinds are
 * filtered to the ones this build knows, since a client and a server of
 * different ages take turns on one device and a kind added later must
 * neither crash the grid nor be silently counted as something else.
 */
export function readActivityReport(raw: unknown): ActivityReport | null {
  if (raw === null || typeof raw !== 'object') return null;
  const body = raw as Partial<ActivityReport>;
  if (!Array.isArray(body.days)) return null;
  const days: ActivityDayTally[] = [];
  for (const entry of body.days) {
    const row = entry as Partial<ActivityDayTally>;
    if (typeof row.date !== 'string' || row.counts === null || typeof row.counts !== 'object') {
      continue;
    }
    const counts: Partial<Record<ActivityKind, number>> = {};
    const moved: Partial<Record<ActivityKind, number>> = {};
    for (const kind of ACTIVITY_KINDS) {
      const n = row.counts[kind];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) counts[kind] = n;
      const m = row.moved?.[kind];
      if (typeof m === 'number' && Number.isFinite(m) && m > 0) moved[kind] = m;
    }
    if (Object.keys(counts).length === 0) continue;
    days.push({ date: row.date, counts, ...(Object.keys(moved).length > 0 && { moved }) });
  }
  return {
    days,
    // An older server has no such field, and everything it can tell this
    // page about is then trainer-only: the sentence belongs on the whole
    // window, so the floor is a date no day in view can be before.
    logSince: typeof body.logSince === 'string' ? body.logSince : '9999-12-31',
  };
}
