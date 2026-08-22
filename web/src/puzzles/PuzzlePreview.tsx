import { Eye } from 'lucide-react';
import { useRef, useState } from 'react';
import { Board } from '@/board/Board';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { t } from '@/lib/i18n';
import { positionAt, solverColor, type ApiPuzzle } from './puzzle';

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
    className: string;
    'aria-label': string;
    onMouseEnter: (e: React.MouseEvent) => void;
    onMouseLeave: () => void;
    onClick: (e: React.MouseEvent) => void;
  };
  /** Render once, anywhere in the tree. */
  layer: React.ReactNode;
} {
  const [preview, setPreview] = useState<Preview | null>(null);
  const cache = useRef<Map<string, ApiPuzzle>>(new Map());
  const seqRef = useRef(0);
  const openFor = useRef<string | null>(null);
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches);

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
    const rect = anchor.getBoundingClientRect();
    setPreview({
      fen: positionAt(puzzle, 1).fen,
      orientation: solverColor(puzzle),
      top: Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200),
      left: Math.max(rect.left - 192, 8),
    });
  };

  const hide = (): void => {
    seqRef.current += 1;
    openFor.current = null;
    setPreview(null);
  };

  const eyeProps = (id: string) => ({
    className: 'text-subtle hover:text-fg size-3.5 shrink-0',
    'aria-label': t('Preview the position'),
    onMouseEnter: (e: React.MouseEvent) => {
      if (!window.matchMedia('(pointer: coarse)').matches) void show(id, e.currentTarget);
    },
    onMouseLeave: () => {
      if (!window.matchMedia('(pointer: coarse)').matches) hide();
    },
    onClick: (e: React.MouseEvent) => {
      if (!window.matchMedia('(pointer: coarse)').matches) return;
      // The row underneath navigates; a peek must not also open it.
      e.stopPropagation();
      if (openFor.current === id) {
        hide();
      } else {
        openFor.current = id;
        void show(id, e.currentTarget);
      }
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
          'border-line bg-surface pointer-events-none fixed z-50 w-44 rounded-lg border p-1',
          'shadow-pop',
        )}
      >
        <Board
          fen={preview.fen}
          orientation={preview.orientation}
          viewOnly
          coordinates={false}
          className="rounded"
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
 * `className` is the LIST's own layout (where in the row it sits), which
 * is the only part either caller should be deciding.
 */
export function PreviewEye({ eye, className }: { eye: EyeProps; className?: string }) {
  return <Eye {...eye} className={cn(eye.className, className)} />;
}
