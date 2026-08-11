import { parseSquare } from 'chessops/util';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Compass, FlipVertical2, Play, RotateCcw, SwatchBook } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addSan, addUci, createTree, getNode, legalDests, mainlineFrom, positionAt } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { treeToPgn } from '@shared/pgn';
import { Board } from '@/board/Board';
import { BOARD_MAX_W } from '@/board/boardSize';
import { AnswerPanel } from '@/puzzles/AnswerPanel';
import { playSound } from '@/board/sound';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { Input } from '@/ui/Input';
import { SideDot } from '@/ui/SideDot';
import { Panel, PanelHeader } from '@/ui/Panel';
import { Select } from '@/ui/Select';
import { t } from '@/lib/i18n';

/**
 * Repertoire trainer: rehearse an opening against the field. You move; the app
 * replies with a real move, chosen in proportion to how often it was actually
 * played in the Lichess database, filtered to a rating band you pick. When the
 * line runs past the database the opening is over — the whole line hands off to
 * the Board for engine analysis.
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

const RATING_BANDS: { label: string; ratings: string }[] = [
  { label: 'Beginner (under 1400)', ratings: '400,1000,1200' },
  { label: 'Club (1400–1800)', ratings: '1400,1600' },
  { label: 'Strong (1800–2200)', ratings: '1800,2000' },
  { label: 'Master (2200+)', ratings: '2200,2500' },
  { label: 'All ratings', ratings: '400,1000,1200,1400,1600,1800,2000,2200,2500' },
];

interface ExplorerMove {
  uci: string;
  san: string;
  total: number;
}

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
    <div className="flex h-6 w-full items-center gap-2 px-0.5">
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
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  // Where to put the floating list. A Panel clips its children (rounded
  // corners), so an absolutely-positioned dropdown inside one is buried in
  // it — the list has to leave the panel entirely and be placed against
  // the input's own box on screen.
  const anchor = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    if (!open || coarse) return;
    const place = (): void => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) setBox({ left: rect.left, top: rect.bottom + 4, width: rect.width });
    };
    place();
    window.addEventListener('resize', place);
    // Capture: the panel it lives in is itself scrollable.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, coarse]);

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
      that many buttons to open a dropdown costs most of a second. */
  const SHOWN = 300;

  const { matches, hidden } = useMemo(() => {
    const q = query.trim().toLowerCase();
    // An empty box used to offer a dozen curated openings, so the picker
    // could be searched but not browsed. It now offers the whole
    // catalogue, ordered by ECO, with the curated few first.
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
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const list = (
    <ul
      className={cn(
        'border-line bg-surface overflow-y-auto overscroll-contain rounded-lg border p-1',
        // On a mouse the list FLOATS over the page, portalled out of the
        // panel that would otherwise clip it. Inline, it also pushed
        // everything below it down as you typed and let go when you picked.
        coarse ? 'max-h-[45dvh]' : 'max-h-64 shadow-[var(--shadow-pop)]',
      )}
    >
      {matches.length === 0 ? (
        <li className="text-subtle px-2 py-1.5 text-xs">
          {all === null ? 'Reading the catalogue…' : 'No opening matches that.'}
        </li>
      ) : (
        matches.map((o, i) => (
          <li key={`${o.eco}-${o.name}-${i}`} className="[content-visibility:auto]">
            <button
              type="button"
              // mousedown, not click: it fires before the input's blur
              // closes the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              className={cn(
                'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                'hover:bg-surface-2 transition-colors duration-100',
                'pointer-coarse:py-2.5',
                o.name === value.name && o.eco === value.eco ? 'text-primary font-medium' : 'text-fg',
              )}
            >
              {o.eco && <span className="text-subtle w-7 shrink-0 font-mono text-[0.625rem]">{o.eco}</span>}
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
            </button>
          </li>
        ))
      )}
      {hidden > 0 && (
        <li className="text-subtle px-2 py-1.5 text-[0.6875rem]">
          {hidden.toLocaleString()} more — type to narrow.
        </li>
      )}
    </ul>
  );

  if (coarse) {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setOpen(true);
          }}
          className={cn(
            'border-line bg-surface-inset text-fg flex h-9 min-w-0 items-center rounded-md border px-2.5 text-left text-xs',
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {value.eco ? `${value.eco}  ${value.name}` : value.name}
          </span>
        </button>
        {open && (
          <div
            className="fixed inset-0 z-50 bg-black/50"
            // pointerdown, not click: iOS does not reliably synthesize click
            // on a plain backdrop div, which left selecting an opening as the
            // ONLY way to close the sheet. The dismissing tap's synthesized
            // click is swallowed — it must not press what's behind the
            // backdrop (it reached the colour buttons, lanph3re's report).
            onPointerDown={() => {
              setOpen(false);
              suppressNextClick();
            }}
          >
            <div
              // The safe-area term keeps the sheet below the notch/status bar
              // when installed as a PWA (standalone covers the whole screen).
              className="bg-surface border-line absolute inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex flex-col gap-2 rounded-xl border p-2 shadow-[var(--shadow-pop)]"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* With the keyboard up, the backdrop is mostly covered and
                  the only dead space is a sliver — so closing needed an
                  explicit way out, not just a tap somewhere else. */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t('Close')}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    suppressNextClick();
                  }}
                  className="text-subtle hover:text-fg -ml-1 grid size-8 shrink-0 place-items-center rounded-md"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <Input
                  autoFocus
                  inputSize="sm"
                  className="min-w-0 flex-1"
                  value={query}
                  placeholder={t('Search any opening or ECO code…')}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {list}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div ref={anchor} className="flex flex-col gap-1">
      <Input
        inputSize="sm"
        value={open ? query : value.eco ? `${value.eco}  ${value.name}` : value.name}
        placeholder={t('Search any opening or ECO code…')}
        onFocus={() => {
          setOpen(true);
          setQuery('');
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
        }}
      />
      {open &&
        box &&
        createPortal(
          <div
            className="fixed z-50"
            style={{ left: box.left, top: box.top, width: box.width }}
          >
            {list}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function RepertoireView() {
  const [userColor, setUserColor] = useState<'white' | 'black'>('white');
  const [band, setBand] = useState(RATING_BANDS[1]!.ratings);
  const [template, setTemplate] = useState<Template>(TEMPLATES[0]!);

  const [tree, setTree] = useState<MoveTree>(() => createTree());
  const [tipId, setTipId] = useState<NodeId>(tree.rootId);
  const [cursorId, setCursorId] = useState<NodeId>(tree.rootId);
  const [phase, setPhase] = useState<Phase>('idle');
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a stale reply landing after a new game.
  const runId = useRef(0);

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

  // Idle previews the chosen opening immediately, last move highlighted.
  useEffect(() => {
    if (phase !== 'idle') return;
    const { t, id } = seedTree(template);
    setTree(t);
    setTipId(id);
    setCursorId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, phase]);

  const node = getNode(tree, cursorId);
  const pos = useMemo(() => positionAt(tree, cursorId), [tree, cursorId]);
  // mainlineFrom EXCLUDES its starting node — prepend the root so index 0 is
  // the start position. Without it the first move fell off the moves panel
  // (slice(1) skipped a MOVE) and "First move" could never reach the start.
  const line = useMemo(() => [tree.rootId, ...mainlineFrom(tree, tree.rootId)], [tree]);
  const atTip = cursorId === tipId;
  const orientation = flipped ? (userColor === 'white' ? 'black' : 'white') : userColor;

  const canMove = phase === 'playing' && atTip && pos.turn === userColor;
  const dests = useMemo(() => (canMove ? legalDests(tree, cursorId) : new Map()), [canMove, tree, cursorId]);

  // Fetch the field's reply and play it. The runId guard drops replies that
  // arrive after the game was restarted.
  const reply = useCallback(
    async (curTree: MoveTree, curId: NodeId, ratings: string) => {
      const token = runId.current;
      setPhase('thinking');
      setError(null);
      // A steady minimum "thinking" time: the DB fetch is instant when the
      // position is cached and slow when it isn't, which felt jarringly
      // random. Waiting out the rest of MIN_THINK makes the reply land at a
      // consistent, deliberate pace.
      const started = Date.now();
      try {
        const fen = getNode(curTree, curId).fen;
        const res = await fetch(`/api/explorer/lichess?fen=${encodeURIComponent(fen)}&ratings=${ratings}`);
        if (token !== runId.current) return;
        const body = (await res.json().catch(() => null)) as { moves?: ExplorerMove[]; error?: string } | null;
        if (!res.ok || !body?.moves) {
          setError(t(body?.error ?? 'Could not reach the Lichess database.'));
          setPhase('playing');
          return;
        }
        const choice = sampleMove(body.moves);
        if (!choice) {
          setPhase('ended');
          return;
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
        setPhase('playing');
      } catch {
        if (token === runId.current) {
          setError(t('Could not reach the Lichess database.'));
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
    playSound(getNode(added.tree, added.nodeId).san?.includes('x') ? 'capture' : 'move');
    setTree(added.tree);
    setTipId(added.nodeId);
    setCursorId(added.nodeId);
    void reply(added.tree, added.nodeId, band);
  };

  const startGame = (): void => {
    runId.current += 1;
    const token = runId.current;
    const { t, id } = seedTree(template);
    setTree(t);
    setTipId(id);
    setFlipped(false);
    setError(null);
    const last = getNode(t, id);
    if (positionAt(t, id).turn === userColor) {
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
      void reply(t, id, band);
    }
  };

  const newGame = (): void => {
    // Back to setup. The runId bump drops any in-flight reply; the idle
    // effect above reseeds the board to the chosen opening's preview.
    runId.current += 1;
    setFlipped(false);
    setError(null);
    setPhase('idle');
  };

  const goTo = (targetIndex: number): void => {
    const clamped = Math.max(0, Math.min(targetIndex, line.length - 1));
    setCursorId(line[clamped]!);
  };
  const cursorIndex = line.indexOf(cursorId);

  const analyse = (): void => {
    const pgn = treeToPgn(tree, { Event: 'Repertoire line', Result: '*' });
    if (useAnalysis.getState().loadPgn(pgn)) {
      useAnalysis.setState({ handoff: true, orientation: userColor });
      useEngine.getState().setEnabled(true);
      navigate('analysis');
    }
  };

  const header = (
    <>
      <SwatchBook className="text-subtle size-4" aria-hidden />
      <h1 className="text-fg text-sm font-semibold">{t('Repertoire')}</h1>
    </>
  );

  return (
    // stacked:pb-8 — this column is what scrolls on a phone, and its last
    // panel used to end flush against the bottom navigation with its own
    // border cut off. Padding inside the scroll area gives it somewhere to
    // finish.
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto stacked:pb-8 wide:flex-row wide:gap-4 wide:p-4">
      <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          title={t('Back')}
          onClick={() => window.history.back()}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        {header}
      </div>

      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <PlayerSlot side={orientation === 'white' ? 'black' : 'white'} fen={node.fen} />
          <Board
            fen={node.fen}
            orientation={orientation}
            dests={dests}
            lastMove={node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined}
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 wide:overflow-y-auto wide:scrollbar-hidden stacked:min-h-max stacked:flex-none stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">{header}</div>

        {/* fit: a short form under a tall board. Left to shrink, the panel
            cut its own Start button off with nothing to scroll to. */}
        {phase === 'idle' ? (
          <Panel flush fit className="shrink-0">
            <PanelHeader title={t('New game')} />
            <div className="flex flex-col gap-3 p-3">
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
                    className="h-7 flex-1 capitalize pointer-coarse:h-8"
                    onClick={() => setUserColor(c)}
                  >
                    {c}
                  </Button>
                ))}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">{t('Rating')}</span>
                <Select
                  value={band}
                  onChange={setBand}
                  ariaLabel={t('Opponent strength')}
                  groups={[{ options: RATING_BANDS.map((b) => ({ value: b.ratings, label: b.label })) }]}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">{t('Opening')}</span>
                <OpeningPicker value={template} onChange={setTemplate} />
              </label>
              <Button variant="primary" size="sm" className="self-start" onClick={startGame}>
                <Play className="size-3.5" />
                {t('Start')}
              </Button>
            </div>
          </Panel>
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
                <p className="text-muted text-xs leading-relaxed">
                  {phase === 'ended'
                    ? 'This line has run past the database — you are on your own now. Analyse it to see how the position stands.'
                    : error
                      ? error
                      : phase === 'thinking'
                        ? 'Your opponent is replying…'
                        : pos.turn === userColor && atTip
                          ? 'Your move.'
                          : 'Reviewing an earlier move — step to the end to keep playing.'}
                </p>
                <Button
                  variant={phase === 'ended' ? 'primary' : 'secondary'}
                  size="sm"
                  className="self-start"
                  onClick={analyse}
                >
                  <Compass className="size-3.5" />
                  {t('Analyse this line')}
                </Button>
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
    </div>
  );
}
