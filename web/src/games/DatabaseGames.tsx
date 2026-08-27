import { Database, Grid3x3, Info, Play, Plus, ScanSearch, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { forgetCollection, loadCollection } from './collection';

import { getNode, mainlineFrom } from '@shared/tree';
import { pgnToChapters } from '@shared/pgn';
import type { MatchMode } from '@shared/scanMatch';

import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';

import { Button } from '@/components/ui/button';

import { Select } from '@/components/ui/select';
import { ClearableInput, SearchInput } from '@/components/text-fields';
import ENDGAMES from './endgames.json';
import {
  EMPTY_STRUCTURED_FILTERS,
  ResultSelect,
  StrengthSelect,
  StructuredFiltersWindow,
  type ResultFilter,
  type StructuredFilters,
} from './GameFilters';
import { Field } from '@/components/ui/field';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useSlowLoad } from '@/components/skeletons';
import { EmptyState } from '@/components/empty-state';
import { GameListShell } from './GameListShell';

import type { RefDb } from '@/databases/RefDbManager';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/lib/i18n';

// The setup board is the whole editor, embedded — and the editor is a
// board plus its tools, none of which belongs in this bundle until the
// button that wants it is pressed.
const EditorView = lazy(() =>
  import('@/editor/EditorView').then((m) => ({ default: m.EditorView })),
);
import { GamePreview, GameRow, type GameSummary, type Preview } from './shared';
import { GameTableHeader, GameTableRow } from './GameTable';
import { GameDetailsSheet, type DetailsSelection } from './GameDetails';

/**
 * The details panel's action pair for a reference row, with its own
 * added-state: the node lives in the page's selection state, so it
 * cannot read the pane's `added` set after the fact — what it CAN do is
 * remember its own success.
 */
function RefRowActions({
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
    <>
      <Button variant="default" size="sm" onClick={onOpen}>
        <Play className="size-3.5" data-icon="inline-start" />
        {t('Open on the board')}
      </Button>
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
    </>
  );
}

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
  plyCount: number;
  sanPrefix: string | null;
}

/**
 * A position handed over from another surface — the board's explorer
 * pane, whose "find in the browser" button is the small in-context view
 * pointing at the full search surface. A module-level mailbox, the same
 * shape as CollectionView's heldSheet: navigation is a hash change, so
 * the FEN cannot ride the route without escaping its slashes into it.
 * Consumed once on mount; the hunt opens prefilled and runs itself.
 */
let pendingHunt: { fen: string; db: string } | null = null;
export function handOffPositionHunt(fen: string, db: string): void {
  pendingHunt = { fen, db };
}
/** True while a handed-off hunt waits for the browser to mount — how
    CollectionView knows to open on the Databases tab (or sheet). */
export function positionHuntPending(): boolean {
  return pendingHunt !== null;
}
const consumePendingHunt = (): { fen: string; db: string } | null => {
  const handed = pendingHunt;
  pendingHunt = null;
  return handed;
};

/** The relaxation rungs, in the ladder's own order (shared/scanMatch). */
const RUNGS: { id: MatchMode; label: string }[] = [
  { id: 'exact', label: 'Exact position' },
  { id: 'pawns', label: 'Same pawns' },
  { id: 'files', label: 'Same pawn files' },
  { id: 'material', label: 'Same material' },
];

/** Stability, offered in moves (a spec's `stable` counts plies). */
const HELD: { plies: number; label: string }[] = [
  { plies: 1, label: 'At any moment' },
  { plies: 8, label: 'Held 4+ moves' },
  { plies: 16, label: 'Held 8+ moves' },
];

/**
 * The custom material editor's vocabulary: per piece, per side, one of
 * a curated set of count ranges rather than two bare number fields —
 * every real question ("no queens", "exactly one rook", "a pair of
 * knights at most") is one pick, and an impossible range (min above
 * max) cannot be built at all. '2+' is open-ended: the spec's ceiling
 * is 10, past any promotion spree worth searching for.
 */
const RANGE_CHOICES: { id: string; label: string; range: [number, number] | null }[] = [
  { id: 'any', label: 'Any', range: null },
  { id: '0', label: '0', range: [0, 0] },
  { id: '1', label: '1', range: [1, 1] },
  { id: '2', label: '2', range: [2, 2] },
  { id: '0-1', label: '0–1', range: [0, 1] },
  { id: '1-2', label: '1–2', range: [1, 2] },
  { id: '2+', label: '2+', range: [2, 10] },
];

