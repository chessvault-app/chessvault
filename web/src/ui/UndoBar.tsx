import { Undo2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { t } from '@/lib/i18n';

/**
 * The undo that stands in for a confirmation.
 *
 * Pinned to the bottom-right of the WINDOW rather than centred over the
 * list: centred, it sat across the cards it was talking about and covered
 * the helper line under them. On a phone it stays centred and clears the
 * bottom bar, where there is no corner to spare.
 *
 * It rises as it appears — a thing that slid up from the bottom edge reads
 * as having arrived, where a thing that blinks into place reads as having
 * always been there and been missed.
 */
export function UndoBar({
  label,
  message,
  leaving = false,
  onUndo,
  onHold,
  onRelease,
}: {
  label: string;
  /**
   * The whole sentence, for an act that is not a removal.
   *
   * Discarding pending changes takes this bar for the grace period it
   * needs, but "Removed “your unsaved changes”" is not a sentence anyone
   * would write. Given here, `label` is unused.
   */
  message?: string;
  /** Its time is up: fade out, and stop taking the press. */
  leaving?: boolean;
  onUndo: () => void;
  /** Pointer or keyboard focus arrives: pause the commit timer. A grace
      period that expires under the cursor takes the button away
      mid-press, and a screen-reader user needs longer than 4.5 s. */
  onHold?: () => void;
  onRelease?: () => void;
}) {
  return (
    <div
      className={
        'pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4 ' +
        'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] ' +
        'md:inset-x-auto md:bottom-6 md:right-6 md:px-0'
      }
      // The one moment of feedback a deletion gives — announced, not
      // just shown. role=status makes its appearance a polite live
      // announcement without a dedicated region.
      role="status"
      onPointerEnter={onHold}
      onPointerLeave={onRelease}
      onFocusCapture={onHold}
      onBlurCapture={onRelease}
    >
      {/* The inverted surface, and no border: a chip that is the opposite
          of the page needs no outline to be told from it, and the border
          was the last thing making this read as one more panel. */}
      <div
        className={cn(
          'bg-toast text-toast-fg flex items-center gap-3 rounded-full',
          // ONE WIDTH, whatever was removed. Sized to its own text, the
          // chip was a different object every time: measured at 166px for
          // a one-character name, 276 for a study, 520 for a long note
          // title. On a phone that also moved the Undo button, because the
          // box is centred there — 222px from the left edge or 318px,
          // depending on what you had just deleted. It is the same chip
          // now, and the one thing in here that gets pressed is always in
          // the same place. A name too long for it truncates, which is
          // what the width above the ellipsis was buying.
          'w-full max-w-[22rem] md:w-[22rem]',
          'py-1.5 pl-4 pr-1.5 shadow-[var(--shadow-pop)]',
          leaving ? 'animate-sink' : 'animate-rise pointer-events-auto',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-base">
          {message ?? t('Removed “{name}”', { name: label })}
        </span>
        {/* The ghost button's own colours are page colours — muted grey on
            a hover of surface-2 — which are invisible here. It borrows the
            chip's foreground and a wash of it for the hover instead. */}
        <Button
          variant="ghost"
          size="sm"
          className="text-toast-fg hover:bg-toast-fg/12 hover:text-toast-fg font-semibold"
          onClick={onUndo}
        >
          <Undo2 className="size-3.5" />
          {t('Undo')}
        </Button>
      </div>
    </div>
  );
}
