/**
 * A position to land on when the next study opens.
 *
 * The studies route carries only the document id — there is no deep link
 * to a chapter or a move, and inventing one for the opening map would
 * put a FEN in every URL for one consumer. So the map uses the app's
 * handoff pattern instead (the analysis store's `handoff` precedent): a
 * module-level note set just before navigate(), consumed once by
 * StudyView's mount, gone the moment it is read. A plain open — reload,
 * bookmark, shelf click — sees nothing and behaves as it always has.
 */
export interface JumpTarget {
  /** Position identity: FEN without the move counters (see drill.ts). */
  fenKey: string;
  /** Chapter name to prefer; covers its sub-chapters. */
  chapter?: string;
}

let pending: JumpTarget | null = null;

export const setJumpTarget = (target: JumpTarget): void => {
  pending = target;
};

export const consumeJumpTarget = (): JumpTarget | null => {
  const target = pending;
  pending = null;
  return target;
};
