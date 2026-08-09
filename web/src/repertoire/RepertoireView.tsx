import { parseSquare } from 'chessops/util';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Compass, FlipVertical2, Play, RotateCcw, SwatchBook } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addSan, addUci, createTree, getNode, legalDests, mainlineFrom, positionAt } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { treeToPgn } from '@shared/pgn';
import { Board } from '@/board/Board';
import { BOARD_MAX_W } from '@/board/boardSize';
import { AnswerPanel } from '@/puzzles/AnswerPanel';
import { playSound } from '@/board/sound';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { Input } from '@/ui/Input';
import { Panel, PanelHeader } from '@/ui/Panel';
import { Select } from '@/ui/Select';

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

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TEMPLATES;
    return (all ?? []).filter(
      (o) => o.eco.toLowerCase().startsWith(q) || o.name.toLowerCase().includes(q),
    ).slice(0, 50);
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
        coarse ? 'max-h-[45dvh]' : 'max-h-44',
      )}
    >
      {matches.length === 0 ? (
        <li className="text-subtle px-2 py-1.5 text-xs">
          {all === null ? 'Loading the catalogue…' : 'No opening matches that.'}
        </li>
      ) : (
        matches.map((o, i) => (
          <li key={`${o.eco}-${o.name}-${i}`}>
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
            onClick={() => setOpen(false)}
          >
            <div
              // The safe-area term keeps the sheet below the notch/status bar
              // when installed as a PWA (standalone covers the whole screen).
              className="bg-surface border-line absolute inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex flex-col gap-2 rounded-xl border p-2 shadow-[var(--shadow-pop)]"
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                autoFocus
                inputSize="sm"
                value={query}
                placeholder="Search any opening or ECO code…"
                onChange={(e) => setQuery(e.target.value)}
              />
              {list}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        inputSize="sm"
        value={open ? query : value.eco ? `${value.eco}  ${value.name}` : value.name}
        placeholder="Search any opening or ECO code…"
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
      {open && list}
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
          setError(body?.error ?? 'Could not reach the Lichess database.');
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
          setError('Could not reach the Lichess database.');
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
    const { t, id } = seedTree(template);
    setTree(t);
    setTipId(id);
    setCursorId(id);
    setFlipped(false);
    setError(null);
    if (positionAt(t, id).turn === userColor) setPhase('playing');
    else void reply(t, id, band);
  };

  const newGame = (): void => {
    // Back to setup, board reset to the chosen opening's preview. The runId
    // bump drops any in-flight reply.
    runId.current += 1;
    const { t, id } = seedTree(template);
    setTree(t);
    setTipId(id);
    setCursorId(id);
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
      <h1 className="text-fg text-sm font-semibold">Repertoire</h1>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
      <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          title="Back"
          onClick={() => window.history.back()}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        {header}
      </div>

      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <Board
            fen={node.fen}
            orientation={orientation}
            dests={dests}
            lastMove={node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined}
            check={pos.isCheck()}
            onMove={onMove}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto lg:scrollbar-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">{header}</div>

        {phase === 'idle' ? (
          <Panel flush className="shrink-0">
            <PanelHeader title="New game" />
            <div className="flex flex-col gap-3 p-3">
              <div className="flex gap-1">
                {(['white', 'black'] as const).map((c) => (
                  <Button
                    key={c}
                    size="sm"
                    variant={userColor === c ? 'primary' : 'secondary'}
                    className="flex-1 capitalize"
                    onClick={() => setUserColor(c)}
                  >
                    {c}
                  </Button>
                ))}
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">Rating</span>
                <Select
                  value={band}
                  onChange={setBand}
                  ariaLabel="Opponent strength"
                  groups={[{ options: RATING_BANDS.map((b) => ({ value: b.ratings, label: b.label })) }]}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">Opening</span>
                <OpeningPicker value={template} onChange={setTemplate} />
              </label>
              <Button variant="primary" size="sm" className="self-start" onClick={startGame}>
                <Play className="size-3.5" />
                Start
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
                title="Game"
                actions={
                  <Button variant="ghost" size="sm" onClick={newGame} title="Set up a new game">
                    <RotateCcw className="size-3.5" />
                    New game
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
                  Analyse this line
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
            <Button variant="ghost" size="icon" disabled={cursorIndex <= 0} onClick={() => goTo(0)} title="First move">
              <ChevronFirst className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={cursorIndex <= 0} onClick={() => goTo(cursorIndex - 1)} title="Back">
              <ChevronLeft className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={atTip} onClick={() => goTo(cursorIndex + 1)} title="Forward">
              <ChevronRight className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={atTip} onClick={() => goTo(line.length - 1)} title="Latest">
              <ChevronLast className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setFlipped((f) => !f)} title="Flip board">
              <FlipVertical2 className="size-[1.1rem]" />
            </Button>
          </div>
        </MobileActionBar>
      )}
    </div>
  );
}
