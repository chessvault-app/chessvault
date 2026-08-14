import { Chessground } from '@lichess-org/chessground';
import type { Api as CgApi } from '@lichess-org/chessground/api';
import type { Config as CgConfig } from '@lichess-org/chessground/config';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Color, Dests, Key, Piece, Role } from '@lichess-org/chessground/types';
import { useEffect, useRef, type MutableRefObject } from 'react';
import { usePrefs } from '@/store/prefs';
import { moveHaptic } from '@/board/sound';
import { cn } from '@/lib/cn';

/** The underlying chessground handle, for callers that need direct calls
    (e.g. the editor starting a spare-piece drag from its palette). */
export type BoardApi = CgApi;
export type BoardPiece = { role: Role; color: Color };

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
  /** Overrides the Settings preference when set; leave unset to follow it. */
  coordinates?: boolean;
  /** Editor mode: any piece may go to any square, ignoring the rules. */
  free?: boolean;
  /** Editor mode: dragging a piece off the board removes it. */
  deleteOnDropOff?: boolean;
  onMove?: (orig: string, dest: string) => void;
  /** Fires after ANY user change to the position — including a drop-off
      delete, which no other callback reports. */
  onBoardChange?: () => void;
  /** Fires on a click/tap of a square. Used by the editor's piece palette. */
  onSelect?: (square: string) => void;
  /** Fires when the user draws or erases shapes with right-drag. */
  onShapesChange?: (shapes: DrawShape[]) => void;
  /** Fires when a spare piece dragged in via `dragNewPiece` lands on a square. */
  onDropNewPiece?: (piece: BoardPiece, key: string) => void;
  /** Receives the live chessground api for imperative calls. */
  apiRef?: MutableRefObject<BoardApi | null>;
  className?: string;
}

/** The piece on `square`, as its FEN letter, or null for an empty square. */
function pieceAt(fen: string, square: string): string | null {
  const row = fen.split(' ')[0]!.split('/')[8 - Number(square[1])];
  if (!row) return null;
  const file = square.charCodeAt(0) - 97;
  let at = 0;
  for (const ch of row) {
    const run = Number(ch);
    if (Number.isInteger(run)) {
      at += run;
      if (at > file) return null; // the empty run covers the square
    } else {
      if (at === file) return ch;
      at += 1;
    }
  }
  return null;
}

/**
 * The rook-castle style's own dest prune. chessground's rookCastle: false
 * drops the rook-square destination and keeps g1/c1; with rookCastle: true
 * it drops NOTHING, so both entrances stayed live and the "move the king
 * onto the rook" choice quietly still accepted e1→g1. Mirror of
 * chessground's config.js filter: when the king stands on its home square
 * and both squares of a castle are offered, keep only the rook's.
 */
