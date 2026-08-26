/**
 * The Games tab. This file is only the route switch; the pages live
 * beside it — CollectionView (the collection plus the source column),
 * ArchiveBrowser (chess.com/lichess months), EliteGames (the reference
 * databases and their manager), and shared.tsx (the model plus the row,
 * preview and badge pieces every list draws with).
 */
import { StudyView } from '@/studies/StudyView';
import { CollectionView } from './CollectionView';

/** Router shell: the collection list, or one collected game open for study. */
export function GamesView({ params }: { params: string[] }) {
  // '#/games/elite' was the reference browser's own page; nothing ever
  // navigated to it (the browser lives in the source column and the Add
  // games sheet), so the page shape is gone. The hash still lands
  // somewhere rather than 404ing: the collection, where the browser is
  // one tab or one press away.
  if (params[0] === 'elite') return <CollectionView />;
  const id = params[0] ? decodeURIComponent(params[0]) : null;
  return id ? <StudyView id={id} kind="game" /> : <CollectionView />;
}
