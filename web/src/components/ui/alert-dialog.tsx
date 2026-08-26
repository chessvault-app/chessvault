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
  DialogTrigger,
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
 */
function AlertDialog(props: React.ComponentProps<typeof Dialog>) {
  return <Dialog data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger(props: React.ComponentProps<typeof DialogTrigger>) {
  return <DialogTrigger data-slot="alert-dialog-trigger" {...props} />;
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
  return (
    <DialogHeader
      data-slot="alert-dialog-header"
      className={cn(
        'grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]',
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
  return (
    <DialogFooter
      data-slot="alert-dialog-footer"
      className={cn('sm:group-data-[size=sm]/alert-dialog-content:grid sm:group-data-[size=sm]/alert-dialog-content:grid-cols-2', className)}
      {...props}
    />
  );
}

/** The icon over the question — the registry's media block: a tinted square, the icon inside. */
function AlertDialogMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "bg-muted mb-2 inline-flex size-10 items-center justify-center rounded-md sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
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
 */
function AlertDialogAction({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <DialogClose
      render={
        <Button data-slot="alert-dialog-action" variant={variant} size={size} className={cn(className)} {...props} />
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
  variant = 'outline',
  size = 'default',
  autoFocus = true,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <DialogClose
      render={
        <Button
          data-slot="alert-dialog-cancel"
          variant={variant}
          size={size}
          autoFocus={autoFocus}
          className={cn(className)}
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
  AlertDialogTrigger,
};
