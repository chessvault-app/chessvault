import { Globe, Info, Play, Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';

import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CloudBoardArt } from '@/components/cloud-board-art';

import { Select } from '@/components/ui/select';
import { SearchInput } from '@/components/text-fields';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';

import { SkeletonGameRows } from '@/components/skeletons';
import { forgetMyGames } from '@/openingmap/useGaps';

import { t } from '@/lib/i18n';
import { GameRow, gameKey, type GameSummary, type Preview } from './shared';
import { GameListShell } from './GameListShell';
import { GameTableHeader, GameTableRow, useGameTableVars, useTableNav } from './GameTable';
import { GameDetailsSheet, type DetailsSelection } from './GameDetails';
import { loadGamePgn } from './CollectionList';
import { TitleTip } from '@/components/title-tip';

/**
 * The details view's action pair for an archive row, with its own
 * added-state — the node lives in the page's selection state, so it
 * cannot read the browser's `added` set after the fact; what it CAN do
 * is remember its own success (RefRowActions' reasoning).
 */
function ArchiveRowActions({
  inCollection,
  onOpen,
  onCollect,
}: {
  inCollection: boolean;
  onOpen: () => void;
  onCollect: () => Promise<boolean>;
}) {
  const [added, setAdded] = useState(inCollection);
  return (
    // Primary rightmost — the app's button order.
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={added}
        onClick={() => {
          void onCollect().then((ok) => {
            if (ok) setAdded(true);
          });
        }}
      >
        {added ? (
          t('Added')
        ) : (
          <>
            <Plus className="size-3.5" data-icon="inline-start" strokeWidth={2.5} />
            {t('Add to collection')}
          </>
        )}
      </Button>
      <Button variant="default" size="sm" onClick={onOpen}>
        <Play className="size-3.5" data-icon="inline-start" />
        {t('Open the game')}
      </Button>
    </>
  );
}
import {
  EMPTY_STRUCTURED_FILTERS,
  hasStructuredFilters,
  matchesStructured,
  MoreFiltersButton,
  ResultSelect,
  SideSelect,
  StructuredFiltersWindow,
  type ResultFilter,
  type SideFilter,
  type StructuredFilters,
} from './GameFilters';

interface ArchiveMonth {
  month: string;
  cached: boolean;
  games: number | null;
}

/**
 * The archive browse state lives OUTSIDE the component (a module store), so
 * opening a game and swiping back doesn't wipe the loaded month — the browser
 * remounts GamesView, and local state would reset. This keeps the last browse.
 */
interface ArchiveBrowseState {
  provider: 'chesscom' | 'lichess';
  username: string;
  months: ArchiveMonth[];
  offline: boolean;
  /** Games this player has EVER played, per the provider's own stats —
      null while unknown (offline, or the stats call failed). */
  total: number | null;
  month: string;
  monthGames: GameSummary[];
  /** How many of the newest-first months have been pulled in already. */
  cursor: number;
  /**
   * Months already fetched this session, keyed by provider|user|month.
   *
   * Purely a browsing cache: scrolling back up, flipping to a single
   * month and returning to all dates, or looking the same player up
   * twice all read from here instead of the network. Nothing in it is in
   * the collection — adding a game is still the explicit Add, and this
   * disappears with the tab.
   */
  cache: Record<string, GameSummary[]>;
}
// Remembered PER PROVIDER: one shared key meant looking up a Lichess
// handle and reloading prefilled it into the chess.com box. The original
// single key is folded into the chesscom entry at boot and then deleted,
// so nobody loses their prefill and this only has to know about one
// shape — see lib/storageSweep.
const userKey = (provider: string): string => `chess-vault:archive-user:${provider}`;

const savedUser = (provider: string): string => localStorage.getItem(userKey(provider)) ?? '';

const useArchiveBrowse = create<ArchiveBrowseState>(() => ({
  provider: 'chesscom',
  username: savedUser('chesscom'),
  months: [],
  offline: false,
  total: null,
  month: '',
  monthGames: [],
  cursor: 0,
  cache: {},
}));

/**
 * How many games a page of "all dates" is worth fetching for.
 *
 * Browsing used to mean every month the account has, newest to oldest,
 * one request each, before the list settled — a decade is dozens of round
 * trips and tens of thousands of rows for a question usually answered by
 * the last fortnight. Months are pulled newest-first until this many
 * games are in hand, and the next batch waits until the reader scrolls
 * far enough to want it.
 */
const PAGE_GAMES = 40;

/** Fetched months, per provider and player, for this session. */
const monthKey = (provider: string, user: string, month: string): string =>
  `${provider}|${user.toLowerCase()}|${month}`;

/** Sentinel month meaning "every month this player has". */
const ALL_MONTHS = '*';

/**
 * How many archive rows to put in the DOM at once.
 *
 * "All dates" over a decade is tens of thousands of games, and rendering
 * every one freezes the tab for seconds. The cap is display only —
 * selecting all still selects every game that was loaded, so nothing the
 * user asked for is withheld, and the count below the list says so.
 */
const MAX_ROWS = 1000;

