import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Grid3x3 } from 'lucide-react';
import { cloneElement, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { loadCellNet, classifyBoardNet } from '@/puzzles/ocr/cellnet';
import { readDiagramsOnPage, renderPdfPage } from '@/puzzles/ocr/pdfPage';
import { useAnalysis } from '@/store/analysis';

import { loadDiagrams, saveDiagrams, type PageDiagramRecord } from './data';

/**
 * The diagrams printed on the page being read, as things you can tap.
 *
 * A chess book is diagrams with prose between them, and the reader sits
 * beside a board for exactly one reason: to play through what the page
 * shows. So every diagram the importer's own detector finds on the page
 * gets a small board button in its corner, and the button sets that
 * position up on the analysis board.
 *
 * Where the positions come from: a book linked to a puzzle book already
 * has its puzzles read, with the side to move (`known`); anything else is
 * read here, one page at a time, with the same detector and CellNet the
 * importer uses (ocr/pdfPage.ts), and remembered on the server so a page
 * is read once per vault. A diagram alone does not say who is to move, so
 * a read-here position asks — two entries, not a guess.
 */

/** Placement as a key, to match a known position to a detected box. */
const overlaps = (a: PageDiagramRecord['rect'], b: PageDiagramRecord['rect']): boolean => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter > 0.5 * Math.min(a.w * a.h, b.w * b.h);
};

const pause = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * The diagrams on the pages being shown, from the server's cache when it
 * has them and read off the page when it does not. Reading happens after
 * a page is on screen — the scroller says which pages are rendered — one
 * page at a time, and is dropped, not awaited, when the page scrolls
 * away. Returns a lookup: null for a page not yet read.
 */
