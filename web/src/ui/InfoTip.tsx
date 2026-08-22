import { HelpCircle } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useDismiss, useFloating, type Box } from '@/lib/floating';
import { Sheet } from './Sheet';
import { t } from '@/lib/i18n';

/**
 * A small ? beside a title, holding the sentence that used to sit in the
 * page's own body — explanation on demand instead of a paragraph every
 * visit re-reads. A pointer that can hover gets a popover on hover (and
 * on keyboard focus); a touch screen gets the app's bottom sheet on tap,
 * because touch has no hover and a popover it cannot dismiss is a trap.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [sheet, setSheet] = useState(false);
  // The trigger's rectangle at the moment it opened. Null is closed: the
  // popover is placed from a measurement, so it cannot be rendered
  // without one.
  const [anchor, setAnchor] = useState<Box | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const coarse = (): boolean => window.matchMedia('(pointer: coarse)').matches;
  const tip = useFloating(anchor, { side: 'bottom', align: 'start', gap: 6 });
  const tipEl = useRef<HTMLElement | null>(null);
  const close = (): void => setAnchor(null);
  // A tip placed from a rectangle points at nothing once the page moves
  // under it, and the column this usually sits in scrolls.
  useDismiss(anchor !== null, close, [button, tipEl]);
  const open = (): void => {
    if (!coarse()) setAnchor(button.current?.getBoundingClientRect() ?? null);
  };

  return (
    <span className="inline-flex">
      <button
        ref={button}
        type="button"
        aria-label={t(label)}
        // 20px of ? beside a title, and on a touch screen that ? is the
        // only way to the sheet — the one pointer that cannot hover is
        // the one that had the smallest target. The mark stays 20px
        // (it sits inline against a label and would shove it), and the
        // invisible inset takes the thumb's target to 44px. Anchored on
        // the button, which is safe: the popover hangs off the wrapper.
        className={cn(
          'text-subtle hover:text-foreground relative grid size-5 place-items-center rounded-full transition-colors duration-100',
          'pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-[""]',
        )}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onClick={() => {
          if (coarse()) setSheet(true);
        }}
      >
        <HelpCircle className="size-3.5" />
      </button>

      {/* Portalled, and placed rather than hung off the trigger with
          `absolute`. It used to be the latter, inside whatever wrote it:
          the repertoire header sits in a column with `overflow-y: auto`,
          which clips as readily as it scrolls, and a 256px tip 63px into
          a 432px column fits — until the window is short, the column is
          squeezed, and it does not. Measured on the repertoire page: at
          1440x520 the tip lost 12px off its right edge and at 760x420 it
          lost 43px. A fixed layer in the body is clipped by nothing, and
          placeNear keeps it inside the window. */}
      {anchor &&
        createPortal(
          <span
            ref={(node) => {
              tipEl.current = node;
              tip.ref(node);
            }}
            role="tooltip"
            style={tip.style}
            className={
              'bg-card border-border text-muted-foreground z-50 w-64 ' +
              'rounded-lg border p-3 text-sm font-normal normal-case leading-relaxed tracking-normal ' +
              'shadow-pop'
            }
          >
            {children}
          </span>,
          document.body,
        )}

      {sheet && (
        <Sheet label={t(label)} onClose={() => setSheet(false)}>
          <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>
        </Sheet>
      )}
    </span>
  );
}
