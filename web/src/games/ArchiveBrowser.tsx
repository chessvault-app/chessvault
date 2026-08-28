import { Globe, Info, Plus, SlidersHorizontal, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';

import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { KnightIcon } from '@/components/knight-icon';
import { Segmented } from '@/components/segmented';
import { CloudBoardArt } from '@/components/cloud-board-art';

import { Select } from '@/components/ui/select';
import { SearchInput } from '@/components/text-fields';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';

import { SkeletonGameRows } from '@/components/skeletons';
import { forgetMyGames } from '@/openingmap/useGaps';

import { t } from '@/lib/i18n';
import { GameRow, gameKey, type GameSummary, type Preview } from './shared';
import { GameListShell, type GameListShape } from './GameListShell';
import { GameTableHeader, GameTableRow, useGameTableVars } from './GameTable';
import { GameDetailsSheet } from './GameDetails';
import { loadGamePgn } from './CollectionList';
import {
  EMPTY_STRUCTURED_FILTERS,
  hasStructuredFilters,
  matchesStructured,
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

/** Handles looked up before, on either site. */
const RECENTS_KEY = 'chess-vault:recent';
/** What the two per-site lists were called, before they became one. */
const LEGACY_RECENTS = ['chess-vault:recent-chesscom', 'chess-vault:recent-lichess'];

const readList = (key: string): string[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
};

/**
 * The shared list, or the two old ones folded into it.
 *
 * Somebody who has been using this has a history under each site; making
 * the list shared must not read as having lost it. The fold happens on
 * the first read and is written back by the first search after it.
 */
const readRecents = (): string[] => {
  const shared = readList(RECENTS_KEY);
  if (shared.length > 0) return shared.slice(0, 4);
  const merged: string[] = [];
  for (const who of LEGACY_RECENTS.flatMap(readList)) {
    if (!merged.some((seen) => seen.toLowerCase() === who.toLowerCase())) merged.push(who);
  }
  return merged.slice(0, 4);
};
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
}) {
  // Outside the hover tray in either presentation: Add is what this
  // list is FOR, and a selection checkbox that only appears under the
  // pointer is one you cannot tick with your eyes.
  const standing = (
    <>
      {selecting && (
        <Checkbox
          className="mr-1"
          aria-label={t('Select this game')}
          checked={picked}
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={(on) => onToggle(gameKey(game), on === true)}
        />
      )}
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
  if (table) {
    // The wide window's dense presentation. No details panel stands
    // beside this list, so a click opens — the card rows' own verb.
    return (
      <GameTableRow
        game={game}
        selected={false}
        onSelect={() => onOpen(game)}
        onOpen={() => onOpen(game)}
        standing={standing}
      />
    );
  }
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
    />
  );
});

