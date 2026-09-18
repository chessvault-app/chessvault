/**
 * Whether the board that is about to open was handed a game with names.
 *
 * The Board's outline needs this one bit and cannot ask the analysis
 * store for it: the store brings chessops and the PGN code, which is the
 * chunk the outline exists to be drawn ahead of. So the store publishes
 * the answer here (store/analysis, at its foot) and the outline reads it.
 * A module nothing else imports from, with nothing in it but the bit.
 *
 * False whenever the store has not loaded, which is right: a board nobody
 * has handed anything to opens without names.
 */
let handed = false;

/** PGN's own unknown is "?", and an empty field says nothing either. */
export const namedPlayer = (v: string | undefined): boolean => !!v && v !== '?';

export function publishHandedNames(next: boolean): void {
  handed = next;
}

export function handedNames(): boolean {
  return handed;
}
