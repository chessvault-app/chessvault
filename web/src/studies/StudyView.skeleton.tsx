import { SkeletonBoard } from '@/components/skeletons';

import { type DocKind, readReservedPlayers } from './reservedPlayers.ts';

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
