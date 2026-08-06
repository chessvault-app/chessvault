import { Chessground } from '@lichess-org/chessground';
import type { Api as CgApi } from '@lichess-org/chessground/api';
import type { Config as CgConfig } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Color, Dests, Key } from '@lichess-org/chessground/types';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

export interface BoardProps {
  fen: string;
  orientation?: Color;
  /** Legal destinations as `orig -> dest[]`; omit to make the board read-only. */
  dests?: Map<string, string[]>;
  /** Whose pieces can be moved. Defaults to the side to move implied by `fen`. */
  movableColor?: Color | 'both';
  turnColor?: Color;
  lastMove?: [string, string];
  check?: boolean;
  shapes?: DrawShape[];
  /** Engine arrows and similar: drawn by the app, not editable by the user. */
  autoShapes?: DrawShape[];
  viewOnly?: boolean;
  coordinates?: boolean;
  /** Editor mode: any piece may go to any square, ignoring the rules. */
  free?: boolean;
  onMove?: (orig: string, dest: string) => void;
  /** Fires on a click/tap of a square. Used by the editor's piece palette. */
  onSelect?: (square: string) => void;
  /** Fires when the user draws or erases shapes with right-drag. */
  onShapesChange?: (shapes: DrawShape[]) => void;
  className?: string;
}

/**
 * React wrapper around chessground.
 *
 * chessground owns its own DOM and diffs internally, so the element is created
 * exactly once and every later change is pushed through `api.set()`. Re-creating
 * it per render would kill drag state and animations mid-gesture.
 */
export function Board({
  fen,
  orientation = 'white',
  dests,
  movableColor,
  turnColor,
  lastMove,
  check = false,
  shapes,
  autoShapes,
  viewOnly = false,
  coordinates = true,
  free = false,
  onMove,
  onSelect,
  onShapesChange,
  className,
}: BoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<CgApi | null>(null);

  // Callbacks live in refs so changing a handler never forces a board rebuild.
  const onMoveRef = useRef(onMove);
  const onSelectRef = useRef(onSelect);
  const onShapesRef = useRef(onShapesChange);
  const freeRef = useRef(free);
  onMoveRef.current = onMove;
  onSelectRef.current = onSelect;
  onShapesRef.current = onShapesChange;
  freeRef.current = free;

  // Mount once.
  useEffect(() => {
    if (!host.current) return;
    const config: CgConfig = {
      fen,
      orientation,
      coordinates,
      viewOnly,
      // Right-drag draws arrows and right-click draws circles. Without this the
      // browser context menu opens on mouseup and swallows the gesture, so
      // circles in particular never register.
      disableContextMenu: true,
      addDimensionsCssVarsTo: host.current,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      // Touch: dragging a piece must never scroll the page under the board.
      blockTouchScroll: true,
      movable: {
        free,
        showDests: !free,
        events: {
          after: (orig, dest) => onMoveRef.current?.(orig, dest),
        },
      },
      draggable: { enabled: !viewOnly, showGhost: true },
      selectable: { enabled: true },
      events: {
        select: (key) => {
          onSelectRef.current?.(key);
          // In editor mode a click means "apply the current tool here", so
          // leaving the square highlighted as "selected" is just visual noise.
          if (freeRef.current) api.current?.selectSquare(null);
        },
      },
      drawable: {
        enabled: true,
        onChange: (next) => onShapesRef.current?.(next),
      },
      // A local single-user vault never needs premoves.
      premovable: { enabled: false },
    };
    api.current = Chessground(host.current, config);
    return () => {
      api.current?.destroy();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  // Push position and interaction state.
  useEffect(() => {
    const board = api.current;
    if (!board) return;
    const sideToMove: Color = turnColor ?? (fen.split(' ')[1] === 'b' ? 'black' : 'white');
    board.set({
      fen,
      orientation,
      turnColor: sideToMove,
      check: check ? sideToMove : false,
      lastMove: lastMove as Key[] | undefined,
      viewOnly,
      coordinates,
      movable: {
        free,
        // In free (editor) mode either colour may be dragged and legality is not
        // consulted, so `dests` is irrelevant. Outside it, omitting dests means
        // nothing is movable — which is what a read-only board wants.
        color: free ? 'both' : viewOnly ? undefined : (movableColor ?? sideToMove),
        // Our tree yields plain strings; chessground wants its `Key` union. The
        // values are square names either way, so this cast is safe.
        dests: (dests as Dests | undefined) ?? new Map<Key, Key[]>(),
        showDests: !free,
      },
      draggable: { enabled: !viewOnly, showGhost: true },
    });
  }, [
    fen,
    orientation,
    dests,
    movableColor,
    turnColor,
    lastMove,
    check,
    viewOnly,
    coordinates,
    free,
  ]);

  // User-owned shapes (arrows/circles saved into the study).
  useEffect(() => {
    api.current?.setShapes(shapes ? [...shapes] : []);
  }, [shapes]);

  // App-owned shapes (engine best-move arrows), kept separate so drawing over
  // them never overwrites the user's own annotations.
  useEffect(() => {
    api.current?.setAutoShapes(autoShapes ? [...autoShapes] : []);
  }, [autoShapes]);

  return (
    <div
      className={cn(
        // Square, capped by whichever axis is scarcer — this is what makes the
        // board behave on a phone in landscape as well as a wide desktop.
        'aspect-square w-full',
        className,
      )}
    >
      <div ref={host} className="size-full" />
    </div>
  );
}
