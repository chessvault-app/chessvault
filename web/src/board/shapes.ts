import { makeSquare, parseSquare } from 'chessops/util';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { CommentShape } from '@shared/types';

/**
 * Translation between the two shape representations.
 *
 * The tree stores shapes as chessops `CommentShape` (numeric squares) because
 * that is the form PGN round-trips as `[%cal]`/`[%csl]`. chessground works in
 * square names. A circle is encoded as a shape whose `from` equals its `to`.
 */

const BRUSHES = ['green', 'red', 'blue', 'yellow'] as const;
type Brush = (typeof BRUSHES)[number];

const isBrush = (value: string | undefined): value is Brush =>
  BRUSHES.includes(value as Brush);

function toDrawShape(shape: CommentShape): DrawShape {
  const orig = makeSquare(shape.from);
  return shape.from === shape.to
    ? { orig, brush: shape.color }
    : { orig, dest: makeSquare(shape.to), brush: shape.color };
}

function fromDrawShape(shape: DrawShape): CommentShape | undefined {
  const from = parseSquare(shape.orig);
  if (from === undefined) return undefined;
  const to = shape.dest ? parseSquare(shape.dest) : from;
  if (to === undefined) return undefined;
  // PGN only has the four Lichess brushes; anything else (piece drops, custom
  // SVG) can't be persisted, so it's dropped rather than silently recoloured.
  if (!isBrush(shape.brush)) return undefined;
  return { color: shape.brush, from, to };
}

export function toDrawShapes(shapes: CommentShape[]): DrawShape[] {
  return shapes.map(toDrawShape);
}

export function fromDrawShapes(shapes: DrawShape[]): CommentShape[] {
  return shapes.map(fromDrawShape).filter((s): s is CommentShape => s !== undefined);
}
