import { cn } from '@/lib/utils';

/** PGN results with the proper half glyph: 1/2-1/2 → ½-½. */
const fmt = (result: string): string => result.replaceAll('1/2', '½');

/**
 * A game's result as ONE chip, everywhere a result appears — the games
 * tables, the details panel, the explorer's top games, the home page's
 * recent games, the opening map's deviations. Tinted from the player's
 * own point of view where there is one (green won, red lost — a win
 * and a loss are not the same fact); games without a known side just
 * brighten the winner. It used to be two vocabularies: the explorer
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
}: {
  result: string;
  userSide?: 'white' | 'black' | null;
}) {
  const parts = result.split('-');
  const winner = result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;
  const tone =
    parts.length !== 2 || !winner
      ? 'bg-accent text-muted-foreground'
      : !userSide
        ? 'bg-accent text-foreground'
        : userSide === winner
          ? 'bg-good/15 text-good'
          : 'bg-destructive/15 text-destructive';
  return (
    <span
      title={fmt(result)}
      className={cn(
        'w-11 shrink-0 rounded-sm px-1 py-0.5 text-center font-mono text-xs font-semibold',
        'tabular-nums leading-4',
        tone,
      )}
    >
      {fmt(result)}
    </span>
  );
}
