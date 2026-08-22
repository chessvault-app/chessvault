import { ClipboardPaste, ImageUp, ScanSearch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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

  // The decode in flight, as the act of cancelling it. The blob URL used
  // to be revoked only in onload — a corrupt or unsupported file, whose
  // onload never fires, kept the URL (and the whole file behind it)
  // pinned for the session, and closing the dialog mid-decode leaked the
  // same way. Cancelling revokes and turns the handlers into no-ops, so
  // a superseded decode cannot fire its error over the picture that
  // replaced it.
  const cancelDecode = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelDecode.current?.(), []);

  const pick = useCallback((file: Blob): void => {
    cancelDecode.current?.();
    const url = URL.createObjectURL(file);
    const image = new Image();
    let stale = false;
    cancelDecode.current = () => {
      stale = true;
      URL.revokeObjectURL(url);
    };
    const settle = (): void => {
      cancelDecode.current = null;
      URL.revokeObjectURL(url);
    };
    image.onload = () => {
      if (stale) return;
      settle();
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
    image.onerror = () => {
      if (stale) return;
      settle();
      // Same line the other ways in use for their failures — the file was
      // chosen, so silence would read as the app having ignored it.
      setPasteHint(t('That image could not be read — it may be corrupt or an unsupported format.'));
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

  /**
   * Drag-and-drop, the third way in.
   *
   * On the WINDOW, not on a layer of our own: the window is a shared
   * sheet now and its scrim belongs to Modal, so there is no element here
   * that covers the screen to hang these on. Window listeners keep the
   * old reach — a file can land anywhere, in either state — and they are
   * also what stops a near miss from being handed to the browser, which
   * answers a dropped file by NAVIGATING to it, taking the app with it.
   */
  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragOver(true);
    };
    // Every hop between elements fires dragleave; only leaving the window
    // itself counts, and that is the one with no element to arrive at.
    const onDragLeave = (e: DragEvent): void => {
      if (e.relatedTarget === null) setDragOver(false);
    };
    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      setDragOver(false);
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) pick(file);
      else setPasteHint(t('That drop had no image file.'));
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [pick]);

  return (
    // The app's window, like every other one: a bottom sheet on a phone,
    // a centred card on a desktop. This was a hand-rolled scrim and box —
    // the last overlay that was not one — so it had no grab handle, no
    // drag, no keyboard band, no title row of the shared shape, and its
    // own Escape listener instead of the platform's close request. It is
    // dismissible the way the rest are now, scrim and drag included, which
    // the hand-rolled version deliberately was not.
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title="Position from an image"
        icon={ImageUp}
        fill
        className={cn('relative sm:max-w-[38rem]', dragOver && 'border-primary')}
      >
        {dragOver && (
          <div className="bg-muted/85 pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit]">
            <p className="text-primary text-base font-semibold">{t('Drop the image')}</p>
          </div>
        )}

        {!img ? (
          <>
            <label className="border-border hover:border-border hover:bg-accent grid cursor-pointer place-items-center rounded-lg border border-dashed p-10 text-center transition-colors">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) pick(file);
                }}
              />
              <span className="text-muted-foreground text-base">
                Choose an image of the diagram
                <span className="text-muted-foreground block text-sm">{t('a screenshot or scan works best')}</span>
              </span>
            </label>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void pasteFromClipboard()}>
                <ClipboardPaste className="size-3.5" />
                {t('Paste image')}
              </Button>
              <span className="text-muted-foreground text-sm">{t('or press Ctrl+V — dropping a file here works too')}</span>
            </div>
            {pasteHint && <p className="text-nag-dubious text-sm">{pasteHint}</p>}
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              {t('Drag the four handles onto the corners of the diagram.')}
            </p>
            <canvas
              ref={canvasRef}
              className="mx-auto max-w-full touch-none rounded-md"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (dragging.current = null)}
            />
            {/* The one thing here that is a setting rather than a verb, so
                it stays by the board it describes; the verbs are together
                in the corner. */}
            <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
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
            {pasteHint && <p className="text-nag-dubious text-sm">{pasteHint}</p>}
          </>
        )}

        {reading && (
          <div
            className={cn(
              'rounded-lg border p-3 text-sm leading-relaxed',
              reading.fen ? 'border-border bg-muted/50' : 'border-info/40 bg-info/10',
            )}
          >
            {reading.fen === null ? (
              <p className="text-muted-foreground">
                First diagram of this book — nothing to match against yet. Set
                the position up by hand; confirming it teaches the app this
                book&rsquo;s piece font, and the next images will read themselves.
              </p>
            ) : (
              <>
                <p className="text-foreground font-mono text-xs">{reading.fen.split(' ')[0]}</p>
                {reading.uncertain.length > 0 && (
                  <p className="text-nag-dubious mt-1">
                    Check by eye: {reading.uncertain.join(', ')}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* The verbs, in the corner every window in the app keeps them.
            They were scattered: Read position led a row of links up beside
            the checkbox, and Cancel lived INSIDE the result panel, which
            only exists after a read — so before one there was no stated way
            out at all, and after one there were two button rows.

            One primary, whose word follows the stage: a reading is about
            the quad it was read from, so moving a handle or flipping the
            board drops it and the button offers the read again.

            mt-auto sinks the row to the bottom edge of a sheet that is
            taller than its content, which a full-height one always is. On a
            desktop the card is sm:h-auto — no spare room, nothing to sink
            through — so it simply follows the image. */}
        {img && (
          <div className="mt-auto flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('Cancel')}
            </Button>
            {reading ? (
              <Button
                variant="default"
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
            ) : (
              <Button variant="default" size="sm" onClick={() => void read()}>
                <ScanSearch className="size-3.5" />
                {t('Read position')}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
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
