import { ChevronLeft, Check, Eye, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseUci, roleToChar } from 'chessops/util';
import type { Color } from 'chessops/types';
import { moveSquares } from '@shared/tree';
import { BOARD_MAX_W } from '@/board/boardSize';
import { publishBoardHeight } from '@/board/boardBlock';
import { Board } from '@/board/Board';
import { BoardLane, EvalBarSlot } from '@/engine/EvalBar';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { usePromotion } from '@/board/usePromotion';
import { EditorView } from '@/editor/EditorView';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

import { navigate } from '@/lib/router';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { CardFooter } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

import { Panel, PanelHeader } from '@/components/panel';
import { BOARD_SCROLL_SHELL, BOARD_WIDE_COLUMN, BOARD_WIDE_SIDE } from '@/components/layout';
import { SideDot } from '@/components/side-dot';

import {
  harvestTemplates,
} from '../ocr/classify';
import { featuresFromImage, loadImage } from '../ocr/browser';

import { PaneTabs } from '@/components/pane-tabs';
import { SkeletonBoard, useSlowLoad } from '@/components/skeletons';

import { evaluateWhitePov, releaseAdjudicator } from '@/engine/adjudicate';

import { formatScore } from '@/engine/uci';
import { t } from '@/lib/i18n';
import {
  type BookDetail,
  type BookDraft,
  type BookPuzzle,
  bookTemplates,
  forgetBook,
  loadBook,
  loadSolutions,
  usePuzzleEvidence,
} from './data';
import { useWideLayout } from '@/lib/media';
import { SourceCrop, SourcePane, SolutionsView, hasSolutions } from './evidence';
import { useElementWidth } from '@/hooks/use-element-width';

