import { BookText, ChevronLeft, ChevronRight, CircleStop, FileUp, History, Repeat, RotateCw, ScanSearch, Plus, RotateCcw } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { SkeletonTiles, useSlowLoad } from '@/components/skeletons';
import { navigate } from '@/lib/router';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PageShell } from '@/components/page-shell';

import { ClearableInput } from '@/components/text-fields';

import { Suspense, lazy } from 'react';

const PdfImport = lazy(() => import('../PdfImport').then((m) => ({ default: m.PdfImport })));
import { useImportJob } from '../importJob';
import { listCheckpoints, type CheckpointSummary } from '../importCheckpoint';
import {
  classifyBoard,
  labelsToFen,
  type Template,
} from '../ocr/classify';
import { boardFromImage, featuresFromImage, loadImage } from '../ocr/browser';
import { classifyBoardNet, loadCellNet } from '../ocr/cellnet';

import { isUntitled, t } from '@/lib/i18n';
import { formatAgo } from '@/lib/dates';
import { Panel, PanelHeader } from '@/components/panel';
import {
  type BookDetail,
  type BookDraft,
  type CycleWindow,
  bookTemplates,
  cyclePass,
  diagramUrl,
  dueBookPuzzles,
  forgetBook,
  loadBook,
  nextInCycle,
  openCycle,
  patchCycles,
} from './data';
import { PuzzleList } from './PuzzleList';
import { PuzzleEntry } from './PuzzleEntry';
import { TitleTip } from '@/components/title-tip';

// ---------------------------------------------------------------------------
// Book page: numbered grid coloured by result, entry flow

/** This book's shape last visit, per slug — see `reservedBook` below. */
const bookShapeKey = (slug: string): string => `vault:book-shape:${slug}`;

/**
 * The stored shape as a shape: a whole tile count clamped to the grid
 * guess's own 48 (the cap is the fold, not a data fact), and whether a
 * pass was open. Unreadable reads as null: nothing was learned, and the
 * blind 48-tile guess stands as it always has.
 */
function parseBookShape(
  raw: string | null,
): { tiles: number; open: boolean; nudge: boolean } | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof stored !== 'object' || stored === null) return null;
  const value = stored as { tiles?: unknown; open?: unknown; nudge?: unknown };
  if (typeof value.tiles !== 'number' || !Number.isInteger(value.tiles) || value.tiles < 0)
    return null;
  return { tiles: Math.min(value.tiles, 48), open: value.open === true, nudge: value.nudge === true };
}

/**
 * What the cold Cycles panel says — the invitation, and for someone
 * already solving outside any pass, the nudge that no pass is scoring
 * them (nothing else on the page says so). One function because the
 * panel's placeholder lays the same words out invisibly to reserve
 * exactly their height; two copies of the strings would wrap apart.
 */
function cyclesProse(nudge: boolean): string {
  const invite = t('Work the whole book in passes. Every puzzle once per cycle, scored by first attempts, and each pass should come out faster and cleaner.');
  return nudge ? `${invite} ${t('You are solving already. A cycle gives each pass its own score.')}` : invite;
}

