/**
 * How a finished attempt is coloured, for both trainers.
 *
 * There are two of them — the lichess-pool trainer and the book trainer —
 * and they had drifted into disagreeing about the middle case. Solving a
 * puzzle after a wrong try was amber in one; solving a book line with
 * hints was red in the other, because that ternary branched on `won`
 * alone and had nowhere to put "solved, but helped". So the same fact
 * about the same kind of attempt was painted caution in one trainer and
 * failure in the other.
 *
 * The grammar is `docs/design-principles.md`: green and red are outcome —
 * solved or failed — and amber is caution. Being helped to the answer is
 * neither of the ends, which is what amber is for. Three states, one
 * mapping, both call sites.
 *
 * Colour is never the only signal here: each state also has its own
 * sentence, which is what a reader who cannot separate the hues reads.
 */
export type Outcome =
  /** Found it unaided. */
  | 'solved'
  /** Found it, but after a wrong try or with the hints on. */
  | 'helped'
  /** Did not find it — including having the answer handed over. */
  | 'missed';

export const outcomeTone = (outcome: Outcome): string =>
  outcome === 'solved' ? 'text-good' : outcome === 'helped' ? 'text-warn' : 'text-destructive';
