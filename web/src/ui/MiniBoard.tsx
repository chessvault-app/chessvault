import { cn } from '@/lib/utils';

/**
 * A board the size of a thumbnail, drawn from a FEN and nothing else.
 *
 * Deliberately not the real Board: that one is 35KB of interaction the
 * notes shelf has no use for, and the whole point of the notes LIST is
 * that it does not load the editor's chess machinery. This reads the
 * placement field of a FEN — the part before the first space — and draws
 * 64 squares. No move generation, no validation, no dependency.
 *
 * The glyphs are the Unicode chess pieces, both colours drawn as solid
 * figures and separated by fill rather than by outline, because at 15px a
 * hollow white knight is a smudge.
 */

const GLYPH: Record<string, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
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
      else if (GLYPH[ch.toLowerCase()]) line += ch;
      else return null;
    }
    if (line.length !== 8) return null;
    out.push(line);
  }
  return out;
}

export function MiniBoard({
  fen,
  size = 56,
  className,
}: {
  fen: string;
  /** Edge length in px. The pieces are sized from it, not from the text
      around it — an em here was relative to the card's font and drew
      4px glyphs on a 44px board, which is an empty chessboard. */
  size?: number;
  className?: string;
}) {
  const rows = ranks(fen);
  if (!rows) return null;
  return (
    <div
      // The glyph fills its square: a chess character carries a lot of
      // internal whitespace, and anything under about 90% of the square
      // stops being a recognisable shape at this size.
      style={{ width: size, height: size, fontSize: size / 8 }}
      className={cn('grid shrink-0 grid-cols-8 overflow-hidden rounded-md', className)}
      aria-hidden
      // A decoration, not a diagram: the position is in the note, and a
      // screen reader announcing 64 squares before every card title would
      // make the shelf unusable.
    >
      {rows.map((row, rank) =>
        [...row].map((piece, file) => (
          <div
            key={`${rank}-${file}`}
            className={cn(
              'flex aspect-square items-center justify-center',
              (rank + file) % 2 === 0 ? 'bg-[var(--board-light)]' : 'bg-[var(--board-dark)]',
            )}
          >
            {piece !== ' ' && (
              <span
                className="leading-none"
                style={{
                  // The theme-invariant chess colours, which exist for
                  // exactly this and which this board was the last place
                  // not to use: "the colour of the black pieces" is a fact
                  // about chess, so a side dot in a game row and a piece
                  // here are the same two colours by construction rather
                  // than by two people picking a hex.
                  color:
                    piece === piece.toUpperCase() ? 'var(--side-white)' : 'var(--side-black)',
                  // An 8px piece has no interior left to distinguish it by,
                  // so the two colours are told apart by fill against an
                  // outline in the other colour. Without it a white knight
                  // on a light square is a smudge.
                  //
                  // NOT --side-white-line / --side-black-line, which look
                  // like they belong here and do not: those are 40% and 50%
                  // borders drawn along the edge of a swatch, and at this
                  // size the outline is a halo the glyph is read against —
                  // it needs the near-opaque alpha it has.
                  textShadow:
                    piece === piece.toUpperCase()
                      ? '0 0 1.5px rgba(0,0,0,0.95), 0 0 0.5px rgba(0,0,0,0.95)'
                      : '0 0 1.5px rgba(255,255,255,0.9), 0 0 0.5px rgba(255,255,255,0.9)',
                }}
              >
                {GLYPH[piece.toLowerCase()]}
              </span>
            )}
          </div>
        )),
      )}
    </div>
  );
}
