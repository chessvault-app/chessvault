/**
 * Loading placeholders shaped like the content they stand in for — the
 * design-audit replacement for bare "Loading…" strings.
 *
 * Two rules make these help rather than hurt:
 *
 *  - they are the SHAPE of what is coming, so the page does not jump when
 *    the real thing lands. A generic stack of grey bars where a grid of
 *    cards will appear is its own kind of flicker.
 *  - they are governed by `useSlowLoad`, because a skeleton that appears
 *    and vanishes inside 200 ms reads as a glitch. Most loads here are
 *    fast enough that the right thing to show is nothing at all.
 */
import { Skeleton } from '@/components/ui/skeleton';
export { Skeleton };

// The slow-load hook lives in lib/slowLoad (the route loader shares it);
// re-exported so the pages' import path stands.
export { useSlowLoad } from '@/lib/slowLoad';

export { Arrival, Inert, SkeletonSubtitle } from './skeletons/primitives';
export { SkeletonRows, SkeletonLicenceRows } from './skeletons/rows';
export { SkeletonCards, SkeletonBookCards } from './skeletons/cards';
export { SkeletonTiles } from './skeletons/tiles';
export { SkeletonThemeCard, SkeletonThemeGroups } from './skeletons/themes';
export { SkeletonDocument } from './skeletons/document';
export { SkeletonBoard } from './skeletons/board';
export { SkeletonFilterRow, SkeletonGameRows } from './skeletons/games';
export { SkeletonVaultTree } from './skeletons/vault-tree';
