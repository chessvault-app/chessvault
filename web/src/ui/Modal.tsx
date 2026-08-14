import { useEffect, type ReactNode } from 'react';
import { ChevronLeft, X, type LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { useDialogFocus } from './dialogFocus';
import { useSheetDrag } from './sheetDrag';

/**
 * A centred window over the app.
 *
 * The standing rule lanph3re set: anything that is not a single line is a
 * modal. Forms that expanded a panel in place pushed the thing they were
 * about off the screen — on a phone the studies list vanished behind its
 * own import form — and a panel that grows has no obvious way out, while a
 * modal always has the same one.
 *
 * It is PromptSheet at a larger size, deliberately: a quiet label and the
 * way out next to whatever the window is for. Two closing idioms in one
 * app meant every window had to be read before it could be dismissed.
 *
 * Escape and a click on the backdrop close it too, for the same reason
 * PromptSheet's scrim does — but neither is the advertised way out. On a
 * DESKTOP one is: an X in the corner, because a window that is only a
 * list of settings has no Cancel button to leave by, and the other two
 * ways out are both invisible. A phone shows no X — the sheet drags away
 * from anywhere on itself, which is the gesture it was given instead.
 */
export function Modal({
  title,
  icon: Icon,
  actions,
  onClose,
  onBack,
  children,
  className,
  hidden = false,
  full = false,
}: {
  title: string;
  icon?: LucideIcon;
  /** One control on the title line — Paste, say. Never a close button. */
  actions?: ReactNode;
  onClose: () => void;
  /**
   * Where this window came from, when it came from another one.
   *
   * A window opened out of a window used to be a second sheet stacked on
   * the first, two scrims deep on a phone. With this it is the same sheet
   * showing its second page: the caller closes the first and reopens it
   * from here, and the title row grows a chevron to say so.
   */
  onBack?: () => void;
  children: ReactNode;
  /**
   * Out of sight, still mounted.
   *
   * For a window that has opened another one: unmounting it would take
   * the state of whatever it contains with it — including, in the
   * editor's case, the very button that opened the second window. Hidden,
   * it is still there to come back to.
   */
  hidden?: boolean;
  className?: string;
  /**
   * A wide window on a DESKTOP. Nothing to do with a phone.
   *
   * For the windows that are a task rather than a question — browsing an
   * archive, picking from the elite games — where a small floating card
   * is too small for what is inside it. On a phone every window is the
   * same shape, so this says nothing there.
   *
   * It is about the CONTENT, not the importance of the window: the book
   * import was `full` while it showed a wall of crops and gave it up
   * when it became a list of one-line rows, which at 4xl were mostly
   * empty space.
   */
  full?: boolean;
}) {
  useEffect(() => {
    // Not while hidden: a window parked behind the one it opened must not
    // also swallow the Escape aimed at the top window — that dismissed
    // both at once.
    if (hidden) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, hidden]);

  // EVERY window is a sheet on a phone, and none is on a desktop — a
  // centred card that slides away downwards is not answering any question
  // the pointer asked. `full` is about desktop width and nothing else.
  const sheet = useMediaQuery('(max-width: 39.9375rem)');
  const drag = useSheetDrag(onClose);
  // Inactive while hidden: a window parked behind the one it opened must
  // not hold the focus trap against it.
  const focusRef = useDialogFocus(!hidden);

  // On the body, not wherever it was written: a window is a floating layer
  // and must not inherit a containing block from whatever opened it — a
  // transformed ancestor turns `fixed` into "fixed inside that element".
  return createPortal(
    <div
      className={cn(
        // The desktop layer is a centring grid; the phone packs to the
        // bottom edge so the window rises from the thumb. Expressed as
        // max-sm rather than by swapping the base, because swapping it
        // also swapped how the card sizes itself and collapsed a 600px
        // window to 202.
        // vv-band: while the keyboard is up this is pinned to the band
        // that can be seen rather than to the layout viewport, which is
        // the thing iOS has just shifted. At rest it is inset-0.
        'vv-band fixed inset-0 z-50 grid place-items-center bg-black/60',
        'max-sm:flex max-sm:items-end max-sm:justify-center max-sm:p-0',
        full ? 'sm:p-6' : 'sm:p-4',
        hidden && 'hidden',
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(title)}
        // The backdrop closes; the window itself must not, or every click
        // inside the form would dismiss it.
        onClick={(e) => e.stopPropagation()}
        // Two refs on one node: the focus trap always, and on a phone the
        // drag ref that makes the WHOLE sheet draggable — see sheetDrag.
        ref={(node) => {
          focusRef(node);
          if (sheet) drag.ref(node);
        }}
        style={sheet ? drag.style : undefined}
        className={cn(
          // overscroll-contain: a scroll this window cannot use is its own
          // business. Without it, reaching the end of the list inside a
          // sheet hands the rest of the gesture to whatever is behind the
          // sheet, which then moves under a scrim you are still touching.
          'bg-surface border-line flex w-full flex-col gap-3 overflow-y-auto overscroll-contain',
          'border p-3 shadow-[var(--shadow-pop)]',
          // Children keep their size; the WINDOW scrolls. A flex column is
          // allowed to shrink its children before it overflows, and that is
          // what it did the moment the keyboard shortened the sheet: the
          // PGN box collapsed to a sliver of its own placeholder and the
          // button row landed on top of the result buttons. A form does not
          // get smaller because there is less room to show it in — it gets
          // scrolled, which is what a sheet is for.
          '[&>*]:shrink-0',
          // A BOTTOM SHEET on a phone, whatever the window is. Edge to
          // edge meant a window that had replaced the app — no sense of
          // what it was over, and nothing to push it away with. Rising
          // from the thumb's own edge, stopping short of the top, it
          // reads as a thing ON the page.
          //
          // 88% of THIS LAYER, not 88dvh. dvh is the dynamic viewport and
          // does not shrink for a keyboard, so a sheet capped in dvh
          // stayed its full height when the keyboard took half the
          // screen — its bottom went under the keys, and the browser
          // scrolled the whole sheet up to find the caret, which is what
          // threw the caret away. While the keyboard is up the layer IS
          // the band above it (see index.css), so a percentage of the
          // layer is a percentage of the room left. It stays 88% with the
          // keyboard up rather than taking the whole band: a sheet has to
          // rise to clear the keys, but it does not have to GROW on the
          // way, and one that fills the band arrives at the top of the
          // screen looking like a different window.
          'max-sm:max-h-[88%] max-sm:rounded-t-2xl max-sm:pb-[calc(0.75rem+var(--safe-b))]',
          // The desktop card, which `full` is entirely about.
          'sm:h-auto sm:max-h-full sm:rounded-xl',
          full ? 'sm:max-w-4xl' : 'sm:max-w-[32rem]',
          className,
        )}
      >
        {/* Full-bleed rule: the card pads by 3, so the row un-pads itself
            and the line reaches both edges, as it does in a Panel. */}
        <div
          className={cn(
            'border-line -mx-3 shrink-0 border-b px-3 pb-2',
            // The header is the one place the browser must never pan:
            // it is not a scroller, and a drag begun here is a push on the
            // sheet by definition. The BODY keeps touch-action auto, since
            // it scrolls and the drag decides between the two at the first
            // move. Restored on sm, a centred window with no drag.
            'max-sm:touch-none max-sm:select-none',
          )}
          {...(sheet ? drag.handlers : {})}
        >
          {/* The grabber, phones only. It is a SIGN that the sheet can be
              pushed away, not the only place that answers: the whole sheet
              drags, and content that scrolls hands the gesture over once
              it is at its top. */}
          <div
            className="bg-line mx-auto mb-2 h-1 w-9 cursor-grab rounded-full sm:hidden"
            aria-hidden
          />
          <div className="flex items-center gap-2">
            {onBack && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Back')}
                aria-label={t('Back')}
                className="-my-1 -ml-1 shrink-0"
                onClick={onBack}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
            )}
            {Icon && <Icon className="text-subtle size-3.5 shrink-0" />}
            <p className="text-subtle min-w-0 flex-1 truncate text-xs">{t(title)}</p>
            {actions}
            {/* A way out for the mouse, and only for the mouse.
                A phone has three already — drag the sheet down, tap the
                scrim, press Back — which is why the X went. A desktop
                window has the scrim and Escape, and both are invisible:
                a window whose only content is a list of settings had no
                button in it at all, so there was nothing on screen that
                said how to leave. */}
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Close')}
              aria-label={t('Close')}
              className="-my-1 -mr-1 hidden shrink-0 sm:inline-flex"
              onClick={onClose}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
