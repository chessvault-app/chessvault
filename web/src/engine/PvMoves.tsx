import { Fragment } from 'react';
import { figurine } from '@/analysis/MoveTreePane';
import { cn } from '@/lib/cn';
import { fenAfter, type PvPly } from './pv.ts';

/**
 * An engine line, one click target per ply.
 *
 * The engine already worked out every position in the line; rendering it
 * as one string threw all but the first away, so reading "2. Bb5 a6 3. Ba4"
 * and wanting to SEE it meant clicking the row and then playing three moves
 * by hand. Clicking the nth ply walks the whole prefix instead.
 *
 * The plies are inline-level, not flex children, for two reasons: an
 * ellipsis needs inline content to sit at the end of, and the caller wants
 * to swap the container between `truncate` and wrapping on hover. The
 * spaces between them are real text nodes rather than margins — adjacent
 * inline-blocks with nothing between them give the line no break
 * opportunity, so a margin-spaced row would refuse to wrap.
 */
export function PvMoves({
  plies,
  text,
  fen,
  onPlayLine,
  onPeek,
  onPeekEnd,
  className,
}: {
  plies: PvPly[];
  /** Shown instead when the line could not be replayed; then it is raw UCI. */
  text: string;
  /** The position the line starts from — replayed to build a preview. */
  fen: string;
  onPlayLine: (ucis: string[]) => void;
  /** Hover/focus preview. Omit to attach no listeners at all — which is
      what a coarse pointer gets, since there is no hovering to preview. */
  onPeek?: (ply: PvPly, fen: string, anchor: HTMLElement) => void;
  onPeekEnd?: () => void;
  className?: string;
}) {
  if (plies.length === 0) {
    // Nothing to click: the position wouldn't parse, so there are no
    // moves, only the engine's raw output.
    return <span className={cn('text-muted text-xs', className)}>{text}</span>;
  }

  /**
   * Delegated rather than a listener per ply, because a searching engine
   * rewrites its line several times a second and the plies shift sideways
   * under a pointer that never moved. Per-button enter/leave read that as
   * the reader leaving — it cancelled the pending preview about as often
   * as it opened one, and left the pointer sitting on a move number, which
   * is not a button and so could not start another. Bubbling from the
   * container survives the churn: whatever slides under the pointer next
   * announces itself, and a number between two moves changes nothing
   * rather than killing the preview.
   */
  const peekFrom = (e: { target: EventTarget | null }): void => {
    if (!onPeek) return;
    const el = e.target instanceof Element ? e.target.closest('[data-ply]') : null;
    if (!(el instanceof HTMLElement)) return;
    const at = Number(el.dataset.ply);
    const ply = plies[at];
    if (!ply) return;
    // Worked out here, once, for the one ply under the pointer — see
    // fenAfter on why this is not a field on every ply of every line.
    const position = fenAfter(
      fen,
      plies.slice(0, at + 1).map((p) => p.uci),
    );
    if (position) onPeek(ply, position, el);
  };

  return (
    <span
      className={cn('text-muted text-xs', className)}
      onMouseOver={onPeek && peekFrom}
      onMouseLeave={onPeekEnd}
      // Focus works on any device — a keyboard has no pointer to hover
      // with — and bubbles here just as mouseover does.
      onFocus={onPeek && peekFrom}
      onBlur={onPeekEnd}
    >
      {plies.map((ply, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          {ply.number !== undefined && (
            <>
              <span className="text-subtle font-mono">{ply.number}</span>{' '}
            </>
          )}
          <button
            type="button"
            data-ply={i}
            className={cn(
              'hover:bg-surface-3 hover:text-fg rounded px-0.5 font-medium',
              'transition-colors duration-100',
            )}
            onClick={() => onPlayLine(plies.slice(0, i + 1).map((p) => p.uci))}
          >
            {figurine(ply.san)}
          </button>
        </Fragment>
      ))}
    </span>
  );
}
