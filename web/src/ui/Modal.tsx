import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { Button } from './Button';

/**
 * A centred window over the app.
 *
 * The standing rule lanph3re set: anything that is not a single line is a
 * modal. Forms that expanded a panel in place pushed the thing they were
 * about off the screen — on a phone the studies list vanished behind its
 * own import form — and a panel that grows has no obvious way out, while a
 * modal always has the same one.
 *
 * Escape and a click on the backdrop close it, because a window that can
 * only be closed by finding its button is a window people feel stuck in.
 */
export function Modal({
  title,
  icon: Icon,
  onClose,
  children,
  className,
}: {
  title: string;
  icon?: typeof X;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // The backdrop closes; the window itself must not, or every click
        // inside the form would dismiss it.
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-surface border-line flex max-h-full w-full max-w-[32rem] flex-col gap-3 overflow-y-auto rounded-xl border p-4',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="text-subtle size-4 shrink-0" />}
          <h2 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">{t(title)}</h2>
          <Button variant="ghost" size="icon-sm" title={t('Close')} onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}
