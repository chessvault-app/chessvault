import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { t } from '@/lib/i18n';

/**
 * Consequential-action confirmation: a stable icon trigger, and the
 * question in the app's own window. Red by default — most questions
 * here guard deletes — with a `tone` for the ones that guard something
 * heavy rather than something destructive (a minutes-long maintenance
 * pass is worth a question, not an alarm).
 *
 * It used to be an anchored popover — position-fixed off the trigger's
 * measured rect, portalled to the body, dismissed by an outside
 * mousedown, a touchstart, Escape, a scroll, a resize, or the pointer
 * leaving it for 350ms. All of that to reproduce, badly, what Sheet
 * already is: a centred card on a desktop, a bottom sheet on a phone,
 * with the drag, the scrim and the Escape every other window here has.
 * It also meant the one question in the app that should be hardest to
 * dismiss by accident was the easiest — a stray scroll took it away.
 *
 * Same props, so every call site is unchanged; only what appears when
 * you press it is different.
 *
 * Every string it is given is translated HERE. Each of these props is
 * user-facing by definition — there is no such thing as an internal
 * confirmation question — and asking the call sites to remember t() on
 * four props each is asking for the English dialog this shipped with.
 * Callers interpolating a name still call t() themselves; translating an
 * already-translated string is a no-op.
 */
/** What the question is about, whoever asked it. */
interface ConfirmDialogQuestion {
  icon: LucideIcon;
  /**
   * What the QUESTION is about. `danger` (the default) draws the red
   * tile and the destructive action — deletes, resets. `default` keeps
   * the same stop-and-ask shape in the app's ordinary colours, for
   * actions that are heavy but not destructive (Optimize).
   */
  tone?: 'danger' | 'default';
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * The usual shape: the dialog owns a trigger and its own open state.
 * `open` and `onOpenChange` are spelled out as never so that supplying
 * one of them is a type error here rather than a trigger that silently
 * does nothing.
 */
interface ConfirmDialogOwnTrigger {
  /** Optional trigger text next to the icon (icon-only when omitted). */
  label?: string;
  triggerTitle: string;
  triggerClassName?: string;
  /**
   * How loud the trigger is.
   *
   * `quiet` for the destructive actions that sit among ordinary row
   * controls, where a red button in every row is a page that looks
   * alarmed. `danger` for the ones that are the only destructive thing
   * on their surface — the puzzle history's reset, a book's — where the
   * colour is the warning and there is nothing for it to shout over.
   */
  triggerTone?: 'quiet' | 'danger';
  disabled?: boolean;
  open?: never;
  onOpenChange?: never;
}

/**
 * Held open by whatever asked for it, with no trigger of its own — a row
 * whose verbs live in a ⋯ menu, where the thing pressed is a menu item
 * that is gone by the time the question appears.
 *
 * Opt-in and all-or-nothing: pass the pair and the trigger props stop
 * being accepted, because there is no button left for them to describe.
 * Every existing call site passes neither and is untouched.
 */
interface ConfirmDialogHeldOpen {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  label?: never;
  triggerTitle?: never;
  triggerClassName?: never;
  triggerTone?: never;
  disabled?: never;
}

export function ConfirmDialog(
  props: ConfirmDialogQuestion & (ConfirmDialogOwnTrigger | ConfirmDialogHeldOpen),
) {
  const { icon: Icon, tone = 'danger', question, confirmLabel, onConfirm } = props;
  const [own, setOwn] = useState(false);
  const held = props.open !== undefined;
  const open = props.open ?? own;
  const setOpen = (next: boolean): void => {
    setOwn(next);
    props.onOpenChange?.(next);
  };

  return (
    <>
      {!held && (
        <Button
          variant={props.triggerTone === 'danger' ? 'destructive' : 'ghost'}
          size={props.label ? 'sm' : 'icon-sm'}
          title={t(props.triggerTitle!)}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={props.disabled ?? false}
          // A hover-revealed trigger must not fade away while its question is up.
          className={cn(props.triggerClassName, open && 'opacity-100')}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Icon className="size-3.5" data-icon="inline-start" />
          {props.label && t(props.label)}
        </Button>
      )}

      {/* The registry's destructive alert dialog: the verb as the title, the
          question as the description, Cancel and the tinted destructive
          action in the footer — stacked with the action on top on a phone,
          a row on a desktop. */}
      {open && (
        <AlertDialog
          open
          onOpenChange={(next) => {
            if (!next) setOpen(false);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia
                className={
                  tone === 'danger'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-primary/10 text-primary'
                }
              >
                <Icon />
              </AlertDialogMedia>
              <AlertDialogTitle>{t(confirmLabel)}</AlertDialogTitle>
              <AlertDialogDescription>{t(question)}</AlertDialogDescription>
            </AlertDialogHeader>
            {/* On a phone the footer stacks column-reverse, which puts
                the action on top: right for an ordinary dialog, where
                the primary belongs under the thumb, and wrong for a
                destructive one, where the thumb that just opened the
                sheet is resting exactly there. The danger tone keeps
                Cancel on top on a phone, so the irreversible answer
                takes a deliberate reach. */}
            <AlertDialogFooter className={tone === 'danger' ? 'max-sm:flex-col' : undefined}>
              {/* Cancel takes the focus (AlertDialogCancel autofocuses): a
                  confirmation opens under the keyboard on the answer that
                  loses nothing. */}
              <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant={tone === 'danger' ? 'destructive' : 'default'}
                onClick={() => {
                  // Held open, the caller's state is what keeps it up, so
                  // the answer has to close it — an uncontrolled dialog
                  // closes itself on the action and never needed this.
                  setOpen(false);
                  onConfirm();
                }}
              >
                {t(confirmLabel)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