const PIECES: { letter: 'p' | 'n' | 'b' | 'r' | 'q'; label: string }[] = [
  { letter: 'p', label: 'Pawns' },
  { letter: 'n', label: 'Knights' },
  { letter: 'b', label: 'Bishops' },
  { letter: 'r', label: 'Rooks' },
  { letter: 'q', label: 'Queens' },
];

type CustomDraft = Record<'white' | 'black', Record<string, string>>;
type CustomSpec = Record<'white' | 'black', Record<string, [number, number]>>;

const EMPTY_CUSTOM: CustomDraft = { white: {}, black: {} };

/** The draft's non-Any picks as the spec the server takes; null when
    nothing is constrained (the server refuses a spec that would match
    every game, and so does the Apply button). */
function draftToSpec(draft: CustomDraft): CustomSpec | null {
  const side = (from: Record<string, string>): Record<string, [number, number]> => {
    const out: Record<string, [number, number]> = {};
    for (const { letter } of PIECES) {
      const range = RANGE_CHOICES.find((c) => c.id === (from[letter] ?? 'any'))?.range;
      if (range) out[letter] = range;
    }
    return out;
  };
  const spec = { white: side(draft.white), black: side(draft.black) };
  return Object.keys(spec.white).length + Object.keys(spec.black).length > 0 ? spec : null;
}

/**
 * The custom material spec, drafted in a window and applied on Done —
 * the StructuredFiltersWindow pattern: ten picks are a form to be READ,
 * not chips to tap live, and a hunt re-run per pick would be noise.
 */
