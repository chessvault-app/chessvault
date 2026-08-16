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
 * That stored setting as the word to show for it — English, as the key
 * `t()` looks up.
 *
 * `any` and `adaptive` are not bands: they are how the trainer PICKS, not
 * how hard the result is. They are named here so neither falls through to
 * a band that was never chosen.
 */
export function difficultyWord(): string {
  const stored = localStorage.getItem(DIFFICULTY_KEY);
  if (stored === 'adaptive') return 'Adaptive';
  return BANDS.find((b) => b.id === stored)?.label ?? 'Any';
}