export function ArchiveBrowser({
  collectionKeys,
  onCollected,
  onPreview,
  shape = 'framed',
  table = false,
}: {
  collectionKeys: Set<string>;
  onCollected: () => void;
  onPreview: (p: Preview | null) => void;
  /** Dense table rows instead of cards — the wide window's
      presentation. Explicit, never inferred: the phone sheet stays
      cards whatever the window says. */
  table?: boolean;
  /**
   * Where this is being shown — GameListShell's vocabulary, which owns
   * the paddings and rules each place needs. (This used to be a local
   * `framed | panel | window` enum; the shell's shapes are the same
   * three places under the one name every list of games now uses.)
   */
  shape?: GameListShape;
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
  const [recents, setRecents] = useState<string[]>(() => readRecents());
  const rememberRecent = (who: string): void => {
    setRecents((prev) => {
      const next = [who, ...prev.filter((p) => p.toLowerCase() !== who.toLowerCase())].slice(0, 4);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  };
  /** A mistyped handle should not sit there for the next four searches. */
  const forgetRecent = (who: string): void => {
    setRecents((prev) => {
      const next = prev.filter((p) => p !== who);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  };
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

  /** Games already on disk across every cached month — what "All dates"
      can show without touching the network. */
  const cachedGames = months.reduce((n, m) => (m.cached ? n + (m.games ?? 0) : n), 0);

  const loadMonths = async (who?: string): Promise<void> => {
    const user = (who ?? username).trim();
    if (!user) return;
    localStorage.setItem(userKey(provider), user);
    rememberRecent(user);
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
        useAnalysis.setState({ handoff: true });
        navigate('board');
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
    setProvider(next);
    setMonths([]);
    setMonth('');
    setMonthGames([]);
    setError(null);
  };

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

  const collect = async (game: GameSummary): Promise<void> => {
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
    } catch (failure) {
      setError(t(apiErrorMessage(failure)));
    }
  };

  // The rows memoise on primitives, so every callback handed to them must
  // keep one identity for the component's life. Each forwards through a
  // ref to the LATEST handler — stable outside, fresh closure inside —
  // which is what lets ticking one checkbox re-render one row instead of
  // the whole month (measured before: 562 GameRow renders per tick on a
  // 281-game month; after: the two rows whose props changed).
  const rowHandlers = useRef({ openInAnalysis, collect });
  rowHandlers.current = { openInAnalysis, collect };
  const rowOpen = useCallback((g: GameSummary) => void rowHandlers.current.openInAnalysis(g), []);
  const rowCollect = useCallback((g: GameSummary) => void rowHandlers.current.collect(g), []);
  // The ⋯ → Game details sheet, for the card rows.
  const [details, setDetails] = useState<GameSummary | null>(null);
  const tableVars = useGameTableVars(true);
  const rowToggle = useCallback((key: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);


  // The shell owns this band's box and padding; these are its contents.
  const toolbar = (
    <>
        {/* One track, one lit segment. As two chips it was impossible to
            tell by looking whether they were a choice or two independent
            toggles — and both being unlit is not a state this has. */}
        <Segmented
          value={provider}
          onChange={switchProvider}
          ariaLabel="Which site to browse"
          kind="tabs"
          className="w-full"
          segments={[
            {
              value: 'chesscom',
              // Each site answers in its own colour when it is the live
              // one: chess.com's green, Lichess's near-white.
              accent: '#8fbb5c',
              label: (
                <>
                  {/* chess.com's pawn, in its brand green */}
                  <svg viewBox="5 4.5 35 37" className="size-3.5 shrink-0" fill="#7fa650" aria-hidden>
                    <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" />
                  </svg>
                  <span className="truncate">chess.com</span>
                </>
              ),
            },
            {
              value: 'lichess',
              accent: '#f2f2f0',
              label: (
                <>
                  {/* lichess's knight mark */}
                  <KnightIcon className="size-3.5 shrink-0 fill-current" />
                  <span className="truncate">Lichess</span>
                </>
              ),
            },
          ]}
        />

        <div className="flex items-center gap-1">
          {/* SearchInput, not a bare Input: a mistyped handle needed
              selecting and retyping — the X empties it in one press. */}
          <SearchInput
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && username.trim()) void loadMonths();
            }}
            placeholder={provider === 'chesscom' ? t('chess.com username') : t('Lichess username')}
            className="min-w-0 flex-1"
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
        </div>

        {/* Who you have looked up before, on this provider. Typing a handle
            again is the one thing this panel asks for repeatedly, and the
            empty space under it was doing nothing. A list of names with no
            heading read as a result, not as history — and there was no way
            to drop one that had been mistyped. */}
        {months.length === 0 && recents.length > 0 && (
          <div className="mt-1 flex flex-col gap-1.5">
            <p className="text-muted-foreground text-sm font-medium">
              {t('Recent searches')}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {recents.map((who) => (
                <span
                  key={who}
                  className="border-border text-muted-foreground hover:border-border hover:text-foreground group/recent flex w-fit shrink-0 items-center rounded-full border pl-2.5 transition-colors duration-100"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setUsername(who);
                      void loadMonths(who);
                    }}
                    className="max-w-[9rem] truncate py-1 text-sm"
                  >
                    {who}
                  </button>
                  <button
                    type="button"
                    title={t('Forget this search')}
                    aria-label={t('Forget this search')}
                    onClick={() => forgetRecent(who)}
                    className="text-muted-foreground hover:text-destructive grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
    </>
  );

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
            className="min-w-0 flex-1"
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
          <SideSelect value={sideFilter} onChange={setSideFilter} />
          <ResultSelect value={resultFilter} onChange={setResultFilter} />
          {/* The same More-filters window the collection and the elite
              browser carry, answered client-side against the loaded
              month. No Tournament field — matchesStructured has no event
              answer, exactly as in the collection. */}
          <Button
            variant="secondary"
            size="icon-sm"
            active={hasStructuredFilters(structured)}
            title={t('More filters')}
            className="shrink-0"
            onClick={() => {
              setQuickDraft({ side: sideFilter, result: resultFilter });
              setEditingFilters(true);
            }}
          >
            <SlidersHorizontal className="size-3.5" />
          </Button>
          {editingFilters && (
            <StructuredFiltersWindow
              initial={structured}
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

  // The shell draws the count band's box, so the two lists that take
  // turns in the games column share it by construction (lanph3re's call,
  // kept from when this row copied the elite panel's by hand).
  const countBand =
    month && visibleMonthGames.length > 0 ? (
      !selecting ? (
            <>
              {/* How much of the archive is in hand. It used to be all of
                  it, so there was nothing to say; now the list grows as it
                  is scrolled and the count is the only thing that tells
                  you Select all does not mean the whole decade. */}
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm tabular-nums font-medium">
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
          ) : (
            /* What is selected on the left, what to do with it on the
               right. Four controls in one wrapping run gave the count the
               same weight as the buttons and put Cancel wherever the text
               happened to end. */
            <>
              <label
                className={cn(
                  'flex min-w-0 items-center gap-1.5',
                  uncollected.length > 0 ? 'cursor-pointer' : 'opacity-60',
                )}
                // "New" can be nobody: a master checkbox that ticks
                // nothing reads as broken unless it says why. The
                // per-row checkboxes still take deliberate re-adds.
                title={
                  uncollected.length === 0
                    ? t('Every game shown is already in the collection')
                    : undefined
                }
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
        <p
          className="text-muted-foreground border-border flex items-center gap-1.5 border-t px-3 py-2 text-xs"
          title={t('Showing the first {shown} of {total}. Select all new still takes every one.', {
            shown: MAX_ROWS,
            total: visibleMonthGames.length,
          })}
        >
          <Info className="size-3 shrink-0" />
          <span className="truncate">
            {t('First {shown} of {total}', { shown: MAX_ROWS, total: visibleMonthGames.length })}
          </span>
        </p>
    ) : undefined;

  const tail = (
    <>
      {/* Looking one up is a wait, and the wait used to EMPTY the panel:
          the prompt vanished, the panel collapsed to its bar, and the
          results arrived somewhere below the fold. Rows in the same box
          instead, so the panel keeps its size and its place. */}
      {!month && loading === 'months' && (
        <div className="border-border min-h-0 flex-1 border-t">
          <SkeletonGameRows rows={6} />
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
      shape={shape}
      // In the column it shares a panel with the Databases browser and the tab has
      // already said which one this is; framed it brings its own title.
      title={t('Online archives')}
      panelClassName="shrink-0 sm:min-h-0 sm:flex-1"
      toolbar={toolbar}
      filtersLoading={months.length === 0 && loading === 'months'}
      filters={filters}
      filtersRef={archiveTop}
      notice={notice}
      countBand={countBand}
      listHeader={table && rows ? <GameTableHeader withStanding /> : undefined}
      listVars={table && rows ? tableVars : undefined}
      dense={table}
      list={rows}
      // Rows, not a spinner on an empty box: fetching a month used to
      // take the games away and leave one line of text where the list
      // had been, so the panel appeared to close and reopen.
      listLoading={Boolean(month) && loading === 'games' && visibleMonthGames.length === 0}
      // Who scrolls, the list or the thing holding it.
      //
      // In a panel it is the list: it sits in a column beside the
      // collection and 24rem is the share of that column it may take. In
      // a SHEET on a phone the window is already a fixed-height card
      // with its own scroller, and the same cap stopped the list 24rem
      // down a sheet more than twice that tall — measured at 440x956: an
      // 841px sheet, a 384px list, 190px of empty surface under it and
      // the last row cut through the middle. So there the rows simply
      // flow and the sheet scrolls them, which is what the sheet is for.
      listClassName={
        shape === 'sheet'
          ? 'sm:max-h-none sm:flex-1 sm:overflow-y-auto'
          : 'max-h-96 overflow-y-auto sm:max-h-none sm:flex-1'
      }
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
