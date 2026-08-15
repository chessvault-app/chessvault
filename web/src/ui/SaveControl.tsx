import { Check, CircleAlert, Loader2, Save, Undo2 } from 'lucide-react';
import { Button } from './Button';
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
 * badge: a pending document shows the two buttons that resolve it, and a
 * settled one shows neither, so the header is quiet exactly when there is
 * nothing to decide.
 *
 * Both buttons live here rather than one here and one in an overflow
 * menu, because they are two answers to the same question and a reader
 * looking for the second should not have to go hunting for it. `Saved`
 * and `Saving…` stay text: there is nothing to press.
 */
export function SaveControl({
  state,
  error,
  onSave,
  onDiscard,
}: {
  state: SaveState;
  /** Shown as the retry tooltip; the badge itself never spells out a failure. */
  error?: string | null;
  onSave: () => void;
  /** Back to the vault's copy. Omitted where there is nothing to go back to. */
  onDiscard?: () => void;
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

  return (
    <span className="flex shrink-0 items-center gap-1">
      {/* The state, then the way out of it. On a phone the words go and
          the icons carry it — the same collapse the Edit button makes. */}
      {state === 'error' ? (
        <span
          className="text-bad flex items-center gap-1 text-xs"
          title={error ?? t('Save failed')}
        >
          <CircleAlert className="size-3.5" />
          <span className="max-md:hidden">{t('Not saved')}</span>
        </span>
      ) : (
        <span className="text-warn flex items-center gap-1 text-xs">
          <span className="bg-warn size-1.5 rounded-full" />
          <span className="max-md:hidden">{t('Unsaved')}</span>
        </span>
      )}
      {onDiscard && (
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('Discard changes and go back to the saved version')}
          onClick={onDiscard}
        >
          <Undo2 className="size-3.5" />
        </Button>
      )}
      <Button
        variant="primary"
        size="sm"
        title={error ?? t('Save changes')}
        onClick={onSave}
      >
        <Save className="size-3.5 md:mr-1" />
        <span className="max-md:hidden">{t(state === 'error' ? 'Retry save' : 'Save')}</span>
      </Button>
    </span>
  );
}