/** Load the puzzle, then reuse the standard entry flow to replace it. */
export function PuzzleCorrector({ slug, puzzleId }: { slug: string; puzzleId: string }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  useEffect(() => {
    void loadBook(slug).then(setBook);
  }, [slug]);
  const puzzle = book?.puzzles.find((p) => p.id === puzzleId);
  const pending = useSlowLoad(!book);
  if (!book) {
    // The correction screen is a board beside its panel, like the trainer
    // it corrects; the wait takes that shape rather than a spinner.
    return <div className="h-full">{pending && <SkeletonBoard />}</div>;
  }
  if (!puzzle) {
    return <div className="text-muted-foreground optical-center h-full text-base">{t('Puzzle not found.')}</div>;
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
        await api(`/api/puzzlebooks/${encodeURIComponent(slug)}/ocr`, {
          method: 'PUT',
          json: { templates: next },
        });
      } catch {
        // learning is best-effort
      }
    })();
    // The confirmed position becomes what the editor reopens on, so
    // Cancel in the recorder steps BACK to it rather than throwing the
    // corrections away and starting from the stored one again.
    setPrefill(confirmed);
    setFen(confirmed);
  };

  const finish = (): void => {
    // The saved puzzle replaces its draft.
    if (draft) {
      forgetBook(slug);
      // Best-effort cleanup: the saved puzzle already exists, so a draft
      // that refuses to die must not hold the flow hostage.
      void api(`/api/puzzlebooks/${encodeURIComponent(slug)}/drafts/${draft.id}`, {
        method: 'DELETE',
      })
        .catch(() => {})
        .finally(onDone);
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
        useLabel={t('Record solution')}
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
      {/* The book reader's header, which is the workbench standard: the
          app's PageHeader on the shell's insets at wide, chevron included;
          the compact leaf row on a phone. Image import lives in the
          editor's own Position panel, not up here. */}
      {wide ? (
        <div className="flex shrink-0 items-center px-4 pt-4 md:px-6 md:pt-6">
          <PageHeader
            className="min-w-0 flex-1"
            title={`${t(replace ? 'Fix' : 'Add')} #${number}`}
            back={onCancel}
            backVisible="always"
            truncate
          />
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2 px-3 pt-3">
          <Button variant="ghost" size="icon-sm" title={t('Back to the book')} onClick={onCancel}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <h1 className="text-foreground min-w-0 flex-1 truncate text-base font-semibold">
            {t(replace ? 'Fix' : 'Add')} <span className="font-mono">#{number}</span>
          </h1>
        </div>
      )}
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
            <aside className="border-border flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r p-4">
              <img src={draft.imageUrl} alt={t('book diagram')} className="border-border rounded-md border" />
              <p className="text-muted-foreground text-sm leading-relaxed">
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
                ...(evidence && hasSolutions(evidence)
                  ? [{ id: 'solutions' as const, label: 'Solutions' }]
                  : []),
              ]}
              value={stackedView}
              onChange={setStackedView}
            />
          )}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {/* The board stays MOUNTED behind the other tabs rather than
                being swapped out for them. It carries the work — the
                position being set up in the editor, or the solution being
                recorded — and unmounting it threw that away: stepping over
                to the diagram and back handed the editor its prefill again
                and the edits were gone (phones only; the wide layout has
                always kept both on screen). */}
            <div className={cn('h-full', stackedView !== 'board' && 'hidden')}>
              {boardContent}
            </div>
            {stackedView === 'diagram' ? (
              <div ref={stackedPane} className="p-4">
                {evidence?.page && stackedPaneW > 0 ? (
                  <SourceCrop
                    slug={slug}
                    page={evidence.page}
                    rect={evidence.rect}
                    width={stackedPaneW - 32}
                  />
                ) : draft ? (
                  <img src={draft.imageUrl} alt={t('book diagram')} className="border-border w-full rounded-md border" />
                ) : null}
              </div>
            ) : stackedView === 'solutions' && evidence && hasSolutions(evidence) ? (
              <div ref={stackedPane} className="p-4">
                {stackedPaneW > 0 && (
                  <SolutionsView slug={slug} evidence={evidence} width={stackedPaneW - 32} />
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
  // The shared gate (board/usePromotion); the chosen piece finishes the
  // UCI that play() records.
  const promotion = usePromotion((orig, dest, role) => play(orig + dest + roleToChar(role)));
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
    if (promotion.maybeStart(currentFen, turn, orig, dest)) return;
    play(orig + dest);
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
    <div className={BOARD_SCROLL_SHELL}>
      <div className={BOARD_WIDE_COLUMN}>
        <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <div className="hidden w-full items-end wide:flex wide:h-10" />
          {/* The eval bar's width, held open on a board that never draws
              one. This board has no analysis board to hand over to, but it
              is the same board as the trainer's — a book puzzle is solved
              on one page and recorded on the other — and 20px of eval bar
              is what tells the two apart if only one of them reserves it. */}
          <div className="flex w-full items-stretch gap-2">
            <EvalBarSlot />
            <div className="relative min-w-0 flex-1">
              <Board
                fen={currentFen}
                // White at the bottom, whoever is to move: this board sits
                // beside the book's own scan and must match it — see the
                // note on the trainer's orientation, which changed with it.
                orientation="white"
                dests={dests}
                lastMove={line.at(-1) ? moveSquares(line.at(-1)!) : undefined}
                check={pos.isCheck()}
                onMove={onMove}
              />
              {promotion.pending && (
                <PromotionPicker
                  color={promotion.pending.color}
                  dest={promotion.pending.dest}
                  orientation="white"
                  onSelect={promotion.complete}
                  onCancel={promotion.cancel}
                />
              )}
            </div>
          </div>
          {/* Under the BOARD, not under the column: the dot says whose move
              the position is, so it belongs on the a-file rather than out
              in the bar's lane. */}
          <BoardLane>
            <div className="board-box flex h-6 items-center gap-2 text-sm">
              <SideDot side={turn} />
              <span className="text-muted-foreground">
                {t('Play the solution — every move, both sides.')}
              </span>
            </div>
          </BoardLane>
        </div>
      </div>

      <div className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 ${BOARD_WIDE_SIDE}`}>
        {/* Keeps this column's first panel level with the board's top edge:
            h-9 plus the column's gap-3 equals the board's h-10 strip plus
            its gap-2, the same sum every other board page uses. The header
            row used to occupy this space, and taking it away dropped the
            board 48px below the panel beside it. */}
        <div className="hidden h-9 shrink-0 wide:block" />
        <Panel className="min-h-[10rem] shrink-0">
          {/* No undo in the header (lanph3re's call): one icon up there,
              for a thing Start over on the footer already does, was a
              second control for the line outside the row that holds the
              others. */}
          <PanelHeader title={`Solution · ${line.length} plies`} />
          {/* What the panel is for, in the panel rather than in a header
              above it: a title bar with a back arrow made this read as its
              own page, which it is not — it is one step of the entry that
              the board beside it belongs to. */}
          <p className="text-muted-foreground px-3 pt-2.5 text-sm">
            {t('Record the solution — every move, both sides.')}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 px-(--card-spacing) text-base">
            {line.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("No moves yet. The first move you play is the puzzle's first move to find.")}
              </p>
            ) : (
              line.map((m, i) => {
                // Defender plies (the side NOT to move in the diagram) can
                // be marked "any move" — the ~ books use.
                const isDefender = i % 2 === 1;
                return (
                  <span key={i} className="font-moves flex items-baseline gap-0.5 text-sm">
                    {i % 2 === 0 ? (
                      <span className="text-muted-foreground">
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
                          'rounded-sm px-1 transition-colors duration-100',
                          wildcards.has(i)
                            ? 'bg-muted text-primary'
                            : 'hover:bg-accent',
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
            <p className="text-muted-foreground border-border border-t px-3 py-1.5 text-xs">
              {t('Tip: click an opponent move to mark it “any move” (the book’s ~).')}
            </p>
          )}

          {/* Verify's verdicts and a failed save, in the panel they are
              about, above its footer. */}
          {verdicts && (
            <div className="border-border border-t px-3 py-2 text-sm">
              {verdicts.map((note, i) => (
                <p key={i} className={note.startsWith('Engine agrees') ? 'text-good' : 'text-warn'}>
                  {note}
                </p>
              ))}
            </div>
          )}
          {error && <p className="text-destructive border-border border-t px-3 py-2 text-sm">{error}</p>}

          {/* The panel's footer (shadcn's CardFooter), not a loose row under
              it: the four verbs all act on the line in this panel, and a row
              floating between the panel and the phone's tab bar read as the
              page's, not the panel's. Primary last, and Cancel beside it —
              the same order every button row in the app uses (PromptDialog
              is the reference). Start over and Verify come first because
              they act on the line; the last two are the ways out of it. */}
          <CardFooter className="mt-auto flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={line.length === 0}
              onClick={() => {
                setLine([]);
                setWildcards(new Set());
                setVerdicts(null);
              }}
            >
              <RotateCcw className="size-3.5" data-icon="inline-start" />
              {t('Start over')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={line.length === 0 || verifying}
              title={t('Ask Stockfish whether every solver move really wins')}
              onClick={() => void verify()}
            >
              {verifying ? <Spinner className="size-3.5" data-icon="inline-start" /> : <Eye className="size-3.5" data-icon="inline-start" />}
              {t('Verify')}
            </Button>
            {/* What the back chevron in the removed header used to do. */}
            <Button variant="secondary" size="sm" onClick={onBack}>
              {t('Cancel')}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={line.length === 0 || saving}
              onClick={() => void save()}
            >
              {saving ? <Spinner className="size-3.5" data-icon="inline-start" /> : <Check className="size-3.5" data-icon="inline-start" />}
              {t('Save puzzle')}
            </Button>
          </CardFooter>
        </Panel>
      </div>
    </div>
  );
}
