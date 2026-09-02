import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';
import { separatorKey } from '@/components/separator-keys';

/**
 * A side pane with a drag grip on its right edge, remembering its width.
 *
 * First written for the puzzle corrector's source pane — the book's scan
 * beside the board being fixed — and lifted out when the book reader
 * needed the same thing for a PDF beside a board. The width is stored per
 * `storageKey`, so each use remembers its own; the default is removed
 * from storage rather than written, so a pane nobody has dragged follows
 * a later change of default.
 *
 * `maxWidth` is the most the pane may take of the row it shares — a width
 * dragged out on a big monitor must not squeeze the other side off a
 * smaller one. The STORED width survives untouched, so the big monitor
 * gets it back. Children receive the width actually on screen.
 */
export function ResizablePane({
  storageKey,
  defaultWidth,
  maxWidth,
  minWidth = 280,
  hardMax = 820,
  className,
  children,
}: {
  storageKey: string;
  defaultWidth: number;
  maxWidth?: number;
  minWidth?: number;
  /** The widest a drag may go, before `maxWidth` and the window's share. */
  hardMax?: number;
  /** Classes for the pane element itself (the aside). */
  className?: string;
  children: (shown: number) => ReactNode;
}) {
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0 ? stored : defaultWidth;
  });
  const shown = Math.max(minWidth, Math.min(width, maxWidth ?? width));
  const drag = useRef<{ x: number; w: number } | null>(null);
  // The widest a drag OR a key may take the pane, read at the moment of
  // the gesture (the window's share moves with the window).
  const dragMax = (): number => Math.min(hardMax, maxWidth ?? Infinity, window.innerWidth * 0.55);
  useEffect(() => {
    if (width === defaultWidth) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, String(Math.round(width)));
  }, [width, defaultWidth, storageKey]);
  return (
    <div className="flex min-h-0 shrink-0">
      {/* Named for the landmark list: both uses hold the book's own pages. */}
      <aside aria-label={t('Book pages')} className={className} style={{ width: shown }}>
        {children(shown)}
      </aside>
      <TitleTip title={t('Drag to resize · double-click to reset')}>
        <div
          // A separator the keyboard can reach: the ARIA role for a
          // focusable divider, valued in the pixels it stands at. The
          // orientation is the DIVIDER's (a vertical line between two
          // columns), which is why it answers Left and Right.
          role="separator"
          aria-orientation="vertical"
          aria-label={t('Resize pane')}
          aria-valuenow={Math.round(shown)}
          aria-valuemin={minWidth}
          aria-valuemax={Math.round(Math.min(hardMax, maxWidth ?? hardMax))}
          tabIndex={0}
          onKeyDown={(e) => {
            const action = separatorKey(e, 'vertical', shown, minWidth, dragMax());
            if (!action) return;
            // Handled here and nowhere else: the board's arrow keys listen
            // on the window and would step the game under a resize.
            e.preventDefault();
            e.stopPropagation();
            drag.current = null;
            setWidth(action.kind === 'reset' ? defaultWidth : action.to);
          }}
          onDoubleClick={() => {
            drag.current = null;
            setWidth(defaultWidth);
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            // From the width on SCREEN, not the stored one — dragging a
            // clamped pane must not jump to where the big monitor left it.
            drag.current = { x: e.clientX, w: shown };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current || (e.buttons & 1) === 0) return;
            const next = drag.current.w + e.clientX - drag.current.x;
            setWidth(Math.min(Math.max(next, minWidth), dragMax()));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          className={cn(
            'border-border/60 hover:bg-accent flex w-2.5 shrink-0 touch-none',
            'cursor-col-resize items-center justify-center border-l transition-colors',
            // The one focus ring, drawn the way every control draws it.
            'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        >
          {/* The grip, centred on the divider line — same idiom as the
              panels' bottom-edge resize. */}
          <div className="bg-border h-8 w-[3px] rounded-full" />
        </div>
      </TitleTip>
    </div>
  );
}
