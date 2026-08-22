import { cn } from '@/lib/utils';

/** chessground's element, which this file renders by hand — see below. The
    names inside resolve to react's own, so nothing is imported for them. */
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      piece: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

/**
 * A board the size of a thumbnail, drawn from a FEN and nothing else.
 *
 * Deliberately not the real Board: that one is 35KB of interaction the
 * notes shelf has no use for, and the whole point of the notes LIST is
 * that it does not load the editor's chess machinery. This reads the
 * placement field of a FEN — the part before the first space — and
 * places the pieces. No move generation, no validation, no dependency.
 *
 * The squares are ONE painted background, not 64 cells. They were cells
 * once, `aspect-square` in a grid, and a 72px board with a 1px border is
 * 70px of squares — 8.75px each — so on a phone at 2× or 3× one rank
 * boundary landed on a device pixel while its neighbours rounded the
 * other way, and the card showed through as a black line across the
 * middle of every thumbnail. A gradient has no seams to round.
 *
 * The pieces are chessground's own `piece` elements, which is how the
 * thumbnail wears the piece set chosen in Settings: the art is CSS keyed
 * on `.cg-wrap piece.<role>.<colour>` under `<html data-pieces>`, loaded
 * once for the real board, so a `.cg-wrap` here gets it for nothing —
 * none of chessground's JS comes with it. They were Unicode glyphs
 * before, which matched no piece set and at 9px were told apart by a
 * text-shadow halo.
 */

const ROLE: Record<string, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};

/** The 8 ranks of a FEN's placement field, expanded to 8 characters each. */
function ranks(fen: string): string[] | null {
  const placement = fen.trim().split(/\s+/)[0];
  if (!placement) return null;
  const rows = placement.split('/');
  if (rows.length !== 8) return null;
  const out: string[] = [];
  for (const row of rows) {
    let line = '';
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') line += ' '.repeat(Number(ch));
      else if (ROLE[ch.toLowerCase()]) line += ch;
      else return null;
    }
    if (line.length !== 8) return null;
    out.push(line);
  }
  return out;
}

/** a8 light at the top left, then alternating: one tile of four squares,
    repeated four times each way. conic-gradient runs clockwise from the
    top, so its quarters are top-right, bottom-right, bottom-left, top-left. */
const SQUARES =
  'conic-gradient(var(--board-dark) 25%, var(--board-light) 0 50%, var(--board-dark) 0 75%, var(--board-light) 0)';

export function MiniBoard({
  fen,
  size = 56,
  className,
}: {
  fen: string;
  /** Edge length in px, border included when the caller adds one. */
  size?: number;
  className?: string;
}) {
  const rows = ranks(fen);
  if (!rows) return null;
  return (
    <div
      style={{ width: size, height: size }}
      className={cn('shrink-0 overflow-hidden rounded-md', className)}
      aria-hidden
      // A decoration, not a diagram: the position is in the note, and a
      // screen reader announcing 64 squares before every card title would
      // make the shelf unusable.
    >
      {/* .cg-wrap is `position: relative; display: block` in chessground's
          base CSS, which is exactly what the pieces need to sit in. */}
      <div
        className="cg-wrap size-full"
        style={{ backgroundImage: SQUARES, backgroundSize: '25% 25%' }}
      >
        {rows.map((row, rank) =>
          [...row].map((piece, file) =>
            piece === ' ' ? null : (
              // Sized 12.5% square and absolutely positioned by the base
              // CSS; only the square is this file's to say.
              <piece
                key={`${rank}-${file}`}
                className={`${ROLE[piece.toLowerCase()]} ${piece === piece.toUpperCase() ? 'white' : 'black'}`}
                style={{ left: `${file * 12.5}%`, top: `${rank * 12.5}%` }}
              />
            ),
          ),
        )}
      </div>
    </div>
  );
}
