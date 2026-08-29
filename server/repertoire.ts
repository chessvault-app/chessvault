import { Hono } from 'hono';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT } from './paths.ts';
import { reviewDueAt, type ReviewAttempt } from '../shared/review.ts';

/**
 * The repertoire drill's memory: which prepared positions were recalled,
 * which were fumbled, and where the field walked out of the study.
 *
 * One append-only history.jsonl in vault/repertoire/, the puzzle
 * trainer's shape exactly, because it obeys the puzzle trainer's
 * schedule: a fumbled position is due again tomorrow, and each clean
 * recall pushes it 3, 7 and 21 days out before it graduates out of
 * rotation altogether (shared/review.ts). The ladder is shared code, not
 * a second copy of the arithmetic, because "12 due" here and "12 due"
 * on the puzzles page have to mean the same thing.
 *
 * That is a change from the rule this file opened with, which was the
 * trainer's OLD one: latest attempt decides, so a miss sat reviewable
 * for ever and one scraped recall retired it for good. Nothing stored
 * changed — the schedule is derived from the same append-only log, so
 * histories written before the ladder existed simply fall onto it.
 *
 * A `gap` is different in kind — the field played a reply the study has
 * no answer to — so it is reported beside the review pool, not inside
 * it, and it is not a recall attempt at all: a gap is fixed by editing
 * the study, not by drilling harder, and it must not advance or reset a
 * position's ladder.
 *
 * Positions are keyed by the position itself (FEN without the move
 * counters), not by the move path, so a line reached by transposition is
 * one entry. The path travels alongside as evidence and as the way to
 * restart a drill at that position.
 */

type DrillResult = 'hit' | 'miss' | 'gap';

interface DrillEntry {
  study: string;
  chapter: string;
  /** Board, turn, castling and en-passant fields of the FEN — the position. */
  key: string;
  result: DrillResult;
  /** SANs from the chapter's start to the position, to rebuild the drill. */
  path?: string[];
  /** What the study plays here (misses), or what the field played (gaps). */
  expected?: string[];
  played?: string;
  at?: string;
}

const RESULTS = new Set<DrillResult>(['hit', 'miss', 'gap']);

