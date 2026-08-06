import { AlertCircle, ClipboardPaste } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Panel } from '@/ui/Panel';
import { cn } from '@/lib/cn';

/**
 * Load a position from FEN or PGN.
 *
 * One textarea handles both: a leading `[` or a move number means PGN, otherwise
 * it's treated as a FEN. Guessing here is safe because both loaders validate and
 * report failure rather than throwing.
 */
export function PositionLoader() {
  const [text, setText] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const loadFen = useAnalysis((s) => s.loadFen);
  const loadPgn = useAnalysis((s) => s.loadPgn);
  const loadError = useAnalysis((s) => s.loadError);

  const looksLikePgn = (value: string): boolean =>
    /^\s*\[/.test(value) || /\b1\s*\.\s*[A-Za-z]/.test(value);

  const submit = (): void => {
    const value = text.trim();
    if (!value) return;
    const ok = looksLikePgn(value) ? loadPgn(value) : loadFen(value);
    if (!ok) return;
    setText('');
    // Release focus: the arrow-key shortcuts deliberately ignore text fields, so
    // leaving focus here would silently break board navigation after a load.
    textarea.current?.blur();
  };

  const pasteFromClipboard = async (): Promise<void> => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip.trim()) setText(clip);
    } catch {
      // Clipboard read needs permission; typing still works.
    }
  };

  return (
    <Panel flush className="shrink-0">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between">
          <label
            htmlFor="position-input"
            className="text-subtle text-[0.6875rem] font-semibold uppercase tracking-[0.08em]"
          >
            Load position
          </label>
          <Button variant="ghost" size="sm" onClick={pasteFromClipboard} title="Paste">
            <ClipboardPaste className="size-3.5" />
            Paste
          </Button>
        </div>

        <textarea
          ref={textarea}
          id="position-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter keeps a newline for multi-line PGN.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          spellCheck={false}
          placeholder="Paste a FEN or PGN, then press Enter"
          className={cn(
            'bg-surface-inset border-line w-full resize-y rounded-lg border px-2.5 py-2',
            'font-mono text-xs leading-relaxed',
            'placeholder:text-subtle placeholder:font-sans',
            'focus:border-primary/50 outline-none',
          )}
        />

        {loadError && (
          <p className="text-bad flex items-start gap-1.5 text-xs">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {loadError}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={submit} disabled={!text.trim()}>
            Load
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText('');
              useAnalysis.getState().reset();
            }}
          >
            Reset to start
          </Button>
        </div>
      </div>
    </Panel>
  );
}
