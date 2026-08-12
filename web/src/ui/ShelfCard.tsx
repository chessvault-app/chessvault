import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { ActionSheet, type SheetAction } from './ActionSheet';
import { SwipeTrack, useSwipeAway } from './SwipeRow';
import { t } from '@/lib/i18n';

/**
 * One card on a shelf: a study, a note.
 *
 * The two shelves had the same card written twice — the same frame, the
 * same swipe, the same ⋯, the same three actions — and they had already
 * drifted (one folder header could be renamed, the other could not). What
 * differs between a study and a note is what its actions DO, so that is
 * what stays with the caller; everything about how a card looks and how it
 * is dismissed lives here.
 */
export function ShelfCard({
  icon: Icon,
  title,
  meta,
  preview,
  error,
  menuTitle,
  actions,
  onOpen,
  onSwipeAway,
  children,
}: {
  /** A quiet mark at the left, so a card reads as a card and not a row. */
  icon: LucideIcon;
  title: string;
  /** The second line: chapters and when, or size and when. */
  meta: ReactNode;
  /** An optional third line — the note's first sentence. */
  preview?: string | null;
  error?: string | null;
  /** What the ⋯ sheet is called; the title by default. */
  menuTitle?: string;
  actions: SheetAction[];
  onOpen: () => void;
  /** Touch: swiping the card's contents left removes it (undoably). */
  onSwipeAway: () => void;
  /** The card's own dialogs — rename, move to. */
  children?: ReactNode;
}) {
  const swipe = useSwipeAway(onSwipeAway);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    // h-full through both: in a two-column grid a card with a preview line
    // sits beside one without, and cards of two heights in the same row
    // read as a broken grid rather than as two different notes.
    <li className="h-full">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onOpen();
        }}
        {...swipe.handlers}
        className={cn(
          'bg-surface border-line hover:border-line-strong group relative flex h-full cursor-pointer',
          'items-center gap-3 overflow-hidden rounded-xl border px-4 py-3',
          'shadow-[var(--shadow-panel)] transition-colors',
        )}
      >
        {/* The card stays; its contents slide off it. */}
        <SwipeTrack dx={swipe.dx} />

        <div className="flex min-w-0 flex-1 items-center gap-3" style={swipe.style}>
          <Icon className="text-subtle size-4 shrink-0" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            {/* Only the TITLE keeps clear of the ⋯, which is pinned to the
                corner rather than sharing the row. In the flex row it used
                to sit in, it took its width from every line of the card
                whether it was showing or not. */}
            <p className="text-fg truncate pr-7 text-sm font-semibold">{title}</p>
            <p className="text-subtle text-xs">{meta}</p>
            {preview && <p className="text-muted mt-0.5 truncate text-xs">{preview}</p>}
            {error && <p className="text-bad text-xs">{error}</p>}
          </div>
        </div>

        <Button
          ref={menuTrigger}
          variant="ghost"
          size="icon-sm"
          title={t('More')}
          active={menuOpen}
          style={swipe.style}
          className={cn(
            'absolute right-2 top-2 opacity-0 transition-opacity',
            'group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
            menuOpen && 'opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(true);
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>

        {menuOpen && (
          <ActionSheet
            title={menuTitle ?? title}
            anchor={menuTrigger}
            onClose={() => setMenuOpen(false)}
            actions={actions}
          />
        )}

        {children}
      </div>
    </li>
  );
}
