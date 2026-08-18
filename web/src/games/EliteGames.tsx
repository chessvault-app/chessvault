import { ChevronLeft, Database, Eye, Loader2, Plus, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetCollection, loadCollection } from './collection';

import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';

import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';

import { Button } from '@/ui/Button';
import { PageShell } from '@/ui/PageShell';

import { Select } from '@/ui/Select';
import { SearchInput } from '@/ui/Input';
import {
  EMPTY_STRUCTURED_FILTERS,
  FilterRow,
  ResultSelect,
  StrengthSelect,
  StructuredFiltersWindow,
  type ResultFilter,
  type StructuredFilters,
} from './GameFilters';
import { Field } from '@/ui/Field';
import { SideDot } from '@/ui/SideDot';
import { SkeletonGameRows, useSlowLoad } from '@/ui/Skeleton';
import { Panel, PanelHeader } from '@/ui/Panel';

import type { RefDb } from '@/databases/RefDbManager';
import { t } from '@/lib/i18n';
import { GamePreview, OpeningTag, ResultScore, isCoarsePointer, type Preview } from './shared';

interface RefGame {
  id: number;
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: string;
  date: string | null;
  event: string | null;
  eco: string | null;
  opening: string | null;
}

/**
 * Browse the reference database (data/refgames.sqlite — Lichess Elite or
 * whatever PGN collections were indexed). Click a game to open it on the
 * analysis board.
 *
 * Three shapes, one component, because it is one thing:
 *
 * `column` — the second half of the column that finds games, behind the
 * tab beside Online archives. Where it belongs on a desktop: the archive
 * and the reference database answer the same question, so they take turns
 * in one panel rather than each taking a box.
 *
 * `window` — below lg, where there is no column. A bottom sheet on a
 * phone, like the archive. It used to navigate to a page of its own,
 * which loses the collection you were about to add to.
 *
 * `page` — its own route, still reachable and still where a 2M-row
 * browser has the most room. The only shape that draws its own frame, its
 * own title and a way back.
 */
