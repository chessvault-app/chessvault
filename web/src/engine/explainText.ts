import type { Gesture, LineTags, PlanSummary } from '@shared/explain';
import { t } from '@/lib/i18n';

/**
 * The wording layer over shared/explain.ts: gestures and motif tags in,
 * translated phrases out. Shared code stays language-free; every string
 * here goes through t(), and each phrase is one dictionary entry so
 * Korean can reorder freely.
 */

const ROLE_NAME: Record<string, string> = {
  pawn: 'pawn',
  knight: 'knight',
  bishop: 'bishop',
  rook: 'rook',
  queen: 'queen',
  king: 'king',
};

function gestureText(g: Gesture): string {
  switch (g.type) {
    case 'trade':
      if (g.role === 'queen') return t('trade queens');
      if (g.role === 'rook') return t('trade rooks');
      if (g.role === 'knight') return t('trade knights');
      if (g.colour === 'dark') return t('trade the dark-squared bishops');
      if (g.colour === 'light') return t('trade the light-squared bishops');
      return t('trade bishops');
    case 'winMaterial':
      return t('win material');
    case 'break':
      return t('play the {square} break', { square: g.square });
    case 'maneuver':
      return t('bring the {piece} to {square}', { piece: t(ROLE_NAME[g.piece]!), square: g.to });
    case 'plant':
      return t('plant the {piece} on {square}', { piece: t(ROLE_NAME[g.piece]!), square: g.square });
    case 'openFile':
      return g.rook
        ? t('open the {file}-file for the rooks', { file: g.file })
        : t('open the {file}-file', { file: g.file });
    case 'passer':
      return t('create a passed pawn on the {file}-file', { file: g.file });
    case 'storm':
      return g.wing === 'kingside' ? t('storm the kingside') : t('storm the queenside');
    case 'castle':
      return g.wing === 'kingside' ? t('castle kingside') : t('castle queenside');
    case 'kingWalk':
      return t('march the king to {square}', { square: g.to });
    case 'simplify':
      return t('trade down to convert');
    case 'quiet':
      return t('neither side can make progress');
  }
}

/** The plan as one comma-joined phrase list, or null when there is none. */
export function planText(plan: PlanSummary | null): string | null {
  if (!plan || plan.gestures.length === 0) return null;
  return plan.gestures.map(gestureText).join(', ');
}

/** Chip labels for a line's tags: at most one motif and one sacrifice. */
export function motifChips(tags: LineTags): string[] {
  const chips: string[] = [];
  if (tags.motif) {
    chips.push(
      {
        fork: t('Fork'),
        pin: t('Pin'),
        skewer: t('Skewer'),
        discovered: t('Discovered attack'),
        backRankMate: t('Back-rank mate'),
        trapped: t('Trapped piece'),
        promotion: t('Promotion'),
      }[tags.motif.type],
    );
  }
  if (tags.sacrifice) {
    chips.push(tags.sacrifice.kind === 'sham' ? t('Temporary sacrifice') : t('Sacrifice'));
  }
  return chips;
}
