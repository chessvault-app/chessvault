import { Eye, FileUp, Loader2, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/media';
import { byExtension, useFileDrop } from '@/lib/fileDrop';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { Skeleton } from '@/ui/Skeleton';
import { useImportJob, type FoundDiagram } from './importJob';
import { clearCheckpoint, readCheckpoint } from './importCheckpoint';
import type { Template } from './ocr/classify';
import { t } from '@/lib/i18n';

/** How wide the hovered crop is drawn, in px. Big enough to read the
    pieces on a diagram; small enough to sit beside a window. */
const PEEK_W = 208;

/**
 * The hovered row's crop, floating beside the list.
 *
 * Placed by hand rather than by CSS. The list scrolls, so an absolute
 * child of a row would be clipped by it, and a sheet under drag is
 * transformed, which would capture `fixed` — so this goes on the body
 * and takes its coordinates from the row it belongs to. It sits to the
 * right of the row unless that would run off the window, in which case
 * it flips to the left rather than showing a sliver at the edge.
 *
 * `pointer-events-none`: it hangs over the list it was opened from, and
 * a preview that swallows the pointer would flicker the row it is
 * describing out from under itself.
 */
function PeekCrop({
  f,
  at,
}: {
  f: FoundDiagram;
  at: { top: number; left: number; right: number };
}) {
  const room = window.innerWidth - at.right - 12;
  const flip = room < PEEK_W + 16;
  // Lifted a little above the row so a crop taller than it is wide still
  // reads as belonging to it, then held inside the window.
  const top = Math.max(8, Math.min(at.top - 48, window.innerHeight - PEEK_W - 32));
  return createPortal(
    <div
      className={cn(
        'bg-surface border-line pointer-events-none fixed z-[60] rounded-xl border p-2',
        'shadow-[var(--shadow-pop)]',
      )}
      style={
        flip
          ? { top, right: window.innerWidth - at.left + 12 }
          : { top, left: at.right + 12 }
      }
    >
      <img
        src={f.dataUrl}
        alt={`page ${f.page}`}
        width={PEEK_W}
        decoding="async"
        // A crop is usually about square, but a two-column page can hand
        // over a tall one; height is capped so it cannot run off the
        // bottom of the window it is floating over.
        className="block max-h-[45vh] w-52 rounded object-contain"
      />
    </div>,
    document.body,
  );
}

/**
 * Whole-book import (lanph3re's original ask): pick the book's PDF, every
 * page is rendered and scanned for diagrams, and the crops land on the book
 * as DRAFTS — each waiting for its solution.
 *
 * The scan itself is a BACKGROUND JOB (importJob.ts): closing this dialog
 * or browsing elsewhere doesn't stop it, classification runs in a worker,
 * and the book page shows live progress with a way back here.
 */
export function PdfImport({
  slug,
  templates,
  existing,
  onDone,
  onClose,
}: {
  slug: string;
  templates: Template[];
  /** Puzzles and drafts already in the book — 0 means a first import. */
  existing: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const job = useImportJob();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Re-importing a book that already has content is a real choice, so it
  // is asked rather than assumed. Imported puzzles are keyed by their
  // printed number, so updating in place genuinely updates them.
  const [mode, setMode] = useState<'update' | 'rebuild'>('update');
  const [repair, setRepair] = useState(false);
  const [preparing, setPreparing] = useState(false);
  /**
   * An unfinished scan of THIS book, if there is one.
   *
   * `undefined` while it is being looked up, so the window does not
   * flash a file picker at someone whose answer is "carry on where you
   * left off". Cleared once the scan is running, because from then on
   * the live job is the thing to show.
   */
  const [saved, setSaved] = useState<
    { page: number; pages: number; diagrams: number } | null | undefined
  >(undefined);
  useEffect(() => {
    let cancelled = false;
    void readCheckpoint(slug).then((c) => {
      if (cancelled) return;
      setSaved(c ? { page: c.page, pages: c.pages, diagrams: c.results.length } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const begin = async (file: File): Promise<void> => {
    setSaveError(null);
    if (existing > 0 && mode === 'rebuild') {
      setPreparing(true);
      try {
        const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(`could not clear the book (${res.status})`);
      } catch (e) {
        setSaveError((e as Error).message);
        setPreparing(false);
        return;
      }
      setPreparing(false);
    }
    job.start(slug, file, templates, { repair });
  };

  // A book's PDF is the one file this window exists for, so the whole
  // choose-a-file box takes a drop as well as a click.
  // Which row is showing its scan. One at a time: the point is to check a
  // suspicious row, not to rebuild the wall of thumbnails.
  const [preview, setPreview] = useState<number | null>(null);
  /**
   * The row under a mouse, and where it is.
   *
   * A pointer that can hover gets the crop for free — a list of rows
   * reading "p.8", "p.8", "p.8" cannot be checked without opening each
   * one, and opening each one is three presses to answer "which board is
   * this". Touch keeps the eye: there is no hover to give it.
   *
   * Fixed to the viewport and portalled to the body, because the list
   * scrolls (an absolute child would be clipped by it) and the sheet is
   * transformed while it is dragged, which would turn `fixed` into fixed
   * inside the sheet.
   */
  const [peek, setPeek] = useState<{ i: number; top: number; left: number; right: number } | null>(
    null,
  );
  const hoverable = useMediaQuery('(pointer: fine)');

  const pdfDrop = useFileDrop({
    accept: byExtension('.pdf'),
    onFiles: ([file]) => void begin(file!),
  });
  const mine = job.slug === slug;
  const found = mine ? job.found : [];
  /**
   * Where each diagram sits on its own page: the nth of m.
   *
   * A page holds up to six of them, and every row for that page said the
   * same word. "p.8 (2/3)" is the middle board on page eight — enough to
   * find it in the book, and enough to tell the three rows apart without
   * opening any of them. Pages with a single diagram say nothing extra.
   */
  const place = useMemo(() => {
    const total = new Map<number, number>();
    for (const f of found) total.set(f.page, (total.get(f.page) ?? 0) + 1);
    const seen = new Map<number, number>();
    return found.map((f) => {
      const nth = (seen.get(f.page) ?? 0) + 1;
      seen.set(f.page, nth);
      return { nth, of: total.get(f.page) ?? 1 };
    });
  }, [found]);
  const scanning = mine && job.status === 'scanning';
  const paused = mine && job.status === 'paused';
  const reading = mine && job.status === 'reading';
  const solve = mine ? job.solve : null;

  /**
   * The list follows the board being read.
   *
   * The skeleton row is the live end of a scan — it is where the next
   * result appears — and it was below the fold within seven diagrams, so
   * a nine-hundred page book showed its first seven boards and then
   * nothing at all. The list is held at the bottom while it grows.
   *
   * `stuck` is what makes that bearable: scroll up to look at something
   * and the list stops chasing, because being yanked back to the bottom
   * mid-inspection is worse than not following at all. Scroll back down
   * to the end and it resumes.
   */
  const listRef = useRef<HTMLUListElement | null>(null);
  const stuck = useRef(true);
  const grown = found.length;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stuck.current) return;
    el.scrollTop = el.scrollHeight;
  }, [grown, scanning]);

  const save = async (): Promise<void> => {
    const chosen = found.filter((f) => f.selected);
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      // Chunked: hundreds of crops would make one giant request body.
      for (let at = 0; at < chosen.length; at += 20) {
        const chunk = chosen.slice(at, at + 20);
        const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/drafts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            // A draft is finished by hand from the printed page, so it
            // carries the same evidence a verified puzzle does: the page,
            // where on it the diagram sat, and the answers page for its
            // number. Without these the editor has no Diagram or
            // Solutions tab to read the answer off.
            drafts: chunk.map((f) => ({
              image: f.dataUrl,
              fen: f.fen,
              ...(f.number === undefined ? {} : { number: f.number }),
              evidence: {
                page: `page${String(f.page).padStart(3, '0')}.jpg`,
                ...(f.rect ? { rect: f.rect } : {}),
                ...(f.solutionPage ? { solutionPage: f.solutionPage } : {}),
              },
            })),
          }),
        });
        if (!res.ok) throw new Error(`save failed (${res.status})`);
      }
      job.clear();
      onDone();
    } catch (e) {
      setSaveError((e as Error).message);
      setSaving(false);
    }
  };

  const selectedCount = found.filter((f) => f.selected).length;

  // Not `full`. This window WAS a wall of thumbnails, which needed the
  // width; it is a list of one-line rows now, and at 4xl each row was a
  // label, an icon, and thirty empty characters before its verdict.
  return (
    <Modal title="Import a book PDF" icon={FileUp} onClose={onClose}>

        {/*
          An interrupted scan is offered back before anything else. It is
          the only thing on this window that is about work already done,
          and asking someone to find the PDF again — and wait through the
          pages they already waited through — to get back to where they
          were is the failure this exists to remove.
        */}
        {!mine && saved && (
          <div className="border-primary/40 bg-primary-soft flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-fg text-xs font-medium">
              {t('This book was being read when it stopped: {page} of {pages} pages, {n} diagrams so far.', {
                page: saved.page,
                pages: saved.pages,
                n: saved.diagrams,
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => job.resume(slug, templates, { repair })}
              >
                {t('Carry on from page {page}', { page: saved.page + 1 })}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void clearCheckpoint(slug);
                  setSaved(null);
                }}
              >
                {t('Start the book again')}
              </Button>
            </div>
          </div>
        )}

        {!mine && !saved && existing > 0 && (
          <div className="border-line bg-surface-2 flex flex-col gap-2 rounded-lg border p-3">
            <p className="text-fg text-xs font-medium">
              {t('This book already holds {n} puzzles. What should the import do with them?', {
                n: existing,
              })}
            </p>
            {(
              [
                ['update', 'Update in place', 'Re-reads the book and replaces each puzzle with what it finds. Anything the import misses this time is left as it is.'],
                ['rebuild', 'Clear and rebuild', 'Empties the book first, so it holds exactly what this import produces. Your attempt history is kept either way.'],
              ] as const
            ).map(([value, label, blurb]) => (
              <label key={value} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="reimport-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  {t(label)}
                  <span className="text-subtle block text-xs">{t(blurb)}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {!mine && (
          <label className="text-muted flex cursor-pointer items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={repair}
              onChange={(e) => setRepair(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {t('Try harder on boards that fail')}
              <span className="text-subtle block">
                {t(
                  'Re-reads each position whose printed solution would not replay, looking for a single misread square. On a 1,000-puzzle book this recovered about 26 more puzzles and took twenty minutes.',
                )}
              </span>
            </span>
          </label>
        )}

        {!mine && !saved && (
          <label
            {...pdfDrop.handlers}
            className={cn(
              'grid cursor-pointer place-items-center rounded-lg border border-dashed p-10 text-center',
              'transition-colors',
              pdfDrop.dragging
                ? 'border-primary bg-primary-soft'
                : 'border-line hover:border-line-strong hover:bg-surface-2',
            )}
          >
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void begin(file);
              }}
            />
            <span className="text-muted text-sm">
              {t('Choose the book’s PDF')}
            <span className="text-subtle block text-xs">
                {t('every page is scanned for diagrams; nothing leaves this machine — and you can keep using the app while it runs')}
              </span>
            </span>
          </label>
        )}

        {preparing && (
          <p className="text-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t('clearing the book')}
          </p>
        )}
        {scanning && (
          <div className="flex items-center gap-2">
            <p className="text-muted flex min-w-0 flex-1 items-center gap-2 text-sm">
              <Loader2 className="size-4 shrink-0 animate-spin" />
              <span className="truncate">
                {t('page {page}/{pages} — {n} diagrams so far', {
                  page: job.page,
                  pages: job.pages || '…',
                  n: found.length,
                })}
              </span>
            </p>
            {/* Stopping is safe: the page just finished is on disk, so this
                is the same state a crash would have left, and the same
                button brings it back. */}
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => job.pause()}>
              <Pause className="size-3.5" />
              {t('Pause')}
            </Button>
          </div>
        )}
        {paused && (
          <div className="border-warn/40 bg-warn/5 flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <p className="text-fg min-w-0 flex-1 text-xs">
              {t('Paused at page {page} of {pages}. Nothing is lost.', {
                page: job.page,
                pages: job.pages,
              })}
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => job.resume(slug, templates, { repair })}
            >
              <Play className="size-3.5" />
              {t('Carry on')}
            </Button>
          </div>
        )}
        {reading && (
          <p className="text-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("reading the book’s solutions")}
          </p>
        )}
        {solve && (
          <div
            className={cn(
              'rounded-lg border p-3 text-xs',
              solve.confident ? 'border-good/40 bg-good/5' : 'border-warn/40 bg-warn/5',
            )}
          >
            <p className="text-fg text-sm font-medium">
              {t('{n} puzzles imported with their solutions', { n: solve.solved })}
            </p>
            <p className="text-muted pt-1">
              {solve.confident
                ? t('Each one replays the move the book prints, from the position on the page.')
                : t(
                    'Too few solutions replayed for this to be trusted — treat these as a starting point and check them.',
                  )}
              {solve.repaired > 0 &&
                ` ${t('{n} had a square misread, found by the book’s own solution.', { n: solve.repaired })}`}
              {solve.unresolved > 0 &&
                ` ${t('{n} numbered diagrams had no solution we could read.', { n: solve.unresolved })}`}
            </p>
            <p className="text-subtle pt-1">
              {t('Answers found on {pages}.', {
                pages:
                  solve.answerRanges.length > 0
                    ? solve.answerRanges
                        .map(([a, b]) => (a === b ? `p.${a}` : `p.${a}–${b}`))
                        .join(', ')
                    : t('no page we could identify'),
              })}
            </p>
          </div>
        )}
        {mine && job.error && <p className="text-bad text-xs">{job.error}</p>}
        {saveError && <p className="text-bad text-xs">{saveError}</p>}

        {found.length > 0 && (
          <>
            <p className="text-subtle text-xs">
              {t('{n} diagrams found — untick any false positives, then add the rest as drafts.', {
                n: found.length,
              })}
              {found.every((f) => f.fen === null) &&
                ` ${t('Positions are unread for now: confirming the first draft teaches this book’s font.')}`}
            </p>
            {/*
              A LIST, not a wall of crops.
              Thumbnails at this size say only "something board-shaped was
              cut out here" — not whether it was read, or read correctly,
              which is the thing worth knowing while a book is being taken
              apart. So each row states what became of that diagram, and
              the crop is one press away for the rows where the answer
              looks wrong. It also stops a thousand-diagram scan holding a
              thousand decoded bitmaps: only an opened row decodes.
            */}
            <ul
              ref={listRef}
              className="border-line divide-line max-h-72 divide-y overflow-y-auto rounded-lg border"
              /*
                A peek pinned to where a row USED to be is worse than
                none, and this list moves on its own: each page that
                lands re-anchors the scroll. Dropping the peek on every
                scroll made it flicker away mid-scan — the one time
                someone is watching it — so it FOLLOWS its row instead,
                and is dropped only once that row has left the box.
              */
              onScroll={(e) => {
                const list = e.currentTarget;
                // Within a row's height of the end counts as "at the end":
                // the exact bottom is a moving target while the list grows
                // under the scroll.
                stuck.current = list.scrollHeight - list.scrollTop - list.clientHeight < 28;
                setPeek((p) => {
                  if (!p) return p;
                  const row = list.querySelector(`[data-row="${p.i}"]`);
                  if (!row) return null;
                  const r = row.getBoundingClientRect();
                  const box = list.getBoundingClientRect();
                  if (r.bottom < box.top + 4 || r.top > box.bottom - 4) return null;
                  return { i: p.i, top: r.top, left: r.left, right: r.right };
                });
              }}
            >
              {found.map((f, i) => {
                const mark = f.solved
                  ? { label: 'solved', cls: 'text-good' }
                  : f.fen === null
                    ? { label: 'unread', cls: 'text-subtle' }
                    : f.uncertain > 0
                      ? { label: t('{n} unsure', { n: f.uncertain }), cls: 'text-warn' }
                      : { label: 'read', cls: 'text-good' };
                return (
                  <li key={i} className="[content-visibility:auto]">
                    <div
                      data-row={i}
                      className={cn(
                        'flex items-center gap-2 py-1.5 pl-2 text-xs transition-colors duration-100',
                        // pr-4, not pr-2: the mark sat against the
                        // scrollbar, which on Windows is a solid gutter
                        // rather than an overlay, and "3개 불확실" read as
                        // though it were part of it.
                        'pr-4',
                        peek?.i === i && 'bg-surface-2',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={f.selected}
                        onChange={() => job.toggle(i)}
                        aria-label={t('Keep this diagram')}
                        className="accent-primary shrink-0"
                      />
                      <span className="w-24 shrink-0 font-mono text-[0.6875rem]">
                        <span className="text-fg">
                          {f.number === undefined ? `p.${f.page}` : `#${f.number}`}
                        </span>
                        {/* Once the printed numbers are worked out the row
                            leads with the number — but it keeps the page,
                            which is what you turn to in the actual book. */}
                        <span className="text-subtle">
                          {f.number === undefined
                            ? place[i]!.of > 1 && ` (${place[i]!.nth}/${place[i]!.of})`
                            : ` p.${f.page}`}
                        </span>
                      </span>
                      {/* The eye is the whole preview control: it opens
                          the crop on a press, and — for a pointer that
                          can hover — shows it on the way past. Hovering
                          the ROW fired it while the pointer was merely
                          crossing the list to reach something else. */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        active={preview === i}
                        title={t('Show the scan')}
                        onClick={() => setPreview(preview === i ? null : i)}
                        onMouseEnter={(e) => {
                          if (!hoverable) return;
                          const row = e.currentTarget.closest('[data-row]');
                          if (!row) return;
                          // The ROW's rect, not the button's: the crop
                          // belongs to the whole line, and the follow-on-
                          // scroll below re-reads the same element.
                          const r = row.getBoundingClientRect();
                          setPeek({ i, top: r.top, left: r.left, right: r.right });
                        }}
                        onMouseLeave={() => setPeek((p) => (p?.i === i ? null : p))}
                      >
                        <Eye className="size-3.5" />
                      </Button>
                      <span className={cn('ml-auto shrink-0 text-[0.6875rem]', mark.cls)}>
                        {t(mark.label)}
                      </span>
                    </div>
                    {preview === i && (
                      <div className="px-2 pb-2">
                        <img
                          src={f.dataUrl}
                          alt={`page ${f.page}`}
                          loading="lazy"
                          decoding="async"
                          className="border-line mx-auto w-44 rounded border"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
              {/* The board being read right now. Same row shape as the rest,
                  so the list does not jump when it turns into a real one. */}
              {scanning && (
                <li className="flex items-center gap-2 py-1.5 pl-2 pr-4">
                  <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                  <Skeleton className="h-3 w-24 shrink-0" />
                  <Skeleton className="size-5 shrink-0 rounded-md" />
                  <Skeleton className="ml-auto h-3 w-10 shrink-0" />
                </li>
              )}
            </ul>
            {/* The hovered row's crop, floating beside the list. */}
            {peek && found[peek.i] && <PeekCrop f={found[peek.i]!} at={peek} />}
          </>
        )}

        {/* The footer is NOT part of the results: it used to be, so a window
            that had not scanned anything yet — or was still scanning its
            first page — had no button at all, and no X either. Cancel is
            always here; Add appears once there is something to add. */}
        <div className="flex items-center justify-end gap-2">
          {found.length > 0 && (
            <span className="text-subtle mr-auto text-xs">
              {t('{n} selected', { n: selectedCount })}
              {scanning ? t(' — still scanning') : ''}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            title={scanning ? t('The scan keeps running') : undefined}
            onClick={onClose}
          >
            {t(scanning ? 'Hide' : 'Cancel')}
          </Button>
          {found.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              disabled={saving || scanning || selectedCount === 0}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {t('Add {n} as drafts', { n: selectedCount })}
            </Button>
          )}
        </div>
    </Modal>
  );
}