export function BookPage({ slug }: { slug: string }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  // What this device reserves for THIS book while the fetch is blind:
  // its own tile count and its cycles panel's state, from last visit —
  // a paint hint on home's bargain. A book seen empty reserves nothing
  // (its settle is the empty-book card), and a book never seen keeps
  // the 48-tile guess.
  const [reservedBook] = useState(() => parseBookShape(localStorage.getItem(bookShapeKey(slug))));
  // Remembered for the NEXT visit's reservation, above.
  useEffect(() => {
    if (book === null) return;
    localStorage.setItem(
      bookShapeKey(slug),
      JSON.stringify({
        tiles: book.puzzles.length,
        open: Boolean(openCycle(book)),
        nudge: Object.keys(book.progress).length > 0,
      }),
    );
  }, [book, slug]);
  /**
   * The wait on a big book is not the fetch, it is the render.
   *
   * Measured on the 5,334-puzzle book: the API answers in 48 ms and the
   * grid is on screen at 964 ms — React spends 916 ms building 5,222
   * tiles, and the page is frozen and blank for all of it. A skeleton
   * keyed on "has the data arrived" is therefore gone before the wait
   * even starts, which is exactly backwards.
   *
   * So the grid is held back one frame: the skeleton paints first, and
   * only then does React begin the expensive part, with the skeleton
   * still on screen while it works.
   */
  const [gridReady, setGridReady] = useState(false);
  useEffect(() => {
    if (book === null) {
      setGridReady(false);
      return;
    }
    // Nothing to defer when there is nothing to build. A book with no
    // puzzles is the one you have just created from the shelf's Add
    // button, and it was answering with a frame of forty-eight grey
    // tiles — a skeleton of a grid that does not exist and is not coming.
    if (book.puzzles.length === 0 && (book.drafts?.length ?? 0) === 0) {
      setGridReady(true);
      return;
    }
    let live = true;
    const go = (): void => {
      if (live) setGridReady(true);
    };
    // A frame to let the skeleton paint — but backgrounded tabs never get
    // one, and a page that stays skeletal until you look at it would be a
    // worse bug than the one this fixes. So a timer races the frame.
    const frame = requestAnimationFrame(() => requestAnimationFrame(go));
    const timer = setTimeout(go, 60);
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [book]);
  // Shown while the data is in flight AND while the grid is being built.
  const detailPending = useSlowLoad(book === null) || (book !== null && !gridReady);
  const [adding, setAdding] = useState(false);
  const [missing, setMissing] = useState(false);
  const [importing, setImporting] = useState(false);
  const importJob = useImportJob();
  const [templates, setTemplates] = useState<Template[]>([]);
  // This book's unfinished scan, if it has one. Re-read whenever the job
  // stops or starts: those are the moments one appears or disappears.
  const [halted, setHalted] = useState<CheckpointSummary | null>(null);
  const importStatus = importJob.status;
  useEffect(() => {
    void listCheckpoints().then((all) => setHalted(all.find((c) => c.slug === slug) ?? null));
  }, [slug, importStatus]);
  const [draft, setDraft] = useState<BookDraft | null>(null);
  const [rereading, setRereading] = useState(false);

  useEffect(() => {
    void bookTemplates(slug).then(setTemplates);
  }, [slug, adding, draft]);

  /** Re-run recognition on every stored draft with the current font. */
  const rereadDrafts = async (): Promise<void> => {
    if (!book?.drafts?.length) return;
    setRereading(true);
    try {
      const current = await bookTemplates(slug);
      const net = await loadCellNet();
      const updates: { id: string; fen: string | null }[] = [];
      for (const d of book.drafts) {
        const img = await loadImage(diagramUrl(slug, d.image));
        const cells = net
          ? classifyBoardNet(net, boardFromImage(img))
          : classifyBoard(featuresFromImage(img), current);
        updates.push({
          id: d.id,
          fen: labelsToFen(
            cells.map((c) => c.label),
            false,
          ),
        });
      }
      forgetBook(slug);
      // A refused save is swallowed: the reload below redraws the drafts
      // as the server actually holds them, which says what happened.
      await api(`/api/puzzlebooks/${encodeURIComponent(slug)}/drafts`, {
        method: 'PUT',
        json: { updates },
      }).catch(() => {});
      await load();
    } finally {
      setRereading(false);
    }
  };

  // The shelf page always re-reads: it is where imports, re-reads and
  // deletes land, and it is entered rarely.
  const load = useCallback(async () => {
    const detail = await loadBook(slug, true);
    if (!detail) {
      setMissing(true);
      return;
    }
    setBook(detail);
  }, [slug]);
  useEffect(() => void load(), [load]);

  // Renaming edits the title and only the title. The slug is an id: the
  // folder, the URL, the bookmark and the saved scan are all filed under
  // it and none of them are names, so none of them hear about this.
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  // Still worn by the placeholder name. The rename BUTTON that used to
  // read this is gone; what is left of it is the importer's offer to name
  // the book after the PDF, which only stands while nobody has named it.
  const untitled = book !== null && isUntitled(book.title, 'Untitled book');
  const rename = async (title: string): Promise<void> => {
    const next = title.trim();
    if (!next || next === book?.title) return;
    try {
      await api(`/api/puzzlebooks/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        json: { title: next },
      });
      forgetBook(slug);
      await load();
    } catch {
      // The header keeps the old title, which is what the server kept.
    }
  };

  const resetProgress = async (): Promise<void> => {
    // The reload redraws whatever the server actually holds, so a failed
    // delete simply shows the progress still standing.
    await api(`/api/puzzlebooks/${encodeURIComponent(slug)}/progress`, {
      method: 'DELETE',
    }).catch(() => {});
    forgetBook(slug);
    void load();
  };

  if (missing) {
    return (
      <div className="optical-center h-full">
        <p className="text-muted-foreground text-base">{t('That book does not exist.')}</p>
      </div>
    );
  }

  if (adding || draft) {
    return (
      <PuzzleEntry
        slug={slug}
        number={(book?.puzzles.length ?? 0) + 1}
        draft={draft ? { ...draft, imageUrl: diagramUrl(slug, draft.image) } : undefined}
        onDone={() => {
          setAdding(false);
          setDraft(null);
          void load();
        }}
        onCancel={() => {
          setAdding(false);
          setDraft(null);
        }}
      />
    );
  }

  // The review queue's head, and how long the queue is — the dashboard's
  // own button, worn by the book it belongs to.
  const dueIds = book ? dueBookPuzzles(book) : [];

  /**
   * An unfinished import of THIS book.
   *
   * The shelf says so; the book itself said nothing, which is the worse
   * place to be silent — this is the page someone opens wondering why it
   * holds a hundred puzzles when the book has nine hundred.
   */
  const stopped = halted;
  const jobHere = importJob.slug === slug && importJob.status !== 'idle';
  const scanRunning =
    jobHere && (importJob.status === 'scanning' || importJob.status === 'reading');
  /**
   * The running job outranks the checkpoint summary.
   *
   * `halted` is re-read when the status changes, and pausing changes the
   * status BEFORE the loop finishes the page it is on — so the summary
   * read on that transition is a page behind by the time the loop stops
   * and writes. The resume itself always reads the checkpoint fresh, so
   * this only ever affected the number on screen, but a panel that says
   * "carry on from 77" while the dialog says it stopped at 77 is the kind
   * of disagreement that makes someone distrust both.
   */
  const scan =
    scanRunning || stopped
      ? {
          page: jobHere ? importJob.page : stopped!.page,
          pages: jobHere ? importJob.pages : stopped!.pages,
          found: jobHere ? importJob.found.length : stopped!.diagrams,
        }
      : null;

  return (
    // `block`: this page spaces its sections with their own margins, not
    // the shell's column gap.
    <PageShell width="medium" className="block">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('All books')}
            onClick={() => navigate('puzzles', 'books')}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          {renaming ? (
            <ClearableInput
              autoFocus
              inputSize="sm"
              aria-label={t('Rename this book')}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => {
                setRenaming(false);
                void rename(titleDraft);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
              className="min-w-0 flex-1"
              inputClassName="text-xl font-semibold tracking-tight"
            />
          ) : (
            <>
              <TitleTip title={t('Double-click to rename')}>
                <h1
                  onDoubleClick={() => {
                    setTitleDraft(book?.title ?? '');
                    setRenaming(true);
                  }}
                  className="text-foreground min-w-0 flex-1 truncate text-xl font-semibold tracking-tight"
                >
                  {/* The slug is an id, not a name: while the title is in
                      flight the header holds its place instead of flashing
                      the folder name. */}
                  {book?.title ?? ' '}
                </h1>
              </TitleTip>
            </>
          )}
          {/* No progress chip here. A scan used to announce itself in this
              row AND in a banner above it — two spinners, one of them a
              cryptic "p.67/241 · 299" — while the panel below sat empty
              claiming there was nothing in the book. Progress belongs in
              that panel: it is the largest thing on the page, it is doing
              nothing during a scan, and it is where the result appears. */}
          {/* Stacked headers drop the button labels — five labelled
              controls in a phone-width row read as clutter. */}
          {(book?.drafts?.length ?? 0) > 0 && templates.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              disabled={rereading}
              title={t('Re-run recognition on every draft with the learned font')}
              onClick={() => void rereadDrafts()}
            >
              {rereading ? <Spinner className="size-3.5" /> : <ScanSearch className="size-3.5" />}
              <span className="hidden wide:inline">{t('Read diagrams')}</span>
            </Button>
          )}
          {/* The PDF this book was read from, when the library still has
              it: reading is the library's job, so this only goes there. */}
          {book?.pdfBook && (
            <Button
              variant="secondary"
              size="sm"
              title={t('Read the book')}
              onClick={() => navigate('books', book.pdfBook!)}
            >
              <BookText className="size-3.5" />
              <span className="hidden wide:inline">{t('Read')}</span>
            </Button>
          )}
          <Button variant="secondary" size="sm" title={t('Import a book PDF')} onClick={() => setImporting(true)}>
            <FileUp className="size-3.5" />
            <span className="hidden wide:inline">{t('Import PDF')}</span>
          </Button>
          <Button variant="default" size="sm" title={t('Add a puzzle')} onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            <span className="hidden wide:inline">{t('Add puzzle')}</span>
          </Button>
          <ConfirmDialog
            icon={RotateCcw}
            triggerTone="danger"
            triggerTitle="Reset all progress in this book"
            question="Reset all progress in this book?"
            confirmLabel="Reset"
            onConfirm={() => void resetProgress()}
          />
        </div>

        {dueIds.length > 0 && (
          <Button
            variant="secondary"
            size="default"
            className="mb-4 w-full justify-center"
            onClick={() => navigate('puzzles', 'books', slug, dueIds[0]!)}
          >
            <History className="size-3.5" data-icon="inline-start" />
            {t('Review puzzles · {n} due', { n: dueIds.length })}
          </Button>
        )}

        {book && book.puzzles.length > 0 && (
          <CyclesPanel
            book={book}
            slug={slug}
            onCycles={(cycles) => {
              // The cache first, so the trainer opened next agrees; the
              // state besides, so this page redraws without a refetch.
              const next = patchCycles(slug, cycles);
              setBook(next ?? { ...book, cycles });
            }}
          />
        )}

        {importing && (
          <Suspense fallback={null}>
        <PdfImport
            slug={slug}
            title={book?.title ?? ''}
            templates={templates}
            existing={(book?.puzzles.length ?? 0) + (book?.drafts?.length ?? 0)}
            pdfBook={book?.pdfBook ?? null}
            onDone={() => {
              setImporting(false);
              void load();
            }}
            onClose={() => setImporting(false)}
            // Only while the default name is still on: a chosen title is
            // the reader's own answer and outranks the filename.
            onSuggestName={untitled ? (name) => void rename(name) : undefined}
          />
        </Suspense>
        )}

        {book === null || !gridReady ? (
          // As many tiles as the book actually has, once that is known:
          // the count arrives with the data, and the wait this covers is
          // the RENDER after it. The fetch itself is blind, and there
          // the reservation is what this device stored about THIS book
          // last visit — tile count, and whether its Cycles panel was
          // mid-pass (a single status line) or cold (three lines of
          // prose). A book seen empty reserves nothing, because its
          // settle is the empty-book card, and 48 invented tiles over a
          // Cycles panel it will never draw was the jump the other way.
          // Only a book this device has never opened keeps the blind
          // 48-tile guess.
          detailPending ? (
            book !== null ? (
              <SkeletonTiles
                cycles={book.puzzles.length > 0}
                cyclesOpen={Boolean(openCycle(book))}
                cyclesProse={cyclesProse(Object.keys(book.progress).length > 0)}
                tiles={Math.min(book.puzzles.length, 48)}
              />
            ) : reservedBook === null ? (
              <SkeletonTiles cycles cyclesProse={cyclesProse(false)} tiles={48} />
            ) : reservedBook.tiles > 0 ? (
              <SkeletonTiles
                cycles
                cyclesOpen={reservedBook.open}
                cyclesProse={cyclesProse(reservedBook.nudge)}
                tiles={reservedBook.tiles}
              />
            ) : null
          ) : null
        ) : scan ? (
          // The scan owns the panel while it runs. On an empty book it
          // stands alone — the "nothing in this book yet" copy was a lie
          // told over a scan that had already found three hundred
          // diagrams — and on a book being re-read it sits above what is
          // already there.
          <>
            <ScanPanel
              phase={
                !scanRunning ? 'stopped' : importJob.status === 'reading' ? 'reading' : 'scanning'
              }
              page={scan.page}
              pages={scan.pages}
              found={scan.found}
              onOpen={() => setImporting(true)}
            />
            {(book.puzzles.length > 0 || (book.drafts?.length ?? 0) > 0) && (
              <PuzzleList
                slug={slug}
                puzzles={book.puzzles}
                drafts={book.drafts ?? []}
                progress={book.progress}
                cycle={openCycle(book)}
                onDraft={(d) => setDraft(d)}
              />
            )}
          </>
        ) : book.puzzles.length === 0 && (book.drafts?.length ?? 0) === 0 ? (
          <div className="bg-card rounded-xl ring-1 ring-border p-6 text-center">
            {/*
              The import goes FIRST. An empty book used to name only "Add
              puzzle" — the by-hand route — which reads as though a book
              is filled a position at a time, and says nothing about the
              feature books exist for: handing over the PDF and letting
              the reader take the diagrams and the printed answers off its
              pages. Both are offered here rather than described, because
              this is the page where you would do either.
            */}
            <p className="text-foreground text-base font-medium">{t('Nothing in this book yet.')}</p>
            <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm leading-relaxed">
              {t('Import the book’s PDF and the reader takes the diagrams and printed solutions off its pages, pausing and resuming as you like. Or set a position up by hand and record the full solution.')}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button variant="default" size="sm" onClick={() => setImporting(true)}>
                <FileUp className="size-3.5" data-icon="inline-start" />
                {t('Import a book PDF')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" data-icon="inline-start" />
                {t('Add puzzle')}
              </Button>
            </div>
          </div>
        ) : (
          <PuzzleList
            slug={slug}
            puzzles={book.puzzles}
            drafts={book.drafts ?? []}
            progress={book.progress}
            cycle={openCycle(book)}
            onDraft={(d) => setDraft(d)}
          />
        )}
    </PageShell>
  );
}

/**
 * Woodpecker passes: the whole book in cycles, every puzzle once per
 * pass, scored by first attempts.
 *
 * The panel is thin on purpose: a pass's numbers are all derived
 * (data.ts, from the histories inside the window), so this only shows
 * them and offers the three acts the server knows — start, continue,
 * stop. A running pass completes itself on the attempt that reaches the
 * last puzzle; there is no "finish" button because there is nothing for
 * one to decide.
 */
function CyclesPanel({
  book,
  slug,
  onCycles,
}: {
  book: BookDetail;
  slug: string;
  onCycles: (cycles: CycleWindow[]) => void;
}) {
  const open = openCycle(book);
  const cycles = book.cycles ?? [];
  const act = async (method: 'POST' | 'DELETE'): Promise<void> => {
    // A refused call changes nothing on screen, which is what the server
    // kept — the same quiet treatment every book action here gets.
    try {
      const body = await api<{ cycles: CycleWindow[] }>(
        `/api/puzzlebooks/${encodeURIComponent(slug)}/cycles`,
        { method },
      );
      onCycles(body.cycles);
    } catch {
      /* the panel keeps showing what the server still holds */
    }
  };

  // Passes with something in them, numbered in the order they were run.
  // Untouched windows are dropped from the record on the server now, but
  // records written before that carry them still, and six rows of "0/0 ·
  // just now" made the panel a ledger of nothing — a pass nobody
  // attempted is not listed and not counted.
  const passes = cycles
    .map((cycle) => ({ cycle, ...cyclePass(book, cycle) }))
    .filter(({ cycle, attempted }) => cycle.finishedAt === undefined || attempted > 0)
    .map((pass, i) => ({ ...pass, n: i + 1 }));
  const finished = passes.filter(({ cycle }) => cycle.finishedAt !== undefined).reverse();
  const openN = passes.find(({ cycle }) => cycle.finishedAt === undefined)?.n ?? passes.length;
  const openPass = open ? { ...cyclePass(book, open), next: nextInCycle(book, open) } : null;
  const total = book.puzzles.length;
  // Past passes fold away: the open pass is the only live information,
  // and on a phone the history rows plus a footer band pushed the puzzle
  // grid — the thing the page is FOR — below the fold.
  const [showPast, setShowPast] = useState(false);

  return (
    <Panel className="mb-4">
      {/* The acts live on the header row, the way the editor's column
          keeps Load beside its name: one or two small buttons do not
          earn a whole footer band, and the band was a third of a phone
          screen spent before the grid began. Stop wears CircleStop — the
          bare Square at ghost weight read as an unchecked checkbox. */}
      <PanelHeader
        title={t('Cycles')}
        actions={
          open ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => void act('DELETE')}>
                <CircleStop className="size-3.5" data-icon="inline-start" />
                {t('Stop')}
              </Button>
              {openPass?.next && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => navigate('puzzles', 'books', slug, openPass.next!)}
                >
                  <RotateCw className="size-3.5" data-icon="inline-start" />
                  {t('Continue')}
                </Button>
              )}
            </>
          ) : (
            // The filled default, not secondary: with no pass open this
            // is the panel's ONE act, and the invitation to keep the
            // rotation going should look like one.
            <Button variant="default" size="sm" onClick={() => void act('POST')}>
              <Repeat className="size-3.5" data-icon="inline-start" />
              {t(passes.length > 0 ? 'Start the next cycle' : 'Start a cycle')}
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-2 px-(--card-spacing)">
        {!open && finished.length === 0 && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {cyclesProse(Object.keys(book.progress).length > 0)}
          </p>
        )}
        {/* One grammar for every pass, open or done: attempts against
            the book, wins named beside them. The old rows mixed
            attempted/total with wins/attempted in one column of
            same-shaped fractions. */}
        {open && openPass && (
          <>
            {/* Numbers only — the bar for these numbers is the grid's
                own, directly below, which reads through the open pass's
                window while one runs. Two bars a rem apart showing the
                same fraction was the redundancy lanph3re flagged. */}
            <p className="flex items-baseline gap-3 text-sm">
              <span className="text-foreground font-medium">{t('Cycle {n}', { n: openN })}</span>
              <span className="text-muted-foreground tabular-nums">
                {openPass.attempted}/{total} · {t('{n} solved', { n: openPass.wins })}
              </span>
            </p>
          </>
        )}
        {finished.length > 0 && (
          <>
            <button
              type="button"
              aria-expanded={showPast}
              onClick={() => setShowPast((v) => !v)}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 self-start text-sm"
            >
              <ChevronRight
                className={cn('size-3.5 transition-transform', showPast && 'rotate-90')}
              />
              {t('{n} past cycles', { n: finished.length })}
            </button>
            {showPast && (
              // The hairline marks where the live pass ends and the
              // record begins (lanph3re's ask).
              <div className="border-border grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-1.5 border-t pt-2 text-sm">
                {finished.map(({ cycle, n, attempted, wins }) => (
                  <Fragment key={cycle.startedAt}>
                    <span className="text-muted-foreground">{t('Cycle {n}', { n })}</span>
                    <span className="text-foreground tabular-nums">
                      {attempted}/{total} · {t('{n} solved', { n: wins })}
                    </span>
                    <span className="text-muted-foreground text-right tabular-nums">
                      {formatAgo(cycle.finishedAt!)}
                    </span>
                  </Fragment>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * A scan, shown where the scan's results will be.
 *
 * This is the ONLY place a book page reports an import. There were two —
 * a strip above the title and a chip inside it — spinning the same
 * spinner at each other, one of them abbreviated to "p.67/241 · 299",
 * while the panel underneath said the book was empty. Progress is not a
 * decoration to tuck into a header; on this page it is the content, so
 * it takes the panel, and the panel is a button because every state of it
 * leads to the same dialog: watch, pause, or carry on.
 */
function ScanPanel({
  phase,
  page,
  pages,
  found,
  onOpen,
}: {
  phase: 'scanning' | 'reading' | 'stopped';
  page: number;
  pages: number;
  found: number;
  onOpen: () => void;
}) {
  const live = phase !== 'stopped';
  // The solutions half has no page counter of its own — the pages are all
  // read by then — so it holds the bar full rather than dropping it.
  const pct = phase === 'reading' ? 100 : pages > 0 ? Math.min(100, (page / pages) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'mb-3 block w-full rounded-xl border p-6 text-center transition-colors duration-100',
        live
          ? 'border-primary/40 bg-muted/40 hover:bg-muted/60'
          : 'border-warn/40 bg-warn/5 hover:bg-warn/10',
      )}
    >
      <p
        className={cn(
          'flex items-center justify-center gap-2 text-base font-medium',
          live ? 'text-primary' : 'text-warn',
        )}
      >
        {live ? (
          <Spinner className="size-4 shrink-0" />
        ) : (
          <FileUp className="size-4 shrink-0" />
        )}
        {phase === 'reading'
          ? t('Working out the printed solutions')
          : phase === 'scanning'
            ? t('Reading the book')
            : t('Import unfinished')}
      </p>
      <p className="text-muted-foreground mt-1 text-sm">
        {phase === 'reading'
          ? t('{found} diagrams read', { found })
          : t('page {page} of {pages} · {found} diagrams', {
              page,
              pages: pages || '…',
              found,
            })}
      </p>
      <div className="bg-border mx-auto mt-3 h-1 max-w-xs overflow-hidden rounded-full">
        {/* Scaled from the left rather than a width transition: the
            fill animates on the compositor instead of relaying out the
            page on every progress tick. */}
        <div
          className={cn('h-full origin-left rounded-full transition-transform duration-300', live ? 'bg-primary' : 'bg-warn')}
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
      <p className="text-muted-foreground mt-3 text-sm">
        {live ? t('Press to watch it, or to pause.') : t('Press to carry on from page {page}.', { page: page + 1 })}
      </p>
    </button>
  );
}
