/**
 * The Games tab. This file is only the route switch; the pages live
 * beside it — CollectionView (the collection plus the source column),
 * ArchiveBrowser (chess.com/lichess months), EliteGames (the reference
 * databases and their manager), and shared.tsx (the model plus the row,
 * preview and badge pieces every list draws with).
 */
import { StudyView } from '@/studies/StudyView';
import { CollectionView } from './CollectionView';
import { EliteGames } from './EliteGames';

/** Router shell: the collection list, or one collected game open for study. */
export function GamesView({ params }: { params: string[] }) {
  // 'elite' is reserved for the reference-games browser; everything else
  // is a collection document id.
  if (params[0] === 'elite') return <EliteGames shape="page" />;
  const id = params[0] ? decodeURIComponent(params[0]) : null;
  return id ? <StudyView id={id} kind="game" /> : <CollectionView />;
}
