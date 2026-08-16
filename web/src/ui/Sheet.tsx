import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/media';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { Button } from './Button';
import { CoverParent } from './Modal';
import { useCloseRequest, useDialogFocus } from './dialogFocus';
import { useSheetDrag } from './sheetDrag';
import { useSheetCover } from './sheetCover';
import { t } from '@/lib/i18n';

/**
 * The one-question window: a bottom sheet on a phone, a small centred card
 * on a desktop.
 *
 * Extracted from PromptSheet once "move to" wanted the same thing with a
 * list in it instead of a field: an anchored popover put its answer beside
 * the row it came from, which on a phone is wherever the row happened to
 * be — sometimes under the keyboard, sometimes off the edge.
 *
 * It was a centred card on the phone too, and that was a workaround: a
 * card floating in the middle of the screen was the one shape iOS's
 * keyboard could not push somewhere silly. It can be a sheet now, which is
 * what every other window on a phone already is — the keyboard is measured
 * (lib/keyboardInset), the layer is pinned to the band that can be seen,
 * and the sheet drags away from anywhere on itself.
 *
 * Nothing here is transitioned: animating against iOS's own animation is
 * what made the earlier attempts jump about.
 */
export function Sheet({
  label,
  children,
  onClose,
  className,
  fill = false,
}: {
  label: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  /**
   * Open as tall as this sheet is allowed to be, instead of as tall as
   * its own content.
   *
   * Two floors, whichever applies. Opened OVER another sheet it takes
   * that sheet's height, for the sheets that are a PAGE of the one
   * behind them — browse the field and pick a move, pick a study to
   * link — where snapping from a two-thirds-height window to a shorter
   * one reads as two windows rather than one window turning its page.
   * `useSheetCover` was already supplying that measurement as a ceiling,
   * and this is the same number used as a floor.
   *
   * Opened on its own, the floor is the ceiling the screen gives it. A
   * detail panel is the case: its height followed whatever the selection
   * happened to hold, so the same sheet stood two thirds of the screen
   * for one move and a third for the next, and its footer landed
   * somewhere different every time. One height means the body scrolls
   * and everything else stays where it was.
   *
   * NOT for the questions. A confirm is a sentence and two buttons, and
   * stretching it over a whole screen to match anything would be filling
   * a window with nothing to say.
   */
  fill?: boolean;
}) {
  const phone = useMediaQuery('(max-width: 39.9375rem)');
  const drag = useSheetDrag(onClose);
  const focusRef = useDialogFocus();

  /**
   * Never taller than the window this sheet was asked over — and if it
   * ends up exactly as tall, a way back out of it.
   *
   * A window pinned at 88% of the screen would open a Select's options —
   * its own sheet, capped only by the safe area — and the child rose 80px
   * ABOVE the window it belonged to (measured in the archive browser:
   * parent 669px from y=93, child 751px from y=12). Two bottom edges,
   * the upper one belonging to the smaller thing, reads as the window
   * having been replaced rather than asked a question.
   *
   * It reads the same primitive the second-page floor uses — Modal's
   * CoverParent, the `height` half only. A Sheet is a LAYER, never a
   * page: it does not cover, so the window is still mounted and still
   * behind it. See sheetCover for the rest, and for why a sheet that
   * hides its window completely has to offer the chevron.
   */
  const { cap, covered, ref: coverRef } = useSheetCover(phone);

  /**
   * And a sheet is a parent as well as a child.
   *
   * `useSheetCover` reads its ceiling from `CoverParent`, but only Modal
   * ever supplied one — so a sheet opened FROM a sheet found no parent,
   * took no cap, and grew to the safe area: the move-details sheet is
   * two thirds of the screen and the add-a-move sheet it opens stood
   * taller than it, hanging over its top edge. The primitive was already
   * here; nothing was handing it the measurement.
   *
   * `height` is this card, read live, because a sheet's height is its
   * content's and its content can change. `cover` parks it, the way
   * Modal parks a window whose page has replaced it — a nested MODAL is
   * a page, not a layer, and the sheet under it should not show through.
   */
  const card = useRef<HTMLElement | null>(null);
  const [coveredBy, setCoveredBy] = useState(0);
  const asParent = useMemo(
    () => ({
      cover: () => {
        setCoveredBy((n) => n + 1);
        return () => setCoveredBy((n) => n - 1);
      },
      height: () => card.current?.offsetHeight ?? 0,
    }),
    [],
  );

  // Escape, and Android's Back gesture with it — see useCloseRequest.
  useCloseRequest(onClose);

  // Portalled for the same reason ActionSheet is: a rename opened from a
  // shelf card is a child of that card, and a card that lifts under the
  // pointer is a containing block for `fixed` — so the sheet was laid out
  // inside the card and clipped by its overflow.
  return createPortal(
    <CoverParent.Provider value={asParent}>
    <div
      className={cn(
        'vv-band fixed inset-0 z-50 flex justify-center bg-black/50',
        // Bottom edge on a phone, middle of the band on a desktop.
        'max-sm:items-end max-sm:p-0 sm:items-center sm:p-3',
        coveredBy > 0 && 'invisible',
      )}
      onPointerDown={() => {
        onClose();
        suppressNextClick();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t(label)}
        ref={(node) => {
          card.current = node;
          focusRef(node);
          coverRef(node);
          if (phone) drag.ref(node);
        }}
        style={
          phone
            ? {
                ...drag.style,
                // The parent's height as a VARIABLE, not as a height.
                //
                // It used to be an inline max-height, with the `fill`
                // floor beside it — two pixel numbers measured when the
                // sheet opened. Then the keyboard came up, the layer
                // shrank to the band above it, and the card kept the
                // height of a screen that was no longer there: an
                // add-a-move sheet with its list run off the top and a
                // hand's depth of empty card over the field being typed
                // into. Inline beat every class that would have capped
                // it, including `max-h-full`.
                //
                // Read into a `min()` below instead, so the parent's
                // number and the band's own are both ceilings and the
                // smaller one wins — whichever the keyboard leaves.
                ...(cap ? ({ '--sheet-cap': `${cap}px` } as CSSProperties) : undefined),
              }
            : undefined
        }
        className={cn(
          // overscroll-contain for the same reason Modal has it: a scroll
          // this card cannot use must not be handed to the page under it.
          // [&>*]:shrink-0 for the other one: a short window is one field
          // and two buttons, and a flex column would rather squash them
          // than let itself overflow.
          'bg-surface border-line flex max-h-full w-full flex-col gap-2 overflow-y-auto overscroll-contain',
          // pt-0, because the title strip below is sticky and carries the
          // top padding itself. Padding on the CARD stays behind a sticky
          // child — the strip would pin 12px down, with the rows sliding
          // through the gap above it.
          'border px-3 pb-3 pt-0 shadow-[var(--shadow-pop)] [&>*]:shrink-0',
          // A tall sheet — the opening catalogue is a thousand rows — grows
          // until it runs out of screen, and on a phone the top of the
          // screen is under the notch. So its ceiling is the safe area
          // rather than the viewport, and it stops short of the status bar
          // instead of putting its first row behind the clock.
          // 1.25rem under the last row, not the card's own 0.75: a small
          // sheet — a confirm is a question and two buttons — ended right
          // at the home indicator and read as cramped. The extra half rem
          // is air, not a minimum height: a sheet is exactly as tall as
          // its content plus room to end comfortably.
          'max-sm:rounded-t-2xl max-sm:pb-[calc(1.25rem+var(--safe-b))]',
          // The lower of the two ceilings: the sheet this one was opened
          // over, and the band the screen can show. `--sheet-cap` is
          // unset when there is no sheet behind it, and 100% is then no
          // constraint at all, so one expression covers both. Both are
          // percentages of the layer, which is pinned to the visible
          // band while a keyboard is up — so the whole thing gives way
          // to the keyboard instead of hanging off the top of it.
          'max-sm:max-h-[min(var(--sheet-cap,100%),calc(100%-env(safe-area-inset-top)-0.75rem))]',
          // `fill` makes that ceiling the floor as well, so the card
          // opens at exactly one height. The same expression, or a floor
          // could outgrow the ceiling — in CSS a min-height wins that
          // argument, which is how a child sheet would end up taller
          // than the parent it is supposed to fit inside.
          fill && 'max-sm:min-h-[min(var(--sheet-cap,100%),calc(100%-env(safe-area-inset-top)-0.75rem))]',
          'sm:max-w-sm sm:rounded-xl',
          className,
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* The rule under the title is the DESKTOP's, where every window
            and panel draws one; full-bleed against the card's own padding.
            A bottom sheet draws none — ActionSheet never had one, and two
            kinds of sheet on one phone read as two different windows. On a
            phone the grabber sits above the title, and the whole strip is
            the mouse's drag handle — see sheetDrag for why a finger needs
            neither.

            Pinned to the top of the card, which scrolls. A ten-row list
            is taller than the sheet holding it, and the strip scrolling
            away with the rows took the label and the back chevron with
            it — on a sheet standing over a hidden parent, the chevron is
            the way back, and a way back you have to scroll up to find is
            not one. Its own opaque fill because rows now pass beneath
            it. */}
        <div
          className="border-line bg-surface sticky top-0 z-10 -mx-3 px-3 pb-2 pt-3 max-sm:touch-none max-sm:select-none sm:border-b"
          {...(phone ? drag.handlers : {})}
        >
          <div className="bg-line mx-auto mb-2 h-1 w-9 cursor-grab rounded-full sm:hidden" aria-hidden />
          {/* The chevron only when this sheet has hidden the window it was
              opened from — see sheetCover. Standing over a window you can
              still see, the scrim, the drag and Back all say how to leave
              and a button would be a fourth answer to a question nobody
              had; with the window gone from view, none of them LOOK like
              a way back to it. It is the same control, in the same
              corner, as a Modal's second page. */}
          <div className="flex items-center gap-2">
            {covered && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Back')}
                aria-label={t('Back')}
                className="-my-1 -ml-1 shrink-0"
                onClick={onClose}
              >
                <ChevronLeft className="size-3.5" />
              </Button>
            )}
            <p className="text-subtle min-w-0 flex-1 truncate text-xs">{t(label)}</p>
            {/* The desktop's way out, named: the scrim and Escape both
                close, but neither LOOKS like a control. Phones keep the
                grabber and swipe instead of a third glyph in the strip. */}
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Close')}
              aria-label={t('Close')}
              className="-my-1 -mr-1 hidden shrink-0 sm:grid"
              onClick={onClose}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
        {children}
      </div>
    </div>
    </CoverParent.Provider>,
    document.body,
  );
}