function CustomMaterialWindow({
  initial,
  onApply,
  onClose,
}: {
  initial: CustomDraft;
  onApply: (draft: CustomDraft, spec: CustomSpec) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CustomDraft>(initial);
  const spec = draftToSpec(draft);
  const sideGrid = (side: 'white' | 'black', label: string) => (
    <Field label={label}>
      <div className="grid w-full grid-cols-5 gap-1.5">
        {PIECES.map(({ letter, label: piece }) => (
          <div key={letter} className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground truncate text-xs">{t(piece)}</span>
            <Select
              value={draft[side][letter] ?? 'any'}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, [side]: { ...d[side], [letter]: v } }))
              }
              ariaLabel={`${t(label)} — ${t(piece)}`}
              size="sm"
              className="w-full"
              groups={[
                { options: RANGE_CHOICES.map((c) => ({ value: c.id, label: t(c.label) })) },
              ]}
            />
          </div>
        ))}
      </div>
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Custom material" icon={ScanSearch}>
        {sideGrid('white', 'White has')}
        {sideGrid('black', 'Black has')}
        {/* The refusal the server would give, said before the press. */}
        {!spec && (
          <p className="text-muted-foreground text-sm">
            {t('Pick at least one count, or every game matches.')}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => setDraft(EMPTY_CUSTOM)}
          >
            {t('Clear')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            disabled={!spec}
            onClick={() => spec && onApply(draft, spec)}
          >
            {t('Apply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
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
export function DatabaseGames({
  shape = 'sheet',
  table = false,
  onSelect,
  selectedKey,
}: {
  shape?: 'panel' | 'sheet';
  /** Dense table rows instead of cards — the wide pane's presentation.
      Explicit, never inferred: the phone sheet stays cards whatever the
      window says. */
  table?: boolean;
  /** Table mode: a click packages the row — summary, PGN loader, verbs
      — for the details panel; null when the rows it described reset. */
  onSelect?: (sel: DetailsSelection | null) => void;
  selectedKey?: string | null;
}) {
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

  // Read through a ref where reset points live inside stable callbacks —
  // the selection must clear when the rows it described go away.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const searchSeq = useRef(0);
  /** The committed filters as query params — the /search and the deep
      hunt speak the same gamesWhere, so one builder serves both. Reads
      through filterRef so its identity never moves. */
  const applyFilters = useCallback((params: URLSearchParams): void => {
    const f = filterRef.current;
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
  }, []);
  // Keyset paging: the cursor is the last row id in hand, null for a fresh
  // search. The server seeks below it instead of walking an OFFSET.
  const search = useCallback(async (q: string, cursor: number | null, db: string | null) => {
    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q });
      if (cursor !== null) params.set('cursor', String(cursor));
      if (db) params.set('db', db);
      applyFilters(params);
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
  }, [applyFilters]);

  /**
   * The deep hunt: a position (optionally relaxed a rung) or a material
   * situation, streamed from /deep-search into rows of its own beside
   * the text search's — closing the section brings the text rows back
   * untouched. Same reading loop as the explorer's DeepSearch: a stream
   * that ends without its `done` frame FAILED rather than found
   * nothing, and a stale sequence number abandons frames mid-read.
   */
  const [huntOpen, setHuntOpen] = useState(false);
  const [huntKind, setHuntKind] = useState<'position' | 'material'>('position');
  const [huntFen, setHuntFen] = useState('');
  const [rung, setRung] = useState<MatchMode>('exact');
  const [presetId, setPresetId] = useState<string>(ENDGAMES[0]!.id);
  const [heldPlies, setHeldPlies] = useState(1);
  // The custom spec: the draft survives the window closing so a reopen
  // edits what was applied, and presetId only becomes 'custom' WITH a
  // spec in hand — a cancelled first visit leaves the preset standing.
  const [customDraft, setCustomDraft] = useState<CustomDraft>(EMPTY_CUSTOM);
  const [customSpec, setCustomSpec] = useState<CustomSpec | null>(null);
  const [editingCustom, setEditingCustom] = useState(false);
  /** The setup board: the embedded editor in a window, for a position
      nobody has a FEN of — the editor validates, so only a legal
      position ever comes back through onUse. */
  const [settingUp, setSettingUp] = useState(false);
  const [huntRows, setHuntRows] = useState<RefGame[] | null>(null);
  const [hunting, setHunting] = useState(false);
  const [huntProgress, setHuntProgress] = useState<{ scanned: number; total: number } | null>(null);
  const [huntExhaustive, setHuntExhaustive] = useState(true);
  const [huntFailed, setHuntFailed] = useState<'failed' | 'bad-fen' | null>(null);
  const huntSeq = useRef(0);
  // Unmounting must take an in-flight hunt with it: the bump makes the
  // read loop cancel its reader, which aborts the server's scan.
  useEffect(
    () => () => {
      huntSeq.current += 1;
    },
    [],
  );
  const clearHunt = (): void => {
    huntSeq.current += 1;
    setHuntRows(null);
    setHunting(false);
    setHuntProgress(null);
    setHuntFailed(null);
  };

  // The handed-off position, consumed once (StrictMode's double effect
  // gets null the second time and does nothing): the controls open
  // prefilled and the database moves to the explorer's own, and the
  // effect AFTER the reconcile below fires the hunt itself.
  const autoHunt = useRef<{ fen: string; db: string } | null>(null);
  useEffect(() => {
    const handed = consumePendingHunt();
    if (!handed) return;
    autoHunt.current = handed;
    setHuntOpen(true);
    setHuntKind('position');
    setHuntFen(handed.fen);
    setCurDb(handed.db);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fenOverride: the setup board hands its position and runs in one
  // press — the setState it also does has not landed by the time this
  // closure reads huntFen.
  const runHunt = useCallback(async (fenOverride?: string): Promise<void> => {
    // Resolved before any state moves: a custom pick with no spec has
    // nothing to run (the Search button is disabled then too).
    const material =
      huntKind === 'material'
        ? presetId === 'custom'
          ? customSpec
          : (ENDGAMES.find((p) => p.id === presetId) ?? ENDGAMES[0]!).spec
        : null;
    if (huntKind === 'material' && !material) return;
    const mine = ++huntSeq.current;
    setHunting(true);
    onSelectRef.current?.(null);
    setHuntRows([]);
    setHuntProgress(null);
    setHuntExhaustive(true);
    setHuntFailed(null);
    let sawDone = false;
    try {
      const params = new URLSearchParams();
      if (curDb) params.set('db', curDb);
      applyFilters(params);
      if (huntKind === 'position') {
        params.set('fen', (fenOverride ?? huntFen).trim());
        if (rung !== 'exact') params.set('match', rung);
      } else {
        params.set('material', JSON.stringify({ ...material, stable: heldPlies }));
      }
      const res = await fetch(`/api/refgames/deep-search?${params.toString()}`);
      if (res.status === 400) {
        // The one refusal a user can cause from here is a FEN that is
        // not a position; say that instead of a generic failure.
        if (huntSeq.current === mine) {
          setHunting(false);
          setHuntFailed(huntKind === 'position' ? 'bad-fen' : 'failed');
        }
        return;
      }
      if (!res.ok || !res.body) throw new Error('deep search failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (huntSeq.current !== mine) {
          void reader.cancel();
          return;
        }
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = done ? '' : (lines.pop() ?? '');
        for (const line of lines) {
          if (!line.trim()) continue;
          const frame = JSON.parse(line) as
            | ({ type: 'game'; ply: number } & RefGame)
            | { type: 'progress' | 'done'; scanned: number; total: number; exhaustive?: boolean };
          if (frame.type === 'game') {
            const { type: _type, ply: _ply, ...game } = frame;
            setHuntRows((prev) => [...(prev ?? []), game]);
          } else {
            setHuntProgress({ scanned: frame.scanned, total: frame.total });
            if (frame.type === 'done') {
              sawDone = true;
              setHuntExhaustive(frame.exhaustive !== false);
            }
          }
        }
        if (done) break;
      }
    } catch {
      // offline, or the route refused — failed, not empty
    }
    if (huntSeq.current === mine) {
      setHunting(false);
      if (!sawDone && huntSeq.current === mine) setHuntFailed((f) => f ?? 'failed');
    }
  }, [applyFilters, curDb, huntKind, huntFen, rung, presetId, heldPlies, customSpec]);

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
    onSelectRef.current?.(null);
    // A hunt's rows answered a database that is no longer the one on
    // screen; the controls keep their draft, the results do not.
    huntSeq.current += 1;
    setHuntRows(null);
    setHunting(false);
    setHuntProgress(null);
    setHuntFailed(null);
    void search('', null, next);
  }, [meta, curDb, search]);

  // The handed-off hunt runs only after the reconcile above has claimed
  // the rows for the explorer's database — defined after it on purpose:
  // that effect cancels in-flight hunts when the database settles, and
  // firing first would be firing into that cancellation. A database the
  // list no longer has leaves the controls prefilled and lets the user
  // press Search themselves.
  useEffect(() => {
    const handed = autoHunt.current;
    // meta.ready + a matching pick means the reconcile above is done
    // with this database — whether it searched or kept the eager rows.
    if (!handed || !meta?.ready || curDb !== handed.db) return;
    autoHunt.current = null;
    void runHunt();
  }, [meta, curDb, runHunt]);

  const onQuery = (q: string): void => {
    // Typing a text search is leaving the hunt: the rows must answer
    // the box the user is typing into, not a board they searched before.
    if (huntRows !== null) clearHunt();
    onSelectRef.current?.(null);
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(q, null, curDb), 250);
  };

  // A filter press re-asks from the top, with the query still in the box
  // — or re-runs the hunt, whose results the filters narrow identically.
  const filtersLive = useRef(false);
  useEffect(() => {
    if (!filtersLive.current) {
      filtersLive.current = true;
      return;
    }
    if (huntRows !== null) void runHunt();
    else void search(query, null, curDb);
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
  const collect = async (game: RefGame): Promise<boolean> => {
    let pgn: string;
    try {
      ({ pgn } = await api<{ pgn: string }>(pgnUrl(game.id)));
    } catch {
      return false;
    }
    try {
      await api('/api/games/collect-pgn', { method: 'POST', json: { pgn } });
      forgetCollection();
    } catch (failure) {
      // 409 = already there; either way this game is now in the collection.
      if (!(failure instanceof ApiError && failure.status === 409)) return false;
    }
    setAdded((prev) => new Set(prev).add(refGameKey(game.id)));
    return true;
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
    event: g.event,
    round: null,
    plyCount: g.plyCount,
    sanPrefix: g.sanPrefix,
    opening: g.eco && g.opening ? { eco: g.eco, name: g.opening } : null,
    finalFen: null,
    userSide: null,
    annotated: false,
  });

  /** The row, packaged for the details view: everything it needs to
      show and act on this game without knowing what a database is. */
  const packageRow = (g: RefGame): DetailsSelection => ({
    key: refGameKey(g.id),
    summary: toSummary(g),
    loadPgn: async () => {
      try {
        return (await api<{ pgn: string }>(pgnUrl(g.id))).pgn;
      } catch {
        return null;
      }
    },
    actions: (
      <RefRowActions
        inCollection={inCollection(g)}
        onOpen={() => void openGame(g)}
        onCollect={() => collect(g)}
      />
    ),
  });
  const selectRow = (g: RefGame): void => onSelect?.(packageRow(g));

  // The ⋯ → Game details sheet: the details panel's content where the
  // rows are cards and no panel stands beside them.
  const [details, setDetails] = useState<RefGame | null>(null);

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

  const inHunt = huntRows !== null;
  const count = inHunt
    ? hunting
      ? huntProgress
        ? t('Searching… {scanned} of {total} games', {
            scanned: huntProgress.scanned.toLocaleString(),
            total: huntProgress.total.toLocaleString(),
          })
        : t('Searching…')
      : huntFailed
        ? t('The search failed.')
        : huntExhaustive
          ? t('{n} games found', { n: (huntRows?.length ?? 0).toLocaleString() })
          : t('{n}+ games found — the list stops here', {
              n: (huntRows?.length ?? 0).toLocaleString(),
            })
    : loading && rows.length === 0
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
  const rowItems = (inHunt ? (huntRows ?? []) : rows).map((g) =>
    table ? (
      <GameTableRow
        key={g.id}
        game={toSummary(g)}
        selected={selectedKey === refGameKey(g.id)}
        onSelect={() => selectRow(g)}
        onOpen={() => void openGame(g)}
        menu={[
          { label: 'Open on the board', icon: Play, onSelect: () => void openGame(g) },
          { label: 'Add to collection', icon: Plus, onSelect: () => void collect(g) },
        ]}
      />
    ) : (
    <GameRow
      key={g.id}
      game={toSummary(g)}
      onOpen={() => void openGame(g)}
      onPreview={setPreview}
      loadPreview={() => loadFinalFen(g)}
      actions={null}
      menu={[{ label: 'Game details', icon: Info, onSelect: () => setDetails(g) }]}
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
    ),
  );

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

  /**
   * The hunt controls, folded behind the toggle beside the search box:
   * a position (FEN, with the relaxation rung) or a material situation
   * (a preset from endgames.json — data, never per-preset code — and
   * how long it must hold). One press runs it; the filter row above
   * narrows a hunt exactly as it narrows the text search.
   */
  const huntControls = huntOpen && (
    <div className="flex w-full flex-wrap items-center gap-1.5">
      <Select
        value={huntKind}
        onValueChange={(v) => setHuntKind(v as 'position' | 'material')}
        ariaLabel={t('Search by')}
        size="sm"
        groups={[
          {
            options: [
              { value: 'position', label: t('Position') },
              { value: 'material', label: t('Material') },
            ],
          },
        ]}
      />
      {huntKind === 'position' ? (
        <>
          <ClearableInput
            inputSize="sm"
            value={huntFen}
            onChange={(e) => setHuntFen(e.target.value)}
            placeholder={t('Paste a FEN')}
            spellCheck={false}
            className="min-w-0 flex-1 basis-40"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Set the position up on a board')}
            onClick={() => setSettingUp(true)}
          >
            <Grid3x3 className="size-3.5" />
          </Button>
          <Select
            value={rung}
            onValueChange={(v) => setRung(v as MatchMode)}
            ariaLabel={t('How closely to match')}
            size="sm"
            groups={[{ options: RUNGS.map((r) => ({ value: r.id, label: t(r.label) })) }]}
          />
        </>
      ) : (
        <>
          <Select
            value={presetId}
            onValueChange={(v) => {
              // Picking Custom… opens the editor; the pick only lands
              // when Apply builds a spec (see CustomMaterialWindow).
              if (v === 'custom') setEditingCustom(true);
              else setPresetId(v);
            }}
            ariaLabel={t('Material')}
            size="sm"
            className="min-w-0 flex-1"
            groups={[
              {
                options: [
                  ...ENDGAMES.map((p) => ({ value: p.id, label: t(p.label) })),
                  { value: 'custom', label: t('Custom…') },
                ],
              },
            ]}
          />
          {presetId === 'custom' && (
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Edit the custom material')}
              onClick={() => setEditingCustom(true)}
            >
              <SlidersHorizontal className="size-3.5" />
            </Button>
          )}
          <Select
            value={String(heldPlies)}
            onValueChange={(v) => setHeldPlies(Number(v))}
            ariaLabel={t('How long it must hold')}
            size="sm"
            groups={[
              { options: HELD.map((h) => ({ value: String(h.plies), label: t(h.label) })) },
            ]}
          />
        </>
      )}
      <Button
        variant="default"
        size="sm"
        disabled={
          hunting ||
          (huntKind === 'position' && huntFen.trim() === '') ||
          (huntKind === 'material' && presetId === 'custom' && customSpec === null)
        }
        onClick={() => void runHunt()}
      >
        <ScanSearch className="size-3.5" data-icon="inline-start" />
        {t('Search')}
      </Button>
    </div>
  );

  return (
    <>
    <GameListShell
      shape={shape}
      toolbar={
        <div className="flex w-full flex-col gap-2">
          <div className="flex w-full items-center gap-1.5">
            <SearchInput
              inputSize="sm"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t('Search players, openings, or ECO')}
              spellCheck={false}
              className="min-w-0 flex-1"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              active={huntOpen}
              title={t('Search by position or material')}
              className="shrink-0"
              onClick={() => {
                if (huntOpen) {
                  setHuntOpen(false);
                  if (huntRows !== null) clearHunt();
                } else {
                  setHuntOpen(true);
                }
              }}
            >
              <ScanSearch className="size-3.5" />
            </Button>
          </div>
          {huntControls}
        </div>
      }
      filters={filters}
      countBand={countBand}
      listHeader={table ? <GameTableHeader /> : undefined}
      dense={table}
      // undefined when empty, or the bare bordered ul doubles the empty
      // state's own top rule.
      list={rowItems.length > 0 ? rowItems : undefined}
      // Nothing for the first moment — a search that answers in 40 ms
      // should not flash a skeleton on the way past (useSlowLoad above);
      // when it does draw, it REPLACES the rows instead of stacking a
      // second list above them. A hunt streams rows in as it scans, so
      // it never shows the skeleton at all.
      listLoading={!inHunt && searching}
      // In a sheet the card scrolls below sm and the list scrolls from sm
      // up, exactly like the archive in the same window.
      listClassName={
        shape === 'sheet'
          ? 'sm:max-h-none sm:flex-1 sm:overflow-y-auto'
          : 'flex-1 overflow-y-auto'
      }
      more={
        // "more", not "older": this list is in insertion order (id DESC),
        // which is no promise about dates. A hunt has no pages: the scan
        // streams everything it finds up to the server's cap.
        !inHunt && nextCursor !== null ? { ref: sentinel, label: t('Loading more games…') } : null
      }
      tail={
        // A search that comes back empty says so, with the way out — an
        // empty bordered box under a count of 0 read as a broken pane.
        inHunt && !hunting && (huntRows?.length ?? 0) === 0 ? (
          <EmptyState
            className="border-border min-h-0 flex-1 border-t"
            icon={SearchX}
            title={huntFailed ? 'The search failed' : 'No games found'}
            body={
              huntFailed === 'bad-fen'
                ? 'That is not a position — paste a FEN, like the one Copy FEN puts on the clipboard.'
                : huntFailed
                  ? 'The server could not finish the search.'
                  : 'No game in this database contains what you searched for, under the filters above.'
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => void runHunt()}>
                {t('Try again')}
              </Button>
            }
          />
        ) : !inHunt && !loading && rows.length === 0 ? (
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
    {settingUp && (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setSettingUp(false);
        }}
      >
        {/* The same full window the reference sheet uses: the editor is
            a board and its tools, and a content-sized card would grow
            under the hand placing pieces on it. */}
        <DialogContent title="Set up a position" className="max-sm:h-[88%]" size="full">
          <div className="force-stacked min-h-0 flex-1 overflow-y-auto">
            <Suspense
              fallback={<Spinner className="text-muted-foreground m-auto size-5" />}
            >
              <EditorView
                key={huntFen.trim() || 'blank'}
                initialFen={huntFen.trim() || undefined}
                useLabel={t('Search')}
                onUse={(fen) => {
                  setHuntFen(fen);
                  setSettingUp(false);
                  void runHunt(fen);
                }}
              />
            </Suspense>
          </div>
        </DialogContent>
      </Dialog>
    )}
    {editingCustom && (
      <CustomMaterialWindow
        initial={customDraft}
        onApply={(draft, spec) => {
          setCustomDraft(draft);
          setCustomSpec(spec);
          setPresetId('custom');
          setEditingCustom(false);
        }}
        onClose={() => setEditingCustom(false)}
      />
    )}
    {details && (
      <GameDetailsSheet selection={packageRow(details)} onClose={() => setDetails(null)} />
    )}
    <GamePreview preview={preview} onClose={hidePreview} />
    </>
  );
}
