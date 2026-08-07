import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from 'lucide-react';
import { parseFen } from 'chessops/fen';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';

/**
 * The moves-so-far panel both puzzle trainers share: the app's standard
 * table (number gutter from the position's REAL move number, White/Black
 * cells, ellipsis continuations) plus the standard navigation toolbar
 * driving a review cursor. `current` is the ply shown (sans.length =
 * live); clicking a move or the toolbar calls `onSelect` with a target
 * ply, and the caller decides what reviewing means.
 */
export function AnswerPanel({
  title,
  fen,
  sans,
  current,
  wrongAt = null,
  emptyText,
  onSelect,
}: {
  title: string;
  /** Starting FEN — provides the move number and side of the first ply. */
  fen: string;
  sans: string[];
  current: number;
  /** After grading: the first wrong ply, tinted like a blunder. */
  wrongAt?: number | null;
  emptyText: string;
  onSelect: (ply: number) => void;
}) {
  const setup = parseFen(fen).unwrap();
  const blackFirst = setup.turn === 'black';
  const startNumber = setup.fullmoves;
  const reviewing = current < sans.length;

  const rows: { number: number; white: number | null; black: number | null }[] = [];
  sans.forEach((_, i) => {
    const isWhiteMove = blackFirst ? i % 2 === 1 : i % 2 === 0;
    const number = startNumber + Math.floor((i + (blackFirst ? 1 : 0)) / 2);
    if (isWhiteMove || rows.length === 0 || rows.at(-1)!.black !== null) {
      rows.push({ number, white: isWhiteMove ? i : null, black: isWhiteMove ? null : i });
    } else {
      rows.at(-1)!.black = i;
    }
  });

  const cell = (index: number | null): React.ReactNode =>
    index === null ? (
      <span className="text-subtle flex items-center px-3 py-1">…</span>
    ) : (
      <button
        type="button"
        onClick={() => onSelect(index + 1)}
        className={cn(
          'flex items-baseline px-3 py-1 text-left font-medium transition-colors duration-100',
          index === wrongAt
            ? 'bg-nag-blunder/20 text-nag-blunder'
            : index + 1 === current
              ? 'bg-primary text-primary-fg'
              : 'hover:bg-surface-2',
        )}
      >
        {sans[index]}
        {index === wrongAt && <span className="ml-1 font-semibold">⁇</span>}
      </button>
    );

  return (
    <Panel flush className="min-h-[10rem] shrink-0">
      <PanelHeader title={title} />
      {sans.length === 0 ? (
        <p className="text-subtle px-3 py-4 text-center text-xs">{emptyText}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto text-sm">
          {rows.map((row, r) => (
            <div key={r} className="border-line/60 grid grid-cols-[2rem_1fr_1fr] border-b">
              <span className="bg-surface-inset/60 border-line/60 text-subtle flex items-center justify-center border-r font-mono text-[0.6875rem]">
                {row.number}
              </span>
              {cell(row.white)}
              {cell(row.black)}
            </div>
          ))}
        </div>
      )}
      {/* The same navigation toolbar every board in the app has. */}
      <div className="border-line flex w-full shrink-0 items-center justify-center gap-1 border-t py-1">
        <Button variant="ghost" size="icon" title="Start" disabled={sans.length === 0} onClick={() => onSelect(0)}>
          <ChevronFirst className="size-[1.1rem]" />
        </Button>
        <Button variant="ghost" size="icon" title="Back" disabled={sans.length === 0} onClick={() => onSelect(current - 1)}>
          <ChevronLeft className="size-[1.1rem]" />
        </Button>
        <Button variant="ghost" size="icon" title="Forward" disabled={!reviewing} onClick={() => onSelect(current + 1)}>
          <ChevronRight className="size-[1.1rem]" />
        </Button>
        <Button variant="ghost" size="icon" title="Newest" disabled={!reviewing} onClick={() => onSelect(sans.length)}>
          <ChevronLast className="size-[1.1rem]" />
        </Button>
      </div>
    </Panel>
  );
}
