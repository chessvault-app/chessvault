import { Eye } from 'lucide-react';
import { useRef, useState } from 'react';
import { Board } from '@/board/Board';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { placeNear } from '@/lib/floating';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { t } from '@/lib/i18n';
import { positionAt, solverColor, type ApiPuzzle } from './puzzle';
import { isCoarsePointer } from '@/lib/media';

/**
 * Same card, same measured size, as the game list's peek — `w-44` with
 * `p-1`, whose board chessground floors to 162 rather than the 168 the
 * padding leaves it. See games/shared.tsx: the two keep their own copies
 * until the card itself is one component.
 */
const PEEK_CARD = { width: 176, height: 170 };

/**
 * Peeking at a puzzle from a list of them.
 *
 * A row in an attempt log says `#tjOpo` and `Easy`, which is not enough
 * to recognise a position you spent two minutes on. The eye pops the
 * board it was — after the setup move, from the side you were playing,
 * the same reading the trainer opens on.
 *
 * Two lists want this (the dashboard's log and the hub's recent rows) so
 * it lives here rather than in either. The three things it has to get
 * right, each of which was a bug once:
 *
 *  - a sequence number owns the state, so a pointer that moved on before
 *    a slow fetch returned cannot plant a stale board on screen;
 *  - an anchor that unmounted while the fetch was out measures 0,0 and
 *    would draw the preview in the corner, so a disconnected node is
 *    dropped;
 *  - a coarse pointer has no hover to leave, so touch TAPS it open and a
 *    tap anywhere dismisses — a scrim handles that, and only for touch,
 *    because on a mouse it would sit between the cursor and every row.
 */
interface Preview {
  fen: string;
  orientation: 'white' | 'black';
  top: number;
  left: number;
}

export function usePuzzlePreview(): {
  /** Put on each row's eye; wires hover, tap and the accessible name. */
  eyeProps: (id: string) => {
    'aria-label': string;
    onMouseEnter: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    onClick: (e: React.MouseEvent) => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onBlur: () => void;
  };
  /** Render once, anywhere in the tree. */
  layer: React.ReactNode;
} {
  const [preview, setPreview] = useState<Preview | null>(null);
  const cache = useRef<Map<string, ApiPuzzle>>(new Map());
  const seqRef = useRef(0);
  const openFor = useRef<string | null>(null);
  const [coarse] = useState(isCoarsePointer);

  const show = async (id: string, anchor: Element): Promise<void> => {
    const seq = ++seqRef.current;
    let puzzle = cache.current.get(id);
    if (!puzzle) {
      try {
        puzzle = (await api<{ puzzle: ApiPuzzle }>(`/api/puzzles/by-id/${encodeURIComponent(id)}`))
          .puzzle;
      } catch {
        return; // no preview is a missing nicety, not an error to show
      }
      cache.current.set(id, puzzle);
    }
    if (seq !== seqRef.current) return; // pointer moved on
    if (!anchor.isConnected) return; // row went away mid-fetch
    // Beside the eye under a mouse, where the row is 700px wide and the
    // card has room to its left. Under a thumb "left of the eye" is on
    // top of the row it belongs to, the filters and the bottom bar (a
    // 176px card on a 390px screen), so the card goes ABOVE the row,
    // flipping below it near the top, inside the scrolling region
    // rather than the window: the bar is in flow under `main`, and a
    // viewport that counts it lets the card be drawn over it.
    const coarse = isCoarsePointer();
    const region = anchor.closest('main')?.getBoundingClientRect();
    const { top, left } = placeNear(anchor.getBoundingClientRect(), PEEK_CARD, {
      side: coarse ? 'top' : 'left',
      align: coarse ? 'end' : 'center',
      gap: coarse ? 8 : 16,
      viewport: {
        width: window.innerWidth,
        height: coarse && region ? region.bottom : window.innerHeight,
      },
    });
    setPreview({
      fen: positionAt(puzzle, 1).fen,
      orientation: solverColor(puzzle),
      top,
      left,
    });
  };

  const hide = (): void => {
    seqRef.current += 1;
    openFor.current = null;
    setPreview(null);
  };

  const toggle = (id: string, anchor: Element): void => {
    if (openFor.current === id) {
      hide();
    } else {
      openFor.current = id;
      void show(id, anchor);
    }
  };

  const eyeProps = (id: string) => ({
    // A label, not a `title`: the Button would draw a tooltip on hover
    // and focus, beside the board the same hover pops. The peek is the tip.
    'aria-label': t('Preview the position'),
    onMouseEnter: (e: React.MouseEvent) => {
      if (!isCoarsePointer()) void show(id, e.currentTarget);
    },
    onMouseLeave: () => {
      if (!isCoarsePointer()) hide();
    },
    onClick: (e: React.MouseEvent) => {
      // A mouse already has the peek from hover, so a click there does
      // nothing; a tap (coarse) and a keyboard press (detail 0) toggle
      // it, because neither has a hover to arrive by.
      if (!isCoarsePointer() && e.detail !== 0) return;
      toggle(id, e.currentTarget);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && openFor.current === id) {
        e.stopPropagation();
        hide();
      }
    },
    onBlur: () => {
      // Tabbing away from an eye opened by the keyboard closes its peek,
      // the way the pointer leaving closes a hovered one.
      if (openFor.current === id && !isCoarsePointer()) hide();
    },
  });

  const layer = preview && (
    <>
      {coarse && (
        <div
          className="fixed inset-0 z-40"
          onPointerDown={() => {
            hide();
            suppressNextClick();
          }}
        />
      )}
      <div
        style={{ top: preview.top, left: preview.left }}
        className={cn(
          'border-border bg-card pointer-events-none fixed z-50 w-44 rounded-lg border p-1',
          'shadow-lg',
        )}
      >
        <Board
          fen={preview.fen}
          orientation={preview.orientation}
          viewOnly
          coordinates={false}
          className="rounded-sm"
        />
      </div>
    </>
  );

  return { eyeProps, layer };
}

type EyeProps = ReturnType<ReturnType<typeof usePuzzlePreview>['eyeProps']>;

/**
 * The eye itself, so callers do not each import the icon — and so the
 * two lists that have one cannot drift apart on how it is placed.
 * `className` is the LIST's own layout (where beside the row it sits),
 * which is the only part either caller should be deciding.
 *
 * A button, and a SIBLING of the row rather than a child of it. It was a
 * bare 14px svg inside the row's own button: not in the tab order, its
 * label folded into the row's name for a screen reader, and on a phone a
 * 14px target beside a 44px row that navigates away, where a miss is the
 * opposite of a peek. A button cannot sit inside a button, so the row
 * gives up its right edge and the eye stands next to it, on the icon
 * rung with the coarse-pointer box the other icon buttons take.
 */
export function PreviewEye({ eye, className }: { eye: EyeProps; className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      {...eye}
      className={cn('text-muted-foreground hover:text-foreground pointer-coarse:size-9', className)}
    >
      <Eye className="size-3.5" />
    </Button>
  );
}
