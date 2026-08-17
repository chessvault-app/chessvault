import { parseSquare } from 'chessops/util';
import { BookmarkPlus, BookOpen, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Eraser, FlipVertical2, Loader2, Microscope, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { addSan, addUci, createTree, getNode, legalDests, mainlineFrom, moveSquares, pathTo, positionAt } from '@shared/tree';
import { pgnToChapters, treeToPgn } from '@shared/pgn';
import type { Chapter, MoveTree, NodeId } from '@shared/types';
import { Board, type BoardApi } from '@/board/Board';
import { advanceCands, buildPosIndex, expectedSans, fenKey, GAP_NOTE_SHARE, openingFamily, studyChild, trunkOf, type DrillCand } from './drill';
import { consumeMapDrill, type MapDrillTarget } from './mapDrill';
import { fieldDatabases, ONLINE_SOURCE, RATING_BANDS, type FieldDatabase, type FieldMove } from './field';
import type { Dests, Key } from '@lichess-org/chessground/types';
import { BOARD_MAX_W } from '@/board/boardSize';
import { AnswerPanel } from '@/puzzles/AnswerPanel';
import { playSound } from '@/board/sound';
import { EvalBar } from '@/engine/EvalBar';
import { formatScore, toWhitePov } from '@/engine/uci';
import { useEngine } from '@/store/engine';
import { useAnalysis } from '@/store/analysis';
import { navigate, up } from '@/lib/router';
import { isDemo } from '@/lib/demo';
import { bookLabel } from '@/store/explorer';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { SearchInput } from '@/ui/Input';
import { rememberDrill, rememberedDrill } from '@/lib/training';
import { autoFocusField } from '@/lib/media';
import { PromptSheet } from '@/ui/PromptSheet';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { Sheet } from '@/ui/Sheet';
import { InfoTip } from '@/ui/InfoTip';
import { KingIcon } from '@/ui/KingIcon';
import { SideDot } from '@/ui/SideDot';
import { Panel, PanelHeader } from '@/ui/Panel';
import { BOARD_SCROLL_SHELL, BOARD_WIDE_SIDE } from '@/ui/layout';
import { Select } from '@/ui/Select';
import { t } from '@/lib/i18n';

/**
 * Repertoire trainer: rehearse an opening against the field. You move; the app
 * replies with a real move, chosen in proportion to how often it was actually
 * played — in the Lichess database, filtered to a rating band you pick, or in
 * any local reference database. A database offers no band: its population was
 * fixed when it was built (the bundled one is elite-only by construction),
 * which is also what makes it work offline with no token. When the line runs past the source
 * the opening is over — the whole line hands off to the Board for engine
 * analysis.
 */

type Phase = 'idle' | 'playing' | 'thinking' | 'ended';

interface Template {
  eco: string;
  name: string;
  sans: string[];
}

// A spread of the major openings, each seeded to the point where it earns its
// name. "Free" starts at move one. ECO codes are the opening's root.
const TEMPLATES: Template[] = [
  { eco: '', name: 'Start position', sans: [] },
  { eco: 'B20', name: 'Sicilian Defence', sans: ['e4', 'c5'] },
  { eco: 'C00', name: 'French Defence', sans: ['e4', 'e6'] },
  { eco: 'B10', name: 'Caro-Kann Defence', sans: ['e4', 'c6'] },
  { eco: 'B01', name: 'Scandinavian Defence', sans: ['e4', 'd5'] },
  { eco: 'B07', name: 'Pirc Defence', sans: ['e4', 'd6'] },
  { eco: 'C60', name: 'Ruy López', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'C50', name: 'Italian Game', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { eco: 'C45', name: 'Scotch Game', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'C25', name: 'Vienna Game', sans: ['e4', 'e5', 'Nc3'] },
  { eco: 'D06', name: "Queen's Gambit", sans: ['d4', 'd5', 'c4'] },
  { eco: 'D10', name: 'Slav Defence', sans: ['d4', 'd5', 'c4', 'c6'] },
  { eco: 'D02', name: 'London System', sans: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4'] },
  { eco: 'E60', name: "King's Indian Defence", sans: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'E20', name: 'Nimzo-Indian Defence', sans: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'A80', name: 'Dutch Defence', sans: ['d4', 'f5'] },
  { eco: 'A10', name: 'English Opening', sans: ['c4'] },
  { eco: 'A04', name: 'Réti Opening', sans: ['Nf3'] },
];

type ExplorerMove = FieldMove;

/**
 * The last drilled study and chapter, kept in the VAULT like the puzzle
 * trainer's difficulty: a user drills the same opening for weeks, so the
 * pickers open on it instead of on the alphabet's first study — and they
 * drill the same opening on the phone as on the desktop, which a memo
 * kept per browser could not do. Written when a drill starts, not when
 * one is browsed to. See lib/training.ts for the echo that still answers
 * before the vault does.
 */

/** Weighted-random pick by game count — the field's move, not the best move. */
function sampleMove(moves: ExplorerMove[]): ExplorerMove | null {
  const playable = moves.filter((m) => m.total > 0);
  const total = playable.reduce((s, m) => s + m.total, 0);
  if (total === 0) return null;
  let r = Math.random() * total;
  for (const m of playable) {
    r -= m.total;
    if (r < 0) return m;
  }
  return playable[playable.length - 1] ?? null;
}

/**
 * Drill mode: the trainer tests you against one of your own studies.
 *
 * Sparring plays anything; drilling holds you to what a chosen study
 * chapter prepared. Your moves are checked against the chapter's tree —
 * a wrong one is refused, named, and remembered as a miss — while the
 * field keeps playing the OTHER side from the database, so the replies
 * you face arrive in proportion to how often real games play them —
 * steered to the replies the study covers, so a rare sideline cannot end
 * every session (lanph3re's report: gaps ended drills too often). A
 * common reply the study never answered is a coverage gap: noted in
 * passing and recorded, because a gap is fixed by editing the study, not
 * by drilling harder. Only a position where the study covers NONE of the
 * field's replies ends the drill on one. The record lives in the vault
 * (server/repertoire.ts); missed positions form a review pool under the
 * puzzle trainer's own rule — latest attempt decides.
 *
 * Scope is a choice: one chapter (the default), or the whole study as
 * one repertoire. The drill's position is a SET of study nodes — every
 * node in scope holding the current position — so chapters written as
 * one-variation-each compose, and a transposition into a line another
 * chapter (or move order) reached is recognised, not called a miss.
 * See docs/repertoire.md for the algorithm end to end.
 */
type Mode = 'spar' | 'drill';

/** One review-pool entry, as the summary endpoint returns it. */
interface ReviewEntry {
  chapter: string;
  key: string;
  path: string[];
  expected: string[];
}

/** The SANs from the root down to a node — the drill record's evidence. */
const sansTo = (tree: MoveTree, id: NodeId): string[] =>
  pathTo(tree, id).flatMap((n) => {
    const san = getNode(tree, n).san;
    return san ? [san] : [];
  });

/** orig+dest, queening a pawn that reaches the far rank (the opening never
    needs under-promotion). */
function toUci(tree: MoveTree, cursorId: NodeId, orig: string, dest: string): string {
  const pos = positionAt(tree, cursorId);
  const sq = parseSquare(orig);
  const piece = sq === undefined ? undefined : pos.board.get(sq);
  const lastRank = dest[1] === '8' || dest[1] === '1';
  return piece?.role === 'pawn' && lastRank ? `${orig}${dest}q` : `${orig}${dest}`;
}

/**
 * The two name slots either side of the board.
 *
 * The Board tab wears these and a repertoire line did not, so the board
 * sat at a different height and shifted when you moved between them.
 * There are no real players here — one side is you, the other is the
 * repertoire answering — so they say that rather than pretending to be a
 * game, and the side to move is the one shown in full strength.
 */
function PlayerSlot({ side, fen, className }: { side: 'white' | 'black'; fen: string; className?: string }) {
  const toMove = (fen.split(' ')[1] === 'b' ? 'black' : 'white') === side;
  return (
    // Shown at every width, like the Board tab's. These were hidden on
    // phones while the New game panel was being cut off, on the theory that
    // two more rows around the board were what pushed it over. They were
    // not: the panel's own column was a nested scroll container that
    // clipped what its min-height under-measured. With that fixed the rows
    // cost nothing but the height they occupy, and the page scrolls.
    <div className={cn('flex h-6 w-full items-center gap-2 px-0.5', className)}>
      <SideDot side={side} />
      <span className={cn('min-w-0 flex-1 truncate text-sm', toMove ? 'text-fg font-medium' : 'text-subtle')}>
        {side === 'white' ? t('White') : t('Black')}
      </span>
    </div>
  );
}

/**
 * Opening picker: the curated spread when idle, the ENTIRE ECO catalogue
 * (served from the vendored lichess chess-openings set) as soon as you type.
 * A combobox rather than a Select — 3,800 openings need a filter, not a list.
 *
 * Touch gets a different shape: an inline input under the board sits exactly
 * where the keyboard lands, so tapping it hid everything (lanph3re's report).
 * On coarse pointers the trigger is a plain button and the search opens as a
 * sheet pinned to the TOP of the viewport — visible above any keyboard, and
 * nothing on the page is scripted to scroll while it animates.
 */
/**
 * Pick an opening to spar from.
 *
 * Two shapes for two pointers. On a phone it is the app's own Sheet —
 * rising from the bottom with the drag, the scrim and the Escape every
 * other window has. On a desktop it is a combobox: the list drops
 * anchored under the field itself (portalled past the Panel's clipping,
 * like every floating layer here), capped in height with the search
 * pinned above the scroll — so the board stays on screen while an
 * opening is being chosen, instead of disappearing behind a centred
 * card. lanph3re's report: the modal covered the board and broke the
 * visual context.
 */
function OpeningPicker({
  value,
  onChange,
}: {
  value: Template;
  onChange: (t: Template) => void;
}) {
  const [all, setAll] = useState<Template[] | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  /** Where the desktop popover goes; null means the phone's sheet. */
  const [anchor, setAnchor] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/openings')
      .then((r) => r.json())
      .then((body: { openings?: Template[] }) => {
        if (!cancelled) setAll(body.openings ?? []);
      })
      .catch(() => {
        if (!cancelled) setAll([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Rendered at once. The catalogue is thousands of entries, and building
      that many buttons to open a list costs most of a second. */
  const SHOWN = 300;

  const { matches, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    // An empty box offers the whole catalogue, ordered by ECO, with the
    // curated few first — so the picker can be browsed and not only
    // searched.
    const pool = q
      ? (all ?? []).filter(
          (o) => o.eco.toLowerCase().startsWith(q) || o.name.toLowerCase().includes(q),
        )
      : [...TEMPLATES, ...(all ?? []).filter((o) => !TEMPLATES.some((t) => t.name === o.name))];
    return { matches: pool.slice(0, SHOWN), hidden: Math.max(0, pool.length - SHOWN) };
  }, [query, all]);

  const pick = (o: Template): void => {
    onChange(o);
    setOpen(false);
  };

  /**
   * Open under the field on a desktop, as a sheet otherwise.
   *
   * The anchor is read once, when it opens — the same rule ActionSheet
   * follows — and the list prefers to hang BELOW the field, flipping
   * above only when the field is near the bottom and there is more room
   * over it. Height is capped so the whole thing stays inside the
   * viewport and the list scrolls instead.
   */
  const openPicker = (): void => {
    setQuery('');
    const rect = window.matchMedia('(min-width: 40rem)').matches
      ? triggerRef.current?.getBoundingClientRect()
      : undefined;
    if (rect) {
      const wanted = 384;
      const width = Math.max(rect.width, 288);
      const left = Math.min(rect.left, window.innerWidth - width - 8);
      const below = window.innerHeight - rect.bottom - 12;
      setAnchor(
        below >= 240 || below >= rect.top - 12
          ? { top: rect.bottom + 4, left, width, maxHeight: Math.min(wanted, below) }
          : {
              bottom: window.innerHeight - rect.top + 4,
              left,
              width,
              maxHeight: Math.min(wanted, rect.top - 12),
            },
      );
    } else {
      setAnchor(null);
    }
    setOpen(true);
  };

  // The popover has no scrim, so it dismisses itself: Escape, and any
  // press outside it (a press on the field again just closes it).
  useEffect(() => {
    if (!open || !anchor) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openPicker();
        }}
        className={cn(
          'border-line bg-surface-inset text-fg flex h-9 min-w-0 items-center rounded-md border',
          'px-2.5 text-left text-xs transition-colors duration-100',
          'hover:border-primary/40',
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {/* t() so "Start position" translates; real opening names are
              proper nouns and pass through untouched. */}
          {value.eco ? `${value.eco}  ${value.name}` : t(value.name)}
        </span>
      </button>

      {open &&
        (() => {
          // One search box and one list, whichever container they open in.
          // A real SearchInput: it filters the list live, so it gets the
          // X and Cancel every other live filter carries. Desktop-only
          // autofocus, per the search-field rule — on a phone the sheet
          // opens to browse the list, not with a keyboard over it.
          const searchBox = (
            <SearchInput
              autoFocus={autoFocusField()}
              inputSize="sm"
              className="w-full"
              value={query}
              placeholder={t('Search any opening or ECO code…')}
              onChange={(e) => setQuery(e.target.value)}
            />
          );
          // The container owns the height; the list scrolls inside it
          // rather than growing past the keyboard (sheet) or the
          // viewport (popover).
          const list = (
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {matches.length === 0 ? (
                <li className="text-subtle px-2 py-1.5 text-xs">
                  {all === null ? t('Reading the catalogue…') : t('No opening matches that.')}
                </li>
              ) : (
                matches.map((o, i) => (
                  <li key={`${o.eco}-${o.name}-${i}`} className="[content-visibility:auto]">
                    <button
                      type="button"
                      onClick={() => pick(o)}
                      className={cn(
                        'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                        'hover:bg-surface-2 transition-colors duration-100 pointer-coarse:py-2.5',
                        o.name === value.name && o.eco === value.eco
                          ? 'text-primary font-medium'
                          : 'text-fg',
                      )}
                    >
                      {o.eco && (
                        <span className="text-subtle w-7 shrink-0 font-mono text-[0.6875rem]">
                          {o.eco}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{t(o.name)}</span>
                    </button>
                  </li>
                ))
              )}
              {hidden > 0 && (
                <li className="text-subtle px-2 py-1.5 text-[0.6875rem]">
                  {t('{count} more — type to narrow.', { count: hidden.toLocaleString() })}
                </li>
              )}
            </ul>
          );

          if (!anchor) {
            return (
              <Sheet label={t('Opening')} onClose={() => setOpen(false)} className="gap-2">
                {searchBox}
                {list}
              </Sheet>
            );
          }

          // Portalled past the Panel: a Panel clips its children, and a
          // floating layer has no business living inside the thing it
          // floats over (see ActionSheet).
          return createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={t('Opening')}
              style={{
                position: 'fixed',
                top: anchor.top,
                bottom: anchor.bottom,
                left: anchor.left,
                width: anchor.width,
                maxHeight: anchor.maxHeight,
              }}
              className={cn(
                'bg-surface border-line z-50 flex flex-col overflow-hidden rounded-lg border',
                'shadow-[var(--shadow-pop)]',
              )}
            >
              {/* Above the scroll, not inside it: the search stays put
                  while the catalogue scrolls under it. */}
              <div className="border-line shrink-0 border-b p-2">{searchBox}</div>
              <div className="flex min-h-0 flex-1 flex-col p-1">{list}</div>
            </div>,
            document.body,
          );
        })()}
    </>
  );
}

/**
 * How the line ended, and a way into the board.
 *
 * The trainer's job stops when the line leaves the database — the panel
 * has always SAID to go and analyse it, and then offered nothing to do
 * that with. So the button is back, at the one moment it means
 * something, and it carries the answer to the question you would open
 * the board to ask: how does this position actually stand.
 *
 * The engine is switched on to answer it. That is a session switch, not
 * a stored preference — `enabled` is deliberately not persisted (see
 * store/engine.ts) — so this turns it on for the evaluation and leaves
 * it visibly on, rather than running something the app says is off.
 */
function FinalAssessment({
  fen,
  onAnalyse,
  children,
}: {
  fen: string;
  onAnalyse: () => void;
  /** What else this ending offers, beside Analyse — one row of buttons. */
  children?: ReactNode;
}) {
  const enabled = useEngine((s) => s.enabled);
  const setEnabled = useEngine((s) => s.setEnabled);
  const analyse = useEngine((s) => s.analyse);
  const lines = useEngine((s) => s.lines);
  const resultFen = useEngine((s) => s.resultFen);
  const finished = useEngine((s) => s.finished);

  /**
   * The verdict, kept here rather than read from the engine.
   *
   * Switching the engine off frees its worker AND clears its results (see
   * store/engine.ts), so the number has to be taken out before the engine
   * goes — otherwise stopping it would erase the very thing it was
   * started for.
   */
  const [verdict, setVerdict] = useState<{ cp?: number; mate?: number } | null>(null);
  // Whether WE turned it on. An engine the reader had already running is
  // theirs, and stopping it because a sparring line ended would be this
  // page reaching outside itself.
  const startedByUs = useRef(false);

  useEffect(() => {
    if (verdict) return;
    if (!enabled) {
      startedByUs.current = true;
      setEnabled(true);
      return;
    }
    analyse(fen);
  }, [enabled, fen, verdict, analyse, setEnabled]);

  // One position, one search: take the answer at the end of it and stop.
  // It used to run on after the number appeared, which on a phone is a
  // fan spinning for a line that finished a minute ago.
  useEffect(() => {
    if (verdict || !finished || resultFen !== fen) return;
    const best = lines[0];
    if (!best) return;
    const turn: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    setVerdict(toWhitePov({ cp: best.cp, mate: best.mate }, turn));
    if (startedByUs.current) setEnabled(false);
  }, [finished, resultFen, fen, lines, verdict, setEnabled]);

  // Leaving mid-search stops it too, for the same reason.
  useEffect(
    () => () => {
      if (startedByUs.current) useEngine.getState().setEnabled(false);
    },
    [],
  );

  // Before the verdict is in, show the engine's running best guess.
  const live =
    resultFen === fen && lines[0]
      ? toWhitePov(
          { cp: lines[0].cp, mate: lines[0].mate },
          fen.split(' ')[1] === 'b' ? 'black' : 'white',
        )
      : null;
  const score = verdict ?? live;

  return (
    <div className="flex flex-col gap-2">
      {/* The verdict is ONE block — the number, the bar and the line that
          says the search is still running — so it is spaced as one, and
          only the buttons under it get the panel's own gap. Spread over
          three equal gaps it read as three separate things with the
          button pushed a long way clear of the score it belongs to.

          The number's slot is held whether or not there is a number in it,
          and the bar is drawn empty rather than absent, so the answer
          lands in place instead of pushing the button down when it
          arrives. Starting an engine and searching a position takes long
          enough to look like nothing is happening — hence the spinner in
          the slot and a line that says so. */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-fg flex min-w-[3.75rem] items-center font-mono text-lg font-semibold tabular-nums">
            {score ? formatScore(score) : <Loader2 className="text-subtle size-4 animate-spin" />}
          </span>
          <EvalBar score={score} orientation="horizontal" className="flex-1" />
        </div>
        <p className="text-subtle min-h-[0.875rem] text-[0.6875rem] leading-none">
          {verdict ? '' : t('Evaluating the position…')}
        </p>
      </div>
      {/* One row: analysing the line and whatever else this ending offers
          are the same kind of choice, and stacking them spent a whole row
          of a panel that is already tall on a phone. It wraps where the
          two do not fit side by side. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={onAnalyse}>
          <Microscope className="size-3.5" />
          {t('Analyse on the board')}
        </Button>
        {children}
      </div>
    </div>
  );
}

export function RepertoireView() {
  // A drill the opening map sent over, consumed once on mount. While it is
  // set, drill mode holds the map's whole repertoire instead of one study.
  const [mapDrill, setMapDrill] = useState<MapDrillTarget | null>(() => consumeMapDrill());
  const [userColor, setUserColor] = useState<'white' | 'black'>(mapDrill?.color ?? 'white');
  // 1600–1800: the group the database as a whole averages into.
  const [band, setBand] = useState(RATING_BANDS[4]!.ratings);
  const [template, setTemplate] = useState<Template>(TEMPLATES[0]!);
  // '' = undecided, resolved when the database list arrives. The demo cannot
  // offer the online source (no token can ship in a static bundle), so it
  // starts undecided and settles on the first database.
  const [source, setSource] = useState<string>(isDemo() ? '' : ONLINE_SOURCE);
  const [databases, setDatabases] = useState<FieldDatabase[]>([]);

  // Which reference databases exist, for the source picker.
  useEffect(() => {
    void fetch('/api/refgames')
      .then((r) => (r.ok ? r.json() : { databases: [] }))
      .then((body) => {
        // fieldDatabases, not `databases ?? []`: on a single-file mount the
        // one database has no list to appear in, and the demo settled on
        // the online source instead — a source its own picker hides.
        const found = fieldDatabases(body);
        setDatabases(found);
        setSource((s) => (s === '' ? (found[0]?.name ?? ONLINE_SOURCE) : s));
      })
      .catch(() => {
        setDatabases([]);
        setSource((s) => (s === '' ? ONLINE_SOURCE : s));
      });
  }, []);

  const [tree, setTree] = useState<MoveTree>(() => createTree());
  const [tipId, setTipId] = useState<NodeId>(tree.rootId);
  const [cursorId, setCursorId] = useState<NodeId>(tree.rootId);
  const [phase, setPhase] = useState<Phase>('idle');

  // Drill mode: which study is being drilled and where the drill stands.
  const [mode, setMode] = useState<Mode>(mapDrill ? 'drill' : 'spar');
  const [studyList, setStudyList] = useState<string[] | null>(null);
  const [drillStudy, setDrillStudy] = useState('');
  const [drillChapters, setDrillChapters] = useState<Chapter[] | null>(null);
  // 'all' drills the whole study as one repertoire; a number scopes to
  // that chapter, the original behaviour and still the default.
  const [chapterPick, setChapterPick] = useState('0');
  const [summary, setSummary] = useState<{
    attempted: number;
    review: ReviewEntry[];
    gaps: number;
  } | null>(null);
  const [drillNotice, setDrillNotice] = useState<string | null>(null);
  /** A gap noted in passing — shown under the status, never stopping play. */
  const [gapNote, setGapNote] = useState<string | null>(null);
  /** Why the line ended: past the database, the study's edge, or a gap. */
  const [endKind, setEndKind] = useState<'book' | 'line' | 'gap'>('book');
  const [gapMsg, setGapMsg] = useState('');
  /** The live drill: the chapters in scope, their position index, and
      the current candidate nodes — mutated in place as moves match;
      render state never reads it, so a ref is honest. */
  const drillRef = useRef<{
    chapters: Chapter[];
    posIndex: Map<string, DrillCand[]>;
    cands: DrillCand[];
    study: string;
    /** Per-chapter study ids, when the scope pools several studies (a
        map-wide drill) — records file under the real study, not a
        synthetic one. Index-parallel with `chapters`. */
    studies?: string[];
    /** For the practice memo: the chapter's name, or "Whole study". */
    label: string;
    /** Where the shared lead-in ends — gap relevance turns on it. */
    trunkPly: number;
    trunkFen: string;
    /** The trunk end's opening family, fetched once on first need;
        undefined = not asked yet, null = the position has no name. */
    subjectFamily?: string | null;
    /** Position key -> opening family, so one deviation asks once. */
    families: Map<string, string | null>;
    missed: Set<string>;
    gapNoted: Set<string>;
  } | null>(null);
  const wholeStudy = chapterPick === 'all';
  const chapterIdx = wholeStudy ? 0 : Number(chapterPick) || 0;

  // The studies list, first needed when drilling is chosen.
  useEffect(() => {
    if (mode !== 'drill' || mapDrill !== null || studyList !== null) return;
    void fetch('/api/studies')
      .then((r) => r.json())
      .then((body: { studies?: { id: string }[] }) => {
        const ids = (body.studies ?? []).map((st) => st.id);
        setStudyList(ids);
        const remembered = rememberedDrill();
        setDrillStudy(
          (d) => d || (remembered && ids.includes(remembered.study) ? remembered.study : (ids[0] ?? '')),
        );
      })
      .catch(() => setStudyList([]));
  }, [mode, studyList]);

  // The chosen study's chapters, through the same codec the editor uses.
  useEffect(() => {
    if (mode !== 'drill' || mapDrill !== null || !drillStudy) return;
    let cancelled = false;
    setDrillChapters(null);
    setChapterPick('0');
    void fetch(`/api/studies/${encodeURIComponent(drillStudy)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { pgn?: string } | null) => {
        if (cancelled) return;
        const chapters = typeof body?.pgn === 'string' ? pgnToChapters(body.pgn) : [];
        setDrillChapters(chapters);
        // The memo names a chapter of THIS study: reopen on it.
        const remembered = rememberedDrill();
        if (
          remembered &&
          remembered.study === drillStudy &&
          (remembered.chapter === 'all' || Number(remembered.chapter) < chapters.length)
        ) {
          setChapterPick(remembered.chapter);
        }
      })
      .catch(() => {
        if (!cancelled) setDrillChapters([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, drillStudy]);

  // What the record says about this chapter. Re-asked when a session ends
  // (phase is a dependency) so the idle panel's counts are never stale.
  useEffect(() => {
    const chapter = drillChapters?.[chapterIdx];
    if (mode !== 'drill' || !drillStudy || !chapter || phase !== 'idle') {
      return;
    }
    let cancelled = false;
    const scope = wholeStudy ? '' : `&chapter=${encodeURIComponent(chapter.name)}`;
    void fetch(`/api/repertoire/summary?study=${encodeURIComponent(drillStudy)}${scope}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { attempted?: number; review?: ReviewEntry[]; gaps?: unknown[] } | null) => {
        if (!cancelled) {
          setSummary(
            body
              ? {
                  attempted: body.attempted ?? 0,
                  review: body.review ?? [],
                  gaps: (body.gaps ?? []).length,
                }
              : null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, drillStudy, drillChapters, chapterIdx, wholeStudy, phase]);

  /** A position's opening family, from the vendored catalogue. Failures
      answer null — no name, no filtering. */
  const fetchFamily = async (fen: string): Promise<string | null> => {
    try {
      const res = await fetch(`/api/opening?fen=${encodeURIComponent(fen)}`);
      const body = (await res.json().catch(() => null)) as {
        opening?: { name?: string } | null;
      } | null;
      return openingFamily(body?.opening?.name ?? null);
    } catch {
      return null;
    }
  };

  /** One drilled position, into the vault. Losing the record must never
      stop the drill, so failures are swallowed. */
  const recordDrill = (entry: {
    key: string;
    result: 'hit' | 'miss' | 'gap';
    path: string[];
    expected?: string[];
    played?: string;
  }): void => {
    const d = drillRef.current;
    if (!d) return;
    // Attributed to the first candidate's chapter — and, when the scope
    // pools several studies, to that chapter's own study — so a whole-map
    // drill still files its record under real names.
    const ci = d.cands[0]?.ci ?? 0;
    const chapter = d.chapters[ci]?.name ?? '';
    const study = d.studies?.[ci] ?? d.study;
    void fetch('/api/repertoire/attempt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ study, chapter, ...entry }),
    }).catch(() => {});
  };
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a stale reply landing after a new game.
  const runId = useRef(0);
  /** Imperative chessground handle, for snapping a refused move back. */
  const boardApi = useRef<BoardApi | null>(null);

  // Saving the sparred line into the vault: the session used to
  // evaporate — leaving lost the line, and nothing recorded that you
  // practised at all.
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed a tree with the template's line — used both for the idle preview
  // (picking an opening shows its position at once) and for starting a game.
  const seedTree = (tpl: Template): { t: MoveTree; id: NodeId } => {
    let t = createTree();
    let id = t.rootId;
    for (const san of tpl.sans) {
      const added = addSan(t, id, san);
      if (!added) break;
      t = added.tree;
      id = added.nodeId;
    }
    return { t, id };
  };

  // Idle previews the chosen opening immediately, last move highlighted —
  // or, in drill mode, the chosen chapter's starting position.
  useEffect(() => {
    if (phase !== 'idle') return;
    if (mode === 'drill') {
      if (mapDrill) {
        // Preview the node the map-wide drill will start from.
        let t = createTree();
        let id = t.rootId;
        for (const san of mapDrill.path) {
          const added = addSan(t, id, san);
          if (!added) break;
          t = added.tree;
          id = added.nodeId;
        }
        setTree(t);
        setTipId(id);
        setCursorId(id);
        return;
      }
      const chapter = drillChapters?.[chapterIdx];
      const t = chapter ? createTree(getNode(chapter.tree, chapter.tree.rootId).fen) : createTree();
      setTree(t);
      setTipId(t.rootId);
      setCursorId(t.rootId);
      return;
    }
    const { t, id } = seedTree(template);
    setTree(t);
    setTipId(id);
    setCursorId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, phase, mode, drillChapters, chapterIdx, mapDrill]);

  const node = getNode(tree, cursorId);
  const pos = useMemo(() => positionAt(tree, cursorId), [tree, cursorId]);
  // mainlineFrom EXCLUDES its starting node — prepend the root so index 0 is
  // the start position. Without it the first move fell off the moves panel
  // (slice(1) skipped a MOVE) and "First move" could never reach the start.
  const line = useMemo(() => [tree.rootId, ...mainlineFrom(tree, tree.rootId)], [tree]);
  const atTip = cursorId === tipId;
  const orientation = flipped ? (userColor === 'white' ? 'black' : 'white') : userColor;

  const canMove = phase === 'playing' && atTip && pos.turn === userColor;
  // A chapter (or study) with no moves has nothing to drill.
  const drillChapter = drillChapters?.[chapterIdx] ?? null;
  const drillReady = mapDrill
    ? mapDrill.entries.length > 0
    : wholeStudy
      ? (drillChapters ?? []).some((c) => getNode(c.tree, c.tree.rootId).children.length > 0)
      : drillChapter !== null &&
        getNode(drillChapter.tree, drillChapter.tree.rootId).children.length > 0;
  const dests = useMemo(() => (canMove ? legalDests(tree, cursorId) : new Map()), [canMove, tree, cursorId]);

  // Fetch the field's reply and play it. The runId guard drops replies that
  // arrive after the game was restarted.
  const reply = useCallback(
    async (curTree: MoveTree, curId: NodeId, src: string, ratings: string) => {
      const token = runId.current;
      setPhase('thinking');
      setError(null);
      // A steady minimum "thinking" time: the DB fetch is instant when the
      // position is cached and slow when it isn't, which felt jarringly
      // random. Waiting out the rest of MIN_THINK makes the reply land at a
      // consistent, deliberate pace.
      const started = Date.now();
      // Both sources answer in the same shape — the server normalises the
      // Lichess payload to the book contract — so only the URL differs.
      const online = src === ONLINE_SOURCE;
      const fallback = online
        ? 'Could not reach the Lichess database.'
        : 'Could not read the reference database.';
      try {
        const fen = getNode(curTree, curId).fen;
        const res = await fetch(
          online
            ? `/api/explorer/lichess?fen=${encodeURIComponent(fen)}&ratings=${ratings}`
            : `/api/refgames/explore?db=${encodeURIComponent(src)}&fen=${encodeURIComponent(fen)}`,
        );
        if (token !== runId.current) return;
        const body = (await res.json().catch(() => null)) as { moves?: ExplorerMove[]; error?: string } | null;
        if (!res.ok || !body?.moves) {
          setError(t(body?.error ?? fallback));
          setPhase('playing');
          return;
        }
        let choice = sampleMove(body.moves);
        if (!choice) {
          setPhase('ended');
          return;
        }
        // Drill: steer the field toward the replies the study covers, so
        // the session keeps testing memory instead of ending on every
        // rare sideline. The commonest uncovered reply is still noted —
        // and recorded as a gap — it just no longer stops play. Only a
        // position where the study covers none of the field's replies
        // falls through to the honest full-field sample, and ends below.
        const drill = drillRef.current;
        let note: string | null = null;
        if (drill) {
          const games = body.moves.reduce((sum, m) => sum + m.total, 0);
          // In book: some candidate prepares the move, or it transposes
          // into a position the scope holds anywhere (probed on a
          // scratch tree; nothing is committed).
          const inBook = (m: ExplorerMove): boolean => {
            if (
              drill.cands.some(
                (c) => studyChild(drill.chapters[c.ci]!.tree, c.nodeId, m.san) !== null,
              )
            ) {
              return true;
            }
            const probe = addUci(curTree, curId, m.uci);
            return probe != null && drill.posIndex.has(fenKey(getNode(probe.tree, probe.nodeId).fen));
          };
          const covered = body.moves.filter((m) => m.total > 0 && inBook(m));
          if (covered.length > 0) {
            choice = sampleMove(covered) ?? choice;
            const uncovered = body.moves
              .filter((m) => m.total > 0 && !inBook(m))
              .sort((a, b) => b.total - a.total)[0];
            const probe =
              uncovered && games > 0 && uncovered.total / games >= GAP_NOTE_SHARE
                ? addUci(curTree, curId, uncovered.uci)
                : undefined;
            if (uncovered && probe) {
              // Relevance: a gap is a SIDELINE of the study's subject.
              // Past the trunk the study branches here anyway, so
              // everything counts; before it, only a deviation that
              // stays in the trunk end's opening family does — 1...c5
              // is not a hole in a Ruy Lopez study, 3...Nf6 is
              // (lanph3re's point). An unnamed subject gives no basis
              // to filter, so everything counts, as before.
              const probeFen = getNode(probe.tree, probe.nodeId).fen;
              const key = fenKey(probeFen);
              let relevant = sansTo(curTree, curId).length >= drill.trunkPly;
              if (!relevant) {
                if (drill.subjectFamily === undefined) {
                  drill.subjectFamily = await fetchFamily(drill.trunkFen);
                }
                let family = drill.families.get(key);
                if (family === undefined) {
                  family = await fetchFamily(probeFen);
                  drill.families.set(key, family);
                }
                relevant =
                  drill.subjectFamily === null ? true : family === drill.subjectFamily;
              }
              if (relevant) {
                note = t(
                  'Gap noted — the field also plays {san} ({pct}% of games), and your study has no answer to it.',
                  { san: uncovered.san, pct: Math.round((100 * uncovered.total) / games) },
                );
                if (!drill.gapNoted.has(key)) {
                  drill.gapNoted.add(key);
                  recordDrill({
                    key,
                    result: 'gap',
                    path: sansTo(probe.tree, probe.nodeId),
                    played: uncovered.san,
                  });
                }
              }
            }
          }
        }
        const wait = 550 - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (token !== runId.current) return;
        const added = addUci(curTree, curId, choice.uci);
        if (!added || token !== runId.current) {
          if (!added) setPhase('ended');
          return;
        }
        playSound(getNode(added.tree, added.nodeId).san?.includes('x') ? 'capture' : 'move');
        setTree(added.tree);
        setTipId(added.nodeId);
        setCursorId(added.nodeId);
        const d = drillRef.current;
        if (d) {
          const san = getNode(added.tree, added.nodeId).san ?? '';
          const newKey = fenKey(getNode(added.tree, added.nodeId).fen);
          const next = advanceCands(d.chapters, d.posIndex, d.cands, san, newKey);
          if (next.length === 0) {
            // The scope covers none of the field's replies here — with
            // nothing to steer to, the drill has hit the edge of the
            // prep, and the honest full-field sample says what beat it.
            const games = body.moves.reduce((sum, m) => sum + m.total, 0);
            const pct = games > 0 ? Math.max(1, Math.round((100 * choice.total) / games)) : 0;
            recordDrill({
              key: newKey,
              result: 'gap',
              path: sansTo(added.tree, added.nodeId),
              played: san,
            });
            setGapMsg(
              t('The field answered {san} — {pct}% of games here — and your study holds no reply.', {
                san,
                pct,
              }),
            );
            setEndKind('gap');
            setPhase('ended');
            return;
          }
          d.cands = next;
          setGapNote(note);
          if (expectedSans(d.chapters, next).length === 0) {
            setEndKind('line');
            setPhase('ended');
            return;
          }
        }
        setPhase('playing');
      } catch {
        if (token === runId.current) {
          setError(t(fallback));
          setPhase('playing');
        }
      }
    },
    [],
  );

  const onMove = (orig: string, dest: string): void => {
    if (!canMove) return;
    const added = addUci(tree, cursorId, toUci(tree, cursorId, orig, dest));
    if (!added) return;
    const d = drillRef.current;
    if (d) {
      const san = getNode(added.tree, added.nodeId).san ?? '';
      const key = fenKey(getNode(tree, cursorId).fen);
      const expected = expectedSans(d.chapters, d.cands);
      const newKey = fenKey(getNode(added.tree, added.nodeId).fen);
      const next = advanceCands(d.chapters, d.posIndex, d.cands, san, newKey);
      if (next.length === 0) {
        // A recall miss: the move is refused, the book move is named, and
        // the position waits to be answered right. Recorded once per
        // position per session — the retry that follows the reveal is
        // practice, not evidence.
        if (!d.missed.has(key)) {
          d.missed.add(key);
          recordDrill({ key, result: 'miss', path: sansTo(tree, cursorId), expected, played: san });
        }
        setDrillNotice(
          t('Your study plays {moves} here — try it again.', { moves: expected.join(' / ') }),
        );
        // The tree never takes the move, but chessground has already
        // played it on screen. Let it stand for a beat — the same rhythm
        // as the puzzle trainer's wrong-move rollback — then snap the
        // board back to the position that is still waiting.
        const back = getNode(tree, cursorId);
        const backDests = dests;
        const token = runId.current;
        setTimeout(() => {
          if (runId.current !== token) return;
          boardApi.current?.set({
            fen: back.fen,
            turnColor: userColor,
            // Square names either way — the same cast Board.tsx makes.
            lastMove: moveSquares(back) as Key[] | undefined,
            movable: { color: userColor, dests: backDests as Dests },
          });
        }, 650);
        return;
      }
      if (!d.missed.has(key)) {
        recordDrill({ key, result: 'hit', path: sansTo(tree, cursorId), expected, played: san });
      }
      setDrillNotice(null);
      d.cands = next;
      playSound(san.includes('x') ? 'capture' : 'move');
      setTree(added.tree);
      setTipId(added.nodeId);
      setCursorId(added.nodeId);
      if (expectedSans(d.chapters, next).length === 0) {
        setEndKind('line');
        setPhase('ended');
        return;
      }
      void reply(added.tree, added.nodeId, source, band);
      return;
    }
    playSound(getNode(added.tree, added.nodeId).san?.includes('x') ? 'capture' : 'move');
    setTree(added.tree);
    setTipId(added.nodeId);
    setCursorId(added.nodeId);
    void reply(added.tree, added.nodeId, source, band);
  };

  const startGame = (): void => {
    runId.current += 1;
    const token = runId.current;
    setFlipped(false);
    setError(null);
    setDrillNotice(null);
    setGapNote(null);
    setGapMsg('');
    setEndKind('book');
    if (mode === 'drill' && mapDrill) {
      // The map's whole repertoire: every scoped chapter of every tagged
      // study is one drill scope, starting from the chosen node. The
      // start is replayed from the standard start position, the same way
      // startFromMiss rebuilds a recorded path.
      const scoped = mapDrill.entries.map((e) => e.chapter);
      if (scoped.length === 0) return;
      const posIndex = buildPosIndex(scoped);
      let fresh = createTree();
      let tip = fresh.rootId;
      for (const san of mapDrill.path) {
        const added = addSan(fresh, tip, san);
        if (!added) break;
        fresh = added.tree;
        tip = added.nodeId;
      }
      const startFen = getNode(fresh, tip).fen;
      const cands = posIndex.get(fenKey(startFen)) ?? [];
      if (cands.length === 0) return;
      const rootFen = getNode(fresh, fresh.rootId).fen;
      const trunk = trunkOf(scoped, posIndex, posIndex.get(fenKey(rootFen)) ?? [], rootFen);
      drillRef.current = {
        chapters: scoped,
        posIndex,
        cands,
        study: mapDrill.entries[0]!.study,
        studies: mapDrill.entries.map((e) => e.study),
        label: mapDrill.label,
        trunkPly: trunk.ply,
        trunkFen: trunk.fen,
        families: new Map(),
        missed: new Set(),
        gapNoted: new Set(),
      };
      setTree(fresh);
      setTipId(tip);
      setCursorId(tip);
      if (positionAt(fresh, tip).turn === userColor) setPhase('playing');
      else void reply(fresh, tip, source, band);
      return;
    }
    if (mode === 'drill') {
      const scoped = wholeStudy ? (drillChapters ?? []) : drillChapter ? [drillChapter] : [];
      const startChapter = scoped[0];
      if (!startChapter) return;
      const posIndex = buildPosIndex(scoped);
      const rootFen = getNode(startChapter.tree, startChapter.tree.rootId).fen;
      // Every node in scope at the starting position — for a whole-study
      // drill that is each chapter opening from the same board.
      const cands = posIndex.get(fenKey(rootFen)) ?? [];
      if (cands.length === 0) return;
      const trunk = trunkOf(scoped, posIndex, cands, rootFen);
      rememberDrill(drillStudy, chapterPick);
      drillRef.current = {
        chapters: scoped,
        posIndex,
        cands,
        study: drillStudy,
        label: wholeStudy ? t('Whole study') : startChapter.name,
        trunkPly: trunk.ply,
        trunkFen: trunk.fen,
        families: new Map(),
        missed: new Set(),
        gapNoted: new Set(),
      };
      const fresh = createTree(rootFen);
      setTree(fresh);
      setTipId(fresh.rootId);
      setCursorId(fresh.rootId);
      if (positionAt(fresh, fresh.rootId).turn === userColor) setPhase('playing');
      else void reply(fresh, fresh.rootId, source, band);
      return;
    }
    drillRef.current = null;
    // `seeded`, not `t`: the drill branch above needs the translator.
    const { t: seeded, id } = seedTree(template);
    setTree(seeded);
    setTipId(id);
    const last = getNode(seeded, id);
    if (positionAt(seeded, id).turn === userColor) {
      // The line ends on the OPPONENT'S move and no reply will follow, so
      // nothing would ever animate (the idle preview already sits on the
      // final position). Start one move back and play it in a beat later —
      // the opponent visibly makes the move you are answering.
      if (last.parentId) {
        setCursorId(last.parentId);
        setTimeout(() => {
          if (runId.current !== token) return;
          setCursorId(id);
          playSound(last.san?.includes('x') ? 'capture' : 'move');
        }, 400);
      } else {
        setCursorId(id);
      }
      setPhase('playing');
    } else {
      // The bot moves first; its reply animates on its own.
      setCursorId(id);
      void reply(seeded, id, source, band);
    }
  };

  const newGame = (): void => {
    // Back to setup. The runId bump drops any in-flight reply; the idle
    // effect above reseeds the board to the chosen opening's preview.
    runId.current += 1;
    drillRef.current = null;
    setFlipped(false);
    setError(null);
    setDrillNotice(null);
    setGapNote(null);
    setGapMsg('');
    setPhase('idle');
  };

  /**
   * Re-drill a position the record says was fumbled: replay its path
   * against both trees and start there. A study edited since the miss may
   * no longer contain the line — then the drill starts from the top
   * rather than inventing a position the study cannot answer for.
   */
  const startFromMiss = (): void => {
    const pool = summary?.review ?? [];
    const scoped = wholeStudy ? (drillChapters ?? []) : drillChapter ? [drillChapter] : [];
    if (mode !== 'drill' || scoped.length === 0 || pool.length === 0) return;
    const entry = pool[Math.floor(Math.random() * pool.length)]!;
    // The record names the chapter its path belongs to.
    const ci = scoped.findIndex((c) => c.name === entry.chapter);
    const chapter = scoped[ci];
    if (!chapter) {
      startGame();
      return;
    }
    let gameTree = createTree(getNode(chapter.tree, chapter.tree.rootId).fen);
    let gameId = gameTree.rootId;
    let studyId: NodeId | null = chapter.tree.rootId;
    for (const san of entry.path) {
      const added = addSan(gameTree, gameId, san);
      studyId = studyId ? studyChild(chapter.tree, studyId, san) : null;
      if (!added || !studyId) {
        studyId = null;
        break;
      }
      gameTree = added.tree;
      gameId = added.nodeId;
    }
    if (studyId === null) {
      startGame();
      return;
    }
    runId.current += 1;
    setFlipped(false);
    setError(null);
    setDrillNotice(null);
    setGapNote(null);
    setGapMsg('');
    setEndKind('book');
    const posIndex = buildPosIndex(scoped);
    const cands = posIndex.get(fenKey(getNode(gameTree, gameId).fen)) ?? [{ ci, nodeId: studyId }];
    const rootFen = getNode(chapter.tree, chapter.tree.rootId).fen;
    const trunk = trunkOf(scoped, posIndex, posIndex.get(fenKey(rootFen)) ?? [], rootFen);
    rememberDrill(drillStudy, chapterPick);
    drillRef.current = {
      chapters: scoped,
      posIndex,
      cands,
      study: drillStudy,
      label: wholeStudy ? t('Whole study') : chapter.name,
      trunkPly: trunk.ply,
      trunkFen: trunk.fen,
      families: new Map(),
      missed: new Set(),
      gapNoted: new Set(),
    };
    setTree(gameTree);
    setTipId(gameId);
    setCursorId(gameId);
    if (positionAt(gameTree, gameId).turn === userColor) setPhase('playing');
    else void reply(gameTree, gameId, source, band);
  };

  const goTo = (targetIndex: number): void => {
    const clamped = Math.max(0, Math.min(targetIndex, line.length - 1));
    setCursorId(line[clamped]!);
  };
  const cursorIndex = line.indexOf(cursorId);

  const sourceLabel =
    source === ONLINE_SOURCE
      ? `Lichess · ${RATING_BANDS.find((b) => b.ratings === band)?.label ?? ''}`
      : bookLabel(source);

  const saveLine = async (name: string): Promise<void> => {
    setSaveError(null);
    const pgn = treeToPgn(tree, {
      Event: 'Repertoire practice',
      White: userColor === 'white' ? 'You' : sourceLabel,
      Black: userColor === 'black' ? 'You' : sourceLabel,
    });
    try {
      const res = await fetch('/api/studies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, pgn }),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok) {
        setSaveError(t(body?.error ?? 'could not create study'));
        return;
      }
      setSaveOpen(false);
      navigate('studies', encodeURIComponent(body?.id ?? name));
    } catch {
      setSaveError(t('vault server unreachable'));
    }
  };

  const header = (
    <>
      <h1 className="text-fg text-sm font-semibold">{t('Repertoire')}</h1>
      {/* What sparring is, behind a ? instead of a paragraph the idle
          panel made every visit re-read (lanph3re's call). */}
      <InfoTip label="Repertoire">
        {t(
          'Practise an opening against the field: you move, and the reply is drawn from what real games actually played here.',
        )}{' '}
        {t(
          'Drilling one of your studies holds you to your preparation: a move off the study is named and rolled back, replies come from real games among the lines you cover, and common replies you have no answer to are recorded as gaps. Missed positions come back for review.',
        )}
      </InfoTip>
    </>
  );

  return (
    <div className={BOARD_SCROLL_SHELL}>
      <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          title={t('Back')}
          onClick={() => up('home')}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        {header}
      </div>

      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          {/* wide:h-10 + the column's gap-2 equals the other board pages'
              top strip, so this board's top edge sits level with theirs
              (and with the side column's first panel: h-9 + gap-3). */}
          <PlayerSlot
            side={orientation === 'white' ? 'black' : 'white'}
            fen={node.fen}
            className="wide:h-10 wide:items-end"
          />
          <Board
            apiRef={boardApi}
            fen={node.fen}
            orientation={orientation}
            dests={dests}
            lastMove={moveSquares(node)}
            check={pos.isCheck()}
            onMove={onMove}
          />
          <PlayerSlot side={orientation} fen={node.fen} />
        </div>
      </div>

      {/* stacked:flex-none — the page column is what scrolls on a phone, so
          this one must take the height its content needs. As flex-1 with
          min-h-0 it shrank under that content instead, and the bottom of
          the New game panel was cut off. */}
      {/* Scrolls exactly when it is a side column — `wide`, which is what
          makes it one. Keyed on `lg` before, it did not scroll on a phone
          held sideways (wide starts at 44rem, lg at 64rem) and the New game
          panel lost its bottom there.

          And it must NOT scroll when stacked: the page column is what
          scrolls on a phone, so a second scroll container inside it is at
          best redundant. It is not harmless either — its height comes from
          `min-height: max-content` over a form of Selects, and where a
          browser computes that short, `overflow-y: auto` silently cuts the
          panel off with a scrollbar a touch device never shows. That is the
          Safari clipping. `overflow: visible` cannot clip, whatever the
          height resolves to, so the bug has nowhere left to live. */}
      {/* wide:pb-4 — the column scrolls at wide, and its last panel ended
          flush against the column's own bottom edge; padding inside the
          scroll area gives it somewhere to finish, as stacked:pb-8 does
          for the page column on a phone. */}
      <div className={`flex min-h-0 flex-1 flex-col gap-3 wide:overflow-y-auto wide:scrollbar-hidden wide:pb-4 stacked:min-h-max stacked:flex-none stacked:gap-2 ${BOARD_WIDE_SIDE}`}>
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">{header}</div>

        {/* fit: a short form under a tall board. Left to shrink, the panel
            cut its own Start button off with nothing to scroll to. */}
        {phase === 'idle' ? (
          <>
          <Panel flush fit className="shrink-0">
            <PanelHeader title={t('New game')} />
            <div className="flex flex-col gap-3 p-3">
              {/* Free play plays anything; drill holds you to a study. The
                  two toggles share one shape — segmented, not actions.

                  Both carry a label, in the same style as the Selects
                  below, so the panel is one rhythm of labelled fields.
                  Unlabelled they were four buttons of one size stacked
                  two by two, and nothing said which pair chose what
                  (lanph3re's call). The kings are the second half of the
                  same fix: whatever the eye lands on first, the side pair
                  can no longer be mistaken for the mode pair. */}
              <div className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">{t('Mode')}</span>
                <div className="flex gap-1">
                  {(['spar', 'drill'] as const).map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      variant={mode === m ? 'primary' : 'secondary'}
                      className="h-7 flex-1 pointer-coarse:h-8"
                      onClick={() => setMode(m)}
                    >
                      {m === 'spar' ? t('Free play') : t('Drill a study')}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">{t('Play as')}</span>
                <div className="flex gap-1">
                  {(['white', 'black'] as const).map((c) => (
                    <Button
                      key={c}
                      size="sm"
                      variant={userColor === c ? 'primary' : 'secondary'}
                      // Shorter than a normal sm button, coarse pointers
                      // included: these two are a segmented control, not
                      // actions, and at full touch height they were the
                      // tallest thing in a panel of one-line fields.
                      className="h-7 flex-1 pointer-coarse:h-8"
                      onClick={() => setUserColor(c)}
                    >
                      <KingIcon side={c} />
                      {c === 'white' ? t('White') : t('Black')}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">{t('Source')}</span>
                <Select
                  value={source}
                  onChange={setSource}
                  ariaLabel={t('Where replies come from')}
                  steady
                  groups={[
                    // The demo hides the online source rather than offering
                    // it broken — no token can ship in a static bundle.
                    ...(isDemo()
                      ? []
                      : [
                          {
                            label: 'Online (via proxy)',
                            options: [{ value: ONLINE_SOURCE, label: 'Lichess database' }],
                          },
                        ]),
                    ...(databases.length > 0
                      ? [
                          {
                            label: 'Reference databases',
                            options: databases.map((b) => ({ value: b.name, label: b.label ?? bookLabel(b.name) })),
                          },
                        ]
                      : []),
                  ]}
                />
              </label>
              {/* A rating band is the online database's own dimension. A book
                  has none: its population was fixed when it was built, so the
                  choice of book IS the choice of field. */}
              {source === ONLINE_SOURCE && (
                <label className="flex flex-col gap-1">
                  <span className="text-muted text-xs font-medium">{t('Rating')}</span>
                  <Select
                    value={band}
                    onChange={setBand}
                    ariaLabel={t('Opponent strength')}
                    steady
                    groups={[{ options: RATING_BANDS.map((b) => ({ value: b.ratings, label: b.label })) }]}
                  />
                </label>
              )}
              {mode === 'drill' && mapDrill ? (
                // Sent over by the opening map: the whole repertoire as one
                // scope. Letting it go returns the ordinary study picker.
                <div className="border-line flex flex-col gap-1 rounded-lg border p-2">
                  <span className="text-muted text-xs font-medium">{t('From the opening map')}</span>
                  <p className="text-fg text-xs">{mapDrill.label}</p>
                  <p className="text-subtle text-xs">
                    {t('{n} chapters across the tagged studies', { n: mapDrill.entries.length })}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => setMapDrill(null)}
                  >
                    {t('Drill a study instead')}
                  </Button>
                </div>
              ) : mode === 'drill' ? (
                studyList !== null && studyList.length === 0 ? (
                  <p className="text-muted text-xs leading-relaxed">
                    {t('No studies yet — create one in Studies, or save a line you played first.')}
                  </p>
                ) : (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-muted text-xs font-medium">{t('Study')}</span>
                      <Select
                        value={drillStudy}
                        onChange={setDrillStudy}
                        ariaLabel={t('Study to drill')}
                        steady
                        groups={[
                          { options: (studyList ?? []).map((id) => ({ value: id, label: id })) },
                        ]}
                      />
                    </label>
                    {drillChapters && drillChapters.length > 1 && (
                      <label className="flex flex-col gap-1">
                        <span className="text-muted text-xs font-medium">{t('Chapter')}</span>
                        <Select
                          value={chapterPick}
                          onChange={setChapterPick}
                          ariaLabel={t('Chapter to drill')}
                          steady
                          groups={[
                            // The whole study as one repertoire — every
                            // chapter's lines count, transpositions
                            // included — or one chapter alone.
                            { options: [{ value: 'all', label: t('Whole study') }] },
                            // Under a heading and numbered, because a
                            // chapter's name is the user's to choose: one
                            // actually called "Whole study" was the same row
                            // twice, on the closed trigger as much as in the
                            // list, and nothing said which was which. The
                            // numbers are the ones the study's own chapter
                            // list shows.
                            {
                              label: t('Chapters'),
                              options: drillChapters.map((c, i) => ({
                                value: String(i),
                                label: `${i + 1}. ${c.name}`,
                              })),
                            },
                          ]}
                        />
                      </label>
                    )}
                  </>
                )
              ) : (
                <label className="flex flex-col gap-1">
                  <span className="text-muted text-xs font-medium">{t('Opening')}</span>
                  <OpeningPicker value={template} onChange={setTemplate} />
                </label>
              )}
              {/* A disabled Start with no word is a riddle; the reason
                  is one line. */}
              {mode === 'drill' && drillChapter && !drillReady && (
                <p className="text-subtle text-xs leading-relaxed">
                  {wholeStudy
                    ? t('This study has no moves yet — nothing to drill.')
                    : t('This chapter has no moves yet — nothing to drill.')}
                </p>
              )}
              {/* What the record holds against this chapter, a way to work
                  it off — and the one way to forget it, behind a confirm.
                  Shown whenever anything was ever drilled, so a clean
                  record can still be wiped. */}
              {mode === 'drill' && summary && summary.attempted > 0 && (
                <div className="flex items-center gap-2">
                  <p className="text-subtle min-w-0 flex-1 text-xs leading-relaxed">
                    {summary.review.length > 0 &&
                      t('{n} positions to review', { n: summary.review.length })}
                    {summary.review.length > 0 && summary.gaps > 0 && ' · '}
                    {summary.gaps > 0 && t('{n} replies with no answer yet', { n: summary.gaps })}
                    {summary.review.length === 0 &&
                      summary.gaps === 0 &&
                      t('Every drilled position stands recalled.')}
                  </p>
                  <ConfirmSheet
                    icon={Eraser}
                    triggerTitle="Forget the drill record — misses, gaps and recalls in every study"
                    question="Forget the whole drill record, across all studies?"
                    confirmLabel={t('Forget everything')}
                    onConfirm={() => {
                      void fetch('/api/repertoire/reset', { method: 'POST' })
                        .then(() => setSummary({ attempted: 0, review: [], gaps: 0 }))
                        .catch(() => {});
                    }}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={mode === 'drill' && !drillReady}
                  onClick={startGame}
                >
                  <Play className="size-3.5" />
                  {t('Start')}
                </Button>
                {mode === 'drill' && (summary?.review.length ?? 0) > 0 && (
                  <Button variant="secondary" size="sm" disabled={!drillReady} onClick={startFromMiss}>
                    {t('Drill a missed position')}
                  </Button>
                )}
              </div>
            </div>
          </Panel>
          </>
        ) : (
          <>
            {/* Game panel in the trainers' shape: status and the game's own
                actions live here; the moves panel below is the same one every
                other board page uses. */}
            <Panel flush className="shrink-0">
              <PanelHeader
                title={t('Game')}
                actions={
                  <Button variant="ghost" size="sm" onClick={newGame} title={t('Set up a new game')}>
                    <RotateCcw className="size-3.5" />
                    {t('New game')}
                  </Button>
                }
              />
              <div className="flex flex-col gap-3 p-3">
                <p
                  className={cn(
                    'text-xs leading-relaxed',
                    (phase === 'ended' && endKind === 'gap') || (drillNotice && phase === 'playing')
                      ? 'text-warn'
                      : 'text-muted',
                  )}
                >
                  {phase === 'ended'
                    ? endKind === 'gap'
                      ? gapMsg
                      : endKind === 'line'
                        ? t('End of your prepared line — every move matched the study.')
                        : t('This line has run past the database — you are on your own now.')
                    : error
                      ? error
                      : drillNotice
                        ? drillNotice
                        : phase === 'thinking'
                          ? 'Your opponent is replying…'
                          : pos.turn === userColor && atTip
                            ? 'Your move.'
                            : 'Reviewing an earlier move — step to the end to keep playing.'}
                </p>
                {gapNote && phase !== 'ended' && (
                  <p className="text-subtle text-xs leading-relaxed">{gapNote}</p>
                )}
                {/* The dependency arrow, pointed back: Settings knows it
                    powers this, but this error never said Settings was
                    the fix. A tokenless user read "could not reach" as
                    the app being broken. */}
                {error && source === ONLINE_SOURCE && (
                  <p className="text-muted text-xs leading-relaxed">
                    {t('The online database goes through your Lichess token.')}{' '}
                    <a href="#/settings" className="text-primary hover:underline">
                      {t('Add one in Settings')}
                    </a>
                  </p>
                )}
                {phase === 'ended' && (
                  <FinalAssessment
                    fen={getNode(tree, tipId).fen}
                    onAnalyse={() => {
                      // The tree itself, not a PGN round-trip: this is the
                      // line as played, and the board should open on the
                      // move it ended on, facing the way it was trained.
                      useAnalysis.setState({
                        tree,
                        cursorId: tipId,
                        orientation: userColor,
                        gameHeaders: null,
                        handoff: true,
                      });
                      navigate('board');
                    }}
                  >
                    {/* A drill has nowhere to save TO: the line came out of a
                        study, and filing it back would write the same moves
                        into a second one. What is worth offering there is the
                        way back — to the study just rehearsed, where the gaps
                        and misses this session recorded are fixed. Sparring
                        keeps the save: that line exists nowhere else and used
                        to evaporate the moment you left. */}
                    {mode === 'drill' ? (
                      drillStudy && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navigate('studies', encodeURIComponent(drillStudy))}
                        >
                          <BookOpen className="size-3.5" />
                          {t('Go to study')}
                        </Button>
                      )
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSaveError(null);
                          setSaveOpen(true);
                        }}
                      >
                        <BookmarkPlus className="size-3.5" />
                        {t('Save line to study')}
                      </Button>
                    )}
                  </FinalAssessment>
                )}
              </div>
            </Panel>
            <AnswerPanel
              tree={tree}
              cursorId={cursorId}
              onSelect={setCursorId}
              emptyText="Make your first move on the board."
            />
          </>
        )}
      </div>

      {phase !== 'idle' && (
        <MobileActionBar>
          <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
            <Button variant="ghost" size="icon" disabled={cursorIndex <= 0} onClick={() => goTo(0)} title={t('First move')}>
              <ChevronFirst className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={cursorIndex <= 0} onClick={() => goTo(cursorIndex - 1)} title={t('Back')}>
              <ChevronLeft className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={atTip} onClick={() => goTo(cursorIndex + 1)} title={t('Forward')}>
              <ChevronRight className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={atTip} onClick={() => goTo(line.length - 1)} title={t('Latest')}>
              <ChevronLast className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setFlipped((f) => !f)} title={t('Flip board')}>
              <FlipVertical2 className="size-[1.1rem]" />
            </Button>
          </div>
        </MobileActionBar>
      )}

      {saveOpen && (
        <PromptSheet
          label={t('Save line to study')}
          initial={`${t(template.name)} — ${new Date().toISOString().slice(0, 10)}`}
          submitLabel="Save"
          error={saveError}
          closeOnSubmit={false}
          onSubmit={(name) => void saveLine(name)}
          onClose={() => setSaveOpen(false)}
        />
      )}
    </div>
  );
}
