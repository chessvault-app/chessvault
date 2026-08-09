import { parseSquare } from 'chessops/util';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Compass, FlipVertical2, Play, RotateCcw, SwatchBook } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { addSan, addUci, createTree, getNode, legalDests, mainlineFrom, positionAt } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { treeToPgn } from '@shared/pgn';
import { Board } from '@/board/Board';
import { BOARD_MAX_W } from '@/board/boardSize';
import { playSound } from '@/board/sound';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
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
  { eco: '', name: 'Free (start position)', sans: [] },
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

export function RepertoireView() {
  const [userColor, setUserColor] = useState<'white' | 'black'>('white');
  const [band, setBand] = useState(RATING_BANDS[1]!.ratings);
  const [templateName, setTemplateName] = useState(TEMPLATES[0]!.name);

  const [tree, setTree] = useState<MoveTree>(() => createTree());
  const [tipId, setTipId] = useState<NodeId>(tree.rootId);
  const [cursorId, setCursorId] = useState<NodeId>(tree.rootId);
  const [phase, setPhase] = useState<Phase>('idle');
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a stale reply landing after a new game.
  const runId = useRef(0);

  const node = getNode(tree, cursorId);
  const pos = useMemo(() => positionAt(tree, cursorId), [tree, cursorId]);
  const line = useMemo(() => mainlineFrom(tree, tree.rootId), [tree]);
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
    const template = TEMPLATES.find((t) => t.name === templateName) ?? TEMPLATES[0]!;
    let t = createTree();
    let id = t.rootId;
    for (const san of template.sans) {
      const added = addSan(t, id, san);
      if (!added) break;
      t = added.tree;
      id = added.nodeId;
    }
    setTree(t);
    setTipId(id);
    setCursorId(id);
    setFlipped(false);
    setError(null);
    if (positionAt(t, id).turn === userColor) setPhase('playing');
    else void reply(t, id, band);
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
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-hidden wide:flex-row wide:gap-4 wide:p-4">
      <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">{header}</div>

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

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-y-auto lg:scrollbar-hidden max-lg:overflow-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">{header}</div>

        {phase === 'idle' ? (
          <Panel flush className="shrink-0">
            <PanelHeader title="New game" />
            <div className="flex flex-col gap-3 p-3">
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">You play</span>
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
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">Opponent strength</span>
                <Select
                  value={band}
                  onChange={setBand}
                  ariaLabel="Opponent strength"
                  groups={[{ options: RATING_BANDS.map((b) => ({ value: b.ratings, label: b.label })) }]}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-muted text-xs font-medium">Opening</span>
                <Select
                  value={templateName}
                  onChange={setTemplateName}
                  ariaLabel="Opening"
                  groups={[
                    {
                      options: TEMPLATES.map((t) => ({
                        value: t.name,
                        label: t.eco ? `${t.eco}  ${t.name}` : t.name,
                      })),
                    },
                  ]}
                />
              </label>
              <Button variant="primary" size="sm" className="self-start" onClick={startGame}>
                <Play className="size-3.5" />
                Start
              </Button>
            </div>
          </Panel>
        ) : (
          <Panel flush className="flex-1 max-lg:min-h-0 lg:min-h-[16rem]">
            <PanelHeader
              title="Moves"
              actions={
                <Button variant="ghost" size="sm" onClick={() => setPhase('idle')} title="Set up a new game">
                  <RotateCcw className="size-3.5" />
                  New game
                </Button>
              }
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {line.length <= 1 ? (
                <p className="text-subtle text-xs">Make your first move on the board.</p>
              ) : (
                <p className="text-sm leading-relaxed">
                  {line.slice(1).map((id, i) => {
                    const n = getNode(tree, id);
                    const isCursor = id === cursorId;
                    return (
                      <span key={id}>
                        {i % 2 === 0 && <span className="text-subtle mr-0.5">{i / 2 + 1}.</span>}
                        <button
                          type="button"
                          onClick={() => setCursorId(id)}
                          className={cn(
                            'mr-1 rounded px-1 font-mono transition-colors',
                            isCursor ? 'bg-primary-soft text-primary' : 'text-fg hover:bg-surface-2',
                          )}
                        >
                          {n.san}
                        </button>
                      </span>
                    );
                  })}
                </p>
              )}
            </div>
            <div className="border-line flex flex-col gap-2 border-t p-3">
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
