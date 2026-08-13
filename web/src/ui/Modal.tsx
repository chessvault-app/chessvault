import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useKeyboardInset } from '@/lib/keyboardInset';
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
 * It is PromptSheet at a larger size, deliberately: a quiet label, no rule
 * under it, no X in the corner, and the way out is the Cancel button next
 * to whatever the window is for. Two closing idioms in one app meant every
 * window had to be read before it could be dismissed.
 *
 * Escape and a click on the backdrop close it too, for the same reason
 * PromptSheet's scrim does — but neither is the advertised way out.
 */
export function Modal({
  title,
  icon: Icon,
  actions,
  onClose,
  children,
  className,
  full = false,
}: {
  title: string;
  icon?: typeof X;
  /** One control on the title line — Paste, say. Never a close button. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /**
   * Fill the screen instead of floating in the middle.
   *
   * For the windows that are a task rather than a question — importing a
   * PDF, a game, a Lichess study. A large floating card is the worst of
   * both: too big to see what is behind it, too small for what is inside
   * it, and on a phone it was a card with its own scrollbar inside a page
   * with another one.
   */
  full?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A window with a field in it is a window the keyboard covers. Same fix
  // as PromptSheet: give the centring box back the height the keyboard took.
  const inset = useKeyboardInset();
  // Only a `full` window is a sheet, and only a sheet can be pushed away.
  const drag = useSheetDrag(onClose);

  // On the body, not wherever it was written: a window is a floating layer
  // and must not inherit a containing block from whatever opened it — a
  // transformed ancestor turns `fixed` into "fixed inside that element".
  return createPortal(
    <div
      className={cn(
        // The desktop layer is exactly what it was — a centring grid.
        // Only the phone changes: a `full` window packs to the bottom
        // edge so it rises from the thumb. Expressed as max-sm rather
        // than by swapping the base, because swapping it also swapped
        // how the card sizes itself and collapsed a 600px window to 202.
        'fixed inset-0 z-50 grid place-items-center bg-black/60',
        full ? 'p-0 max-sm:flex max-sm:items-end max-sm:justify-center sm:p-6' : 'p-4',
      )}
      style={{ paddingBottom: inset ? inset + 16 : undefined }}
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
        style={full ? drag.style : undefined}
        className={cn(
          // overscroll-contain: a scroll this window cannot use is its own
          // business. Without it, reaching the end of the list inside a
          // sheet hands the rest of the gesture to whatever is behind the
          // sheet, which then moves under a scrim you are still touching.
          'bg-surface border-line flex w-full flex-col gap-3 overflow-y-auto overscroll-contain',
          'border p-3 shadow-[var(--shadow-pop)]',
          full
            ? // A BOTTOM SHEET on a phone, not a full-screen card. Edge to
              // edge meant a window that had replaced the app — no sense
              // of what it was over, and nothing to push it away with.
              // Rising from the thumb's own edge, stopping short of the
              // top, it reads as a thing ON the page. Desktop keeps the
              // large centred card.
              'max-h-[88dvh] rounded-t-2xl pb-[calc(0.75rem+env(safe-area-inset-bottom))] ' +
              'sm:h-auto sm:max-h-full sm:max-w-4xl sm:rounded-xl sm:pb-3'
            : 'max-h-full max-w-[32rem] rounded-xl',
          className,
        )}
      >
        {/* Full-bleed rule: the card pads by 3, so the row un-pads itself
            and the line reaches both edges, as it does in a Panel. */}
        <div
          className={cn(
            'border-line -mx-3 shrink-0 border-b px-3 pb-2',
            // touch-none on the element that CARRIES the drag, not on the
            // two boxes inside it. A touch is panned by the nearest
            // scrollable ancestor unless touch-action says otherwise, and
            // this card scrolls — so a drag that started on the strip of
            // padding around the handle both pushed the sheet down and
            // scrolled what was inside it. Restored on sm, where this is a
            // centred window with no drag to protect.
            full && 'touch-none select-none sm:touch-auto sm:select-auto',
          )}
          {...(full ? drag.handlers : {})}
        >
          {/* The grabber, phones only: the same handle the row menu has,
              and the same drag, so every sheet in the app is pushed away
              the same way. */}
          {full && (
            <div
              className="bg-line mx-auto mb-2 h-1 w-9 cursor-grab rounded-full sm:hidden"
              aria-hidden
            />
          )}
          <div className="flex items-center gap-2">
            {Icon && <Icon className="text-subtle size-3.5 shrink-0" />}
            <p className="text-subtle min-w-0 flex-1 truncate text-xs">{t(title)}</p>
            {actions}
            {full && (
              <button
                type="button"
                title={t('Close')}
                aria-label={t('Close')}
                onClick={onClose}
                className={cn(
                  'text-muted hover:text-fg -my-1 grid size-8 shrink-0 place-items-center rounded-full sm:hidden',
                  'bg-fg/8 hover:bg-fg/14 ring-fg/10 ring-1 ring-inset backdrop-blur-md',
                  'transition-colors duration-100',
                )}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
