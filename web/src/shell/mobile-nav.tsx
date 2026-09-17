import { Ellipsis, House } from 'lucide-react';
import { cn } from '@/lib/utils';
import { atRoute, navigate, sectionHref, type Section } from '@/lib/router';
import { scrollPageToTop } from '@/lib/scroll';
import { useTabScrub } from '@/hooks/use-tab-scrub';
import { MOBILE_BAR_SLOT_ID, useMobileBarClaimed } from '@/components/mobile-action-bar';
import { t } from '@/lib/i18n';
import { MORE_SECTIONS, NAV, openSection } from '@/shell/shared';

/** The phone bottom row: global tabs, or a page's contextual action bar
    when one is claimed (see MobileActionBar). The slot is always mounted so
    a page's portal has a target; it only shows while claimed. */

export function MobileBottom({ active }: { active: Section }) {
  const claimed = useMobileBarClaimed();
  return (
    <>
      <div
        id={MOBILE_BAR_SLOT_ID}
        className={cn(
          // Opaque, not bg-card/85 over backdrop-blur-xl: a 24px blur
          // across a full-width strip was re-blurred on every scrolled
          // frame beneath it, on the phones that can least afford it.
          'bg-card border-border flex items-stretch border-t md:hidden',
          'pb-[env(safe-area-inset-bottom)] keyboard:hidden',
          !claimed && 'hidden',
        )}
      />
      {!claimed && <MobileNav active={active} />}
    </>
  );
}

/**
 * The phone's tab bar: Home, three collections and More. Five tabs is
 * where the platform guidance stops and the count lichess ships. The
 * current tab wears the pill the sidebar's current row wears, a muted
 * fill with a primary/30 inset ring behind the icon, so the two
 * navigations speak one vocabulary, and its label goes semibold with it.
 *
 * The pill is 28px tall in a 56px track and the vertical padding came
 * down from 8px to 4px to pay for it: py-1 + 28 + gap-1 + a 16px label
 * line is 56px against 54.4px before. Within 2px, which is what keeps
 * the Fab, the toast offset (both 4.5rem up) and the board shells'
 * bottom padding where they were.
 */
