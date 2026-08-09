import { parseSquare } from 'chessops/util';
import { Compass, RotateCcw, Swords } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addSan,
  addUci,
  createTree,
  getNode,
  legalDests,
  mainlineFrom,
  positionAt,
} from '@shared/tree';
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
import { Panel, PanelHeader } from '@/ui/Panel';
import { Select } from '@/ui/Select';

/**
 * Repertoire trainer: play out openings against the crowd. You move; the app
 * replies with a real move sampled — weighted by how often it was played — from
 * the Lichess game database (filtered to a rating band you choose). When the
 * database runs dry the line has left known theory: the game ends and hands the
 * whole line to the Board for engine analysis, seamlessly.
 */

type Phase = 'playing' | 'thinking' | 'ended';

interface Template {
  name: string;
  sans: string[];
}

// A handful of mainlines to start from; "Free" begins at move one.
const TEMPLATES: Template[] = [
  { name: 'Free (start position)', sans: [] },
  { name: 'Ruy López', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { name: 'Italian Game', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { name: 'Sicilian Defence', sans: ['e4', 'c5'] },
  { name: 'French Defence', sans: ['e4', 'e6'] },
  { name: 'Caro-Kann', sans: ['e4', 'c6'] },
  { name: "Queen's Gambit", sans: ['d4', 'd5', 'c4'] },
  { name: "King's Indian", sans: ['d4', 'Nf6', 'c4', 'g6'] },
  { name: 'London System', sans: ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4'] },
  { name: 'English Opening', sans: ['c4'] },
];

// Lichess rating buckets; a band is a contiguous run of these.
const RATING_BUCKETS = ['400', '1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'] as const;
const RATING_BANDS: { label: string; ratings: string }[] = [
  { label: 'Beginner (< 1400)', ratings: '400,1000,1200' },
  { label: 'Club (1400–1800)', ratings: '1400,1600' },
  { label: 'Strong (1800–2200)', ratings: '1800,2000' },
  { label: 'Master (2200+)', ratings: '2200,2500' },
  { label: 'All ratings', ratings: RATING_BUCKETS.join(',') },
];

interface ExplorerMove {
  uci: string;
  san: string;
  total: number;
}

/** Weighted-random pick by game count — the crowd's move, not the best move. */
function sampleMove(moves: ExplorerMove[]): ExplorerMove | null {
  const total = moves.reduce((s, m) => s + m.total, 0);
  if (total === 0) return null;
  let r = Math.random() * total;
  for (const m of moves) {
    r -= m.total;
    if (r < 0) return m;
  }
  return moves[moves.length - 1] ?? null;
}

/** orig+dest, with a queen promotion appended when a pawn reaches the far rank
    (the opening trainer never needs under-promotion). */
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
  const [cursorId, setCursorId] = useState<NodeId>(tree.rootId);
  const [phase, setPhase] = useState<Phase>('playing');
  const [error, setError] = useState<string | null>(null);
  // Guards against a stale reply landing after a restart.
  const runId = useRef(0);

  const node = getNode(tree, cursorId);
  const pos = useMemo(() => positionAt(tree, cursorId), [tree, cursorId]);
  const dests = useMemo(
    () => (phase === 'playing' && pos.turn === userColor ? legalDests(tree, cursorId) : new Map()),
    [tree, cursorId, phase, pos.turn, userColor],
  );
  const line = useMemo(
    () => mainlineFrom(tree, tree.rootId).map((id) => getNode(tree, id).san),
    [tree],
  );

  // Fetch the crowd's reply and play it. Runs whenever it becomes the app's
  // turn during play; the runId guard drops replies from an abandoned game.
  const replyIfNeeded = useCallback(
    async (curTree: MoveTree, curId: NodeId, mine: 'white' | 'black', ratings: string) => {
      const p = positionAt(curTree, curId);
      if (p.turn === mine) return;
      const token = runId.current;
      setPhase('thinking');
      setError(null);
      try {
        const fen = getNode(curTree, curId).fen;
        const res = await fetch(
          `/api/explorer/lichess?fen=${encodeURIComponent(fen)}&ratings=${ratings}`,
        );
        if (token !== runId.current) return;
        const body = (await res.json().catch(() => null)) as
          | { moves?: ExplorerMove[]; error?: string }
          | null;
        if (!res.ok || !body?.moves) {
          setError(body?.error ?? 'Could not reach the Lichess database.');
          setPhase('playing');
          return;
        }
        const choice = sampleMove(body.moves.filter((m) => m.total > 0));
        if (!choice) {
          // Out of book — the line has left known theory.
          setPhase('ended');
          return;
        }
        const added = addUci(curTree, curId, choice.uci);
        if (!added) {
          setPhase('ended');
          return;
        }
        playSound(getNode(added.tree, added.nodeId).san?.includes('x') ? 'capture' : 'move');
        setTree(added.tree);
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
    if (phase !== 'playing' || pos.turn !== userColor) return;
    const added = addUci(tree, cursorId, toUci(tree, cursorId, orig, dest));
    if (!added) return;
    playSound(getNode(added.tree, added.nodeId).san?.includes('x') ? 'capture' : 'move');
    setTree(added.tree);
    setCursorId(added.nodeId);
    void replyIfNeeded(added.tree, added.nodeId, userColor, band);
  };

  const start = useCallback(
    (color: 'white' | 'black', ratings: string, template: Template) => {
      runId.current += 1;
      let t = createTree();
      let id = t.rootId;
      for (const san of template.sans) {
        const added = addSan(t, id, san);
        if (!added) break;
        t = added.tree;
        id = added.nodeId;
      }
      setTree(t);
      setCursorId(id);
      setError(null);
      // If it is already the app's turn (e.g. you chose Black, or the template
      // ended on your opponent's move), it replies immediately.
      const p = positionAt(t, id);
      if (p.turn === color) {
        setPhase('playing');
      } else {
        void replyIfNeeded(t, id, color, ratings);
      }
    },
    [replyIfNeeded],
  );

  // Start a fresh game on first mount and whenever the settings change.
  useEffect(() => {
    const template = TEMPLATES.find((t) => t.name === templateName) ?? TEMPLATES[0]!;
    start(userColor, band, template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userColor, band, templateName]);

  const analyse = (): void => {
    const pgn = treeToPgn(tree, { Event: 'Repertoire line', Result: '*' });
    if (useAnalysis.getState().loadPgn(pgn)) {
      useAnalysis.setState({ handoff: true, orientation: userColor });
      useEngine.getState().setEnabled(true);
      navigate('analysis');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
      <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
        <Swords className="text-subtle size-4" aria-hidden />
        <h1 className="text-fg text-sm font-semibold">Repertoire</h1>
      </div>

      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <Board
            fen={node.fen}
            orientation={userColor}
            dests={dests}
            lastMove={node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined}
            check={pos.isCheck()}
            onMove={onMove}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">
          <Swords className="text-subtle size-4" aria-hidden />
          <h1 className="text-fg text-sm font-semibold">Repertoire</h1>
        </div>

        <Panel flush className="shrink-0">
          <PanelHeader title="Sparring" />
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
              <span className="text-muted text-xs font-medium">Opponent rating</span>
              <Select
                value={band}
                onChange={setBand}
                ariaLabel="Opponent rating band"
                groups={[{ options: RATING_BANDS.map((b) => ({ value: b.ratings, label: b.label })) }]}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted text-xs font-medium">Opening</span>
              <Select
                value={templateName}
                onChange={setTemplateName}
                ariaLabel="Opening template"
                groups={[{ options: TEMPLATES.map((t) => ({ value: t.name, label: t.name })) }]}
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => {
                const template = TEMPLATES.find((t) => t.name === templateName) ?? TEMPLATES[0]!;
                start(userColor, band, template);
              }}
            >
              <RotateCcw className="size-3.5" />
              Restart
            </Button>
          </div>
        </Panel>

        <Panel flush className="shrink-0">
          <PanelHeader
            title={phase === 'ended' ? 'Out of book' : phase === 'thinking' ? 'Opponent thinking…' : 'Your line'}
          />
          <div className="flex flex-col gap-3 p-3">
            {phase === 'ended' ? (
              <p className="text-muted text-xs leading-relaxed">
                This line has left the database — you are on your own now. Analyse it with the
                engine to see how the position stands.
              </p>
            ) : error ? (
              <p className="text-bad text-xs leading-relaxed">{error}</p>
            ) : (
              <p className="text-muted text-xs leading-relaxed">
                {pos.turn === userColor
                  ? 'Your move — play a line and see how the field responds.'
                  : 'Sampling the crowd’s reply…'}
              </p>
            )}
            {line.length > 0 && (
              <p className="text-fg font-mono text-xs leading-relaxed">
                {line
                  .map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san))
                  .join(' ')}
              </p>
            )}
            <Button variant={phase === 'ended' ? 'primary' : 'secondary'} size="sm" className="self-start" onClick={analyse}>
              <Compass className="size-3.5" />
              Analyse this line
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
