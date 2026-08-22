import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Grid3x3 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
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
 * The diagrams on `pageNo`, from the server's cache when it has them and
 * read off the page when it does not. Reading happens after the page is
 * on screen (the caller mounts this once the page has rendered) and is
 * dropped, not awaited, when the page turns.
 */
export function usePageDiagrams(
  id: string,
  doc: PDFDocumentProxy | null,
  pageNo: number,
): PageDiagramRecord[] | null {
  const cache = useRef<Map<number, PageDiagramRecord[]> | null>(null);
  const [, bump] = useState(0);
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

  // The page, read when the cache has no answer for it.
  useEffect(() => {
    const map = cache.current;
    if (!doc || loadedFor !== id || !map || map.has(pageNo)) return;
    let live = true;
    void (async () => {
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
    })();
    return () => {
      live = false;
    };
  }, [doc, id, pageNo, loadedFor]);

  return cache.current?.get(pageNo) ?? null;
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
  onSet,
}: {
  /** What was read off this page; null while it is being read. */
  diagrams: PageDiagramRecord[] | null;
  /** Positions already known with their side to move (a puzzle book's). */
  known?: KnownDiagram[];
  /** Called after a position lands on the board. */
  onSet?: () => void;
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
      {spots.map((s) => {
        const style = {
          left: `calc(${(s.rect.x + s.rect.w) * 100}% - 1.75rem)`,
          top: `calc(${s.rect.y * 100}% + 0.25rem)`,
        };
        const button = (
          <Button
            variant="secondary"
            size="icon-sm"
            className={cn('absolute shadow-md', 'pointer-coarse:size-9')}
            style={style}
            title={t('Set up this position')}
            onClick={s.sure ? () => set(s.fen) : undefined}
          >
            <Grid3x3 className="size-3.5" />
          </Button>
        );
        if (s.sure) return <span key={s.key}>{button}</span>;
        return (
          <SideToMovePopover key={s.key} fen={s.fen} onSet={set}>
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
  onSet,
  children,
}: {
  fen: string;
  onSet: (fen: string) => void;
  children: React.ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const placement = fen.split(' ')[0] ?? fen;
  const choose = (side: 'w' | 'b'): void => {
    setOpen(false);
    onSet(`${placement} ${side} - - 0 1`);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto flex-col gap-1 p-1.5">
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => choose('w')}>
          {t('White to move')}
        </Button>
        <Button variant="ghost" size="sm" className="justify-start" onClick={() => choose('b')}>
          {t('Black to move')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
