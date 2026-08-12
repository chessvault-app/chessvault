import { ClipboardPaste, ImageUp, ScanSearch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import {
  boardFeatures,
  grayscaleFrom,
  warpQuad,
  type Point,
  type Quad,
} from './ocr/image';
import { detectBoardQuad } from './ocr/detect';
import { classifyBoard, labelsToFen, type CellReading, type Template } from './ocr/classify';
import { classifyBoardNet, loadCellNet } from './ocr/cellnet';
import { t } from '@/lib/i18n';

/** Below this ratio-test margin a square is flagged for eyeballing. */
const CONFIDENT = 0.35;

export interface PhotoReading {
  /** Recognised position, or null when there were no templates to match. */
  fen: string | null;
  /** Cell features of the aligned image, kept for template harvesting. */
  features: Uint8Array[];
  blackAtBottom: boolean;
}

/**
 * Image → position: pick a figure (a screenshot or scan of a diagram),
 * drag the four handles onto the board's corners, and the given template
 * set reads the position. With an empty template set (a book's first
 * diagram) the image comes back unread — the caller's confirmation flow
 * then teaches the font via harvestTemplates.
 */
export function PhotoImport({
  templates,
  onApply,
  onClose,
  initialFile,
}: {
  templates: Template[];
  onApply: (reading: PhotoReading) => void;
  onClose: () => void;
  /** Skip the chooser: a file already picked by the caller's own UI. */
  initialFile?: Blob;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [corners, setCorners] = useState<Quad | null>(null);
  const [blackAtBottom, setBlackAtBottom] = useState(false);
  const [reading, setReading] = useState<{
    fen: string | null;
    features: Uint8Array[];
    uncertain: string[];
  } | null>(null);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);

  const pick = useCallback((file: Blob): void => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      setImg(image);
      setReading(null);
      setPasteHint(null);
      // Pre-place the handles on the detected board; the fallback quad
      // (centred, inset 12%) is close enough to grab and drag.
      const ix = image.naturalWidth * 0.12;
      const iy = image.naturalHeight * 0.12;
      setCorners(
        detectQuad(image) ?? [
          { x: ix, y: iy },
          { x: image.naturalWidth - ix, y: iy },
          { x: image.naturalWidth - ix, y: image.naturalHeight - iy },
          { x: ix, y: image.naturalHeight - iy },
        ],
      );
    };
    image.src = url;
  }, []);

  useEffect(() => {
    if (initialFile) pick(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Ctrl+V anywhere while the dialog is open loads the clipboard image —
  // the natural flow after snipping a diagram off the screen.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        pick(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pick]);

  // Button fallback for the same thing: the paste EVENT only fires on a
  // keyboard shortcut, so a pointer-driven flow needs the async API.
  const pasteFromClipboard = async (): Promise<void> => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          pick(await item.getType(type));
          return;
        }
      }
      setPasteHint(t('No image in the clipboard — copy or snip one first.'));
    } catch {
      setPasteHint('Clipboard access was blocked — press Ctrl+V instead.');
    }
  };

  // Fit the image to the modal; all pointer math converts through `scale`.
  const displayW = 560;
  const scale = img ? Math.min(displayW / img.naturalWidth, 480 / img.naturalHeight) : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img || !corners) return;
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(56,189,248,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach((p, i) => {
      const x = p.x * scale;
      const y = p.y * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    for (const p of corners) {
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, 9, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56,189,248,0.35)';
      ctx.fill();
      ctx.stroke();
    }
  }, [img, corners, scale]);

  const canvasPoint = (e: React.PointerEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!corners) return;
    const p = canvasPoint(e);
    let best = -1;
    let bestD = Infinity;
    corners.forEach((c, i) => {
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    // Generous grab radius (in image px) so touch works.
    if (Math.sqrt(bestD) * scale < 32) {
      dragging.current = best;
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    if (dragging.current === null || !corners || !img) return;
    const p = canvasPoint(e);
    const next = corners.map((c, i) =>
      i === dragging.current
        ? {
            x: Math.min(Math.max(p.x, 0), img.naturalWidth),
            y: Math.min(Math.max(p.y, 0), img.naturalHeight),
          }
        : c,
    ) as Quad;
    setCorners(next);
    setReading(null);
  };

  const read = async (): Promise<void> => {
    if (!img || !corners) return;
    // Decode pixels once, at natural size, through an offscreen canvas.
    const off = document.createElement('canvas');
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const gray = grayscaleFrom(ctx.getImageData(0, 0, off.width, off.height));
    const board = warpQuad(gray, corners);
    // Features are always computed: confirming the position harvests them
    // as this book's font regardless of which classifier read the board.
    const features = boardFeatures(board);

    // The trained net reads any style with no calibration; the per-book
    // templates are the fallback (and stay the personalisation layer).
    const net = await loadCellNet();
    let cells: CellReading[] | null = null;
    if (net) cells = classifyBoardNet(net, board);
    else if (templates.length > 0) cells = classifyBoard(features, templates);
    if (!cells) {
      setReading({ fen: null, features, uncertain: [] });
      return;
    }
    const fen = labelsToFen(
      cells.map((c) => c.label),
      blackAtBottom,
    );
    const uncertain = cells
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.confidence < CONFIDENT)
      .map(({ i }) => squareName(i, blackAtBottom));
    setReading({ fen, features, uncertain });
  };

  // Drag-and-drop, the third way in: handlers live on the whole overlay so
  // a file can land anywhere on the dialog, in either state.
  const onDragOver = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const onDragLeave = (e: React.DragEvent): void => {
    // dragleave fires on every child hop; only leaving the overlay counts.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setDragOver(false);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) pick(file);
    else setPasteHint(t('That drop had no image file.'));
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={cn(
          'bg-surface border-line relative flex max-h-full w-full max-w-[38rem] flex-col gap-3 overflow-y-auto rounded-xl border p-4',
          dragOver && 'border-primary',
        )}
      >
        {dragOver && (
          <div className="bg-primary-soft/85 pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl">
            <p className="text-primary text-sm font-semibold">{t('Drop the image')}</p>
          </div>
        )}
        <div className="border-line -mx-4 flex items-center gap-2 border-b px-4 pb-3">
          <ImageUp className="text-subtle size-3.5 shrink-0" />
          <p className="text-subtle min-w-0 flex-1 truncate text-xs">
            {t('Position from an image')}
          </p>
        </div>

        {!img ? (
          <>
            <label className="border-line hover:border-line-strong hover:bg-surface-2 grid cursor-pointer place-items-center rounded-lg border border-dashed p-10 text-center transition-colors">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) pick(file);
                }}
              />
              <span className="text-muted text-sm">
                Choose an image of the diagram
                <span className="text-subtle block text-xs">{t('a screenshot or scan works best')}</span>
              </span>
            </label>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void pasteFromClipboard()}>
                <ClipboardPaste className="size-3.5" />
                {t('Paste image')}
              </Button>
              <span className="text-subtle text-xs">{t('or press Ctrl+V — dropping a file here works too')}</span>
            </div>
            {pasteHint && <p className="text-nag-dubious text-xs">{pasteHint}</p>}
          </>
        ) : (
          <>
            <p className="text-subtle text-xs">
              {t('Drag the four handles onto the corners of the diagram.')}
            </p>
            <canvas
              ref={canvasRef}
              className="mx-auto max-w-full touch-none rounded-md"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (dragging.current = null)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" onClick={() => void read()}>
                <ScanSearch className="size-3.5" />
                {t('Read position')}
              </Button>
              <label className="text-muted flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={blackAtBottom}
                  onChange={(e) => {
                    setBlackAtBottom(e.target.checked);
                    setReading(null);
                  }}
                />
                {t('Black at the bottom')}
              </label>
              <button
                type="button"
                onClick={() => void pasteFromClipboard()}
                className="text-subtle ml-auto cursor-pointer text-xs underline-offset-2 hover:underline"
              >
                {t('paste image')}
              </button>
              <label className="text-subtle cursor-pointer text-xs underline-offset-2 hover:underline">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) pick(file);
                  }}
                />
                {t('different image')}
              </label>
            </div>
            {pasteHint && <p className="text-nag-dubious text-xs">{pasteHint}</p>}
          </>
        )}

        {reading && (
          <div
            className={cn(
              'rounded-lg border p-3 text-xs leading-relaxed',
              reading.fen ? 'border-line bg-surface-inset/50' : 'border-info/40 bg-info/10',
            )}
          >
            {reading.fen === null ? (
              <p className="text-muted">
                First diagram of this book — nothing to match against yet. Set
                the position up by hand; confirming it teaches the app this
                book&rsquo;s piece font, and the next images will read themselves.
              </p>
            ) : (
              <>
                <p className="text-fg font-mono text-[0.6875rem]">{reading.fen.split(' ')[0]}</p>
                {reading.uncertain.length > 0 && (
                  <p className="text-nag-dubious mt-1">
                    Check by eye: {reading.uncertain.join(', ')}
                  </p>
                )}
              </>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t('Cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() =>
                  onApply({
                    fen: reading.fen,
                    features: reading.features,
                    blackAtBottom,
                  })
                }
              >
                {t(reading.fen === null ? 'Set up by hand' : 'Load into the editor')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Run corner detection on a freshly decoded image. Detection happens on a
 * size-capped decode (phone photos run to 48 MP; the blob analysis needs
 * nothing like that), and the quad scales back to natural coordinates.
 */
function detectQuad(image: HTMLImageElement): Quad | null {
  const cap = 1600 / Math.max(image.naturalWidth, image.naturalHeight);
  const k = Math.min(1, cap);
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(image.naturalWidth * k));
  off.height = Math.max(1, Math.round(image.naturalHeight * k));
  const ctx = off.getContext('2d')!;
  ctx.drawImage(image, 0, 0, off.width, off.height);
  const quad = detectBoardQuad(grayscaleFrom(ctx.getImageData(0, 0, off.width, off.height)));
  if (!quad) return null;
  return quad.map((p) => ({ x: p.x / k, y: p.y / k })) as unknown as Quad;
}

function squareName(cellIndex: number, blackAtBottom: boolean): string {
  const row = Math.floor(cellIndex / 8);
  const col = cellIndex % 8;
  const file = blackAtBottom ? 7 - col : col;
  const rank = blackAtBottom ? row + 1 : 8 - row;
  return `${String.fromCharCode(97 + file)}${rank}`;
}
