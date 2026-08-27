import { useEffect } from 'react';
import { squareToGrid } from '@/board/square-overlay';
import { cn } from '@/lib/utils';
import { useExplain } from '@/store/explain';

/**
 * The NNUE piece-value overlay: every piece labelled with what the
 * network says it is worth here, White-POV pawns. The honest answer to
 * "why is this +2 with equal material" — the whole eval is usually two
 * or three of these numbers.
 *
 * Positioned by squareToGrid, the same helper the badges use; renders
 * nothing unless the
 * toggle is on AND the trace matches the position on screen, so a stale
 * overlay can never label the wrong board.
 */

/** Nominal piece values, to colour by SURPLUS rather than magnitude —
    a queen "worth 9" is furniture; a bishop "worth 5" is the story. */
const NOMINAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

function bucketClass(value: number, piece: string): string {
  const surplus = Math.abs(value) - (NOMINAL[piece.toLowerCase()] ?? 0);
  if (surplus >= 1.25) return 'bg-nag-brilliant text-nag-foreground'; // carrying the position
  if (surplus <= -1) return 'bg-card/70 text-muted-foreground'; // a bystander
  return 'bg-card/90 text-foreground';
}

export function HeatMapOverlay({
  fen,
  orientation,
}: {
  fen: string;
  orientation: 'white' | 'black';
}) {
  const heatOn = useExplain((s) => s.heatOn);
  const heat = useExplain((s) => s.heat);
  const ensureHeat = useExplain((s) => s.ensureHeat);

  useEffect(() => {
    if (heatOn) ensureHeat(fen);
  }, [heatOn, fen, ensureHeat]);

  if (!heatOn || !heat || heat.fen !== fen) return null;

  return (
    // z-30 like NagBadge: chessground's pieces paint over anything lower,
    // and a wide piece (the queen) swallowed its own value chip at z-20.
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30">
      {Object.entries(heat.pieces).map(([sq, info]) => {
        const { column, rowFromTop } = squareToGrid(sq, orientation);
        return (
          <div
            key={sq}
            style={{ left: `${column * 12.5}%`, top: `${rowFromTop * 12.5}%` }}
            className="absolute flex size-[12.5%] items-end justify-center pb-[1.5%]"
          >
            <span
              className={cn(
                'rounded-sm px-1 font-mono text-[9px] leading-tight font-semibold tabular-nums shadow-sm',
                bucketClass(info.value, info.piece),
              )}
            >
              {info.value > 0 ? '+' : ''}
              {info.value.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