export function usePageDiagrams(
  id: string,
  doc: PDFDocumentProxy | null,
  shown: number[],
): (page: number) => PageDiagramRecord[] | null {
  const cache = useRef<Map<number, PageDiagramRecord[]> | null>(null);
  const [version, bump] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // The cache, once per book.
  useEffect(() => {
    let live = true;
    cache.current = null;
    setLoadedFor(null);
    void loadDiagrams(id).then((pages) => {
      if (!live) return;
      const map = new Map<number, PageDiagramRecord[]>();
      for (const [k, v] of Object.entries(pages)) map.set(Number(k), v);
      cache.current = map;
      setLoadedFor(id);
    });
    return () => {
      live = false;
    };
  }, [id]);

  // The first shown page the cache has no answer for, read now; the next
  // one when this one lands (`version` moves and the effect runs again).
  const shownKey = shown.join(',');
  useEffect(() => {
    const map = cache.current;
    if (!doc || loadedFor !== id || !map) return;
    const pageNo = shown.find((n) => !map.has(n));
    if (pageNo === undefined) return;
    let live = true;
    // Only once the scroll has settled: reading a page is a render at
    // detection size and CellNet on the main thread, and doing it for
    // every page that flashes past is what made scrolling wait.
    const timer = setTimeout(() => void (async () => {
      try {
        const net = await loadCellNet();
        if (!live) return;
        const { canvas } = await renderPdfPage(doc, pageNo);
        if (!live) return;
        const found = await readDiagramsOnPage(
          canvas,
          async (board) => (net ? classifyBoardNet(net, board) : null),
          [],
          pause,
        );
        if (!live) return;
        const records: PageDiagramRecord[] = found.map((d) => ({
          rect: {
            x: d.rect.x / canvas.width,
            y: d.rect.y / canvas.height,
            w: d.rect.w / canvas.width,
            h: d.rect.h / canvas.height,
          },
          // A read with many doubtful cells is not a position worth
          // offering; the box is still recorded so the page is not re-read.
          fen: d.fen && d.uncertain <= 4 ? d.fen : null,
        }));
        map.set(pageNo, records);
        saveDiagrams(id, pageNo, records);
        bump((n) => n + 1);
      } catch {
        // A page that will not read is a page without hotspots.
      }
    })(), 600);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // shownKey stands in for the array's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, id, shownKey, loadedFor, version]);

  const map = cache.current;
  return (page: number) => map?.get(page) ?? null;
}

/**
 * A box given in fractions of the unrotated page, turned with the page.
 * Clockwise: the page's right edge becomes its bottom, so x comes from the
 * old y measured up from the bottom.
 */
export function rotateRect(
  r: PageDiagramRecord['rect'],
  rotation: 0 | 90 | 180 | 270,
): PageDiagramRecord['rect'] {
  switch (rotation) {
    case 90:
      return { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
    case 180:
      return { x: 1 - r.x - r.w, y: 1 - r.y - r.h, w: r.w, h: r.h };
    case 270:
      return { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
    default:
      return r;
  }
}

/**
 * Search hits on a page, as translucent boxes over the words. The box
 * being shown is stronger than the rest.
 */
export function SearchHighlights({
  rects,
  currentIndex,
  rotation = 0,
}: {
  rects: PageDiagramRecord['rect'][][];
  /** Which hit (by index in `rects`) is the one being shown, or -1. */
  currentIndex: number;
  rotation?: 0 | 90 | 180 | 270;
}) {
  return (
    <>
      {rects.map((hit, i) =>
        hit.map((r0, j) => {
          const r = rotateRect(r0, rotation);
          return (
            <span
              key={`${i}-${j}`}
              className={cn(
                'pointer-events-none absolute rounded-sm',
                i === currentIndex ? 'bg-warn/55 ring-1 ring-warn' : 'bg-warn/25',
              )}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
              }}
            />
          );
        }),
      )}
    </>
  );
}

/** A known position on a page: where it is, and its full FEN. */
export interface KnownDiagram {
  rect: PageDiagramRecord['rect'];
  fen: string;
}

/**
 * The hotspot layer for one page. Sized by its parent to the page's box;
 * every button is placed in page fractions, so zoom costs nothing.
 */
export function DiagramHotspots({
  diagrams,
  known = [],
  rotation = 0,
  sheet = false,
  onSet,
  onEdit,
}: {
  /** What was read off this page; null while it is being read. */
  diagrams: PageDiagramRecord[] | null;
  /** Positions already known with their side to move (a puzzle book's). */
  known?: KnownDiagram[];
  /** How the page is turned; the boxes turn with it. */
  rotation?: 0 | 90 | 180 | 270;
  /** A phone: the chooser is the app's bottom sheet, not a popover. */
  sheet?: boolean;
  /** Called after a position lands on the board. */
  onSet?: () => void;
  /** Open the position in the editor instead — for a diagram the reader
      misread, or one to adjust before playing. */
  onEdit?: (fen: string) => void;
}) {
  const loadFen = useAnalysis((s) => s.loadFen);
  const set = (fen: string): void => {
    if (loadFen(fen)) onSet?.();
  };
  // Every known position is offered; a detected box that matches one is
  // folded into it (the puzzle's side to move wins), the rest ask.
  const spots: { key: string; rect: PageDiagramRecord['rect']; fen: string; sure: boolean }[] = [];
  known.forEach((k, i) => spots.push({ key: `k${i}`, rect: k.rect, fen: k.fen, sure: true }));
  (diagrams ?? []).forEach((d, i) => {
    if (!d.fen) return;
    if (known.some((k) => overlaps(k.rect, d.rect))) return;
    spots.push({ key: `d${i}`, rect: d.rect, fen: d.fen, sure: false });
  });
  if (spots.length === 0) return null;
  return (
    <>
      {spots.map((s0) => {
        const s = { ...s0, rect: rotateRect(s0.rect, rotation) };
        // Just outside the board, off its right edge, top edges aligned:
        // nothing of the diagram is covered, and the button reads as the
        // board's own handle rather than a sticker on it.
        const style = {
          left: `calc(${(s.rect.x + s.rect.w) * 100}% + 0.25rem)`,
          top: `${s.rect.y * 100}%`,
        };
        const button = (
          <Button
            variant="secondary"
            size="icon-sm"
            className={cn('absolute shadow-md', 'pointer-coarse:size-9')}
            style={style}
            title={t('Set up this position')}
          >
            <Grid3x3 className="size-3.5" />
          </Button>
        );
        // Every tap asks who is to move — a diagram alone does not say, and
        // even a position a puzzle book knows is worth a glance: its side
        // is listed first and marked, one tap away.
        return (
          <SideToMovePopover
            key={s.key}
            fen={s.fen}
            suggested={s.sure ? (s.fen.split(' ')[1] === 'b' ? 'b' : 'w') : null}
            sheet={sheet}
            onSet={set}
            onEdit={onEdit}
          >
            {button}
          </SideToMovePopover>
        );
      })}
    </>
  );
}

/**
 * "White to move / Black to move" under a hotspot whose diagram did not
 * say. Closes itself on the answer: a chooser that stays open over the
 * page it just acted on looks like it did nothing.
 */
function SideToMovePopover({
  fen,
  suggested,
  sheet = false,
  onSet,
  onEdit,
  children,
}: {
  fen: string;
  /** The side a puzzle book gave this position, when it did: listed
      first and marked; choosing it keeps the book's whole FEN. */
  suggested: 'w' | 'b' | null;
  /** A phone: a bottom sheet rather than a popover off the button. */
  sheet?: boolean;
  onSet: (fen: string) => void;
  onEdit?: (fen: string) => void;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const placement = fen.split(' ')[0] ?? fen;
  const choose = (side: 'w' | 'b'): void => {
    setOpen(false);
    onSet(side === suggested ? fen : `${placement} ${side} - - 0 1`);
  };
  const sides: ('w' | 'b')[] = suggested === 'b' ? ['b', 'w'] : ['w', 'b'];
  const choices = (
    <>
      {sides.map((side) => (
        <Button
          key={side}
          variant="ghost"
          size={sheet ? 'lg' : 'sm'}
          className="justify-start"
          onClick={() => choose(side)}
        >
          {side === 'w' ? t('White to move') : t('Black to move')}
          {side === suggested && (
            <span className="text-muted-foreground">{t('(as in the book)')}</span>
          )}
        </Button>
      ))}
      {onEdit && (
        <Button
          variant="ghost"
          size={sheet ? 'lg' : 'sm'}
          className="justify-start"
          onClick={() => {
            setOpen(false);
            onEdit(`${placement} w - - 0 1`);
          }}
        >
          {t('Edit position…')}
        </Button>
      )}
    </>
  );
  if (sheet) {
    return (
      <>
        {cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
          onClick: () => setOpen(true),
        })}
        {open && (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
          >
            <DialogContent size="sm" title={t('Who is to move?')} icon={Grid3x3}>
              <div className="flex flex-col gap-1">{choices}</div>
            </DialogContent>
          </Dialog>
        )}
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto flex-col gap-1 p-1.5">
        {choices}
      </PopoverContent>
    </Popover>
  );
}
