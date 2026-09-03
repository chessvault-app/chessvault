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
    <Tabs
      value={value}
      onValueChange={(id) => onChange(id as T)}
      className="contents"
      // The one child of a pane column that stays put while a swipe turns
      // the panes under it (hooks/use-pane-swipe): the strip is what says
      // which pane is open, so it is the thing the turn is read against,
      // not part of what turns.
      data-pane-strip
    >
      {/* OUT OF SCOPE FOR AUDITS AND CRITIQUES. This strip is 32px on a
          coarse pointer, under the app's 36px floor, by decision
          (lanph3re, 2026-09-03): it is the one row that stands between
          the board and the pane on every phone page, and the 42px the
          floor produced was measured as height taken from the pane it
          switches. The tabs are a third of the screen wide, so the
          target was never short of room. Do not raise it, do not flag
          it; CLAUDE.md and DESIGN.md both name this exception. */}
      <TabsList
        className={cn('w-auto pointer-coarse:group-data-horizontal/tabs:h-8', className)}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              aria-label={t(tab.label)}
              title={t(tab.label)}
              // An icon tab is its icon plus 4px, and no fixed height at
              // all: these tabs are a third of the screen wide, so the
              // target was never short of room; it was short of it
              // vertically, in the panel underneath. Text tabs keep their
              // height: a label needs the line box a glyph does not.
              //
              // The pill fills on the pane's clock, because a swipe moves
              // both and they are one motion. The registry's `transition-all`
              // already ended within a frame of the pane — what read as the
              // strip lagging was the CURVE: the pane's ease-out is 60% home
              // by 80ms while the default easing had the pill 17% filled, so
              // the tab still looked like the old one under the new panel.
              // Same duration and same easing here; measured in
              // index.css beside the rule that moves the pane.
              className={cn(
                'duration-(--pane-turn) ease-(--pane-turn-ease) pointer-coarse:h-[calc(100%-1px)]',
                Icon && 'py-1',
              )}
            >
              {Icon ? <Icon className="size-3.5" /> : t(tab.label)}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
