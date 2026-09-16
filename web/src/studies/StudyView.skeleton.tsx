import { SkeletonBoard } from '@/components/skeletons';

/** What a document is filed under, which is also half its reservation key. */
export type DocKind = 'study' | 'game';
const baseOf = (kind: DocKind): string => (kind === 'game' ? 'games/docs' : 'studies');

/**
 * Whether this document drew player bars last time.
 *
 * A study's chapters can carry White and Black headers (one made from an
 * imported game does), and the bars are drawn for the headers, not for
 * the kind. Per document, like a puzzle book's shape.
 *
 * On a wide screen the top slot is held whatever it will carry, but a
 * stacked layout draws the bars only when there are players, and
 * `kind === 'game'` was the guess: measured on the demo at 390px, a
 * study made from a game put its board 34px lower and the column under
 * it 64px lower than the placeholder had them. Stored per document on
 * the way out, read on the way in; a document never opened here falls
 * back to the guess.
 *
 * Here rather than in StudyView because the route outline reads it too —
 * it is drawn before that chunk exists, and a second copy of this key
 * would be a second answer to the same question.
 */
export const playersKey = (kind: DocKind, id: string): string =>
  `vault:doc-players:${baseOf(kind)}:${id}`;

export const readReservedPlayers = (kind: DocKind, id: string): boolean | null => {
  try {
    const stored = localStorage.getItem(playersKey(kind, id));
    return stored === null ? null : stored === '1';
  } catch {
    return null;
  }
};

/**
 * A document while it is arriving: a board beside its moves, so the
 * columns settle before the position does instead of snapping into place
 * when it comes.
 *
 * Drawn for both of a document's waits — lib/lazyRoute draws it while
 * the section's chunk is on the wire, StudyView draws it while the
 * document itself is — out of this one module, so the board cannot land
 * in two different places.
 *
 * The phone's bottom bar is NOT claimed here. StudyView holds it with
 * the real BoardControls at their own height, invisible, and those live
 * in the board's own chunk; claiming it from out here would drag that
 * chunk in beside the outline and undo the reason the outline is
 * separate. The bar is a fixed overlay, so its arrival moves nothing on
 * the page.
 */
export default function StudyOutline({ id, kind = 'study' }: { id: string; kind?: DocKind }) {
  return (
    <SkeletonBoard
      players={readReservedPlayers(kind, id) ?? kind === 'game'}
      chapters={kind === 'study'}
      explorer
    />
  );
}
