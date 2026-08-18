import { Database, ExternalLink, Hammer, Loader2, RotateCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getNode, pathTo } from '@shared/tree';
import { api } from '@/lib/api';
import { navigate, navigateNow } from '@/lib/router';
import { confirmLeave } from '@/lib/leaveGuard';
import { cn } from '@/lib/cn';
import { useAnalysis } from '@/store/analysis';
import { useStudy } from '@/store/study';
import {
  activeBook,
  bookLabel,
  hasMyFilters,
  hasRefFilters,
  isMyGames,
  isRefDb,
  isRemoteDb,
  MY_GAMES,
  REF_DB,
  refDbName,
  REMOTE_DBS,
  useExplorer,
  type ExplorerMove,
  type MyGamesFilters,
  type Opening,
  type RefDbFilters,
  type Speed,
  type TopGame,
} from '@/store/explorer';
import { Button } from '@/ui/Button';
import { ResultBar } from '@/ui/ResultBar';
import { Select } from '@/ui/Select';
import { DateInput } from '@/ui/Input';
import { FilterChip } from '@/ui/FilterChip';
import { Panel, PanelHeader } from '@/ui/Panel';
import { Modal } from '@/ui/Modal';
import { SideDot } from '@/ui/SideDot';
import { Switch } from '@/ui/Switch';
import { t } from '@/lib/i18n';
import { isDemo } from '@/lib/demo';

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
  const selectedBook = useExplorer((s) => s.book);
  const selectBook = useExplorer((s) => s.selectBook);
  const refreshDbs = useExplorer((s) => s.refreshDbs);
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
  const refDbs = useExplorer((s) => s.refDbs);
  const refFilters = useExplorer((s) => s.refFilters);
  const refIndexed = useExplorer((s) => s.refIndexed);

  // The My-games filters, as a window rather than two rows of the pane.
  const [showFilters, setShowFilters] = useState(false);
  // What the filters were when the window opened. The chips apply as they
  // are tapped — that is the point of the live count — so Cancel has to put
  // back what was there rather than merely stop editing.
  const filtersOnOpen = useRef<MyGamesFilters>({});
  const refFiltersOnOpen = useRef<RefDbFilters>({});
  const closeFilters = (revert: boolean): void => {
    if (revert) {
      if (mine) {
        const was = filtersOnOpen.current;
        useExplorer.getState().setMyFilters({
          side: was.side,
          outcome: was.outcome,
          speeds: was.speeds ?? [],
          from: was.from,
          to: was.to,
          collectionOnly: was.collectionOnly,
        });
      } else {
        const was = refFiltersOnOpen.current;
        useExplorer.getState().setRefFilters({
          result: was.result,
          minElo: was.minElo,
          from: was.from,
          to: was.to,
        });
      }
    }
    setShowFilters(false);
  };
  // Rare continuations are noise most of the time — show the top handful
  // and keep the pane's room for the reference games below.
  const [allMoves, setAllMoves] = useState(false);

  const node = getNode(tree, cursorId);
  const book = activeBook({ book: selectedBook, refDbs });
  const mine = isMyGames(book);
  const refdb = isRefDb(book);
  const filtered = mine ? hasMyFilters(myFilters) : refdb && hasRefFilters(refFilters);

  useEffect(() => {
    void refreshDbs();
  }, [refreshDbs]);

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
      // Exactly one min-height, chosen here because only this component
      // knows whether there is anything to be tall FOR. Open, it keeps a
      // floor so the column capping itself to the board cannot squeeze the
      // move table to nothing; closed, it collapses to its header — a floor
      // applied either way drew a 12rem empty box under a switched-off
      // explorer, which is what lanph3re spotted in my own screenshot.
      //
      // The floor is where the panel STOPS shrinking, and it only started
      // doing that when Panel's default height became a cap it can yield
      // (ui/Panel) — before, the inline `min-height: 0` that came with the
      // default height cancelled this line outright. A share as well as a
      // size, so that the floor itself always fits in the column.
      className={cn(className, enabled ? 'lg:min-h-[min(12rem,20%)]' : 'lg:min-h-0')}
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
                  // The unified index: the same databases the elite
                  // browser reads, exploring — and, unlike the old
                  // summed-away books, exploring FILTERED (see
                  // server/refgamesIndex.ts).
                  ...(refDbs.length > 0
                    ? [
                        {
                          label: 'Reference databases',
                          options: refDbs.map((d) => ({
                            value: `${REF_DB}${d.name}`,
                            label: bookLabel(d.name),
                          })),
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
            {enabled && (mine || refdb) && (
              <Button
                variant="ghost"
                size="icon-sm"
                active={filtered}
                onClick={() => {
                  filtersOnOpen.current = useExplorer.getState().myFilters;
                  refFiltersOnOpen.current = useExplorer.getState().refFilters;
                  setShowFilters(true);
                }}
                title={t('Filters')}
              >
                <SlidersHorizontal className="size-3.5" />
              </Button>
            )}
            {enabled && (
              // Goes to the Databases page. It opened the manager in a
              // window over the pane for a while; a window that uploads
              // and deletes does not belong one press from the board.
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => navigate('databases')}
                title={t('Manage reference databases')}
              >
                <Database className="size-3.5" />
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

      {showFilters && (
        <Modal title="Filters" icon={SlidersHorizontal} onClose={() => closeFilters(true)}>
          {/* Every chip applies as it is tapped, so there is nothing to
              confirm — but a window still needs a stated way out, and it
              belongs on the same line as Clear rather than below it. */}
          {mine ? (
            <MyGamesFilterBar onCancel={() => closeFilters(true)} onDone={() => closeFilters(false)} />
          ) : (
            <RefDbFilterBar onCancel={() => closeFilters(true)} onDone={() => closeFilters(false)} />
          )}
        </Modal>
      )}

      {!enabled ? null : (
        <>
          <div className="border-line flex h-8 shrink-0 items-center gap-2 border-b px-3">
            {lineOpening ? (
              <>
                <span className="text-subtle shrink-0 font-mono text-xs font-semibold">
                  {lineOpening.eco}
                </span>
                <span
                  className="text-fg min-w-0 truncate text-sm font-medium"
                  title={`${lineOpening.eco} ${lineOpening.name}`}
                >
                  {lineOpening.name}
                </span>
              </>
            ) : (
              <span className="text-subtle text-sm">
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
              <p className="text-bad text-sm">{error}</p>
              {/* The online databases go through the server's Lichess
                  token; when they fail, the fix has an address. */}
              {isRemoteDb(book) && (
                <a href="#/settings" className="text-primary text-sm hover:underline">
                  {t('Add a Lichess token in Settings')}
                </a>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  void refreshDbs();
                  lookup(node.fen);
                }}
              >
                <RotateCw className="size-3.5" />
                {t('Try again')}
              </Button>
            </div>
          ) : refdb && fresh && !refIndexed ? (
            <IndexPositionsCta
              name={refDbName(book!)}
              onDone={() => {
                void refreshDbs();
                lookup(node.fen);
              }}
            />
          ) : (
            <div className={cn('min-h-0 overflow-y-auto', !fresh && 'opacity-60')}>
              {moves.length === 0 && fresh ? (
                <p className="text-subtle px-3 py-3 text-sm">
                  {mine
                    ? filtered
                      ? t('None of your games reached this position under these filters.')
                      : t('None of your games reached this position.')
                    : t('No games from this position in “{book}”.', {
                      book: refdb ? bookLabel(refDbName(book!)) : bookLabel(book ?? ''),
                    })}
                  {/* In the demo, running out is the expected edge of a
                      curated slice rather than a gap in the data — say
                      which, or it reads as the app failing to answer. */}
                  {isDemo() && !mine && (
                    <>
                      {' '}
                      {t('The demo database holds a curated slice of games.')}
                    </>
                  )}
                </p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <tbody>
                      {(allMoves ? moves : moves.slice(0, MOVE_LIMIT)).map((m, at) => (
                        <MoveRow
                          key={m.uci}
                          move={m}
                          alt={at % 2 === 1}
                          onPlay={() => playUci(m.uci)}
                        />
                      ))}
                    </tbody>
                  </table>
                  {moves.length > MOVE_LIMIT && (
                    <button
                      type="button"
                      onClick={() => setAllMoves((v) => !v)}
                      className="text-subtle hover:text-fg w-full px-3 py-1 text-left text-xs transition-colors duration-100"
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
 * The filters over a reference database — the question a book could
 * never answer, and the reason the position index exists: result, a
 * floor under both players' ratings, and dates. Same chips-in-a-window
 * shape as My games' filters, applied live like them.
 */
function RefDbFilterBar({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const filters = useExplorer((s) => s.refFilters);
  const setFilters = useExplorer((s) => s.setRefFilters);

  const RESULTS: { id: RefDbFilters['result']; label: string }[] = [
    { id: undefined, label: 'All' },
    { id: '1-0', label: 'White won' },
    { id: '0-1', label: 'Black won' },
    { id: '1/2-1/2', label: 'Drawn' },
  ];
  const STRENGTHS: { id: number | undefined; label: string }[] = [
    { id: undefined, label: 'Any' },
    { id: 2300, label: '2300+' },
    { id: 2500, label: '2500+' },
    { id: 2700, label: '2700+' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <FilterGroup label="Result">
        {RESULTS.map(({ id, label }) => (
          <FilterChip
            key={label}
            label={label}
            active={filters.result === id}
            onClick={() => setFilters({ result: id })}
          />
        ))}
      </FilterGroup>

      {/* Both players over the floor — a 2700 flagged against a 2200 is
          not a 2700-level game. */}
      <FilterGroup label="Strength">
        {STRENGTHS.map(({ id, label }) => (
          <FilterChip
            key={label}
            label={label}
            active={filters.minElo === id}
            onClick={() => setFilters({ minElo: id })}
          />
        ))}
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

      <div className="mt-1 flex items-center justify-end gap-2 text-sm">
        {hasRefFilters(filters) && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() =>
              setFilters({ result: undefined, minElo: undefined, from: undefined, to: undefined })
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

/**
 * A reference database from before the position index existed: offer to
 * add it, in place — a pure derived pass over the games already in the
 * file, run as a server job with its progress shown here.
 */
function IndexPositionsCta({ name, onDone }: { name: string; onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'running' | 'failed'>('idle');
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (state !== 'running') return;
    let live = true;
    const tick = async (): Promise<void> => {
      try {
        const s = await api<{
          running: boolean;
          exitCode?: number | null;
          log?: string[];
        }>('/api/refgames/build/status');
        if (!live) return;
        setLine(s.log?.at(-1) ?? null);
        if (!s.running) {
          if ((s.exitCode ?? 1) === 0) onDone();
          else setState('failed');
        }
      } catch {
        /* next tick asks again */
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1500);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [state, onDone]);

  const start = async (): Promise<void> => {
    setState('running');
    setLine(null);
    try {
      await api('/api/refgames/index-positions', { method: 'POST', json: { db: name } });
    } catch {
      // A refusal and an unreachable server both mean the job never
      // started, and the poll would otherwise spin on 'running' forever.
      setState('failed');
    }
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <p className="text-muted text-sm leading-relaxed">
        {t(
          '“{name}” has no position index yet. Indexing reads the games already in it — nothing to upload — and takes a minute or two.',
          { name: bookLabel(name) },
        )}
      </p>
      {state === 'running' ? (
        <p className="text-subtle flex items-center gap-2 font-mono text-xs">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          <span className="min-w-0 truncate">{line ?? '…'}</span>
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => void start()}>
            <Hammer className="size-3.5" />
            {t('Index positions')}
          </Button>
          {state === 'failed' && (
            <span className="text-bad text-sm">{t('indexing failed — see the Databases page')}</span>
          )}
        </div>
      )}
    </div>
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
      {/* What "My games" actually is, said outright: the corpus quietly
          includes every archive month the browser has cached, and nothing
          on screen admitted it (lanph3re's report). This window is where
          the corpus gets interrogated, so this is where it introduces
          itself. */}
      <p className="text-muted text-sm leading-relaxed">
        {t(
          'Answers come from your collection plus every chess.com and Lichess month you have browsed — a month, once viewed, keeps counting here. "Kept only" narrows to the collection.',
        )}
      </p>
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
      <div className="text-subtle mt-1 flex items-center gap-2 text-sm">
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
      <span className="text-subtle text-xs font-semibold uppercase tracking-[0.08em]">
        {t(label)}
      </span>
      {/* Wrapping, not scrolling sideways: the window has the width now, and
          a chip half off the edge of a scroller is a filter nobody finds. */}
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

function MoveRow({
  move,
  alt,
  onPlay,
}: {
  move: ExplorerMove;
  /** Every other row, tinted — see the class below. */
  alt: boolean;
  onPlay: () => void;
}) {
  return (
    <tr
      onClick={onPlay}
      // Striped, like the map's two lists: a move, a count and a bar,
      // twelve rows deep, is the shape an eye loses its place in, and
      // the bands are what carry it from the move to its bar. Written
      // as a plain class rather than an `even:` variant so the hover
      // wins it outright on specificity — the row under the pointer has
      // to read as the row under the pointer.
      className={cn(
        'hover:bg-surface-2 cursor-pointer transition-colors duration-100',
        alt && 'bg-surface-2/50',
      )}
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
   * document in the SAME analysis store. Detach BEFORE loading another
   * game, or the load would land on top of the open document.
   *
   * The question has to be asked HERE rather than left to `navigate`,
   * because `close()` throws the buffer away and would have already run
   * by the time the router got a say. Once it is answered the document is
   * clean, so `navigateNow` is right: asking twice about the same changes
   * is asking about nothing.
   */
  const loadPgn = async (pgn: string): Promise<boolean> => {
    if (useStudy.getState().openId) {
      if (!(await confirmLeave())) return false;
      await useStudy.getState().close();
    }
    if (!useAnalysis.getState().loadPgn(pgn)) return false;
    useAnalysis.setState({ handoff: true });
    navigateNow('board');
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
        const { pgn } = await api<{ pgn: string }>(`/api/games/pgn?${query}`);
        if (await loadPgn(pgn)) return;
      } else {
        const query = new URLSearchParams({ white: g.white, black: g.black });
        if (g.date) query.set('date', g.date);
        if (g.result) query.set('result', g.result);
        // `db` says which reference database held the match — absent on a
        // single-database mount (the demo), where the default is it.
        const { id, db } = await api<{ id: number; db?: string }>(`/api/refgames/find?${query}`);
        const { pgn } = await api<{ pgn: string }>(
          `/api/refgames/${id}/pgn${db ? `?db=${encodeURIComponent(db)}` : ''}`,
        );
        if (await loadPgn(pgn)) return;
      }
    } catch {
      // offline hiccup or a game the server cannot find — the fallback
      // below still works
    }
    onPlay(g.uci);
  };

  return (
    <div className="border-line border-t px-1.5 pb-2">
      <p className="text-subtle px-1.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.08em]">
        {mine ? t('Recent games') : t('Top games')}
      </p>
      <ul className="flex flex-col gap-px">
        {shown.map((g) => {
          const gameUrl = g.site?.startsWith('https://') ? g.site : null;
          // Keyed on the game's identity — the same facts open() locates
          // it by — not the row number: the whole list is replaced per
          // position, and an index key told React the new position's
          // rows were the old ones edited in place.
          const key =
            g.file !== undefined && g.index !== undefined
              ? `${g.file}#${g.index}`
              : `${g.white}|${g.black}|${g.date ?? ''}|${g.result}|${g.site ?? ''}`;
          return (
            <li key={key} className="flex items-center">
              <button
                type="button"
                onClick={() => void open(g)}
                title={t('Open this game')}
                className={cn(
                  'hover:bg-surface-2 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1',
                  'text-left text-sm transition-colors duration-100',
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <SideDot side="white" className="mr-1 inline-block size-2 align-[-1px]" />
                  <span className="text-fg">{g.white}</span>
                  <span className="text-subtle font-mono text-xs"> {g.whiteElo || ''} </span>
                  <span className="text-subtle">v</span>
                  <SideDot side="black" className="mx-1 inline-block size-2 align-[-1px]" />
                  <span className="text-fg">{g.black}</span>
                  <span className="text-subtle font-mono text-xs"> {g.blackElo || ''}</span>
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
          className="text-subtle hover:text-fg w-full px-1.5 pt-1 text-left text-xs"
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
        'shrink-0 rounded px-1 py-px font-mono text-xs font-semibold',
        result === '1-0' && 'bg-eval-white text-on-eval-white',
        result === '0-1' && 'bg-eval-black text-on-eval-black',
        result !== '1-0' && result !== '0-1' && 'bg-surface-3 text-muted',
      )}
    >
      {label}
    </span>
  );
}
