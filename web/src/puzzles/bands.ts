/**
 * Difficulty as a word, never a number.
 *
 * The lichess dump rates every puzzle, and that rating is how the trainer
 * picks what to show — but it is curation data, not something to put in
 * front of somebody. A number invites you to compare yourself with it,
 * and a puzzle you found hard at 1500 is not a verdict on you.
 *
 * Anywhere a puzzle's difficulty is shown, it goes through here.
 */
export const BANDS = [
  { id: 'easy', label: 'Easy', min: 0, max: 1399 },
  { id: 'medium', label: 'Medium', min: 1400, max: 1799 },
  { id: 'hard', label: 'Hard', min: 1800, max: 2199 },
  { id: 'expert', label: 'Expert', min: 2200, max: 9999 },
] as const;

export type BandId = (typeof BANDS)[number]['id'];

export const bandOf = (rating: number): string =>
  BANDS.find((b) => rating >= b.min && rating <= b.max)?.label ?? '—';

/**
 * Where the trainer remembers the difficulty it was last set to.
 *
 * Here rather than in the trainer because two other pages read it to say
 * what pressing Train will do, and the eager landing chunk is one of them
 * — this module is the only part of the puzzle tree small enough for it
 * to import.
 */
export const DIFFICULTY_KEY = 'vault:puzzle-difficulty';

/**
 * What the trainer can be set to, and what each setting ASKS THE SERVER
 * FOR.
 *
 * Here rather than in the trainer because the hub draws puzzles too — it
 * shows the next one on a board — and a second copy of these ranges is a
 * second answer to "what does Hard mean". It had exactly that bug for a
 * day: the hub drew with no range at all, so the board offered an
 * any-difficulty puzzle and handed it over, quietly overriding a setting
 * the user had chosen.
 *
 * `any` and `adaptive` are not bands. They are how the trainer PICKS —
 * everything, or a moving window around a hidden skill estimate — rather
 * than how hard the result is, which is why difficultyWord() reads its
 * label from here and not from BANDS.
 */
export const DIFFICULTIES = [
  { id: 'any', label: 'Any', query: {} },
  // The one band the trainer works out instead of being told: a hidden
  // skill estimate, kept and updated server-side, picks puzzles just
  // above your level. Still no rating shown anywhere — the estimate
  // chooses, it is never a verdict (see server/puzzles.ts).
  { id: 'adaptive', label: 'Adaptive', query: { adaptive: true }, hint: 'follows your solving' },
  { id: 'easy', label: 'Easy', query: { max: 1400 }, hint: 'up to 1400' },
  { id: 'medium', label: 'Medium', query: { min: 1400, max: 1800 }, hint: '1400–1800' },
  { id: 'hard', label: 'Hard', query: { min: 1800, max: 2200 }, hint: '1800–2200' },
  { id: 'expert', label: 'Expert', query: { min: 2200 }, hint: '2200+' },
] as const;

export type DifficultyId = (typeof DIFFICULTIES)[number]['id'];

/** The stored setting, or `any` when nothing valid has been chosen. */
export function storedDifficulty(): DifficultyId {
  const stored = localStorage.getItem(DIFFICULTY_KEY);
  return DIFFICULTIES.some((d) => d.id === stored) ? (stored as DifficultyId) : 'any';
}

/** That setting as the word to show for it — English, as `t()`'s key. */
export function difficultyWord(): string {
  return DIFFICULTIES.find((d) => d.id === storedDifficulty())!.label;
}

/**
 * The `/api/puzzles/next` query a setting means, as a leading `?…` or the
 * empty string. One place, so the hub's board and the trainer behind it
 * can only ever ask the same question.
 */
export function difficultyQuery(id: DifficultyId, theme = ''): string {
  const params = new URLSearchParams();
  if (theme) params.set('theme', theme);
  const range = DIFFICULTIES.find((d) => d.id === id)?.query ?? {};
  if ('adaptive' in range) params.set('adaptive', '1');
  if ('min' in range) params.set('min', String(range.min));
  if ('max' in range) params.set('max', String(range.max));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
