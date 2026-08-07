import { Camera, Loader2, ScanSearch, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import {
  boardFeatures,
  grayscaleFrom,
  warpQuad,
  type Point,
  type Quad,
} from './ocr/image';
import {
  classifyBoard,
  isValidTemplate,
  labelsToFen,
  type Template,
} from './ocr/classify';

/** Below this ratio-test margin a square is flagged for eyeballing. */
const CONFIDENT = 0.35;

export interface PhotoReading {
  /** Recognised position, or null on the book's first (calibration) photo. */
  fen: string | null;
  /** Cell features of the aligned photo, kept for template harvesting. */
  features: Uint8Array[];
  blackAtBottom: boolean;
}

/**
 * Photo → position: pick a page photo, drag the four handles onto the
 * diagram's corners, and the book's learned piece font reads the board.
 * The first diagram of a book has nothing to match against — it comes
 * back unread, the user sets it up by hand, and confirming it TEACHES
 * the font (see harvestTemplates), so every later photo just works.
 */
export function PhotoImport({
  slug,
  onApply,
  onClose,
}: {
  slug: string;
  onApply: (reading: PhotoReading) => void;
  onClose: () => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [corners, setCorners] = useState<Quad | null>(null);
  const [blackAtBottom, setBlackAtBottom] = useState(false);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [reading, setReading] = useState<{
    fen: string | null;
    features: Uint8Array[];
    uncertain: string[];
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<number | null>(null);

  useEffect(() => {
    void fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/ocr`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates: unknown[] }) => setTemplates(d.templates.filter(isValidTemplate)))
      .catch(() => setTemplates([]));
  }, [slug]);

  const pick = (file: File): void => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      setImg(image);
      setReading(null);
      // Default quad: centred, inset 12% — close enough to grab and drag.
      const ix = image.naturalWidth * 0.12;
      const iy = image.naturalHeight * 0.12;
      setCorners([
        { x: ix, y: iy },
        { x: image.naturalWidth - ix, y: iy },
        { x: image.naturalWidth - ix, y: image.naturalHeight - iy },
        { x: ix, y: image.naturalHeight - iy },
      ]);
    };
    image.src = url;
  };

  // Fit the photo to the modal; all pointer math converts through `scale`.
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

  const read = (): void => {
    if (!img || !corners || templates === null) return;
    // Decode pixels once, at natural size, through an offscreen canvas.
    const off = document.createElement('canvas');
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const gray = grayscaleFrom(ctx.getImageData(0, 0, off.width, off.height));
    const board = warpQuad(gray, corners);
    const features = boardFeatures(board);

    if (templates.length === 0) {
      setReading({ fen: null, features, uncertain: [] });
      return;
    }
    const cells = classifyBoard(features, templates);
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="bg-surface border-line flex max-h-full w-full max-w-[38rem] flex-col gap-3 overflow-y-auto rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <Camera className="text-subtle size-4" />
          <h2 className="text-fg flex-1 text-sm font-semibold">Position from photo</h2>
          <Button variant="ghost" size="icon-sm" title="Close" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>

        {!img ? (
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
              Choose a photo of the page
              <span className="text-subtle block text-xs">
                phones open the camera from here
              </span>
            </span>
          </label>
        ) : (
          <>
            <p className="text-subtle text-xs">
              Drag the four handles onto the corners of the diagram.
            </p>
            <canvas
              ref={canvasRef}
              className="mx-auto max-w-full touch-none rounded-md"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (dragging.current = null)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" disabled={templates === null} onClick={read}>
                {templates === null ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ScanSearch className="size-3.5" />
                )}
                Read position
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
                Black at the bottom
              </label>
              <label className="text-subtle ml-auto cursor-pointer text-xs underline-offset-2 hover:underline">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) pick(file);
                  }}
                />
                different photo
              </label>
            </div>
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
                book&rsquo;s piece font, and the next photos will read themselves.
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
            <div className="mt-2">
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
                {reading.fen === null ? 'Set up by hand' : 'Load into the editor'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function squareName(cellIndex: number, blackAtBottom: boolean): string {
  const row = Math.floor(cellIndex / 8);
  const col = cellIndex % 8;
  const file = blackAtBottom ? 7 - col : col;
  const rank = blackAtBottom ? row + 1 : 8 - row;
  return `${String.fromCharCode(97 + file)}${rank}`;
}
