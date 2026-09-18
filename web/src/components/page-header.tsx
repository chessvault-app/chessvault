import { ChevronLeft, Search, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { searchRowClass } from '@/components/text-fields';
import { useScrollReveal } from '@/hooks/use-scroll-reveal';
import { useMediaQuery } from '@/lib/media';
import { scrollParent } from '@/lib/scroll';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The page title's two rungs, exported because the skeleton that stands
 * in for a header while Settings loads draws the same title and had them
 * written out a second time. A rung copied is a rung that moves once.
 * 20px on a desktop, the phone's 24px large title under `md`; see the
 * component's own note below and DESIGN.md, Typography.
 */
export const pageTitleClass = 'text-2xl font-semibold tracking-tight md:text-xl';

/**
 * The heading every scrolling page starts with: the page's name, its
 * actions pushed to the right, and, where a phone reaches the page through
 * More rather than the sidebar, a back chevron that a desktop never shows.
 *
 * One name, two rungs. On a desktop the title is `text-xl` on one line
 * with the actions. On a phone it is a large title, `text-2xl` in a 44px
 * row, and the row scrolls away with the page like any other row. It
 * was a sticky bar for two releases (the iOS large title that shrinks
 * into the top bar as you scroll, Material 3's medium app bar): it took
 * the page's background, scaled the name to two thirds and drew a
 * hairline once the page had scrolled under it. Taken out at
 * lanph3re's call: on a phone the bar cost 44px of every scrolled list
 * to keep a name on screen that the tab bar under the thumb already
 * gives, and the shrink was one more thing moving while a list was
 * being read. A page's actions live on the title's row still, so they
 * scroll away with it, the create button included since the floating
 * disc went (see CreateControl); what a page needs from anywhere in its
 * list is a row's own ⋯, which is on the row.
 *
 * This component returns SIBLINGS rather than one box: the header, then
 * a `subtitle` (the count line, tight under the title), a `description`
 * (the explanatory paragraph), and the `search` row, each spaced by the
 * column's own gap. That shape was forced by the bar (`sticky` holds an
 * element inside its parent's box) and is kept because every page is
 * written against it.
 *
 * `subtitle` is what a page has (12 studies); `description` is what a
 * page is for. A `search` is the page's find-or-filter field, full width
 * on a phone and capped at `max-w-sm` on a desktop, on a row of its own
 * one shell gap under the heading, where every other page's first row
 * sits. It was the same two rows written out by hand on five pages before
 * it was a prop.
 *
 * `pinned` adds the bar the large title turns into once it has scrolled
 * away: a compact row (chevron, the name at text-base, the same actions)
 * in the card's fill over a rule, pinned to the top of the scroller and
 * shown ONLY on a scroll up (hooks/use-scroll-reveal). The list keeps the
 * whole screen while it is read down, and the controls are one flick
 * back, which is the platform's own shape for a long list and what the
 * note page does with its header. The shelves take it (lanph3re,
 * 2026-09-18). It is drawn as a second row rather than by pinning the
 * large title, so nothing in the flow moves: the wrapper is a zero-height
 * sticky box (its -mb-4 cancels the column gap a zero box still costs)
 * and the bar hangs out of it, translated off the top while hidden. The
 * bar is inert while it is off screen, so its copies of the actions are
 * not a second set of tab stops.
 */
export function PageHeader({
  title,
  back,
  backVisible = 'phone',
  truncate = false,
  subtitle,
  description,
  meta,
  actions,
  search,
  pinned = false,
  pinnedActions,
  pinnedBelow,
  titleRow,
  searchCollapse,
  className,
}: {
  title: string;
  /** Where the phone's back chevron goes; omit on top-level pages. */
  back?: () => void;
  /**
   * `always` on a leaf the sidebar cannot name — one book, one document —
   * where a desktop needs the chevron too; `phone` (the default) for the
   * pages the sidebar reaches, where a desktop never shows it.
   */
  backVisible?: 'phone' | 'always';
  /** A title that is a user's own name for something and may run long:
      one line, cut with an ellipsis, rather than wrapping the row. */
  truncate?: boolean;
  /** The count line under the title: how much the page holds. */
  subtitle?: ReactNode;
  /** The paragraph under the title: what the page is for. */
  description?: ReactNode;
  /**
   * Quiet status that belongs BESIDE the name rather than under it —
   * which scope is open, whether it has saved. A description explains
   * the page and gets its own line; this qualifies the title and sits on
   * the title's own baseline.
   */
  meta?: ReactNode;
  actions?: ReactNode;
  /** The page's search or filter field. The row's first child; see searchRowClass. */
  search?: ReactNode;
  /** A compact copy of the title row, pinned and shown on a scroll up. */
  pinned?: boolean;
  /**
   * What the bar draws in place of `actions`, for a page whose actions
   * cannot be drawn twice: the Games page's are portal targets
   * (games/header-slots), and a second copy would take the first one's
   * ref. `actions` when omitted.
   */
  pinnedActions?: ReactNode;
  /** A second line inside the bar, under the title row (the Games
      page's source chips). */
  pinnedBelow?: ReactNode;
  /**
   * What the title row holds INSTEAD of the name and its actions, while
   * given: a search field that takes the row over rather than adding one
   * under it (the Games page on a phone). The row keeps its height and
   * its place, so nothing below it moves.
   */
  titleRow?: ReactNode;
  /**
   * On a phone, fold the `search` row into the title row: at rest a
   * magnifier stands first among the actions and there is no search row;
   * pressed, the title row IS the field, with an X that empties it and
   * gives the name back. The shape the Games page settled on a phone
   * (games/header-slots says why a field that opens as a row is still a
   * row), here for every page that hands this header a `search`
   * (lanph3re, 2026-09-19). From md the row stands where it always did.
   *
   * The page still owns the query, so it says three things: what the
   * magnifier is called (the field's own placeholder), whether a query is
   * standing (the field then stays open, so a narrowed list is never
   * narrowed invisibly, as when a kept page comes back), and how to
   * empty it.
   */
  searchCollapse?: { label: string; active: boolean; onClear: () => void };
  className?: string;
}) {
  const pinRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const phone = useMediaQuery('(max-width: 47.9375rem)');
  const folds = Boolean(search && searchCollapse && phone);
  const [searchOpen, setSearchOpen] = useState(false);
  const fieldShown = folds && (searchOpen || searchCollapse!.active);
  // Focused inside the press: iOS raises the keyboard only for a focus made
  // during the gesture, so the row swap is committed under flushSync and
  // the field that now exists is focused before the handler returns. From
  // the compact bar the page goes up to meet it first.
  const openSearch = (): void => {
    if (pinRef.current) scrollParent(pinRef.current)?.scrollTo({ top: 0 });
    flushSync(() => setSearchOpen(true));
    headerRef.current?.querySelector('input')?.focus();
  };
  const magnifier = folds ? (
    <Button variant="secondary" size="icon-sm" title={searchCollapse!.label} className="shrink-0" onClick={openSearch}>
      <Search className="glyph" />
    </Button>
  ) : null;
  const ownTitleRow = fieldShown ? (
    <div
      className="group/title-search flex min-w-0 flex-1 items-center gap-2"
      // Left empty, the row gives the title back. That is what the app's
      // search field's own Cancel does to it (empties it and blurs,
      // components/text-fields), and what tapping away from a field
      // nothing was typed into means. Read off the DOM a task later: at
      // the blur itself the page's query has not caught up with Cancel.
      onBlur={(e) => {
        const box = e.currentTarget;
        setTimeout(() => {
          if (!box.isConnected || box.contains(document.activeElement)) return;
          if ((box.querySelector('input')?.value ?? '') === '') setSearchOpen(false);
        }, 0);
      }}
    >
      {/* The field fills the row whatever width its page gave it. */}
      <div className="min-w-0 flex-1 [&>*]:w-full">{search}</div>
      {/* The way out while the field is NOT focused (a query standing,
          the keyboard put away). Focused, the field shows its own Cancel
          in this very spot, and two ways out side by side was one too
          many (photographed). */}
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Close')}
        className="shrink-0 group-has-[input:focus]/title-search:hidden"
        onClick={() => {
          searchCollapse!.onClear();
          setSearchOpen(false);
        }}
      >
        <X className="glyph" />
      </Button>
    </div>
  ) : undefined;
  const row = titleRow ?? ownTitleRow;
  const { scrolled, hidden } = useScrollReveal(pinRef, pinned);
  const barShown = pinned && scrolled && !hidden;
  return (
    <>
      {pinned && (
        <div
          ref={pinRef}
          // At the column's very top, above its padding, so the bar
          // translated off by its own height is wholly off: hung at the
          // padding's foot its last 32px showed at rest. The top margin
          // cancels PageShell's padding and the bottom margin puts the
          // header back where it was (padding less the column's gap).
          className="sticky top-0 z-30 -mx-4 -mt-[calc(1rem+var(--page-t))] mb-(--page-t) h-0 md:-mx-6 md:-mt-6 md:mb-2"
          aria-hidden={!barShown}
          inert={!barShown}
        >
          <div
            data-chrome=""
            className={cn(
              'bg-card border-card-ring flex flex-col gap-2 border-b px-4 pb-2 md:px-6',
              // iOS: glass over the list scrolling under it (utilities.css,
              // `glass`, on the capsule's terms: bg-card is what it falls
              // back to). The title is foreground ink, which clears the
              // 4.5:1 the capsule's muted label was measured to clear. No
              // rim: the bar runs to the screen's edges, and a rim drew a
              // line down the left edge and along its foot.
              'ios:glass ios:[--glass-edge-w:0px]',
              // The phone's status-bar inset is the bar's own, as the
              // note header's is: its fill runs up behind the status bar.
              'pt-[calc(0.5rem+var(--page-t))]',
              // visibility rides the transition: it stays visible for
              // the slide out and flips at its end, so a bar that is off
              // is also not there for a hit test.
              'transition-[transform,visibility] duration-(--pane-turn) ease-(--pane-turn-ease)',
              barShown ? 'translate-y-0' : 'invisible -translate-y-full',
            )}
          >
            <div className="flex items-center gap-2">
              {back && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={backVisible === 'phone' ? 'md:hidden' : undefined}
                  title={t('Back')}
                  onClick={back}
                >
                  <ChevronLeft className="glyph" />
                </Button>
              )}
              <span className="min-w-0 flex-1 truncate text-base font-semibold">{title}</span>
              {(magnifier || (pinnedActions ?? actions)) && (
                <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
                  {magnifier}
                  {pinnedActions ?? actions}
                </div>
              )}
            </div>
            {pinnedBelow}
          </div>
        </div>
      )}
      <header
        ref={headerRef}
        // data-ground: a page's chrome stands on the page, not in a card
        // (docs/design-principles.md), and the muted and secondary fills
        // step a rung up under it (index.css, `[data-ground]`). The search
        // row below takes it too.
        data-ground=""
        data-chrome=""
        className={cn(
          'flex items-center gap-x-3 gap-y-2',
          truncate ? 'flex-nowrap' : 'flex-wrap',
          // The phone's row: 44px, the coarse-pointer floor for a row of
          // controls.
          'max-md:min-h-11',
          className,
        )}
      >
        {row ? (
          <>
            {/* The page keeps its heading while the row is a field. */}
            <h1 className="sr-only">{title}</h1>
            {row}
          </>
        ) : (
          <>
            {back && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={backVisible === 'phone' ? 'md:hidden' : undefined}
                title={t('Back')}
                onClick={back}
              >
                <ChevronLeft className="glyph" />
              </Button>
            )}
            <h1
              className={cn(
                pageTitleClass,
                truncate && 'min-w-0 flex-1 truncate',
              )}
            >
              {title}
            </h1>
            {meta}
            {(magnifier || actions) && (
              <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
                {magnifier}
                {actions}
              </div>
            )}
          </>
        )}
      </header>
      {/* Tight under the title: the column's gap less 12px is 4px. */}
      {subtitle && <p className="text-muted-foreground -mt-3 text-sm">{subtitle}</p>}
      {/* And 8px for the paragraph, the titled block's old gap-2. */}
      {description && (
        <p className="text-muted-foreground -mt-2 text-sm leading-relaxed">{description}</p>
      )}
      {search && !folds && (
        <div data-ground="" className={cn('flex items-center gap-2 md:[&>:first-child]:max-w-sm', searchRowClass)}>
          {search}
        </div>
      )}
    </>
  );
}
