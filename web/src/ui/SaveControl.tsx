import { Check, CircleAlert, Loader2 } from 'lucide-react';
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
 * The save badge every open document wears.
 *
 * Extracted from two near-identical copies — `SaveIndicator` in StudyView
 * and `SaveBadge` in NoteView — which had drifted into disagreeing about
 * one thing: the study's "Unsaved" was a button that saved on click, the
 * note's was inert text. The button is the better of the two, so both get
 * it, and `onSave` is what makes the difference.
 */
export function SaveControl({
  state,
  error,
  onSave,
}: {
  state: SaveState;
  /** Shown as the retry tooltip; the badge itself never spells out a failure. */
  error?: string | null;
  onSave: () => void;
}) {
  if (state === 'saved') {
    return (
      <span className="text-subtle flex shrink-0 items-center gap-1 text-xs">
        <Check className="size-3.5" /> {t('Saved')}
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="text-subtle flex shrink-0 items-center gap-1 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> {t('Saving…')}
      </span>
    );
  }
  if (state === 'error') {
    return (
      <button
        type="button"
        onClick={onSave}
        title={error ?? t('Save failed — click to retry')}
        className="text-bad flex shrink-0 items-center gap-1 text-xs"
      >
        <CircleAlert className="size-3.5" /> {t('Retry save')}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSave}
      title={t('Unsaved changes — click to save now')}
      className="text-warn flex shrink-0 items-center gap-1 text-xs"
    >
      <span className="bg-warn size-1.5 rounded-full" /> {t('Unsaved')}
    </button>
  );
}
