import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Grid3x3, Pencil } from 'lucide-react';
import { useEffect, useState } from 'react';

import { fullFen, positionOf } from '@shared/bookEngine';

import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { KingIcon } from '@/components/king-icon';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAnalysis } from '@/store/analysis';

import { diagramsOf, loadDiagrams, type PageDiagramRecord } from './data';
import { useDiagramJob } from './diagramJob';

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
 *
 * And CellNet does not always win. A scan it cannot read returns a
 * placement that is no position at all — empty, or a king short — which
 * the board refuses; a whole book can come back that way. Those diagrams
 * still get their button, because the reader is sitting in front of the
 * printed one, but it opens the editor rather than offering a side to
 * move that would be thrown away. See `readable` below.
 */

/** Placement as a key, to match a known position to a detected box. */
const overlaps = (a: PageDiagramRecord['rect'], b: PageDiagramRecord['rect']): boolean => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter > 0.5 * Math.min(a.w * a.h, b.w * b.h);
};

/**
 * The diagrams of a book's pages, as read: from the shared memory
 * (books/data.ts), which the diagram job fills as it goes. A book opened
 * before its pass is through has the pass started — or carried on, since
 * pages already read are skipped — and this re-renders as each page
 * lands, so the buttons appear under the reader while it reads.
 */
export function usePageDiagrams(
  id: string,
  doc: PDFDocumentProxy | null,
): (page: number) => PageDiagramRecord[] | null {
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoadedFor(null);
    void loadDiagrams(id).then(() => {
      if (live) setLoadedFor(id);
    });
    return () => {
      live = false;
    };
  }, [id]);

  // Every page the job finishes is a re-render; that is all the
  // subscription is for — the pages themselves come from the memory.
  useDiagramJob((s) => (s.bookId === id && s.status === 'running' ? s.page : 0));

  useEffect(() => {
    if (!doc || loadedFor !== id) return;
    if (diagramsOf(id).size < doc.numPages) void useDiagramJob.getState().start(id);
  }, [doc, id, loadedFor]);

  const map = loadedFor === id ? diagramsOf(id) : null;
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

/**
 * Can this reading become a position at all?
 *
 * A board the classifier could not read comes back as a placement no
 * chess position accepts — most often empty, or with a king missing —
 * and `loadFen` refuses it. Nothing used to ask: the hotspot offered a
 * side to move, the answer was rejected, and the tap did nothing at all.
 * So the question is asked once, here, against the very strings the
 * chooser would build, and a reading that cannot take a side is not
 * offered one.
 */
function readable(fen: string): boolean {
  const placement = fen.split(' ')[0] ?? fen;
  const own = fen.split(' ')[1];
  return (['w', 'b'] as const).some(
    (side) => positionOf(side === own ? fen : fullFen(placement, side)) !== null,
  );
}

