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
}: {
  value: MainTab;
  onValueChange: (tab: MainTab) => void;
  frame: 'panel' | 'page';
  /** The browser measures this to decide whether its toolbar folds. */
  stripRef?: Ref<HTMLDivElement>;
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
      <div
        ref={stripRef}
        className="border-border scrollbar-hidden box-content flex h-10 shrink-0 items-center overflow-x-auto overflow-y-hidden border-b"
      >
        <TabsList
          variant="line"
          aria-label={t('What the pane is showing')}
          className={cn(
            'flex w-max min-w-full items-center justify-start gap-1 rounded-none border-0 bg-transparent p-0',
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
              className="h-10 min-w-0 flex-none rounded-none px-1.5 font-semibold group-data-horizontal/tabs:after:bottom-0"
            >
              <span className="truncate">{t(label)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </Tabs>
  );
}
