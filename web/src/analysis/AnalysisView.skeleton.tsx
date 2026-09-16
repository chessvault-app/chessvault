import { SkeletonBoard } from '@/components/skeletons';

/**
 * The Board while its chunk is on the wire.
 *
 * The page is BOARD_HELD_SHELL — a board over its pane column — and
 * SkeletonBoard carries that constant itself rather than a copy, so the
 * board lands where this put it.
 *
 * `explorer` from the route's own params: Tools > Explorer
 * (`#/board/explorer`) opens with the explorer docked at the foot of the
 * column on a wide screen, and the plain board route does not
 * (AnalysisView reads the same segment for the same decision).
 *
 * The title row this draws carries a document's ⋯, Edit and save state,
 * which the Board has not; they vanish in place when the page lands, and
 * nothing above or below the row moves, which is the part that matters.
 * Giving SkeletonBoard a documentless title row is a change to a
 * component four other waits draw, so it is not made here in passing.
 */
export default function BoardOutline({ params = [] }: { params?: string[] }) {
  return <SkeletonBoard explorer={params[0] === 'explorer'} />;
}
