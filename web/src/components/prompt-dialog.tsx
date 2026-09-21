import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ClearableInput } from '@/components/text-fields';
import { Dialog, DialogContent, useAlertCard, useDialogDepart } from '@/components/ui/dialog';
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
  // The title is the field's name: the window asks one question and the
  // title row already says which.
  const titleId = useId();
  return (
    // `ask`: an alert with a single text field is the platform's own
    // shape for "name this" on both phones (iOS's text-field alert,
    // M3's basic dialog with a field), so there it is the centred card
    // and not a sheet. The keyboard is already handled: the card
    // is centred inside the layer the keyboard leaves visible (`vv-band`
    // on the overlay, `dialog.tsx`), which is the same band the sheet
    // was pinned to, so the card rises with it rather than being covered.
    <Dialog
      ask
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm" title={label} titleId={titleId}>
        <PromptBody
          titleId={titleId}
          initial={initial}
          submitLabel={submitLabel}
          inputMode={inputMode}
          extra={extra}
          error={error}
          closeOnSubmit={closeOnSubmit}
          onSubmit={onSubmit}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The prompt's contents, a component of their own so they sit INSIDE the
 * Dialog and can ask it for a held exit (useDialogDepart): the sheet
 * leaves, then the answer runs.
 */
function PromptBody({
  titleId,
  initial,
  submitLabel,
  inputMode,
  extra,
  error,
  closeOnSubmit,
  onSubmit,
  onClose,
}: {
  titleId: string;
  initial: string;
  submitLabel: string;
  inputMode?: 'numeric' | 'decimal';
  extra?: ReactNode;
  error?: string | null;
  closeOnSubmit: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const depart = useDialogDepart();
  const alertCard = useAlertCard();
  const submit = (): void => {
    const value = draft.trim();
    if (!value) return;
    // A prompt that stays up to show an error answers at once; one that
    // closes leaves first, since most callers unmount it as they answer.
    if (!closeOnSubmit) return onSubmit(value);
    depart(() => {
      onClose();
      onSubmit(value);
    });
  };
  return (
    <>
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
        <div className={cn('flex justify-end gap-2', alertCard === 'ios' && 'max-sm:[&>*]:flex-1')}>
          {/* On a desktop, a way out that is not the scrim: tapping outside
              works, but a dialog asking for one value should say so rather
              than expect you to know. A phone's sheet already says so, with
              the handle, and is dragged away, tapped away or backed out
              of; a Cancel beside the one answer was a second button for the
              thumb to tell apart, so the answer takes the whole row there.

              An alert card has neither the handle nor the X, so Cancel
              comes back on both of them: side by side, each half the
              card, the way iOS's own prompt draws them, and at the end of
              the row at its own width on the Material card. */}
          <Button
            variant="ghost"
            size="sm"
            className={alertCard ? undefined : 'max-sm:hidden'}
            onClick={onClose}
          >
            {t('Cancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            className={alertCard === 'material' ? undefined : 'max-sm:flex-1'}
            disabled={!draft.trim()}
            onClick={submit}
          >
            {t(submitLabel)}
          </Button>
        </div>
    </>
  );
}
