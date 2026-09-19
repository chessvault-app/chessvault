import { t } from '@/lib/i18n';

/**
 * A puzzle theme's name. Its own module, out of ThemesPage, because the
 * trainer's outline prints one (the difficulty row says which theme is
 * being trained) and an outline cannot import the page it waits for.
 */
const LABELS: Record<string, string> = {
  attackingF2F7: 'Attacking f2/f7',
  xRayAttack: 'X-ray attack',
  enPassant: 'En passant',
  masterVsMaster: 'Master vs master',
  superGM: 'Super-GM games',
  master: 'Master games',
  oneMove: 'One move',
  killBoxMate: 'Kill box mate',
  // The possessives, which the id spells without their apostrophe and the
  // derivation below printed that way: "Morphys mate" on a card.
  morphysMate: "Morphy's mate",
  pillsburysMate: "Pillsbury's mate",
  swallowstailMate: "Swallow's tail mate",
};

/** The label in the app's own English, before translation. */
export function englishLabel(theme: string): string {
  if (LABELS[theme]) return LABELS[theme];
  const spaced = theme
    .replace(/([A-Z])/g, ' $1')
    .replace(/(\d+)/g, ' $1')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** camelCase theme id → human label ("hangingPiece" → "Hanging piece"). */
export function themeLabel(theme: string): string {
  return t(englishLabel(theme));
}
