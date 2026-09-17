import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useSlowLoad } from '@/components/skeletons';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { routePlaceholderShown } from '@/lib/lazyRoute';
import { SettingsCard as Card, SettingsPlaceholder } from '@/settings/SettingsPage.skeleton';
import { usePinnedBand } from '@/hooks/use-pinned-band';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { up } from '@/lib/router';
import { t } from '@/lib/i18n';
import { isDemo } from '@/lib/demo';
import { type Settings, type StorageReport } from '@/settings/cards/shared';
import { ProfileCard } from '@/settings/cards/profile-card';
import { DemoVaultCard, VaultCard } from '@/settings/cards/vault-card';
import { LagCard, VersionCard } from '@/settings/cards/version-card';
import { InstallCard, DesktopCard } from '@/settings/cards/desktop-card';
import { AppearanceCard } from '@/settings/cards/appearance-card';
import { DocumentsCard } from '@/settings/cards/documents-card';
import { TablebaseCard } from '@/settings/cards/tablebase-card';
import { SoundCard } from '@/settings/cards/sound-card';
import { SecurityCard } from '@/settings/cards/security-card';
import { LichessCard } from '@/settings/cards/lichess-card';
import { RecoveryCard } from '@/settings/cards/recovery-card';
import { BrowsedGamesCard } from '@/settings/cards/browsed-games-card';
import { StorageCard } from '@/settings/cards/storage-card';
import { DangerCard } from '@/settings/cards/danger-card';

/**
 * The one /api/storage answer this page needs.
 *
 * That endpoint walks the whole vault to answer, a stat per file, and
 * the page used to ask for it twice: once for the Vault card's listing,
 * once for the Storage used card. The two walks do not overlap on the
 * server, so the second one finished at about twice the first. Measured
 * over 9 visits to a 664-file vault: the page waited 138 ms on storage
 * and had the Storage used total up 349 ms after the navigation, against
 * 106 ms and 256 ms asking once.
 *
 * `stamp` counts what this page has cleared, so a clearing re-asks. The
 * last answer stays up while the next one comes, a failed re-read
 * included, because a re-read must not send a settled card back to
 * placeholders.
 */
function useStorage(stamp: number): StorageReport | null {
  const [report, setReport] = useState<StorageReport | null>(null);
  useEffect(() => {
    let live = true;
    void api<StorageReport>('/api/storage')
      .then((got) => {
        if (live) setReport(got);
      })
      .catch(() => {
        if (live) setReport((prev) => prev ?? { areas: [] });
      });
    return () => {
      live = false;
    };
  }, [stamp]);
  return report;
}

/** The licences page's chunk, fetched ahead (see the effect that calls
    this). A function of its own because the React Compiler cannot lower
    an import() expression inside a component yet. */
const warmLicensesPage = (): void => {
  void import('@/settings/LicensesPage');
};

/**
 * @param anchor a card to open on, by its id (`#/settings/tablebase`):
 *   how another page sends the reader to one setting rather than to the
 *   top of a long page. Scrolled to once the cards are drawn, since the
 *   page has no cards to scroll to until the settings arrive.
 */
