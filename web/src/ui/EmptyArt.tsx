import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { KnightIcon } from './KnightIcon';

/**
 * The pictures the empty states are built from.
 *
 * All the same construction: the app's own knight, large and quiet, with
 * one small badge over its corner saying which kind of empty this is. The
 * knight is the piece already on the board, the app icon and the lock
 * screen — when something has to say "chess" rather than "grid", it is
 * what the app uses, and an empty state is the one place with room to
 * draw it properly.
 *
 * Everything is currentColor and theme tokens, so none of it has to be
 * redrawn for a palette or a dark/light flip.
 */
function KnightPlate({ badge, glow }: { badge: ReactNode; glow: string }) {
  return (
    <div className="relative isolate grid size-24 shrink-0 place-items-center">
      {/* The glow: a soft disc behind everything, which is what stops the
          plate reading as a lone grey glyph on a flat panel. */}
      <div
        className="absolute inset-2 -z-10 rounded-full blur-xl"
        style={{ background: glow }}
        aria-hidden
      />
      <div className="border-line bg-surface-2/60 absolute inset-0 -z-10 rounded-2xl border" aria-hidden />
      <KnightIcon className="text-subtle size-12 opacity-70" />
      {/* Bottom-right, overlapping the plate's edge, so the two read as
          one object rather than as an icon with a sticker beside it. */}
      <div className="absolute -bottom-1.5 -right-1.5">{badge}</div>
    </div>
  );
}

function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        'border-app grid size-8 place-items-center rounded-full border-4 shadow-[var(--shadow-pop)]',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Nothing starred yet. */
export function BookmarkArt() {
  return (
    <KnightPlate
      glow="radial-gradient(circle, var(--color-warn) 0%, transparent 70%)"
      badge={
        <Badge className="bg-warn/20">
          {/* Drawn rather than imported so it can be filled AND outlined:
              a lucide star at this size is a wire outline, and the point
              of this badge is that it looks like a star somebody lit. */}
          <svg viewBox="0 0 24 24" className="text-warn size-4" fill="currentColor" aria-hidden>
            <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9L12 2.6z" />
          </svg>
        </Badge>
      }
    />
  );
}

/** A collection with nothing in it at all. */
export function CollectionArt() {
  return (
    <KnightPlate
      glow="radial-gradient(circle, var(--color-primary) 0%, transparent 70%)"
      badge={
        <Badge className="bg-primary-soft">
          <svg viewBox="0 0 24 24" className="text-primary size-4" fill="currentColor" aria-hidden>
            <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5z" />
          </svg>
        </Badge>
      }
    />
  );
}

/** A search that matched nothing. */
export function NoMatchArt() {
  return (
    <KnightPlate
      glow="radial-gradient(circle, var(--color-fg) 0%, transparent 70%)"
      badge={
        <Badge className="bg-surface-3">
          <Search className="text-muted size-4" strokeWidth={2.5} />
        </Badge>
      }
    />
  );
}
