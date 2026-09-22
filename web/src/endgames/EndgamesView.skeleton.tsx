import { ChevronRight, Cpu, Crown, Info, ListOrdered, X } from 'lucide-react';
import { ListRow } from '@/components/list-row';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Skeleton, SkeletonBoard } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import type { Goal } from '@/endgames/drill';
import { readEndgameShape } from '@/endgames/reservation';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';

/**
 * The Endgame drills section while its chunk is on the wire.
 *
 * A class in the address opens a drill, which is a board in
 * BOARD_HELD_SHELL, the shell SkeletonBoard carries. Nothing in the
 * address opens the list of drills.
 *
 * That list is the whole page, and it used to draw as the page's name
 * and nothing else — on the argument that its rows need no fetch, so
 * they "fill in under the header without moving anything". Nothing
 * moves, and the reader still watches a named empty page for the whole
 * download and then a wall of rows: the same page arriving twice, which
 * is what an outline exists to stop. Everything above the rows is fixed
 * text (the name, the way back, the paragraph that says what a drill
 * is), so it is drawn in full; the rows themselves are the shape this
 * build drew last visit (./reservation), because asking `drill.ts` for
 * them would pull chessops, the presets file and the custom-material
 * editor into a chunk whose whole point is being small.
 *
 * The back chevron is live rather than held inert: a phone reaches this
 * page from More, it needs nothing that is still on the wire, and
 * leaving is the one thing a reader on a slow link may want.
 */
export default function EndgamesOutline({ params = [] }: { params?: string[] }) {
  return params[0] ? <DrillOutline /> : <PickerOutline />;
}

/**
 * A drill is a TRAINER, and it stands where the puzzle trainer stands:
 * one word in a flat h-8 row with the chevron a phone leaves by, two
 * panes (its own, then the moves), and the drill panel filling the
 * column behind them.
 *
 * It drew a bare board, which is a DOCUMENT: the title as a bar, the
 * document tools, an Edit button and a save state, over a page that has
 * none of the four; three panes where the page has two, so every tab
 * stood at the wrong third of the strip; and the column's panel called
 * Moves, where a phone opens on the drill's own. A document's row also
 * grows to the 36px coarse rung where a trainer's stays 32, so the
 * board and the whole column under it sat 4px low (measured against the
 * page's own wait at 390x844, 2026-09-22).
 *
 * The word is the page's own and fixed (EndgamesView, `title`), so it
 * is printed rather than reserved.
 */
function DrillOutline() {
  return (
    <SkeletonBoard
      name={t('Endgame drill')}
      // The trainer's two panes while an ending is being played: its own
      // first, then the moves. The engine joins them only once the
      // attempt is over (hooks/use-analyse-in-place).
      panes={[Info, ListOrdered]}
      stackedPanel={t('Endgame drill')}
    />
  );
}

/* ------------------------------------------------- the drill panel */

/**
 * The drill panel, in the pieces its wait is made of. The page draws
 * them and the outline below draws them, out of this one module, which
 * is the only way the two can be one box: the puzzle trainer's panel is
 * shared the same way, and the release its outline folded to a 44px
 * header while the page waited with the whole panel, that header stood
 * 184px too high the moment the chunk landed.
 */
export const DRILL_BODY = 'flex min-h-0 grow flex-col gap-3 overflow-y-auto px-(--card-spacing)';
export const DRILL_FOOT = '-mx-(--card-spacing) mt-auto flex-wrap justify-end gap-2';

/** The line the drill settles on; the wait reserves its height. */
export const PLAYING_NOTE: Record<Goal, string> = {
  win: 'Keep the win. A move the tablebase calls a draw or a loss ends the attempt.',
  draw: 'Hold the draw. A move the tablebase calls a loss ends the attempt, and ten held moves end it as a draw.',
};

/**
 * What the panel says while the ending is being found, in both drawings.
 * A drill opens on `win` and learns which it is from the answer
 * (EndgamesView, `goal`), so the win's line is what either one reserves.
 */
export const FINDING_NOTE = 'Finding an ending…';

/**
 * The panel's first two lines: the headline, and under it the status in
 * a box the size of the longest line it settles on.
 *
 * “Keep the win…” wraps to two lines where “Finding an ending…” and
 * “Defending…” take one, and the line changes EVERY MOVE, so a box the
 * size of whatever it says had the footer stepping up and down under the
 * reader's hand for the whole attempt. One grid cell, both in it: the
 * invisible note sets the floor and a longer verdict still grows the box
 * rather than being clipped by it.
 */
