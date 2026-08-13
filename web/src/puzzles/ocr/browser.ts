import { BOARD_PX, boardFeatures, grayscaleFrom, warpQuad, type Gray, type Quad } from './image';
import { detectBoardQuad } from './detect';

/** Canvas-side glue for the OCR pipeline (browser only, not unit-tested). */

export function grayFromCanvas(canvas: HTMLCanvasElement): Gray {
  const ctx = canvas.getContext('2d')!;
  return grayscaleFrom(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function grayFromImage(img: HTMLImageElement): Gray {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return grayFromCanvas(canvas);
}

/**
 * Canonical 512² board from an image that CONTAINS the board (a stored
 * diagram crop): corner detection trims number strips and coordinate
 * gutters — real-book crops carry both, and a blind full-frame warp
 * misaligns every cell by a fraction of a square.
 */
function boardFromGray(gray: Gray): Gray {
  const quad: Quad = detectBoardQuad(gray) ?? [
    { x: 0, y: 0 },
    { x: gray.w, y: 0 },
    { x: gray.w, y: gray.h },
    { x: 0, y: gray.h },
  ];
  return warpQuad(gray, quad);
}

export function boardFromImage(img: HTMLImageElement): Gray {
  return boardFromGray(grayFromImage(img));
}

/** Cell features of an image that contains the board. */
export function featuresFromImage(img: HTMLImageElement): Uint8Array[] {
  return boardFeatures(boardFromImage(img));
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load image'));
    img.src = src;
  });
}

/**
 * Crop a page-canvas region into a square JPEG data URL, plus the ALIGNED
 * board (corner-detected within the crop) and its features.
 */
export function cropDiagram(
  page: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
): { dataUrl: string; board: Gray; features: Uint8Array[] } {
  const out = document.createElement('canvas');
  out.width = BOARD_PX;
  out.height = BOARD_PX;
  out.getContext('2d')!.drawImage(page, rect.x, rect.y, rect.w, rect.h, 0, 0, BOARD_PX, BOARD_PX);
  const board = boardFromGray(grayFromCanvas(out));
  return {
    dataUrl: out.toDataURL('image/jpeg', 0.82),
    board,
    features: boardFeatures(board),
  };
}
