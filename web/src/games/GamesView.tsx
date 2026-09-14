/**
 * The Games tab. This file is only the route switch; the pages live
 * beside it — CollectionView (the collection plus the source column),
 * ArchiveBrowser (chess.com/lichess months), DatabaseGames (the reference
 * databases and their manager), and shared.tsx (the model plus the row,
 * preview and badge pieces every list draws with).
 */
import { KeepAlive } from '@/lib/keep-alive';
import { decodeSegment } from '@/lib/router';
import { StudyView } from '@/studies/StudyView';
import { CollectionView } from './CollectionView';

/** Router shell: the collection list, or one collected game open for
    study. The list stays mounted under an open game (lib/keep-alive), so
    Back lands on it with its tab, filters and scroll as they were. */
export function GamesView({ params }: { params: string[] }) {
  // '#/games/elite' was the reference browser's own page; nothing ever
  // navigated to it (the browser lives in the source column and the Add
  // games sheet), so the page shape is gone. The hash still lands
  // somewhere rather than 404ing: the collection, where the browser is
  // one tab or one press away.
  const id = params[0] && params[0] !== 'elite' ? decodeSegment(params[0]) : null;
  return (
    <KeepAlive
      current={id ? `game:${id}` : 'list'}
      data={id}
      keep={(key) => key === 'list'}
      budget={1}
      render={(key, gameId) =>
        key === 'list' || gameId === null ? <CollectionView /> : <StudyView id={gameId} kind="game" />
      }
    />
  );
}
