import { parseSquare } from 'chessops/util';
import {
  BookmarkPlus,
  BookOpen,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eraser,
  FlipVertical2,
  Info,
  ListOrdered,
  Network,
  Play,
  RotateCcw,
  Settings2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addSan, addUci, createTree, getNode, legalDests, mainlineFrom, moveSquares, pathTo, positionAt } from '@shared/tree';
import { pgnToChapters, treeToPgn } from '@shared/pgn';
import type { Chapter, MoveTree, NodeId } from '@shared/types';
import { Board, type BoardApi } from '@/board/Board';
import { advanceCands, buildPosIndex, expectedSans, GAP_NOTE_SHARE, openingFamily, replayLine, studyChild, trunkOf, type DrillCand } from './drill';
import { fenKey } from '@/lib/fen';
import { consumeMapDrill, type MapDrillTarget } from './mapDrill';
import { DEFAULT_BAND, fieldDatabases, ONLINE_SOURCE, RATING_BANDS, type FieldDatabase, type FieldMove } from './field';
import { OpeningPicker, TEMPLATES, type OpeningTemplate } from './OpeningPicker';
import { FinalAssessment } from './FinalAssessment';
import type { Dests, Key } from '@lichess-org/chessground/types';
import { BOARD_MAX_W } from '@/board/boardSize';
import { EvalBarSlot } from '@/engine/EvalBar';
import { publishBoardHeight } from '@/board/boardBlock';
import { AnswerPanel } from '@/puzzles/AnswerPanel';
import { playSound } from '@/board/sound';
import { useAnalysis } from '@/store/analysis';
import { navigate, up } from '@/lib/router';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { bookLabel } from '@/store/explorer';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { rememberDrill, rememberedDrill } from '@/lib/training';
import { PromptSheet } from '@/ui/PromptSheet';
import { ConfirmSheet } from '@/ui/ConfirmSheet';
import { Field } from '@/ui/Field';
import { InfoTip } from '@/ui/InfoTip';
import { KingIcon } from '@/ui/KingIcon';
import { Segmented } from '@/ui/Segmented';
import { SideDot } from '@/ui/SideDot';
import { Modal } from '@/ui/Modal';
import { Panel, PanelHeader } from '@/ui/Panel';
import { AnalysisBoard } from '@/board/AnalysisBoard';
import { AnalysisMovesPanel } from '@/analysis/AnalysisMovesPanel';
import { EngineBlock } from '@/engine/EnginePane';
import { PaneTabs } from '@/ui/PaneTabs';
import { useWideLayout } from '@/lib/media';
import { useEngine } from '@/store/engine';
import { BOARD_SCROLL_SHELL, BOARD_WIDE_COLUMN, BOARD_WIDE_SIDE } from '@/ui/layout';
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

/** A steady minimum "thinking" time for the field's reply: the DB fetch
    is instant when the position is cached and slow when it isn't, which
    felt jarringly random. Waiting out the rest of this makes the reply
    land at a consistent, deliberate pace. */
const MIN_THINK_MS = 550;

/** How long a refused drill move stands on the board before it snaps
    back — the same rhythm as the puzzle trainer's wrong-move rollback. */
const ROLLBACK_MS = 650;

/** Which click a move earns; the 'x' in a SAN is how a capture is spelt. */
const soundFor = (san: string | null | undefined): 'capture' | 'move' =>
  san?.includes('x') ? 'capture' : 'move';

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
function PlayerSlot({ side, fen }: { side: 'white' | 'black'; fen: string }) {
  const toMove = (fen.split(' ')[1] === 'b' ? 'black' : 'white') === side;
  return (
    // Shown at every width, like the Board tab's. These were hidden on
    // phones while the New game panel was being cut off, on the theory that
    // two more rows around the board were what pushed it over. They were
    // not: the panel's own column was a nested scroll container that
    // clipped what its min-height under-measured. With that fixed the rows
    // cost nothing but the height they occupy, and the page scrolls.
    //
    // A plain h-6 row, ALWAYS — the wide layout's taller top strip is a box
    // around this one (see the board column below), never this box grown.
    // Stretched to h-10 itself, `items-end` bottom-aligned the dot and the
    // name rather than the row holding them, and they sat 7px lower than
    // the Board tab's (measured, 958px wide: centre 13px above the board's
    // top edge against 20px).
    <div className="flex h-6 w-full items-center gap-2 px-0.5">
      <SideDot side={side} />
      <span className={cn('min-w-0 flex-1 truncate text-base', toMove ? 'text-fg font-medium' : 'text-subtle')}>
        {side === 'white' ? t('White') : t('Black')}
      </span>
    </div>
  );
}

/** The live drill: the chapters in scope, their position index, and the
    current candidate nodes — mutated in place as moves match. */
interface DrillScope {
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
}

