import { useState } from 'react';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { Button } from './Button';
import { Input } from './Input';

/**
 * A one-field prompt pinned to the TOP of the viewport — the sheet idiom
 * for touch devices, where an inline input low on the page sits exactly
 * where the keyboard lands. Used for renames on coarse pointers.
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
  const submit = (): void => {
    onClose();
    onSubmit(draft.trim());
  };
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50"
      onPointerDown={() => {
        onClose();
        suppressNextClick();
      }}
    >
      <div
        className="bg-surface border-line absolute inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] flex flex-col gap-2 rounded-xl border p-3 shadow-[var(--shadow-pop)]"
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
        <Button variant="primary" size="sm" className="self-end" onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
