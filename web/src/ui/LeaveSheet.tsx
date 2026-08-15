import { useEffect } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import {
  cancelLeave,
  currentLeaveGuard,
  discardAndLeave,
  leaveIsBlocked,
  saveAndLeave,
  useLeaveAsk,
} from '@/lib/leaveGuard';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { t } from '@/lib/i18n';

/**
 * "You have unsaved changes" — the whole of it, mounted once in Shell.
 *
 * Global rather than per-view for the same reason ShortcutsHelp is: the
 * question is asked by the router, which does not know which view is up,
 * and a sheet owned by a view would have to survive that view leaving.
 *
 * ConfirmSheet is the wrong shape here — it draws its own trigger, and
 * this one is opened by a navigation nobody clicked. The geometry is
 * borrowed from it though: full-width stacked buttons rather than a row,
 * because on a phone a row puts "save" and "throw away" a thumb's width
 * apart.
 *
 * Escape, Android Back, the scrim and the drag all mean CANCEL, which is
 * the answer that loses nothing — Sheet gives all four for free.
 */
export function LeaveSheet() {
  const name = useLeaveAsk((s) => s.name);
  const busy = useLeaveAsk((s) => s.busy);
  const error = useLeaveAsk((s) => s.error);

  // The one beforeunload for the whole app. It replaces a copy in
  // StudyView and another in NoteView, the second of which watched a
  // stale `saveState` through its dependency array. The browser gives us
  // no say in the wording and no third option, so this is only ever the
  // tab-close case; every in-app exit gets the sheet above.
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent): void => {
      if (leaveIsBlocked()) e.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  /**
   * Ctrl/⌘+S saves the open document.
   *
   * Registered here because the guard registry is what knows which
   * document is open, and this component is mounted for the whole app.
   *
   * It deliberately breaks the house rule that global key handlers skip
   * INPUT/TEXTAREA and contenteditable. A comment box and the body of a
   * note are exactly where you reach for this, and a save shortcut that
   * stops working the moment you are typing is a save shortcut that does
   * not work. Nothing here reads a character, so there is nothing to
   * steal from the field. Without a document open the browser keeps its
   * own shortcut; with one, preventDefault stops "Save page as…".
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 's' || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      const guard = currentLeaveGuard();
      if (!guard) return;
      e.preventDefault();
      void guard.save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!name) return null;

  return (
    <Sheet label={t('Unsaved changes')} onClose={cancelLeave} className="gap-3">
      <p className="text-fg text-sm">
        {t('“{name}” has changes you have not saved.', { name })}
      </p>
      {error && <p className="text-bad text-xs">{t(error)}</p>}

      <div className="mt-1 flex flex-col gap-2">
        <Button
          variant="primary"
          size="md"
          disabled={busy}
          className="w-full justify-center"
          onClick={() => void saveAndLeave()}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {t(busy ? 'Saving…' : 'Save')}
        </Button>
        {/* Tinted rather than filled: it is the destructive answer, but it
            is not the one being recommended, and a solid red button under
            a solid primary reads as two shouts. */}
        <Button
          variant="danger"
          size="md"
          disabled={busy}
          className="w-full justify-center"
          onClick={discardAndLeave}
        >
          <Trash2 className="size-3.5" />
          {t('Discard changes')}
        </Button>
        <Button
          variant="secondary"
          size="md"
          disabled={busy}
          className="w-full justify-center"
          onClick={cancelLeave}
        >
          {t('Stay here')}
        </Button>
      </div>
    </Sheet>
  );
}
