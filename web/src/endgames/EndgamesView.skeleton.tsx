import { ChevronRight } from 'lucide-react';
import { ListRow } from '@/components/list-row';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Skeleton, SkeletonBoard } from '@/components/skeletons';
import { readEndgameShape } from '@/endgames/reservation';
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
  return params[0] ? <SkeletonBoard /> : <PickerOutline />;
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
