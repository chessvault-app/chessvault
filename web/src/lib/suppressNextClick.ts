/**
 * Swallow the click a touch synthesizes AFTER a popover closed on its
 * touchstart — without this, the tap that dismissed the popover ALSO
 * activates whatever sits underneath (click-through: dismissing the
 * opening sheet could press the colour buttons behind it).
 *
 * One-shot and self-expiring: if the gesture turns into a scroll no click
 * ever fires, and the trap must not linger to eat a later, honest tap.
 */
export function suppressNextClick(): void {
  const swallow = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    cleanup();
  };
  const cleanup = (): void => {
    clearTimeout(timer);
    document.removeEventListener('click', swallow, true);
    document.removeEventListener('pointerdown', cleanup, true);
  };
  document.addEventListener('click', swallow, true);
  // A NEW press disarms the trap: it means the dismissing tap's click either
  // already happened or never will (the gesture became a scroll) — an honest
  // fast follow-up tap must not be eaten. The current gesture can't trigger
  // this: its own pointerdown finished dispatching before we were called.
  document.addEventListener('pointerdown', cleanup, true);
  const timer = setTimeout(cleanup, 500);
}
