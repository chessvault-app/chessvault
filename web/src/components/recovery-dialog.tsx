import { History, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { t } from '@/lib/i18n';

/**
 * "There are changes here that were never saved."
 *
 * The other half of manual save. The pending buffer lives in a tab, so a
 * browser that dies takes it — unless a copy was parked in the vault,
 * which is what the swap file is. Finding one on open means a session
 * ended without answering the leave question, and this is that question,
 * asked late.
 *
 * It is deliberately a CHOICE rather than an automatic restore. Applying
 * a draft silently would be a write nobody asked for, which is the exact
 * behaviour this whole change exists to remove — and the person opening
 * the document may well be on a different device, looking at work they
 * had already decided against.
 *
 * Not built on ConfirmDialog: that draws its own trigger, and nothing was
 * pressed to raise this.
 */
export function RecoveryDialog({
  name,
  at,
  onRecover,
  onDismiss,
  onDefer,
}: {
  name: string;
  /** When the copy was parked, ISO. Shown as a local date and time. */
  at: string;
  onRecover: () => void;
  /** Answered: the swap is deleted and the saved document stands. */
  onDismiss: () => void;
  /**
   * Not answered: close, and leave the swap parked to be offered again.
   *
   * Separate from onDismiss because closing is not an answer. Escape, the
   * X, the scrim and the drag all arrive here, and every one of them means
   * "not now" in every other window in this app — routing them into the
   * destructive answer made the one sheet holding unrecoverable work the
   * one sheet where a reflex destroyed it.
   */
  onDefer: () => void;
}) {
  // The one fact that decides the answer. Someone who left a document
  // mid-thought half an hour ago wants it back; a draft from three weeks
  // ago is more likely something they had already thought better of.
  const when = new Date(at);
  const stamp = Number.isNaN(when.getTime())
    ? null
    : when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    // Dismissing by Escape, Back or the scrim leaves the swap where it is
    // — the answer that loses nothing, and the offer comes back next time.
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDefer();
      }}
    >
      <DialogContent size="sm" title={t('Unsaved changes were found')} className="gap-3">
        <p className="text-foreground text-base">
          {stamp
            ? t('“{name}” has changes from {when} that were never saved.', { name, when: stamp })
            : t('“{name}” has changes that were never saved.', { name })}
        </p>
        <p className="text-muted-foreground text-sm">
          {t('Restoring brings them back unsaved, so you can look before you keep them.')}
        </p>

        {/* "Changes", not "them", on both — this sheet and the leave question
            are the same question about the same thing, and answering one
            should not need a different vocabulary from answering the other.
            A clock rewinding rather than a life ring: the fact that decides
            the answer is WHEN the copy was parked, which the sentence above
            leads with, and nothing here is a rescue from a disaster. */}
        <div className="mt-1 flex flex-col gap-2">
          <Button variant="default" size="default" className="w-full justify-center" onClick={onRecover}>
            <History className="size-3.5" />
            {t('Restore changes')}
          </Button>
          <Button variant="destructive" size="default" className="w-full justify-center" onClick={onDismiss}>
            <Trash2 className="size-3.5" />
            {t('Discard changes')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
