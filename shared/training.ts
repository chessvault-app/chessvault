/**
 * What a vault remembers about how it is being TRAINED: the difficulty the
 * puzzle trainer is set to, and the study the repertoire driller was last
 * run on.
 *
 * Shared because the route that writes it into config.json, the demo's
 * stand-in for that route, and the pages that read it must agree about
 * what a stored value is.
 *
 * In the vault rather than in a browser because it describes this vault's
 * chess, not this screen — a phone and a desktop opening the same vault
 * should be training on the same thing. Device-shaped state stays in
 * localStorage on purpose and is not welcome here: board colours and piece
 * sets describe the screen (web/src/store/prefs.ts), engine threads
 * describe the processor, and panel heights describe the window.
 *
 * Every field is independently optional, so `{}` means "nothing has been
 * said" and a client that knows about only one of them can patch it
 * without amputating the other.
 */

export const DIFFICULTY_IDS = ['any', 'adaptive', 'easy', 'medium', 'hard', 'expert'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

export interface DrillPick {
  /** Study id — a path. */
  study: string;
  /** Chapter index as a string, or `all` for the whole study. */
  chapter: string;
}

export interface Training {
  difficulty?: DifficultyId;
  drill?: DrillPick;
}

/** Ids are paths and indexes, not prose; the cap is only so a hand-edited
    config cannot make these arbitrarily long. */
const MAX_LEN = 200;

export function isDifficultyId(value: unknown): value is DifficultyId {
  return typeof value === 'string' && (DIFFICULTY_IDS as readonly string[]).includes(value);
}

/**
 * Anything at all → the parts of it that are training state.
 *
 * Unrecognised fields and unparseable values are DROPPED rather than
 * rejected: this is a patch of independent memos, and a newer client
 * writing a field an older server has never heard of must not fail the
 * whole write. What comes back is always a value the reader can use.
 */
export function normaliseTraining(input: unknown): Training {
  if (!input || typeof input !== 'object') return {};
  const raw = input as { difficulty?: unknown; drill?: unknown };
  const out: Training = {};

  if (isDifficultyId(raw.difficulty)) out.difficulty = raw.difficulty;

  const drill = raw.drill;
  if (drill && typeof drill === 'object') {
    const { study, chapter } = drill as { study?: unknown; chapter?: unknown };
    if (
      typeof study === 'string' &&
      study !== '' &&
      study.length <= MAX_LEN &&
      typeof chapter === 'string' &&
      chapter.length <= MAX_LEN
    ) {
      out.drill = { study, chapter };
    }
  }

  return out;
}
