import { BookOpen, ChevronLeft, Compass, ExternalLink, Hammer, Loader2, RotateCw, SlidersHorizontal, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNode, pathTo } from '@shared/tree';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/cn';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { useAnalysis } from '@/store/analysis';
import { useStudy } from '@/store/study';
import {
  activeBook,
  hasMyFilters,
  isMyGames,
  isRemoteDb,
  MY_GAMES,
  REMOTE_DBS,
  useExplorer,
  type BookInfo,
  type BuildStatus,
  type ExplorerMove,
  type MyGamesFilters,
  type Opening,
  type Speed,
  type TopGame,
} from '@/store/explorer';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { DateInput, Input } from '@/ui/Input';
import { FilterChip } from '@/ui/FilterChip';
import { Panel, PanelHeader } from '@/ui/Panel';
import { Modal } from '@/ui/Modal';
import { SideDot } from '@/ui/SideDot';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { Switch } from '@/ui/Switch';
import { t } from '@/lib/i18n';
import { isDemo, DEMO_BOOK_PLIES } from '@/lib/demo';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat('en');

/** Continuations shown before the list folds behind “show all”. */
const MOVE_LIMIT = 8;

export function ExplorerPane({
  className,
  resizeKey,
}: {
  className?: string;
  resizeKey?: string;
}) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const playUci = useAnalysis((s) => s.playUci);

  const enabled = useExplorer((s) => s.enabled);
  const toggle = useExplorer((s) => s.toggle);
  const books = useExplorer((s) => s.books);
  const booksLoaded = useExplorer((s) => s.booksLoaded);
  const selectedBook = useExplorer((s) => s.book);
  const selectBook = useExplorer((s) => s.selectBook);
  const refreshBooks = useExplorer((s) => s.refreshBooks);
  const lookup = useExplorer((s) => s.lookup);
  const resultFen = useExplorer((s) => s.resultFen);
  const moves = useExplorer((s) => s.moves);
  const topGames = useExplorer((s) => s.topGames);
  const opening = useExplorer((s) => s.opening);
  const openingsSeen = useExplorer((s) => s.openingsSeen);
  const loading = useExplorer((s) => s.loading);
  const error = useExplorer((s) => s.error);
  const myFilters = useExplorer((s) => s.myFilters);
  const refreshMyStats = useExplorer((s) => s.refreshMyStats);

  const [showManager, setShowManager] = useState(false);
  // The My-games filters, as a window rather than two rows of the pane.
  const [showFilters, setShowFilters] = useState(false);
  // What the filters were when the window opened. The chips apply as they
  // are tapped — that is the point of the live count — so Cancel has to put
  // back what was there rather than merely stop editing.
  const filtersOnOpen = useRef<MyGamesFilters>({});
  const closeFilters = (revert: boolean): void => {
    if (revert) {
      const was = filtersOnOpen.current;
      useExplorer.getState().setMyFilters({
        side: was.side,
        outcome: was.outcome,
        speeds: was.speeds ?? [],
        from: was.from,
        to: was.to,
        collectionOnly: was.collectionOnly,
      });
    }
    setShowFilters(false);
  };
  // Rare continuations are noise most of the time — show the top handful
  // and keep the pane's room for the reference games below.
  const [allMoves, setAllMoves] = useState(false);

  const node = getNode(tree, cursorId);
  const book = activeBook({ book: selectedBook, books });
  const mine = isMyGames(book);
  const filtered = hasMyFilters(myFilters);

  useEffect(() => {
    void refreshBooks();
  }, [refreshBooks]);

  useEffect(() => {
    if (enabled && mine) void refreshMyStats();
  }, [enabled, mine, refreshMyStats]);

  useEffect(() => {
    if (enabled) lookup(node.fen);
  }, [node.fen, enabled, book, lookup]);

  // The name shown is the deepest *named* position on the current line: deep
  // middlegames keep their opening's name rather than dropping to nothing.
  const lineOpening = useMemo((): Opening | null => {
    if (opening && resultFen === node.fen) return opening;
    for (const id of [...pathTo(tree, cursorId)].reverse()) {
      const seen = openingsSeen[getNode(tree, id).fen];
      if (seen) return seen;
    }
    return null;
  }, [opening, resultFen, node.fen, tree, cursorId, openingsSeen]);

  const fresh = resultFen === node.fen;

  return (
    // While the explorer is off there is nothing to size: no resize grip,
    // no default height — the panel collapses to its header. The compact
    // default (when on) shows the top handful of moves; drag for more.
    <Panel
      flush
      className={className}
      resizeKey={enabled ? resizeKey : undefined}
      defaultHeight={enabled ? 300 : undefined}
    >
      <PanelHeader
        title={t('Explorer')}
        actions={
          <>
            {enabled && (
              <Select
                value={book ?? ''}
                onChange={selectBook}
                ariaLabel={t('Explorer source')}
                size="sm"
                align="end"
                className="max-w-[8rem]"
                groups={[
                  // First, and always present: it needs no build step, so
                  // it is the one source a new vault can already explore.
                  { label: 'Your vault', options: [{ value: MY_GAMES, label: 'My games' }] },
                  ...(books.length > 0
                    ? [
                        {
                          label: 'Local books',
                          options: books.map((b) => ({ value: b.name, label: b.name })),
                        },
                      ]
                    : []),
                  // The online databases are proxied through the server with
                  // its Lichess token. The demo has no server and cannot
                  // carry a token in a bundle everyone can read, so the
                  // option is not offered rather than offered and broken.
                  ...(isDemo()
                    ? []
                    : [
                        {
                          label: 'Online (via proxy)',
                          options: REMOTE_DBS.map((db) => ({ value: db.id, label: db.label })),
                        },
                      ]),
                ]}
              />
            )}
            {enabled && mine && (
              <Button
                variant="ghost"
                size="icon-sm"
                active={filtered}
                onClick={() => {
                  filtersOnOpen.current = useExplorer.getState().myFilters;
                  setShowFilters(true);
                }}
                title={t('Filters')}
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
            )}
            {enabled && (
              <Button
                variant="ghost"
                size="icon-sm"
                active={showManager}
                onClick={() => setShowManager((v) => !v)}
                title={t('Manage books')}
              >
                <BookOpen className="size-3.5" />
              </Button>
            )}
            <Switch
              checked={enabled}
              onToggle={toggle}
              label={t('Explorer on/off')}
              title={enabled ? t('Hide the explorer') : t('Show the explorer')}
            />
          </>
        }
      />

      {enabled && showManager && <BooksManager onClose={() => setShowManager(false)} />}

      {showFilters && (
        <Modal title="Filters" icon={SlidersHorizontal} onClose={() => closeFilters(true)}>
          {/* Every chip applies as it is tapped, so there is nothing to
              confirm — but a window still needs a stated way out, and it
              belongs on the same line as Clear rather than below it. */}
          <MyGamesFilterBar onCancel={() => closeFilters(true)} onDone={() => closeFilters(false)} />
        </Modal>
      )}

      {!enabled ? null : !showManager && (
        <>
          <div className="border-line flex h-8 shrink-0 items-center gap-2 border-b px-3">
            {lineOpening ? (
              <>
                <span className="text-subtle shrink-0 font-mono text-[0.6875rem] font-semibold">
                  {lineOpening.eco}
                </span>
                <span
                  className="text-fg min-w-0 truncate text-xs font-medium"
                  title={`${lineOpening.eco} ${lineOpening.name}`}
                >
                  {lineOpening.name}
                </span>
              </>
            ) : (
              <span className="text-subtle text-xs">
                {node.ply === 0 ? t('Starting position') : t('Out of book')}
              </span>
            )}
            {loading && <Loader2 className="text-subtle ml-auto size-3 shrink-0 animate-spin" />}
          </div>


          {error ? (
            // A bare red line was a dead end: the pane never asked again
            // until the position changed. Say what happened, offer to go
            // again in place.
            <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <p className="text-bad text-xs">{error}</p>
              {/* The online databases go through the server's Lichess
                  token; when they fail, the fix has an address. */}
              {isRemoteDb(book) && (
                <a href="#/settings" className="text-primary text-xs hover:underline">
                  {t('Add a Lichess token in Settings')}
                </a>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void refreshBooks();
                  lookup(node.fen);
                }}
              >
                <RotateCw className="size-3.5" />
                {t('Try again')}
              </Button>
            </div>
          ) : booksLoaded && books.length === 0 && !isRemoteDb(book) && !mine ? (
            <EmptyBooks onOpenManager={() => setShowManager(true)} />
          ) : (
            <div className={cn('min-h-0 overflow-y-auto', !fresh && 'opacity-60')}>
              {moves.length === 0 && fresh ? (
                <p className="text-subtle px-3 py-3 text-xs">
                  {mine
                    ? filtered
                      ? t('None of your games reached this position under these filters.')
                      : t('None of your games reached this position.')
                    : t('No games from this position in “{book}”.', { book: book ?? '' })}
                  {/* In the demo, running out of book is the expected edge of
                      a curated file rather than a gap in the data — say which,
                      or it reads as the app failing to answer. */}
                  {isDemo() && !mine && (
                    <>
                      {' '}
                      {t('The demo book covers the first {plies} plies.', {
                        plies: DEMO_BOOK_PLIES,
                      })}
                    </>
                  )}
                </p>
              ) : (
                <>
                  <table className="w-full text-xs">
                    <tbody>
                      {(allMoves ? moves : moves.slice(0, MOVE_LIMIT)).map((m) => (
                        <MoveRow key={m.uci} move={m} onPlay={() => playUci(m.uci)} />
                      ))}
                    </tbody>
                  </table>
                  {moves.length > MOVE_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setAllMoves((v) => !v)}
                      className="text-subtle hover:text-fg w-full px-3 py-1 text-left text-[0.6875rem] transition-colors duration-100"
                    >
                      {allMoves ? 'Show fewer moves' : `Show all ${moves.length} moves`}
                    </button>
                  )}
                </>
              )}
              {topGames.length > 0 && (
                <TopGamesList games={topGames} onPlay={playUci} mine={mine} />
              )}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/**
 * The filters that make your own games worth exploring.
 *
 * Chips rather than a form: every one is a single-tap question ("as Black",
 * "blitz", "only games I lost"), and a filter you cannot see is a filter
 * you forget is on — which would quietly make every number wrong. That is
 * also why the icon that opens this window lights up while anything is set.
 *
 * It lives in a modal, so it is laid out for a window rather than for the
 * strip of pane it used to be crammed into: one labelled group per thing
 * being filtered, chips that wrap, dates at their normal size.
 *
 * Deliberately NOT offered: rating bands. Your own rating moves with you,
 * so "against 1800+" means something different in January and December,
 * and a filter whose meaning drifts is worse than no filter.
 */
function MyGamesFilterBar({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const filters = useExplorer((s) => s.myFilters);
  const setFilters = useExplorer((s) => s.setMyFilters);
  const stats = useExplorer((s) => s.myStats);

  // Same words as the game browser's row, and an explicit Any/All chip
  // rather than "click the lit one again": one vocabulary for one question.
  const SIDES: { id: MyGamesFilters['side']; label: string }[] = [
    { id: undefined, label: 'Any' },
    { id: 'white', label: 'White' },
    { id: 'black', label: 'Black' },
  ];
  // The browser filters a raw score (it browses anyone's archive); these are
  // YOUR games, so the question is what you did with them. 1-0 would be a
  // lie on the games you played black.
  const OUTCOMES: { id: MyGamesFilters['outcome']; label: string }[] = [
    { id: undefined, label: 'All' },
    { id: 'win', label: 'Won' },
    { id: 'draw', label: 'Drew' },
    { id: 'loss', label: 'Lost' },
  ];
  const SPEEDS: { id: Speed; label: string }[] = [
    { id: 'bullet', label: 'Bullet' },
    { id: 'blitz', label: 'Blitz' },
    { id: 'rapid', label: 'Rapid' },
    { id: 'classical', label: 'Classical' },
  ];

  const speeds = filters.speeds ?? [];
  const toggleSpeed = (id: Speed): void =>
    setFilters({ speeds: speeds.includes(id) ? speeds.filter((s) => s !== id) : [...speeds, id] });

  return (
    <div className="flex flex-col gap-3">
      <FilterGroup label="Side">
        {SIDES.map(({ id, label }) => (
          <FilterChip
            key={label}
            label={label}
            active={filters.side === id}
            onClick={() => setFilters({ side: id })}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Result">
        {OUTCOMES.map(({ id, label }) => (
          <FilterChip
            key={label}
            label={label}
            active={filters.outcome === id}
            onClick={() => setFilters({ outcome: id })}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Time control">
        {SPEEDS.map(({ id, label }) => (
          <FilterChip
            key={id}
            label={label}
            active={speeds.includes(id)}
            onClick={() => toggleSpeed(id)}
          />
        ))}
      </FilterGroup>

      <FilterGroup label="Games">
        <FilterChip
          label="Kept only"
          title="Only the games in your collection, not every archived game"
          active={filters.collectionOnly === true}
          onClick={() => setFilters({ collectionOnly: filters.collectionOnly ? undefined : true })}
        />
      </FilterGroup>

      <FilterGroup label="Played between">
        <DateInput
          value={filters.from ?? ''}
          onChange={(e) => setFilters({ from: e.target.value || undefined })}
          aria-label={t('From date')}
          className="w-[9.5rem]"
        />
        <span className="text-subtle" aria-hidden>
          –
        </span>
        <DateInput
          value={filters.to ?? ''}
          onChange={(e) => setFilters({ to: e.target.value || undefined })}
          aria-label={t('To date')}
          className="w-[9.5rem]"
        />
      </FilterGroup>

      {/* The count is what makes the filters legible: it says what the row
          above just did to the corpus the explorer is answering from. */}
      <div className="border-line text-subtle flex items-center gap-2 border-t pt-3 text-xs">
        {stats && (
          <span className="mr-auto tabular-nums">
            {hasMyFilters(filters)
              ? t('{n} of {total} games match', {
                  n: exact.format(stats.matching),
                  total: exact.format(stats.games),
                })
              : t('{n} games indexed', { n: exact.format(stats.games) })}
          </span>
        )}
        {hasMyFilters(filters) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFilters({
                side: undefined,
                outcome: undefined,
                speeds: [],
                from: undefined,
                to: undefined,
                collectionOnly: undefined,
              })
            }
          >
            {t('Clear filters')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={onDone}>
          {t('Done')}
        </Button>
      </div>
    </div>
  );
}

/** One labelled row of the filter window: what it filters, then the chips. */
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-subtle text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {t(label)}
      </span>
      {/* Wrapping, not scrolling sideways: the window has the width now, and
          a chip half off the edge of a scroller is a filter nobody finds. */}
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function MoveRow({ move, onPlay }: { move: ExplorerMove; onPlay: () => void }) {
  return (
    <tr
      onClick={onPlay}
      className="hover:bg-surface-2 cursor-pointer transition-colors duration-100"
    >
      <td className="text-fg font-moves w-14 py-1 pl-3 pr-1 font-semibold">{move.san}</td>
      <td
        className="text-muted w-14 py-1 pr-2 text-right font-mono tabular-nums"
        title={`${exact.format(move.total)} games`}
      >
        {compact.format(move.total)}
      </td>
      <td className="py-1 pr-3">
        <ResultBar w={move.w} d={move.d} b={move.b} />
      </td>
    </tr>
  );
}

/** Lichess-style stacked white/draw/black percentage bar. */
function ResultBar({ w, d, b }: { w: number; d: number; b: number }) {
  const total = w + d + b;
  if (total === 0) return null;
  const pct = (n: number): number => (100 * n) / total;
  const segments = [
    { value: pct(w), className: 'bg-eval-white text-on-eval-white' },
    { value: pct(d), className: 'bg-surface-3 text-muted' },
    { value: pct(b), className: 'bg-eval-black text-on-eval-black' },
  ];
  return (
    <div
      className="border-line flex h-4 w-full overflow-hidden rounded-[4px] border font-mono text-[0.5625rem]"
      title={`White ${pct(w).toFixed(1)}% · Draw ${pct(d).toFixed(1)}% · Black ${pct(b).toFixed(1)}%`}
    >
      {segments.map(({ value, className }, i) => (
        <span
          key={i}
          style={{ width: `${value}%` }}
          className={cn('flex items-center justify-center overflow-hidden', className)}
        >
          {value >= 12 ? `${Math.round(value)}%` : ''}
        </span>
      ))}
    </div>
  );
}

function TopGamesList({
  games,
  onPlay,
  mine = false,
}: {
  games: TopGame[];
  onPlay: (uci: string) => boolean;
  /** Your own games are listed newest first, so "top" would be a lie. */
  mine?: boolean;
}) {
  /**
   * A top game is a reference into the reference-games database when one
   * is built from the same sources: clicking opens the WHOLE game on the
   * board (lanph3re's call). When the game isn't indexed there, fall back to
   * the old behaviour and just play the move.
   */
  /**
   * The explorer also lives inside study and game views, which keep their
   * document in the SAME analysis store with dirty-tracking autosave.
   * Detach (saving real edits) BEFORE loading another game, or the autosave
   * would write it over the open document.
   */
  const loadPgn = async (pgn: string): Promise<boolean> => {
    if (useStudy.getState().openId) await useStudy.getState().close();
    if (!useAnalysis.getState().loadPgn(pgn)) return false;
    useAnalysis.setState({ handoff: true });
    navigate('analysis');
    return true;
  };

  /**
   * How many games the panel shows before asking.
   *
   * A book used to hold at most eight games per position, so the list was
   * always short. It now keeps EVERY game of a quiet position — 116 of them
   * on a Lichess Elite month — which is the point, and which would bury the
   * moves above it if all of them rendered at once.
   */
  const VISIBLE = 8;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? games : games.slice(0, VISIBLE);

  const open = async (g: TopGame): Promise<void> => {
    try {
      // One of your own games says where it lives, so it opens directly —
      // no search, and it works for a game no reference database has ever
      // heard of, which is every game you have played.
      if (g.file !== undefined && g.index !== undefined) {
        const query = new URLSearchParams({ file: g.file, index: String(g.index) });
        const res = await fetch(`/api/games/pgn?${query}`);
        if (res.ok) {
          const { pgn } = (await res.json()) as { pgn: string };
          if (await loadPgn(pgn)) return;
        }
      } else {
        const query = new URLSearchParams({ white: g.white, black: g.black });
        if (g.date) query.set('date', g.date);
        if (g.result) query.set('result', g.result);
        const found = await fetch(`/api/refgames/find?${query}`);
        if (found.ok) {
          // `db` says which reference database held the match — absent on a
          // single-database mount (the demo), where the default is it.
          const { id, db } = (await found.json()) as { id: number; db?: string };
          const res = await fetch(`/api/refgames/${id}/pgn${db ? `?db=${encodeURIComponent(db)}` : ''}`);
          if (res.ok) {
            const { pgn } = (await res.json()) as { pgn: string };
            if (await loadPgn(pgn)) return;
          }
        }
      }
    } catch {
      // offline server hiccup — the fallback below still works
    }
    onPlay(g.uci);
  };

  return (
    <div className="border-line border-t px-1.5 pb-2">
      <p className="text-subtle px-1.5 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
        {mine ? t('Recent games') : t('Top games')}
      </p>
      <ul className="flex flex-col gap-px">
        {shown.map((g, i) => {
          const gameUrl = g.site?.startsWith('https://') ? g.site : null;
          return (
            <li key={i} className="flex items-center">
              <button
                type="button"
                onClick={() => void open(g)}
                title={t('Open this game')}
                className={cn(
                  'hover:bg-surface-2 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1',
                  'text-left text-xs transition-colors duration-100',
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <SideDot side="white" className="mr-1 inline-block size-2 align-[-1px]" />
                  <span className="text-fg">{g.white}</span>
                  <span className="text-subtle font-mono text-[0.625rem]"> {g.whiteElo || ''} </span>
                  <span className="text-subtle">v</span>
                  <SideDot side="black" className="mx-1 inline-block size-2 align-[-1px]" />
                  <span className="text-fg">{g.black}</span>
                  <span className="text-subtle font-mono text-[0.625rem]"> {g.blackElo || ''}</span>
                </span>
                <ResultBadge result={g.result} />
              </button>
              {gameUrl && (
                <a
                  href={gameUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`${gameUrl} (needs internet)`}
                  className="text-subtle hover:text-fg shrink-0 p-1"
                >
                  <ExternalLink className="size-3" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {games.length > VISIBLE && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-subtle hover:text-fg w-full px-1.5 pt-1 text-left text-[0.6875rem]"
        >
          {expanded ? t('Show fewer') : t('Show all {n}', { n: games.length })}
        </button>
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  const label = result === '1-0' ? '1-0' : result === '0-1' ? '0-1' : '½';
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 py-px font-mono text-[0.625rem] font-semibold',
        result === '1-0' && 'bg-eval-white text-on-eval-white',
        result === '0-1' && 'bg-eval-black text-on-eval-black',
        result !== '1-0' && result !== '0-1' && 'bg-surface-3 text-muted',
      )}
    >
      {label}
    </span>
  );
}

function EmptyBooks({ onOpenManager }: { onOpenManager: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <Compass className="text-subtle size-5" strokeWidth={1.75} />
      {/* The copy used to say to drop files into vault/sources/ — a
          shell instruction, stale since the manager grew its own upload.
          Point at the thing in the app instead. */}
      <p className="text-muted text-xs leading-relaxed">
        {t('No opening books yet — upload PGN files and build one in Manage books.')}
      </p>
      <Button variant="ghost" size="sm" onClick={onOpenManager}>
        <Hammer className="mr-1 size-3.5" />
        {t('Manage books')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Book manager: list/build/delete books over the /api/books endpoints.

/**
 * Build and manage opening books.
 *
 * Rendered both as a panel inside the explorer and as its own page under
 * Tools (`#/books`), because building a book from a season of your own
 * games is a sit-down job, not something to do in a 300 px sidebar.
 */
export function BooksManager({ onClose, page = false }: { onClose?: () => void; page?: boolean }) {
  const books = useExplorer((s) => s.books);
  const refreshBooks = useExplorer((s) => s.refreshBooks);
  const deleteBook = useExplorer((s) => s.deleteBook);
  const startBuild = useExplorer((s) => s.startBuild);
  const fetchBuildStatus = useExplorer((s) => s.fetchBuildStatus);

  const [sources, setSources] = useState<{ name: string; bytes: number }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  /**
   * Say when a collection is too small to be worth consulting.
   *
   * A book is a reference — what do strong players do here — and a handful
   * of games answers every position with one move at 100%, which reads as
   * authority and is noise. This warning used to be hedged, because vault
   * games were buildable into books and a three-game answer about YOUR
   * games is the point. They are not anymore: your own games are indexed
   * live and queried with filters (see server/myGames.ts), so the only
   * thing a book is now for is the case where small is simply wrong.
   *
   * Judged on bytes because that is all we know before parsing: a game is
   * roughly a kilobyte or two, so this is about three thousand games.
   */
  const BOOK_MIN_BYTES = 4_000_000;
  const pickedBytes = sources
    .filter((s) => picked.has(s.name))
    .reduce((sum, s) => sum + s.bytes, 0);
  const tooSmall = picked.size > 0 && pickedBytes < BOOK_MIN_BYTES;
  const wasRunning = useRef(false);

  const refreshSources = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/sources');
      const body = (await res.json()) as { sources: { name: string; bytes: number }[] };
      setSources(body.sources);
    } catch {
      setError(t('could not list the PGN collections'));
    }
  }, []);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  /**
   * Upload PGN collections.
   *
   * Sent one at a time as a raw body, which streams: these files run to
   * hundreds of megabytes, and FormData would buffer the whole thing in the
   * page before a byte left. The panel used to tell people to copy files
   * into vault/sources/ themselves, which a phone or a remote browser
   * cannot do.
   */
  const upload = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.pgn')) {
        setError(t('{name} is not a .pgn', { name: file.name }));
        continue;
      }
      setUploading(file.name);
      try {
        const res = await fetch(`/api/sources?name=${encodeURIComponent(file.name)}`, {
          method: 'POST',
          body: file,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(`${file.name}: ${t(body?.error ?? res.statusText)}`);
        }
      } catch {
        setError(t('{name}: upload failed', { name: file.name }));
      }
    }
    setUploading(null);
    await refreshSources();
  };

  // The vault may be on a server across the network, so uploading a
  // collection is the only way in — and dragging one onto the window is
  // the gesture a desktop expects for that. `upload` takes a FileList, so
  // the dropped files are handed over as one.
  const pgnDrop = useFileDrop({
    accept: byExtension('.pgn'),
    disabled: uploading !== null,
    onFiles: (files) => {
      const list = new DataTransfer();
      for (const f of files) list.items.add(f);
      void upload(list.files);
    },
  });

  // Poll the build while one runs; refresh the shelf when it finishes.
  useEffect(() => {
    const tick = async (): Promise<void> => {
      const s = await fetchBuildStatus();
      setStatus(s);
      if (s?.running) {
        wasRunning.current = true;
      } else if (wasRunning.current) {
        wasRunning.current = false;
        void refreshBooks();
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1500);
    return () => clearInterval(interval);
  }, [fetchBuildStatus, refreshBooks]);

  const build = async (buildName: string, buildSources: string[]): Promise<void> => {
    setError(null);
    const failure = await startBuild({ name: buildName, sources: buildSources });
    if (failure) {
      setError(failure);
      return;
    }
    setStatus({ running: true, name: buildName, log: [] });
    wasRunning.current = true;
  };

  const running = status?.running === true;

  return (
    <div
      className={
        page
          ? 'mx-auto flex max-w-2xl flex-col gap-3 p-4 pb-10 text-xs md:p-6'
          : 'border-line bg-surface-inset flex min-h-0 flex-col gap-3 overflow-y-auto border-b px-3 py-3 text-xs'
      }
    >
      {/* As a page this is the whole screen, and it had no title and no way
          back — every other page in the app has both. In the explorer's
          panel the surrounding header already says where you are. */}
      {page && (
        <header className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Back to the board')}
            onClick={() => navigate('analysis', 'explorer')}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg text-sm font-semibold tracking-tight">{t('Opening books')}</h1>
        </header>
      )}

      {books.length > 0 && (
        <ul className="flex flex-col gap-1">
          {books.map((b) => (
            <BookRow
              key={b.name}
              book={b}
              busy={running}
              onRebuild={() => void build(b.name, b.sources)}
              onDelete={async () => {
                const failure = await deleteBook(b.name);
                if (failure) setError(failure);
              }}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <p className="text-subtle font-semibold uppercase tracking-[0.08em] text-[0.625rem]">
          {t('Build a book')}
        </p>
        {/* Where your own games went. Books used to be able to index them,
            which is what people reach for here first — say plainly that the
            thing they wanted exists and is better, rather than letting them
            conclude the feature was dropped. */}
        <p className="text-muted leading-relaxed">
          {t('For your own games, pick “My games” in the explorer instead — they are always up to date and can be filtered by side, result, speed and date. A book is for a large reference database.')}
        </p>
        {sources.length === 0 ? (
          <p className="text-muted leading-relaxed">
            {t('No PGN collections yet. Add one below. A book wants thousands of games to be worth consulting, so the usual sources are whole-month or whole-database exports — Lichess Elite months, Gigabase.')}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              {sources.map((s) => (
                <label key={s.name} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={picked.has(s.name)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(s.name);
                      else next.delete(s.name);
                      setPicked(next);
                    }}
                    className="accent-primary"
                  />
                  <span className="text-fg min-w-0 flex-1 truncate font-mono">{s.name}</span>
                  <span className="text-subtle shrink-0 tabular-nums">
                    {s.bytes < 1e6
                      ? `${Math.max(1, Math.round(s.bytes / 1e3))} KB`
                      : `${(s.bytes / 1e6).toFixed(0)} MB`}
                  </span>
                </label>
              ))}
            </div>
            {tooSmall && (
              <p className="text-muted mt-1 leading-relaxed">
                {t(
                  'Small collection. A book is a reference for what is normally played, and too few games will mislead: every position answers with one move at 100%.',
                )}
              </p>
            )}
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('book name')}
                inputSize="sm"
                className="flex-1 font-mono"
              />
              <Button
                variant="primary"
                size="sm"
                disabled={running || picked.size === 0 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)}
                onClick={() => void build(name, [...picked])}
              >
                {t('Build')}
              </Button>
            </div>
          </>
        )}

        {/* Adding a collection has to be possible here: the vault may be on
            a server across the network, and a phone has no way to copy a
            file into it. */}
        <label
          {...pgnDrop.handlers}
          className={cn(
            'mt-1 flex cursor-pointer items-center gap-2 self-start rounded-md',
            'border border-dashed px-2 py-1 transition-colors',
            pgnDrop.dragging ? 'border-primary bg-primary-soft' : 'border-transparent',
          )}
        >
          <input
            type="file"
            accept=".pgn"
            multiple
            disabled={uploading !== null}
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="border-line text-muted hover:border-line-strong hover:text-fg flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors">
            {uploading ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
            {uploading ? t('Uploading {name}…', { name: uploading }) : t('Add PGN files')}
          </span>
        </label>
      </div>

      {(running || (status?.log?.length ?? 0) > 0) && (
        <div className="flex flex-col gap-1">
          <p className="text-subtle flex items-center gap-1.5 font-semibold uppercase tracking-[0.08em] text-[0.625rem]">
            {running && <Loader2 className="size-3 animate-spin" />}
            {running
              ? `Building “${status?.name}”…`
              : status?.exitCode === 0
                ? `Built “${status?.name}”`
                : `Build of “${status?.name}” failed`}
          </p>
          <pre className="bg-surface text-subtle max-h-24 overflow-y-auto rounded-md p-2 font-mono text-[0.625rem] leading-relaxed">
            {(status?.log ?? []).slice(-6).join('\n') || '…'}
          </pre>
        </div>
      )}

      {error && <p className="text-bad">{error}</p>}

      {onClose && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Close')}
          </Button>
        </div>
      )}
    </div>
  );
}

function BookRow({
  book,
  busy,
  onRebuild,
  onDelete,
}: {
  book: BookInfo;
  busy: boolean;
  onRebuild: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="bg-surface border-line flex items-center gap-2 rounded-md border px-2 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-fg truncate font-mono font-semibold">{book.name}</p>
        {/* On screen, not only in the Rebuild tooltip: a phone has no hover,
            and "rebuild" means nothing until you know it re-reads THESE
            files — links into vault/sources, never copies, so a rebuild
            picks up whatever they say now. */}
        <p className="text-subtle truncate text-[0.625rem]">
          {book.sources.length > 0
            ? t('Rebuilds from {sources}', { sources: book.sources.join(', ') })
            : t('Came with the app — nothing to rebuild from')}
        </p>
        <p className="text-subtle tabular-nums">
          {t('{games} games · {positions} positions · {mb} MB', {
            games: compact.format(book.games),
            positions: compact.format(book.positions),
            mb: (book.bytes / 1e6).toFixed(0),
          })}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={busy || book.sources.length === 0}
        onClick={onRebuild}
        title={
          book.sources.length > 0
            ? t('Rebuild from {sources}', { sources: book.sources.join(', ') })
            : t('Original sources unknown')
        }
      >
        <Hammer className="size-3.5" />
      </Button>
      <ConfirmSheet
        icon={Trash2}
        triggerTitle="Delete this book (the source PGNs stay)"
        question="Delete this opening book?"
        confirmLabel="Delete"
        disabled={busy}
        onConfirm={onDelete}
      />
    </li>
  );
}