/** What a diagram the classifier could not read opens the editor on. */
const EMPTY_BOARD = '8/8/8/8/8/8/8/8 w - - 0 1';

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
  onSet,
  onEdit,
}: {
  /** What was read off this page; null while it is being read. */
  diagrams: PageDiagramRecord[] | null;
  /** Positions already known with their side to move (a puzzle book's). */
  known?: KnownDiagram[];
  /** How the page is turned; the boxes turn with it. */
  rotation?: 0 | 90 | 180 | 270;
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
  const spots: {
    key: string;
    rect: PageDiagramRecord['rect'];
    fen: string;
    sure: boolean;
    /** The reading is a position; false means only the editor is offered. */
    ok: boolean;
  }[] = [];
  known.forEach((k, i) =>
    spots.push({ key: `k${i}`, rect: k.rect, fen: k.fen, sure: true, ok: readable(k.fen) }),
  );
  (diagrams ?? []).forEach((d, i) => {
    if (known.some((k) => overlaps(k.rect, d.rect))) return;
    // A box with no position is a diagram the reader FOUND and could not
    // read — the detector is surer that something is printed there than
    // the classifier is about what. That is still worth a corner button:
    // an empty editor open beside the printed diagram is where someone
    // sets it up by hand, and it is the only offer the app can make for a
    // board it cannot read. Two of every five boxes on a faint scan land
    // here, so skipping them would take the button off most of the book.
    const fen = d.fen ?? EMPTY_BOARD;
    spots.push({ key: `d${i}`, rect: d.rect, fen, sure: false, ok: readable(fen) });
  });
  // A misread board is still worth a button while there is an editor to
  // send it to — the reader is looking at the printed diagram, and setting
  // it up by hand beside the page beats no button at all. With nowhere to
  // send it there is nothing to offer, so it keeps its corner clear.
  const shown = spots.filter((s) => s.ok || onEdit);
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((s0) => {
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
            // An outline button for a board that was not read: the reader
            // can see which diagrams the app has before tapping one.
            variant={s.ok ? 'secondary' : 'outline'}
            size="icon-sm"
            // pointer-events-auto: the overlay this sits in lets the pointer
            // through to the page's text (pdfViewer); the button takes it back.
            className={cn('pointer-events-auto absolute shadow-md', 'pointer-coarse:size-9')}
            style={style}
            title={s.ok ? t('Set up this position') : t('Edit position')}
          >
            <Grid3x3 className="size-3.5" />
          </Button>
        );
        // Every tap asks who is to move — a diagram alone does not say,
        // and what a puzzle book worked out for the side is not sure enough
        // to mark: White, Black, the same two choices for every diagram.
        return (
          <SideToMovePopover
            key={s.key}
            fen={s.fen}
            readable={s.ok}
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
 *
 * A board that was not read (`readable` false) offers the editor alone.
 * The two sides are dropped rather than shown and refused: the position
 * they would build is one `loadFen` rejects, and a choice that cannot be
 * taken is worse than no choice — it was, for a whole book of diagrams.
 */
function SideToMovePopover({
  fen,
  readable: ok = true,
  onSet,
  onEdit,
  children,
}: {
  /** The position; when the side chosen is the one it carries, the whole
      FEN is kept (a puzzle book's castling rights and the like). */
  fen: string;
  /** Whether the reading is a position. False offers only the editor —
      asking a side to move for a board no side can move on is the tap
      that used to do nothing. */
  readable?: boolean;
  onSet: (fen: string) => void;
  onEdit?: (fen: string) => void;
  children: React.ReactElement;
}) {
  const placement = fen.split(' ')[0] ?? fen;
  const choose = (side: 'w' | 'b'): void => {
    // fullFen, not a hand-built one: a diagram states no castling rights,
    // and a bare `-` here made O-O illegal for every line played from a
    // book position. The rest of the book pipeline infers them from the
    // untouched home squares, and the overlay now says the same thing.
    onSet(side === fen.split(' ')[1] ? fen : fullFen(placement, side));
  };
  // The app's one row menu (components/action-menu): a dropdown under the
  // button on a desktop, the bottom sheet on a phone. This used to be its
  // own Dialog of ghost buttons, which put a sheet of 14px rows beside
  // the game list's sheet of 16px rows (lanph3re's report): two sheets
  // on one phone, one component now.
  const actions: MenuAction[] = [
    ...(ok
      ? [
          { label: 'White to move', icon: WhiteKing, onSelect: () => choose('w') },
          { label: 'Black to move', icon: BlackKing, onSelect: () => choose('b') },
        ]
      : []),
    ...(onEdit
      ? [{ label: 'Edit position…', icon: Pencil, onSelect: () => onEdit(fullFen(placement, 'w')) }]
      : []),
  ];
  return (
    <ActionMenu title={ok ? 'Who is to move?' : 'Edit position'} actions={actions}>
      {children}
    </ActionMenu>
  );
}

// The kings as menu icons: the menu sizes and places the icon it is
// handed, so the side is bound here.
function WhiteKing({ className }: { className?: string }) {
  return <KingIcon side="white" className={className} />;
}
function BlackKing({ className }: { className?: string }) {
  return <KingIcon side="black" className={className} />;
}
