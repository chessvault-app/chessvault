import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
 *
 * shadcn's Tabs, whose list is the strip: Base UI gives it the tablist role,
 * the roving tab stop and the arrow keys. The root is `contents` so the
 * strip itself is the box the caller lays out.
 *
 * Two faces. `pill` is the registry's segmented control, a floating
 * strip of its own; the book reader and the puzzle-book fix page use it at
 * the top of a column that has no card for it to belong to. `header` is
 * what the board pages use: the strip becomes the top of the pane card
 * under it, drawn in the card's own surface and ring, with the open tab
 * marked by a line on the card's edge. A pill over a card read as two
 * unrelated floating things stacked; the header is one object. The pane
 * cards below square their top corners to meet it (index.css, "pane
 * header"), and the column's gap between the two is swallowed here, so
 * the header costs the pane less height than the pill and its gap did.
 *
 * The line under the open tab is also how a swipe shows itself: the hook
 * (hooks/use-pane-swipe) leaves `--pane-dx` on the column while a finger
 * holds the panes, and the line follows it, a tab's width per pane, so the
 * marker travels with the thumb and lands where the panes do. The pill
 * face has nothing to move and just fills on the pane's clock.
 */
export function PaneTabs<T extends string>({
  tabs,
  value,
  onChange,
  variant = 'pill',
  className,
}: {
  tabs: PaneTab<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: 'pill' | 'header';
  className?: string;
}) {
  const header = variant === 'header';
  const at = Math.max(0, tabs.findIndex((tab) => tab.id === value));
  return (
    <Tabs
      value={value}
      onValueChange={(id) => onChange(id as T)}
      className="contents"
      // The one child of a pane column that stays put while a swipe turns
      // the panes under it (hooks/use-pane-swipe): the strip is what says
      // which pane is open, so it is the thing the turn is read against,
      // not part of what turns.
      data-pane-strip
      data-pane-header={header ? '' : undefined}
    >
      {/* OUT OF SCOPE FOR AUDITS AND CRITIQUES. The strip's height is by
          decision (lanph3re, 2026-09-03), not by the 36px coarse-pointer
          floor: it is the one row standing between the board and the
          pane on every phone page, and every pixel it grows comes off
          the pane it switches; its tabs are a third of the screen wide,
          so the target was never short of room. The pill keeps the
          registry's 32px on every pointer. The header is 40px and stands
          in for the 12px gap the pill stood above as well, so the pane
          under it is 4px taller than it was under the pill. Do not raise
          either, do not flag them; CLAUDE.md and DESIGN.md both name
          this exception. */}
      <TabsList
        variant={header ? 'line' : 'default'}
        // The height is inline, not a class: the registry's own coarse
        // rule (pointer-coarse:…:h-auto) shares a variant with any class
        // that would restate it, and which of two equals wins is the
        // order they were emitted in, which the registry owns. Measured
        // as a different strip height from one page to the next before
        // this was inline. The corners likewise: the line variant says
        // rounded-none on the same variant, so the top rounding is said
        // on that variant too.
        style={header ? { height: '2.5rem' } : undefined}
        className={cn(
          header
            ? [
                'relative z-10 flex w-full shrink-0 gap-0 p-0',
                'data-[variant=line]:rounded-t-xl data-[variant=line]:rounded-b-none',
                'bg-card text-card-foreground ring-1 ring-border',
                // Over the column's gap and 1px of the card below, so the
                // header's ring draws the seam once and the card's top ring
                // is under it rather than beside it.
                '-mb-[calc(0.75rem+1px)] stacked:-mb-[calc(0.5rem+1px)]',
              ]
            : 'w-auto pointer-coarse:group-data-horizontal/tabs:h-8',
          className,
        )}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              aria-label={t(tab.label)}
              title={t(tab.label)}
              // Inline for the same reason as the list's height above.
              style={header ? { height: '100%' } : undefined}
              // An icon tab is its icon plus 4px, and no fixed height at
              // all: these tabs are a third of the screen wide, so the
              // target was never short of room; it was short of it
              // vertically, in the panel underneath. Text tabs keep their
              // height: a label needs the line box a glyph does not.
              //
              // The pill fills on the pane's clock, because a swipe moves
              // both and they are one motion. The registry's `transition-all`
              // already ended within a frame of the pane — what read as the
              // strip lagging was the CURVE: the pane's ease-out is 60%
              // home by 80ms while the default easing had the pill 17%
              // filled, so the tab still looked like the old one under the
              // new panel. Same duration and same easing here; measured in
              // index.css beside the rule that moves the pane.
              className={cn(
                'duration-(--pane-turn) ease-(--pane-turn-ease) pointer-coarse:h-[calc(100%-1px)]',
                Icon && 'py-1',
                // The header draws its own line (below), one that moves.
                header && 'rounded-none after:hidden',
              )}
            >
              {Icon ? <Icon className="size-3.5" /> : t(tab.label)}
            </TabsTrigger>
          );
        })}
        {header && (
          <span
            aria-hidden
            data-pane-indicator
            className="bg-foreground absolute bottom-0 h-0.5 rounded-full"
            style={{
              width: `${100 / tabs.length}%`,
              left: `${(at * 100) / tabs.length}%`,
              // Dragging left pulls the next pane in, so the line goes
              // right: a pane's travel is a tab's width here. --pane-dx is
              // the column's, inherited; at rest it is unset and this is 0.
              transform: `translateX(calc(var(--pane-dx, 0px) / -${tabs.length}))`,
            }}
          />
        )}
      </TabsList>
    </Tabs>
  );
}
