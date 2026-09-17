import { Folder as FolderIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Loading, NAME_WIDTHS } from './primitives';

/**
 * Separate bordered cards under a collection heading — what Studies and
 * Notes actually draw. They are not a divided list, and a skeleton shaped
 * like one made the page jump when the real cards arrived.
 */
export function SkeletonCards({
  cards = 5,
  layout = 'list',
  gridClassName = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3',
  groups,
  cover = true,
  className,
}: {
  cards?: number;
  /**
   * The shelf's grouped shape, where the caller stored one last visit
   * (components/shelf-reservation): root cards with nothing above them,
   * then one section per collection — its 24px header, and its cards or
   * the one-line "Empty collection." note. Without it the flat `cards`
   * stack is drawn, which is right only for a shelf nothing is known
   * about.
   */
  groups?: { root: number; folders: number[]; heights?: number[] };
  /**
   * Whether each card opens on a 64px board. Studies always do; a note
   * mostly does not (it has a 16px glyph where the board would be), and
   * a board-sized block over a glyph reads as the wrong shelf. Height
   * comes from `groups.heights` where the shelf measured it and from
   * the text lines otherwise, so this changes nothing about the size.
   */
  cover?: boolean;
  /**
   * The shelf's own arrangement, which it knows before the documents
   * arrive — it is a stored preference, not something the answer decides.
   *
   * It has to be here because the two are not the same card. A grid card
   * carries the document's first board at 64px and two lines of its
   * words; a list row carries neither. Drawn as a list either way, the
   * placeholder stood 52px against the grid card's 109 and in one column
   * against two or three, so a grid shelf rearranged completely as it
   * landed.
   */
  layout?: 'grid' | 'list';
  /** The grid's columns, which the studies and notes shelves differ on. */
  gridClassName?: string;
  className?: string;
}) {
  const grid = layout === 'grid';
  const card = (i: number) => (
    <div
      key={i}
      className={cn(
        // Centred in both layouts, as the card centres its board and its
        // glyph against the text column (shelf-card). The grid card was
        // top-aligned, which put its board 0.8px above the real one on
        // every card of the phone's studies shelf, cold and warm, and its
        // glyph 24.8px above the note card's: a hop on every thumbnail the
        // moment the list landed, 2 to 3 device pixels at 3x. Measured
        // on the demo at 390px with the list request held.
        'bg-card flex items-center gap-3 overflow-hidden rounded-xl ring-1 ring-card-ring',
        grid ? 'px-4 py-3' : 'px-3 py-2',
      )}
      // The card's settled height where the shelf measured it last visit
      // (shelf-reservation says why a measurement and not a line count).
      // The lines below are then only what the placeholder looks like;
      // without one they are also what it measures.
      style={groups?.heights ? { height: groups.heights[i] } : undefined}
    >
      {/* The first board, where the document has one. Its 64px is
          shorter than the text beside it, so a document without one
          makes no difference to the height. */}
      <Skeleton className={cn('shrink-0', grid && cover ? 'size-16 rounded-md' : 'size-4 rounded-sm')} />
      <div
        className={cn(
          'min-w-0 flex-1',
          // The card's own rule (shelf-card): every grid card reserves the
          // fullest text column, the title line + meta + one preview
          // line, and centres what it holds, so the settled card is 90px
          // whatever its words do. The placeholder measures the same
          // without a stored height, and draws its one title line where
          // the card would centre one. From sm up only, as on the card:
          // the one-column phone shelf reserves nothing, and its card is
          // the height of these lines.
          grid && 'flex flex-col justify-center sm:min-h-[4.125rem]',
        )}
      >
        {/* The title is `text-base` at every width (shelf-card: a card
            name is one line and does not take the row rungs), so its box
            is the literal 24. The stat line under it IS on the rungs
            (`type-row-sub`), and was pinned at the desktop 16: 4px a card
            on every phone. */}
        <div className="flex h-6 items-center">
          <Skeleton className={cn('h-3.5', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
        </div>
        <div className="type-row-sub-box flex items-center">
          <Skeleton className="h-2 w-1/5" />
        </div>
        {grid && (
          // One line of excerpt, the card's own line-clamp-1, on the
          // card's 1.375rem line. The column's min-height above sets the
          // card's 90px either way; this line is what the placeholder
          // looks like.
          <div className="mt-1 flex h-[1.375rem] items-center">
            <Skeleton className="h-2 w-2/3" />
          </div>
        )}
      </div>
    </div>
  );
  const stack = (n: number, offset = 0) => (
    <div className={grid ? gridClassName : 'flex flex-col gap-1.5'}>
      {Array.from({ length: n }, (_, i) => card(i + offset))}
    </div>
  );
  if (groups)
    return (
      // The grouped list's own frame (gap-4 of gap-2 sections), the
      // root's cards headerless the way the root draws them, and each
      // collection under ShelfFolderHeader's fixed 24px row — or, at
      // zero, its one-line "Empty collection." note.
      <Loading className={className}>
        <div className="flex flex-col gap-4">
          {groups.root > 0 && <section className="flex flex-col gap-2">{stack(groups.root)}</section>}
          {groups.folders.map((n, f) => (
            <section key={f} className="flex flex-col gap-2">
              <div className="flex h-6 items-center gap-1.5">
                {/* ShelfFolderHeader's own glyph; only the name waits. */}
                <FolderIcon className="text-muted-foreground glyph shrink-0" aria-hidden />
                <Skeleton className="h-2.5 w-24" />
              </div>
              {n === 0 ? (
                <div className="flex h-5 items-center px-1">
                  <Skeleton className="h-2.5 w-28" />
                </div>
              ) : (
                // The offset is the cards drawn BEFORE this collection,
                // not its ordinal: the index reads `heights`, and by the
                // ordinal the third group took the second's row heights
                // (24px over on the demo's phone studies shelf).
                stack(n, groups.root + groups.folders.slice(0, f).reduce((a, b) => a + b, 0))
              )}
            </section>
          ))}
        </div>
      </Loading>
    );
  return (
    <Loading className={className}>
      {/* No heading bar over the flat stack. Documents ARE grouped under
          a collection name, but only a named one draws a header — the
          root group, where a shelf's documents sit unless somebody has
          filed them, renders its cards with nothing above them. A shelf
          that DOES file things stores its grouped shape and passes
          `groups` above. */}
      {stack(cards)}
    </Loading>
  );
}

/** The puzzle shelf: a cover, a title, a count and a progress bar. */
export function SkeletonBookCards({
  cards = 4,
  groups,
  className,
  footer = 'progress',
}: {
  cards?: number;
  /** What the card ends with. The puzzle shelf ends on a Progress track;
      the library ends on a line of text (a size, and where it is kept). */
  footer?: 'progress' | 'line';
  /** The library's grouped shape, where the caller stored one — same
      contract as SkeletonCards' `groups`. Without it, a flat grid. */
  groups?: { root: number; folders: number[] };
  className?: string;
}) {
  const card = (i: number) => (
    // ring, as BookCard: it is `ring-1 p-3` on both shelves now, and a
    // ring is a box-shadow that costs no layout, so the two agree at
    // 120px. While the card carried a border they were 120 against 122,
    // which is the whole reason the card's edge stopped being a border.
    <div
      key={i}
      className="bg-card ring-card-ring flex w-full items-stretch gap-3 rounded-xl ring-1 p-3"
    >
      {/* Exactly the cover's own box (h-24 w-[4.5rem]), so the card is
          the size it will be rather than the size it looks like. */}
      <Skeleton className="h-24 w-[4.5rem] shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
        {/* Title and meta share one box with no gap between them, as the
            card stacks them: a text-base line of 24px over a text-sm line
            of 20. Set apart with the column's gap-2 they each sat above
            the words they stand for. */}
        <span className="min-w-0 pr-7">
          <span className="flex h-6 items-center">
            <Skeleton className="h-3.5 w-4/5" />
          </span>
          <span className="flex h-5 items-center">
            <Skeleton className="h-2.5 w-1/3" />
          </span>
        </span>
        {footer === 'progress' ? (
          /* The Progress track’s own h-1, like SkeletonTiles. */
          <Skeleton className="h-1 w-full rounded-full" />
        ) : (
          /* A text-sm line with its glyph, which is what the library's
             cards end with; a track there stood for nothing they draw. */
          <span className="flex h-5 items-center gap-1.5">
            <Skeleton className="glyph-sm shrink-0 rounded-sm" />
            <Skeleton className="h-2.5 w-24" />
          </span>
        )}
      </div>
    </div>
  );
  const stack = (n: number, offset = 0) => (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: n }, (_, i) => card(i + offset))}
    </div>
  );
  if (groups)
    return (
      // The library's grouped frame, exactly as SkeletonCards draws the
      // studies shelf's: headerless root cards, then each collection
      // under the 24px header row — or its one-line note when empty.
      <Loading className={className}>
        <div className="flex flex-col gap-4">
          {groups.root > 0 && <section className="flex flex-col gap-2">{stack(groups.root)}</section>}
          {groups.folders.map((n, f) => (
            <section key={f} className="flex flex-col gap-2">
              <div className="flex h-6 items-center gap-1.5">
                {/* ShelfFolderHeader's own glyph; only the name waits. */}
                <FolderIcon className="text-muted-foreground glyph shrink-0" aria-hidden />
                <Skeleton className="h-2.5 w-24" />
              </div>
              {n === 0 ? (
                <div className="flex h-5 items-center px-1">
                  <Skeleton className="h-2.5 w-28" />
                </div>
              ) : (
                // The cards drawn BEFORE this collection, as SkeletonCards
                // counts them (its comment says why the ordinal is wrong).
                stack(n, groups.root + groups.folders.slice(0, f).reduce((a, b) => a + b, 0))
              )}
            </section>
          ))}
        </div>
      </Loading>
    );
  return <Loading className={className}>{stack(cards)}</Loading>;
}