/**
 * Month-by-month browser over a chess.com account. Months are cached on disk
 * the first time they are opened, so revisiting works offline; games are
 * added to the collection one by one.
 */
/**
 * One archive row, memoised on primitives so a selection tick re-renders
 * the rows whose state changed and nothing else. `picked` arrives as THIS
 * row's boolean, never the Set — a Set prop would change identity on
 * every tick and take the whole month with it. The callbacks are stable
 * by contract (see rowHandlers in ArchiveBrowser).
 */
const ArchiveRow = memo(function ArchiveRow({
  game,
  table,
  selecting,
  picked,
  inCollection,
  onOpen,
  onPreview,
  onToggle,
  onCollect,
  onDetails,
  selectedRow = false,
  onSelectRow,
}: {
  game: GameSummary;
  table: boolean;
  selecting: boolean;
  picked: boolean;
  inCollection: boolean;
  onOpen: (game: GameSummary) => void;
  onPreview: (p: Preview | null) => void;
  onToggle: (key: string, on: boolean) => void;
  onCollect: (game: GameSummary) => void;
  onDetails: (game: GameSummary) => void;
  /** Table mode: this row is the details panel's subject. */
  selectedRow?: boolean;
  onSelectRow: (game: GameSummary) => void;
}) {
  // Outside the hover tray: a selection checkbox that only appears
  // under the pointer is one you cannot tick with your eyes.
  const checkbox = selecting && (
    <Checkbox
      aria-label={t('Select this game')}
      checked={picked}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={(on) => onToggle(gameKey(game), on === true)}
    />
  );
  if (table) {
    // The wide pane's dense presentation: click selects for the
    // details panel beside it, double click opens — the same contract
    // as every other tab's table. No Add column: the details panel is
    // the row's verb surface now, and a page of "Added" pills said the
    // same word down the whole list. The pinned column exists only in
    // selection mode, and only as the checkbox.
    return (
      <GameTableRow
        game={game}
        selected={selectedRow}
        onSelect={() => onSelectRow(game)}
        onOpen={() => onOpen(game)}
        standing={selecting ? checkbox : undefined}
      />
    );
  }
  // The card rows keep the Add button standing: on a phone there is no
  // panel beside the list to carry it. The checkbox leads the row
  // instead (the `leading` slot below) — the table's selection column
  // sits leftmost for the same reason, and ticking marks the ROW, not
  // one more control in the trailing furniture.
  const standing = (
    <>
      <Button
        variant={inCollection ? 'ghost' : 'secondary'}
        size="sm"
        disabled={inCollection}
        className="w-16 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onCollect(game);
        }}
      >
        {inCollection ? (
          t('Added')
        ) : (
          <>
            <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
            {t('Add')}
          </>
        )}
      </Button>
    </>
  );
  return (
    <GameRow
      game={game}
      onOpen={() => onOpen(game)}
      onPreview={onPreview}
      actions={null}
      // The whole game in a sheet — what the wide layouts show in the
      // details panel, for the rows that are cards.
      menu={[{ label: 'Game details', icon: Info, onSelect: () => onDetails(game) }]}
      standing={standing}
      leading={checkbox || undefined}
    />
  );
});

