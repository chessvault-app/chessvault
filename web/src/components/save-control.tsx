import { Check, Loader2, Save } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { announce } from '@/lib/announce';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

/**
 * Where a document stands against the copy on disk.
 *
 * Declared here rather than three times over: the study store, the note
 * view and the opening map each had their own identical copy of this
 * union, which is three places to forget when a state is added.
 */
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * Where a document stands, and what can be done about it.
 *
 * Extracted from two near-identical copies — `SaveIndicator` in StudyView
 * and `SaveBadge` in NoteView — which had drifted into disagreeing about
 * whether the badge was clickable. Now saving is manual it is more than a
 * badge: a pending document shows the button that resolves it, and a
 * settled one shows none, so the header is quiet exactly when there is
 * nothing to decide.
 *
 * ONE control while a document is pending. It used to be three — a yellow
 * dot reading "unsaved", a revert button, and Save — which said the same
 * thing twice and put the destructive answer a thumb's width from the
 * safe one. The Save button's presence IS the unsaved state; there is no
 * state in which it shows and the document is clean. Discarding still
 * exists, on the way out (see LeaveDialog), where it is asked rather than
 * clicked by accident.
 *
 * `Saved` and `Saving…` stay text: there is nothing to press. With
 * autosave on there is never anything to press while a document is
 * pending either, so the button does not appear at all — only a failure
 * still asks for a hand.
 */
export function SaveControl({
  state,
  error,
  autoSaves = false,
  onSave,
}: {
  state: SaveState;
  /** Shown as the retry tooltip; the button itself never spells out a failure. */
  error?: string | null;
  /**
   * Is this device writing as you type? Nothing here changes what happens
   * — the store owns that — only what is worth offering. See below.
   */
  autoSaves?: boolean;
  onSave: () => void;
}) {
  /**
   * A save that FAILED is said out loud; a save that worked is not.
   *
   * The control is text — "Saved", "Saving…" — and a screen reader hears
   * none of it, which for a failure is the difference between retrying
   * and losing the work. Not the happy path: with autosave the state
   * cycles saving -> saved on every pause in typing, and announcing that
   * would talk over the document being written.
   */
  const said = useRef<SaveState | null>(null);
  useEffect(() => {
    if (state === 'error' && said.current !== 'error') announce(t('Save failed'));
    said.current = state;
  }, [state]);

  if (state === 'saved') {
    return (
      <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-sm">
        <Check className="size-3.5" /> {t('Saved')}
      </span>
    );
  }
  // Pending under autosave is the spinner too, not a button.
  //
  // The write is already coming — the store arms it 1.5 s after the last
  // edit — so a Save button there offers to do something that needs no
  // asking, and offers it for exactly as long as it takes to read, then
  // swaps itself for a spinner. Typing produced a button flickering in
  // and out of the header. One steady spinner covers the whole debounce
  // and the PUT behind it: work in hand, nothing to decide.
  if (state === 'saving' || (state === 'dirty' && autoSaves)) {
    return (
      <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-sm">
        <Loader2 className="size-3.5 animate-spin" /> {t('Saving…')}
      </span>
    );
  }

  // Dirty and error differ in the label and in what the tooltip says, not
  // in a badge beside it: "Retry save" only appears after one has failed,
  // and the failure's own words are the tooltip. On a phone the word goes
  // and the icon carries it — the same collapse the Edit button makes, so
  // the tooltip is where a failure is spelled out either way.
  const failed = state === 'error';
  return (
    <Button
      variant="default"
      size="sm"
      className="shrink-0"
      title={error ?? t(failed ? 'Save failed' : 'Save changes')}
      onClick={onSave}
    >
      <Save className="size-3.5 md:mr-1" />
      <span className="max-md:hidden">{t(failed ? 'Retry save' : 'Save')}</span>
    </Button>
  );
}
