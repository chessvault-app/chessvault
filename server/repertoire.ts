import { Hono } from 'hono';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT } from './paths.ts';

/**
 * The repertoire drill's memory: which prepared positions were recalled,
 * which were fumbled, and where the field walked out of the study.
 *
 * One append-only history.jsonl in vault/repertoire/, the puzzle
 * trainer's shape exactly, because it obeys the puzzle trainer's rule:
 * positions whose LATEST attempt was a miss form the review pool, and a
 * clean recall in a later session removes them. A `gap` is different in
 * kind — the field played a reply the study has no answer to — so it is
 * reported beside the review pool, not inside it: a gap is fixed by
 * editing the study, not by drilling harder.
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
   * The latest word on every drilled position of one study (optionally
   * one chapter): how many were ever attempted, which currently need
   * review, and where the field found the study wanting.
   */
  api.get('/repertoire/summary', (c) => {
    const study = c.req.query('study');
    if (!study) return c.json({ error: 'study is required' }, 400);
    const chapter = c.req.query('chapter') || null;
    const latest = new Map<string, DrillEntry>();
    for (const e of entries()) {
      if (e.study !== study) continue;
      if (chapter && e.chapter !== chapter) continue;
      latest.set(`${e.chapter}\n${e.key}`, e);
    }
    const strip = (e: DrillEntry) => ({
      chapter: e.chapter,
      key: e.key,
      path: e.path ?? [],
      expected: e.expected ?? [],
      played: e.played,
    });
    const all = [...latest.values()];
    return c.json({
      attempted: all.length,
      review: all.filter((e) => e.result === 'miss').slice(-100).map(strip),
      gaps: all.filter((e) => e.result === 'gap').slice(-100).map(strip),
    });
  });

  // Forget every drill ever made; the studies themselves are untouched.
  api.post('/repertoire/reset', (c) => {
    rmSync(historyPath, { force: true });
    return c.json({ ok: true });
  });

  return api;
}
