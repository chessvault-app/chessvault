import type { Chapter } from '@shared/types';

/**
 * A drill the opening map asked for: the whole repertoire at once.
 *
 * The trainer normally drills one study; the map's request is the union
 * of every study its tags point at, starting from a chosen node. Handed
 * over the same way a jump target is (set before navigate, consumed once
 * on mount), so the repertoire route itself stays a plain URL. Each
 * chapter carries the study it came from, because the drill's record
 * files per position under a real study and chapter name — a map-wide
 * drill must not invent a synthetic study in the history.
 */
export interface MapDrillTarget {
  /** What the setup panel calls it, e.g. "Opening map · 1... c5". */
  label: string;
  color: 'white' | 'black';
  /** Every scoped chapter of every tagged study, with its study's id. */
  entries: { study: string; chapter: Chapter }[];
  /** SANs from the start position to the node the drill starts on. */
  path: string[];
}

let pending: MapDrillTarget | null = null;

export const setMapDrill = (target: MapDrillTarget): void => {
  pending = target;
};

export const consumeMapDrill = (): MapDrillTarget | null => {
  const target = pending;
  pending = null;
  return target;
};