const isSanList = (value: unknown, cap: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= cap &&
  value.every((s) => typeof s === 'string' && s.length <= 12);

export function repertoireApi(stateDir: string = resolve(VAULT, 'repertoire')): Hono {
  const historyPath = resolve(stateDir, 'history.jsonl');

  /** Damage-tolerant, like the puzzle history: a torn last line loses one
      attempt, never the trainer. */
  const entries = (): DrillEntry[] => {
    let raw: string;
    try {
      raw = readFileSync(historyPath, 'utf-8');
    } catch {
      return [];
    }
    return raw
      .trimEnd()
      .split('\n')
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line) as DrillEntry;
          return typeof entry?.study === 'string' &&
            typeof entry?.key === 'string' &&
            RESULTS.has(entry?.result)
            ? [entry]
            : [];
        } catch {
          return [];
        }
      });
  };

  const api = new Hono();

  api.post('/repertoire/attempt', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Partial<DrillEntry> | null;
    if (
      !body ||
      typeof body.study !== 'string' ||
      typeof body.chapter !== 'string' ||
      typeof body.key !== 'string' ||
      !RESULTS.has(body.result as DrillResult)
    ) {
      return c.json({ error: 'expected { study, chapter, key, result }' }, 400);
    }
    const entry: DrillEntry = {
      study: body.study,
      chapter: body.chapter,
      key: body.key,
      result: body.result as DrillResult,
      ...(isSanList(body.path, 200) && { path: body.path }),
      ...(isSanList(body.expected, 16) && { expected: body.expected }),
      ...(typeof body.played === 'string' && body.played.length <= 12 && { played: body.played }),
      at: new Date().toISOString(),
    };
    mkdirSync(stateDir, { recursive: true });
    appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
    return c.json({ ok: true });
  });

  /**
   * What the record says about a set of drilled positions: how many were
   * ever attempted, which are due for review now, when the next one
   * lands, and where the field found the study wanting.
   *
   * The whole schedule is DERIVED from the log on every read, exactly as
   * the puzzle trainer derives its queue: nothing is stored beside the
   * attempts, so forgetting the record forgets the schedule with it, and
   * an attempt appended by an older build still lands on the ladder.
   */
  const schedule = (keep: (e: DrillEntry) => boolean) => {
    const latest = new Map<string, DrillEntry>();
    const recalls = new Map<string, ReviewAttempt[]>();
    /** The last entry carrying evidence — the path back to the position
        and what the study plays there. A hit is recorded bare, so the
        newest MISS is what a re-drill has to be rebuilt from. */
    const evidence = new Map<string, DrillEntry>();
    for (const e of entries()) {
      if (!keep(e)) continue;
      const id = `${e.chapter}\n${e.key}`;
      latest.set(id, e);
      if (e.result === 'gap') continue;
      const attempts = recalls.get(id) ?? [];
      attempts.push({ win: e.result === 'hit', ...(e.at ? { at: e.at } : {}) });
      recalls.set(id, attempts);
      if (e.result === 'miss') evidence.set(id, e);
    }
    const strip = (e: DrillEntry) => ({
      chapter: e.chapter,
      key: e.key,
      path: e.path ?? [],
      expected: e.expected ?? [],
      played: e.played,
    });
    const now = new Date().toISOString();
    const rotation: { due: string; entry: DrillEntry; fumbled: boolean }[] = [];
    for (const [id, attempts] of recalls) {
      // A position the field has since walked out of is a gap, and gaps
      // are reported beside the pool, never inside it.
      if (latest.get(id)?.result === 'gap') continue;
      const due = reviewDueAt(attempts);
      if (due === null) continue;
      rotation.push({
        due,
        entry: evidence.get(id) ?? latest.get(id)!,
        fumbled: latest.get(id)!.result === 'miss',
      });
    }
    rotation.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    const ready = rotation.filter((r) => r.due <= now);
    const all = [...latest.values()];
    return {
      attempted: all.length,
      /** How many the ladder says to look at today — the true count,
          which `review` is a capped window on: a big record must not
          quietly stop counting at a round number. */
      due: ready.length,
      /**
       * Everything drillable right now, most overdue first: what the
       * ladder has brought back, and then what was fumbled and has not
       * come round yet.
       *
       * The trailing half is the pool this file has always had — latest
       * attempt was a miss — and it stays drillable because the ladder
       * puts a fresh miss a day away, and a position fumbled minutes ago
       * is the one thing a session most obviously wants to go again at.
       * It is the puzzle trainer's bargain exactly: the schedule decides
       * the ORDER and the count, the pool decides what may be served.
       */
      review: [...ready, ...rotation.filter((r) => r.due > now && r.fumbled)]
        .slice(0, 100)
        .map((r) => ({ ...strip(r.entry), due: r.due })),
      /** Recalled and waiting: in rotation, not due, not fumbled — the
          positions that will come back on their own. */
      scheduled: rotation.filter((r) => r.due > now && !r.fumbled).length,
      nextDue: rotation.find((r) => r.due > now)?.due ?? null,
      gaps: all.filter((e) => e.result === 'gap').slice(-100).map(strip),
    };
  };

  api.get('/repertoire/summary', (c) => {
    const study = c.req.query('study');
    if (!study) return c.json({ error: 'study is required' }, 400);
    const chapter = c.req.query('chapter') || null;
    return c.json(
      schedule((e) => e.study === study && (!chapter || e.chapter === chapter)),
    );
  });

  /**
   * The same schedule across every study at once, for the home page's
   * one-line reminder: how much of the repertoire is due, and when the
   * next line comes back if none of it is. Counts only — home links to
   * the trainer rather than drilling in place, so it needs no evidence.
   */
  api.get('/repertoire/meta', (c) => {
    const { attempted, due, scheduled, nextDue } = schedule(() => true);
    return c.json({ attempted, due, scheduled, nextDue });
  });

  // Forget every drill ever made; the studies themselves are untouched.
  api.post('/repertoire/reset', (c) => {
    rmSync(historyPath, { force: true });
    return c.json({ ok: true });
  });

  return api;
}
