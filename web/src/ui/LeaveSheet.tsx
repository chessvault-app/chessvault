import { useEffect } from 'react';
import { Loader2, Save, Trash2, X } from 'lucide-react';
import {
  cancelLeave,
  currentLeaveGuard,
  discardAndLeave,
  leaveIsBlocked,
  saveAndLeave,
  useLeaveAsk,
} from '@/lib/leaveGuard';
import { Button } from './Button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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
 * the answer that loses nothing — Sheet gives all four for free. The
 * button that means the same thing is labelled "Cancel" to match them;
 * "Stay here" described the outcome but did not read as the escape hatch
 * those four gestures already are. Its icon is the same X the sheet's own
 * close control draws, which is what those gestures do: without one it was
 * the bare button between two that had icons.
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancelLeave();
      }}
    >
      <DialogContent size="sm" title={t('Unsaved changes')} className="gap-3">
        <p className="text-foreground text-base">
          {t('You have unsaved changes in “{name}”. Would you like to save before leaving?', {
            name,
          })}
        </p>
        {error && <p className="text-destructive text-sm">{t(error)}</p>}

        {/* Three answers, three weights, in the order they should be
            considered: save, back out, throw away. Discard sat in the middle
            when it was the tinted `danger` variant, which put the one
            irreversible answer directly under the thumb aiming for Save and
            gave it more ink than the harmless one. */}
        <div className="mt-1 flex flex-col gap-2">
          <Button
            variant="default"
            size="default"
            disabled={busy}
            className="w-full justify-center"
            onClick={() => void saveAndLeave()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {t(busy ? 'Saving…' : 'Save')}
          </Button>
          <Button
            variant="secondary"
            size="default"
            disabled={busy}
            className="w-full justify-center"
            onClick={cancelLeave}
          >
            <X className="size-3.5" />
            {t('Cancel')}
          </Button>
          {/* Red text on no panel at all — quieter than every `danger`
              trigger in the app, deliberately. Losing work is the one answer
              here that cannot be undone, so it should cost a deliberate look
              to find, not sit level with the other two. */}
          <Button
            variant="ghost"
            size="default"
            disabled={busy}
            className="text-destructive/80 hover:bg-destructive/10 hover:text-destructive w-full justify-center"
            onClick={discardAndLeave}
          >
            <Trash2 className="size-3.5" />
            {t('Discard changes')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
