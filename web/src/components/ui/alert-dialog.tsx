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
 * than on Radix's AlertDialog primitive. One deliberate difference: Radix's
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

/** A small window by default: a question is a sentence and two buttons. */
function AlertDialogContent({ size = 'sm', ...props }: DialogContentProps) {
  return <DialogContent data-slot="alert-dialog-content" alert size={size} {...props} />;
}

function AlertDialogHeader(props: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader data-slot="alert-dialog-header" {...props} />;
}

/**
 * The registry's footer: the muted band with the buttons, stacked with
 * the action on top on a phone (col-reverse) — the press that cannot be
 * undone is not a thumb's width from the way out — and a row on a desktop.
 */
function AlertDialogFooter(props: React.ComponentProps<typeof DialogFooter>) {
  return <DialogFooter data-slot="alert-dialog-footer" {...props} />;
}

function AlertDialogTitle(props: React.ComponentProps<typeof DialogTitle>) {
  return <DialogTitle data-slot="alert-dialog-title" {...props} />;
}

function AlertDialogDescription(props: React.ComponentProps<typeof DialogDescription>) {
  return <DialogDescription data-slot="alert-dialog-description" {...props} />;
}

/**
 * The press that answers the question. Filled red by default here — every
 * confirmation in this app guards something destructive, and it should
 * name its action ("Reset all progress"), because "Confirm" answers a
 * question you have already stopped reading.
 */
function AlertDialogAction({
  className,
  variant = 'destructive-solid',
  size = 'default',
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <DialogClose asChild>
      <Button data-slot="alert-dialog-action" variant={variant} size={size} className={cn(className)} {...props} />
    </DialogClose>
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
    <DialogClose asChild>
      <Button
        data-slot="alert-dialog-cancel"
        variant={variant}
        size={size}
        autoFocus={autoFocus}
        className={cn(className)}
        {...props}
      />
    </DialogClose>
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
  AlertDialogTitle,
  AlertDialogTrigger,
};
