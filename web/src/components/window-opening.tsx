import { useLayoutEffect, type ComponentProps, type ReactNode } from 'react';
import { Dialog, DialogContent, handOverWindow } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * A window whose contents are still on the wire.
 *
 * Three of this app's windows are lazy — the picture flow and the PDF
 * importer — because each drags in machinery nothing else needs (the
 * board recogniser, the page scanner). The home page's arrangement sheet
 * was a fourth until its chunk turned out to be 1.8 kB of glue over
 * machinery the landing chunk already carried, and covering that wait
 * cost a second mount of the whole body mid-entrance (2026-09-20).
 * All of them hung their Suspense on `fallback={null}`, so pressing the
 * button that opens them did NOTHING until the chunk landed: on a slow
 * link, several seconds in which the only evidence of the press was that
 * the press had not worked.
 *
 * So the frame opens at once with its own title, and the body is bars.
 * The frame is the real Dialog with the real DialogContent, so the
 * window that replaces it is the same window, at the same width, with
 * the same title row: only its body changes. To React they are still
 * two mounts, so this one says it is leaving (`handOverWindow`) and the
 * real window skips the entrance this one already played.
 *
 * `onOpenChange` is a no-op on purpose. A window drawn for a chunk that
 * has not arrived cannot be cancelled meaningfully — the caller's own
 * state says it is open, and closing this would leave that state saying
 * so with nothing on screen. Escape and the scrim come back with the
 * real window, which is at most a chunk away.
 */
export function WindowOpening({
  title,
  icon,
  size,
  fill,
  className,
  lines = 4,
  children,
}: {
  title: string;
  icon?: ComponentProps<typeof DialogContent>['icon'];
  size?: ComponentProps<typeof DialogContent>['size'];
  /** As the real window has it: a phone sheet that fills is that tall
      from its first frame. */
  fill?: boolean;
  className?: string;
  /** Bars in the body. The default is a short form; a window that opens
      on a file picker or a board wants its own shape (`children`). */
  lines?: number;
  /** A body of the window's own shape, where one is worth drawing. */
  children?: ReactNode;
}) {
  useLayoutEffect(() => handOverWindow, []);
  return (
    <Dialog open onOpenChange={NOOP}>
      <DialogContent title={title} icon={icon} size={size} fill={fill} className={className}>
        <div role="status" aria-label={t('Loading')} aria-live="polite" className="flex flex-col gap-3">
          {children ?? <WindowBody lines={lines} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The same body without a frame, for a window's PAGE rather than a
 * window: the picture flow is a page of the chain the editor and the
 * position loader already have open, so a second frame around it would
 * be the window swap those chains exist to remove.
 */
export function WindowPageOpening({ lines = 4, children }: { lines?: number; children?: ReactNode }) {
  return (
    <div role="status" aria-label={t('Loading')} aria-live="polite" className="flex flex-col gap-3">
      {children ?? <WindowBody lines={lines} />}
    </div>
  );
}

/** Ragged bars on the body's own rhythm: a form's fields, roughly. */
function WindowBody({ lines }: { lines: number }) {
  return (
    <>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-8 shrink-0', i % 3 === 2 && 'w-2/3')} />
      ))}
    </>
  );
}

const NOOP = (): void => {};
