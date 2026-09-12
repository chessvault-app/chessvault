import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A whole page that cannot do its job, saying so: an icon tile, a title,
 * a sentence, and the presses that lead somewhere else.
 *
 * Deliberately NOT `EmptyState`, which is the registry's `Empty` and
 * belongs to a PANEL — a shelf with nothing on it yet, centred in the box
 * it was given, with a dashed edge and a 32px tile. This one owns the
 * viewport: it centres in the whole page, carries a 56px tile and the
 * headline rung, and is what a reader meets when the route itself is the
 * problem. Two scopes, two shapes, and both named now.
 *
 * It exists because the shape was written three times — the error
 * boundary, the router's fallback and the workspace's too-narrow gate —
 * and the three agreed only because each was copied from the last. The
 * comment in the workspace copy said so out loud ("the error card this
 * borrowed from"), which is the point at which a pattern has stopped
 * being a coincidence and wants a name.
 *
 * The geometry here is exactly what those three drew, so adopting it
 * moved nothing.
 */
export function PageGate({
  icon: Icon,
  title,
  titleClassName,
  body,
  actions,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: ReactNode;
  /** For a title that is a name rather than a sentence (the router's fallback). */
  titleClassName?: string;
  body: ReactNode;
  /** Where to go instead. Give one wherever one exists. */
  actions?: ReactNode;
}) {
  return (
    // data-ground: the gate owns the viewport, so its tile and buttons
    // stand on the page and take the ground rung (index.css).
    <div data-ground="" className="optical-center h-full p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-2xl">
          <Icon className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className={cn('text-xl font-semibold tracking-tight', titleClassName)}>{title}</h1>
        <p className="text-muted-foreground text-base leading-relaxed">{body}</p>
        {actions && <div className="mt-1 flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}
