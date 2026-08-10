import { useEffect, useState } from 'react';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { Button } from './Button';
import { Input } from './Input';

/**
 * A one-field prompt, centred in the space you can actually see.
 *
 * It used to be pinned to the top, because an inline input low on the page
 * sits exactly where the keyboard lands. The middle of the screen is the
 * natural home for a dialog, but the middle of the WINDOW is behind the
 * keyboard — so it centres inside the visual viewport instead, which is
 * the part of the page the keyboard has left visible.
 *
 * Only the padding changes as the keyboard arrives, and it is not
 * transitioned: nothing here animates against iOS's own animation, which
 * is what made previous attempts at this jump about.
 */
export function PromptSheet({
  label,
  initial,
  submitLabel = 'Done',
  onSubmit,
  onClose,
}: {
  label: string;
  initial: string;
  submitLabel?: string;
  /** Called with the trimmed value (unchanged value included — the caller
      decides whether that is a no-op). */
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  // How much of the window the keyboard is covering.
  const [covered, setCovered] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = (): void =>
      setCovered(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    measure();
    vv.addEventListener('resize', measure);
    return () => vv.removeEventListener('resize', measure);
  }, []);
  const submit = (): void => {
    onClose();
    onSubmit(draft.trim());
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3"
      style={{ paddingBottom: covered ? covered + 12 : undefined }}
      onPointerDown={() => {
        onClose();
        suppressNextClick();
      }}
    >
      <div
        className="bg-surface border-line flex w-full max-w-sm flex-col gap-2 rounded-xl border p-3 shadow-[var(--shadow-pop)]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="text-subtle text-xs">{label}</p>
        <Input
          autoFocus
          value={draft}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
        />
        <div className="flex justify-end gap-2">
          {/* A way out that is not the scrim. Tapping outside works, but a
              dialog asking for one value should say so rather than expect
              you to know. */}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