export function DrillHeadline({
  headline,
  loading = false,
  note,
  status,
  tone,
}: {
  /** The page's own first line, where it has one. */
  headline?: React.ReactNode;
  /** No headline and an ending on the way: the bar stands in its place. */
  loading?: boolean;
  note: string;
  status: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {headline ??
        (loading ? (
          <div className="flex h-8 items-center">
            <Skeleton className="h-4 w-28" />
          </div>
        ) : null)}
      <div className="grid">
        <p aria-hidden className="invisible col-start-1 row-start-1 text-sm leading-relaxed">
          {note}
        </p>
        <p className={cn('col-start-1 row-start-1 text-sm leading-relaxed', tone ?? 'text-muted-foreground')}>
          {status}
        </p>
      </div>
    </div>
  );
}

/**
 * What is being drilled, as the panel's own row, and the way to the list
 * that changes it.
 *
 * Without a label the word is a bar: a class's name lives in the presets,
 * and the reservation this file opens with is exactly what keeps that
 * file out of this chunk. The row's height is the button's own, so the
 * bar costs it nothing.
 */
export function AllEndingsRow({ label, onOpen }: { label?: string; onOpen?: () => void }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      className="w-full min-w-0 justify-start"
      title={t('All endings')}
      onClick={onOpen}
    >
      <Crown className="glyph shrink-0" />
      {label === undefined ? <Skeleton className="h-3 w-28" /> : <span className="truncate">{label}</span>}
      <ChevronRight className="text-muted-foreground ml-auto glyph shrink-0" />
    </Button>
  );
}

/**
 * The footer's pair while an attempt runs: skip this ending, or end it
 * by hand. Where the puzzle trainer offers the solution, this ends the
 * attempt: the line so far goes to the analysis board and the engine
 * comes on, the same swap a finished attempt makes. Nothing is graded; a
 * stop is a stop.
 */
export function DrillRunActions({
  onSkip,
  onAnalyse,
  skipDisabled = true,
  analyseDisabled = true,
}: {
  onSkip?: () => void;
  onAnalyse?: () => void;
  skipDisabled?: boolean;
  analyseDisabled?: boolean;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="me-auto pointer-coarse:h-11"
        disabled={skipDisabled}
        onClick={onSkip}
      >
        <X className="glyph" data-icon="inline-start" />
        {t('Skip')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="pointer-coarse:h-11"
        disabled={analyseDisabled}
        onClick={onAnalyse}
        title={t('Ends the attempt and opens the engine')}
      >
        <Cpu className="glyph" data-icon="inline-start" />
        {t('Analyse')}
      </Button>
    </>
  );
}

/** Ragged name widths, so the list does not read as a barcode. */
const NAME_WIDTHS = ['w-40', 'w-28', 'w-36', 'w-32', 'w-44'];

function PickerOutline() {
  const groups = readEndgameShape();
  return (
    <PageShell width="medium">
      <PageHeader
        title={t('Endgame drills')}
        back={() => navigate('more')}
        description={t(
          'Play a random ending against the tablebase: keep a win, or hold a draw. A move that lets the result slip ends the attempt and shows the move that kept it.',
        )}
      />
      {groups.map(([group, rows], g) => (
        <section key={group} className="flex flex-col gap-2">
          {/* The real word: which families this build offers is a fact
              about the build, and the reservation keeps it. */}
          <h2 className="text-muted-foreground type-row font-medium">{t(group)}</h2>
          <div
            className="bg-card overflow-hidden rounded-xl ring-1 ring-card-ring"
            {...(g === 0
              ? { role: 'status', 'aria-label': t('Loading'), 'aria-live': 'polite' as const }
              : { 'aria-hidden': true })}
          >
            {Array.from({ length: rows }, (_, i) => (
              // ListRow itself, held inert, so the row's own rhythm and
              // its coarse-pointer floor are the page's rather than a
              // second statement of them.
              <ListRow key={i} divided disabled tabIndex={-1}>
                {/* The 32px block the class icon sits in, then the name
                    in the same line box the real one takes (index.css,
                    `type-row-box`), so the row is the height it settles
                    at at both rungs. */}
                <Skeleton className="size-8 shrink-0 rounded-sm" />
                <span className="type-row-box flex min-w-0 flex-1 items-center">
                  <Skeleton className={`h-3 max-w-full ${NAME_WIDTHS[i % NAME_WIDTHS.length]}`} />
                </span>
                <ChevronRight className="text-muted-foreground glyph shrink-0" />
              </ListRow>
            ))}
          </div>
        </section>
      ))}
    </PageShell>
  );
}
