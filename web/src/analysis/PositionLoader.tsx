import { AlertCircle, ClipboardPaste, FolderInput } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAnalysis } from '@/store/analysis';
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
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        active={open}
        title="Load a FEN or PGN"
        onClick={() => setOpen(true)}
      >
        <FolderInput className="size-3.5" />
      </Button>
      {open && <LoadDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function LoadDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const loadFen = useAnalysis((s) => s.loadFen);
  const loadPgn = useAnalysis((s) => s.loadPgn);
  const loadError = useAnalysis((s) => s.loadError);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
