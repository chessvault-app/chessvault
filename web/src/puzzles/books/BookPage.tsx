import {
  ChevronLeft,
  FileUp,
  ScanSearch,
  Loader2,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { SkeletonTiles, useSlowLoad } from '@/components/skeletons';
import { navigate } from '@/lib/router';

import { Button } from '@/components/ui/button';
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
import {
  type BookDetail,
  type BookDraft,
  bookTemplates,
  diagramUrl,
  forgetBook,
  loadBook,
} from './data';
import { PuzzleList } from './PuzzleList';
import { PuzzleEntry } from './PuzzleEntry';

// ---------------------------------------------------------------------------
// Book page: numbered grid coloured by result, entry flow

export function BookPage({ slug }: { slug: string }) {
  const [book, setBook] = useState<BookDetail | null>(null);
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
      <div className="grid h-full place-items-center">
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

  const solvedCount = book
    ? book.puzzles.filter((p) => book.progress[p.id]?.last === 'win').length
    : 0;

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
              <h1
                onDoubleClick={() => {
                  setTitleDraft(book?.title ?? slug);
                  setRenaming(true);
                }}
                title={t('Double-click to rename')}
                className="text-foreground min-w-0 flex-1 truncate text-xl font-semibold tracking-tight"
              >
                {book?.title ?? slug}
              </h1>
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
              {rereading ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
              <span className="hidden wide:inline">{t('Read diagrams')}</span>
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

        {importing && (
          <Suspense fallback={null}>
        <PdfImport
            slug={slug}
            templates={templates}
            existing={(book?.puzzles.length ?? 0) + (book?.drafts?.length ?? 0)}
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
          // the RENDER after it. Forty-eight is the guess for the fetch
          // itself, which is the only part that happens blind.
          detailPending ? <SkeletonTiles tiles={Math.min(book?.puzzles.length ?? 48, 48)} /> : null
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
                solvedCount={solvedCount}
                onDraft={(d) => setDraft(d)}
              />
            )}
          </>
        ) : book.puzzles.length === 0 && (book.drafts?.length ?? 0) === 0 ? (
          <div className="bg-card rounded-xl ring-1 ring-foreground/10 p-6 text-center">
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
              {t('Hand over the book’s PDF and the reader takes the diagrams and the printed solutions off its pages — it can be paused, and it picks up where it left off. Or set a position up by hand, recording the full solution, both sides’ moves.')}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button variant="default" size="sm" onClick={() => setImporting(true)}>
                <FileUp className="size-3.5" />
                {t('Import a book PDF')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" />
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
            solvedCount={solvedCount}
            onDraft={(d) => setDraft(d)}
          />
        )}
    </PageShell>
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
          ? 'border-primary/40 bg-primary-soft/40 hover:bg-primary-soft/60'
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
          <Loader2 className="size-4 shrink-0 animate-spin" />
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
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', live ? 'bg-primary' : 'bg-warn')}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-subtle mt-3 text-sm">
        {live ? t('Press to watch it, or to pause.') : t('Press to carry on from page {page}.', { page: page + 1 })}
      </p>
    </button>
  );
}