function pruneKingCastleDests(
  dests: Map<string, string[]>,
  fen: string,
): Map<string, string[]> {
  let out = dests;
  for (const [kingSq, king, rank] of [
    ['e1', 'K', '1'],
    ['e8', 'k', '8'],
  ] as const) {
    const offered = out.get(kingSq);
    if (!offered || pieceAt(fen, kingSq) !== king) continue;
    const pruned = offered.filter(
      (d) =>
        !(d === `g${rank}` && offered.includes(`h${rank}`)) &&
        !(d === `c${rank}` && offered.includes(`a${rank}`)),
    );
    if (pruned.length !== offered.length) {
      if (out === dests) out = new Map(dests);
      out.set(kingSq, pruned);
    }
  }
  return out;
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
  coordinates,
  free = false,
  deleteOnDropOff = false,
  onMove,
  onSelect,
  onShapesChange,
  onDropNewPiece,
  onBoardChange,
  apiRef,
  className,
}: BoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<CgApi | null>(null);

  // Callbacks live in refs so changing a handler never forces a board rebuild.
  const onMoveRef = useRef(onMove);
  const onSelectRef = useRef(onSelect);
  const onShapesRef = useRef(onShapesChange);
  const onDropNewPieceRef = useRef(onDropNewPiece);
  const onBoardChangeRef = useRef(onBoardChange);
  const freeRef = useRef(free);
  // Read once at construction and kept fresh for the update pass below.
  const rookCastlesRef = useRef(usePrefs.getState().castleStyle === 'rook');
  const castleStyle = usePrefs((p) => p.castleStyle);
  rookCastlesRef.current = castleStyle === 'rook';
  // The prop, when a caller sets one, outranks the Settings preference.
  const coordinatesPref = usePrefs((p) => p.coordinates);
  const showCoordinates = coordinates ?? coordinatesPref;
  onMoveRef.current = onMove;
  onSelectRef.current = onSelect;
  onShapesRef.current = onShapesChange;
  onDropNewPieceRef.current = onDropNewPiece;
  onBoardChangeRef.current = onBoardChange;
  freeRef.current = free;

  // Mount once.
  useEffect(() => {
    if (!host.current) return;
    const config: CgConfig = {
      fen,
      orientation,
      coordinates: showCoordinates,
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
        // legalDests offers BOTH castling squares. rookCastle: false makes
        // chessground prune the rook square, leaving g1/c1; the rook style
        // has no chessground-side mirror, so pruneKingCastleDests below
        // does it. Each style offers, and accepts, exactly one way in.
        rookCastle: rookCastlesRef.current,
        events: {
          after: (orig, dest) => {
            moveHaptic();
            onMoveRef.current?.(orig, dest);
          },
        },
      },
      draggable: { enabled: !viewOnly, showGhost: true, deleteOnDropOff },
      selectable: { enabled: true },
      events: {
        change: () => onBoardChangeRef.current?.(),
        select: (key) => {
          onSelectRef.current?.(key);
          // In editor mode a click means "apply the current tool here", so
          // leaving the square highlighted as "selected" is just visual noise.
          if (freeRef.current) api.current?.selectSquare(null);
        },
        dropNewPiece: (piece: Piece, key) => onDropNewPieceRef.current?.(piece as BoardPiece, key),
      },
      drawable: {
        enabled: true,
        onChange: (next) => onShapesRef.current?.(next),
      },
      // A local single-user vault never needs premoves.
      premovable: { enabled: false },
    };
    api.current = Chessground(host.current, config);
    if (apiRef) apiRef.current = api.current;
    return () => {
      api.current?.destroy();
      api.current = null;
      if (apiRef) apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  // chessground's set() merges state but only redrawAll() rebuilds the
  // wrap the coordinate labels live in, so a toggle needs the extra call.
  const coordsWere = useRef(showCoordinates);

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
      coordinates: showCoordinates,
      movable: {
        free,
        // In free (editor) mode either colour may be dragged and legality is not
        // consulted, so `dests` is irrelevant. Outside it, omitting dests means
        // nothing is movable — which is what a read-only board wants.
        color: free ? 'both' : viewOnly ? undefined : (movableColor ?? sideToMove),
        // Our tree yields plain strings; chessground wants its `Key` union. The
        // values are square names either way, so this cast is safe.
        dests:
          ((castleStyle === 'rook' && dests
            ? pruneKingCastleDests(dests, fen)
            : dests) as Dests | undefined) ?? new Map<Key, Key[]>(),
        showDests: !free,
        rookCastle: castleStyle === 'rook',
      },
      draggable: { enabled: !viewOnly, showGhost: true, deleteOnDropOff },
    });
    if (coordsWere.current !== showCoordinates) {
      coordsWere.current = showCoordinates;
      board.redrawAll();
    }
  }, [
    fen,
    orientation,
    dests,
    movableColor,
    turnColor,
    lastMove,
    check,
    viewOnly,
    showCoordinates,
    free,
    deleteOnDropOff,
    // Read at line ~179; leaving it out froze a castle-style change on any
    // already-mounted board until the next position change.
    castleStyle,
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
