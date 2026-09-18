import type { CSSProperties } from 'react';
import { Ellipsis, House } from 'lucide-react';
import { cn } from '@/lib/utils';
import { atRoute, navigate, sectionHref, type Section } from '@/lib/router';
import { scrollPageToTop } from '@/lib/scroll';
import { useTabScrub } from '@/hooks/use-tab-scrub';
import { MOBILE_BAR_SLOT_ID, useMobileBarClaimed } from '@/components/mobile-action-bar';
import { useBottomBarMeasure } from '@/hooks/use-bottom-bar';
import { useBarMinimized } from '@/hooks/use-bar-minimize';
import { t } from '@/lib/i18n';
import { MORE_SECTIONS, NAV, openSection } from '@/shell/shared';

/** The phone bottom row: global tabs, or a page's contextual action bar
    when one is claimed (see MobileActionBar). The slot is always mounted so
    a page's portal has a target; it only shows while claimed.

    Both are overlays on the shell's row, pinned to its bottom edge, and
    `main` pads by their measured height (hooks/use-bottom-bar,
    styles/shell.css) rather than sharing the column with them as flex
    siblings. A page still ends where the bar begins, so nothing looks
    different at rest; what changed is that the band under the bar is now
    `main`'s, which is what lets a page's content scroll under it and the
    bar hide on a scroll without reflowing the page above, the two things
    a flex sibling could never do. */

/** Pinned to the row's bottom edge, over the page. z-20: over a page's
    own pinned bands (z-10) and under the Fab (z-30) and every window.

    On iOS the same box is the platform's capsule ("Platform-specific
    design", docs/design-principles.md): lifted off the edges and floating
    over the page, which scrolls under it (PageShell and the pages that
    scroll themselves clear its footprint, --page-b). 20px in from the
    sides, which is Apple's 21pt as near as the rem ladder goes; the lift
    is the home indicator's inset, so the capsule rests just above the
    indicator, and 20px where there is none (Safari with its own bar
    showing). A true pill, so the corner answers no radius knob; the
    window ring in place of the docked bar's top hairline, and the panel
    shadow, since the box is now a thing over the page rather than the
    page's edge. The safe-area padding comes off: the capsule floats
    above the indicator instead of reaching under it.

    And it is glass (utilities.css, `glass`): the card's fill at 85% over
    a 12px blur of the page scrolling under it. The docked bar was made
    opaque in 2026-09 because a 24px blur across a full-width strip was
    re-blurred on every scrolled frame; the capsule is 335px of a 375px
    row, blurs at half the radius, and its fill hides most of what the
    blur would show, which is the bargain the phone has to confirm: the
    on-device probe in the Settings debug card A/Bs it against the
    opaque capsule (data-glass="off"), and if frames go, the fill goes
    back to 100%. The class after `bg-card`, so the utility's fill wins
    where the gates pass and the card's fill stays where they do not. */
const OVERLAY = cn(
  'absolute inset-x-0 bottom-0 z-20',
  // The lift: Instagram's bar sits a little into the indicator's inset
  // (measured off lanph3re's screenshots, 2026-09-18: its foot about
  // 20pt off the screen's edge against a 34pt inset), so the capsule
  // stands 8px lower than the inset, and 20px where there is none.
  'ios:inset-x-6 ios:bottom-[max(1.25rem,calc(var(--safe-b)-0.5rem))] ios:rounded-full ios:border-0 ios:pb-0',
  'ios:ring-1 ios:ring-window-ring ios:shadow-md ios:glass',
  // Clearer than the text surfaces' 70% (tokens.css, --glass-fill): the
  // capsule carries icons only on iOS, and an icon is held to 3:1 where
  // a label is held to 4.5:1. The capsule's own fill is a token, one
  // number per theme (tokens.css, --glass-fill-capsule: 55% in light,
  // 65% in dark), placed where the active icon on its pill still clears
  // 3:1 over white content, the worst ground for a dark capsule.
  // lanph3re asked for clearer (2026-09-18).
  'ios:[--glass-fill:var(--glass-fill-capsule)]',
);

