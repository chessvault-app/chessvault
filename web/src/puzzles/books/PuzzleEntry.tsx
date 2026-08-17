import {
  ChevronLeft,
  Check,
  Eye,
  Loader2,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseSquare, parseUci, squareRank } from 'chessops/util';
import type { Color, Role } from 'chessops/types';
import { moveSquares } from '@shared/tree';
import { BOARD_MAX_W } from '@/board/boardSize';
import { Board } from '@/board/Board';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { EditorView } from '@/editor/EditorView';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';

import { navigate } from '@/lib/router';

import { Button } from '@/ui/Button';

import { Panel, PanelHeader } from '@/ui/Panel';
import { BOARD_WIDE_SHELL, BOARD_WIDE_SIDE } from '@/ui/layout';
import { SideDot } from '@/ui/SideDot';

import {
  harvestTemplates,
} from '../ocr/classify';
import { featuresFromImage, loadImage } from '../ocr/browser';

import { PaneTabs } from '@/ui/PaneTabs';

import { evaluateWhitePov, releaseAdjudicator } from '@/engine/adjudicate';

import { formatScore } from '@/engine/uci';
import { t } from '@/lib/i18n';
import {
  type BookDetail,
  type BookDraft,
  type BookPuzzle,
  bookTemplates,
  diagramUrl,
  forgetBook,
  loadBook,
  loadSolutions,
  usePuzzleEvidence,
} from './data';
import { useWideLayout } from './layout';
import { SourceCrop, SourcePane, ZoomablePage, useElementWidth } from './evidence';

