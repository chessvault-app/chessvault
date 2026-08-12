import type { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useKeyboardInset } from '@/lib/keyboardInset';

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

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 grid place-items-center bg-black/60',
        full ? 'p-0 sm:p-6' : 'p-4',
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
        className={cn(
          'bg-surface border-line flex w-full flex-col gap-3 overflow-y-auto',
          'border p-3 shadow-[var(--shadow-pop)]',
          full
            ? // Edge to edge on a phone — no corners to round against the
              // screen edge — and a large, still-bounded sheet on desktop.
              // The insets keep the title out from under a notch and the
              // last button off the home indicator.
              'h-full max-h-full rounded-none pb-[calc(0.75rem+env(safe-area-inset-bottom))] ' +
              'pl-[calc(0.75rem+env(safe-area-inset-left))] pr-[calc(0.75rem+env(safe-area-inset-right))] ' +
              'pt-[calc(0.75rem+env(safe-area-inset-top))] ' +
              'sm:h-auto sm:max-h-full sm:max-w-4xl sm:rounded-xl sm:p-3'
            : 'max-h-full max-w-[32rem] rounded-xl',
          className,
        )}
      >
        {/* Full-bleed rule: the card pads by 3, so the row un-pads itself
            and the line reaches both edges, as it does in a Panel. */}
        <div className="border-line -mx-3 flex items-center gap-2 border-b px-3 pb-2">
          {Icon && <Icon className="text-subtle size-3.5 shrink-0" />}
          <p className="text-subtle min-w-0 flex-1 truncate text-xs">{t(title)}</p>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}
