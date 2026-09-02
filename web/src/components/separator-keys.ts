/**
 * The keyboard half of a drag handle.
 *
 * The pane and panel grips were pointer-only: a divider you can drag but
 * not reach from the keyboard fails WCAG 2.1.1 outright. This is the rule
 * both share, kept out of the components so it can be tested without a
 * DOM: an arrow along the handle's axis moves it a step (Shift, a larger
 * one), and Enter does what a double-click does, return to the default.
 *
 * `orientation` is the separator's own, as ARIA reads it: a "vertical"
 * separator stands between two columns and answers Left/Right; a
 * "horizontal" one lies between two rows and answers Up/Down.
 */
export const SEPARATOR_STEP = 16;
export const SEPARATOR_BIG_STEP = 64;

export type SeparatorOrientation = 'horizontal' | 'vertical';

export type SeparatorAction = { kind: 'move'; to: number } | { kind: 'reset' } | null;

export function separatorKey(
  e: { key: string; shiftKey: boolean },
  orientation: SeparatorOrientation,
  current: number,
  min: number,
  max: number,
): SeparatorAction {
  if (e.key === 'Enter') return { kind: 'reset' };
  const [less, more] =
    orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  const sign = e.key === less ? -1 : e.key === more ? 1 : 0;
  if (sign === 0) return null;
  const step = e.shiftKey ? SEPARATOR_BIG_STEP : SEPARATOR_STEP;
  return { kind: 'move', to: Math.min(Math.max(current + sign * step, min), max) };
}
