import { BOARD_PX, boardFeatures, grayscaleFrom, warpQuad, type Gray } from './image';

/** Canvas-side glue for the OCR pipeline (browser only, not unit-tested). */

export function grayFromCanvas(canvas: HTMLCanvasElement): Gray {
  const ctx = canvas.getContext('2d')!;
  return grayscaleFrom(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

export function grayFromImage(img: HTMLImageElement): Gray {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return grayFromCanvas(canvas);
}

/**
 * Cell features of an image that IS the board (e.g. a stored diagram
 * crop): the full frame is warped to the canonical square first.
 */
export function featuresFromImage(img: HTMLImageElement): Uint8Array[] {
  const gray = grayFromImage(img);
  const board = warpQuad(gray, [
    { x: 0, y: 0 },
    { x: gray.w, y: 0 },
    { x: gray.w, y: gray.h },
    { x: 0, y: gray.h },
  ]);
  return boardFeatures(board);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load image'));
    img.src = src;
  });
}

/** Crop a page-canvas region into a square JPEG data URL + its features. */
export function cropDiagram(
  page: HTMLCanvasElement,
  rect: { x: number; y: number; w: number; h: number },
): { dataUrl: string; features: Uint8Array[] } {
  const out = document.createElement('canvas');
  out.width = BOARD_PX;
  out.height = BOARD_PX;
  out.getContext('2d')!.drawImage(page, rect.x, rect.y, rect.w, rect.h, 0, 0, BOARD_PX, BOARD_PX);
  return {
    dataUrl: out.toDataURL('image/jpeg', 0.82),
    features: boardFeatures(grayFromCanvas(out)),
  };
}
