import { useElementHeight } from '@/hooks/use-element-height';
import { useElementWidth } from '@/hooks/use-element-width';

/**
 * How big the workspace's board is, which decides the height of its top
 * row and so where the games band starts.
 *
 * Its own module because two things run it: the page, and the page's
 * outline (WorkspaceView.skeleton), which has to land its band where the
 * page will. The outline used to draw the row at its 22rem floor, on the
 * argument that the page's first frame does too; the page's SECOND frame
 * is the measured one, and the band moved 88px between them at 1280x800
 * (check:skeletons). Nothing here needs the board, only the shell's
 * height and the row's width, and an outline has both.
 */

/**
 * What the board wrapper stacks around the board at `wide`, in px: a
 * player bar (~h-9) + gap-2 on each side of the board — the top strip
 * sits at natural height here (alignPlayersTo="panels"), not the board
 * pages' h-10 reserve. Part of the --board-budget arithmetic — the
 * workspace's stand-in for the 10rem the full-viewport pages reserve.
 */
const BOARD_STRIPS_PX = 88;

/** The shell's own chrome around the top row, in px: p-4 above and below
    (32) plus the gap-3 between the row and the games band (12). */
const SHELL_CHROME_PX = 44;

/**
 * The games band's floor, in px (matches its min-h-72 class). The band is
 * flex-1 — everything the board cannot spend is its to show rows in — and
 * this floor is what the board's budget is computed AROUND, so the board
 * only ever grows into height the band keeps anyway. 18rem, down from
 * 20: with the band's chrome folded to one row the floor still holds
 * ~5 table rows, and the two reclaimed rems are the board's
 * (lanph3re asked for a bit more board).
 */
const BAND_MIN_PX = 288;

/** The board column's width bounds: the 18rem usability floor every board
    page keeps, and the 64rem ceiling lg imposes so panes keep room. */
const clampBoardWidth = (px: number): number => Math.min(Math.max(px, 288), 1024);

/** The moves and explorer columns' caps, in px — the max-w-[30rem] and
    max-w-[32rem] on their classes below, written down once more so the
    page's own width cap (board + both columns + gaps) can be computed:
    past ~30rem a move list or an explorer table is blank space between a
    name and its number. */
const MOVES_MAX_PX = 480;
const EXPLORER_MAX_PX = 512;

/** And their floors (the min-w classes below), which the BOARD answers
    to: the board column takes its height budget as an explicit width,
    and on a tall window that budget plus these floors outgrew the row —
    the explorer stood flush against the viewport's edge with the
    shell's padding overflowed past it (lanph3re's report). The board
    yields first: its width is capped at what the row holds after the
    floors, measured on the width-cap wrapper. */
const MOVES_MIN_PX = 272;
const EXPLORER_MIN_PX = 304;
const REGION_GAPS_PX = 24;

/**
 * The two measurements and what follows from them. `laneW` is the eval
 * bar's lane, added to the board's column while a bar is drawn
 * (WorkspaceView says why the row pays for it and not the board).
 *
 * OWED, and currently invisible. The outline and the page's own wait
 * measure different shell heights, so `budget` differs between them and
 * the whole column under the board sits 4px low in one of them. The
 * disagreement is upstream of everything in this file: both states run
 * this same arithmetic, and they run it on different `shellH`.
 *
 * It surfaced on 2026-09-22, when the panel's gutter went from 8px to
 * 2px and `capW - MOVES_MIN_PX - EXPLORER_MIN_PX - REGION_GAPS_PX`
 * stopped being the binding term in the Math.min below: that term had
 * been clamping BOTH states to one width and hiding the difference.
 * Proved then by rebuilding with the old gutter, where the run was
 * clean, and with the gutter tight on three sides only, where the drift
 * was identical - so it is the width and not the left edge. Not the eval
 * lane either: the page passes EVAL_LANE_PX only while the engine is on,
 * the outline passes 0, and 36 is not 4.
 *
 * The panel then took an 8px inset on the right again, the clamp became
 * binding again, and `check:skeletons` stopped seeing it - which is why
 * this is written HERE rather than in that check's KNOWN list, whose
 * entries are removed the moment they match nothing. The bug is not
 * fixed; it is one gutter away from being visible.
 */
export function useWorkspaceBudget(laneW: number) {
  const [shellRef, shellH] = useElementHeight();
  const budget = Math.max(0, shellH - SHELL_CHROME_PX - BAND_MIN_PX - BOARD_STRIPS_PX);
  const [capRef, capW] = useElementWidth();
  const boardColW =
    capW > 0
      ? Math.max(
          288 + laneW,
          Math.min(
            clampBoardWidth(budget) + laneW,
            capW - MOVES_MIN_PX - EXPLORER_MIN_PX - REGION_GAPS_PX,
          ),
        )
      : clampBoardWidth(budget) + laneW;
  return {
    shellRef,
    shellH,
    capRef,
    budget,
    boardColW,
    /** The page's one width cap: the board without its lane, both capped columns, the gaps. */
    capMaxWidth: boardColW - laneW + MOVES_MAX_PX + EXPLORER_MAX_PX + REGION_GAPS_PX,
  };
}
