import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/**
 * A panel with nothing in it yet, saying so properly.
 *
 * Every one of these used to be a 24px lucide icon over a grey paragraph,
 * which reads as an error message: something small and dim in the middle
 * of a lot of nothing. An empty state has three jobs — say what is
 * missing, say how it gets filled, and offer the press that fills it —
 * and the third was never there at all, so the panel ended on a shrug.
 *
 * The art is a picture rather than an icon (see BookmarkArt and its
 * neighbours), the title carries the weight, and the body explains in one
 * sentence. Nothing here is centred in the VIEWPORT; it centres in the
 * panel it was given, which is where the reader is already looking.
 */
export function EmptyState({
  art,
  title,
  body,
  action,
  className,
}: {
  art: ReactNode;
  title: string;
  body: string;
  /** The press that resolves it. Always give one if one exists. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 px-6 py-12 text-center',
        className,
      )}
    >
      {/* shrink-0 for the same reason the archive's art carries it: an
          SVG sized by width alone will be squeezed to nothing by a short
          flex column, and a picture that is 3px tall is worse than no
          picture. */}
      <div className="shrink-0">{art}</div>
      <p className="text-fg mt-3 text-base font-semibold">{t(title)}</p>
      <p className="text-muted max-w-sm text-sm leading-relaxed">{t(body)}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
