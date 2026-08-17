import { AlertCircle, ClipboardPaste, FolderInput, ImagePlus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  open: openProp,
  triggerClassName,
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
  /**
   * Drive the dialog from outside — for the phone's ⋯, which offers this
   * as a menu item while the button itself is hidden. Left undefined the
   * component owns its own open state, as every other caller expects.
   */
  open?: boolean;
  /** On the trigger. `max-md:hidden` where the menu takes over. */
  triggerClassName?: string;
} = {}) {
  const [selfOpen, setSelfOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : selfOpen;
  const setOpen = (next: boolean): void => {
    if (!controlled) setSelfOpen(next);
    onOpenChange?.(next);
  };
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
        className={triggerClassName}
        title={t('Load a position — FEN, PGN, or image')}
        onClick={() => setOpen(true)}
      >
        <FolderInput className="size-3.5" />
      </Button>
      {open && (
        <LoadDialog
          loadText={loadText}
          onBack={onBack && (() => {
            setOpen(false);
            onBack();
          })}
          onClose={() => setOpen(false)}
          onImage={(file) => {
            setImageFile(file);
            void builtinTemplates()
              .then(setTemplates)
              .catch(() => setTemplates([]));
          }}
        >
          {/* The picture flow is this window's next PAGE, so it is written
              inside it: the form parks while the picture is up and is
              there again behind the back chevron. It used to REPLACE the
              form — the dialog unmounted the moment templates arrived —
              and backing out of a picture therefore dropped you all the
              way to the board, with the FEN you had typed gone with it. */}
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
                onClose={() => setTemplates(null)}
              />
            </Suspense>
          )}
        </LoadDialog>
      )}
    </>
  );
}

/**
 * The load form itself, without a window around it.
 *
 * Exported because the editor's Position sheet shows it as a second PAGE
 * rather than opening a second sheet on top of the first: two sheets deep
 * on a phone is a window you have to dismiss twice to get out of.
 *
 * The Paste button lives in the form rather than in a window's title row
 * for the same reason — the form has to carry everything it needs to be
 * rendered anywhere.
 */
export function LoadPositionForm({
  loadText,
  onDone,
  onCancel,
  onImage,
}: {
  loadText: (value: string) => string | null;
  /** A position was loaded. */
  onDone: () => void;
  /** The Cancel button. Omitted where the window's own way out is enough. */
  onCancel?: () => void;
  onImage: (file: Blob | null) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        onImage(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onImage]);

  const submit = (): void => {
    const value = text.trim();
    if (!value) return;
    const failure = loadText(value);
    if (failure === null) onDone();
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
    <>
      {/* The Paste button lives INSIDE the field it fills, in the corner
          the text reaches last — not on the window's top edge, where it
          sat in the row dialogs keep their close button and read as
          chrome (lanph3re's report). It shows only while the field is
          empty, which is exactly as long as it is useful. */}
      <div className="relative">
        <TextArea
          ref={textarea}
          autoFocus={autoFocusField()}
          // The picture is what a PHONE opens this for; the box is what
          // it falls back to. The file input below is display:none, so
          // the box is the window's only visible field and the sole-text
          // -field rule claimed it — the sheet arrived under a keyboard,
          // with the dropzone it was opened for pushed off the screen.
          // The marker is coarse-only, which is the same judgment
          // autoFocus already makes here via autoFocusField: on a desktop
          // a caret in a paste box costs nothing and saves a click.
          data-fallback-field
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
        {!text && (
          <Button
            variant="secondary"
            size="sm"
            // pointerdown would blur-then-refocus; the handler refocuses
            // the field itself after filling it.
            onClick={() => void pasteFromClipboard()}
            title={t('Paste from clipboard')}
            className="absolute bottom-3.5 right-2"
          >
            <ClipboardPaste className="size-3.5" />
            {t('Paste')}
          </Button>
        )}
      </div>

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
      <div className="mt-1 flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={submit} disabled={!text.trim()}>
          {t('Load')}
        </Button>
      </div>
    </>
  );
}

function LoadDialog({
  loadText,
  onClose,
  onBack,
  onImage,
  children,
}: {
  loadText: (value: string) => string | null;
  onClose: () => void;
  onBack?: () => void;
  onImage: (file: Blob | null) => void;
  /** Pages opened out of this one — see the picture flow at the caller. */
  children?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal title="Load position" onClose={onClose} onBack={onBack} className="sm:max-w-md">
      <LoadPositionForm
        loadText={loadText}
        onDone={onClose}
        onCancel={onClose}
        onImage={onImage}
      />
      {children}
    </Modal>
  );
}
