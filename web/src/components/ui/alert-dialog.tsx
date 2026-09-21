import * as React from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useAlertCard,
  type DialogContentProps,
} from '@/components/ui/dialog';

/**
 * shadcn's AlertDialog (nova) — a question that must be answered before
 * anything else happens — owned, and built on this app's Dialog rather
 * than on Base UI's AlertDialog primitive. One deliberate difference: that
 * alert dialog refuses to close on a press outside, and every small window
 * in this app closes on the scrim (never the advertised way out, always a
 * way out). What a confirmation owes a screen reader it keeps:
 * `role="alertdialog"`.
 *
 * `ask`: this IS the question, so on a phone it is the platform's centred
 * alert rather than a bottom sheet (AlertCardContext in `dialog.tsx` says
 * why, and what that changes). Nothing moves on a desktop.
 */
function AlertDialog(props: React.ComponentProps<typeof Dialog>) {
  return <Dialog data-slot="alert-dialog" ask {...props} />;
}

/**
 * A small window by default: a question is a sentence and two buttons.
 * Composed by hand, the registry's way — AlertDialogHeader with the title
 * and the description, then the footer — rather than with Dialog's title
 * row: a question you must answer belongs in the body, not in the quiet
 * strip every other window is named in.
 */
function AlertDialogContent({ size = 'sm', className, ...props }: DialogContentProps) {
  return (
    <DialogContent
      data-slot="alert-dialog-content"
      alert
      size={size}
      className={cn('group/alert-dialog-content', className)}
      {...props}
    />
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<typeof DialogHeader>) {
  // Both phone cards align their title and their body to the start.
  // Material's is M3's own rule for the basic dialog; iOS 26 moved the
  // alert to leading alignment too (it was centred here until
  // 2026-09-21). Either way it reads as the rest of the app: every other
  // block of prose here starts at the same edge. The centred stack is
  // the phone SHEET's, and a desktop `sm` window's.
  const alertCard = useAlertCard();
  return (
    <DialogHeader
      data-slot="alert-dialog-header"
      className={cn(
        'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]',
        alertCard && 'max-sm:place-items-start max-sm:text-left',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The registry's footer: the muted band with the buttons, stacked with
 * the action on top on a phone (col-reverse) — the press that cannot be
 * undone is not a thumb's width from the way out — and a row on a desktop.
 *
 * The small size's two-column grid is a DESKTOP shape (`sm:`). It used to
 * apply at every width, which is what put Cancel and the destructive verb
 * side by side, each half a screen wide, at the bottom edge of a phone
 * sheet — the one place the stack was written for. Below the breakpoint
 * DialogFooter's own col-reverse stands: one button per row, full width,
 * the action on top.
 */
function AlertDialogFooter({ className, ...props }: React.ComponentProps<typeof DialogFooter>) {
  // On the iOS alert card two buttons sit side by side, each half the
  // card, which is the platform's own two-answer alert. The stack is
  // what a phone SHEET needs (a full-width row of controls at the
  // screen's foot); a 300px card has room for both. A caller that has
  // decided otherwise still wins, because its className is merged after
  // this one: the danger tone passes `max-sm:flex-col` to keep Cancel
  // out from under the thumb that just pressed the trigger, and that is
  // the same call on a card as on a sheet.
  //
  // Each answer is a CAPSULE, 48px tall, with 10px between the two: the
  // shape iOS 26 gives an alert's buttons, and the reason the band under
  // them could go. `pointer-coarse:h-12` as well as `h-12` because the
  // size variants' own coarse height is emitted after the plain one and
  // would otherwise win on the phone this is only ever drawn on.
  // The Material card puts its answers in a row at the END, each as wide
  // as its own words: text buttons, not a split pair. Same row, different
  // division of the width.
  const alertCard = useAlertCard();
  return (
    <DialogFooter
      data-slot="alert-dialog-footer"
      className={cn(
        'sm:group-data-[size=sm]/alert-dialog-content:grid sm:group-data-[size=sm]/alert-dialog-content:grid-cols-2',
        alertCard === 'ios' &&
          'max-sm:flex-row max-sm:gap-2.5 max-sm:[&>*]:h-12 max-sm:[&>*]:flex-1 max-sm:[&>*]:rounded-full max-sm:[&>*]:pointer-coarse:h-12',
        alertCard === 'material' && 'max-sm:flex-row max-sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The icon over the question — the registry's media block: a tinted
 * square, the icon inside.
 *
 * Not drawn on the iOS card: an iOS alert carries no icon, and the tile
 * is what a shrunken 300px card could least afford — it was the whole
 * top of the card, and with the top padding gone (the `ask` path's bug,
 * fixed in dialog.tsx) it read as clipped. Skipped rather than hidden,
 * so the header's `has-data-[slot=alert-dialog-media]` row never opens
 * for an element with nothing in it. The Material card keeps it: M3's
 * basic dialog has a hero icon.
 */
function AlertDialogMedia({ className, ...props }: React.ComponentProps<'div'>) {
  if (useAlertCard() === 'ios') return null;
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "bg-muted mb-2 inline-flex size-10 items-center justify-center rounded-md sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-']):not([class*='glyph'])]:size-6",
        className,
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle
      data-slot="alert-dialog-title"
      className={cn('sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2', className)}
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<typeof DialogDescription>) {
  return <DialogDescription data-slot="alert-dialog-description" className={cn('text-balance md:text-pretty', className)} {...props} />;
}

/**
 * The press that answers the question — the registry's `default`, and
 * `variant="destructive"` (the tint) for the confirmations that guard a
 * removal, the way the registry's own destructive example does it. It
 * should name its action ("Reset all progress"): "Confirm" answers a
 * question you have already stopped reading.
 *
 * On the Material card it is a TEXT button: M3's basic dialog has no
 * filled answer, and a destructive one is drawn in the destructive ink
 * rather than in a destructive fill. Both of the app's own colours, not
 * the platform's.
 *
 * On the iOS card the DEFAULT answer is the tinted capsule, and a
 * DESTRUCTIVE one is not a red button: it is the same quiet capsule the
 * Cancel beside it wears, with the destructive ink and a semibold
 * label. iOS reserves the fill for the thing you are most likely to
 * want, and a delete is never that. The variant is swapped rather than
 * overpainted, so the capsule keeps `secondary`'s own press dim
 * (`ios:active:opacity-80`, ui/button.tsx).
 */
function AlertDialogAction({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof Button>) {
  const alertCard = useAlertCard();
  const text = alertCard === 'material';
  const quiet = alertCard === 'ios' && variant === 'destructive';
  return (
    <DialogClose
      render={
        <Button
          data-slot="alert-dialog-action"
          variant={text ? 'ghost' : quiet ? 'secondary' : variant}
          size={size}
          className={cn(
            text &&
              (variant === 'destructive'
                ? 'text-destructive hover:text-destructive hover:bg-destructive/10'
                : 'text-primary hover:text-primary'),
            quiet && 'text-destructive font-semibold',
            className,
          )}
          {...props}
        />
      }
    />
  );
}

/**
 * Cancel takes the focus, not the destructive verb: a confirmation opens
 * under the keyboard on the answer that loses nothing.
 */
function AlertDialogCancel({
  className,
  // secondary, not the registry's outline: the app's secondary action is
  // a fill on the tonal page (DESIGN.md, Buttons).
  variant = 'secondary',
  size = 'default',
  autoFocus = true,
  ...props
}: React.ComponentProps<typeof Button>) {
  // Material's dismissive answer is a text button beside the other one.
  const text = useAlertCard() === 'material';
  return (
    <DialogClose
      render={
        <Button
          data-slot="alert-dialog-cancel"
          variant={text ? 'ghost' : variant}
          size={size}
          autoFocus={autoFocus}
          className={cn(text && 'text-primary hover:text-primary', className)}
          {...props}
        />
      }
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
};
