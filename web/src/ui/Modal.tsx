import type { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { Panel, PanelHeader } from './Panel';

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
 *
 * It is a Panel wearing a PanelHeader — the same surface, the same header
 * height, the same close button as the dialogs that were written before
 * this component existed (Load position, Import a game). A modal that
 * styled its own title and its own X read as a different app's window
 * sitting on top of this one.
 */
export function Modal({
  title,
  icon: Icon,
  actions,
  onClose,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  icon?: typeof X;
  /** Header controls, left of the close button. */
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
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
        aria-label={t(title)}
        // The backdrop closes; the window itself must not, or every click
        // inside the form would dismiss it.
        onClick={(e) => e.stopPropagation()}
        className={cn('flex max-h-full w-full max-w-[32rem] flex-col', className)}
      >
        <Panel flush className="min-h-0">
          <PanelHeader
            title={
              Icon ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon className="size-3.5 shrink-0" />
                  <span className="truncate">{t(title)}</span>
                </span>
              ) : (
                title
              )
            }
            actions={actions}
            onClose={onClose}
          />
          <div className={cn('flex min-h-0 flex-col gap-3 overflow-y-auto p-3', bodyClassName)}>
            {children}
          </div>
        </Panel>
      </div>
    </div>
  );
}
