import { SkeletonBoard } from '@/components/skeletons';
import { t } from '@/lib/i18n';

/**
 * The Board while its chunk is on the wire.
 *
 * The page is BOARD_HELD_SHELL — a board over its pane column — and
 * SkeletonBoard carries that constant itself rather than a copy, so the
 * board lands where this put it.
 *
 * Its own title row, at last. This drew a DOCUMENT's: a name bar, the
 * three document tools, Edit and a save state, over a page that has none
 * of them — it is one word, `Board`, or `Explorer` on the route Tools
 * reaches (AnalysisView reads the same segment for the same decision).
 * The comment here used to say the tools "vanish in place when the page
 * lands, and nothing above or below the row moves", which was true and
 * was still the wrong picture: what a reader looks at for the length of
 * a cold download should not be a different page's chrome.
 *
 * Three more things the page draws and this did not, all of them fixed:
 * the two player bars around the board (the Board is editablePlayers, so
 * both stand), the Engine block docked over the moves panel from lg, and
 * the Explorer folded at the column's foot, which is there on BOTH
 * routes — the explorer segment decides whether it opens, not whether it
 * exists. Without the bars the board sat 34px high of where it lands.
 *
 * The moves panel's title is the LINE's name rather than the word Moves,
 * and before a move is played the page prints the starting position's,
 * which is what a cold load always opens on.
 */
export default function BoardOutline({ params = [] }: { params?: string[] }) {
  const explorer = params[0] === 'explorer';
  return (
    <SkeletonBoard
      name={explorer ? t('Explorer') : t('Board')}
      // Tools > Explorer opens a phone on the explorer's tab, the third,
      // and the one pane on screen is then the explorer's.
      openPane={explorer ? 2 : 0}
      // The bars are empty on a cold load (no names typed yet), and empty
      // bars stand only at `wide`: stacked, the page draws neither.
      players="wide"
      engine
      explorer
      panel={{
        title: explorer ? (
          <>
            <span className="max-lg:hidden">{t('Starting position')}</span>
            <span className="lg:hidden">{t('Explorer')}</span>
          </>
        ) : (
          t('Starting position')
        ),
      }}
    />
  );
}