export function MobileBottom({ active }: { active: Section }) {
  const claimed = useMobileBarClaimed();
  const measure = useBottomBarMeasure();
  return (
    <>
      <div
        id={MOBILE_BAR_SLOT_ID}
        ref={measure}
        className={cn(
          OVERLAY,
          // Opaque as the docked bar, not bg-card/85 over backdrop-blur-xl:
          // a 24px blur across a full-width strip was re-blurred on every
          // scrolled frame beneath it, on the phones that can least
          // afford it. The iOS capsule is glass (OVERLAY says on what
          // terms); this fill is what it falls back to.
          'bg-card border-border flex items-stretch border-t md:hidden',
          'pb-[env(safe-area-inset-bottom)] keyboard:hidden',
          // iOS: the same row as the tab bar's, whatever a page puts in
          // it: 48px tall, its controls centred, and every glyph in it at
          // the tab bar's 24px (the board controls draw 22px on a coarse
          // pointer, and read small beside the tabs; lanph3re, 2026-09-18).
          'ios:min-h-14 ios:items-center ios:[&_svg]:size-7',
          // With the tab bar below: what is IN the bar arrives on the
          // slide's clock during a page change (motion.css, `bar-in`).
          'bottom-bar',
          !claimed && 'hidden',
          // A page that claims the edge with nothing (an edited note, so
          // the tab bar steps aside) would float an empty capsule on
          // iOS: a ring around no height. Nothing to show, nothing drawn,
          // and the note clears the indicator on its own (--page-b).
          'ios:empty:hidden',
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
  // iOS: icons only, a 56px row, and it gets smaller while the page is
  // read: on a scroll down the capsule scales to 85% from its bottom
  // edge, and a scroll up, the top of the page or a tap brings it back
  // (hooks/use-bar-minimize); the pinned page header comes back on the
  // same scroll up (hooks/use-scroll-reveal). Instagram's shape on iOS,
  // at lanph3re's call (2026-09-18), after two others: Apple's own,
  // the capsule closing to the current tab alone, read as an empty
  // control on the phone, and a fold from labels to icons made the
  // labels the exception rather than the rule. A scale, not a height,
  // so the footprint main pads by never moves and nothing reflows under
  // the finger.
  const { minimized, expand } = useBarMinimized(active);
  const measure = useBottomBarMeasure();
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
        // iOS: the icon row's height, with no label under the icon; and
        // min-w-0, so a tab is a fifth of the capsule and never its
        // track's width (an 84px track in a 65px tab pushed the fifth
        // tab out of the capsule).
        'ios:min-h-14 ios:min-w-0',
        'transition-colors duration-150',
        isActive ? 'text-primary font-semibold' : 'text-muted-foreground',
        // On the glass capsule the inactive tabs draw foreground ink, not
        // muted: at the 70% fill (tokens.css, --glass-fill) muted ink
        // reads about 2.5:1 over black content under the capsule, and
        // foreground ink clears 4.5:1. The active tab is told by its pill
        // and its weight, which is how Apple's tab bar tells it.
        !isActive && 'ios:text-foreground',
      )}
    >
      {/* The pill's footprint; the pill itself is the sliding element
          above, drawn once for the bar. */}
      {/* iOS: Instagram's glyphs and track, measured off lanph3re's
          screenshots at 3x (2026-09-18, second pair: a 56pt bar, a 24pt
          glyph, an 84 by 48pt pill, 26pt insets): a 28px glyph box (its
          drawn strokes about 24px) in a 48px-tall track that is the tab's
          own width less 4px, which on a 327px capsule is 61px (Instagram's
          84pt pill sits on a 387pt bar; the proportion is what carries).
          The docked bar keeps its 18px glyph under a label. */}
      <span className="relative grid h-7 w-14 place-items-center rounded-full ios:h-12 ios:w-full">
        <Icon className="size-[1.15rem] ios:size-7" strokeWidth={isActive ? 2.4 : 2} />
      </span>
      {/* Six labels overprinted under 320px (a 390 phone zoomed to 200%)
          and went screen-reader-only there; five fit at 320 with 20px to
          spare on the widest, so the name stays on screen at every width.
          On iOS the capsule is icons only and the label is for the
          screen reader, which is what Instagram's bar does there. */}
      <span className="ios:sr-only">{t(label)}</span>
    </button>
  );

  return (
    <nav
      // "Sections", not "Page controls": that label belongs to the slot a
      // page fills with its own controls, and a screen reader landing on
      // Home heard the app's navigation announced as controls of a page
      // it does not control.
      aria-label={t('Sections')}
      ref={measure}
      className={cn(
        OVERLAY,
        // Opaque for the same reason as the page-control slot above.
        // border-border, not the card ring: the ring is transparent on the
        // toned page, and a bar with no edge merged into a page whose
        // bottom was the same white, so the hairline is drawn at rest
        // (lanph3re's call, 2026-09-13). The slot above matches.
        'bg-card border-border flex shrink-0 items-stretch border-t md:hidden',
        // Clear the iOS home indicator.
        'pb-[env(safe-area-inset-bottom)]',
        // The slot's arrival, shared (see MobileBottom).
        'bottom-bar',
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
        // iOS: the shrink, a transform from the bottom edge on the
        // pane-turn clock, so no layout moves with it.
        'ios:origin-bottom ios:scale-(--bar-scale) ios:transition-transform ios:duration-(--pane-turn) ios:ease-(--pane-turn-ease)',
        'motion-reduce:transition-none',
      )}
      data-minimized={minimized ? '' : undefined}
      // iOS: smaller while the page is read (see MobileNav's top).
      style={{ '--bar-scale': minimized ? '0.85' : '1' } as CSSProperties}
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
        className={cn(
          'bg-nav-pill pointer-events-none absolute top-1 h-7 w-14 rounded-full transition-[left] duration-(--pane-turn) ease-(--pane-turn-ease)',
          // iOS: the track's size (above), and a wash of the ink rather
          // than the docked bar's opaque tint, so the glass shows through
          // the pill as it does through the rest of the capsule; an opaque
          // pill on a translucent capsule read as a block stuck to it
          // (lanph3re, 2026-09-18). --pill-half is the left calc's term.
          'ios:h-12 ios:w-[calc(20%-0.25rem)] ios:bg-foreground/12 ios:[--pill-half:calc(10%-0.125rem)]',
        )}
        // Its resting place is the current tab's slot; while a finger is
        // scrubbing the bar (hooks/use-tab-scrub) the bar carries the
        // override and the pill is wherever the finger is. A custom
        // property rather than this style prop, so a render that lands
        // mid-gesture cannot fight the finger for it.
        style={{
          left: `var(--nav-pill-left, calc(${(activeIndex + 0.5) * (100 / slots.length)}% - var(--pill-half, 1.75rem)))`,
        }}
      />
      {slots.map(({ key, label, icon, on, go }, i) =>
        tab(key, label, icon, i === lit, on, () => {
          // The click behind a scrub would run the slot the finger STARTED
          // on; the scrub has already run the one it ended on.
          if (scrub.scrubbed()) return;
          // A tap opens the closed capsule as well as going where it says.
          expand();
          go();
        }),
      )}
    </nav>
  );
}
