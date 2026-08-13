import { AlertCircle, ClipboardPaste, FolderInput, ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAnalysis } from '@/store/analysis';
import { builtinTemplates } from '@/puzzles/ocr/builtin';
import type { Template } from '@/puzzles/ocr/classify';
import { Suspense, lazy } from 'react';

const PhotoImport = lazy(() => import('@/puzzles/PhotoImport').then((m) => ({ default: m.PhotoImport })));
import { Button } from '@/ui/Button';
import { TextArea } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { autoFocusField } from '@/lib/media';
import { t } from '@/lib/i18n';

/**
 * Load a position from FEN or PGN — a small header button opening a modal,
 * not a standing panel: loading is a once-per-session act (lanph3re's call), so
 * it should cost zero space while analysing.
 *
 * One textarea handles both formats: a leading `[` or a move number means
 * PGN, otherwise it's treated as a FEN. Guessing is safe because both
 * loaders validate and report failure rather than throwing.
 */
const looksLikePgn = (value: string): boolean =>
  /^\s*\[/.test(value) || /\b1\s*\.\s*[A-Za-z]/.test(value);

/** The analysis-board default: FEN and PGN both land on the move tree. */
function loadIntoAnalysis(value: string): string | null {
  const s = useAnalysis.getState();
  const ok = looksLikePgn(value) ? s.loadPgn(value) : s.loadFen(value);
  return ok ? null : (useAnalysis.getState().loadError ?? 'Could not load that.');
}

export function LoadPositionButton({
  loadText = loadIntoAnalysis,
  applyImageFen,
  onOpenChange,
  onBack,
}: {
  /** Consume pasted text; return an error message, or null on success. */
  loadText?: (value: string) => string | null;
  /** Consume a position read from an image (defaults to the analysis board). */
  applyImageFen?: (fen: string) => void;
  /** Told whenever the dialog opens or closes — for a caller that must
      get out of its way and know when to come back. */
  onOpenChange?: (open: boolean) => void;
  /** Given only when this opened from another window; see Modal.onBack. */
  onBack?: () => void;
} = {}) {
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
        title={t('Load a position — FEN, PGN, or image')}
        onClick={() => {
          onOpenChange?.(true);
          setOpen(true);
        }}
      >
        <FolderInput className="size-3.5" />
      </Button>
      {open && templates === null && (
        <LoadDialog
          loadText={loadText}
          onBack={onBack && (() => {
            setOpen(false);
            onBack();
          })}
          onClose={() => {
            setOpen(false);
            onOpenChange?.(false);
          }}
          onImage={(file) => {
            setImageFile(file);
            void builtinTemplates()
              .then(setTemplates)
              .catch(() => setTemplates([]));
          }}
        />
      )}
      {templates !== null && (
        <Suspense fallback={null}>
        <PhotoImport
          templates={templates}
          initialFile={imageFile ?? undefined}
          onApply={(reading) => {
            if (reading.fen) {
              if (applyImageFen) applyImageFen(reading.fen);
              else useAnalysis.getState().loadFen(reading.fen);
            }
            setTemplates(null);
            setOpen(false);
          }}
          onClose={() => {
            setTemplates(null);
            setOpen(false);
          }}
        />
        </Suspense>
      )}
    </>
  );
}

function LoadDialog({
  loadText,
  onClose,
  onBack,
  onImage,
}: {
  loadText: (value: string) => string | null;
  onClose: () => void;
  onBack?: () => void;
  onImage: (file: Blob | null) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

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

  const submit = (): void => {
    const value = text.trim();
    if (!value) return;
    const failure = loadText(value);
    if (failure === null) onClose();
    else setError(failure);
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
    <Modal
      title="Load position"
      onClose={onClose}
      onBack={onBack}
      className="sm:max-w-md"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void pasteFromClipboard()}
          title={t('Paste from clipboard')}
        >
          <ClipboardPaste className="size-3.5" />
          {t('Paste')}
        </Button>
      }
    >
      <TextArea
        ref={textarea}
        autoFocus={autoFocusField()}
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
        placeholder={t('Paste a FEN or PGN, then press Enter')}
        className="w-full resize-none font-mono leading-relaxed placeholder:font-sans"
      />

      {error && (
        <p className="text-bad flex items-start gap-1.5 text-xs">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {error}
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
        {t('…or read the position from a picture')}
        <span className="text-[0.6875rem]">{t('click to choose, drop a file, or paste an image')}</span>
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
          {t('Cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={!text.trim()}>
          {t('Load')}
        </Button>
      </div>
    </Modal>
  );
}
