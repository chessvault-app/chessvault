import { materialMenBounds, type MaterialSpec } from './scanMatch.ts';

/**
 * What the endgame drill can draw from: the one rule the server's
 * sampler and the app's class picker both need, so a preset the picker
 * offers is a preset the draw accepts.
 */

/** Syzygy's ceiling, kings included; see server/tablebase.ts. */
export const MAX_MEN = 7;

/** Whether kings plus the spec's minimums fit under the ceiling at all.
    A class that cannot is refused before any table is asked, and is not
    offered. */
export function drillable(spec: MaterialSpec): boolean {
  const { loW, loB } = materialMenBounds(spec);
  return loW + loB <= MAX_MEN;
}
