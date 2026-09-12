import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** PGN results with the proper half glyph: 1/2-1/2 → ½-½. */
const fmt = (result: string): string => result.replaceAll('1/2', '½');

/**
 * A game's result as ONE chip, everywhere a result appears — the games
 * tables, the details panel, the explorer's top games, the home page's
 * recent games, the opening map's deviations. Tinted from the player's
 * own point of view where there is one (green won, red lost — a win
 * and a loss are not the same fact); games without a known side just
 * brighten the winner. Both tints are OPAQUE tokens rather than a wash
 * of the text colour: these chips sit in rows that fill under the
 * pointer, and a translucent chip let that fill through and took the
 * pair below the contrast floor — see --good-tint in index.css.
 *
 * A DRAW WEARS NO FILL, and neither does a result that could not be
 * read. Only a decisive game has a verdict to carry, so only a decisive
 * game gets a chip; the draw keeps the width, the corner and the mono
 * centring, so its glyphs sit exactly where a winner's do and the
 * column still reads as one.
 *
 * That is the design reason. The measured one is that a neutral chip
 * cannot hold a boundary in this palette. It was `bg-accent`, and
 * `--accent` is `--surface-3`, which is also what a row fills with — so
 * the chip's shape measured 1.000:1 against a selected table row and
 * against a hovered card row, vanishing on exactly the row being
 * pointed at or read about, and only 1.13:1 in light and 1.91:1 in dark
 * at rest, so it was barely a shape anywhere. Nothing on the neutral
 * ladder fixes it: the ladder spans about 1.07:1 end to end, and 3:1
 * against `--surface-3` needs a fill at 61.5% lightness or below, which
 * is ink rather than a surface and fails the chip's own text. A mockup
 * over the demo settled the alternatives — a darker grey chip made a
 * draw louder than a win, worst in dark, and a hairline was invisible in
 * dark at 1.16:1. Dropping the fill also returns the text contrast the
 * chip was costing, measured on the demo: on a plain row the glyphs read
 * 6.04:1 in light and 8.62:1 in dark where the old chip read 5.33 and
 * 4.52. The worst case is unchanged and is the row that fills with
 * `--accent`, where 4.52:1 in dark is the same figure the chip gave,
 * since the ink now sits on the fill the chip used to copy.
 *
 * It used to be two vocabularies: the explorer
 * wore the eval bar's white/black scheme while the games lists wore
 * this one, and the same result read as two different chips one pane
 * apart.
 *
 * Fixed width, because the draw chip is the widest of the three (½
 * falls back out of the mono face) and a column of these must not
 * stagger.
 */
export function ResultBadge({
  result,
  userSide = null,
  className,
}: {
  result: string;
  userSide?: 'white' | 'black' | null;
  className?: string;
}) {
  const parts = result.split('-');
  const winner = result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;
  // With a known side, the tone is the player's own verdict (green
  // won, red lost). Without one, the WINNING COLOUR wears the chip —
  // the eval bar's white and black — so a column of reference games
  // still says who won before the digits are read; draws and
  // unfinished games stay grey.
  const tone =
    parts.length !== 2 || !winner
      ? 'text-muted-foreground'
      : userSide
        ? userSide === winner
          ? 'bg-good-tint text-good'
          : 'bg-destructive-tint text-destructive'
        : winner === 'white'
          ? 'bg-eval-white text-on-eval-white'
          : 'bg-eval-black text-on-eval-black';
  // The verdict in words, for whoever cannot read it off the tint: the
  // green and the red are the only thing that told a win from a loss
  // (a colour-blind reader saw two tinted chips), and a screen reader
  // heard four characters. Visually hidden text rather than an
  // aria-label, because a span has no role and ARIA does not name a
  // generic element. With no side of the reader's own, the winner.
  const verdict =
    parts.length !== 2 || !winner
      ? null
      : userSide
        ? userSide === winner
          ? t('You won')
          : t('You lost')
        : winner === 'white'
          ? t('White won')
          : t('Black won');
  // No tip: it said `fmt(result)`, which is exactly the four characters
  // printed inside it. A tooltip that repeats its own trigger is a hover
  // that answers nothing — and this chip sits inside row buttons that
  // carry a title of their own, so pointing at it now falls through to
  // the row's, which is the tip that had something to add.
  return (
    <span
      data-slot="result-badge"
      className={cn(
        // Medium, with the WINNING DIGIT bold: the mark the colour
        // grammar promises (DESIGN.md, "Colour and marks") and the chip
        // had stopped drawing, so that every chip weighs the same and
        // the verdict is a shape as well as a hue. Same weight whether
        // the chip is the reader's own tint or a reference game's eval
        // colour, so the black chip does not outshout a loss beside it.
        'w-11 shrink-0 rounded-sm px-1 py-0.5 text-center font-mono text-xs font-medium',
        'tabular-nums leading-4',
        tone,
        className,
      )}
    >
      {verdict && <span className="sr-only">{verdict} </span>}
      {parts.length === 2 && winner ? (
        <>
          <span className={cn(winner === 'white' && 'font-bold')}>{fmt(parts[0]!)}</span>-
          <span className={cn(winner === 'black' && 'font-bold')}>{fmt(parts[1]!)}</span>
        </>
      ) : (
        fmt(result)
      )}
    </span>
  );
}
