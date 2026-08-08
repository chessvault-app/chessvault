import { AlertCircle, ClipboardPaste, FolderInput, ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAnalysis } from '@/store/analysis';
import { builtinTemplates } from '@/puzzles/ocr/builtin';
import type { Template } from '@/puzzles/ocr/classify';
import { PhotoImport } from '@/puzzles/PhotoImport';
import { Button } from '@/ui/Button';
import { TextArea } from '@/ui/Input';
import { Panel, PanelHeader } from '@/ui/Panel';

/**
 * Load a position from FEN or PGN — a small header button opening a modal,
 * not a standing panel: loading is a once-per-session act (lanph3re's call), so
 * it should cost zero space while analysing.
 *
 * One textarea handles both formats: a leading `[` or a move number means
 * PGN, otherwise it's treated as a FEN. Guessing is safe because both
 * loaders validate and report failure rather than throwing.
 */
export function LoadPositionButton() {
  const [open, setOpen] = useState(false);
  // 'Load position' is the single entry point (lanph3re's call): the dialog
  // offers text (FEN/PGN) and image import; the latter swaps to the same
  // PhotoImport flow the editor uses.
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [imageFile, setImageFile] = useState<Blob | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        active={open}
        title="Load a position — FEN, PGN, or image"
        onClick={() => setOpen(true)}
      >
        <FolderInput className="size-3.5" />
      </Button>
      {open && templates === null && (
        <LoadDialog
          onClose={() => setOpen(false)}
          onImage={(file) => {
            setImageFile(file);
            void builtinTemplates()
              .then(setTemplates)
              .catch(() => setTemplates([]));
          }}
        />
      )}
      {templates !== null && (
        <PhotoImport
          templates={templates}
          initialFile={imageFile ?? undefined}
          onApply={(reading) => {
            if (reading.fen) useAnalysis.getState().loadFen(reading.fen);
            setTemplates(null);
            setOpen(false);
          }}
          onClose={() => {
            setTemplates(null);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function LoadDialog({ onClose, onImage }: { onClose: () => void; onImage: (file: Blob | null) => void }) {
  const [text, setText] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const loadFen = useAnalysis((s) => s.loadFen);
  const loadPgn = useAnalysis((s) => s.loadPgn);
  const loadError = useAnalysis((s) => s.loadError);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const onPaste = (e: ClipboardEvent): void => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        onImage(file);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, [onClose, onImage]);

  const looksLikePgn = (value: string): boolean =>
    /^\s*\[/.test(value) || /\b1\s*\.\s*[A-Za-z]/.test(value);

  const submit = (): void => {
    const value = text.trim();
    if (!value) return;
    const ok = looksLikePgn(value) ? loadPgn(value) : loadFen(value);
    if (ok) onClose();
  };

  const pasteFromClipboard = async (): Promise<void> => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) setText(clip);
    } catch {
      // Clipboard read is denied in cross-origin isolated documents (the
      // COOP/COEP headers Stockfish needs); ⌘V into the field still works.
    }
    textarea.current?.focus();
  };

  return (
    <>
      <div className="bg-scrim fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed inset-x-4 top-[15dvh] z-50 mx-auto max-w-md">
        <Panel flush>
          <PanelHeader
            title="Load position"
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void pasteFromClipboard()}
                title="Paste from clipboard"
              >
                <ClipboardPaste className="size-3.5" />
                Paste
              </Button>
            }
          />
          <div className="flex flex-col gap-2 p-3">
            <TextArea
              ref={textarea}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits; Shift+Enter keeps a newline for multi-line PGN.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={5}
              spellCheck={false}
              placeholder="Paste a FEN or PGN, then press Enter"
              className="w-full resize-none font-mono leading-relaxed placeholder:font-sans"
            />

            {loadError && (
              <p className="text-bad flex items-start gap-1.5 text-xs">
                <AlertCircle className="mt-px size-3.5 shrink-0" />
                {loadError}
              </p>
            )}

            {/* The photo half of the ONE load dialog (lanph3re's call): click,
                drop, or paste an image; the corner-adjust flow takes over. */}
            <label
              className="border-line hover:border-line-strong text-subtle flex cursor-pointer flex-col items-center gap-1 rounded-lg border border-dashed p-4 text-center text-xs transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
                if (file) onImage(file);
              }}
            >
              <ImagePlus className="size-4" />
              …or read the position from a picture
              <span className="text-[0.6875rem]">click to choose, drop a file, or paste an image</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) onImage(file);
                }}
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submit} disabled={!text.trim()}>
                Load
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
