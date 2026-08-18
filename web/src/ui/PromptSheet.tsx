import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { ClearableInput } from './Input';
import { Sheet } from './Sheet';
import { autoFocusField } from '@/lib/media';
import { t } from '@/lib/i18n';

/**
 * A one-field prompt, centred in the space you can actually see.
 *
 * Everything about where it sits and how it survives the keyboard lives in
 * Sheet, which the move-to window shares. This is Sheet plus the field, the
 * Cancel and the confirm — the shape of every "name this" question in the
 * app: a new study, a new note, a rename.
 */
export function PromptSheet({
  label,
  initial,
  submitLabel = 'Done',
  extra,
  error,
  closeOnSubmit = true,
  onSubmit,
  onClose,
}: {
  label: string;
  initial: string;
  submitLabel?: string;
  /** One control above the field — a collection picker, say. Anything
      taller than that belongs in a Modal, not in a prompt. */
  extra?: ReactNode;
  /** Shown under the field. Needs closeOnSubmit={false} to be readable. */
  error?: string | null;
  /**
   * Whether submitting dismisses the sheet.
   *
   * A rename cannot fail, so it closes and gets on with it. A create can —
   * the name is taken, the server said no — and closing on the way out
   * would throw away both the message and what was typed.
   */
  closeOnSubmit?: boolean;
  /** Called with the trimmed value (unchanged value included — the caller
      decides whether that is a no-op). */
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const submit = (): void => {
    if (!draft.trim()) return;
    if (closeOnSubmit) onClose();
    onSubmit(draft.trim());
  };
  return (
    <Sheet label={label} onClose={onClose}>
      {extra}
      <ClearableInput
        autoFocus={autoFocusField()}
        value={draft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onClose();
        }}
      />
      {error && <p className="text-bad text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        {/* A way out that is not the scrim. Tapping outside works, but a
            dialog asking for one value should say so rather than expect
            you to know. */}
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={!draft.trim()} onClick={submit}>
          {t(submitLabel)}
        </Button>
      </div>
    </Sheet>
  );
}
