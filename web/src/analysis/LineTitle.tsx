import { useMemo } from 'react';
import { getNode, pathTo } from '@shared/tree';
import { useAnalysis } from '@/store/analysis';
import { useOpeningName } from '@/lib/opening';
import { t } from '@/lib/i18n';

/**
 * The moves panel's title: the line's own opening name, looked up by
 * position so transpositions arrive at the right name, or the starting
 * position when the line has none.
 *
 * Its own component because it is the one thing in a board page's header
 * that follows the cursor. Computed in the page itself, the page
 * subscribed to the cursor, and every arrow key re-rendered the whole
 * page for a title: the chapter list, three sets of board controls, every
 * panel and header, and the fifty-odd tooltip triggers on them, which is
 * where a cursor step's time went (measured on the demo's 63-move
 * chapter: 58 tooltip-trigger renders a step, about 1.7 ms of the step's
 * 4.7 ms). Here, a step re-renders this span and the panes that read the
 * cursor anyway.
 */
export function LineTitle() {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const openingName = useOpeningName(
    useMemo(() => pathTo(tree, cursorId).map((id) => getNode(tree, id).fen), [tree, cursorId]),
  );
  return <>{openingName ?? t('Starting position')}</>;
}