/** Load the puzzle, then reuse the standard entry flow to replace it. */
export function PuzzleCorrector({ slug, puzzleId }: { slug: string; puzzleId: string }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  useEffect(() => {
    void loadBook(slug).then(setBook);
  }, [slug]);
  const puzzle = book?.puzzles.find((p) => p.id === puzzleId);
  if (!book) {
    return (
      <div className="text-subtle grid h-full place-items-center">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!puzzle) {
    return <div className="text-muted grid h-full place-items-center text-sm">{t('Puzzle not found.')}</div>;
  }
  return (
    <PuzzleEntry
      slug={slug}
      number={puzzle.number ?? book.puzzles.indexOf(puzzle) + 1}
      replace={puzzle}
      onDone={() => navigate('puzzles', 'books', slug, puzzle.id)}
      onCancel={() => navigate('puzzles', 'books', slug, puzzle.id)}
    />
  );
}

// ---------------------------------------------------------------------------
// Entry: position via the embedded editor, then record the solution

export function PuzzleEntry({
  slug,
  number,
  draft,
  replace,
  onDone,
  onCancel,
}: {
  slug: string;
  number: number;
  /** Entering an imported diagram: shown for eyeballing, deleted on save. */
  draft?: { id: string; imageUrl: string; fen: string | null; evidence?: BookDraft['evidence'] };
  /** Correcting an existing puzzle: prefilled, replaced in place on save. */
  replace?: BookPuzzle;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fen, setFen] = useState<string | null>(null);
  // The position being corrected is not part of the book list any more, so
  // it arrives with the solutions rather than with the puzzle. Re-keying the
  // editor on it is what makes it land.
  const [prefill, setPrefill] = useState<string | null>(draft?.fen ?? null);
  const replaceFenId = replace?.id;
  useEffect(() => {
    if (!replaceFenId) return;
    let live = true;
    void loadSolutions(slug).then((all) => {
      const fen = all[replaceFenId]?.fen;
      if (live && fen) setPrefill(fen);
    });
    return () => {
      live = false;
    };
  }, [slug, replaceFenId]);
  const wide = useWideLayout();
  const [stackedView, setStackedView] = useState<'board' | 'diagram' | 'solutions'>('board');
  // The evidence views span the ACTUAL pane width (measured), not a guess.
  const [stackedPane, stackedPaneW] = useElementWidth();
  // The wide row is measured so the scan pane can be capped against it:
  // the editor beside it must keep room to work in whatever window this
  // opens on, not whatever window the pane was dragged out on.
  const [wideRow, wideRowW] = useElementWidth();

  const confirmPosition = (confirmed: string): void => {
    // Fire-and-forget: template learning must never block puzzle entry.
    void (async () => {
      try {
        if (!draft) return;
        // A draft confirmation teaches the font from its stored crop.
        const img = await loadImage(draft.imageUrl);
        const source = { features: featuresFromImage(img), blackAtBottom: false };
        const existing = await bookTemplates(slug);
        const next = harvestTemplates(
          source.features,
          confirmed,
          source.blackAtBottom,
          existing,
        );
        await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/ocr`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templates: next }),
        });
      } catch {
        // learning is best-effort
      }
    })();
    setFen(confirmed);
  };

  const finish = (): void => {
    // The saved puzzle replaces its draft.
    if (draft) {
      forgetBook(slug);
      void fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/drafts/${draft.id}`, {
        method: 'DELETE',
      }).finally(onDone);
    } else {
      onDone();
    }
  };

  // ONE persistent layout for both phases — the evidence pane and header
  // stay put while the right side swaps editor <-> recorder (seamless).
  //
  // A puzzle's evidence is NOT part of the book download — it is the
  // heaviest thing a book carries and only ever wanted here — so it is
  // fetched when a puzzle is opened. Drafts still carry theirs inline;
  // there are few enough of them for it not to matter.
  const fetched = usePuzzleEvidence(slug, replace?.id);
  const evidence = replace?.evidence ?? fetched ?? draft?.evidence;
  const boardContent =
    fen === null ? (
      <EditorView
        key={prefill ?? 'blank'}
        initialFen={prefill ?? undefined}
        useLabel="Record solution"
        onUse={confirmPosition}
      />
    ) : (
      <SolutionRecorder
        slug={slug}
        fen={fen}
        replaceId={replace?.id}
        onBack={() => setFen(null)}
        onDone={finish}
      />
    );
  return (
    // Capped and centred like every other page: the scan pane at its
    // default width plus the editor at its own 76rem ceiling is ~96rem,
    // so up to there nothing moves — beyond it the workbench stops
    // spreading across the window while the rest of the app stays put.
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col">
      {/* Same borderless header as everywhere else; image import lives in
          the editor's own Position panel, not up here. */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Button variant="ghost" size="icon-sm" title={t('Back to the book')} onClick={onCancel}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
          {t(replace ? 'Fix' : 'Add')} <span className="font-mono">#{number}</span>
        </h1>
      </div>
      {wide ? (
        <div ref={wideRow} className="flex min-h-0 flex-1">
          {evidence?.page ? (
            <SourcePane
              slug={slug}
              evidence={evidence}
              // 40rem is a workable wide editor (board + its side column).
              maxWidth={wideRowW > 0 ? Math.max(280, wideRowW - 640) : undefined}
            />
          ) : draft ? (
            <aside className="border-line flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r p-4">
              <img src={draft.imageUrl} alt={t('book diagram')} className="border-line rounded-md border" />
              <p className="text-subtle text-xs leading-relaxed">
                {t('The diagram from the book — make the board match it, then record the solution.')}
              </p>
            </aside>
          ) : null}
          <div className="min-h-0 min-w-0 flex-1">{boardContent}</div>
        </div>
      ) : (
        // Stacked (phone): one element at a time, the BOARD first — the
        // evidence views are one tap away instead of crowding it out.
        <div className="flex min-h-0 flex-1 flex-col">
          {(evidence?.page || draft) && (
            <PaneTabs
              className="mx-4 mt-2"
              tabs={[
                { id: 'board' as const, label: 'Board' },
                { id: 'diagram' as const, label: 'Diagram' },
                ...(evidence?.solutionPage ? [{ id: 'solutions' as const, label: 'Solutions' }] : []),
              ]}
              value={stackedView}
              onChange={setStackedView}
            />
          )}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {stackedView === 'board' ? (
              boardContent
            ) : stackedView === 'diagram' ? (
              <div ref={stackedPane} className="p-4">
                {evidence?.page && stackedPaneW > 0 ? (
                  <SourceCrop
                    slug={slug}
                    page={evidence.page}
                    rect={evidence.rect}
                    width={stackedPaneW - 32}
                  />
                ) : draft ? (
                  <img src={draft.imageUrl} alt={t('book diagram')} className="border-line w-full rounded-md border" />
                ) : null}
              </div>
            ) : evidence?.solutionPage ? (
              <div ref={stackedPane} className="p-4">
                {stackedPaneW > 0 && (
                  <ZoomablePage
                    src={diagramUrl(slug, evidence.solutionPage)}
                    alt={t('solutions page')}
                    width={stackedPaneW - 32}
                  />
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function SolutionRecorder({
  slug,
  fen,
  replaceId,
  onBack,
  onDone,
}: {
  slug: string;
  fen: string;
  /** When set, the save REPLACES this puzzle instead of appending. */
  replaceId?: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [line, setLine] = useState<{ uci: string; san: string; fen: string }[]>([]);
  const [wildcards, setWildcards] = useState<ReadonlySet<number>>(new Set());
  const [pendingPromotion, setPendingPromotion] = useState<{
    orig: string;
    dest: string;
    color: Color;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verdicts, setVerdicts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The proofread below runs one engine search per solver move, and
  // nothing else would stop it queueing the rest after this view is
  // gone — Stockfish kept grinding for nobody. Verify re-checks the flag
  // after every await, and the shared worker is freed on the way out
  // (it reboots lazily on the next verdict).
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
    releaseAdjudicator();
  }, []);

  const solverSide: Color = parseFen(fen).unwrap().turn;
  const currentFen = line.at(-1)?.fen ?? fen;
  const pos = Chess.fromSetup(parseFen(currentFen).unwrap()).unwrap();
  const dests = chessgroundDests(pos);
  const turn = pos.turn;

  const play = (uci: string): void => {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return;
    const san = makeSanAndPlay(pos, move);
    playSound(san.includes('x') ? 'capture' : 'move');
    setLine((prev) => [...prev, { uci, san, fen: makeFen(pos.toSetup()) }]);
    setVerdicts(null);
  };

  const onMove = (orig: string, dest: string): void => {
    const to = parseSquare(dest);
    const lastRank = turn === 'white' ? 7 : 0;
    const piece = to !== undefined ? pos.board.get(parseSquare(orig)!) : undefined;
    if (piece?.role === 'pawn' && to !== undefined && squareRank(to) === lastRank) {
      setPendingPromotion({ orig, dest, color: turn });
      return;
    }
    play(orig + dest);
  };

  const completePromotion = (role: Role): void => {
    if (!pendingPromotion) return;
    const letter = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n', king: '', pawn: '' }[role];
    play(pendingPromotion.orig + pendingPromotion.dest + letter);
    setPendingPromotion(null);
  };

  const undo = (): void => {
    setLine((prev) => prev.slice(0, -1));
    setWildcards((prev) => new Set([...prev].filter((i) => i < line.length - 1)));
    setVerdicts(null);
  };

  const toggleWildcard = (index: number): void => {
    setWildcards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  /**
   * Engine proofread (lanph3re's tier 3): every SOLVER move must keep the
   * position decisively won, and the final position must be decisive.
   * Catches transcription slips and the occasional book misprint.
   */
  const verify = async (): Promise<void> => {
    setVerifying(true);
    const notes: string[] = [];
    for (let i = 0; i < line.length; i++) {
      // Odd plies are the defender's replies — only the solver's moves are judged.
      if (i % 2 === 1) continue;
      const score = await evaluateWhitePov(line[i]!.fen);
      if (!alive.current) return;
      const pov = solverSide === 'white' ? 1 : -1;
      const cp = score.mate !== undefined ? (score.mate * pov > 0 ? 10000 : -10000) : (score.cp ?? 0) * pov;
      if (cp < 150) {
        notes.push(
          `After ${Math.floor(i / 2) + 1}. ${line[i]!.san} the engine sees only ${formatScore(score)} — check the transcription.`,
        );
      }
    }
    if (notes.length === 0) notes.push('Engine agrees: every solver move keeps a decisive advantage.');
    setVerdicts(notes);
    setVerifying(false);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    forgetBook(slug);
    try {
      // The finally matters: a thrown fetch used to leave `saving` true
      // for good — Save disabled, the entered solution unrecoverable.
      await api(`/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles`, {
        method: 'POST',
        json: {
          fen,
          uci: line.map((m) => m.uci),
          san: line.map((m) => m.san),
          wildcards: [...wildcards],
          ...(replaceId ? { replaceId } : {}),
        },
      });
      onDone();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto stacked:pb-8 stacked:pr-4 stacked:[scrollbar-gutter:stable_both-edges] ${BOARD_WIDE_SHELL}`}>
      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <div className="hidden w-full items-end wide:flex wide:h-10" />
          <div className="relative w-full">
            <Board
              fen={currentFen}
              orientation={solverSide}
              dests={dests}
              lastMove={line.at(-1) ? moveSquares(line.at(-1)!) : undefined}
              check={pos.isCheck()}
              onMove={onMove}
            />
            {pendingPromotion && (
              <PromotionPicker
                color={pendingPromotion.color}
                dest={pendingPromotion.dest}
                orientation={solverSide}
                onSelect={completePromotion}
                onCancel={() => setPendingPromotion(null)}
              />
            )}
          </div>
          <div className="flex h-6 w-full items-center gap-2 px-0.5 text-xs">
            <SideDot side={turn} />
            <span className="text-muted">{t('Play the solution — every move, both sides.')}</span>
          </div>
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 ${BOARD_WIDE_SIDE}`}>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" title={t('Back to the position')} onClick={onBack}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-muted min-w-0 flex-1 truncate text-sm">
            {t('Record the solution — every move, both sides.')}
          </span>
        </div>

        <Panel flush className="min-h-[10rem] shrink-0">
          <PanelHeader
            title={`Solution · ${line.length} plies`}
            actions={
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Undo the last move')}
                disabled={line.length === 0}
                onClick={undo}
              >
                <Undo2 className="size-3.5" />
              </Button>
            }
          />
          <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 p-3 text-sm">
            {line.length === 0 ? (
              <p className="text-subtle text-xs">
                {t("No moves yet. The first move you play is the puzzle's first move to find.")}
              </p>
            ) : (
              line.map((m, i) => {
                // Defender plies (the side NOT to move in the diagram) can
                // be marked "any move" — the ~ books use.
                const isDefender = i % 2 === 1;
                return (
                  <span key={i} className="flex items-baseline gap-0.5 font-mono text-[0.8125rem]">
                    {i % 2 === 0 ? (
                      <span className="text-subtle">
                        {Math.floor(i / 2) + 1}
                        {solverSide === 'black' && i === 0 ? '…' : '.'}
                      </span>
                    ) : null}
                    {isDefender ? (
                      <button
                        type="button"
                        onClick={() => toggleWildcard(i)}
                        title={t(
                          wildcards.has(i)
                            ? 'Any move accepted here (click to require this exact move)'
                            : 'Click to accept ANY move here (the book\u2019s K~)',
                        )}
                        className={cn(
                          'rounded px-1 transition-colors duration-100',
                          wildcards.has(i)
                            ? 'bg-primary-soft text-primary'
                            : 'hover:bg-surface-2',
                        )}
                      >
                        {wildcards.has(i) ? `${m.san.charAt(0)}~` : m.san}
                      </button>
                    ) : (
                      <span className="px-1">{m.san}</span>
                    )}
                  </span>
                );
              })
            )}
          </div>
          {line.length > 1 && (
            <p className="text-subtle border-line border-t px-3 py-1.5 text-[0.6875rem]">
              {t('Tip: click an opponent move to mark it “any move” (the book’s ~).')}
            </p>
          )}
        </Panel>

        {verdicts && (
          <div className="bg-surface border-line shrink-0 rounded-xl border p-3 text-xs">
            {verdicts.map((note, i) => (
              <p key={i} className={note.startsWith('Engine agrees') ? 'text-good' : 'text-warn'}>
                {note}
              </p>
            ))}
          </div>
        )}
        {error && <p className="text-bad text-xs">{error}</p>}

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={line.length === 0 || saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Save puzzle
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={line.length === 0 || verifying}
            title={t('Ask Stockfish whether every solver move really wins')}
            onClick={() => void verify()}
          >
            {verifying ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            Verify
          </Button>
          <Button variant="ghost" size="sm" disabled={line.length === 0} onClick={() => { setLine([]); setWildcards(new Set()); setVerdicts(null); }}>
            <RotateCcw className="size-3.5" />
            {t('Start over')}
          </Button>
        </div>
      </div>
    </div>
  );
}
