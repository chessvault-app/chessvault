import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ClearableInput } from '@/components/text-fields';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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
export function PromptDialog({
  label,
  initial,
  submitLabel = 'Done',
  inputMode,
  extra,
  error,
  closeOnSubmit = true,
  onSubmit,
  onClose,
}: {
  label: string;
  initial: string;
  submitLabel?: string;
  /**
   * The keyboard the field asks a phone for. Opt-in, and only ever the
   * caller's business: a prompt for a page number wants digits, and every
   * other prompt in the app wants the letters it gets by default.
   */
  inputMode?: 'numeric' | 'decimal';
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
  // The title is the field's name: the window asks one question and the
  // title row already says which.
  const titleId = useId();
  const submit = (): void => {
    if (!draft.trim()) return;
    if (closeOnSubmit) onClose();
    onSubmit(draft.trim());
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm" title={label} titleId={titleId}>
        {extra}
        <ClearableInput
          aria-labelledby={titleId}
          inputMode={inputMode}
          autoFocus={autoFocusField()}
          value={draft}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          {/* On a desktop, a way out that is not the scrim: tapping outside
              works, but a dialog asking for one value should say so rather
              than expect you to know. A phone's sheet already says so, with
              the handle, and is dragged away, tapped away or backed out
              of; a Cancel beside the one answer was a second button for the
              thumb to tell apart, so the answer takes the whole row there. */}
          <Button variant="ghost" size="sm" className="max-sm:hidden" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="max-sm:flex-1"
            disabled={!draft.trim()}
            onClick={submit}
          >
            {t(submitLabel)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
