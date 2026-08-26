import { Database, Plus, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { forgetCollection, loadCollection } from './collection';

import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';

import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';

import { Button } from '@/components/ui/button';

import { Select } from '@/components/ui/select';
import { SearchInput } from '@/components/text-fields';
import {
  EMPTY_STRUCTURED_FILTERS,
  ResultSelect,
  StrengthSelect,
  StructuredFiltersWindow,
  type ResultFilter,
  type StructuredFilters,
} from './GameFilters';
import { Field } from '@/components/ui/field';
import { useSlowLoad } from '@/components/skeletons';
import { EmptyState } from '@/components/empty-state';
import { GameListShell } from './GameListShell';

import type { RefDb } from '@/databases/RefDbManager';
import { t } from '@/lib/i18n';
import { GamePreview, GameRow, type GameSummary, type Preview } from './shared';

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
 * Two shapes, one component, because it is one thing — GameListShell's
 * vocabulary, exactly as the archive browser uses it:
 *
 * `panel` — the second half of the column that finds games, behind the
 * tab beside Online archives. Where it belongs on a desktop: the archive
 * and the reference database answer the same question, so they take turns
 * in one panel rather than each taking a box.
 *
 * `sheet` — below lg, where there is no column. A bottom sheet on a
 * phone, like the archive. (There was a `page` shape on its own route
 * once; nothing ever navigated to it.)
 */
export function DatabaseGames({ shape = 'sheet' }: { shape?: 'panel' | 'sheet' }) {
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
  /** The count stopped at the server's cap — shown as "10,000+". */
  const [capped, setCapped] = useState(false);
  /** Where the next page starts; null when every match is in hand. */
  const [nextCursor, setNextCursor] = useState<number | null>(null);
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
  // Keyset paging: the cursor is the last row id in hand, null for a fresh
  // search. The server seeks below it instead of walking an OFFSET.
  const search = useCallback(async (q: string, cursor: number | null, db: string | null) => {
    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const f = filterRef.current;
      const params = new URLSearchParams({ q });
      if (cursor !== null) params.set('cursor', String(cursor));
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
      const data = await api<{
        total: number | null;
        capped?: boolean;
        nextCursor: number | null;
        rows: RefGame[];
      }>(`/api/refgames/search?${params.toString()}`);
      if (seq !== searchSeq.current) return;
      // Only the first page of a search carries a total — counting matches
      // means scanning, and every later page would count the same thing.
      if (data.total !== null) {
        setTotal(data.total);
        setCapped(data.capped === true);
      }
      setNextCursor(data.nextCursor);
      setRows((prev) => (cursor === null ? data.rows : [...prev, ...data.rows]));
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
    void search('', null, null);
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
    void search('', null, next);
  }, [meta, curDb, search]);

  const onQuery = (q: string): void => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(q, null, curDb), 250);
  };

  // A filter press re-asks from the top, with the query still in the box.
  const filtersLive = useRef(false);
  useEffect(() => {
    if (!filtersLive.current) {
      filtersLive.current = true;
      return;
    }
    void search(query, null, curDb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultFilter, minElo, structured]);

  // Infinite scroll: a sentinel row near the list's end pulls the next
  // page as it approaches the viewport.
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || loading || rows.length === 0 || nextCursor === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void search(query, nextCursor, curDb);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length, nextCursor, loading, query, search, curDb]);

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
  // PGN (cached per id) and handed to GameRow's loadPreview — the row
  // owns the placement, the hover races and the is-it-still-mounted
  // guard, exactly as it does for the other two lists.
  const [preview, setPreview] = useState<Preview | null>(null);
  const fenCache = useRef<Map<string, string>>(new Map());
  const loadFinalFen = async (
    game: RefGame,
  ): Promise<{ fen: string; orientation: 'white' | 'black' } | null> => {
    const key = refGameKey(game.id);
    let fen = fenCache.current.get(key);
    if (!fen) {
      let pgn: string;
      try {
        ({ pgn } = await api<{ pgn: string }>(pgnUrl(game.id)));
      } catch {
        return null; // a preview is a glance — nothing to report if it cannot load
      }
      try {
        const first = pgnToChapters(pgn)[0];
        if (!first) return null;
        const lastId = mainlineFrom(first.tree, first.tree.rootId).at(-1) ?? first.tree.rootId;
        fen = getNode(first.tree, lastId).fen;
      } catch {
        return null;
      }
      fenCache.current.set(key, fen);
    }
    return { fen, orientation: 'white' };
  };
  const hidePreview = (): void => setPreview(null);
  // A pinned preview must not outlive its game list: the rows it
  // described are gone once the database changes.
  useEffect(() => {
    hidePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curDb]);

  /**
   * A reference row in the shared row's shape. No link, no side of yours,
   * no annotations, no final position in hand (loadPreview fetches it) —
   * and an opening only when the ECO is known, which is what the shared
   * detail line keys on.
   */
  const toSummary = (g: RefGame): GameSummary => ({
    file: `ref/${curDb ?? ''}`,
    index: g.id,
    white: g.white,
    black: g.black,
    whiteElo: g.white_elo,
    blackElo: g.black_elo,
    result: g.result,
    date: g.date ?? '',
    timeControl: null,
    eco: g.eco,
    link: null,
    opening: g.eco && g.opening ? { eco: g.eco, name: g.opening } : null,
    finalFen: null,
    userSide: null,
    annotated: false,
  });

  if (!meta && metaError) {
    // The pane never learned what it holds, so there is nothing truthful
    // to draw below — say why, and offer the retry (a mount-only load has
    // no other way back short of reloading the app). The shared EmptyState,
    // like the collection's own states — these were hand-rolled paragraphs
    // with their own typography.
    return (
      <EmptyState
        className="min-h-0 flex-1 p-6"
        icon={Database}
        title="Could not load reference games"
        body={metaError}
        action={
          <Button variant="secondary" size="sm" onClick={loadMeta}>
            {t('Try again')}
          </Button>
        }
      />
    );
  }

  if (meta && !meta.ready) {
    // The empty state used to BE the manager, inline. Managing lives on
    // the Databases page now and only there, so this says what is missing
    // and points at the one place that fixes it. A single-database mount
    // (the demo) has no page to offer, so it only says what is missing.
    return (
      <EmptyState
        className="min-h-0 flex-1 p-6"
        icon={Database}
        title="No reference games yet"
        body={
          meta.databases
            ? 'Upload PGN collections and index them into searchable databases of whole games.'
            : 'This server has no reference games database.'
        }
        action={
          meta.databases ? (
            <Button variant="default" size="sm" onClick={() => navigate('databases')}>
              <Database className="size-3.5" data-icon="inline-start" />
              {t('Go to Databases')}
            </Button>
          ) : undefined
        }
      />
    );
  }

  const count =
    loading && rows.length === 0
      ? t('Searching…')
      : capped
        ? t('{n}+ games', { n: total.toLocaleString() })
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
          onValueChange={setCurDb}
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
  const filters = (
    <>
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
    </>
  );

  /* gap-3/pr-3 on each row: the shared GameRow's rhythm — these rows sat
     a third as far apart as the archive's, and the two lists take turns
     in the same column. */
  // The shared row, via the summary adapter: bold names that never clip
  // their ratings, the ECO badge, the result tag, the coarse-pointer eye
  // policy and placeNear previews — everything the hand-rolled copy had
  // re-implemented and half of which it had drifted on. Deliberately no
  // swipe, bookmark, rename or context menu: a reference row is
  // immutable, and Add is its keep verb.
  const rowItems = rows.map((g) => (
    <GameRow
      key={g.id}
      game={toSummary(g)}
      onOpen={() => void openGame(g)}
      onPreview={setPreview}
      loadPreview={() => loadFinalFen(g)}
      actions={null}
      menu={[]}
      showLink={false}
      standing={
        /* w-16 and a bare word when it is done, exactly like the
           archive's rows: the two lists take turns in one 210px column,
           and 20 characters of player name is worth more than a tick
           beside a word that is already past tense. */
        <Button
          variant={inCollection(g) ? 'ghost' : 'secondary'}
          size="sm"
          className="w-16 shrink-0"
          disabled={inCollection(g)}
          onClick={(e) => {
            e.stopPropagation();
            void collect(g);
          }}
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
      }
    />
  ));

  // The count leads the band in the archive's own voice; the picker and
  // the manager sit with it.
  const countBand = (
    <>
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm font-medium tabular-nums">
        {count}
      </span>
      {dbControls}
    </>
  );

  return (
    <>
    <GameListShell
      shape={shape}
      toolbar={
        <SearchInput
          inputSize="sm"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t('Search players, openings, or ECO')}
          spellCheck={false}
          className="w-full"
        />
      }
      filters={filters}
      countBand={countBand}
      // undefined when empty, or the bare bordered ul doubles the empty
      // state's own top rule.
      list={rows.length > 0 ? rowItems : undefined}
      // Nothing for the first moment — a search that answers in 40 ms
      // should not flash a skeleton on the way past (useSlowLoad above);
      // when it does draw, it REPLACES the rows instead of stacking a
      // second list above them.
      listLoading={searching}
      // In a sheet the card scrolls below sm and the list scrolls from sm
      // up, exactly like the archive in the same window.
      listClassName={
        shape === 'sheet'
          ? 'sm:max-h-none sm:flex-1 sm:overflow-y-auto'
          : 'flex-1 overflow-y-auto'
      }
      more={
        // "more", not "older": this list is in insertion order (id DESC),
        // which is no promise about dates.
        nextCursor !== null ? { ref: sentinel, label: t('Loading more games…') } : null
      }
      tail={
        // A search that comes back empty says so, with the way out — an
        // empty bordered box under a count of 0 read as a broken pane.
        !loading && rows.length === 0 ? (
          <EmptyState
            className="border-border min-h-0 flex-1 border-t"
            icon={SearchX}
            title="No games match"
            body="No game in this database gets through the search and filters above."
            action={
              query || resultFilter !== 'any' || minElo > 0 || structuredOn ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setResultFilter('any');
                    setMinElo(0);
                    setStructured(EMPTY_STRUCTURED_FILTERS);
                    void search('', null, curDb);
                  }}
                >
                  <X className="size-3.5" data-icon="inline-start" />
                  {t('Clear search and filters')}
                </Button>
              ) : undefined
            }
          />
        ) : undefined
      }
    />
    <GamePreview preview={preview} onClose={hidePreview} />
    </>
  );
}
