import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

export interface PaneTab<T extends string> {
  id: T;
  label: string;
  /** When set, the tab shows this icon instead of its text — a thin row of
      icons costs far less vertical space on a phone than a row of labels. */
  icon?: LucideIcon;
}

/**
 * Small-screen pane switcher: on phones there is no room to stack every
 * panel under the board (see the lichess app), so exactly one shows at a
 * time. Desktop layouts never render this.
 */
export function PaneTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: PaneTab<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        // p-px, not p-0.5: this row sits between a board and the panel
        // under it on the one screen with no vertical room to spare, and
        // the track's inset is only there to show the active pill sitting
        // inside it — one pixel does that as well as two.
        'bg-surface-2 border-line flex shrink-0 gap-0.5 rounded-lg border p-px',
        className,
      )}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === value}
            aria-label={t(tab.label)}
            title={t(tab.label)}
            onClick={() => onChange(tab.id)}
            className={cn(
              // The active pill's corners are the track's, less the 1px
              // border and the 1px inset it sits inside — which is what
              // concentric means, and what `rounded-md` was not: this
              // theme's --radius-lg is 14px while md is 6px, so the
              // track curved more than twice as hard as the pill in
              // it. Unnoticeable while the row was 42px tall and
              // the corners were a small part of it; at 26px the track is
              // short enough to round into a capsule and the square-ish
              // pill inside it is the first thing you see. Derived from
              // the token rather than typed as 12px, so it stays true if
              // the scale moves.
              'flex flex-1 items-center justify-center whitespace-nowrap rounded-[calc(var(--radius-lg)_-_2px)] font-medium transition-colors duration-100',
              // An icon tab is its icon plus 4px, and no fixed height at
              // all. It used to be h-9 on a coarse pointer — the height a
              // standalone button gets for a thumb — which put 11px of air
              // above and below a 14px glyph on the one screen where the
              // board, this row and a panel are stacked together. These
              // tabs are a third of the screen wide, so the target was
              // never short of room; it was short of it vertically, in the
              // panel underneath. Padding rather than a height so the row
              // stays exactly its content plus the margin it needs to read
              // as a button, whatever size the glyph becomes.
              //
              // Text tabs are the book pages, not the board ones, and keep
              // their height: a label needs the line box a glyph does not.
              Icon ? 'py-1' : 'h-7 text-sm pointer-coarse:h-8',
              tab.id === value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : t(tab.label)}
          </button>
        );
      })}
    </div>
  );
}
