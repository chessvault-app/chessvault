import { FileUp, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { grayFromCanvas, cropDiagram } from './ocr/browser';
import { detectDiagrams } from './ocr/detect';
import { classifyBoard, labelsToFen, type CellReading, type Template } from './ocr/classify';
import { classifyBoardNet, loadCellNet } from './ocr/cellnet';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Pages render at this width; detection wants real pixels to chew on. */
const RENDER_WIDTH = 1400;

interface Found {
  page: number;
  dataUrl: string;
  fen: string | null;
  uncertain: number;
  selected: boolean;
}

/**
 * Whole-book import (lanph3re's original ask): pick the book's PDF, every page
 * is rendered and scanned for diagrams, and the crops land on the book as
 * DRAFTS — each waiting for its solution. When the book's font is already
 * learned the positions come pre-read; otherwise confirming the first
 * draft teaches it and "Read diagrams" fills in the rest.
 */
export function PdfImport({
  slug,
  templates,
  onDone,
  onClose,
}: {
  slug: string;
  templates: Template[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [progress, setProgress] = useState<string | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = async (file: File): Promise<void> => {
    setError(null);
    setFound([]);
    try {
      const pdf = await pdfjs.getDocument({
        data: await file.arrayBuffer(),
        // Scanned books embed JBIG2/JPX images. npm's pdfjs-dist ships only
        // the JS fallback decoders (no .wasm), staged by setup-engine — so
        // skip the doomed wasm fetch and load the fallbacks directly.
        useWasm: false,
        wasmUrl: `${window.location.origin}/pdfjs-wasm/`,
      }).promise;
      const results: Found[] = [];
      for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
        setProgress(`page ${pageNo}/${pdf.numPages} — ${results.length} diagrams so far`);
        const page = await pdf.getPage(pageNo);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;

        const net = await loadCellNet();
        for (const rect of detectDiagrams(grayFromCanvas(canvas))) {
          const { dataUrl, board, features } = cropDiagram(canvas, rect);
          let cells: CellReading[] | null = null;
          if (net) cells = classifyBoardNet(net, board);
          else if (templates.length > 0) cells = classifyBoard(features, templates);
          let fen: string | null = null;
          let uncertain = 0;
          if (cells) {
            fen = labelsToFen(
              cells.map((c) => c.label),
              false,
            );
            uncertain = cells.filter((c) => c.confidence < 0.35).length;
          }
          results.push({ page: pageNo, dataUrl, fen, uncertain, selected: true });
        }
      }
      setFound(results);
      setProgress(null);
      if (results.length === 0) setError('No diagrams found in that PDF.');
    } catch (e) {
      setProgress(null);
      setError(`Could not read the PDF: ${(e as Error).message}`);
    }
  };

  const save = async (): Promise<void> => {
    const chosen = found.filter((f) => f.selected);
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      // Chunked: hundreds of crops would make one giant request body.
      for (let at = 0; at < chosen.length; at += 20) {
        const chunk = chosen.slice(at, at + 20);
        const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/drafts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            drafts: chunk.map((f) => ({ image: f.dataUrl, fen: f.fen })),
          }),
        });
        if (!res.ok) throw new Error(`save failed (${res.status})`);
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const selectedCount = found.filter((f) => f.selected).length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="bg-surface border-line flex max-h-full w-full max-w-[44rem] flex-col gap-3 overflow-y-auto rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <FileUp className="text-subtle size-4" />
          <h2 className="text-fg flex-1 text-sm font-semibold">Import a book PDF</h2>
          <Button variant="ghost" size="icon-sm" title="Close" onClick={onClose}>
            <X className="size-3.5" />
          </Button>
        </div>

        {found.length === 0 && !progress && (
          <label className="border-line hover:border-line-strong hover:bg-surface-2 grid cursor-pointer place-items-center rounded-lg border border-dashed p-10 text-center transition-colors">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void scan(file);
              }}
            />
            <span className="text-muted text-sm">
              Choose the book&rsquo;s PDF
              <span className="text-subtle block text-xs">
                every page is scanned for diagrams; nothing leaves this machine
              </span>
            </span>
          </label>
        )}

        {progress && (
          <p className="text-muted flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {progress}
          </p>
        )}
        {error && <p className="text-bad text-xs">{error}</p>}

        {found.length > 0 && (
          <>
            <p className="text-subtle text-xs">
              {found.length} diagram{found.length === 1 ? '' : 's'} found — untick any false
              positives, then add them as drafts.
              {found.every((f) => f.fen === null) &&
                ' Positions are unread for now: confirming the first draft teaches this book’s font.'}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {found.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    setFound((prev) =>
                      prev.map((p, pi) => (pi === i ? { ...p, selected: !p.selected } : p)),
                    )
                  }
                  className={cn(
                    'relative rounded-lg border p-1 transition-colors',
                    f.selected ? 'border-primary/60' : 'border-line opacity-40',
                  )}
                >
                  <img src={f.dataUrl} alt={`page ${f.page}`} className="w-full rounded" />
                  <span className="text-subtle block pt-0.5 text-[0.625rem]">
                    p.{f.page}
                    {f.fen !== null && (
                      <span className={f.uncertain > 0 ? 'text-nag-dubious' : 'text-good'}>
                        {' '}
                        · {f.uncertain > 0 ? `${f.uncertain} unsure` : 'read'}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" disabled={saving || selectedCount === 0} onClick={() => void save()}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Add {selectedCount} draft{selectedCount === 1 ? '' : 's'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