function MobileNav({ active }: { active: Section }) {
  const inMore = active === 'more' || MORE_SECTIONS.some((m) => m.section === active);
  // Desktop reaches home through the sidebar's logo; the bottom bar needs
  // its own entry or a phone can never get back to the landing page.
  const sections = [
    { section: 'home' as Section, label: 'Home', icon: House },
    ...NAV.filter(({ section }) => !MORE_SECTIONS.some((m) => m.section === section)),
  ];

  /** The bar, one entry per slot, More last. One list rather than the four
      tabs and a separate More call: the pill's geometry, the slot a scrub
      lands in and the button rendered there all have to be counting the
      same things. */
  const slots = [
    ...sections.map(({ section, label, icon }) => ({
      key: section,
      label,
      icon,
      on: section === active,
      // Phones: the Puzzles tab lands on the hub, a launcher whose
      // buttons sit on the bottom edge where a thumb already is.
      // It landed on the dashboard until that page's own shortcuts
      // had to be read at the top of a screen of statistics to get
      // anywhere — a page consulted now and then, opened every time
      // anyone reached for training.
      go: () => {
        const root = section === 'puzzles' ? sectionHref('puzzles', 'hub') : sectionHref(section);
        // Already here: the second tap goes back to the top of the
        // page, which is what a tab bar's current tab does on both
        // platforms. `navigate` would do nothing on the same hash. From
        // a leaf of this section it goes up to the root, and from another
        // section it returns to where this one was (openSection).
        if (atRoute(root)) scrollPageToTop();
        else if (section === 'puzzles') openSection('puzzles', active, 'hub');
        else openSection(section, active);
      },
    })),
    {
      key: 'more',
      label: 'More',
      icon: Ellipsis,
      on: inMore,
      go: () => (atRoute(sectionHref('more')) ? scrollPageToTop() : navigate('more')),
    },
  ];

  // Where the pill sits: the current tab's index, More being the fifth.
  const activeIndex = Math.max(0, slots.findIndex(({ on }) => on));

  // Drag along the bar to pick a tab. The tap is untouched: a gesture that
  // never turns horizontal is never claimed, and the button's own click
  // runs `go` exactly as before.
  const scrub = useTabScrub({ count: slots.length, onPick: (i) => slots[i]?.go() });
  /** Which tab looks current. The finger's while it is down, so the bar
      answers before the page can; `aria-current` below stays on the page
      the app is actually still on. */
  const lit = scrub.at ?? activeIndex;

  const tab = (
    key: string,
    label: string,
    Icon: typeof House,
    isActive: boolean,
    isCurrent: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn(
        // min-h-11: the bar's own coarse-pointer floor (DESIGN.md, Buttons).
        'flex min-h-11 flex-1 flex-col items-center justify-center gap-1 py-1 text-xs font-medium',
        'transition-colors duration-150',
        isActive ? 'text-primary font-semibold' : 'text-muted-foreground',
      )}
    >
      {/* The pill's footprint; the pill itself is the sliding element
          above, drawn once for the bar. */}
      <span className="relative grid h-7 w-14 place-items-center rounded-full">
        <Icon className="size-[1.15rem]" strokeWidth={isActive ? 2.4 : 2} />
      </span>
      {/* Six labels overprinted under 320px (a 390 phone zoomed to 200%)
          and went screen-reader-only there; five fit at 320 with 20px to
          spare on the widest, so the name stays on screen at every width. */}
      <span>{t(label)}</span>
    </button>
  );

  return (
    <nav
      // "Sections", not "Page controls": that label belongs to the slot a
      // page fills with its own controls, and a screen reader landing on
      // Home heard the app's navigation announced as controls of a page
      // it does not control.
      aria-label={t('Sections')}
      className={cn(
        // Opaque for the same reason as the page-control slot above.
        // border-border, not the card ring: the ring is transparent on the
        // toned page, and a bar with no edge merged into a page whose
        // bottom was the same white, so the hairline is drawn at rest
        // (lanph3re's call, 2026-09-13). The slot above matches.
        'bg-card border-border relative flex shrink-0 items-stretch border-t md:hidden',
        // Clear the iOS home indicator.
        'pb-[env(safe-area-inset-bottom)]',
        // Gone while the keyboard is up. The shell now ends at the top of
        // the keyboard, so a bar pinned to the shell's bottom edge would
        // sit on the keys — which is exactly how the last attempt at this
        // failed. Nothing on a phone asks for typing except a sheet, and a
        // sheet covers the bar anyway.
        'keyboard:hidden',
        // The bar handles its own sideways gesture (hooks/use-tab-scrub).
        // Nothing here scrolls or zooms, so this costs the bar nothing and
        // saves the scrub from arguing with the page under it.
        'touch-none',
      )}
      {...scrub.bar}
    >
      {/* The one pill, behind whichever tab is current, sliding between
          them over the pane-turn duration. Each tab used to draw its own
          and the mark jumped; one element that moves is what Material 3
          and every 2025 tab bar do. Its geometry is the tab's: five equal
          tabs, so the pill's centre is (i + ½) fifths of the bar, and it
          sits 4px down (the tab's py-1) at the icon's height. */}
      <span
        aria-hidden
        data-nav-pill
        className="bg-nav-pill pointer-events-none absolute top-1 h-7 w-14 rounded-full transition-[left] duration-(--pane-turn) ease-(--pane-turn-ease)"
        // Its resting place is the current tab's slot; while a finger is
        // scrubbing the bar (hooks/use-tab-scrub) the bar carries the
        // override and the pill is wherever the finger is. A custom
        // property rather than this style prop, so a render that lands
        // mid-gesture cannot fight the finger for it.
        style={{
          left: `var(--nav-pill-left, calc(${(activeIndex + 0.5) * (100 / slots.length)}% - 1.75rem))`,
        }}
      />
      {slots.map(({ key, label, icon, on, go }, i) =>
        tab(key, label, icon, i === lit, on, () => {
          // The click behind a scrub would run the slot the finger STARTED
          // on; the scrub has already run the one it ended on.
          if (scrub.scrubbed()) return;
          go();
        }),
      )}
    </nav>
  );
}
