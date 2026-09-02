import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { TitleTip } from '@/components/title-tip';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { usePrefs } from '@/store/prefs';
import {
  categoryChip,
  categoryLabel,
  categoryTone,
  useTablebase,
  type TablebaseMove,
  type Tone,
} from './tablebase';

/**
 * The exact verdict for an ending, above the game statistics.
 *
 * Above rather than instead of: the two answer different questions, and
 * under seven pieces the statistics are usually empty anyway — what a
 * database says about a position nobody has reached is nothing, and what
 * the table says about it is the whole truth. Nothing here is a source
 * to select, because a tablebase result is not an opinion to weigh
 * against another one.
 *
 * When the probe fails the section shrinks to one amber line rather than
 * taking the pane: the explorer's own answer is still on screen below,
 * and an ending nobody could look up is a smaller loss than an ending
 * nobody can explore.
 */

/** Rows before the list folds, matching the moves table above it. */
const MOVE_LIMIT = 6;

const TONE: Record<Tone, string> = {
  good: 'bg-good-tint text-good',
  bad: 'bg-destructive-tint text-destructive',
  neutral: 'bg-accent text-muted-foreground',
};

/** DTM where the tables have it, DTZ otherwise — see the tips below. */
function distance(m: Pick<TablebaseMove, 'dtz' | 'dtm'>): { text: string; tip: string } | null {
  if (m.dtm !== null) {
    return {
      text: t('DTM {n}', { n: m.dtm }),
      tip: t('Distance to mate, in half-moves, with best play from both sides.'),
    };
  }
  if (m.dtz !== null) {
    return {
      text: t('DTZ {n}', { n: m.dtz }),
      tip: t('Distance to the next capture or pawn move, in half-moves. This is what the fifty-move rule counts.'),
    };
  }
  return null;
}

export function TablebaseSection({ fen, onPlay }: { fen: string; onPlay: (uci: string) => void }) {
  const enabled = usePrefs((p) => p.tablebase);
  const { answer, loading, error, retry } = useTablebase(fen, enabled);
  const [all, setAll] = useState(false);

  // Nothing to say and nothing to apologise for: a middlegame is not a
  // position the tablebase failed at.
  if (!answer && !error && !loading) return null;

  const whiteToPlay = fen.split(' ')[1] !== 'b';
  const verdict = answer ? distance(answer) : null;

  return (
    // A share of the panel, not whatever it wants: measured at the
    // explorer's default 300px, six rows and their header took 209 of it
    // and left the statistics below FIVE pixels and a clipped sentence.
    // Capped at just over half, the rows scroll inside their own share and
    // the pane underneath keeps a readable one — and both grow together
    // when the panel is dragged taller.
    <div className="border-border flex max-h-[55%] shrink-0 flex-col border-b">
      <div className="flex h-8 shrink-0 items-center gap-2 px-3">
        {/* The label carries who answered, because a vault can be pointed
            at its own server and then that is a real question. Nothing is
            printed for it: one word plus a hostname in a 8px-tall strip
            would push the verdict itself off the end. */}
        <TitleTip title={answer?.source ? t('Answered by {source}', { source: answer.source }) : undefined}>
          <span className="text-muted-foreground shrink-0 text-xs font-semibold">
            {t('Tablebase')}
          </span>
        </TitleTip>
        {answer && (
          <>
            <TitleTip title={categoryLabel(answer.category)}>
              <span
                className={cn(
                  'shrink-0 rounded-sm px-1.5 py-0.5 text-xs font-semibold leading-4',
                  TONE[categoryTone(answer.category)],
                )}
              >
                {categoryChip(answer.category)}
              </span>
            </TitleTip>
            <span className="text-muted-foreground min-w-0 truncate text-sm">
              {answer.checkmate
                ? t('Checkmate')
                : answer.stalemate
                  ? t('Stalemate')
                  : whiteToPlay
                    ? t('White to move')
                    : t('Black to move')}
            </span>
            {verdict && (
              <TitleTip title={verdict.tip}>
                <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                  {verdict.text}
                </span>
              </TitleTip>
            )}
          </>
        )}
        {loading && <Spinner className="text-muted-foreground ml-auto size-3 shrink-0" />}
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5">
          {/* Amber, not red: a tablebase out of reach is a network that is
              down, and the app's colour grammar keeps red for a failure. */}
          <p className="text-warn text-sm">{error}</p>
          <Button variant="secondary" size="sm" onClick={retry}>
            <RotateCw className="size-3.5" data-icon="inline-start" />
            {t('Try again')}
          </Button>
        </div>
      )}

      {answer && answer.moves.length > 0 && (
        // Its own scroll rather than the pane's: a seven-piece position
        // can have forty legal moves, and expanding them must not push
        // the game statistics off the bottom of the panel.
        <div className="min-h-0 overflow-y-auto">
          <table className="w-full text-sm">
            {/* Headed for a screen reader only, like the statistics table
                below it: the strip above is the visible heading. */}
            <thead className="sr-only">
              <tr>
                <th scope="col">{t('Next move')}</th>
                <th scope="col">{t('Outcome')}</th>
                <th scope="col">{t('Distance')}</th>
              </tr>
            </thead>
            <tbody>
              {(all ? answer.moves : answer.moves.slice(0, MOVE_LIMIT)).map((move, at) => (
                <MoveRow
                  key={move.uci}
                  move={move}
                  alt={at % 2 === 1}
                  onPlay={() => onPlay(move.uci)}
                />
              ))}
            </tbody>
          </table>
          {answer.moves.length > MOVE_LIMIT && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="text-muted-foreground hover:text-foreground w-full px-3 py-(--row-py-tight) text-left text-xs transition-colors duration-100"
            >
              {all ? t('Show fewer moves') : t('Show all {n} moves', { n: answer.moves.length })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Deliberately the statistics table's row, minus the bar: same striping,
    same move column, so the two lists read as one pane. */
function MoveRow({
  move,
  alt,
  onPlay,
}: {
  move: TablebaseMove;
  alt: boolean;
  onPlay: () => void;
}) {
  const dist = distance(move);
  return (
    <tr
      onClick={onPlay}
      className={cn(
        'hover:bg-accent cursor-pointer transition-colors duration-100',
        alt && 'bg-muted/50',
      )}
      title={categoryLabel(move.category)}
    >
      <td className="text-foreground font-moves w-14 py-(--row-py-tight) pl-3 pr-1 font-semibold">
        {/* The move is the row's button (see ExplorerPane's MoveRow). */}
        <button
          type="button"
          className="text-left"
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
        >
          {move.san}
        </button>
      </td>
      <td className="py-(--row-py-tight) pr-2">
        <span
          className={cn(
            'inline-block rounded-sm px-1.5 py-0.5 text-xs font-semibold leading-4',
            TONE[categoryTone(move.category)],
          )}
        >
          {categoryChip(move.category)}
        </span>
      </td>
      <td className="text-muted-foreground py-(--row-py-tight) pr-3 text-right font-mono text-xs tabular-nums">
        {dist?.text ?? ''}
      </td>
    </tr>
  );
}