export function ArchiveBrowser({
  collectionKeys,
  onCollected,
  onPreview,
  table = false,
  site,
  onSelect,
  selectedKey,
  inPlace = false,
  merged = false,
}: {
  collectionKeys: Set<string>;
  onCollected: () => void;
  onPreview: (p: Preview | null) => void;
  /** Dense table rows instead of cards — the wide pane's presentation.
      Explicit, never inferred: the same list renders as cards below lg
      whatever the pane says. */
  table?: boolean;
  /** The ONE provider this browser answers for — the page's per-site
      tabs, where the tab strip already says which site this is and a
      provider track of its own would say it twice. */
  site: 'chesscom' | 'lichess';
  /** Table mode: a click packages the row for the details panel;
      null when the rows it described reset. */
  onSelect?: (sel: DetailsSelection | null) => void;
  selectedKey?: string | null;
  /** The host already shows the analysis board (the workspace): opening
      a game loads it and stays put, instead of handing off to #/board.
      Opt-in from the caller, so the Games page keeps its navigation. */
  inPlace?: boolean;
  /** One-row chrome by measured pane width - see DatabaseGames. */
  merged?: boolean;
}) {
  // Browse state persists across remounts (see useArchiveBrowse); setters
  // mirror the useState API so the call sites below are unchanged.
  const { provider, username, months, offline, total, month, monthGames, cursor } = useArchiveBrowse();
  const setUsername = (v: string | ((p: string) => string)): void =>
    useArchiveBrowse.setState((s) => ({ username: typeof v === 'function' ? v(s.username) : v }));
  const setProvider = (v: 'chesscom' | 'lichess'): void =>
    // Switching providers swaps in that provider's own remembered name.
    useArchiveBrowse.setState({ provider: v, username: savedUser(v) });
  const setMonths = (v: ArchiveMonth[]): void => useArchiveBrowse.setState({ months: v });
  const setOffline = (v: boolean): void => useArchiveBrowse.setState({ offline: v });
  const setMonth = (v: string): void => useArchiveBrowse.setState({ month: v });
  const setMonthGames = (v: GameSummary[]): void => useArchiveBrowse.setState({ monthGames: v });
  // First run on a device: fall back to the profile usernames from Settings.
  useEffect(() => {
    if (username.trim()) return;
    void api<{ profile?: { chesscom?: string; lichess?: string } }>('/api/settings')
      .then((s) => {
        const fromProfile = provider === 'chesscom' ? s?.profile?.chesscom : s?.profile?.lichess;
        if (fromProfile) setUsername((current) => (current.trim() ? current : fromProfile));
      })
      .catch(() => {
        /* a cosmetic prefill: the field simply stays empty */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
  const apiBase = provider === 'chesscom' ? '/api/games/archive' : '/api/games/lichess';
  /**
   * The handles looked up before, kept on the device and shared by both
   * providers.
   *
   * One list, not one per site: it is the same person being looked up,
   * usually under the same handle, and a list that emptied itself when
   * you switched tab made you type a name you had just typed. Tapping one
   * looks it up wherever you are now — which is the point, since "have I
   * played this person" is a question about a player and not about a site.
   *
   * Typing a username is the one thing this panel asks for over and over,
   * and until an archive is loaded the space below it does nothing.
   */
  const [loading, setLoading] = useState<'months' | 'games' | null>(null);
  // On a phone this panel sits under the collection, so an archive that has
  // just arrived is off the bottom of the screen. Scrolled to, once, when it
  // appears — not on every re-render, which would fight the finger.
  const archiveTop = useRef<HTMLDivElement>(null);
  const hadMonths = useRef(false);
  useEffect(() => {
    if (months.length === 0) {
      hadMonths.current = false;
      return;
    }
    if (hadMonths.current) return;
    hadMonths.current = true;
    archiveTop.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [months.length]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Read through a ref where reset points live inside async flows —
  // the selection must clear when the rows it described go away.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /** Games already on disk across every cached month — what "All dates"
      can show without touching the network. */
  const cachedGames = months.reduce((n, m) => (m.cached ? n + (m.games ?? 0) : n), 0);

  const loadMonths = async (who?: string): Promise<void> => {
    const user = (who ?? username).trim();
    if (!user) return;
    localStorage.setItem(userKey(provider), user);
    onSelectRef.current?.(null);
    setLoading('months');
    setError(null);
    setMonth('');
    setMonthGames([]);
    try {
      const body = await api<
        | {
            months: ArchiveMonth[];
            offline: boolean;
            total?: number | null;
            /** The newest month's games, sent with the list that names it. */
            newest?: { month: string; games: GameSummary[] } | null;
          }
        | { error: string }
      >(`${apiBase}/months?user=${encodeURIComponent(user)}`);
      if ('error' in body) setError(body.error);
      else {
        setMonths(body.months);
        setOffline(body.offline);
        useArchiveBrowse.setState({ total: body.total ?? null });
        // The newest month came with the list, so put it where fetchMonth
        // looks before asking: browsing an archive used to be two round
        // trips deep before a single game appeared, and the second one
        // could not start until the first had named a month. Seeded here
        // rather than rendered from here, so the paging below is one path
        // whether the server sent it or not — an older server, or a month
        // that failed to load, simply finds no hit and asks.
        if (body.newest) {
          const key = monthKey(provider, user, body.newest.month);
          const games = body.newest.games;
          useArchiveBrowse.setState((s) => ({ cache: { ...s.cache, [key]: games } }));
        }
        // All dates rather than one month — the question people open this
        // page with is "have I played this before" — but only the newest
        // page of it. The rest arrives as it is scrolled to.
        if (body.months.length) await loadAllMonths(body.months, user);
      }
    } catch (failure) {
      setError(t(apiErrorMessage(failure)));
    } finally {
      setLoading(null);
    }
  };

  /**
   * A pinned tab looks its player up BY ITSELF once a username is in
   * hand (the saved handle, or the profile prefill landing a moment
   * later): the tab exists to show these games, and in the common case
   * they are already cached on disk — the months route serves the
   * cache when the provider cannot be reached, and a partially cached
   * account simply pages the missing months in as they are scrolled
   * to. Pressing Browse remains the way to look up someone ELSE. Once
   * per mount.
   */
  const autoLooked = useRef(false);
  useEffect(() => {
    if (provider !== site || autoLooked.current) return;
    if (months.length > 0 || loading !== null || !username.trim()) return;
    autoLooked.current = true;
    void loadMonths();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, provider, username, months.length, loading]);

  /**
   * One month, from the session cache if it has been seen before.
   *
   * Newest game first, which is the order every list here is in — the
   * route answers in that order for both sites, so nothing is reordered
   * here. A month that cannot be reached yields nothing rather than
   * throwing: one bad month must not lose the rest of a decade.
   */
  const fetchMonth = async (user: string, m: string): Promise<GameSummary[]> => {
    const key = monthKey(provider, user, m);
    const hit = useArchiveBrowse.getState().cache[key];
    if (hit) return hit;
    try {
      const body = await api<{ games?: GameSummary[] }>(
        `${apiBase}/month?user=${encodeURIComponent(user)}&month=${m}`,
      );
      const games = body.games ?? [];
      useArchiveBrowse.setState((s) => ({ cache: { ...s.cache, [key]: games } }));
      return games;
    } catch {
      return [];
    }
  };

  /** The months this account has, newest first — the order they load in. */
  const newestFirst = (list: ArchiveMonth[]): string[] =>
    list.map((m) => m.month).sort().reverse();

  /**
   * The newest page of every month, and no more than that.
   *
   * `list` and `who` are taken as arguments because the first call happens
   * in the same tick as setMonths()/setUsername(): reading them off the
   * store there would find the previous lookup's values.
   */
  const loadAllMonths = async (list: ArchiveMonth[] = months, who?: string): Promise<void> => {
    const user = (who ?? username).trim();
    setMonth(ALL_MONTHS);
    setError(null);
    useArchiveBrowse.setState({ monthGames: [], cursor: 0 });
    await loadMore(list, user);
  };

  /**
   * The next months, until a page is in hand or the account runs out.
   *
   * Re-entrancy matters: the sentinel can come back into view while a
   * batch is still in flight, and asking twice for the same months would
   * double every row. The ref is the gate.
   */
  const loadingMore = useRef(false);
  const moreSentinel = useRef<HTMLLIElement>(null);
  const loadMore = async (list: ArchiveMonth[] = months, who?: string): Promise<void> => {
    if (loadingMore.current) return;
    const user = (who ?? username).trim();
    const all = newestFirst(list);
    if (useArchiveBrowse.getState().cursor >= all.length) return;
    loadingMore.current = true;
    setLoading('games');
    try {
      let added = 0;
      while (added < PAGE_GAMES) {
        const { cursor } = useArchiveBrowse.getState();
        if (cursor >= all.length) break;
        const games = await fetchMonth(user, all[cursor]!);
        added += games.length;
        useArchiveBrowse.setState((s) => ({
          monthGames: [...s.monthGames, ...games],
          cursor: s.cursor + 1,
        }));
      }
    } finally {
      loadingMore.current = false;
      setLoading(null);
    }
  };

  /**
   * The next page, when the bottom of the list comes into view.
   *
   * `rootMargin` fires it a screenful early, so scrolling is continuous
   * rather than stopping at a spinner and waiting. Re-armed whenever the
   * cursor moves, because the sentinel is a new element each time.
   */
  useEffect(() => {
    const node = moreSentinel.current;
    if (!node || month !== ALL_MONTHS || cursor >= months.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: '400px' },
    );
    io.observe(node);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, cursor, months.length]);

  const loadMonth = async (m: string): Promise<void> => {
    onSelectRef.current?.(null);
    if (m === ALL_MONTHS) return loadAllMonths();
    setMonth(m);
    setLoading('games');
    setError(null);
    // Through the same cache as the paged path, so flipping between a
    // single month and all dates costs nothing after the first look.
    setMonthGames(await fetchMonth(username.trim(), m));
    setLoading(null);
  };

  // Row click: look at the game in Analysis (from the player's side) without
  // committing it to the collection — Add is the explicit action.
  const openInAnalysis = async (game: GameSummary): Promise<void> => {
    try {
      const { pgn } = await api<{ pgn: string }>(
        `/api/games/pgn?file=${encodeURIComponent(game.file)}&index=${game.index}`,
      );
      const { loadPgn } = useAnalysis.getState();
      if (loadPgn(pgn)) {
        if (game.userSide) useAnalysis.setState({ orientation: game.userSide });
        if (!inPlace) {
          useAnalysis.setState({ handoff: true });
          navigate('board');
        }
      }
    } catch {
      setError(t('could not load that game'));
    }
  };

  // Selection is a MODE, not a permanent column: a checkbox on every row
  // is clutter for the common case, which is picking out one game.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [addProgress, setAddProgress] = useState<{ done: number; total: number } | null>(null);
  const [sideFilter, setSideFilter] = useState<SideFilter>('any');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('any');
  // The structured sentence, answered client-side like the collection's:
  // a cached month is already in the page (see matchesStructured).
  const [structured, setStructured] = useState<StructuredFilters>(EMPTY_STRUCTURED_FILTERS);
  const [editingFilters, setEditingFilters] = useState(false);
  const [quickDraft, setQuickDraft] = useState<{ side: SideFilter; result: ResultFilter }>({
    side: 'any',
    result: 'any',
  });
  // Memoised, both of them: "All dates" holds tens of thousands of rows,
  // and recomputing two O(n) passes on every render meant every checkbox
  // tick re-filtered a decade — in a list whose rows are memoised
  // precisely so a tick touches two of them.
  const visibleMonthGames = useMemo(
    () =>
      monthGames.filter(
        (g) =>
          (sideFilter === 'any' || g.userSide === sideFilter) &&
          (resultFilter === 'any' || g.result === resultFilter) &&
          matchesStructured(structured, g),
      ),
    [monthGames, sideFilter, resultFilter, structured],
  );

  /**
   * Everything the current filters show. Any row can be ticked, including
   * one already collected — adding a game twice writes a "(2)" file rather
   * than overwriting anything, and refusing silently is worse than a
   * duplicate the user can delete.
   */
  const pickable = visibleMonthGames;

  /**
   * What "Select all" takes: the ones not already collected.
   *
   * Not a refusal — each of those rows still has a working checkbox, and
   * ticking one is how you deliberately take a second copy. It is about
   * what ONE click should mean. Under All dates, "all" spans a decade, and
   * a Select all that included everything already imported would re-add an
   * entire history as "(2)" files from a single press.
   */
  const uncollected = useMemo(
    () =>
      visibleMonthGames.filter(
        (g) => !added.has(gameKey(g)) && !collectionKeys.has(`${g.white}|${g.black}|${g.date}`),
      ),
    [visibleMonthGames, added, collectionKeys],
  );

  const switchProvider = (next: 'chesscom' | 'lichess'): void => {
    if (next === provider) return;
    onSelectRef.current?.(null);
    setProvider(next);
    setMonths([]);
    setMonth('');
    setMonthGames([]);
    setError(null);
  };

  // This browser answers for ITS site whatever another instance left
  // in the shared browse store — the other provider's tab. Reconciling
  // is the same reset switching sites has always cost.
  useEffect(() => {
    if (provider !== site) switchProvider(site);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, provider]);

  /**
   * Add many games in one request.
   *
   * One call rather than one per game: a month is hundreds of games, and
   * the server parses the archive file once for the whole batch. `all`
   * means the whole file, whatever the current filters show — it is sent
   * as explicit indexes so what you ticked is what you get.
   */
  const collectMany = async (games: GameSummary[]): Promise<void> => {
    if (!games.length) return;
    setBusy(true);
    setError(null);

    // Grouped by archive file: under "All dates" a selection spans many
    // months, and the server parses one file per request. One request per
    // month, not one per game.
    const byFile = new Map<string, GameSummary[]>();
    for (const g of games) byFile.set(g.file, [...(byFile.get(g.file) ?? []), g]);

    const done: GameSummary[] = [];
    let failure: string | null = null;
    for (const [file, group] of byFile) {
      // Adding a hundred games is still one request per month, so the
      // button counts them off rather than sitting on "Adding…" for a
      // minute with nothing to show it is alive.
      setAddProgress({ done: done.length, total: games.length });
      try {
        await api('/api/games/collect', {
          method: 'POST',
          json: { file, indexes: group.map((g) => g.index) },
        });
        done.push(...group);
      } catch (err) {
        // Caught per file, so one bad month does not abandon the rest of
        // the batch (or strand the busy button mid-count).
        failure = apiErrorMessage(err);
      }
    }

    setAddProgress(null);
    setBusy(false);
    setAdded((prev) => {
      const next = new Set(prev);
      for (const g of done) next.add(gameKey(g));
      return next;
    });
    setPicked(new Set());
    setSelecting(false);
    // The own-games index has just grown; what the map and the Grow
    // sheet learned about it a moment ago is now out of date.
    forgetMyGames();
    onCollected();
    if (failure) setError(failure);
  };

  const collect = async (game: GameSummary): Promise<boolean> => {
    try {
      await api('/api/games/collect', {
        method: 'POST',
        json: { file: game.file, index: game.index },
      });
      setAdded((prev) => new Set(prev).add(gameKey(game)));
      // The own-games index has just grown; what the map and the Grow
      // sheet learned about it a moment ago is now out of date.
      forgetMyGames();
      onCollected();
      return true;
    } catch (failure) {
      setError(t(apiErrorMessage(failure)));
      return false;
    }
  };

  /** The row, packaged for the details panel — summary, PGN loader and
      verbs, the same shape every list hands it. */
  const selectRow = (game: GameSummary): void => {
    onSelect?.({
      key: gameKey(game),
      summary: game,
      loadPgn: loadGamePgn(game),
      actions: (
        <ArchiveRowActions
          inCollection={
            added.has(gameKey(game)) ||
            collectionKeys.has(`${game.white}|${game.black}|${game.date}`)
          }
          onOpen={() => void openInAnalysis(game)}
          onCollect={() => collect(game)}
        />
      ),
    });
  };

  // The rows memoise on primitives, so every callback handed to them must
  // keep one identity for the component's life. Each forwards through a
  // ref to the LATEST handler — stable outside, fresh closure inside —
  // which is what lets ticking one checkbox re-render one row instead of
  // the whole month (measured before: 562 GameRow renders per tick on a
  // 281-game month; after: the two rows whose props changed).
  // ↑/↓/Enter/Escape drive the table selection over the visible rows —
  // the same contract as the databases and collection tabs.
  const tableNav = useTableNav(table && onSelect !== undefined);
  const navRows = visibleMonthGames.slice(0, MAX_ROWS);
  tableNav.current = {
    move: (delta) => {
      const at = navRows.findIndex((g) => gameKey(g) === selectedKey);
      const next =
        navRows[
          at < 0
            ? delta > 0
              ? 0
              : navRows.length - 1
            : Math.min(navRows.length - 1, Math.max(0, at + delta))
        ];
      if (next) selectRow(next);
    },
    open: () => {
      const g = navRows.find((g) => gameKey(g) === selectedKey);
      if (g) void openInAnalysis(g);
    },
    clear: () => onSelect?.(null),
  };

  const rowHandlers = useRef({ openInAnalysis, collect, selectRow });
  rowHandlers.current = { openInAnalysis, collect, selectRow };
  const rowOpen = useCallback((g: GameSummary) => void rowHandlers.current.openInAnalysis(g), []);
  const rowCollect = useCallback((g: GameSummary) => void rowHandlers.current.collect(g), []);
  const rowSelect = useCallback((g: GameSummary) => rowHandlers.current.selectRow(g), []);
  // The ⋯ → Game details sheet, for the card rows.
  const [details, setDetails] = useState<GameSummary | null>(null);
  // The pinned column exists only while selecting (checkbox-only) —
  // outside selection mode the archive table is the plain ten columns.
  const tableVars = useGameTableVars(selecting);
  const rowToggle = useCallback((key: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);


  /* Three selects, not eight chips on a rail.
     Seven chips and a select never fit the 30% column this panel
     lives in, so the row scrolled sideways behind a pair of arrows
     — which hides filters behind a gesture and gives no clue what
     is currently set without scrolling to look. A select states
     its own value, takes one line whatever the options are, and
     wraps onto a second when the column is narrow. */
  const filters = months.length > 0 ? (
    <>
          <Select
            value={month}
            onValueChange={(m) => void loadMonth(m)}
            ariaLabel={t('Archive month')}
            size="sm"
            className={cn('min-w-0 flex-1', merged && 'flex-none')}
            groups={[
              {
                options: [
                  {
                    value: ALL_MONTHS,
                    // The months below each state what they hold; this row
                    // states what the whole account holds — the provider's
                    // own lifetime figure, not just what is cached here.
                    // Offline (no stats to ask) it falls back to what is
                    // on disk, saying so.
                    label:
                      total !== null
                        ? `${t('All dates')} · ${t('{n} games', { n: total.toLocaleString() })}`
                        : cachedGames > 0
                          ? `${t('All dates')} · ${t('{n} games cached', { n: cachedGames })}`
                          : t('All dates'),
                    short: t('All dates'),
                  },
                  ...months.map((m) => ({
                    value: m.month,
                    label: `${m.month}${
                      m.cached
                        ? ` · ${t('{n} games', { n: m.games ?? 0 })}`
                        : offline
                          ? ` · ${t('needs internet')}`
                          : ''
                    }`,
                    // The month alone once it is chosen: how many games it
                    // holds is what you needed while picking one.
                    short: m.month,
                  })),
                ],
              },
            ]}
          />
          <SideSelect
            value={sideFilter}
            onChange={setSideFilter}
            className={merged ? 'flex-none' : undefined}
          />
          <ResultSelect
            value={resultFilter}
            onChange={setResultFilter}
            className={merged ? 'flex-none' : undefined}
          />
          {/* The same More-filters window the collection and the elite
              browser carry, answered client-side against the loaded
              month. No Tournament field — matchesStructured has no event
              answer, exactly as in the collection. */}
          <MoreFiltersButton
            on={hasStructuredFilters(structured)}
            onClick={() => {
              setQuickDraft({ side: sideFilter, result: resultFilter });
              setEditingFilters(true);
            }}
          />
          {editingFilters && (
            <StructuredFiltersWindow
              initial={structured}
              draftResult={quickDraft.result}
              showEvent={false}
              extraFields={
                // The row's selects, mirrored — side here is the SEARCHED
                // player's seat, a different question from the named
                // player's side above, which is why both exist.
                <Field label="Searched player's side and result">
                  <div className="flex gap-2">
                    <SideSelect
                      value={quickDraft.side}
                      onChange={(side) => setQuickDraft((d) => ({ ...d, side }))}
                    />
                    <ResultSelect
                      value={quickDraft.result}
                      onChange={(result) => setQuickDraft((d) => ({ ...d, result }))}
                    />
                  </div>
                </Field>
              }
              onClear={() => setQuickDraft({ side: 'any', result: 'any' })}
              onApply={(next) => {
                setEditingFilters(false);
                setStructured(next);
                setSideFilter(quickDraft.side);
                setResultFilter(quickDraft.result);
              }}
              onClose={() => setEditingFilters(false)}
            />
          )}
    </>
  ) : undefined;

  const notice =
    (offline && months.length > 0) || error ? (
      <>
        {offline && months.length > 0 && (
          <span className="text-warn text-sm">{t('offline — cached months only')}</span>
        )}
        {error && <span className="text-destructive text-sm">{error}</span>}
      </>
    ) : undefined;

  // The count and the way into selection mode — the count band's quiet
  // face. At table density it rides the merged toolbar row's right end
  // instead (see the toolbar below), so the band only exists while
  // SELECTING: the mode's controls earn a row of their own for exactly
  // as long as the mode is on.
  const countGroup =
    month && visibleMonthGames.length > 0 && !selecting ? (
      <>
        {/* How much of the archive is in hand. It used to be all of
            it, so there was nothing to say; now the list grows as it
            is scrolled and the count is the only thing that tells
            you Select all does not mean the whole decade. */}
        <span
          className={cn(
            'text-muted-foreground min-w-0 truncate text-sm tabular-nums font-medium',
            !merged && 'flex-1',
          )}
        >
          {month === ALL_MONTHS
            ? cursor >= months.length
              ? t('{n} games · all {total} months', {
                  n: visibleMonthGames.length,
                  total: months.length,
                })
              : t('{n} games · {at} of {total} months', {
                  n: visibleMonthGames.length,
                  at: cursor,
                  total: months.length,
                })
            : t('{n} games', { n: visibleMonthGames.length })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={pickable.length === 0}
          onClick={() => setSelecting(true)}
        >
          {t('Select…')}
        </Button>
      </>
    ) : undefined;

  // The shell draws the count band's box, so the two lists that take
  // turns in the games column share it by construction (lanph3re's call,
  // kept from when this row copied the elite panel's by hand).
  const countBand =
    month && visibleMonthGames.length > 0 ? (
      !selecting ? (
            merged ? undefined : countGroup
          ) : (
            /* What is selected on the left, what to do with it on the
               right. Four controls in one wrapping run gave the count the
               same weight as the buttons and put Cancel wherever the text
               happened to end. */
            <>
              {/* "New" can be nobody: a master checkbox that ticks nothing
                  reads as broken unless it says why. The per-row checkboxes
                  still take deliberate re-adds. */}
              <TitleTip
                title={
                  uncollected.length === 0
                    ? t('Every game shown is already in the collection')
                    : undefined
                }
              >
                <label
                  className={cn(
                    'flex min-w-0 items-center gap-1.5',
                    uncollected.length > 0 ? 'cursor-pointer' : 'opacity-60',
                  )}
                >
                  <Checkbox
                    // Indeterminate is the honest state for a partial
                    // selection: an unchecked box next to eight ticked rows
                    // reads as a bug.
                    checked={uncollected.length > 0 && picked.size === uncollected.length}
                    indeterminate={
                      picked.size > 0 && picked.size !== uncollected.length
                    }
                    disabled={uncollected.length === 0}
                    onCheckedChange={(on) =>
                      setPicked(on === true ? new Set(uncollected.map(gameKey)) : new Set())
                    }
                  />
                  <span className="text-muted-foreground truncate">
                    {uncollected.length === 0
                      ? t('Select all new — none are new')
                      : t('Select all new')}
                  </span>
                </label>
              </TitleTip>
              {/* A badge, not another grey sentence: it is the one number
                  that changes as you tick rows. */}
              <span
                className={cn(
                  'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                  picked.size > 0 ? 'bg-muted text-primary' : 'bg-accent text-muted-foreground',
                )}
              >
                {t('{n} selected', { n: picked.size })}
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelecting(false);
                    setPicked(new Set());
                  }}
                >
                  {t('Cancel')}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={picked.size === 0}
                  onClick={() => void collectMany(pickable.filter((g) => picked.has(gameKey(g))))}
                >
                  {busy
                    ? addProgress
                      ? t('Adding {done}/{total}…', addProgress)
                      : t('Adding…')
                    : t('Add selected')}
                </Button>
              </div>
            </>
          )
    ) : undefined;

  // The shell owns this band's box and padding; these are its contents.
  // No provider track: the page's tab strip made the site choice, and a
  // track of its own would say it twice. At table density this one
  // WRAPPING row is the whole resting chrome — the lookup, the filters
  // and the count folded together, the same fold the databases pane
  // made — and flex-wrap is the narrow-pane story. Card mode keeps the
  // stacked bands. Defined after the pieces it folds in, which is why
  // it sits below them rather than leading the bands as it used to.
  const toolbar = (
    <>
        <div className={cn('flex items-center gap-1', merged && 'w-full flex-wrap gap-1.5')}>
          {/* SearchInput, not a bare Input: a mistyped handle needed
              selecting and retyping — the X empties it in one press. */}
          <SearchInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && username.trim()) void loadMonths();
            }}
            placeholder={provider === 'chesscom' ? t('chess.com username') : t('Lichess username')}
            className={cn('min-w-0 flex-1', merged && 'basis-72')}
            inputSize="sm"
          />
          <Button
            variant="secondary"
            size="icon-sm"
            title={t("Browse this player's online archive")}
            disabled={loading !== null || !username.trim()}
            onClick={() => void loadMonths()}
          >
            {loading === 'months' ? (
              <Spinner className="size-3.5" />
            ) : (
              <Globe className="size-3.5" />
            )}
          </Button>
          {merged && (
            <>
              {filters}
              {countGroup && (
                <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5">
                  {countGroup}
                </span>
              )}
            </>
          )}
        </div>

    </>
  );

  const rows = month
    ? visibleMonthGames.slice(0, MAX_ROWS).map((game) => (
        <ArchiveRow
          key={gameKey(game)}
          game={game}
          table={table}
          selecting={selecting}
          picked={picked.has(gameKey(game))}
          inCollection={
            added.has(gameKey(game)) ||
            collectionKeys.has(`${game.white}|${game.black}|${game.date}`)
          }
          onOpen={rowOpen}
          onPreview={onPreview}
          onToggle={rowToggle}
          onCollect={rowCollect}
          onDetails={setDetails}
          selectedRow={selectedKey === gameKey(game)}
          onSelectRow={rowSelect}
        />
      ))
    : undefined;

  const footnote =
    month && visibleMonthGames.length > MAX_ROWS ? (
        // The short version on the line, the whole sentence on hover. It
        // was two clauses of body text across the foot of the panel, which
        // reads as an error rather than as a footnote about a list that is
        // longer than its box — and the reassuring half ("Select all new
        // still takes every one") was the half nobody finished reading.
        <TitleTip title={t('Showing the first {shown} of {total}. Select all new still takes every one.', {
            shown: MAX_ROWS,
            total: visibleMonthGames.length,
          })}>
          <p
            className="text-muted-foreground border-border flex items-center gap-1.5 border-t px-3 py-2 text-xs"
          >
            <Info className="size-3 shrink-0" />
            <span className="truncate">
              {t('First {shown} of {total}', { shown: MAX_ROWS, total: visibleMonthGames.length })}
            </span>
          </p>
        </TitleTip>
    ) : undefined;

  const tail = (
    <>
      {/* Looking one up is a wait, and the wait used to EMPTY the panel:
          the prompt vanished, the panel collapsed to its bar, and the
          results arrived somewhere below the fold. Rows in the same box
          instead, so the panel keeps its size and its place. */}
      {/* dense and the column header follow the density the list will
          settle at — this wait ends in a month auto-selected and drawn,
          and at table density that is one-line rows under the sticky
          header band: card-shaped placeholders here stood 509px against
          204 of rows (SkeletonGameRows' own measurement), and the 28px
          band popped in on top. */}
      {!month && loading === 'months' && (
        <div className="border-border min-h-0 flex-1 border-t" style={table ? tableVars : undefined}>
          {table && <GameTableHeader withStanding={selecting} />}
          <SkeletonGameRows rows={6} dense={table} />
        </div>
      )}

      {/* Nothing browsed yet: fill the panel with a prompt instead of
          leaving a bare bar over blank space. */}
      {!month && loading !== 'months' && (
        <div className="border-border flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border-t px-6 py-14 text-center">
          {/* What the panel does, drawn — rather than the same globe that
              is already on the button two inches above it.

              shrink-0, or the column crushes it: an SVG with a width and
              an automatic height is a flex item that will give up every
              pixel of that height before the paragraph beside it gives up
              one. In a sheet shortened by the keyboard it went to exactly
              0 and appeared to have been hidden on purpose. It is hidden
              hidden on purpose for a while, on the grounds that a picture
              is the first thing to go when there is no room. There is
              room: the window scrolls. */}
          <CloudBoardArt className="w-20 shrink-0" />
          <p className="text-muted-foreground max-w-xs text-base leading-relaxed">
            {t(
              'Browse your games. Type your {site} username above and pick a month — then add the ones worth keeping to your collection.',
              { site: provider === 'chesscom' ? 'chess.com' : 'Lichess' },
            )}
          </p>
        </div>
      )}
    </>
  );

  return (
    <>
    {details && (
      <GameDetailsSheet
        selection={{ key: gameKey(details), summary: details, loadPgn: loadGamePgn(details) }}
        onClose={() => setDetails(null)}
      />
    )}
    <GameListShell
      shape="panel"
      toolbar={toolbar}
      // No reserved filter row at table density, where the filters live
      // in the toolbar row and no filter band will come.
      filtersLoading={months.length === 0 && loading === 'months' && !merged}
      filters={merged ? undefined : filters}
      filtersRef={archiveTop}
      notice={notice}
      countBand={countBand}
      listHeader={table && rows ? <GameTableHeader withStanding={selecting} /> : undefined}
      listVars={table && rows ? tableVars : undefined}
      dense={table}
      list={rows}
      // Rows, not a spinner on an empty box: fetching a month used to
      // take the games away and leave one line of text where the list
      // had been, so the panel appeared to close and reopen.
      listLoading={Boolean(month) && loading === 'games' && visibleMonthGames.length === 0}
      // flex-1 at every width: the 24rem cap below sm was the old side
      // column's share; in the all-widths tabbed pane the list owns the
      // panel's height on a phone like every other tab's.
      listClassName="flex-1 overflow-y-auto"
      // The end of the list asks for the next months. Older play is
      // reached by scrolling towards it, which is the same gesture that
      // used to be a minute of waiting before anything showed.
      more={
        month === ALL_MONTHS && cursor < months.length
          ? { ref: moreSentinel, label: t('Loading older games…') }
          : null
      }
      footnote={footnote}
      tail={tail}
    />
    </>
  );
}
