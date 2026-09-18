import type { Ref } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export type MainTab = 'databases' | 'collection' | 'chesscom' | 'lichess';
export const TABS: { id: MainTab; label: string }[] = [
  { id: 'collection', label: 'Collection' },
  { id: 'databases', label: 'Databases' },
  // Site names, not sentences — they stay untranslated on purpose.
  // Capitalised like its neighbours: a lowercase word in a row of
  // capitalised tabs read as a typo, not as branding.
  { id: 'chesscom', label: 'Chess.com' },
  { id: 'lichess', label: 'Lichess' },
];

/**
 * The games browser's tab strip: the four places a game can come from.
 *
 * Its own file so the browser and the browser's OUTLINE can both draw
 * it (games/GamesView.skeleton). The strip is the one part of the page
 * that is knowable before anything is fetched — four fixed labels at a
 * fixed height — and a page that draws its name and nothing else, where
 * the reader is about to see a strip and a search field, is a page
 * pretending it knows less than it does. Copying forty lines of measured
 * class names into the outline instead is the drift this whole shape
 * exists to stop.
 */
export function GamesTabStrip({
  value,
  onValueChange,
  frame,
  stripRef,
  flush = false,
}: {
  value: MainTab;
  onValueChange: (tab: MainTab) => void;
  frame: 'panel' | 'page';
  /** The browser measures this to decide whether its toolbar folds. */
  stripRef?: Ref<HTMLDivElement>;
  /** No air under the chips: the copy inside the page's compact bar,
      whose own padding ends it. */
  flush?: boolean;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onValueChange(v as MainTab)} className="contents">
      {/* The SCROLLER is a wrapper, never the list itself. Four
          labels just fit a 375px phone in Korean and brush the
          edge in English, so the strip must scroll sideways —
          but the registry's line tabs draw their 40px triggers
          and the active underline OVERFLOWING the list's own
          32px box, and a list turned scroll container clipped
          them (first symptom: the underline vanished under the
          new scrollbar; hidden bar, it was still losing its
          lower pixels to the clip). box-content h-10: the
          wrapper's CONTENT box matches the triggers exactly, so
          nothing is clipped and the underline ends flush on the
          border. */}
      {/* On a phone's page the four sources are chips, not an underlined
          strip over a rule (lanph3re, 2026-09-19). The page had four rows
          of chrome standing before the first game, and the strip was the
          heaviest of them: a full-width rule with a thick underline is a
          second header under the header. Chips are the same four presses
          at the weight of a filter, which is what choosing a source is,
          and they are the control the puzzle themes already use. Still
          tabs to a screen reader and the keyboard: only the paint
          changes, under `max-md`, and only on the page frame (the panel
          frame is the workspace's, which a phone never draws). The `!`
          on the selected fill is for the line variant's own
          `aria-selected:bg-transparent`, which is written through a group
          selector and outranks a plain utility. */}
      <div
        ref={stripRef}
        className={cn(
          'border-border scrollbar-hidden box-content flex h-10 shrink-0 items-center overflow-x-auto overflow-y-hidden border-b',
          frame === 'page' && 'max-md:h-9 max-md:border-b-0',
          // 12px between the chips and the first row's hairline. With no
          // toolbar between them any more the rule sat 1px under the
          // chips' own edge and the two read as one broken shape
          // (lanph3re, 2026-09-19).
          frame === 'page' && !flush && 'max-md:mb-3',
        )}
      >
        <TabsList
          variant="line"
          aria-label={t('What the pane is showing')}
          className={cn(
            'flex w-max min-w-full items-center justify-start gap-1 rounded-none border-0 bg-transparent p-0',
            frame === 'page' && 'max-md:gap-1.5',
            // In a card the first label steps in from the card's
            // edge; on a page the first trigger's underline starts
            // where the title and the search field do.
            frame === 'panel' ? 'px-2' : 'px-0',
          )}
        >
          {TABS.map(({ id, label }) => (
            <TabsTrigger
              key={id}
              value={id}
              // after:bottom-0, not the -bottom-px the other
              // line tabs use: inside the scrolling wrapper the
              // underline cannot overlap the border without
              // being clipped, so it sits ON the rule instead
              // of thickening it — the same 2px to the eye.
              className={cn(
                'h-10 min-w-0 flex-none rounded-none px-1.5 font-semibold group-data-horizontal/tabs:after:bottom-0',
                frame === 'page' &&
                  'max-md:border-input max-md:text-muted-foreground max-md:aria-selected:text-foreground max-md:aria-selected:bg-accent! max-md:h-9 max-md:rounded-full max-md:border max-md:px-3 max-md:font-medium max-md:after:hidden',
              )}
            >
              <span className="truncate">{t(label)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}
