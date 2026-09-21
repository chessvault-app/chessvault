import { useEffect } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import {
  cancelLeave,
  currentLeaveGuard,
  discardAndLeave,
  leaveIsBlocked,
  saveAndLeave,
  useLeaveAsk,
} from '@/lib/leaveGuard';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/lib/i18n';

/**
 * "You have unsaved changes" — the whole of it, mounted once in Shell.
 *
 * Global rather than per-view for the same reason ShortcutsHelp is: the
 * question is asked by the router, which does not know which view is up,
 * and a sheet owned by a view would have to survive that view leaving.
 *
 * ConfirmDialog is the wrong shape here — it draws its own trigger, and
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
export function LeaveDialog() {
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
    // `ask`: three answers about something the person already started,
    // which is an action sheet's job on iOS — and an action sheet is
    // anchored to the control that raised it, of which there is none
    // here (a navigation raised this, not a press). The HIG's own
    // fallback is the alert, and Material's is the basic dialog for the
    // same reason, so on either phone this is the centred card with its
    // three buttons still stacked, in the same order and the same
    // weights: three answers do not fit in a row, on either card.
    <Dialog
      ask
      open
      onOpenChange={(open) => {
        if (!open) cancelLeave();
      }}
    >
      <DialogContent size="sm" title={t('Unsaved changes')} className="gap-3">
        <p className="text-foreground text-sm">
          {t('You have unsaved changes in “{name}”. Would you like to save before leaving?', {
            name,
          })}
        </p>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {t(error)}
          </p>
        )}

        {/* Three answers, three weights, in the order they should be
            considered: save, back out, throw away. Discard sat in the middle
            when it was the tinted `danger` variant, which put the one
            irreversible answer directly under the thumb aiming for Save and
            gave it more ink than the harmless one. */}
        {/* Three answers stay stacked on either card, and on the iOS one
            each is the same 48px capsule the two-answer alert draws.
            Written as `ios:max-sm:` rather than from useAlertCard()
            because this component renders the Dialog root itself, so the
            context it provides is not readable here; the two conditions
            are the same one (AlertCardContext is `ios` exactly when the
            platform is iOS and the window is under the phone
            breakpoint). */}
        <div className="mt-1 flex flex-col gap-2 ios:max-sm:gap-2.5 ios:max-sm:[&>*]:h-12 ios:max-sm:[&>*]:rounded-full ios:max-sm:[&>*]:pointer-coarse:h-12">
          <Button
            variant="default"
            size="default"
            disabled={busy}
            className="w-full justify-center"
            onClick={() => void saveAndLeave()}
          >
            {busy ? <Spinner className="glyph" data-icon="inline-start" /> : <Save className="glyph" data-icon="inline-start" />}
            {t(busy ? 'Saving…' : 'Save')}
          </Button>
          <Button
            variant="secondary"
            size="default"
            disabled={busy}
            className="w-full justify-center"
            onClick={cancelLeave}
          >
            <X className="glyph" data-icon="inline-start" />
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
            <Trash2 className="glyph" data-icon="inline-start" />
            {t('Discard changes')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