export function SettingsPage({ anchor }: { anchor?: string } = {}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Bumped whenever something on this page frees space, so the cards
      re-read instead of standing on the figures they loaded with. */
  const [storageStamp, setStorageStamp] = useState(0);
  const storage = useStorage(storageStamp);
  const waiting = settings === null && loadError === null;
  /**
   * Whether the route's own outline was already on screen when this page
   * mounted (lib/lazyRoute, routePlaceholderShown).
   *
   * It is the same component this page is about to draw, out of the same
   * module, so there is nothing for `useSlowLoad`'s 180ms to protect
   * against: a delay exists to keep a placeholder from flashing where
   * nothing stood, and here the picture is already up. Without this the
   * two waits hand over through a hole and the outline blinks out and
   * back in.
   */
  const [continuing] = useState(routePlaceholderShown);
  const pending = useSlowLoad(waiting) || (continuing && waiting);
  /**
   * Whether this page's own outline has been on screen.
   *
   * The outline draws the Vault tree (SettingsPlaceholder), and the two
   * Vault cards draw it again once the settings land — but the LISTING
   * is a second request, and the slower of the two, so the card mounts
   * with nothing to show and `useSlowLoad` holds its placeholder back
   * for 180ms. Measured on the demo with /api/storage held: the tree was
   * 348px, went to 0 at 1860ms and came back at 2040. The card collapsed
   * by its whole box and re-expanded, which is the jump both placeholders
   * exist to prevent, handed over between them.
   *
   * So the cards are told. A delay is there to keep a placeholder from
   * flashing where nothing stood before; where the outline has already
   * been drawing this one, there is nothing to protect against and the
   * bars simply carry on. State adjusted during render, React's own
   * pattern for a value that follows a prop, as `Arrival` does it.
   */
  const [outlineShown, setOutlineShown] = useState(false);
  if (pending && !outlineShown) setOutlineShown(true);

  // The licences page's chunk, fetched while this page is read. That
  // page has one way in, the link at the foot of this one, and on a
  // phone the router holds the page transition until a route's chunk is
  // in hand (lib/router, swapRoute): tapping the link on a cold cache
  // fetched three small files first and the slide began only when they
  // had landed, measured at 176ms with 150ms of simulated latency
  // against the demo build. Warmed here, the module is cached before
  // the tap and the slide starts on it. The cost is about 6 KB plus two
  // shared chunks per Settings visit. Not on a desktop, where the route
  // cuts and the chunk beats the paint anyway.
  useEffect(() => {
    if (!window.matchMedia('(max-width: 47.9375rem)').matches) return;
    warmLicensesPage();
  }, []);

  // Once, when the cards land; a later refresh must not scroll again,
  // which is why the effect is keyed on whether they have landed and
  // not on the settings themselves.
  const loaded = settings !== null;
  const scrollToAnchor = useEffectEvent(() => {
    if (!anchor || settings === null) return;
    document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
  });
  useEffect(() => {
    scrollToAnchor();
  }, [anchor, loaded]);

  const refresh = async (): Promise<void> => {
    // Uncaught, this stranded the page on its skeleton with no way out —
    // and the skeleton only shows after a beat, so a fast failure showed
    // NOTHING at all.
    try {
      setSettings(await api<Settings>('/api/settings'));
      setLoadError(null);
    } catch (e) {
      setLoadError(apiErrorMessage(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  // Settings arrive fast on a local server, so nothing is shown at all
  // unless the wait is long enough to notice.
  if (!settings) {
    if (loadError)
      return (
        <PageShell width="narrow">
          <div>
            <p className="text-destructive mb-3 text-sm" role="alert">
              {loadError}
            </p>
            <Button variant="secondary" size="sm" onClick={() => void refresh()}>
              {t('Try again')}
            </Button>
          </div>
        </PageShell>
      );
    // The shell the settled page uses, not a bare scroller. This drew its
    // own column and its own padding, so the gutters moved when the
    // settings landed and the page header — which the skeleton did not
    // stand in for at all — appeared from nowhere and pushed every card
    // down the height of a title.
    return <PageShell width="narrow">{pending && <SettingsPlaceholder />}</PageShell>;
  }

  // Nothing here knows about the keyboard any more. This box used to pad
  // itself by what the keyboard covered, and to claim the phone's bottom
  // bar so the tab row could not ride up onto the keys — both from when
  // the shell was 100svh and ran on underneath. The shell ends at the
  // keyboard now and the bar hides itself while typing, so padding again
  // only pushed the bottom of the page out of a box with nothing under it.
  return (
    <PageShell width="narrow" className="relative">
        <PageHeader title={t('Settings')} back={() => up('home')} />
        {/* Read again when the storage answer lands. Every card that
            waits on a fetch has to be a dep here, or the row is missing
            its name until a reload: the demo's Vault card used to be
            withheld entirely and went unnamed, and a card that draws a
            placeholder first can still change its title when it settles. */}
        <JumpList dep={storage ?? settings} />

        {/* Appearance is the only card that works without a server: it
            writes to this device, not to a vault. The rest change a vault or
            a secret, so in the demo they are described rather than shown —
            a disabled form a visitor can fill in and not submit is a worse
            explanation than a sentence. */}
        {/* Ordered by CONSEQUENCE, with one card moved up: what can change
            a vault or a secret comes first, and the irreversible card
            stays at the bottom where a reader has to travel to it. It used
            to open on three appearance dropdowns — thirty-three options
            between them — with Auto-save, the one switch on this page that
            decides whether work is kept, below them under Sound, and the
            swing away from that put Appearance under Storage used: a
            thirteen-row inventory nobody reads twice, standing in front of
            the language and the theme, which are what most visits to this
            page are for. So Appearance goes just ahead of Storage — after
            everything that changes a vault, before the table — and Sound,
            which nobody comes for, keeps its place. */}
        {isDemo() ? (
          <>
            <DemoVaultCard storage={storage} outlineShown={outlineShown} />
            <DocumentsCard />
            <AppearanceCard />
            {/* Storage is here in the demo as well, now that the in-memory
                vault can answer for itself: it is the one card that says
                what a vault is MADE of — games, studies, notes, and the
                caches that rebuild themselves — which is worth showing
                somebody deciding whether to install. The cards below it
                are the ones that really do need a server. */}
            <StorageCard storage={storage} />
            {/* And recovery: the demo keeps its own versions of whatever
                you edit in the tab (web/src/demo/nodeShim/history.ts), so
                the card is real here too — it starts empty, and fills as
                you work, which is the honest demonstration of a safety
                net. Delete a note and it turns up in this list. */}
            <RecoveryCard />
            <SoundCard />
            <InstallCard />
            <Card icon={Info} title={t('This is a demo')}>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t(
                  'Changes here live in this browser tab and are gone on reload. Profile, password, two-factor authentication, the Lichess token and the vault itself need your own server. Install the app or host it, and this page becomes real.',
                )}
              </p>
            </Card>
            <VersionCard />
          </>
        ) : (
          <>
            <ProfileCard settings={settings} onSaved={refresh} />
            <VaultCard settings={settings} onSaved={refresh} storage={storage} outlineShown={outlineShown} />
            <DocumentsCard />
            <SecurityCard settings={settings} onChanged={refresh} />
            <LichessCard settings={settings} onChanged={refresh} />
            {/* Both of these empty a cache the Vault and Storage used
                cards are counting, so both have to tell them. The
                tablebase one was
                the older mistake: forgetting its answers left the
                "Tablebase cache" row saying what it read at mount, so
                the page carried two answers for the same folder until a
                reload. */}
            <TablebaseCard
              settings={settings}
              onChanged={refresh}
              onCleared={() => setStorageStamp((n) => n + 1)}
            />
            {/* Clearing a cached player changes a row of the card below
                — and left it saying the size it read at mount, so the
                page carried two different answers for "Browsed games"
                a card apart. It was reachable before this too, by
                Clear all; a button per row is what made it ordinary. */}
            <BrowsedGamesCard onCleared={() => setStorageStamp((n) => n + 1)} />
            <AppearanceCard />
            <StorageCard storage={storage} />
            <RecoveryCard />
            <DesktopCard />
            <SoundCard />
            <InstallCard />
            <DangerCard gate={settings.gate} />
            {typeof __LAG__ !== 'undefined' && __LAG__ && <LagCard />}
            <VersionCard />
          </>
        )}

        {!isDemo() && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {/* `break-all`: a path is one unbroken word to the line breaker —
                a Windows one has no break opportunity at all, backslashes
                included — so it ran straight out of the paragraph and the
                page cut it. Measured at 320px: the span ended 32px past the
                viewport. It is width and path length together, so it breaks
                rather than waiting for a breakpoint. */}
            {t('Vault:')} <span className="font-mono break-all">{settings.vaultPath}</span>{'. '}
            {t('Every game, study and puzzle lives there as plain files. Display settings live on this device.')}
          </p>
        )}
    </PageShell>
  );
}

/**
 * The page while the settings answer is out.
 *
 * It used to be three generic form cards of 212px each, which is the
 * shape of no page here: the first card is the Vault, a listing of the
 * folder that stands 446px on a desktop and 663 on a phone, and on a
 * desktop a row of section links sits between the title and the cards.
 * Measured on the demo at 1280 and 390 before this: the first card
 * dropped 56px when the settings landed and the second 290 on a desktop
 * and 451 on a phone. So this is the top of the page as it settles: the
 * title, the link row, and the first three cards in the order the page
 * draws them (the demo and a server start differently), the card frames
 * real and what waits on the answer drawn as bars. The sentences a card
 * prints whatever the answer are printed here too, as the Vault card's
 * own placeholder does with its path. The third card ends under the
 * fold at both widths, and what follows settles under it.
 */
/**
 * The card names, each a jump to its card.
 *
 * Settings is fifteen cards in one column, and on a wide window the one
 * you came for could be 1,700px down with nothing to say where. The list
 * reads the cards that are actually on the page (the demo and a real
 * server show different sets) and stays out of the way on a phone, where
 * the page is short enough to thumb and it would cost a line.
 *
 * Two shapes, by width. From xl it is a column in the margin to the left
 * of the form, the way macOS System Settings, Windows Settings and
 * Linear list their sections: the form keeps its `narrow` width (a
 * width is a statement about the content, and a form's is the shortest
 * line), and the names stand beside it in room the column does not use.
 * It sticks while the page scrolls and the name of the card under the
 * top of the window takes the sidebar's current-row pill, so the list
 * says where you are as well as where you can go. Below xl there is no
 * margin to stand in, and it is the row it always was, sticky at the
 * top; that row wrapped to two lines at every desktop width because it
 * lived inside the 42rem column, which is what the column fixes.
 *
 * `dep` is what to read the page again after. A card that waits on a
 * fetch is not in the DOM when the settings land, so every such answer
 * has to be one, or the list is missing a name until a reload.
 */
function JumpList({ dep }: { dep: unknown }) {
  const [cards, setCards] = useState<{ el: HTMLElement; title: string }[]>([]);
  // 60px on one line, 84px once the names wrap to two, and either way the
  // page scrolls a Shift+Tab clear of it (hooks/use-pinned-band).
  const pin = usePinnedBand('top');
  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-settings-card]')].map((el) => ({
      el,
      title: el.querySelector('h2')?.firstChild?.textContent?.trim() || el.querySelector('h2')?.textContent?.trim() || '',
    }));
    setCards(found.filter((c) => c.title));
  }, [dep]);
  // Which card is under the top of the window: the last one whose top has
  // passed the line a scrolled-to card lands on, read on the page's own
  // scroller. A card lands at the scroller's scroll-padding (the pinned
  // row below xl, nothing from xl) plus its own scroll-margin (the
  // scroll-mt-14 every card wears), so that is the line, with a few
  // pixels of slack for a fractional landing. It was a fixed 80px, which
  // from xl put the line 24px into whatever card had just been scrolled
  // to, so a card shorter than that handed the pill to the one after it:
  // click A, and B lit (lanph3re's report). Measured on the demo at
  // 1440x800: a jumped-to card's top sits 56px under the scroller's.
  //
  // A click also names its card outright and holds it until that scroll
  // has ended, since the last cards on the page cannot reach the top
  // and the read alone would never light them; and where the scroll
  // ended at the page's floor, the name stays until the reader scrolls,
  // because the read would hand it straight back to the card above.
  const held = useRef<number | null>(null);
  const floored = useRef(false);
  useEffect(() => {
    if (cards.length === 0) return;
    const scroller = cards[0]!.el.closest<HTMLElement>('[data-page-scroll]');
    if (!scroller) return;
    const read = (): void => {
      if (held.current !== null) return;
      const pad = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
      const line = scroller.getBoundingClientRect().top + pad + 4;
      let at = 0;
      cards.forEach((c, i) => {
        const margin = parseFloat(getComputedStyle(c.el).scrollMarginTop) || 0;
        if (c.el.getBoundingClientRect().top - margin <= line) at = i;
      });
      setCurrent(at);
    };
    // scrollend where the platform has it; a timer stands in where it
    // does not (WebKit), and covers a click whose scroll had no distance
    // to travel and so fires neither event.
    let timer = 0;
    const release = (): void => {
      if (held.current === null) return;
      held.current = null;
      floored.current = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (!floored.current) read();
    };
    const onScroll = (): void => {
      if (held.current !== null) {
        window.clearTimeout(timer);
        timer = window.setTimeout(release, 150);
        return;
      }
      floored.current = false;
      read();
    };
    read();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('scrollend', release);
    return () => {
      window.clearTimeout(timer);
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('scrollend', release);
    };
  }, [cards]);
  const jump = (i: number): void => {
    held.current = i;
    setCurrent(i);
    cards[i]!.el.scrollIntoView({ block: 'start' });
    // No scroll to end (the card was already at the top): let go now.
    window.setTimeout(() => {
      if (held.current === i) held.current = null;
    }, 400);
  };
  if (cards.length < 4) return null;
  return (
    <>
      {/* The row, below xl. */}
      <nav
        ref={pin}
        aria-label={t('Settings sections')}
        className="bg-background/95 sticky top-0 z-10 -mx-1 mb-1 hidden flex-wrap gap-x-3 gap-y-1 px-1 py-2 text-sm md:flex xl:hidden"
      >
        {cards.map((c) => (
          <button
            key={c.title}
            type="button"
            className="text-muted-foreground hover:text-foreground rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring"
            onClick={() => jump(cards.indexOf(c))}
          >
            {c.title}
          </button>
        ))}
      </nav>
      {/* The column, from xl. A rail the column's full height, stood in
          the margin (right-full of the column, which is `relative`), so
          the list inside it can stick; the list's top margin is the
          column's top, the header row and its gap, which puts it level
          with the first card at rest and at the top once scrolled. Zero height in the flow,
          and the gap it would earn is taken back, so the cards sit where
          they sit with no list at all. */}
      <div className="pointer-events-none absolute inset-y-0 right-full mr-6 hidden w-40 xl:block" aria-hidden={false}>
        <nav
          aria-label={t('Settings sections')}
          // 68px: the column's 24px top, the 28px title row and the 16px
          // gap under it, which is where the first card starts (measured).
          className="pointer-events-auto sticky top-6 mt-17 flex flex-col gap-0.5 text-sm"
        >
          {cards.map((c, i) => (
            <button
              key={c.title}
              type="button"
              aria-current={i === current ? 'true' : undefined}
              className={cn(
                'flex h-8 items-center rounded-md px-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring',
                i === current
                  ? 'bg-nav-pill text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              onClick={() => jump(i)}
            >
              <span className="truncate">{c.title}</span>
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
