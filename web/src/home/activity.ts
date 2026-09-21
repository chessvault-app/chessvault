/**
 * Home's activity grid: half a year of training, as squares.
 *
 * The arithmetic and the geometry both, and no React in either, for the
 * reason `layout.ts` gives next door: vitest runs over `.ts` in a node
 * environment, so the only way this can be tested is to keep the picture
 * out of it. `HomePage.tsx` draws it; this file decides what there is to
 * draw and how wide a square is.
 *
 * What it counts is what the vault already records: clean, counted solves
 * out of `puzzles/history.jsonl`, by the same rule `puzzles/today.ts`
 * counts one day of them by. A review or a replay is training but it is
 * not progress through unseen puzzles, and counting it would let one
 * puzzle darken two squares. No rating is read here and none could be:
 * the grid is a count per day and nothing else.
 */

/** Week columns. Twenty-six is half a year, which is the shortest window
    where a habit is visible rather than a fortnight's mood, and at the
    square size below it is 310px wide - inside the narrower of home's two
    dashboard columns, so a desktop never scrolls it. */
export const ACTIVITY_WEEKS = 26;

/**
 * How many attempts are asked for.
 *
 * The history route caps at 500 (server/puzzles.ts) and says so, so this
 * is the cap itself rather than a number that quietly means it. A tail
 * that comes back full is a tail with a floor: everything before its
 * oldest attempt is unknown to this page, NOT nothing, and the grid draws
 * those days hollow instead of as blank days somebody did not train. A
 * blank square is a claim, and the one claim this page must not make is
 * that an active week was an idle one.
 */
export const ACTIVITY_LIMIT = 500;

/** One attempt as the history route writes it - the fields this grid
    reads, and not one more. */
export interface ActivityAttempt {
  win: boolean;
  counted?: boolean;
  at: string;
}

export interface ActivityDay {
  /** The local calendar day, `YYYY-MM-DD`. */
  date: string;
  count: number;
  /**
   * `day` is a day this page knows about, count and all. `future` is the
   * rest of the week containing today, which is drawn as nothing at all
   * rather than as an idle day that has not happened. `unknown` is a day
   * older than the tail the route handed back.
   */
  kind: 'day' | 'future' | 'unknown';
}

export interface ActivityGrid {
  /** Week columns, oldest first; seven days each, Sunday at the top. */
  weeks: ActivityDay[][];
  /** Solves inside the window, over the days this page knows about. */
  total: number;
  /** Solves over the seven days ending today - what the line under the
      grid says, because a week is the span a habit is felt over. */
  last7: number;
  /** How many days in the window carry at least one. */
  days: number;
  /** Whether the tail came back full, which is what makes the oldest days
      unknown rather than empty. */
  capped: boolean;
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
 * The attempts a vault recorded, as the grid home draws.
 *
 * `now` is passed in rather than read, so the tests are not a bet on what
 * day they run.
 */
export function activityGrid(
  attempts: readonly ActivityAttempt[],
  now: Date,
  weeks: number = ACTIVITY_WEEKS,
): ActivityGrid {
  const counts = new Map<string, number>();
  let oldest: number | null = null;
  for (const a of attempts) {
    const when = new Date(a.at);
    if (Number.isNaN(when.getTime())) continue;
    // Every attempt dates the tail, win or not: what the cap hides is
    // attempts, and a day of nothing but failures is still a day this
    // page has heard about.
    const ms = when.getTime();
    if (oldest === null || ms < oldest) oldest = ms;
    if (!a.win || a.counted === false) continue;
    const key = dayKey(when);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const capped = attempts.length >= ACTIVITY_LIMIT;
  const floor = capped && oldest !== null ? dayKey(new Date(oldest)) : null;

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
  const last7From = dayKey(addDays(today, -6));
  for (let w = 0; w < weeks; w += 1) {
    const column: ActivityDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = dayKey(addDays(firstSunday, w * 7 + d));
      if (date > todayKey) {
        column.push({ date, count: 0, kind: 'future' });
        continue;
      }
      if (floor !== null && date < floor) {
        column.push({ date, count: 0, kind: 'unknown' });
        continue;
      }
      const count = counts.get(date) ?? 0;
      total += count;
      if (count > 0) days += 1;
      if (date >= last7From) last7 += count;
      column.push({ date, count, kind: 'day' });
    }
    out.push(column);
  }
  return { weeks: out, total, last7, days, capped };
}

/**
 * The square, stated once.
 *
 * Ten pixels with a two-pixel gutter, which is the size at which
 * twenty-six weeks fit the narrower dashboard column without scrolling
 * and a day is still a thing the eye can land on. It lives here because
 * the grid is drawn twice - once as itself and once while the answer is
 * in the air - and a placeholder that measured its own square would be
 * the drift `check:skeletons` exists to catch. Nothing else reads it.
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

/** A day older than the tail: hollow, so it is plainly not an idle day.
    Drawn on the card's own fill, which is why it is a ring and not a
    fill of its own. */
export const ACTIVITY_UNKNOWN = 'ring-1 ring-border ring-inset';