export function EliteGames({ variant = 'window' }: { variant?: 'page' | 'window' | 'column' }) {
  const page = variant === 'page';
  // `databases` present = the server's directory mount, where databases
  // are named, picked, built and deleted. Absent = a single-database
  // mount (the static demo), which has none of that.
  const [meta, setMeta] = useState<{
    ready: boolean;
    games?: number;
    sources?: string;
    databases?: RefDb[];
  } | null>(null);
  const [curDb, setCurDb] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<RefGame[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  // Nothing for the first moment — a search that answers in 40 ms should
  // not flash a skeleton on the way past.
  const searching = useSlowLoad(loading && rows.length === 0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A slow answer for "naj" must not overwrite the rows for "najdorf"
  // typed after it; whoever holds the latest number owns the state. Also
  // the reason for the finally: a thrown fetch used to strand `loading`.
  // The shared filter row's state. Read through a ref inside `search` so
  // its identity stays stable — the meta/curDb effect below clears the
  // query whenever `search` changes, and a filter press must not eat what
  // was typed.
  const [resultFilter, setResultFilter] = useState<ResultFilter>('any');
  const [minElo, setMinElo] = useState(0);
  /**
   * The structured constraints — "[who] played [opening] as [side] at
   * [dates] in [event] and [won/lost/drew]", every slot optional and
   * composable (lanph3re's ask). Drafted in a window and applied on Done:
   * text fields firing a 2M-row search per keystroke would be noise.
   */
  const [structured, setStructured] = useState<StructuredFilters>(EMPTY_STRUCTURED_FILTERS);
  const [editingFilters, setEditingFilters] = useState(false);
  // The row's selects, drafted for the window: one state, two views —
  // the window mirrors them so it is the complete editor, and Apply is
  // what commits (see StructuredFiltersWindow's extraFields).
  const [quickDraft, setQuickDraft] = useState({ result: 'any' as ResultFilter, minElo: 0 });
  const structuredOn =
    structured.player !== '' ||
    structured.opening !== '' ||
    structured.event !== '' ||
    structured.from !== '' ||
    structured.to !== '' ||
    structured.side !== 'any' ||
    structured.outcome !== 'any';
  const filterRef = useRef({ resultFilter, minElo, structured });
  filterRef.current = { resultFilter, minElo, structured };

  const searchSeq = useRef(0);
  const search = useCallback(async (q: string, offset: number, db: string | null) => {
    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const f = filterRef.current;
      const params = new URLSearchParams({ q, offset: String(offset) });
      if (db) params.set('db', db);
      if (f.resultFilter !== 'any') params.set('result', f.resultFilter);
      if (f.minElo > 0) params.set('minElo', String(f.minElo));
      const st = f.structured;
      if (st.player) params.set('player', st.player);
      if (st.player && st.side !== 'any') params.set('side', st.side);
      if (st.player && st.outcome !== 'any') params.set('outcome', st.outcome);
      if (st.opening) params.set('opening', st.opening);
      if (st.event) params.set('event', st.event);
      if (st.from) params.set('from', st.from);
      if (st.to) params.set('to', st.to);
      const data = await api<{ total: number | null; rows: RefGame[] }>(
        `/api/refgames/search?${params.toString()}`,
      );
      if (seq !== searchSeq.current) return;
      // Only the first page of a search carries a total — counting matches
      // means scanning, and every later page would count the same thing.
      if (data.total !== null) setTotal(data.total);
      setRows((prev) => (offset === 0 ? data.rows : [...prev, ...data.rows]));
    } catch {
      /* the rows keep their last answer; the spinner below stops */
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  }, []);

  // Meta can fail like any other request — a raw fetch here used to leave
  // the pane wedged on nothing at all, with the rejection unhandled. The
  // failure is shown in the same red line every other pane uses, with the
  // retry the mount effect cannot offer.
  const [metaError, setMetaError] = useState<string | null>(null);
  const loadMeta = useCallback(() => {
    setMetaError(null);
    void api<{ ready: boolean; games?: number; sources?: string; databases?: RefDb[] }>(
      '/api/refgames',
    )
      .then(setMeta)
      .catch((failure) => setMetaError(t(apiErrorMessage(failure))));
  }, []);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  /**
   * Which database the rows on screen answer for: a name, `null` for "the
   * server's default, whatever that is", or undefined for nothing yet.
   *
   * A fact rather than a has-this-happened flag, because the effect below
   * re-runs — twice on mount under StrictMode alone — and a flag read once
   * is false by the second pass, which sent it off to fetch the rows it
   * already had.
   */
  const rowsFor = useRef<string | null | undefined>(undefined);

  /**
   * The first page of games is asked for WITH the database list, not after
   * it.
   *
   * A search naming no ?db= is answered from the first database there is
   * (`fromQuery` in server/refgames.ts, over a sorted `names()`), and the
   * list hands that same one back first — so the eager answer IS the
   * answer to the search this pane was going to run. It used to wait for
   * meta to name a database, which made one screen of rows two round trips
   * deep: nothing was even asked for until the list came back.
   */
  useEffect(() => {
    rowsFor.current = null;
    void search('', 0, null);
  }, [search]);

  // Reconcile the picked database against the list (a delete may have
  // taken it), then run its first search. Two passes when the pick moves:
  // the state change re-enters with the settled name.
  useEffect(() => {
    // Not answered yet. Distinct from an answer of no databases, and the
    // difference matters: this effect runs on mount too, before the list
    // exists, and clearing the marker here threw away what the eager
    // search had asked for — so the list arrived and asked for it again.
    if (!meta) return;
    if (!meta.ready) {
      // No databases: the eager search was answered with an error, so the
      // rows stand for nothing and a later list must still be searched.
      rowsFor.current = undefined;
      return;
    }
    const dbs = meta.databases ?? null;
    const next = dbs ? (dbs.some((d) => d.name === curDb) ? curDb : (dbs[0]?.name ?? null)) : null;
    if (next !== curDb) {
      setCurDb(next);
      return;
    }
    // Already answered — either this exact database, or the eager search,
    // whose missing ?db= the server read as the first one in the list.
    if (rowsFor.current === next || (rowsFor.current === null && next === (dbs?.[0]?.name ?? null)))
      return;
    rowsFor.current = next;
    setRows([]);
    setQuery('');
    void search('', 0, next);
  }, [meta, curDb, search]);

  const onQuery = (q: string): void => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(q, 0, curDb), 250);
  };

  // A filter press re-asks from the top, with the query still in the box.
  const filtersLive = useRef(false);
  useEffect(() => {
    if (!filtersLive.current) {
      filtersLive.current = true;
      return;
    }
    void search(query, 0, curDb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultFilter, minElo, structured]);

  // Infinite scroll: a sentinel row near the list's end pulls the next
  // page as it approaches the viewport.
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || loading || rows.length === 0 || rows.length >= total) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void search(query, rows.length, curDb);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, total, loading, query, search, curDb]);

  // Which database a game row means — every per-game fetch carries it,
  // and every per-game cache key does too: row ids restart at 1 in each
  // database, so a bare id would collide across them.
  const pgnUrl = (id: number): string =>
    `/api/refgames/${id}/pgn${curDb ? `?db=${encodeURIComponent(curDb)}` : ''}`;
  // Named apart from the module-level gameKey(summary) — the shadow made
  // any future edit in this component grab the wrong one silently.
  const refGameKey = (id: number): string => `${curDb ?? ''}:${id}`;

  const openGame = async (game: RefGame): Promise<void> => {
    let pgn: string;
    try {
      ({ pgn } = await api<{ pgn: string }>(pgnUrl(game.id)));
    } catch {
      return; // as before: a row that cannot be fetched simply does not open
    }
    if (useAnalysis.getState().loadPgn(pgn)) {
      useAnalysis.setState({ handoff: true });
      navigate('board');
    }
  };

  // Keeping an elite game: its PGN becomes a collection document like any
  // promoted chess.com game — annotatable, searchable, yours. The
  // collection keys make already-kept games read 'Added' across reloads,
  // and the server refuses duplicates besides.
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [collectionKeys, setCollectionKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    void loadCollection()
      .then((games) => setCollectionKeys(new Set(games.map((g) => `${g.white}|${g.black}|${g.date}`))))
      .catch(() => {});
  }, []);
  const inCollection = (g: RefGame): boolean =>
    added.has(refGameKey(g.id)) || collectionKeys.has(`${g.white}|${g.black}|${g.date ?? ''}`);
  const collect = async (game: RefGame): Promise<void> => {
    let pgn: string;
    try {
      ({ pgn } = await api<{ pgn: string }>(pgnUrl(game.id)));
    } catch {
      return;
    }
    try {
      await api('/api/games/collect-pgn', { method: 'POST', json: { pgn } });
      forgetCollection();
    } catch (failure) {
      // 409 = already there; either way this game is now in the collection.
      if (!(failure instanceof ApiError && failure.status === 409)) return;
    }
    setAdded((prev) => new Set(prev).add(refGameKey(game.id)));
  };

  // Preview eye, matching the collection rows: the DB stores movetext,
  // not positions, so the final fen is derived lazily from the game's
  // PGN (cached per id). Coarse pointers tap it open, fine ones hover.
  const [preview, setPreview] = useState<Preview | null>(null);
  const fenCache = useRef<Map<string, string>>(new Map());
  const previewSeq = useRef(0);
  const previewFor = useRef<number | null>(null);
  const showPreview = async (game: RefGame, anchor: Element, viaTap = false): Promise<void> => {
    const seq = ++previewSeq.current;
    let fen = fenCache.current.get(refGameKey(game.id));
    if (!fen) {
      let pgn: string;
      try {
        ({ pgn } = await api<{ pgn: string }>(pgnUrl(game.id)));
      } catch {
        return; // a preview is a glance — nothing to report if it cannot load
      }
      try {
        const first = pgnToChapters(pgn)[0];
        if (!first) return;
        const lastId = mainlineFrom(first.tree, first.tree.rootId).at(-1) ?? first.tree.rootId;
        fen = getNode(first.tree, lastId).fen;
      } catch {
        return;
      }
      fenCache.current.set(refGameKey(game.id), fen);
    }
    if (seq !== previewSeq.current) return;
    // The anchor can be unmounted while the fetch was out (switching
    // databases replaces every row, and removal fires no mouseleave) —
    // a dead node measures 0,0 and the preview drew in the corner.
    if (!anchor.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    setPreview({
      fen,
      orientation: 'white',
      top: Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200),
      left: Math.max(rect.left - 192, 8),
      // Touch opens the centred overlay (its scrim dismisses it), exactly
      // like the collection rows — a beside-row popover on a phone is
      // pointer-events-none AND covers the row it describes.
      ...(viaTap ? { pinned: true } : {}),
    });
  };
  const hidePreview = (): void => {
    previewSeq.current += 1;
    previewFor.current = null;
    setPreview(null);
  };
  // A pinned preview must not outlive its game list: the rows it
  // described are gone once the database changes.
  useEffect(() => {
    hidePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curDb]);
  const coarse = isCoarsePointer;

  if (!meta && metaError) {
    // The pane never learned what it holds, so there is nothing truthful
    // to draw below — say why, and offer the retry (a mount-only load has
    // no other way back short of reloading the app).
    return (
      <div className={cn('grid place-items-center p-6', page && 'h-full overflow-y-auto')}>
        <div className="flex flex-col items-center gap-3">
          <p className="text-bad text-center text-xs">{metaError}</p>
          <Button variant="secondary" size="sm" onClick={loadMeta}>
            {t('Try again')}
          </Button>
        </div>
      </div>
    );
  }

  if (meta && !meta.ready) {
    // The empty state used to BE the manager, inline. Managing lives on
    // the Databases page now and only there, so this says what is missing
    // and points at the one place that fixes it. A single-database mount
    // (the demo) has no page to offer, so it only says what is missing.
    return (
      <div className={cn('grid place-items-center p-6', page && 'h-full overflow-y-auto')}>
        <div className="w-full max-w-md">
          <p className="text-fg mb-1 text-center text-sm font-semibold">
            {t('No reference games yet')}
          </p>
          {meta.databases ? (
            <>
              <p className="text-muted mb-3 text-center text-xs leading-relaxed">
                {t('Upload PGN collections and index them into searchable databases of whole games.')}
              </p>
              <div className="flex justify-center">
                <Button variant="primary" size="sm" onClick={() => navigate('databases')}>
                  <Database className="size-3.5" />
                  {t('Go to Databases')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted text-center text-xs leading-relaxed">
              {t('This server has no reference games database.')}
            </p>
          )}
        </div>
      </div>
    );
  }

  const count =
    loading && rows.length === 0
      ? t('Searching…')
      : t('{n} games', { n: total.toLocaleString() });

  // The database picker (only when there is a choice) and the manager,
  // shown wherever the count is — absent entirely on a single-database
  // mount, which has neither names nor a manager.
  const dbs = meta?.databases;
  const dbControls = dbs && (
    <>
      {dbs.length > 1 && (
        <Select
          value={curDb ?? ''}
          onChange={setCurDb}
          ariaLabel={t('Reference database')}
          size="sm"
          align="end"
          className="max-w-[9rem]"
          groups={[{ options: dbs.map((d) => ({ value: d.name, label: d.name })) }]}
        />
      )}
      {/* Goes to the Databases page rather than opening the manager over
          this one. A window here meant uploads and deletes sat one press
          from a search you were in the middle of; managing is a place. */}
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Manage reference databases')}
        onClick={() => navigate('databases')}
      >
        <Database className="size-3.5" />
      </Button>
    </>
  );
  /**
   * The shared filter row (GameFilters), answered server-side: two
   * million rows only ever reach the client a page at a time, so the
   * WHERE lives in the search endpoint. No side select — these are
   * nobody-you-know's games. The strength floor is on BOTH players.
   */
  const filterRow = (className: string): React.ReactNode => (
    <FilterRow className={className}>
      <ResultSelect value={resultFilter} onChange={setResultFilter} />
      <StrengthSelect value={minElo} onChange={setMinElo} />
      {/* The rest of the constraints — who, which side, which outcome,
          which opening, which tournament, which dates — live in a window:
          they are text, not chips, and a lit icon says they are on. */}
      <Button
        variant="secondary"
        size="icon-sm"
        active={structuredOn}
        title={t('More filters')}
        className="shrink-0"
        onClick={() => {
          setQuickDraft({ result: resultFilter, minElo });
          setEditingFilters(true);
        }}
      >
        <SlidersHorizontal className="size-3.5" />
      </Button>
      {editingFilters && (
        <StructuredFiltersWindow
          initial={structured}
          extraFields={
            <Field label="Result and strength">
              <div className="flex gap-2">
                <ResultSelect
                  value={quickDraft.result}
                  onChange={(result) => setQuickDraft((d) => ({ ...d, result }))}
                />
                <StrengthSelect
                  value={quickDraft.minElo}
                  onChange={(minElo) => setQuickDraft((d) => ({ ...d, minElo }))}
                />
              </div>
            </Field>
          }
          onClear={() => setQuickDraft({ result: 'any', minElo: 0 })}
          onApply={(next) => {
            setEditingFilters(false);
            setStructured(next);
            setResultFilter(quickDraft.result);
            setMinElo(quickDraft.minElo);
          }}
          onClose={() => setEditingFilters(false)}
        />
      )}
    </FilterRow>
  );

  const list = (
    <>
      {searching && <SkeletonGameRows rows={8} />}
      {/* The same stripe the collection list has: at three lines a row is
          tall enough that a hairline between rows disappears. */}
      <ul className="divide-line min-h-0 flex-1 divide-y overflow-y-auto [&>li:nth-child(even)]:bg-fg/[0.022]">
          {/* gap-3/pr-3 on each row: the shared GameRow's rhythm — these
              rows sat a third as far apart as the archive's, and the two
              lists take turns in the same column. */}
          {rows.map((g) => (
            <li key={g.id} className="group hover:bg-surface-2 flex items-center gap-3 pr-3 transition-colors duration-100">
              {/* Mirrors the collection's GameRow — same bold names, same
                  ECO badge, same result tag — so the two lists read as one
                  family rather than as two takes on a game list. */}
              <button
                type="button"
                onClick={() => void openGame(g)}
                title={t('Open on the analysis board')}
                className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="white" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-semibold">{g.white}</span>{' '}
                    <span className="text-subtle text-xs">{g.white_elo}</span>
                  </span>
                  <span className="text-fg block truncate text-sm">
                    <SideDot side="black" className="mr-1.5 inline-block align-[-1px]" />
                    <span className="font-semibold">{g.black}</span>{' '}
                    <span className="text-subtle text-xs">{g.black_elo}</span>
                  </span>
                  <span className="text-subtle block truncate text-xs">
                    {g.eco ? <OpeningTag eco={g.eco} name={g.opening} /> : g.opening}
                    {(g.eco || g.opening) && g.date ? ' · ' : ''}
                    {g.date ?? ''}
                  </span>
                </span>
                <ResultScore result={g.result} userSide={null} />
              </button>

              {/* The eye lives outside the row's own button — a button
                  inside a button is not markup a browser will keep — and
                  in the same hover tray the collection rows use. Add stays
                  put: it is the point of this page, not a quick action. */}
              <span
                className={cn(
                  'flex shrink-0 items-center gap-0.5 rounded-lg p-0.5 transition-opacity duration-100',
                  'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
                  'group-hover:bg-surface-3/70 pointer-coarse:opacity-100',
                )}
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('Preview the final position')}
                  onMouseEnter={(e) => {
                    if (!coarse()) void showPreview(g, e.currentTarget);
                  }}
                  onMouseLeave={() => {
                    if (!coarse()) hidePreview();
                  }}
                  onClick={(e) => {
                    if (!coarse()) return;
                    e.stopPropagation();
                    if (previewFor.current === g.id) {
                      hidePreview();
                    } else {
                      previewFor.current = g.id;
                      void showPreview(g, e.currentTarget, true);
                    }
                  }}
                >
                  <Eye className="size-3.5" />
                </Button>
              </span>

              {/* w-16 and a bare word when it is done, exactly like the
                  archive's rows: the two lists now take turns in one 210px
                  column, and 20 characters of player name is worth more
                  than a tick beside a word that is already past tense. */}
              <Button
                variant={inCollection(g) ? 'ghost' : 'secondary'}
                size="sm"
                className="w-16 shrink-0"
                disabled={inCollection(g)}
                onClick={() => void collect(g)}
              >
                {inCollection(g) ? (
                  t('Added')
                ) : (
                  <>
                    <Plus className="mr-1 size-3.5 pointer-coarse:size-4.5" strokeWidth={2.5} />
                    {t('Add')}
                  </>
                )}
              </Button>
            </li>
          ))}
          {rows.length < total && (
            <li ref={sentinel} className="flex items-center justify-center gap-2 p-3">
              <Loader2 className="text-subtle size-4 animate-spin" />
              <span className="text-subtle text-xs">{t('Loading older games…')}</span>
            </li>
          )}
      </ul>
    </>
  );

  // In the column the panel and the tab that named it are already drawn:
  // this is only the field and the list, laid out like the archive's own
  // body so the two read as one panel that changed its mind.
  if (variant === 'column') {
    return (
      <>
        <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
          <SearchInput
            inputSize="sm"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('Search players, openings, or ECO')}
            spellCheck={false}
            className="w-full"
          />
        </div>
        {filterRow('border-t')}
        <div className="border-line shrink-0 border-t px-3 py-1 pr-1.5">
          <div className="flex min-h-6 items-center gap-2">
            <span className="text-subtle min-w-0 flex-1 truncate text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
              {count}
            </span>
            {dbControls}
          </div>
        </div>
        {list}
        <GamePreview preview={preview} onClose={hidePreview} />
      </>
    );
  }

  const body = (
    <>
      <SearchInput
        inputSize="lg"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t('Search players, openings, or ECO (e.g. Najdorf, B90)…')}
        spellCheck={false}
        className="w-full shrink-0"
      />

      {/* A page gives this the height it has left and the list scrolls
          inside it. A window has no height to give — it is as tall as what
          is in it, up to a cap — so the panel takes its natural size below
          sm and the window scrolls instead. Exactly what the archive
          browser does in the same window. */}
      <Panel flush className={page ? 'mt-1 min-h-0 flex-1' : 'shrink-0 sm:min-h-0 sm:flex-1'}>
        <PanelHeader title={count} actions={dbControls} />
        {filterRow('border-b')}
        {list}
      </Panel>
      <GamePreview preview={preview} onClose={hidePreview} />
    </>
  );

  // In a window the frame and the title belong to the window; only a page
  // has to draw its own, and a page is also the only one of the three that
  // needs a way back to where it came from.
  if (!page) return body;

  return (
    <PageShell
      width="wide"
      scroll={false}
      // The list panel scrolls itself, so the column pins to the viewport.
      className="h-full min-h-0 pb-4 md:pb-6"
    >
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" title={t('Back to games')} onClick={() => navigate('games')}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
          {(() => {
            // Dir mounts count across every database; a single mount says
            // its own meta. Either way the title is the whole shelf, while
            // the panel's count below is the database being searched.
            const all = dbs ? dbs.reduce((sum, d) => sum + d.games, 0) : (meta?.games ?? 0);
            return all
              ? `${t('Elite games')} (${t('{n} games', { n: all.toLocaleString() })})`
              : t('Elite games');
          })()}
        </h1>
      </div>
      {body}
    </PageShell>
  );
}