/** A fresh drill scope. Three start paths build one, differing only in
    what they drill; the session's own bookkeeping — families asked,
    misses, gaps noted — always starts empty. */
function makeDrillScope(scope: {
  chapters: Chapter[];
  posIndex: Map<string, DrillCand[]>;
  cands: DrillCand[];
  study: string;
  studies?: string[];
  label: string;
  trunk: { ply: number; fen: string };
}): DrillScope {
  const { trunk, ...rest } = scope;
  return {
    ...rest,
    trunkPly: trunk.ply,
    trunkFen: trunk.fen,
    families: new Map(),
    missed: new Set(),
    gapNoted: new Set(),
  };
}

export function RepertoireView() {
  // A drill the opening map sent over, consumed once on mount. While it is
  // set, drill mode holds the map's whole repertoire instead of one study.
  const [mapDrill, setMapDrill] = useState<MapDrillTarget | null>(() => consumeMapDrill());
  const [userColor, setUserColor] = useState<'white' | 'black'>(mapDrill?.color ?? 'white');
  const [band, setBand] = useState(DEFAULT_BAND.ratings);
  const [template, setTemplate] = useState<OpeningTemplate>(TEMPLATES[0]!);
  // '' = undecided, resolved when the database list arrives. The demo cannot
  // offer the online source (no token can ship in a static bundle), so it
  // starts undecided and settles on the first database.
  const [source, setSource] = useState<string>(isDemo() ? '' : ONLINE_SOURCE);
  const [databases, setDatabases] = useState<FieldDatabase[]>([]);

  // Which reference databases exist, for the source picker.
  useEffect(() => {
    void api<{ ready?: boolean; games?: number; databases?: FieldDatabase[] }>('/api/refgames')
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

  /**
   * Whether this vault has a Lichess token, which the online source needs.
   *
   * Asked before anything starts, because the alternative is what used to
   * happen: pick the Lichess database, press Start, watch the board set
   * itself up, and only then be told that the field cannot be consulted
   * without a token. The check is one field of the settings this page
   * could always have asked for.
   *
   * Undefined until the answer is in — the difference between "no token"
   * and "nobody has said yet" is the difference between a reason and a
   * false accusation, and Start stays available while it is unknown.
   */
  const [hasToken, setHasToken] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (isDemo()) return;
    void api<{ lichess?: { configured?: boolean } }>('/api/settings')
      .then((body) => setHasToken(body?.lichess?.configured === true))
      // Unreachable settings are not a missing token; leave it unknown and
      // let the run report whatever actually goes wrong.
      .catch(() => setHasToken(undefined));
  }, []);
  const needsToken = source === ONLINE_SOURCE && hasToken === false;

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
  /** The live drill — render state never reads it, so a ref is honest. */
  const drillRef = useRef<DrillScope | null>(null);
  const wholeStudy = chapterPick === 'all';
  const chapterIdx = wholeStudy ? 0 : Number(chapterPick) || 0;

  // The studies list, first needed when drilling is chosen. `mapDrill` is
  // a real dependency: letting a map-wide drill go ("Drill a study
  // instead") changes nothing else this effect reads, and without it the
  // study picker stayed empty. The guards make the re-run idempotent.
  useEffect(() => {
    if (mode !== 'drill' || mapDrill !== null || studyList !== null) return;
    void api<{ studies?: { id: string }[] }>('/api/studies')
      .then((body) => {
        const ids = (body.studies ?? []).map((st) => st.id);
        setStudyList(ids);
        const remembered = rememberedDrill();
        setDrillStudy(
          (d) => d || (remembered && ids.includes(remembered.study) ? remembered.study : (ids[0] ?? '')),
        );
      })
      .catch(() => setStudyList([]));
  }, [mode, mapDrill, studyList]);

  // The chosen study's chapters, through the same codec the editor uses.
  // `mapDrill` for the same reason as above: it gates the fetch, so it is
  // a dependency, and the guards keep the re-run idempotent.
  useEffect(() => {
    if (mode !== 'drill' || mapDrill !== null || !drillStudy) return;
    let cancelled = false;
    setDrillChapters(null);
    setChapterPick('0');
    void api<{ pgn?: string } | null>(`/api/studies/${encodeURIComponent(drillStudy)}`)
      .then((body) => {
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
  }, [mode, mapDrill, drillStudy]);

  // What the record says about this chapter. Re-asked when a session ends
  // (phase is a dependency) so the idle panel's counts are never stale.
  useEffect(() => {
    const chapter = drillChapters?.[chapterIdx];
    if (mode !== 'drill' || !drillStudy || !chapter || phase !== 'idle') {
      return;
    }
    let cancelled = false;
    const scope = wholeStudy ? '' : `&chapter=${encodeURIComponent(chapter.name)}`;
    void api<{ attempted?: number; review?: ReviewEntry[]; gaps?: unknown[] } | null>(
      `/api/repertoire/summary?study=${encodeURIComponent(drillStudy)}${scope}`,
    )
      .then((body) => {
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
      const body = await api<{ opening?: { name?: string } | null } | null>(
        `/api/opening?fen=${encodeURIComponent(fen)}`,
      );
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
    void api('/api/repertoire/attempt', {
      method: 'POST',
      json: { study, chapter, ...entry },
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
  /**
   * Whether the phone is showing the setup sheet.
   *
   * A desktop never sets this: the same fields are a panel in its side
   * column, and the button that would open the sheet is on the Game
   * panel, which a desktop only shows once a game is on.
   */
  const [setupOpen, setSetupOpen] = useState(false);
  /**
   * The choices as they stood when that sheet opened — what Cancel puts
   * back.
   *
   * Kept as a SNAPSHOT rather than as a draft the fields write into,
   * which is what the archive's filter window does with the same two
   * buttons. The fields here are not inert: choosing an opening
   * previews it on the board behind the sheet, choosing a study fetches
   * its chapters and its drill record. A draft would have to reproduce
   * all of that against a shadow copy of the state, or give the preview
   * up; restoring on the way out costs one object and keeps both.
   *
   * A ref, because no render reads it. Dismissing the sheet any other
   * way — the scrim, Escape, Back, the swipe — is Cancel too: a window
   * carrying a Cancel button has already said what leaving means.
   */
  const staged = useRef<{
    mode: Mode;
    userColor: 'white' | 'black';
    source: string;
    band: string;
    template: OpeningTemplate;
    drillStudy: string;
    chapterPick: string;
    mapDrill: MapDrillTarget | null;
  } | null>(null);
  const openSetup = (): void => {
    staged.current = { mode, userColor, source, band, template, drillStudy, chapterPick, mapDrill };
    setSetupOpen(true);
  };
  const cancelSetup = (): void => {
    const was = staged.current;
    staged.current = null;
    setSetupOpen(false);
    if (!was) return;
    setMode(was.mode);
    setUserColor(was.userColor);
    setSource(was.source);
    setBand(was.band);
    setTemplate(was.template);
    setDrillStudy(was.drillStudy);
    setChapterPick(was.chapterPick);
    setMapDrill(was.mapDrill);
  };
  const applySetup = (): void => {
    staged.current = null;
    setSetupOpen(false);
  };

  // Seed a tree with the template's line — used both for the idle preview
  // (picking an opening shows its position at once) and for starting a game.
  const seedTree = (tpl: OpeningTemplate): { tree: MoveTree; tip: NodeId } => {
    const fresh = createTree();
    return replayLine(fresh, fresh.rootId, tpl.sans);
  };

  // Idle previews the chosen opening immediately, last move highlighted —
  // or, in drill mode, the chosen chapter's starting position.
  useEffect(() => {
    if (phase !== 'idle') return;
    if (mode === 'drill') {
      if (mapDrill) {
        // Preview the node the map-wide drill will start from.
        const start = createTree();
        const { tree: preview, tip } = replayLine(start, start.rootId, mapDrill.path);
        setTree(preview);
        setTipId(tip);
        setCursorId(tip);
        return;
      }
      const chapter = drillChapters?.[chapterIdx];
      const fresh = chapter ? createTree(getNode(chapter.tree, chapter.tree.rootId).fen) : createTree();
      setTree(fresh);
      setTipId(fresh.rootId);
      setCursorId(fresh.rootId);
      return;
    }
    const { tree: seeded, tip } = seedTree(template);
    setTree(seeded);
    setTipId(tip);
    setCursorId(tip);
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
      const started = Date.now();
      // Both sources answer in the same shape — the server normalises the
      // Lichess payload to the book contract — so only the URL differs.
      const online = src === ONLINE_SOURCE;
      const fallback = online
        ? 'Could not reach the Lichess database.'
        : 'Could not read the reference database.';
      try {
        const fen = getNode(curTree, curId).fen;
        const body = await api<{ moves?: ExplorerMove[] } | null>(
          online
            ? `/api/explorer/lichess?fen=${encodeURIComponent(fen)}&ratings=${ratings}`
            : `/api/refgames/explore?db=${encodeURIComponent(src)}&fen=${encodeURIComponent(fen)}`,
        );
        if (token !== runId.current) return;
        if (!body?.moves) {
          setError(t(fallback));
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
        const wait = MIN_THINK_MS - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (token !== runId.current) return;
        const added = addUci(curTree, curId, choice.uci);
        if (!added || token !== runId.current) {
          if (!added) setPhase('ended');
          return;
        }
        playSound(soundFor(getNode(added.tree, added.nodeId).san));
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
      } catch (err) {
        // The server's own words when it sent any (api() carried them out
        // of the error envelope); the source's fallback for a network
        // failure or anything else.
        if (token === runId.current) {
          setError(err instanceof ApiError && err.status > 0 ? err.message : t(fallback));
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
        // played it on screen. Let it stand for a beat, then snap the
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
        }, ROLLBACK_MS);
        return;
      }
      if (!d.missed.has(key)) {
        recordDrill({ key, result: 'hit', path: sansTo(tree, cursorId), expected, played: san });
      }
      setDrillNotice(null);
      d.cands = next;
      playSound(soundFor(san));
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
    playSound(soundFor(getNode(added.tree, added.nodeId).san));
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
      const start = createTree();
      const { tree: fresh, tip } = replayLine(start, start.rootId, mapDrill.path);
      const startFen = getNode(fresh, tip).fen;
      const cands = posIndex.get(fenKey(startFen)) ?? [];
      if (cands.length === 0) return;
      const rootFen = getNode(fresh, fresh.rootId).fen;
      const trunk = trunkOf(scoped, posIndex, posIndex.get(fenKey(rootFen)) ?? [], rootFen);
      drillRef.current = makeDrillScope({
        chapters: scoped,
        posIndex,
        cands,
        study: mapDrill.entries[0]!.study,
        studies: mapDrill.entries.map((e) => e.study),
        label: mapDrill.label,
        trunk,
      });
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
      drillRef.current = makeDrillScope({
        chapters: scoped,
        posIndex,
        cands,
        study: drillStudy,
        label: wholeStudy ? t('Whole study') : startChapter.name,
        trunk,
      });
      const fresh = createTree(rootFen);
      setTree(fresh);
      setTipId(fresh.rootId);
      setCursorId(fresh.rootId);
      if (positionAt(fresh, fresh.rootId).turn === userColor) setPhase('playing');
      else void reply(fresh, fresh.rootId, source, band);
      return;
    }
    drillRef.current = null;
    const { tree: seeded, tip } = seedTree(template);
    setTree(seeded);
    setTipId(tip);
    const last = getNode(seeded, tip);
    if (positionAt(seeded, tip).turn === userColor) {
      // The line ends on the OPPONENT'S move and no reply will follow, so
      // nothing would ever animate (the idle preview already sits on the
      // final position). Start one move back and play it in a beat later —
      // the opponent visibly makes the move you are answering.
      if (last.parentId) {
        setCursorId(last.parentId);
        setTimeout(() => {
          if (runId.current !== token) return;
          setCursorId(tip);
          playSound(soundFor(last.san));
        }, 400);
      } else {
        setCursorId(tip);
      }
      setPhase('playing');
    } else {
      // The bot moves first; its reply animates on its own.
      setCursorId(tip);
      void reply(seeded, tip, source, band);
    }
  };

  /**
   * Analysing in place, the way both trainers do it: the page stays, the
   * board becomes the analysis board and the panel above the moves becomes
   * the engine. Navigating to Board took the drill away with it — the line
   * just rehearsed, the study it came from and the way to play another
   * were all behind the browser's back button.
   *
   * The engine is switched ON by the act of asking to analyse, and off
   * again on the way out, including by unmount.
   */
  const wide = useWideLayout();
  const [analysing, setAnalysing] = useState(false);
  /** Which pane the phone shows. A desktop shows all of them. */
  const [pane, setPane] = useState<'info' | 'moves' | 'engine'>('info');
  /**
   * And which one it can actually show. The engine pane exists only once
   * the answer is in, so a phone left on it when the next one starts falls
   * back rather than facing an empty column — the effect above resets the
   * choice, and this is what makes the render between the two harmless.
   */
  const shownPane = !analysing && pane === 'engine' ? 'info' : pane;
  const analysingRef = useRef(false);
  analysingRef.current = analysing;
  useEffect(
    () => () => {
      if (analysingRef.current) useEngine.getState().setEnabled(false);
    },
    [],
  );

  /**
   * A finished line analyses itself, on both layouts, so there is no
   * Analyse button left to press. Starting another game undoes it, engine
   * included — an evaluation still up while the next line is played is
   * that line's answer.
   */
  useEffect(() => {
    if (phase === 'ended' && !analysing) {
      useAnalysis.setState({
        tree,
        cursorId: tipId,
        orientation: userColor,
        pendingPromotion: null,
        loadError: null,
        gameHeaders: null,
      });
      useEngine.getState().setEnabled(true);
      setAnalysing(true);
      // The phone STAYS on the Game pane: that is where the line's own
      // ending is written, with the score, Save line to study and New
      // game on it, and switching to the engine put the reader in front
      // of a search instead (lanph3re). The engine tab is one tap away.
    }
    if (phase !== 'ended' && analysing) {
      setAnalysing(false);
      setPane('info');
      useEngine.getState().setEnabled(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, analysing]);

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
    drillRef.current = makeDrillScope({
      chapters: scoped,
      posIndex,
      cands,
      study: drillStudy,
      label: wholeStudy ? t('Whole study') : chapter.name,
      trunk,
    });
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
      const body = await api<{ id?: string } | null>('/api/studies', {
        method: 'POST',
        json: { name, pgn },
      });
      setSaveOpen(false);
      navigate('studies', encodeURIComponent(body?.id ?? name));
    } catch (err) {
      // api() carries the server's own words; a network failure answers
      // "vault server unreachable", as this always did.
      setSaveError(apiErrorMessage(err));
    }
  };

  const header = (
    <>
      <h1 className="text-fg text-base font-semibold">{t('Repertoire')}</h1>
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



  /**
   * The fields that choose the next game.
   *
   * A desktop stands them in its side column, where a form has room to
   * simply be there. A phone opens them as a sheet instead: under a
   * board, five Selects and two Segmenteds are most of a screen, and
   * what a phone wants on arrival is the board, what would be played,
   * and the button that plays it — not the form that was already
   * answered last time.
   */
  const setupFields = (
    <>
      {/* Free play plays anything; drill holds you to a study. The
          two toggles share one shape — Segmented, the control that
          says one-of-these in its track, not pairs of actions.

          Both carry a label, in the same style as the Selects
          below, so the panel is one rhythm of labelled fields.
          Unlabelled they were four buttons of one size stacked
          two by two, and nothing said which pair chose what
          (lanph3re's call). The kings are the second half of the
          same fix: whatever the eye lands on first, the side pair
          can no longer be mistaken for the mode pair. */}
      <Field label="Mode">
        <Segmented
          value={mode}
          onChange={setMode}
          ariaLabel="Mode"
          // even, because these two sit one above the other: sized by their
          // labels, "Free play | Drill a study" broke at a different point
          // from "White | Black" and the pair read as two controls rather
          // than one pair of questions.
          even
          segments={[
            { value: 'spar', label: t('Free play') },
            { value: 'drill', label: t('Drill a study') },
          ]}
        />
      </Field>
      <Field label="Play as">
        <Segmented
          value={userColor}
          onChange={setUserColor}
          ariaLabel="Play as"
          even
          segments={(['white', 'black'] as const).map((c) => ({
            value: c,
            label: (
              <>
                <KingIcon side={c} />
                {c === 'white' ? t('White') : t('Black')}
              </>
            ),
          }))}
        />
      </Field>
      <Field label="Source">
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
      </Field>
      {/* A rating band is the online database's own dimension. A book
          has none: its population was fixed when it was built, so the
          choice of book IS the choice of field. */}
      {source === ONLINE_SOURCE && (
        <Field label="Rating">
          <Select
            value={band}
            onChange={setBand}
            ariaLabel={t('Opponent strength')}
            steady
            groups={[{ options: RATING_BANDS.map((b) => ({ value: b.ratings, label: b.label })) }]}
          />
        </Field>
      )}
      {mode === 'drill' && mapDrill ? (
        // Sent over by the opening map: the whole repertoire as one
        // scope. Letting it go returns the ordinary study picker.
        <div className="border-line flex flex-col gap-1 rounded-lg border p-2">
          <span className="text-muted text-sm font-medium">{t('From the opening map')}</span>
          <p className="text-fg text-sm">{mapDrill.label}</p>
          <p className="text-subtle text-sm">
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
          <p className="text-muted text-sm leading-relaxed">
            {t('No studies yet — create one in Studies, or save a line you played first.')}
          </p>
        ) : (
          <>
            <Field label="Study">
              <Select
                value={drillStudy}
                onChange={setDrillStudy}
                ariaLabel={t('Study to drill')}
                steady
                groups={[
                  { options: (studyList ?? []).map((id) => ({ value: id, label: id })) },
                ]}
              />
            </Field>
            {drillChapters && drillChapters.length > 1 && (
              <Field label="Chapter">
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
              </Field>
            )}
          </>
        )
      ) : (
        <Field label="Opening">
          <OpeningPicker value={template} onChange={setTemplate} />
        </Field>
      )}
    </>
  );

  /**
   * Why Start might be refused, what the drill record holds, and the two
   * ways to begin.
   *
   * One block, because a disabled Start whose reason is on another
   * screen is the riddle the reason was written to answer. It follows
   * the fields in the desktop's panel and sits on the Game panel on a
   * phone, where the fields are behind the sheet.
   */
  const startBlock = (
    <>
      {/* A disabled Start with no word is a riddle; the reason
          is one line. */}
      {needsToken && (
        <p className="text-subtle text-sm leading-relaxed">
          {t(
            'The Lichess database needs an API token. Add one in Settings, or pick a reference database instead.',
          )}
        </p>
      )}
      {mode === 'drill' && drillChapter && !drillReady && (
        <p className="text-subtle text-sm leading-relaxed">
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
          <p className="text-subtle min-w-0 flex-1 text-sm leading-relaxed">
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
              void api('/api/repertoire/reset', { method: 'POST' })
                .then(() => setSummary({ attempted: 0, review: [], gaps: 0 }))
                .catch(() => {});
            }}
          />
        </div>
      )}
      {/* The starts, as a column of full-width buttons on BOTH layouts.
          Each is as wide as whatever holds it — the settings row's width
          on a phone, the side column's on a desktop.

          Not the row every dialog in this app ends on (justify-end,
          gap-2, the primary one LAST — ui/PromptSheet), which is what
          this was. A dialog's row is read along a line and finishes on
          the action; a panel that exists to be started is read top down,
          and the thing to press should be the first thing under what it
          would play rather than the last thing after an alternative to
          it. So Start leads, and the drill's second start — the same
          verb aimed at a position the record says was fumbled — sits
          under it as the alternative it is. */}
      <div className="flex flex-col gap-2">
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          disabled={needsToken || (mode === 'drill' && !drillReady)}
          onClick={startGame}
        >
          <Play className="size-3.5" />
          {t('Start')}
        </Button>
        {mode === 'drill' && (summary?.review.length ?? 0) > 0 && (
          <Button variant="secondary" size="sm" className="w-full" disabled={!drillReady} onClick={startFromMiss}>
            {t('Drill a missed position')}
          </Button>
        )}
      </div>
    </>
  );

  /**
   * What Start would begin: the opening or study to be played, and the
   * terms it is played on.
   *
   * The Game panel says it because on a phone the fields that chose it
   * are behind a sheet — a panel offering nothing but Start has to say
   * what it starts. The opening's ECO and its name, the way the picker's
   * own trigger spells them.
   */
  const setupLine =
    mode === 'drill'
      ? mapDrill
        ? mapDrill.label
        : !drillStudy
          ? t('No study chosen yet.')
          : wholeStudy
            ? `${drillStudy} — ${t('Whole study')}`
            : `${drillStudy}${drillChapter ? ` — ${drillChapter.name}` : ''}`
      : template.eco
        ? `${template.eco}  ${template.name}`
        : t(template.name);
  const setupTerms = [
    mode === 'drill' ? t('Drill a study') : t('Free play'),
    t('Playing as {side}', { side: userColor === 'white' ? t('White') : t('Black') }),
    sourceLabel,
  ].join(' · ');

  /**
   * The settings as the way INTO the settings, which is the puzzle
   * trainer's theme row exactly: the chosen value IS the control, so
   * nothing is labelled twice and the header keeps no button for it.
   *
   * Under Start, not over it. Both are things to press and only one of
   * them is what the page is for — with the row first, the eye met the
   * smaller question on the way to the bigger one on every visit. Not
   * truncated: the source and the band are the half that would be cut,
   * and the half that changes.
   */
  const setupRow = (
    <button
      type="button"
      onClick={openSetup}
      title={t('Set up a new game')}
      className={cn(
        'bg-surface-2 hover:bg-surface-3 group flex w-full items-center gap-2 rounded-md',
        'border-line border px-3 py-2.5 text-left transition-colors duration-100',
      )}
    >
      <Settings2 className="text-subtle group-hover:text-primary size-3.5 shrink-0 transition-colors" />
      <span className="text-fg min-w-0 flex-1 text-sm">{setupTerms}</span>
      <ChevronRight className="text-subtle size-3.5 shrink-0" />
    </button>
  );

  /**
   * What a finished line offers besides starting another.
   *
   * A drill has nowhere to save TO: the line came out of a study, and
   * filing it back would write the same moves into a second one. What is
   * worth offering there is the way back — to the study just rehearsed,
   * where the gaps and misses this session recorded are fixed. Sparring
   * keeps the save: that line exists nowhere else and used to evaporate
   * the moment you left.
   */
  const endAction =
    mode === 'drill' ? (
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
    );

  // Game panel in the trainers' shape: status and the game's own actions
  // live here; the moves panel is the one every other board page uses.
  const gamePanel = (
  // `grow` on a phone, as both trainers' info panels do: this panel is
  // the whole info pane there, and mid-game it is three lines of status —
  // so the column ended at the text and left a band of page between the
  // panel and the bottom bar (measured at 375x812: the panel stopped at
  // 639 with the bar at 757, 104px of nothing). It shrinks as well as
  // grows, which is safe because the BODY scrolls; a panel that could not
  // shrink would run past the column with Panel's overflow-hidden cutting
  // whatever hung off the end. A desktop keeps `shrink-0`: the moves panel
  // above already takes the column's spare height there.
  <Panel flush className={wide ? 'shrink-0' : 'grow'}>
    <PanelHeader
      title={t('Game')}
      actions={
        /* Idle, the way OUT: the opening map, which is where a
           repertoire is looked at rather than played, and which sends
           drills back here. The choices are no longer in this corner —
           the row that names them opens them, below. Mid-game the header
           carries nothing: New game is the panel's own action and sits in
           the body with the others (lanph3re's call), where a ghost
           button in the corner had it looking like chrome. */
        phase === 'idle' ? (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Opening map')}
            onClick={() => navigate('openingmap')}
          >
            <Network className="size-3.5" />
          </Button>
        ) : undefined
      }
    />
    {/* `grow` so the body owns the panel's height rather than stopping at
        its text, `overflow-y-auto` so that height is a ceiling and not a
        promise, and `min-h-0` because a flex item will not shrink below
        its content without it. What can run long lives here — the status
        line, a gap note, the database error, the final score — and what
        there is to press lives on the floor below. */}
    <div
      className={cn(
        'flex min-h-0 grow flex-col gap-3 overflow-y-auto p-3',
        // The floor carries its own p-3; without this the two would read
        // as 24px of gap between the text and the buttons.
        (phase === 'idle' || phase === 'ended') && 'pb-0',
      )}
    >
      {/* Idle, the panel is what the page opens on: what the next game
          would be, and the button that begins it. Playing, it is the
          status line the trainers all carry. */}
      {phase === 'idle' ? (
        /* The trainers' own headline size — the puzzle panel sets its
           verdict in text-base font-semibold, and this is the same line
           at the same moment: what the board in front of you is. */
        <p className="text-fg text-base font-semibold leading-snug">{setupLine}</p>
      ) : (
        <p
          className={cn(
            'text-sm leading-relaxed',
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
                  ? t('Your opponent is replying…')
                  : pos.turn === userColor && atTip
                    ? t('Your move.')
                    : t('Reviewing an earlier move — step to the end to keep playing.')}
        </p>
      )}
      {gapNote && phase !== 'ended' && (
        <p className="text-subtle text-sm leading-relaxed">{gapNote}</p>
      )}
      {/* The dependency arrow, pointed back: Settings knows it
          powers this, but this error never said Settings was
          the fix. A tokenless user read "could not reach" as
          the app being broken. */}
      {error && source === ONLINE_SOURCE && (
        <p className="text-muted text-sm leading-relaxed">
          {t('The online database goes through your Lichess token.')}{' '}
          <a href="#/settings" className="text-primary hover:underline">
            {t('Add one in Settings')}
          </a>
        </p>
      )}
      {/* The score and its bar only: what this ending OFFERS is on the
          panel's floor with New game, so the two things you might press
          next stand in one row rather than one of them sitting up in the
          middle of the panel. */}
      {phase === 'ended' && <FinalAssessment fen={getNode(tree, tipId).fen} />}
      {/* What the page IS, in the words home and More already use for it
          — one line, under what it would play and above the button that
          plays it. The long version stays behind the ? in the header: a
          paragraph the panel made every visit re-read is exactly what
          that InfoTip was cut out of. */}
      {phase === 'idle' && (
        <p className="text-subtle text-sm leading-relaxed">
          {t('Practise an opening against real games')}
        </p>
      )}
      {/* On a desktop these follow the fields in the New game panel, and
          this panel is not on screen at all until a game is. Start
          leads; the row that would change what it starts comes after
          it. */}
    </div>

    {/* The panel's floor: outside the scrolling body and `shrink-0`, so a
        thumb finds it in the same place and the squeeze is always taken
        by the text above it. What stands on it is what there is to do
        NEXT, which is a different set before a game and after one — and
        nothing at all during, because a game in progress has no next step
        that is not a move on the board.

        Idle: Start, and under it the row that says what Start would play
        and opens the settings (lanph3re's call — they belong on the floor
        rather than trailing the description). Ended: what the mode offers
        for the line just played, then New game, primary and last, the way
        every row in this app ends. */}
    {(phase === 'idle' || phase === 'ended') && (
      <div className="flex shrink-0 flex-col gap-3 p-3">
        {phase === 'idle' && startBlock}
        {phase === 'idle' && setupRow}
        {phase === 'ended' && (
          <div className="flex flex-wrap justify-end gap-2">
            {endAction}
            <Button variant="primary" size="sm" onClick={newGame} title={t('Set up a new game')}>
              <RotateCcw className="size-3.5" />
              {t('New game')}
            </Button>
          </div>
        )}
      </div>
    )}
  </Panel>
  );
  const movesPanel = analysing ? (
    <AnalysisMovesPanel engine={wide} />
  ) : (
  <AnswerPanel
    // Takes the column's spare height, so the panel under it sits on the
    // board's bottom edge instead of floating above it.
    className="min-h-0 flex-1 shrink"
    tree={tree}
    cursorId={cursorId}
    onSelect={setCursorId}
    emptyText="Make your first move on the board."
  />
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

      {/* Once the line has ended the board becomes the analysis board, so
          the pieces move freely and the eval bar is the shared one. */}
      {analysing ? (
        <AnalysisBoard />
      ) : (
        <div className={BOARD_WIDE_COLUMN}>
          <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
            {/* wide:h-10 + the column's gap-2 equals the other board pages'
                top strip, so this board's top edge sits level with theirs
                (and with the side column's first panel: h-9 + gap-3).

                The height belongs to this BOX, and the name row sits at the
                bottom of it — AnalysisBoard's strip exactly. The two must be
                built the same way, not merely add up to the same number: the
                row is 24px inside a 40px strip, so where its contents end up
                is the row's business, and a slot stretched to 40px itself put
                them 7px lower than every other board page's. */}
            <div className="flex w-full items-end wide:h-10">
              <PlayerSlot side={orientation === 'white' ? 'black' : 'white'} fen={node.fen} />
            </div>
            {/* The eval bar's width, held open before there is an eval bar:
                when the line ends this board is replaced by AnalysisBoard,
                which draws one, and without the same reservation here the
                board lost 24px and stepped right at exactly that moment. */}
            <div className="flex w-full items-stretch gap-2">
              <EvalBarSlot />
              <div className="min-w-0 flex-1">
                <Board
                  apiRef={boardApi}
                  fen={node.fen}
                  orientation={orientation}
                  dests={dests}
                  lastMove={moveSquares(node)}
                  check={pos.isCheck()}
                  onMove={onMove}
                />
              </div>
            </div>
            <PlayerSlot side={orientation} fen={node.fen} />
          </div>
        </div>
      )}

      {/* stacked:min-h-max — the page column is what scrolls on a phone, so
          this one must take at least the height its content needs. As
          flex-1 with min-h-0 it shrank under that content instead, and the
          bottom of the New game panel was cut off.

          At LEAST, though, and not exactly: it was flex-none too, which
          pinned it to its content in both directions, and mid-game its
          content is three lines of status — so the panel stopped 104px
          above the bottom bar with page showing under it (measured at
          375x812: panel to 639, bar at 757). flex-1 against a max-content
          floor grows into that band and still cannot be squeezed below
          what it holds. */}
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
      <div className={`flex min-h-0 flex-1 flex-col gap-3 wide:overflow-y-auto wide:scrollbar-hidden wide:pb-4 stacked:min-h-max stacked:gap-2 ${BOARD_WIDE_SIDE}`}>
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">{header}</div>

        {phase === 'idle' ? (
          /* fit: a short form under a tall board. Left to shrink, the panel
             cut its own Start button off with nothing to scroll to.

             The panel only where there is a column to stand it in. On a
             phone the same fields are the sheet the Game panel opens, and
             the Game panel is what the page shows on arrival. */
          wide ? (
            <Panel flush fit className="shrink-0">
              <PanelHeader title={t('New game')} />
              <div className="flex flex-col gap-3 p-3">
                {setupFields}
                {startBlock}
              </div>
            </Panel>
          ) : (
            gamePanel
          )
        ) : (
          <>
            {/* Moves above the game on a desktop; one pane at a time on a
                phone, the engine chosen for you when the line ends. */}
            {!wide && (
              <PaneTabs
                value={shownPane}
                onChange={setPane}
                tabs={[
                  { id: 'info', label: t('Game'), icon: Info },
                  { id: 'moves', label: t('Moves'), icon: ListOrdered },
                  // The engine is what a line is FOR — offered when the
                  // answer is in, not while it is being looked for.
                  ...(analysing ? [{ id: 'engine' as const, label: 'Engine', icon: Cpu }] : []),
                ]}
              />
            )}
            {(wide || shownPane === 'moves') && movesPanel}
            {!wide && analysing && shownPane === 'engine' && (
              <Panel flush className="min-h-0 flex-1">
                <EngineBlock standalone />
              </Panel>
            )}
            {(wide || shownPane === 'info') && gamePanel}
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

      {/* The New game fields as a window — which on a phone is the bottom
          sheet every form in this app is there. Only when stacked: a
          desktop stands them in its column, and rendering both would be
          the same fields twice, sharing one set of state. */}
      {setupOpen && !wide && phase === 'idle' && (
        <Modal title="New game" icon={Settings2} onClose={cancelSetup}>
          {setupFields}
          {/* justify-end, gap-2, the primary one LAST — the row every
              window in this app ends on (ui/PromptSheet). Apply only
              closes: the fields have been writing straight through all
              along, which is what puts the chosen opening on the board
              behind the sheet. Cancel is the one that does work, by
              putting back what was there when the sheet opened. */}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={cancelSetup}>
              {t('Cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={applySetup}>
              {t('Apply')}
            </Button>
          </div>
        </Modal>
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
